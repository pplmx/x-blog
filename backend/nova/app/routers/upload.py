import re
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.auth import User, get_current_admin
from app.cache import upload_refs_cache
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter
from app.schemas import (
    PageInt,
    PaginationMeta,
    UploadBatchDeleteRequest,
    UploadFileInfo,
    UploadListResponse,
    UploadPostRef,
)

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# Upload filenames are `{uuid4}.{ext}` (see upload_image below); a month dir
# never holds anything else, so the delete route can whitelist the exact shape
# rather than defer to the filesystem.
_FILENAME_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$")
_YEAR_RE = re.compile(r"^20\d{2}$")
_MONTH_RE = re.compile(r"^(0[1-9]|1[0-2])$")
# References to uploaded images inside post content/cover_image.
_UPLOAD_URL_RE = re.compile(r"/static/uploads/(\d{4})/(\d{2})/([0-9a-f-]{36}\.[a-z]+)")
MAX_SIZE = 5 * 1024 * 1024  # 5MB

# Cap how many pixels Pillow will decode, well below its default (~178MP) bomb
# threshold: a small file can still declare a huge pixel grid, and decoding it
# is exactly the memory-spike the admin upload must not trigger. An image above
# this cap is rejected as invalid (HTTP 400), never decoded (RIL ISS-281).
Image.MAX_IMAGE_PIXELS = 40_000_000  # ~8000x5000

# Magic bytes for each allowed image type — the Content-Type header alone is
# client-controlled and must not be trusted (issue #20).
_MAGIC_BYTES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),  # + "WEBP" at offset 8
}


def _has_matching_magic_bytes(content: bytes, content_type: str) -> bool:
    """Check the file header matches the declared Content-Type."""
    signatures = _MAGIC_BYTES.get(content_type, ())
    if not signatures:
        return False
    if not content:
        return False
    if content_type == "image/webp":
        # WebP container: RIFF header + WEBP tag at bytes 8..12
        return content[:4] == b"RIFF" and len(content) >= 12 and content[8:12] == b"WEBP"
    return content.startswith(signatures)


def _verify_image_decodes(contents: bytes) -> None:
    """Raise if the bytes are not a fully decodable image of an allowed type.

    Magic bytes only prove the header; Pillow decoding proves the file is a
    real, well-formed image (rejects truncated/corrupt/polyglot uploads that
    would otherwise be stored and break rendering). (RIL round 17)
    """
    try:
        with Image.open(BytesIO(contents)) as image:
            image.load()
    except Image.DecompressionBombError:
        # A small file declaring a huge pixel grid: reject it rather than
        # decoding the bomb (Image.MAX_IMAGE_PIXELS caps us well below Pillow's
        # default). DecompressionBombError is NOT an OSError subclass, so the
        # pre-existing handler missed it and let the 400 path become a 500.
        # (RIL ISS-281)
        raise ValueError from None
    except Image.DecompressionBombWarning:
        # Between the warning threshold and the hard cap, PIL still decodes but
        # warns; our explicit cap keeps that window small, and this stays a
        # pass-through (the warning is deprecation-safe to ignore).
        pass


def _optimize_image(image_bytes: bytes, content_type: str) -> bytes:
    """Re-encode an already-validated image in its own format to shrink it.

    Same-format re-encode keeps the URL/extension (and thus every existing
    /static/uploads/... reference and the media library's filename contract)
    unchanged while dropping EXIF/GPS metadata — Pillow only preserves EXIF
    when it is explicitly passed to save(). (DEC-185, TASK-208)

    Guarantees:
    - never-larger: the optimized result is kept only if it is strictly smaller
      than the input, otherwise the original bytes win;
    - never-rejects: any re-encode error falls back to the original bytes (the
      upload was already validated); GIF is preserved as-is because re-encoding
      animated frames risks corruption for marginal gains.
    """
    if content_type == "image/gif":
        return image_bytes

    quality = 85 if content_type in {"image/jpeg", "image/webp"} else None
    try:
        out = BytesIO()
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()  # ensure pixel data is available before re-encode
            # JPEG has no alpha channel: any transparency must be flattened (to
            # a white background, not black) or the re-encode would silently
            # ruin the image. WebP does support alpha, so RGBA/LA/P images keep
            # their transparency unchanged.
            if content_type == "image/jpeg":
                if image.mode in {"RGBA", "LA", "P", "PA"}:
                    rgba = image.convert("RGBA")
                    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                    background.alpha_composite(rgba)
                    image = background.convert("RGB")
                else:
                    image = image.convert("RGB")
            save_kwargs: dict[str, int | bool] = {"optimize": True}
            if quality is not None:
                save_kwargs["quality"] = quality
            if content_type == "image/webp":
                save_kwargs["method"] = 6
            if content_type == "image/jpeg":
                save_kwargs["progressive"] = True
            fmt = "JPEG" if content_type == "image/jpeg" else content_type.upper()
            image.save(out, format=fmt, **save_kwargs)
        optimized = out.getvalue()
    except Exception:  # noqa: BLE001 — never turn a valid upload into a failure
        return image_bytes
    return optimized if len(optimized) < len(image_bytes) else image_bytes


# Whitelist of allowed file extensions for uploaded images
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}

# Map content types to file extensions
ALLOWED_TYPES_MAP = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}

STATIC_DIR = Path(__file__).parent.parent.parent / "static"


@router.post("")
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def upload_image(
    request: Request,  # noqa: ARG001
    file: UploadFile = File(...),
    _current_user: User = Depends(get_current_admin),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, detail="Unsupported file type")
    # Cap memory: read at most MAX_SIZE+1 bytes and reject before an oversized
    # body balloons RAM (reading the whole stream first would buffer it all).
    contents = await file.read(MAX_SIZE + 1)
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, detail="File too large (max 5MB)")
    if not _has_matching_magic_bytes(contents, file.content_type):
        raise HTTPException(400, detail="File content does not match the declared image type")
    try:
        _verify_image_decodes(contents)
    except UnidentifiedImageError, OSError, ValueError:
        raise HTTPException(400, detail="File is not a valid image")

    # Re-encode in the same format to shrink + strip EXIF (DEC-185, TASK-208).
    # Never-larger + never-rejecting, and the extension/URL is untouched so the
    # media library and every existing post reference stay valid.
    contents = _optimize_image(contents, file.content_type)

    # Safely extract file extension — guards against path traversal via filename
    safe_ext = Path(file.filename or "").suffix.lstrip(".").lower()
    # Fall back to content-type-derived extension if suffix is missing or unsafe
    ext = ALLOWED_TYPES_MAP.get(file.content_type, "jpg") if safe_ext not in ALLOWED_EXTENSIONS else safe_ext
    filename = f"{uuid.uuid4()}.{ext}"

    now = datetime.now()
    upload_dir = STATIC_DIR / "uploads" / str(now.year) / f"{now.month:02d}"
    upload_dir.mkdir(parents=True, exist_ok=True)

    filepath = upload_dir / filename
    filepath.write_bytes(contents)

    return {"url": f"/static/uploads/{now.year}/{now.month:02d}/{filename}"}


def _collect_upload_references(db: Session) -> dict[str, list[tuple[int, str]]]:
    """Map `/static/uploads/...` URL -> [(post id, post title)] for every post
    whose content or cover_image embeds that URL.

    One pass over the posts table (substring scan of the stored markdown), so a
    media query never turns into an N+1 walk over the uploads directory. The
    scan is over the exact upload URL form, so a post counts as referencing an
    image whether it appears inline (content) or as the cover.
    """
    refs: dict[str, list[tuple[int, str]]] = {}
    for post_id, title, content, cover_image in db.query(
        models.Post.id, models.Post.title, models.Post.content, models.Post.cover_image
    ).all():
        joined = " ".join(text for text in (content, cover_image) if text)
        for url in _UPLOAD_URL_RE.findall(joined):
            refs.setdefault(f"/static/uploads/{url[0]}/{url[1]}/{url[2]}", []).append((post_id, title))
    return refs


def _get_upload_references(db: Session) -> dict[str, list[tuple[int, str]]]:
    """Cached media-library reference map (TASK-333/ISS-432).

    The listing used to run the full _collect_upload_references scan — a regex
    pass streaming every post's stored markdown — for EACH list render, filename
    search, and page turn. The map is stable between post writes, so serve it
    from a short-TTL cache: 30s as a safety net, and every post write already
    clears it via clear_posts_list_cache (content/cover_image are its sources).
    Display-only decoration — the delete/batch-delete guards probe the DB live
    through _referencing_posts, so a transiently stale badge can never bypass
    the reference check. The cached value is read-only to callers (built once,
    consumed via .get), so sharing the dict across requests is safe.
    """
    cached = upload_refs_cache.get("all")
    if cached is not None:
        return cached
    refs = _collect_upload_references(db)
    upload_refs_cache["all"] = refs
    return refs


def _referencing_posts(db: Session, url: str) -> list[tuple[int, str]]:
    """Posts whose content or cover_image embed ``url`` (targeted, bounded).

    The delete guards used to share the media-listing scan
    (``_collect_upload_references``) — a regex pass over EVERY post's stored
    markdown, run just to check one file (single delete) or a handful (batch).
    On a big content table each delete action paid the same O(total content)
    cost as the whole listing. A delete only cares about its own URL(s), so a
    targeted contains() probe streams just the matching rows instead of
    loading every body into Python. Every caller validates the URL against the
    exact upload shape (4-digit year / zero-padded month / uuid.ext), so it
    cannot contain LIKE wildcards and needs no escaping.
    """
    return [
        (post_id, title)
        for post_id, title in db.query(models.Post.id, models.Post.title)
        .filter(
            or_(
                models.Post.content.contains(url),
                models.Post.cover_image.contains(url),
            )
        )
        .all()
    ]


def _upload_file_info(full_path: Path, refs: dict[str, list[tuple[int, str]]]) -> UploadFileInfo:
    """Derive the media-library row for one stored upload (DEC-183)."""
    year, month, filename = full_path.parent.parent.name, full_path.parent.name, full_path.name
    url = f"/static/uploads/{year}/{month}/{filename}"
    size = full_path.stat().st_size if full_path.exists() else 0
    width = height = None
    try:
        with Image.open(full_path) as image:
            width, height = image.size
    except OSError:
        pass  # filesystem metadata only; dims are best-effort
    # uploaded_at falls back to the file's mtime when the read/decoded size is
    # unavailable — the month directory is the upload's authoritative date.
    # mtime is a UTC epoch; fromtimestamp without tz would render the server's
    # LOCAL wall clock (a UTC+8 host shows uploads 8h off from every other
    # timestamp in the same dashboard). Convert to naive UTC, matching the
    # app-wide naive-UTC wire contract (DEC-213; round 276 deep-dive).
    uploaded_at = datetime.fromtimestamp(full_path.stat().st_mtime, UTC).replace(tzinfo=None)
    post_refs = [UploadPostRef(id=post_id, title=title) for post_id, title in refs.get(url, [])]
    return UploadFileInfo(
        url=url,
        year=int(year),
        month=int(month),
        filename=filename,
        size=size,
        width=width,
        height=height,
        uploaded_at=uploaded_at,
        referenced=bool(post_refs),
        referencing_posts=post_refs,
    )


@router.get("/files", response_model=UploadListResponse)
def list_uploaded_files(
    db: Session = Depends(get_db),
    q: str | None = Query(None, max_length=200, description="Filename substring filter (case-insensitive)"),
    page: PageInt = 1,
    page_size: int = Query(100, ge=1, le=500),
    _current_user: User = Depends(get_current_admin),
):
    """Admin media library: list stored uploads, newest first.

    Files live flat under static/uploads/YYYY/MM/ (see upload_image), so the
    listing is a bounded filesystem walk; reference status comes from one scan
    of the posts table rather than per-file queries. `q` narrows by filename
    substring (case-insensitive) so an author can locate a specific upload
    without scrolling a long library (DEC-189, TASK-210).
    """
    uploads_root = STATIC_DIR / "uploads"
    if not uploads_root.is_dir():
        return UploadListResponse(
            items=[], pagination=PaginationMeta(total=0, page=page, limit=page_size, total_pages=0)
        )

    refs = _get_upload_references(db)
    needle = q.lower() if q else None

    files: list[tuple[datetime, Path]] = []
    for year_dir in uploads_root.iterdir():
        if not year_dir.is_dir():
            continue
        for month_dir in year_dir.iterdir():
            if not month_dir.is_dir():
                continue
            for path in month_dir.iterdir():
                if path.is_file() and (needle is None or needle in path.name.lower()):
                    # Same naive-UTC interpretation as _upload_file_info (round
                    # 276): the mtime epoch is UTC, not the server's local clock.
                    files.append((datetime.fromtimestamp(path.stat().st_mtime, UTC).replace(tzinfo=None), path))
    files.sort(key=lambda pair: pair[0], reverse=True)

    total = len(files)
    total_pages = (total + page_size - 1) // page_size
    start = (page - 1) * page_size
    items = [_upload_file_info(path, refs) for _, path in files[start : start + page_size]]
    return UploadListResponse(
        items=items,
        pagination=PaginationMeta(total=total, page=page, limit=page_size, total_pages=total_pages),
    )


@router.delete("/files/{year}/{month}/{filename}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_uploaded_file(
    request: Request,  # noqa: ARG001
    year: str,
    month: str,
    filename: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Delete one uploaded image.

    Refuses when any post still embeds the image (content or cover_image) with a
    409 listing the referencing posts — matching how category deletion is
    guarded. Path components are validated against the exact upload shape
    (4-digit year / zero-padded month / uuid.ext) so traversal is rejected at
    the boundary, before any filesystem access.
    """
    if not _YEAR_RE.match(year) or not _MONTH_RE.match(month) or not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid upload path")
    url = f"/static/uploads/{year}/{month}/{filename}"
    referencing = _referencing_posts(db, url)
    if referencing:
        titles = ", ".join(title for _, title in referencing)
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete image: referenced by post(s): {titles}",
        )

    filepath = STATIC_DIR / "uploads" / year / month / filename
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    filepath.unlink()
    # Prune now-empty month/year directories so the listing stays tidy.
    for dir_ in (filepath.parent, filepath.parent.parent):
        with suppress(OSError):
            dir_.rmdir()


def _parse_upload_url(url: str) -> tuple[str, str, str] | None:
    """Split a /static/uploads/Y/M/F url into (year, month, filename) exactly.

    The same strict shape as the single-delete route (4-digit year /
    zero-padded month / uuid.ext) so a batch can never touch the filesystem
    with a malformed or traversing path — anything else parses to None.
    """
    prefix = "/static/uploads/"
    if not url.startswith(prefix):
        return None
    rest = url[len(prefix) :]
    if rest.count("/") != 2:
        return None
    year, month, filename = rest.split("/")
    if not (_YEAR_RE.match(year) and _MONTH_RE.match(month) and _FILENAME_RE.match(filename)):
        return None
    return year, month, filename


@router.post("/files/batch-delete", response_model=dict[str, int])
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_uploaded_files_batch(
    request: Request,  # noqa: ARG001
    body: UploadBatchDeleteRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Delete many uploaded images in one action (media bulk delete, DEC-191).

    The admin media library keeps hundreds of files with no way to clean up
    except one-by-one; this mirrors the comment batch-delete pattern (DEC-110):
    a capped request that validates every URL against the exact upload shape,
    then refuses the WHOLE batch with a 409 listing the referencing posts if
    ANY image is still embedded (fail-closed — same guard as the single delete,
    so bulk is never a way around the reference check). Missing files are
    skipped (idempotent) rather than failing the rest of the batch.
    """
    if not body.urls:
        return {"deleted": 0}

    parsed: list[tuple[str, str, str]] = []
    invalid: list[str] = []
    for url in body.urls:
        parts = _parse_upload_url(url)
        if parts is None:
            invalid.append(url)
        else:
            parsed.append(parts)
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid upload path(s): {', '.join(invalid)}")

    # Per-URL targeted probes (batch capped at 50) instead of the full
    # _collect_upload_references scan for every batch action — a delete of N
    # unreferenced files used to pay the whole-content pass each time.
    referenced: dict[str, list[tuple[int, str]]] = {}
    for year, month, filename in parsed:
        url = f"/static/uploads/{year}/{month}/{filename}"
        posts = _referencing_posts(db, url)
        if posts:
            referenced[url] = posts
    if referenced:
        block = "; ".join(f"{u} ({', '.join(t for _, t in posts)})" for u, posts in referenced.items())
        raise HTTPException(status_code=409, detail=f"Cannot delete images referenced by post(s): {block}")

    deleted = 0
    for year, month, filename in parsed:
        filepath = STATIC_DIR / "uploads" / year / month / filename
        if not filepath.is_file():
            continue  # already gone — keep the batch idempotent
        filepath.unlink()
        for dir_ in (filepath.parent, filepath.parent.parent):
            with suppress(OSError):
                dir_.rmdir()
        deleted += 1
    return {"deleted": deleted}

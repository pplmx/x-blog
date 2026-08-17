import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from PIL import Image, UnidentifiedImageError

from app.auth import User, get_current_admin
from app.limiter import RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5MB

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
    with Image.open(BytesIO(contents)) as image:
        image.load()


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
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, detail="File is not a valid image")

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

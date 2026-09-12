"""Shared image validation/optimization for uploaders (admin + reader avatar).

Both the admin media upload (/api/upload, DEC-185) and the reader avatar
(POST /api/reader/me/avatar, DEC-299/TASK-378) accept a user-supplied image and
must apply identical, defense-in-depth checks before storing bytes: content-type
whitelist, size cap, magic-byte verification (the client-controlled
Content-Type header is never trusted), a full Pillow decode (proves the file is
really an image, rejecting truncated/corrupt/polyglot uploads), and a same-format
re-encode that shrinks the file and strips EXIF/GPS metadata.

Living here rather than in either router keeps the (identical) security surface
in one file, so a fix to an upload bug can't diverge between the two entry
points.
"""

from io import BytesIO

from PIL import Image

# Allowed image content types.
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# Map content types to file extensions.
ALLOWED_TYPES_MAP = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}

MAX_SIZE = 5 * 1024 * 1024  # 5MB

# Cap how many pixels Pillow will decode, well below its default (~178MP) bomb
# threshold: a small file can still declare a huge pixel grid, and decoding it
# is exactly the memory-spike an upload must not trigger. An image above this
# cap is rejected as invalid (HTTP 400), never decoded (RIL ISS-281).
Image.MAX_IMAGE_PIXELS = 40_000_000  # ~8000x5000

# Magic bytes for each allowed image type — the Content-Type header alone is
# client-controlled and must not be trusted (issue #20).
_MAGIC_BYTES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),  # + "WEBP" at offset 8
}


def has_matching_magic_bytes(content: bytes, content_type: str) -> bool:
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


def verify_image_decodes(contents: bytes) -> None:
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


def optimize_image(image_bytes: bytes, content_type: str) -> bytes:
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

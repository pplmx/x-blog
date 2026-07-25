import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.limiter import RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5MB

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
async def upload_image(request: Request, file: UploadFile = File(...)):  # noqa: ARG001
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, detail="Unsupported file type")

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, detail="File too large (max 5MB)")

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

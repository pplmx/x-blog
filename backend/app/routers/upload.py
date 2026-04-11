import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5MB

STATIC_DIR = Path(__file__).parent.parent.parent / "static"


@router.post("")
async def upload_image(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, detail="Unsupported file type")

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, detail="File too large (max 5MB)")

    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"

    now = datetime.now()
    upload_dir = STATIC_DIR / "uploads" / str(now.year) / f"{now.month:02d}"
    upload_dir.mkdir(parents=True, exist_ok=True)

    filepath = upload_dir / filename
    filepath.write_bytes(contents)

    return {"url": f"/static/uploads/{now.year}/{now.month:02d}/{filename}"}

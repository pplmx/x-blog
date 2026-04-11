from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=List[schemas.Tag])
def list_tags(db: Session = Depends(get_db)):
    return crud.get_tags(db)

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=List[schemas.Category])
def list_categories(db: Session = Depends(get_db)):
    return crud.get_categories(db)

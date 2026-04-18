from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..crud import search_posts
from ..database import get_db
from ..limiter import RATE_LIMIT_SEARCH, limiter
from ..schemas import PostList

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search(
    request: Request,  # noqa: ARG001
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    posts, total = search_posts(db, query=q, page=page, limit=limit)

    return {
        "items": [PostList.model_validate(p) for p in posts],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        },
    }

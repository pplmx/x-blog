"""Public author archive (DEC-359, TASK-405).

An admin writer with a public pen name (User.display_name) has a public
presence: their byline on posts, and this per-author archive of published
posts. The login username is never exposed — admin login is deliberately
no-oracle (timing-equalized; see admin login) — and an unknown author id
answers 404 exactly like an author who chose no pen name, so this endpoint can
neither enumerate admins nor reveal which usernames exist.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app import auth, crud, schemas
from app.conditional import conditional_json
from app.database import get_db
from app.schemas import IdInt, PageInt

router = APIRouter(prefix="/api/authors", tags=["authors"])


@router.get("/{author_id}/posts", response_model=schemas.PostListResponse)
def get_author_posts(
    request: Request,
    author_id: IdInt,
    page: PageInt = 1,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """A writer's published posts, newest-first (paginated).

    Only reachable for a public author — an admin who set a pen name. An
    unknown id and a username-only admin answer the same 404 (no public
    presence), so the endpoint neither enumerates admins nor leaks login
    usernames (DEC-359, TASK-405).
    """
    # Fire the scheduled-post publish-time fan-out on this surface too (the
    # round-331 sweep: every surface that can show a crossed scheduled post
    # announces it exactly once).
    crud.maybe_notify_due_scheduled_posts(db)
    author = db.query(auth.User).filter(auth.User.id == author_id).first()
    if author is None or not author.display_name:
        raise HTTPException(status_code=404, detail="Author not found")

    posts, total = crud.get_posts(db, skip=(page - 1) * limit, limit=limit, author_id=author_id)
    total_pages = (total + limit - 1) // limit
    response = schemas.PostListResponse.model_validate(
        {
            "items": posts,
            "pagination": {
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": total_pages,
            },
        }
    )
    return conditional_json(response.model_dump(mode="json"), request)

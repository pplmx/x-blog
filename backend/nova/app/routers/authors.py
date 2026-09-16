"""Public author archive (DEC-359, TASK-405).

An admin writer with a public pen name (User.display_name) has a public
presence: their byline on posts, and this per-author archive of published
posts. The login username is never exposed — admin login is deliberately
no-oracle (timing-equalized; see admin login) — and an unknown author id
answers 404 exactly like an author who chose no pen name, so this endpoint can
neither enumerate admins nor reveal which usernames exist.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.conditional import conditional_json
from app.database import get_db
from app.schemas import IdInt, PageInt

router = APIRouter(prefix="/api/authors", tags=["authors"])


@router.get("", response_model=list[schemas.AuthorIndex])
def list_authors(db: Session = Depends(get_db)):
    """Every public writer (pen-named admin), with their published-post count.

    Writer discovery (DEC-359, round 346): a reader who found one byline can
    browse every contributor. Only pen names are exposed — an admin with no
    pen name has no public presence and stays off this list (never the login
    username, admin login is no-oracle). The count is published posts only, so
    a writer with nothing live yet still appears with a zero.
    """
    writers = db.query(auth.User).filter(auth.User.display_name.isnot(None)).order_by(auth.User.display_name).all()
    post_counts = (
        db.query(models.Post.author_id, func.count(models.Post.id))
        .filter(models.Post.author_id.isnot(None), models.Post.published.is_(True))
        .group_by(models.Post.author_id)
        .all()
    )
    counts = {author_id: int(count) for author_id, count in post_counts}
    items = [
        {
            "id": u.id,
            "display_name": u.display_name,
            "post_count": counts.get(u.id, 0),
            "bio": u.bio,
        }
        for u in writers
    ]
    return items


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
    # The top-level author envelope lets the archive page title itself by pen
    # name even when the writer has no published posts yet (DEC-359/TASK-405).
    response = schemas.AuthorPostsResponse.model_validate(
        {
            "items": posts,
            "pagination": {
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": total_pages,
            },
            "author": author,
        }
    )
    return conditional_json(response.model_dump(mode="json"), request)

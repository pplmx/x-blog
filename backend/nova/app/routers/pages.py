"""Static pages: admin-curated content served publicly at /pages/{slug} (round 347).

A self-hosted blog is expected to speak for itself — privacy policy, terms,
contact, changelog — but the only static page was a hardcoded ``/about``, so a
site owner needed a code change + redeploy for every such page. This router is
the CMS slice: an admin manager (list/create/update/delete + a ``published``
toggle) and a public read surface.

Public surface (no oracle): an unpublished or unknown slug answers the same
404, so the endpoints cannot enumerate drafts. The public list exposes only
identity (slug + title) so the footer can link published pages without
dumping their bodies, and the public detail returns the full markdown body the
frontend renders through the same pipeline as posts.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import User, get_current_admin
from app.conditional import conditional_json
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, RATE_LIMIT_WRITE, limiter
from app.schemas import IdInt

router = APIRouter(prefix="/api/pages", tags=["pages"])
admin_router = APIRouter(prefix="/api/admin/pages", tags=["pages"])


@router.get("", response_model=list[schemas.PageLink])
def list_pages(request: Request, db: Session = Depends(get_db)):
    """Published pages, identity only — the footer/discovery link list."""
    pages = db.query(models.Page).filter(models.Page.published.is_(True)).order_by(models.Page.title.asc()).all()
    return conditional_json(
        [schemas.PageLink.model_validate(p).model_dump(mode="json") for p in pages],
        request,
    )


@router.get("/{slug}", response_model=schemas.PagePublic)
def get_page(request: Request, slug: str, db: Session = Depends(get_db)):
    """A published page's full body. Unpublished and unknown slugs both 404
    (no-oracle): a draft is indistinguishable from a never-published page."""
    page = db.query(models.Page).filter(models.Page.slug == slug, models.Page.published.is_(True)).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return conditional_json(
        schemas.PagePublic.model_validate(page).model_dump(mode="json"),
        request,
    )


@admin_router.get("", response_model=list[schemas.AdminPageDetail])
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def admin_list_pages(
    request: Request,  # noqa: ARG001
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Every page (drafts included) with its body, newest-touched first — the
    manager list. Unlike the public list this includes content so the inline
    editor can start from what is saved (pages are few and admin-only)."""
    pages = db.query(models.Page).order_by(models.Page.updated_at.desc(), models.Page.id.desc()).all()
    return pages


@admin_router.post("", response_model=schemas.AdminPageDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_create_page(
    request: Request,  # noqa: ARG001
    page_in: schemas.PageCreate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    existing = db.query(models.Page).filter(models.Page.slug == page_in.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail="Slug already in use")
    page = models.Page(**page_in.model_dump())
    db.add(page)
    db.commit()
    db.refresh(page)
    return page


@admin_router.patch("/{page_id}", response_model=schemas.AdminPageDetail)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_update_page(
    request: Request,  # noqa: ARG001
    page_id: IdInt,
    page_in: schemas.PageUpdate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    page = db.query(models.Page).filter(models.Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    data = page_in.model_dump(exclude_unset=True)
    if "slug" in data and data["slug"] is not None and data["slug"] != page.slug:
        clash = db.query(models.Page).filter(models.Page.slug == data["slug"]).first()
        if clash:
            raise HTTPException(status_code=409, detail="Slug already in use")
    for field, value in data.items():
        setattr(page, field, value)
    db.commit()
    db.refresh(page)
    return page


@admin_router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_delete_page(
    request: Request,  # noqa: ARG001
    page_id: IdInt,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    page = db.query(models.Page).filter(models.Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    db.delete(page)
    db.commit()

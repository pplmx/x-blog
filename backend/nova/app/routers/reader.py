"""Reader account endpoints: self-registration, login, current profile.

Reader accounts are the identity layer for cloud-synced bookmarks (DEC-059,
TASK-131). They are deliberately separate from admin ``User`` accounts — both
in table (``reader_accounts``) and in JWT audience (``aud=x-blog-reader``) —
so a self-registering reader can never hold a credential that reaches admin
endpoints (enforced in auth.get_current_user / get_current_reader).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import auth
from app.database import get_db
from app.limiter import RATE_LIMIT_AUTH, RATE_LIMIT_REGISTER, limiter

router = APIRouter(prefix="/api/reader", tags=["reader"])

# RFC-5321-ish email shape; deliberately conservative and dependency-free
# (validated as a Field pattern so malformed input becomes the repo-standard
# 422 VALIDATION_ERROR envelope instead of a hand-rolled HTTPException).
# Uses \z (Rust-regex end-of-text anchor — Pydantic v2's engine — not Python
# $) so a trailing newline cannot sneak past the anchor.
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+\z"


class ReaderProfile(BaseModel):
    """Public reader profile (never includes the password hash)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str | None = None
    created_at: datetime | None = None


class ReaderLoginResponse(BaseModel):
    access_token: str
    token_type: str
    reader: ReaderProfile


class ReaderRegister(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)
    # bcrypt only hashes the first 72 bytes of a password; capping input at 72
    # keeps the effective credential equal to the stored credential (a longer
    # password would silently truncate). (security review, TASK-131)
    password: str = Field(min_length=8, max_length=72)
    display_name: str | None = Field(default=None, min_length=1, max_length=50)


class ReaderLogin(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)
    password: str = Field(min_length=1, max_length=72)


# A valid bcrypt hash of a random throwaway password, at the same cost as a
# real account hash. When the email is unknown we still run bcrypt against this
# so the login endpoint's response *timing* does not reveal whether an email
# exists (unknown email must not short-circuit faster than a wrong password).
_FAKE_BCRYPT_HASH = "$2b$12$K7LqkVaQ1OiOsahF1P17/uM5UQi7QkS5d8ZqS3mDzW0yPj2k9VxG"


def _authenticate_reader(db: Session, email: str, password: str) -> auth.ReaderAccount | None:
    """Return the reader account for valid credentials, else None.

    Runs bcrypt against a dummy hash for unknown emails so timing does not
    leak account existence (login is reusable abuse surface even though
    registration is an existence oracle with a stricter rate limit).
    """
    reader = db.query(auth.ReaderAccount).filter(func.lower(auth.ReaderAccount.email) == email.lower()).first()
    if not reader:
        auth.verify_password(password, _FAKE_BCRYPT_HASH)
        return None
    if not auth.verify_password(password, reader.password):
        return None
    return reader


@router.post("/register", response_model=ReaderLoginResponse, status_code=201)
@limiter.limit(f"{RATE_LIMIT_REGISTER}/minute")
def register(
    request: Request,  # noqa: ARG001
    payload: ReaderRegister,
    db: Session = Depends(get_db),
):
    """Create a reader account and return a reader-scoped JWT (auto-login).

    Registration is rate-limited by a dedicated (stricter) per-IP bucket than
    login, since open signup is the classic spam/abuse surface.
    """
    # Normalize to lowercase so the case-sensitive unique index on `email` is
    # effectively case-insensitive: "Reader@X.com" and "reader@x.com" must not
    # be two accounts, and login (which compares with func.lower) stays
    # unambiguous. (DEC-059, TASK-131)
    normalized_email = payload.email.lower().strip()
    reader = auth.ReaderAccount(
        email=normalized_email,
        password=auth.get_password_hash(payload.password),
        display_name=payload.display_name,
        token_version=0,
    )
    db.add(reader)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")
    db.refresh(reader)

    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


@router.post("/login", response_model=ReaderLoginResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def login(
    request: Request,  # noqa: ARG001
    payload: ReaderLogin,
    db: Session = Depends(get_db),
):
    """Authenticate a reader by email+password and return a reader-scoped JWT."""
    reader = _authenticate_reader(db, payload.email, payload.password)
    if reader is None:
        # Same detail string as admin login so the response doesn't reveal
        # whether an email exists.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


@router.get("/me", response_model=ReaderProfile)
def me(_current_reader: auth.ReaderAccount = Depends(auth.get_current_reader)):
    """Return the authenticated reader's own profile."""
    return _current_reader

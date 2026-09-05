import os
import warnings
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.config import is_development
from app.database import Base, get_db

# ≥32 bytes so PyJWT's HS256 InsecureKeyLengthWarning (RFC 7518 §3.2) stays
# silent in dev; the key itself is still a well-known, development-only value.
DEV_SECRET_KEY = "x-blog-secret-key-dev-only-32-bytes-min"
ALGORITHM = "HS256"


def admin_token_expire_days() -> float:
    """Admin JWT lifetime in (fractional) days, active per session creation.

    ``JWT_EXPIRE_MINUTES`` (e.g. ``"30"``) takes precedence when set — a
    whole-day integer cannot express a sub-day session like the "30 minutes"
    the operator asked for; otherwise ``JWT_EXPIRE_DAYS`` is the whole-day
    knob, default 1 day. Expiry itself lives in the JWT ``exp`` claim and is
    enforced by the backend (RIL ISS-273).
    """
    minutes = os.getenv("JWT_EXPIRE_MINUTES")
    if minutes:
        return float(minutes) / (24 * 60)
    return float(os.getenv("JWT_EXPIRE_DAYS", "1"))


# Kept for backwards compatibility / tests that read it directly; the live
# value is re-read per token, so an env change takes effect without a restart.
ACCESS_TOKEN_EXPIRE_DAYS = admin_token_expire_days()
# Reader JWT expiry (shorter than admin: readers authenticate from many
# browsers/scripts, and cloud-sync clients should re-login periodically).
READER_TOKEN_EXPIRE_DAYS = int(os.getenv("READER_TOKEN_EXPIRE_DAYS", "30"))

# Audience disambiguation between admin and reader tokens. Both token kinds are
# signed with the same SECRET_KEY, so audience separation is the *discriminator*
# that stops a leaked reader token from ever authenticating as an admin. A
# reader JWT carries aud=x-blog-reader and the admin guard rejects it explicitly
# (see get_current_user). (DEC-059, TASK-131)
READER_AUDIENCE = "x-blog-reader"


def _load_secret_key() -> str:
    """JWT signing key: env var, or the development-only fallback, or refuse to start.

    Returns a ``str`` (never ``None``) so ``jwt.encode``/``decode`` receive a real
    key: outside development a missing JWT_SECRET_KEY is a hard startup error, and
    in development the well-known default is used with a warning.
    """
    key = os.getenv("JWT_SECRET_KEY")
    if key:
        return key
    if not is_development():
        raise RuntimeError(
            "JWT_SECRET_KEY is not set. Refusing to start outside development — "
            "a publicly known default would let anyone forge admin tokens. "
            "Set JWT_SECRET_KEY, or set APP_ENV=development to run with the dev default."
        )
    warnings.warn(
        "JWT_SECRET_KEY not set. Using the DEVELOPMENT-only default key. "
        "Never run production with APP_ENV=development.",
        stacklevel=2,
    )
    return DEV_SECRET_KEY


SECRET_KEY = _load_secret_key()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login")

# Admin role tiers (authoritative discriminator for admin authorization). A
# superuser can manage users/export/batch; an editor can only moderate content
# (posts/comments/categories/tags). `is_superuser` below is kept as a stored
# boolean (DDL preserved, DEC-009) and stays consistent with role. (DEC-054,
# TASK-114)
ROLE_SUPERUSER = "superuser"
ROLE_EDITOR = "editor"
ADMIN_ROLES = (ROLE_SUPERUSER, ROLE_EDITOR)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_EDITOR)
    is_superuser: Mapped[bool | None] = mapped_column(Boolean, default=False)
    # Bumped on password change so previously-issued JWTs are invalidated
    # immediately (checked in get_current_user). (RIL round 16 security audit)
    token_version: Mapped[int | None] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class ReaderAccount(Base):
    """A reader's account — the identity backing cloud-synced bookmarks.

    Deliberately separate from the admin ``User`` table: readers self-register
    publicly, so they must never share a table or row range with privileged
    admin accounts (a JWT ``sub`` collision could otherwise cross-authenticate,
    DEC-059/TASK-131). ``token_version`` mirrors ``User`` so a credential
    rotation invalidates previously-issued reader tokens immediately.
    """

    __tablename__ = "reader_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    password: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(50))
    token_version: Mapped[int | None] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class TokenData(BaseModel):
    user_id: int | None = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(data: dict, token_version: int = 0) -> str:
    """Create a signed JWT. ``token_version`` is embedded as the ``ver`` claim so
    password-change revocation can reject previously issued tokens (see
    get_current_user)."""
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    to_encode["ver"] = token_version
    expire = datetime.now(UTC) + timedelta(days=admin_token_expire_days())
    to_encode["exp"] = expire
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_reader_token(data: dict, token_version: int = 0) -> str:
    """Create a reader-scoped JWT (aud=x-blog-reader).

    Same signing key as admin tokens, but the ``aud`` claim marks the token as
    reader-scoped: the admin guard (get_current_user) rejects tokens carrying
    this audience, so a reader credential can never be replayed against admin
    endpoints even if ``sub`` happens to equal a users.id (DEC-059, TASK-131).
    Readers log in from many sessions/clients, so their tokens live longer than
    admin tokens by default.
    """
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    to_encode["ver"] = token_version
    to_encode["aud"] = READER_AUDIENCE
    expire = datetime.now(UTC) + timedelta(days=READER_TOKEN_EXPIRE_DAYS)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _decode_payload(token: str, audience: str | None = None) -> dict | None:
    """Decode+verify a JWT, returning its claims or None on any failure.

    ``audience`` is passed through to ``jwt.decode``: PyJWT only validates the
    ``aud`` claim when the token carries one (legacy admin tokens without an
    ``aud`` claim still decode), but a token *with* an ``aud`` must match the
    expected audience or it is rejected. This is what makes audience separation
    hold in practice — a mismatched-audience token never reaches the guards'
    claim checks. Audience-verification failures surface as
    ``InvalidAudienceError``, a subclass of ``InvalidTokenError``, so they fall
    into the same None-returning path as expiry/bad-signature.

    The ``sub`` claim is coerced to ``int`` *here* (inside the error handling)
    rather than in the guards, so a malformed non-numeric ``sub`` is a clean 401
    instead of a 500-class ValueError escaping from ``int(...)``. (security
    review, TASK-131)
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=audience)
        sub = payload.get("sub")
        payload["sub"] = int(sub) if sub else None
        return payload
    except InvalidTokenError, TypeError, ValueError:
        # InvalidTokenError: bad signature/expired/audience; TypeError/ValueError:
        # malformed (non-numeric) `sub`. All are auth failures → None.
        return None


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = _decode_payload(token)
    if payload is None:
        raise credentials_exception
    # Audience separation (DEC-059, TASK-131): a reader-scoped token (carrying
    # aud=x-blog-reader) must never authenticate as an admin. Without this check
    # a leaked reader token whose sub happens to match a users.id would grant
    # admin access. Legacy admin tokens (issued before this change) carry no aud
    # claim and still decode; only reader tokens are rejected. Note _decode_payload
    # already rejects an aud-bearing token outright when decoding with no expected
    # audience (PyJWT raises InvalidAudienceError) — this check is defense-in-depth
    # against future decode-option changes, and is list-aware so a list-form
    # aud claim (["x-blog-reader", ...]) is also rejected.
    aud = payload.get("aud")
    if aud == READER_AUDIENCE or (isinstance(aud, list) and READER_AUDIENCE in aud):
        raise credentials_exception
    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    # Tokens signed before this change have no `ver` claim -> treat as 0; the
    # user's counter is also 0 until a password change, so they still work.
    # After a password change the counter bumps and every older token is rejected.
    token_version = payload.get("ver", 0)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or token_version != (user.token_version or 0):
        raise credentials_exception
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Any authenticated admin-tier account (superuser or editor).

    Guards content-moderation endpoints (posts/comments/categories/tags/upload).
    Privileged endpoints (users/export/batch) use get_current_superuser.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user


def get_current_superuser(current_user: User = Depends(get_current_admin)) -> User:
    """Superuser-only guard for privileged admin endpoints (users/export/batch)."""
    if current_user.role != ROLE_SUPERUSER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user


# Reader auth: a distinct bearer-credential scheme so OpenAPI/docs and the
# Swagger "Authorize" button keep reader and admin scopes apart. The tokenUrl
# points at the reader login route (documentation only — bearer tokens are used).
reader_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/reader/login")
# auto_error=False variant for endpoints where a reader token is optional
# (e.g. public comment creation): a missing header yields None instead of a 401.
optional_reader_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/reader/login",
    auto_error=False,
)


def get_current_reader(
    token: str = Depends(reader_oauth2_scheme),
    db: Session = Depends(get_db),
) -> ReaderAccount:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    # Decode with the reader audience: a token carrying aud=x-blog-reader must
    # match it, and a legacy admin token (no aud claim) fails PyJWT's
    # "audience claim required" — so admin credentials can never authenticate
    # as a reader.
    payload = _decode_payload(token, audience=READER_AUDIENCE)
    if payload is None:
        raise credentials_exception
    # This guard only ever accepts reader-scoped tokens (DEC-059, TASK-131).
    # Admin tokens carry no aud=x-blog-reader, so they can't authenticate here.
    if payload.get("aud") != READER_AUDIENCE:
        raise credentials_exception
    reader_id = payload.get("sub")
    if reader_id is None:
        raise credentials_exception

    token_version = payload.get("ver", 0)
    reader = db.query(ReaderAccount).filter(ReaderAccount.id == reader_id).first()
    if reader is None or token_version != (reader.token_version or 0):
        raise credentials_exception
    # Account moderation (DEC-194, TASK-214, ISS-116): a deactivated reader is
    # rejected even with a valid token. 403 (not 401) so a client can tell the
    # credential was valid but the account was disabled. Every live JWT is
    # additionally killed at deactivation time via token_version bump.
    if reader.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account deactivated",
        )
    return reader


def get_optional_reader(
    token: str | None = Depends(optional_reader_oauth2_scheme),
    db: Session = Depends(get_db),
) -> ReaderAccount | None:
    """Resolve the reader JWT if present and valid, else None.

    For endpoints that work for anonymous users too (e.g. public comment
    creation): a missing/invalid reader token just yields no reader identity
    rather than a 401. The token is strictly reader-scoped (aud=x-blog-reader,
    enforced by get_current_reader), so an admin token never resolves here
    either. (DEC-062, TASK-135)
    """
    if not token:
        return None
    try:
        # Reuse get_current_reader's decode + audience + version checks (passing
        # the token/db positionally bypasses the Depends defaults).
        return get_current_reader(token, db)
    except HTTPException:
        return None

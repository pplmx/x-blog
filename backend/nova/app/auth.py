import os
import warnings
from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.config import is_development
from app.database import Base, get_db

DEV_SECRET_KEY = "x-blog-secret-key-dev-only"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "7"))


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


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password: Mapped[str] = mapped_column(String(200), nullable=False)
    is_superuser: Mapped[bool | None] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class TokenData(BaseModel):
    user_id: int | None = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.now(UTC) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode["exp"] = expire
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str = payload.get("sub")
        user_id = int(user_id_str) if user_id_str else None
        if user_id is None:
            raise credentials_exception
        token_data = TokenData(user_id=user_id)
    except JWTError, TypeError, ValueError:
        # JWTError: bad signature/expired token; TypeError/ValueError: malformed
        # `sub` claim (e.g. non-numeric). Both are authentication failures → 401.
        raise credentials_exception

    user = db.query(User).filter(User.id == token_data.user_id).first()
    if user is None:
        raise credentials_exception
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user

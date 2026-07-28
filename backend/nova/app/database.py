from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

is_sqlite = settings.database_url.startswith("sqlite")

# SQLite requires check_same_thread=False; PostgreSQL does not support it.
_connect_args = {"check_same_thread": False} if is_sqlite else {}

_pool_opts = {}
if not is_sqlite:
    _pool_opts = {
        "pool_size": int(getattr(settings, "pool_size", 10)),
        "max_overflow": int(getattr(settings, "pool_overflow", 20)),
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }

engine = create_engine(settings.database_url, connect_args=_connect_args, **_pool_opts)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

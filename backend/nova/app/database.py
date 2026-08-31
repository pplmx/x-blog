from sqlalchemy import create_engine, event
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

# Timezone contract: every timestamp column is naive UTC ("timestamp without
# time zone" storing the UTC wall clock — see the digest domain notes and the
# `naive publish_at/now_naive` convention across crud). Model defaults use
# aware `datetime.now(UTC)`, and psycopg2 adapts an aware value into the
# SESSION TimeZone before storing it in a naive column — so on a server whose
# TimeZone is not UTC (e.g. the dev host's Asia/Shanghai) that aware default is
# silently stored as UTC+offset, skewing every created_at/updated_at vs the
# naive `utc_now_naive()` values the app writes and compares. Pin the session
# to UTC so aware→naive storage is the UTC wall clock on every deployment,
# independent of the server's configured TimeZone. (SQLite has no tz concept;
# its FKs pragma is set up in tests' conftest.)
if not is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_utc_session(dbapi_connection, _connection_record):
        with dbapi_connection.cursor() as cur:
            cur.execute("SET TIME ZONE 'UTC'")


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

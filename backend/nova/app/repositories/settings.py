"""Site settings key/values and boolean helpers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app import models


async def get_site_setting(db: AsyncSession, key: str) -> str | None:
    """Read a persisted site setting by key, or None if it has never been set."""
    row = await db.get(models.SiteSetting, key)
    return row.value if row is not None else None


async def upsert_site_setting(db: AsyncSession, key: str, value: str) -> models.SiteSetting:
    """Persist (insert or overwrite) a site setting, returning the row."""
    row = await db.get(models.SiteSetting, key)
    if row is None:
        row = models.SiteSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    await db.commit()
    await db.refresh(row)
    return row


async def boolean_setting(db: AsyncSession, key: str, env_fallback: bool) -> bool:
    """Resolve a boolean site setting: persisted value wins, else env fallback.

    ``env_fallback`` is the operator's env default (e.g. the
    AUTO_APPROVE_READER_COMMENTS flag); a persisted row overrides it so the admin
    can flip policy at runtime (DEC-100, TASK-162)."""
    raw = await get_site_setting(db, key)
    if raw is None:
        return env_fallback
    return raw.strip().lower() in {"1", "true", "yes", "on"}

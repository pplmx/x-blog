"""Date-bound parsing shared by the filter/export routes.

``<input type="date">`` always submits ``YYYY-MM-DD`` (no time part). If a
DateTime param parsed that directly it becomes midnight, so a ``date_to`` of
the day the user picked would silently exclude every row whose timestamp
lands later that same day (created_at <= day-00:00). These helpers widen a
bare-date to-bound to end-of-day so "up to Sep 1" means the whole of Sep 1,
and normalize everything to naive UTC for the timestamp columns.
"""

import re
from datetime import UTC, datetime

from fastapi import HTTPException

_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def inclusive_end_of_day(value: str) -> str:
    """Return an ISO string widened to 23:59:59.999999 if ``value`` is a bare date.

    A full ISO datetime (with a time part) passes through unchanged; a
    date-only bound (what date inputs submit) becomes the end of that day so
    an exclusive-midnight comparison cannot drop the whole chosen day.
    """
    if _DATE_ONLY_RE.match(value):
        return f"{value}T23:59:59.999999"
    return value


def parse_bound(value: str | None) -> datetime | None:
    """Parse a raw client-supplied created_at bound to naive UTC.

    The created_at columns are naive UTC; comparing a tz-aware bind against a
    naive timestamp column errors on PostgreSQL, so normalize at the boundary
    (an aware ISO string becomes naive UTC, a bare date stays midnight naive).
    Malformed input is a 422, matching the FastAPI DateTime parsing this replaces.
    """
    if value is None or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date filter") from None
    if parsed.tzinfo is not None:
        return parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed

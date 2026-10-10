"""
Newsletter service: subscriber-list query helpers for the newsletter feature.
"""

from __future__ import annotations

from app.repositories._base import (
    escape_like_pattern,
    utc_now_naive,
)

__all__ = [
    "escape_like_pattern",
    "utc_now_naive",
]

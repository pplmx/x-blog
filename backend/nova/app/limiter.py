"""Shared rate limiter instance for the application."""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address

# Rate limit per minute, configurable via environment
RATE_LIMIT_READ = os.getenv("RATE_LIMIT_READ_PER_MINUTE", "120")
RATE_LIMIT_WRITE = os.getenv("RATE_LIMIT_WRITE_PER_MINUTE", "30")
RATE_LIMIT_AUTH = os.getenv("RATE_LIMIT_AUTH_PER_MINUTE", "10")
RATE_LIMIT_SEARCH = os.getenv("RATE_LIMIT_SEARCH_PER_MINUTE", "60")
RATE_LIMIT_COMMENT = os.getenv("RATE_LIMIT_COMMENT_PER_MINUTE", "20")
RATE_LIMIT_EXPORT = os.getenv("RATE_LIMIT_EXPORT_PER_MINUTE", "10")

# Shared limiter instance — import this in routers and main.py
limiter = Limiter(key_func=get_remote_address)

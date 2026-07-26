"""Sentry error tracking and performance monitoring for backend."""

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration


def setup_sentry() -> None:
    """Initialize Sentry with FastAPI and SQLAlchemy integrations.

    Only activates in production when SENTRY_DSN is configured.
    """
    dsn = getattr(__import__("app.config", fromlist=["settings"]).settings, "sentry_dsn", None)

    if not dsn:
        return

    sentry_sdk.init(
        dsn=dsn,
        environment="production",
        traces_sample_rate=0.1,
        integrations=[
            FastApiIntegration(transaction_style="url"),
            SqlalchemyIntegration(),
        ],
        send_default_pii=False,
        max_request_body_size="always",
        max_response_body_size="never",
    )

"""SMTP notification email delivery (DEC-197, TASK-217).

The reader notification stack (Web Push DEC-055 + durable inbox DEC-160 +
per-kind opt-outs DEC-171, tag-follow DEC-195) only reaches a reader while the
site is open or the browser grants push. Email is the off-site channel: a
reader who opts in for a kind gets a plain-text + HTML email to their
registered address whenever that event fires (new post in a followed
series/category/tag, a reply to their comment, a comment on a followed thread).

Configuration is lazy (per-call, not at import) exactly like webpush.py so
tests can vary it and a deployment without an ``SMTP_HOST`` simply never emails
(fails closed). Delivery is strictly best-effort: a notification path must
never break the triggering write (publish/comment) because mail failed, so
``dispatch_notification_emails`` never raises.

Email is a per-kind *opt-in* independent of the push/inbox toggles: a missing
prefs row reads as email-off (the email_* columns default false), so no reader
receives mail unless they explicitly switched a kind's email on. Subjects and
bodies reuse the exact zh strings from the durable inbox rows so a reader sees
a consistent story across channels. Every reader-controlled value (titles,
post titles) is HTML-escaped in the HTML part.
"""

import html
import os
import smtplib
import ssl
from collections.abc import Iterable
from dataclasses import dataclass
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app import models
from app.auth import ReaderAccount

# Event kind -> email-pref column. series_new_part is a label refinement of
# new_post (ISS-114/DEC-181) and shares its email pref, mirroring how the
# push/inbox side gates both under the new_post opt-out.
_EMAIL_PREF_FOR_KIND: dict[str, str] = {
    "new_post": "email_new_post",
    "series_new_part": "email_new_post",
    "reply": "email_reply",
    "thread_comment": "email_thread_comment",
}


@dataclass(frozen=True)
class EmailItem:
    """One email to enqueue. ``kind`` selects the reader's email pref; the
    title/body/url are the same values the durable inbox row carries, so the
    channels agree."""

    reader_id: int
    kind: str
    title: str
    body: str
    url: str


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def is_email_configured() -> bool:
    """True when an SMTP host is configured. Missing config fails closed: no
    SMTP host -> the fan-out skips email entirely (best effort, silent)."""
    return bool(_env("SMTP_HOST"))


def email_channel_enabled(pref: models.ReaderNotificationPref | None, kind: str) -> bool:
    """True when the reader opted into email for ``kind``.

    A missing prefs row reads False — the email_* columns default false, so
    email is strictly opt-in (unlike the all-on push/inbox prefs, where a
    missing row reads enabled).
    """
    col = _EMAIL_PREF_FOR_KIND.get(kind)
    if pref is None or col is None:
        return False
    return bool(getattr(pref, col, False))


def dispatch_notification_emails(db: Session, items: Iterable[EmailItem], logger) -> int:
    """Send the best-effort email copy of a notification fan-out.

    Gated on is_email_configured() and each reader's per-kind email opt-in plus
    a real registered address. Opens one SMTP session for all recipients.
    Returns how many messages SMTP accepted; never raises (callers are write
    paths that must not break on mail failure).
    """
    if not is_email_configured():
        return 0
    items = list(items)
    if not items:
        return 0
    try:
        by_reader: dict[int, list[EmailItem]] = {}
        for item in items:
            by_reader.setdefault(item.reader_id, []).append(item)
        if not by_reader:
            return 0

        # Email prefs + registered addresses in two batched queries (no N+1).
        # ReaderAccount keys readers by its own primary key (id), which is the
        # same value ReaderNotificationPref.reader_id stores.
        prefs = {
            row.reader_id: row
            for row in db.query(models.ReaderNotificationPref)
            .filter(models.ReaderNotificationPref.reader_id.in_(by_reader.keys()))
            .all()
        }
        addr_by_reader = {
            row[0]: row[1]
            for row in db.query(ReaderAccount.id, ReaderAccount.email)
            .filter(ReaderAccount.id.in_(by_reader.keys()))
            .all()
        }

        recipients: list[tuple[str, EmailItem]] = []
        for reader_id, addr in addr_by_reader.items():
            if not addr:
                continue
            for item in by_reader[reader_id]:
                if email_channel_enabled(prefs.get(reader_id), item.kind):
                    recipients.append((addr, item))
        if not recipients:
            return 0
        return _send_via_smtp(recipients)
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        logger.exception("notification email dispatch failed")
        return 0


def _send_via_smtp(recipients: list[tuple[str, EmailItem]]) -> int:
    """Deliver every message over one SMTP session (STARTTLS when configured)."""
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT") or 587)
    user = _env("SMTP_USER")
    password = _env("SMTP_PASSWORD")
    from_addr = _env("SMTP_FROM") or "no-reply@localhost"
    starttls = _env("SMTP_STARTTLS").lower() != "false"
    base_url = _env("SITE_URL") or "http://localhost:3000"

    with smtplib.SMTP(host, port, timeout=15) as server:
        if starttls:
            server.starttls(context=ssl.create_default_context())
        if user:
            server.login(user, password)
        sent = 0
        for addr, item in recipients:
            server.send_message(_build_message(item, from_addr, addr, base_url))
            sent += 1
        return sent


def _build_message(item: EmailItem, from_addr: str, to_addr: str, base_url: str) -> EmailMessage:
    """Compose a text + HTML message. ``url`` is an in-app relative deep link
    (as the inbox stores it); it becomes absolute here so email readers can follow it."""
    link = f"{base_url.rstrip('/')}{item.url}" if item.url else base_url
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = item.title
    msg.set_content(f"{item.title}\n\n{item.body}\n\n{link}")
    msg.add_alternative(
        f"<p><strong>{html.escape(item.title)}</strong></p>"
        f"<p>{html.escape(item.body)}</p>"
        f'<p><a href="{html.escape(link, quote=True)}">查看详情</a></p>',
        subtype="html",
    )
    return msg

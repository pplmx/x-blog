"""Weekly email digest (DEC-201, TASK-222).

The per-event email channel (DEC-197, TASK-217) tells an opted-in reader about
one new post / reply / thread comment as it happens. The weekly digest is the
complementary *periodic* surface: a reader who opts into ``email_weekly_digest``
gets one aggregated HTML email per week listing every public post newly
published in their digest window (the max of their last digest and the rolling
7 days — so a backlog never floods them and a missed digest is bounded).

Design contract (recorded in DEC-201):

- Site-wide, not follow-scoped: the digest is re-discovery of the whole blog;
  per-event mail already covers a reader's follows. Returns posts newest-first.
- Off by default (``email_weekly_digest`` column, server_default false) and
  independent of the per-event ``email_*`` toggles: a reader who wants only the
  weekly email turns this one on.
- Idempotency: ``digest_sent_at`` (naive UTC) is stamped on each reader only
  AFTER SMTP accepts their message, so a failed send leaves the window open for
  retry. A concurrent crons are guarded by a Postgres advisory lock
  (best-effort on connectless fallbacks); two workers racing would at worst
  double-message one reader — a weekly duplicate, never a lost window.
- Best-effort like the fan-out: SMTP down, config missing, or a render error
  never raises — the job reports and returns.
- One SMTP session for all recipients, via ``emailer.send_messages`` so digest
  mail always travels the same single configured path as the fan-out.
- Every reader-controlled value (titles, display names) is HTML-escaped in the
  HTML part; the unsubscribe button points at the prefs page.

Trigger surfaces: the admin ``POST /api/admin/digests/send-weekly`` endpoint
(operator "send now", also the e2e/verification lever) and the CLI
``python -m app.digest_cli send-weekly`` for a cron. No in-process timer — the
deploy has no worker and a multi-process timer is exactly the double-send risk
the advisory lock guards against.
"""

import html
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from sqlalchemy import and_, or_, text
from sqlalchemy.orm import Session

from app import models
from app.auth import ReaderAccount
from app.crud import effective_publish_ts, utc_now_naive
from app.emailer import _env, is_email_configured, send_messages
from app.middleware import get_logger

#: Rolling window: a reader never receives more than the last 7 days of posts,
#: even if they missed several digests.
WEEKLY_WINDOW_DAYS = 7
#: Postgres advisory-lock key for the digest job (bytes "xBLG" as a bigint).
#: Arbitrary but stable — the lock is a job-level "someone else is running" flag.
_DIGEST_LOCK_KEY = 0x78624C47


def _dialect_name(db: Session) -> str:
    """The bound engine's dialect name (``sqlite`` / ``postgresql`` / ...)."""
    return db.get_bind().dialect.name


def _effective_publish_ts(post: models.Post, now_naive: datetime) -> datetime:
    """The timestamp that puts a post on the "published when" line: its
    scheduled publish_at when set, else its created_at. Shared semantic with
    the RSS/Atom feeds via ``crud.effective_publish_ts`` (RIL ISS-264); this
    thin wrapper pins the ``now`` fallback where the digest code expects it
    naive."""
    return effective_publish_ts(post, fallback=now_naive)


def collect_digest_posts(db: Session, now_naive: datetime) -> list[models.Post]:
    """Every public post whose effective publish time falls in the rolling
    sub-window most recent digest could start from (last ``WEEKLY_WINDOW_DAYS``
    days), newest first. Per-recipient tightening (a reader with a more recent
    ``digest_sent_at``) happens in ``send_weekly_digest`` over this superset —
    one query, no N+1.

    The SQL predicate keeps ``publish_at`` comparisons naive (it is always
    written naive) and bounds the ``publish_at``-less branch on ``created_at``:
    the ORM default stores AWARE ``datetime.now(UTC)``, so on SQLite the value
    carries a ``+00:00`` suffix (sqlite3 adapter) while on Postgres the column
    is a naive timestamp — bind the lower bound in the matching form per
    dialect. The exact intra-day filter for unscheduled posts happens in Python
    via ``_effective_publish_ts``."""
    window_start = now_naive - timedelta(days=WEEKLY_WINDOW_DAYS)
    scheduled_in_window = and_(
        models.Post.publish_at.isnot(None),
        models.Post.publish_at >= window_start,
        models.Post.publish_at <= now_naive,
    )
    # Unscheduled posts: created_at is never in the future, so only the lower
    # bound is needed; SQL bounds the fetch, Python filters exactly. On SQLite
    # created_at was stored with its UTC offset (aware ORM default bound by the
    # sqlite3 adapter); match format so string ordering stays aligned.
    created_lo: datetime = window_start.replace(tzinfo=UTC) if _dialect_name(db) == "sqlite" else window_start
    unscheduled_recent = and_(
        models.Post.publish_at.is_(None),
        models.Post.created_at >= created_lo,
    )
    rows = (
        db.query(models.Post)
        .filter(models.Post.published.is_(True), or_(scheduled_in_window, unscheduled_recent))
        .all()
    )
    kept = [p for p in rows if _effective_publish_ts(p, now_naive) >= window_start]
    kept.sort(key=lambda p: _effective_publish_ts(p, now_naive), reverse=True)
    return kept


def digest_window_start(pref: models.ReaderNotificationPref, now_naive: datetime) -> datetime:
    """Where a reader's digest window begins: their last digest if one was ever
    sent, else the rolling 7-day cut. The outcome is always "bounded to the
    last week"."""

    if pref.digest_sent_at is None:
        roll = now_naive - timedelta(days=WEEKLY_WINDOW_DAYS)
        return roll
    return max(pref.digest_sent_at, now_naive - timedelta(days=WEEKLY_WINDOW_DAYS))


def collect_digest_recipients(
    db: Session, now_naive: datetime
) -> list[tuple[models.ReaderNotificationPref, ReaderAccount, datetime]]:
    """Opted-in, active readers with a registered address, each with their
    window start. A missing prefs row reads as no digest (off by default)."""
    rows = (
        db.query(models.ReaderNotificationPref, ReaderAccount)
        .join(ReaderAccount, ReaderAccount.id == models.ReaderNotificationPref.reader_id)
        .filter(
            models.ReaderNotificationPref.email_weekly_digest.is_(True),
            ReaderAccount.is_active.is_(True),
        )
        .all()
    )
    return [(pref, acct, digest_window_start(pref, now_naive)) for pref, acct in rows]


def _format_date(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d")


def build_digest_message(
    *,
    from_addr: str,
    to_email: str,
    display_name: str | None,
    posts: Iterable[models.Post],
    base_url: str,
    window_start: datetime,
    now_naive: datetime,
) -> EmailMessage:
    """One aggregated digest: text + HTML parts, zh copy consistent with the
    per-event emailer (the backend has no i18n; the site default locale is zh)."""
    posts = list(posts)
    base = base_url.rstrip("/")
    # display_name is user-controlled: escape it ONCE here. The text part uses
    # this exact string; the HTML part must NOT re-escape greeting, or the
    # entity becomes double-escaped (A&B -> A&amp;amp;B, rendered literally).
    greeting = f"{html.escape(display_name or '')}，" if display_name else "你好，"
    subject = f"本周精选：{len(posts)} 篇新文章"

    lines = []
    for post in posts:
        ts = _effective_publish_ts(post, now_naive)
        date = _format_date(ts)
        cat = post.category.name if post.category else ""
        label = f"{cat} · {date}" if cat else date
        excerpt = (post.excerpt or "").strip()
        lines.append(f"- {post.title}（{label}）{base}/posts/{post.slug}")
        if excerpt:
            lines.append(f"    {excerpt}")

    text = (
        f"{greeting}\n"
        f"本周精选（{_format_date(window_start)} ~ {_format_date(now_naive)}）共 {len(posts)} 篇新文章：\n\n"
        + "\n".join(lines)
        + "\n\n—\n管理或关闭每周精选："
        f"{base}/notifications"
    )

    items = []
    for post in posts:
        ts = _effective_publish_ts(post, now_naive)
        date = _format_date(ts)
        cat = post.category.name if post.category else ""
        label = f"{html.escape(cat)} · {date}" if cat else date
        excerpt = (post.excerpt or "").strip()
        item = (
            f'<li><a href="{base}/posts/{html.escape(post.slug, quote=True)}">'
            f'{html.escape(post.title)}</a> <span style="color:#888">({label})</span>'
        )
        if excerpt:
            item += f'<p style="margin:4px 0 12px;color:#555">{html.escape(excerpt)}</p>'
        items.append(item + "</li>")

    rows = "\n".join(items)
    html_body = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
        'max-width:640px;margin:0 auto;padding:24px">'
        f'<h1 style="font-size:20px">本周精选 · {len(posts)} 篇新文章</h1>'
        f"<p>{greeting}这是过去一周发布的新文章"
        f"（{_format_date(window_start)} ~ {_format_date(now_naive)}）：</p>"
        f'<ol style="line-height:1.6">{rows}</ol>'
        f'<p style="color:#888;font-size:13px">不想再收到每周精选？'
        f'<a href="{base}/notifications">在通知偏好中关闭</a>。</p>'
        "</div>"
    )

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    return msg


def _acquire_digest_lock(db: Session) -> bool:
    """True when this process may run the job. Non-Postgres backends (SQLite
    tests) have no advisory locks and are single-process by construction."""
    if _dialect_name(db) != "postgresql":
        return True
    return bool(db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _DIGEST_LOCK_KEY}).scalar())


def _release_digest_lock(db: Session) -> None:
    if _dialect_name(db) != "postgresql":
        return
    db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _DIGEST_LOCK_KEY})


def send_weekly_digest(db: Session, *, now_naive: datetime | None = None, logger=None, dry_run: bool = False) -> dict:
    """Run the weekly digest job: collect eligible posters for each opted-in
    reader, render, deliver over one SMTP session, then stamp ``digest_sent_at``
    on exactly the readers whose mail went out. ``dry_run=True`` builds but
    neither sends nor stamps — the report reflects exactly who/what would go
    out. Returns a summary dict and never raises (mail is best-effort like
    ``emailer.dispatch_notification_emails``).

    Summary keys: ``locked`` (another worker held the advisory lock),
    ``readers`` (delivered), ``emails_sent`` (SMTP-accepted), ``posts``
    (distinct posts eligible in the rolling window), ``skipped`` (opted-in
    readers with no posts in window or no registered address), ``reason``
    (machine-readable skip/error label when nothing was delivered; absent on a
    normal empty-delivery)."""
    log = logger or get_logger("digest")
    now = now_naive or utc_now_naive()
    if not _acquire_digest_lock(db):
        log.info("weekly_digest_locked")
        return {"locked": True, "readers": 0, "emails_sent": 0, "posts": 0, "skipped": 0, "reason": "locked"}
    try:
        posts = collect_digest_posts(db, now)
        deliveries: list[tuple[models.ReaderNotificationPref, ReaderAccount, datetime, list[models.Post]]] = []
        skipped = 0
        for pref, acct, window_start in collect_digest_recipients(db, now):
            if not acct.email:
                skipped += 1
                continue
            eligible = [p for p in posts if _effective_publish_ts(p, now) >= window_start]
            if not eligible:
                skipped += 1
                continue
            deliveries.append((pref, acct, window_start, eligible))

        if dry_run:
            # No SMTP, no stamping — report exactly who/what would go out
            # (independent of SMTP config; it's a preview, even when nobody is
            # eligible today).
            return {
                "locked": False,
                "dry_run": True,
                "readers": len(deliveries),
                "emails_sent": 0,
                "posts": len(posts),
                "skipped": skipped,
            }

        if not deliveries:
            return {
                "locked": False,
                "readers": 0,
                "emails_sent": 0,
                "posts": len(posts),
                "skipped": skipped,
                "reason": "no_recipients",
            }

        base_url = _env("SITE_URL") or "http://localhost:3000"
        from_addr = _env("SMTP_FROM") or "no-reply@localhost"
        built: list[tuple[models.ReaderNotificationPref, EmailMessage]] = []
        for pref, acct, window_start, eligible in deliveries:
            msg = build_digest_message(
                from_addr=from_addr,
                to_email=acct.email,
                display_name=acct.display_name,
                posts=eligible,
                base_url=base_url,
                window_start=window_start,
                now_naive=now,
            )
            built.append((pref, msg))

        if not is_email_configured():
            return {
                "locked": False,
                "readers": 0,
                "emails_sent": 0,
                "posts": len(posts),
                "skipped": len(deliveries),
                "reason": "smtp_not_configured",
            }

        try:
            sent = send_messages([msg for _, msg in built])
        except Exception:  # noqa: BLE001 — best effort, retryable
            log.exception("weekly digest SMTP delivery failed")
            return {
                "locked": False,
                "readers": 0,
                "emails_sent": 0,
                "posts": len(posts),
                "skipped": len(deliveries),
                "reason": "smtp_error",
            }

        # Stamp idempotency ONLY on delivered readers, after SMTP accepted.
        for pref, _msg in built:
            pref.digest_sent_at = now
        db.commit()
        return {
            "locked": False,
            "readers": len(deliveries),
            "emails_sent": sent,
            "posts": len(posts),
            "skipped": skipped,
        }
    finally:
        _release_digest_lock(db)

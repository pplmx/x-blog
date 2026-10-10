"""Weekly email digest tests (DEC-201, TASK-222).

The digest is the periodic complement to the per-event email channel: one
aggregated email per opted-in reader summarizing the public posts newly
published in their window (max of last digest and the rolling 7 days). This
suite covers the window math, the public-post collection (in-window included,
old / unpublished / future-scheduled excluded), recipient gating (opt-in plus
active account plus registered address), the HTML/text message builder
(escape + absolute links + unsubscribe), and `send_weekly_digest` end-to-end
against the same fake SMTP sink as the email channel — idempotency stamping,
dry-run, SMTP-down retry, and the admin endpoint's auth/dry-run contract.

The PostgreSQL-specific paths (advisory-lock contention + the naive-created_at
storage branch) are covered by the `@skip_pg` tests at the bottom — they run
only when ``TEST_DATABASE_URL`` points at a scratch PostgreSQL DB (same
convention as test_postgres_connection.py; that module drops/recreates all
tables, so never point it at a real database).
"""

import os
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app import models
from app import repositories as crud
from app.auth import ReaderAccount
from app.database import Base
from app.digest import (
    WEEKLY_WINDOW_DAYS,
    _digest_lock_key,
    build_digest_message,
    collect_digest_posts,
    collect_digest_recipients,
    digest_window_start,
    send_weekly_digest,
)


class _FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording delivered messages (mirrors the
    emailer suite's sink so both channels assert identically)."""

    instances: list[_FakeSMTP] = []
    sent: list[EmailMessage] = []
    fail_on_send: bool = False
    # Recipients that get an SMTPRecipientsRefused per-message rejection — used
    # to exercise the digest's partial-delivery idempotency (ISS-280): a full
    # mailbox drops that reader only, not the whole batch.
    refuse_to: set[str] | None = None

    def __init__(self, host: str, port: int, timeout: float | None = None):
        self.host = host
        self.port = port
        _FakeSMTP.instances.append(self)

    def __enter__(self) -> _FakeSMTP:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def starttls(self, context: object = None) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        return None

    def send_message(self, msg: EmailMessage) -> None:
        if _FakeSMTP.fail_on_send:
            raise OSError("smtp down")
        if _FakeSMTP.refuse_to and msg["To"] in _FakeSMTP.refuse_to:
            raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"mailbox full")})
        _FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp_sink(monkeypatch: pytest.MonkeyPatch) -> type[_FakeSMTP]:
    """Point SMTP at the fake sink; both digest tests and the admin endpoint
    send through ``app.emailer.send_messages``, so patch that module's symbol."""
    _FakeSMTP.instances = []
    _FakeSMTP.sent = []
    _FakeSMTP.fail_on_send = False
    _FakeSMTP.refuse_to = None
    monkeypatch.setattr("app.emailer.smtplib.SMTP", _FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return _FakeSMTP


async def _reader(db, email: str, *, active: bool = True, digest: bool = True, display_name: str | None = None) -> int:
    row = ReaderAccount(email=email, password="x", display_name=display_name or email.split("@")[0], is_active=active)
    db.add(row)
    await db.flush()
    db.add(models.ReaderNotificationPref(reader_id=row.id, email_weekly_digest=digest))
    await db.flush()
    return row.id


async def _make_post(
    db,
    title: str,
    slug: str,
    *,
    published: bool = True,
    publish_at: datetime | None = None,
    created_at: datetime | None = None,
) -> models.Post:
    post = models.Post(
        title=title, slug=slug, content="body", excerpt="excerpt", published=published, publish_at=publish_at
    )
    if created_at is not None:
        post.created_at = created_at
    db.add(post)
    await db.flush()
    return post


class TestWindowMath:
    async def test_first_time_is_rolling_seven_days(self):
        now = datetime(2026, 8, 28, 12, 0, 0)
        pref = models.ReaderNotificationPref(reader_id=1)
        assert digest_window_start(pref, now) == now - timedelta(days=WEEKLY_WINDOW_DAYS)

    async def test_bounded_by_last_digest_but_never_older_than_week(self):
        now = datetime(2026, 8, 28, 12, 0, 0)
        recent = now - timedelta(days=2)
        pref = models.ReaderNotificationPref(reader_id=1, digest_sent_at=recent)
        assert digest_window_start(pref, now) == recent
        ancient = now - timedelta(days=40)
        pref2 = models.ReaderNotificationPref(reader_id=2, digest_sent_at=ancient)
        assert digest_window_start(pref2, now) == now - timedelta(days=WEEKLY_WINDOW_DAYS)


class TestCollectPosts:
    async def test_includes_window_posts_excludes_old_unpublished_and_future(self, db_session):
        now = crud.utc_now_naive()
        await _make_post(db_session, "This week", "in-window")  # created_at = now
        await _make_post(
            db_session,
            "Old scheduled",
            "old-scheduled",
            publish_at=now - timedelta(days=10),
        )
        await _make_post(
            db_session,
            "Old unscheduled",
            "old-unscheduled",
            created_at=now - timedelta(days=20),
        )
        await _make_post(db_session, "Draft", "draft", published=False)
        await _make_post(
            db_session,
            "Future scheduled",
            "future",
            publish_at=now + timedelta(days=1),
        )
        await db_session.commit()

        posts = await collect_digest_posts(db_session, now)
        slugs = {p.slug for p in posts}
        assert slugs == {"in-window"}


class TestCollectRecipients:
    async def test_opt_in_active_with_email_only(self, db_session):
        a = await _reader(db_session, "a@example.com")
        await _reader(db_session, "b@example.com", digest=False)  # not opted in
        await _reader(db_session, "in@example.com", active=False)  # deactivated
        await db_session.commit()

        rid_pair = await collect_digest_recipients(db_session, crud.utc_now_naive())
        assert {acct.id for _, acct, _ in rid_pair} == {a}


class TestSend:
    async def test_delivers_to_opted_in_reader_and_stamps(self, db_session, smtp_sink):
        rid = await _reader(db_session, "digest@example.com")
        await _make_post(db_session, "本周文章", "week-post")
        await db_session.commit()

        summary = await send_weekly_digest(db_session)
        assert summary["readers"] == 1
        assert summary["emails_sent"] == 1
        assert summary["posts"] == 1
        assert summary["skipped"] == 0
        assert len(smtp_sink.sent) == 1
        msg = smtp_sink.sent[0]
        assert msg["To"] == "digest@example.com"
        assert "本周精选" in msg["Subject"]
        # Idempotency stamper landed.
        pref = await db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is not None

    async def test_skips_reader_with_no_new_posts(self, db_session, smtp_sink):
        rid = await _reader(db_session, "quiet@example.com")
        await db_session.commit()
        summary = await send_weekly_digest(db_session)
        assert summary["readers"] == 0
        assert summary["emails_sent"] == 0
        assert summary["reason"] == "no_recipients"
        assert smtp_sink.sent == []
        pref = await db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None

    async def test_no_double_send_within_window(self, db_session, smtp_sink):
        rid = await _reader(db_session, "repeat@example.com")
        await _make_post(db_session, "Once", "once")
        await db_session.commit()
        first = await send_weekly_digest(db_session)
        assert first["readers"] == 1
        second = await send_weekly_digest(db_session)
        assert second["readers"] == 0
        assert len(smtp_sink.sent) == 1
        pref = await db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is not None

    async def test_smtp_down_leaves_window_open_for_retry(self, db_session, smtp_sink):
        rid = await _reader(db_session, "retry@example.com")
        await _make_post(db_session, "Retry me", "retry")
        await db_session.commit()
        smtp_sink.fail_on_send = True
        summary = await send_weekly_digest(db_session)
        assert summary["reason"] == "smtp_error"
        pref = await db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None

    async def test_refused_recipient_not_stamped_but_rest_delivered(self, db_session, smtp_sink):
        # A full/dead mailbox (SMTPRecipientsRefused) must drop ONLY that
        # reader: the batch continues, and only the accepted message stamps
        # digest_sent_at — so a partial delivery never re-mails the reader who
        # already got theirs on the next run (RIL ISS-280).
        ok_rid = await _reader(db_session, "ok@example.com")
        bad_rid = await _reader(db_session, "full@example.com")
        await _make_post(db_session, "本周文章", "week-post")
        await db_session.commit()
        smtp_sink.refuse_to = {"full@example.com"}

        summary = await send_weekly_digest(db_session)
        assert summary["readers"] == 2
        assert summary["emails_sent"] == 1  # only the accepted message
        assert {m["To"] for m in smtp_sink.sent} == {"ok@example.com"}

        ok_pref = await db_session.get(models.ReaderNotificationPref, ok_rid)
        bad_pref = await db_session.get(models.ReaderNotificationPref, bad_rid)
        assert ok_pref.digest_sent_at is not None
        assert bad_pref.digest_sent_at is None

        # Next run: the refused reader's window is still open (re-sent), the
        # delivered reader is skipped — no duplicate for anyone.
        smtp_sink.refuse_to = None
        second = await send_weekly_digest(db_session)
        assert second["emails_sent"] == 1
        assert {m["To"] for m in smtp_sink.sent[1:]} == {"full@example.com"}

    async def test_dry_run_sends_nothing_and_stamps_nothing(self, db_session, smtp_sink):
        rid = await _reader(db_session, "preview@example.com")
        await _make_post(db_session, "Preview", "preview")
        await db_session.commit()
        summary = await send_weekly_digest(db_session, dry_run=True)
        assert summary["dry_run"] is True
        assert summary["readers"] == 1
        assert summary["emails_sent"] == 0
        assert smtp_sink.sent == []
        pref = await db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None

    async def test_returns_smtp_not_configured_without_host(self, db_session, monkeypatch):
        rid = await _reader(db_session, "noconf@example.com")
        await _make_post(db_session, "Noconf", "noconf")
        await db_session.commit()
        monkeypatch.delenv("SMTP_HOST", raising=False)
        summary = await send_weekly_digest(db_session)
        assert summary["reason"] == "smtp_not_configured"
        assert summary["emails_sent"] == 0
        pref = await db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None


async def _newsletter_subscriber(
    db,
    email: str,
    *,
    confirmed: bool = True,
    digest_weekly: bool = True,
) -> int:
    from secrets import token_urlsafe

    row = models.NewsletterSubscriber(
        email=email,
        token=token_urlsafe(32),
        is_confirmed=confirmed,
        digest_weekly=digest_weekly,
    )
    db.add(row)
    await db.flush()
    return row.id


def _plain_text(msg: EmailMessage) -> str:
    """Text/plain payload of a multipart message (or the whole message)."""
    parts = [p for p in msg.walk() if p.get_content_type() == "text/plain"]
    if not parts:
        return str(msg.get_payload()) if not msg.is_multipart() else ""
    return "\n".join(p.get_payload(decode=True).decode("utf-8", "replace") for p in parts)


class TestNewsletterDigest:
    """The guest side of the weekly digest (DEC-355, TASK-403): a CONFIRMED
    newsletter subscriber who opted into the weekly digest is collected by the
    same job that serves readers, gets a site-language digest whose footer is
    their token-based unsubscribe link (never the reader /notifications page),
    and is stamped idempotently per delivered message — never double-mailed
    within the window. Per-post-only and still-pending subscribers stay out."""

    async def test_collects_only_confirmed_opt_in_guests(self, db_session):
        await _newsletter_subscriber(db_session, "a@example.com", confirmed=True, digest_weekly=True)
        await _newsletter_subscriber(db_session, "b@example.com", confirmed=True, digest_weekly=False)
        await _newsletter_subscriber(db_session, "c@example.com", confirmed=False, digest_weekly=True)

        from app.digest import collect_newsletter_digest_recipients

        rows = await collect_newsletter_digest_recipients(db_session, datetime.now())
        assert [sub.email for sub, _ in rows] == ["a@example.com"]

    async def test_delivers_guest_digest_with_token_footer_and_stamps(self, db_session, smtp_sink):
        await _make_post(db_session, "In window", "in-window")
        sub_id = await _newsletter_subscriber(db_session, "guest@example.com", confirmed=True, digest_weekly=True)

        summary = await send_weekly_digest(db_session)
        assert summary["subscribers"] == 1

        msgs = [m for m in smtp_sink.sent if m["To"] == "guest@example.com"]
        assert len(msgs) == 1
        body = _plain_text(msgs[0])
        assert "In window" in body
        # Guest footer is the token unsubscribe page, not the reader prefs page —
        # and the copy says "unsubscribe", never "notification preferences" (a
        # guest has no prefs page).
        assert "newsletter/unsubscribe" in body
        assert "/notifications" not in body
        assert "退订订阅" in body
        assert "通知偏好" not in body

        sub = await db_session.get(models.NewsletterSubscriber, sub_id)
        assert sub.digest_sent_at is not None

    async def test_no_double_send_within_window(self, db_session, smtp_sink):
        await _make_post(db_session, "In window", "in-window")
        await _newsletter_subscriber(db_session, "guest@example.com", confirmed=True, digest_weekly=True)

        await send_weekly_digest(db_session)
        first = len([m for m in smtp_sink.sent if m["To"] == "guest@example.com"])
        # A same-day second run re-stamps nothing (window still open) — guest
        # still gets exactly one message.
        await send_weekly_digest(db_session)
        second = len([m for m in smtp_sink.sent if m["To"] == "guest@example.com"])
        assert first == 1
        assert second == first

    async def test_guest_digest_uses_site_language(self, db_session, smtp_sink, monkeypatch):
        monkeypatch.setenv("SITE_LANGUAGE", "en")
        await _make_post(db_session, "In window", "in-window")
        await _newsletter_subscriber(db_session, "guest@example.com", confirmed=True, digest_weekly=True)

        await send_weekly_digest(db_session)
        msg = next(m for m in smtp_sink.sent if m["To"] == "guest@example.com")
        assert msg["Subject"].startswith("Weekly digest")
        # English guest footer reads as plain cancellation, not "preferences".
        body = _plain_text(msg)
        assert "Unsubscribe from this newsletter" in body
        assert "preferences" not in body.lower()

    async def test_per_post_and_pending_guests_not_digested(self, db_session, smtp_sink):
        await _make_post(db_session, "In window", "in-window")
        await _newsletter_subscriber(db_session, "weekly@example.com", confirmed=True, digest_weekly=True)
        await _newsletter_subscriber(db_session, "perpost@example.com", confirmed=True, digest_weekly=False)
        await _newsletter_subscriber(db_session, "pending@example.com", confirmed=False, digest_weekly=True)

        await send_weekly_digest(db_session)
        assert any(m["To"] == "weekly@example.com" for m in smtp_sink.sent)
        assert not any(m["To"] == "perpost@example.com" for m in smtp_sink.sent)
        assert not any(m["To"] == "pending@example.com" for m in smtp_sink.sent)


class TestGuestThreadDigestExcludesOwn:
    """The guest-thread weekly digest (DEC-429) must not echo a follower's OWN
    comments back at them — the same self-exclusion the per-comment channel
    makes (round 393; a subscriber who comments this week used to be mailed a
    digest listing their own words)."""

    async def _guest_digest_sub(self, db, email, post_id) -> int:
        from secrets import token_urlsafe

        row = models.GuestCommentSubscription(
            email=email,
            post_id=post_id,
            token=token_urlsafe(32),
            is_confirmed=True,
            digest_weekly=True,
            confirmed_at=datetime.now(),
        )
        db.add(row)
        await db.flush()
        return row.id

    async def test_own_guest_comment_is_excluded_from_the_digest(self, db_session):
        post = await _make_post(db_session, "Thread", "thread")
        sub_id = await self._guest_digest_sub(db_session, "guest@example.com", post.id)
        # The subscriber's own approved comment lands inside the window.
        db_session.add(
            models.Comment(
                post_id=post.id,
                nickname="Me",
                email="guest@example.com",
                content="my own comment",
                is_approved=True,
            )
        )
        # Another reader's comment IS digest-worthy.
        db_session.add(
            models.Comment(
                post_id=post.id,
                nickname="Other",
                email="other@example.com",
                content="someone else's comment",
                is_approved=True,
            )
        )
        await db_session.commit()

        from app.digest import collect_guest_thread_digest_deliveries

        rows = await collect_guest_thread_digest_deliveries(db_session, datetime.now())
        assert [sub for sub, _, _ in rows] == [await db_session.get(models.GuestCommentSubscription, sub_id)]
        _, _, comments = rows[0]
        # Only the other reader's comment is summarized; the follower's own is
        # never echoed back at them.
        assert [c.content for c in comments] == ["someone else's comment"]

    async def test_own_reader_comment_is_excluded_via_the_account_email(self, db_session):
        # A signed-in reader who comments under their account (Comment.email is
        # None for reader comments) and also subscribes as a guest with the same
        # address must not have their own comment echoed either.
        post = await _make_post(db_session, "Thread", "thread")
        await self._guest_digest_sub(db_session, "reader@example.com", post.id)
        reader = ReaderAccount(
            email="reader@example.com",
            password="x",
            display_name="Reader",
        )
        db_session.add(reader)
        await db_session.flush()
        db_session.add(
            models.Comment(
                post_id=post.id,
                nickname="Reader",
                email=None,
                reader_id=reader.id,
                content="reader's own comment",
                is_approved=True,
            )
        )
        await db_session.commit()

        from app.digest import collect_guest_thread_digest_deliveries

        rows = await collect_guest_thread_digest_deliveries(db_session, datetime.now())
        # No other comments exist — the follower's own is the only one, so no
        # digest row at all (nothing to summarize).
        assert rows == []

    async def test_digest_delivery_excludes_own_comment_end_to_end(self, db_session, smtp_sink):
        # The full weekly job: the follower's own comment alone yields NO digest
        # email; an added third-party comment makes one arrive without echoing
        # the follower's own words.
        post = await _make_post(db_session, "Thread", "thread")
        await self._guest_digest_sub(db_session, "guest@example.com", post.id)
        db_session.add(
            models.Comment(
                post_id=post.id,
                nickname="Me",
                email="guest@example.com",
                content="my own words",
                is_approved=True,
            )
        )
        await db_session.commit()

        from app.digest import send_weekly_digest

        # The subscriber IS a digest candidate (confirmed + weekly + in window
        # by date) but its only comment is its own → no message is mailed.
        await send_weekly_digest(db_session)
        assert not any(m["To"] == "guest@example.com" for m in smtp_sink.sent)


class TestBuilder:
    def _msg(self, **kw) -> EmailMessage:
        now = datetime(2026, 8, 28, 12, 0, 0)
        post = models.Post(
            title="《标题》 <script>alert(1)</script>",
            slug="hello",
            content="x",
            excerpt="摘要 <img onerror=x>",
        )
        return build_digest_message(
            from_addr="blog@example.com",
            to_email="reader@example.com",
            display_name="读者",
            posts=[post],
            base_url="https://blog.example.com",
            window_start=now - timedelta(days=7),
            now_naive=now,
        )

    async def test_subject_and_absolute_link_and_escape(self):
        msg = self._msg()
        parts = list(msg.walk())
        text = next(p for p in parts if p.get_content_type() == "text/plain").get_content()
        html = next(p for p in parts if p.get_content_type() == "text/html").get_content()
        assert "本周精选" in msg["Subject"]
        assert "https://blog.example.com/posts/hello" in text
        assert 'href="https://blog.example.com/posts/hello"' in html
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        assert "<img" not in html
        assert "&lt;img" in html

    async def test_unsubscribe_link_present(self):
        html = next(p for p in self._msg().walk() if p.get_content_type() == "text/html").get_content()
        assert 'href="https://blog.example.com/notifications"' in html


class TestAdminEndpoint:
    async def test_requires_superuser(self, client, editor_headers, admin_token):
        assert admin_token
        # Editor (non-superuser) is rejected; anonymous is rejected.
        assert (await client.post("/api/admin/digests/send-weekly", headers=editor_headers)).status_code in (401, 403)
        assert (await client.post("/api/admin/digests/send-weekly")).status_code in (401, 403)

    async def test_dry_run_via_superuser(self, client, admin_token):
        assert admin_token
        resp = await client.post(
            "/api/admin/digests/send-weekly?dry_run=true", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("dry_run") is True
        assert body["readers"] >= 0


# ---------------------------------------------------------------------------
# PostgreSQL-specific paths (advisory lock + naive created_at storage).
# Skipped unless TEST_DATABASE_URL points at a scratch PostgreSQL database.
# ---------------------------------------------------------------------------

_postgres_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
skip_pg = pytest.mark.skipif(
    not _postgres_url or "postgresql" not in _postgres_url,
    reason="PostgreSQL not configured for testing (set TEST_DATABASE_URL to a postgresql:// URL)",
)


@skip_pg
async def test_pg_delivers_in_window_and_advisory_lock_blocks_concurrent_run(smtp_sink, pg_scratch_engine):
    """Live-Postgres verification of the two paths SQLite cannot exercise:
    the naive ``created_at`` storage branch (PG stores naive UTC, no +00:00
    suffix) and the advisory-lock contention guard. Uses a per-worker scratch
    schema (pg_scratch_engine) so the create_all/drop_all never collides with
    another worker's scratch test or the shared DB's public schema."""
    engine = pg_scratch_engine
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with engine.begin() as _conn:
            await _conn.run_sync(Base.metadata.create_all)
        db = Session()
        try:
            now = crud.utc_now_naive()
            reader = ReaderAccount(email="pg-digest@example.com", password="x", display_name="PG")
            db.add(reader)
            await db.flush()
            db.add(models.ReaderNotificationPref(reader_id=reader.id, email_weekly_digest=True))
            # One scheduled (naive publish_at) in-window post + one unscheduled
            # (naive created_at) in-window post + one old post.
            db.add(
                models.Post(
                    title="PG scheduled",
                    slug="pg-scheduled",
                    content="x",
                    excerpt="",
                    published=True,
                    publish_at=now - timedelta(days=2),
                )
            )
            db.add(
                models.Post(
                    title="PG created",
                    slug="pg-created",
                    content="x",
                    excerpt="",
                    published=True,
                    publish_at=None,
                    created_at=now - timedelta(days=1),
                )
            )
            db.add(
                models.Post(
                    title="PG old",
                    slug="pg-old",
                    content="x",
                    published=True,
                    publish_at=now - timedelta(days=30),
                )
            )
            await db.commit()

            # Normal run: both in-window posts, one email, idempotency stamped.
            first = await send_weekly_digest(db)
            assert first["readers"] == 1, first
            assert first["emails_sent"] == 1
            html = next(p.get_content() for p in smtp_sink.sent[-1].walk() if p.get_content_type() == "text/html")
            assert "PG scheduled" in html and "PG created" in html
            assert "PG old" not in html
            pref = await db.get(models.ReaderNotificationPref, reader.id)
            assert pref.digest_sent_at is not None

            # Advisory lock: hold the lock on a second connection -> job defers.
            # Scope to the worker-derived key (conftest sets a per-worker salt
            # under TEST_DATABASE_URL) so the lock assert matches what the app
            # acquires; production uses the stable base key.
            other = Session()
            try:
                await other.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _digest_lock_key()})
                locked = await send_weekly_digest(db)
                assert locked["locked"] is True
                assert locked["readers"] == 0
            finally:
                await other.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _digest_lock_key()})
                await other.close()

            # Idempotency: a second uncontended run skips the stamped reader.
            second = await send_weekly_digest(db)
            assert second["readers"] == 0, second
        finally:
            await db.close()
    finally:
        async with engine.begin() as _conn:
            await _conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


class TestBuilderEscape:
    """Display-name escaping in the digest HTML part.

    greeting already html-escapes the display name; applying html.escape again
    double-escapes the entity (A&B -> A&amp;B in the message source, rendered
    as literal "A&amp;B") — a BadHtml safety smell and a visible typo."""

    def _msg_for_name(self, display_name: str) -> EmailMessage:
        now = datetime(2026, 8, 28, 12, 0, 0)
        post = models.Post(title="t", slug="s", content="x")
        return build_digest_message(
            from_addr="blog@example.com",
            to_email="reader@example.com",
            display_name=display_name,
            posts=[post],
            base_url="https://blog.example.com",
            window_start=now - timedelta(days=7),
            now_naive=now,
        )

    async def test_html_display_name_is_not_double_escaped(self):
        msg = self._msg_for_name("A&B")
        html = next(p for p in msg.walk() if p.get_content_type() == "text/html").get_content()
        # The name should appear once-escaped: A&amp;B, never A&amp;amp;B.
        assert "A&amp;B" in html
        assert "A&amp;amp;B" not in html

    async def test_text_display_name_is_raw_not_html_escaped(self):
        # The plain-TEXT part has no markup context: an HTML entity like
        # &amp; renders literally as "A&amp;B" in a text-only mail client.
        # The raw name must appear verbatim in text while the HTML part keeps
        # its escaped copy (ISS-447).
        msg = self._msg_for_name("A&B")
        text = next(p for p in msg.walk() if p.get_content_type() == "text/plain").get_content()
        assert "A&B" in text
        assert "A&amp;B" not in text

    async def test_html_script_name_is_escaped_once(self):
        msg = self._msg_for_name("<script>alert(1)</script>")
        html = next(p for p in msg.walk() if p.get_content_type() == "text/html").get_content()
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        # And not double-escaped into &amp;lt;script…
        assert "&amp;lt;" not in html

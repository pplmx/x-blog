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
from datetime import datetime, timedelta
from email.message import EmailMessage

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app import crud, models
from app.auth import ReaderAccount
from app.database import Base
from app.digest import (
    _DIGEST_LOCK_KEY,
    WEEKLY_WINDOW_DAYS,
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
        _FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp_sink(monkeypatch: pytest.MonkeyPatch) -> type[_FakeSMTP]:
    """Point SMTP at the fake sink; both digest tests and the admin endpoint
    send through ``app.emailer.send_messages``, so patch that module's symbol."""
    _FakeSMTP.instances = []
    _FakeSMTP.sent = []
    _FakeSMTP.fail_on_send = False
    monkeypatch.setattr("app.emailer.smtplib.SMTP", _FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return _FakeSMTP


def _reader(db, email: str, *, active: bool = True, digest: bool = True, display_name: str | None = None) -> int:
    row = ReaderAccount(email=email, password="x", display_name=display_name or email.split("@")[0], is_active=active)
    db.add(row)
    db.flush()
    db.add(models.ReaderNotificationPref(reader_id=row.id, email_weekly_digest=digest))
    db.flush()
    return row.id


def _make_post(
    db,
    title: str,
    slug: str,
    *,
    published: bool = True,
    publish_at: datetime | None = None,
    created_at: datetime | None = None,
) -> models.Post:
    post = models.Post(title=title, slug=slug, content="body", excerpt="excerpt", published=published, publish_at=publish_at)
    if created_at is not None:
        post.created_at = created_at
    db.add(post)
    db.flush()
    return post


class TestWindowMath:
    def test_first_time_is_rolling_seven_days(self):
        now = datetime(2026, 8, 28, 12, 0, 0)
        pref = models.ReaderNotificationPref(reader_id=1)
        assert digest_window_start(pref, now) == now - timedelta(days=WEEKLY_WINDOW_DAYS)

    def test_bounded_by_last_digest_but_never_older_than_week(self):
        now = datetime(2026, 8, 28, 12, 0, 0)
        recent = now - timedelta(days=2)
        pref = models.ReaderNotificationPref(reader_id=1, digest_sent_at=recent)
        assert digest_window_start(pref, now) == recent
        ancient = now - timedelta(days=40)
        pref2 = models.ReaderNotificationPref(reader_id=2, digest_sent_at=ancient)
        assert digest_window_start(pref2, now) == now - timedelta(days=WEEKLY_WINDOW_DAYS)


class TestCollectPosts:
    def test_includes_window_posts_excludes_old_unpublished_and_future(self, db_session):
        now = crud.utc_now_naive()
        _make_post(db_session, "This week", "in-window")  # created_at = now
        _make_post(
            db_session,
            "Old scheduled",
            "old-scheduled",
            publish_at=now - timedelta(days=10),
        )
        _make_post(
            db_session,
            "Old unscheduled",
            "old-unscheduled",
            created_at=now - timedelta(days=20),
        )
        _make_post(db_session, "Draft", "draft", published=False)
        _make_post(
            db_session,
            "Future scheduled",
            "future",
            publish_at=now + timedelta(days=1),
        )
        db_session.commit()

        posts = collect_digest_posts(db_session, now)
        slugs = {p.slug for p in posts}
        assert slugs == {"in-window"}


class TestCollectRecipients:
    def test_opt_in_active_with_email_only(self, db_session):
        a = _reader(db_session, "a@example.com")
        _reader(db_session, "b@example.com", digest=False)  # not opted in
        _reader(db_session, "in@example.com", active=False)  # deactivated
        db_session.commit()

        rid_pair = collect_digest_recipients(db_session, crud.utc_now_naive())
        assert {acct.id for _, acct, _ in rid_pair} == {a}


class TestSend:
    def test_delivers_to_opted_in_reader_and_stamps(self, db_session, smtp_sink):
        rid = _reader(db_session, "digest@example.com")
        _make_post(db_session, "本周文章", "week-post")
        db_session.commit()

        summary = send_weekly_digest(db_session)
        assert summary["readers"] == 1
        assert summary["emails_sent"] == 1
        assert summary["posts"] == 1
        assert summary["skipped"] == 0
        assert len(smtp_sink.sent) == 1
        msg = smtp_sink.sent[0]
        assert msg["To"] == "digest@example.com"
        assert "本周精选" in msg["Subject"]
        # Idempotency stamper landed.
        pref = db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is not None

    def test_skips_reader_with_no_new_posts(self, db_session, smtp_sink):
        rid = _reader(db_session, "quiet@example.com")
        db_session.commit()
        summary = send_weekly_digest(db_session)
        assert summary["readers"] == 0
        assert summary["emails_sent"] == 0
        assert summary["reason"] == "no_recipients"
        assert smtp_sink.sent == []
        pref = db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None

    def test_no_double_send_within_window(self, db_session, smtp_sink):
        rid = _reader(db_session, "repeat@example.com")
        _make_post(db_session, "Once", "once")
        db_session.commit()
        first = send_weekly_digest(db_session)
        assert first["readers"] == 1
        second = send_weekly_digest(db_session)
        assert second["readers"] == 0
        assert len(smtp_sink.sent) == 1
        pref = db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is not None

    def test_smtp_down_leaves_window_open_for_retry(self, db_session, smtp_sink):
        rid = _reader(db_session, "retry@example.com")
        _make_post(db_session, "Retry me", "retry")
        db_session.commit()
        smtp_sink.fail_on_send = True
        summary = send_weekly_digest(db_session)
        assert summary["reason"] == "smtp_error"
        pref = db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None

    def test_dry_run_sends_nothing_and_stamps_nothing(self, db_session, smtp_sink):
        rid = _reader(db_session, "preview@example.com")
        _make_post(db_session, "Preview", "preview")
        db_session.commit()
        summary = send_weekly_digest(db_session, dry_run=True)
        assert summary["dry_run"] is True
        assert summary["readers"] == 1
        assert summary["emails_sent"] == 0
        assert smtp_sink.sent == []
        pref = db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None

    def test_returns_smtp_not_configured_without_host(self, db_session, monkeypatch):
        rid = _reader(db_session, "noconf@example.com")
        _make_post(db_session, "Noconf", "noconf")
        db_session.commit()
        monkeypatch.delenv("SMTP_HOST", raising=False)
        summary = send_weekly_digest(db_session)
        assert summary["reason"] == "smtp_not_configured"
        assert summary["emails_sent"] == 0
        pref = db_session.get(models.ReaderNotificationPref, rid)
        assert pref.digest_sent_at is None


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

    def test_subject_and_absolute_link_and_escape(self):
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

    def test_unsubscribe_link_present(self):
        html = next(p for p in self._msg().walk() if p.get_content_type() == "text/html").get_content()
        assert 'href="https://blog.example.com/notifications"' in html


class TestAdminEndpoint:
    def test_requires_superuser(self, client, editor_headers, admin_token):
        assert admin_token
        # Editor (non-superuser) is rejected; anonymous is rejected.
        assert client.post("/api/admin/digests/send-weekly", headers=editor_headers).status_code in (401, 403)
        assert client.post("/api/admin/digests/send-weekly").status_code in (401, 403)

    def test_dry_run_via_superuser(self, client, admin_token):
        assert admin_token
        resp = client.post("/api/admin/digests/send-weekly?dry_run=true", headers={"Authorization": f"Bearer {admin_token}"})
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
def test_pg_delivers_in_window_and_advisory_lock_blocks_concurrent_run(smtp_sink):
    """Live-Postgres verification of the two paths SQLite cannot exercise:
    the naive ``created_at`` storage branch (PG stores naive UTC, no +00:00
    suffix) and the advisory-lock contention guard. Uses a scratch DB pointed
    to by TEST_DATABASE_URL; Schema is create_all/drop_all'd like
    test_postgres_connection (never point this at a real database)."""
    engine = create_engine(_postgres_url)
    Session = sessionmaker(bind=engine)
    try:
        Base.metadata.create_all(bind=engine)
        db = Session()
        try:
            now = crud.utc_now_naive()
            reader = ReaderAccount(email="pg-digest@example.com", password="x", display_name="PG")
            db.add(reader)
            db.flush()
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
            db.commit()

            # Normal run: both in-window posts, one email, idempotency stamped.
            first = send_weekly_digest(db)
            assert first["readers"] == 1, first
            assert first["emails_sent"] == 1
            html = next(
                p.get_content() for p in smtp_sink.sent[-1].walk() if p.get_content_type() == "text/html"
            )
            assert "PG scheduled" in html and "PG created" in html
            assert "PG old" not in html
            pref = db.get(models.ReaderNotificationPref, reader.id)
            assert pref.digest_sent_at is not None

            # Advisory lock: hold the lock on a second connection -> job defers.
            other = Session()
            try:
                other.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _DIGEST_LOCK_KEY})
                locked = send_weekly_digest(db)
                assert locked["locked"] is True
                assert locked["readers"] == 0
            finally:
                other.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _DIGEST_LOCK_KEY})
                other.close()

            # Idempotency: a second uncontended run skips the stamped reader.
            second = send_weekly_digest(db)
            assert second["readers"] == 0, second
        finally:
            db.close()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()

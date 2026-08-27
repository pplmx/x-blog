"""Email notification channel tests (DEC-197, TASK-217).

The email channel is a per-kind *opt-in* off-site copy of the reader
notification fan-out: delivery over SMTP to the reader's registered address,
gated on an email_* pref column (default false) plus SMTP being configured.
This suite covers the message builder (absolute deep link, HTML escaping,
text+HTML multipart), the opt-in gate matrix, and `dispatch_notification_emails`
end-to-end against a fake SMTP sink — readers who opt in for a kind get exactly
one captured message, everyone else gets none, and a broken SMTP server or a
missing config never raises (best effort).
"""

from email.message import EmailMessage

import pytest

from app import models
from app.emailer import (
    EmailItem,
    _build_message,
    dispatch_notification_emails,
    email_channel_enabled,
    is_email_configured,
)
from app.middleware import get_logger

logger = get_logger("test_emailer")


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    instances: list[FakeSMTP] = []
    sent: list[EmailMessage] = []

    def __init__(self, host: str, port: int, timeout: float | None = None):
        self.host = host
        self.port = port
        self.logged_in: tuple[str, str] | None = None
        self.tls_started = False
        FakeSMTP.instances.append(self)

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def starttls(self, context: object = None) -> None:
        self.tls_started = True

    def login(self, user: str, password: str) -> None:
        self.logged_in = (user, password)

    def send_message(self, msg: EmailMessage) -> None:
        FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp_sink(monkeypatch: pytest.MonkeyPatch) -> type[FakeSMTP]:
    """Configure SMTP against the fake sink and reset its capture per test."""
    FakeSMTP.instances = []
    FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return FakeSMTP


def _msg(item: EmailItem) -> EmailMessage:
    return _build_message(item, "blog@example.com", "reader@example.com", "https://blog.example.com")


class TestMessageBuilder:
    def test_text_and_html_with_absolute_link(self):
        msg = _msg(EmailItem(1, "new_post", "新文章发布", "《标题》", "/posts/hello"))
        assert msg["From"] == "blog@example.com"
        assert msg["To"] == "reader@example.com"
        assert msg["Subject"] == "新文章发布"
        parts = list(msg.walk())
        text = next(p for p in parts if p.get_content_type() == "text/plain").get_content()
        html = next(p for p in parts if p.get_content_type() == "text/html").get_content()
        # The in-app relative deep link becomes absolute for email readers; the
        # raw relative path never appears standalone in either part.
        assert "https://blog.example.com/posts/hello" in text
        assert 'href="https://blog.example.com/posts/hello"' in html

    def test_html_escapes_reader_controlled_values(self):
        msg = _msg(EmailItem(1, "new_post", "新文章发布 <script>alert(1)</script>", "《<img onerror=x>》", "/posts/a"))
        html = next(p for p in msg.walk() if p.get_content_type() == "text/html").get_content()
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html
        assert "<img" not in html


class TestGate:
    def test_missing_row_is_email_off(self):
        assert email_channel_enabled(None, "new_post") is False
        assert email_channel_enabled(None, "reply") is False

    def test_explicit_opt_in_per_kind(self):
        row = models.ReaderNotificationPref(reader_id=1, email_new_post=True)
        assert email_channel_enabled(row, "new_post") is True
        assert email_channel_enabled(row, "series_new_part") is True  # same pref
        assert email_channel_enabled(row, "reply") is False
        assert email_channel_enabled(row, "thread_comment") is False

    def test_unknown_kind_is_off(self):
        row = models.ReaderNotificationPref(reader_id=1, email_reply=True)
        assert email_channel_enabled(row, "bogus") is False

    def test_is_configured_missing_smtp_host(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("SMTP_HOST", raising=False)
        assert is_email_configured() is False


class TestDispatch:
    @staticmethod
    def _reader(db, email: str, **pref_kwargs) -> int:
        from app.auth import ReaderAccount

        row = ReaderAccount(email=email, password="x", display_name=email.split("@")[0])
        db.add(row)
        db.flush()
        if pref_kwargs:
            db.add(models.ReaderNotificationPref(reader_id=row.id, **pref_kwargs))
            db.flush()
        return row.id

    def test_opt_in_readers_get_exactly_one_email(self, db_session, smtp_sink):
        a = self._reader(db_session, "a@example.com", email_new_post=True)
        b = self._reader(db_session, "b@example.com", email_new_post=False)
        c = self._reader(db_session, "c@example.com")  # no prefs row -> email off
        sent = dispatch_notification_emails(
            db_session,
            [
                EmailItem(a, "new_post", "新文章发布", "《p》", "/posts/p"),
                EmailItem(b, "new_post", "新文章发布", "《p》", "/posts/p"),
                EmailItem(c, "new_post", "新文章发布", "《p》", "/posts/p"),
            ],
            logger,
        )
        assert sent == 1
        assert len(smtp_sink.sent) == 1
        assert smtp_sink.sent[0]["To"] == "a@example.com"
        assert smtp_sink.instances[0].logged_in is None
        assert smtp_sink.instances[0].tls_started is True

    def test_series_new_part_shares_new_post_pref(self, db_session, smtp_sink):
        a = self._reader(db_session, "a@example.com", email_new_post=True)
        sent = dispatch_notification_emails(
            db_session,
            [EmailItem(a, "series_new_part", "系列更新", "《p》", "/posts/p")],
            logger,
        )
        assert sent == 1
        assert smtp_sink.sent[0]["Subject"] == "系列更新"

    def test_reply_and_thread_comment_opt_ins(self, db_session, smtp_sink):
        rr = self._reader(db_session, "reply@example.com", email_reply=True)
        tt = self._reader(db_session, "thread@example.com", email_thread_comment=True)
        sent = dispatch_notification_emails(
            db_session,
            [
                EmailItem(rr, "reply", "有人回复了你的评论", "《p》", "/posts/p"),
                EmailItem(tt, "thread_comment", "你订阅的讨论有新评论", "《p》", "/posts/p#c1"),
            ],
            logger,
        )
        assert sent == 2
        assert {m["To"] for m in smtp_sink.sent} == {"reply@example.com", "thread@example.com"}

    def test_empty_stored_address_is_skipped(self, db_session, smtp_sink):
        rid = self._reader(db_session, "", email_new_post=True)
        sent = dispatch_notification_emails(
            db_session,
            [EmailItem(rid, "new_post", "新文章发布", "《p》", "/posts/p")],
            logger,
        )
        assert sent == 0

    def test_not_configured_is_0(self, db_session, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("SMTP_HOST", raising=False)
        a = self._reader(db_session, "a@example.com", email_new_post=True)
        assert (
            dispatch_notification_emails(db_session, [EmailItem(a, "new_post", "t", "《p》", "/posts/p")], logger) == 0
        )

    def test_smtp_failure_never_raises(self, db_session, monkeypatch: pytest.MonkeyPatch):
        class SmtpBoom(Exception):  # noqa: N818
            pass

        class BoomSMTP:
            def __enter__(self) -> BoomSMTP:
                raise SmtpBoom("connection refused")

            def __exit__(self, *_: object) -> None:
                return None

        a = self._reader(db_session, "a@example.com", email_new_post=True)
        monkeypatch.setattr("app.emailer.smtplib.SMTP", BoomSMTP)
        # Must not raise; reports 0 delivered.
        assert (
            dispatch_notification_emails(db_session, [EmailItem(a, "new_post", "t", "《p》", "/posts/p")], logger) == 0
        )

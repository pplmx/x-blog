"""Contract tests for site-language guest + recovery emails (DEC-342, TASK-397).

The reader-side fan-out emails localize per reader (DEC-338/DEC-340), but the
sender-side emails were hardcoded Chinese regardless of the site's configured
language: the guest reply email (DEC-332) is entirely zh (subject 有人回复了你
的评论, body 《…》有一条新回复。) and the password reset email (DEC-286) is a
bilingual-subject hack (重置密码 / Reset password) with a fully Chinese body —
and replaces the configured site title with the hardcoded name "X-Blog".

This suite proves both render in the site's configured language
(``SITE_LANGUAGE``, default zh-CN preserving today's copy exactly) and that the
reset email uses the configured ``SITE_TITLE`` for the site name — the last
all-Chinese email surfaces for an English-configured site.
"""

from email.message import EmailMessage

import pytest

from app.emailer import send_guest_comment_manage_email, send_guest_reply_email, send_password_reset_email


class _FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording delivered messages (mirrors the
    emailer/digest suites' sink so all channels assert identically)."""

    instances: list[_FakeSMTP] = []
    sent: list[EmailMessage] = []

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
        _FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp_sink_fixture(monkeypatch: pytest.MonkeyPatch):
    """Point SMTP at the fake sink; both functions send through
    ``app.emailer``'s smtplib, so patch that module's symbol and set the lazy
    env config the same way the emailer/digest suites do."""
    _FakeSMTP.instances = []
    _FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", _FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return _FakeSMTP


def _text_part(msg: EmailMessage) -> str:
    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            return part.get_content()
    return ""


class TestGuestReplyEmailLanguage:
    def test_default_zh_copy(self, smtp_sink_fixture):
        assert send_guest_reply_email(
            "guest@example.com",
            post_title="Hello",
            reply_url="/posts/hello#comment-1",
            unsubscribe_url="/comment-reply-unsubscribe?token=abc",
        )
        msg = _FakeSMTP.sent[0]
        assert msg["Subject"] == "有人回复了你的评论"
        assert "《Hello》有一条新回复。" in _text_part(msg)

    def test_en_site_gets_english_copy(self, monkeypatch, smtp_sink_fixture):
        monkeypatch.setenv("SITE_LANGUAGE", "en")
        assert send_guest_reply_email(
            "guest@example.com",
            post_title="Hello",
            reply_url="/posts/hello#comment-1",
            unsubscribe_url="/comment-reply-unsubscribe?token=abc",
        )
        msg = _FakeSMTP.sent[0]
        assert msg["Subject"] == "Someone replied to your comment"
        text = _text_part(msg)
        assert "Hello" in text
        assert "View the reply" in text
        assert "unsubscribe" in text.lower()


class TestGuestCommentManageEmailLanguage:
    """The round-385 guest manage email (DEC-435/TASK-444) sends directly from
    the sender side, so it must render in the site's configured language like
    the other sender-side guest emails (DEC-342)."""

    def test_default_zh_copy(self, smtp_sink_fixture):
        assert send_guest_comment_manage_email(
            "guest@example.com",
            post_title="Hello",
            post_url="/posts/hello#comment-1",
            manage_url="/comments/manage?token=abc",
        )
        msg = _FakeSMTP.sent[0]
        assert msg["Subject"] == "你的评论已发布 — 可管理"
        text = _text_part(msg)
        assert "《Hello》" in text
        assert "评论" in text
        assert "/comments/manage?token=abc" in text

    def test_en_site_gets_english_copy(self, monkeypatch, smtp_sink_fixture):
        monkeypatch.setenv("SITE_LANGUAGE", "en")
        assert send_guest_comment_manage_email(
            "guest@example.com",
            post_title="Hello",
            post_url="/posts/hello#comment-1",
            manage_url="/comments/manage?token=abc",
        )
        msg = _FakeSMTP.sent[0]
        assert msg["Subject"] == "Your comment is live — manage it"
        text = _text_part(msg)
        assert "Hello" in text
        assert "manage" in text
        assert "/comments/manage?token=abc" in text


class TestPasswordResetEmailLanguage:
    def test_default_zh_copy_uses_site_title(self, monkeypatch, smtp_sink_fixture):
        monkeypatch.setenv("SITE_TITLE", "我的博客")
        assert send_password_reset_email("reader@example.com", "tok123")
        msg = _FakeSMTP.sent[0]
        assert msg["Subject"] == "重置密码 / Reset password"
        assert "我的博客" in _text_part(msg)

    def test_en_site_gets_english_copy_and_site_title(self, monkeypatch, smtp_sink_fixture):
        monkeypatch.setenv("SITE_LANGUAGE", "en")
        monkeypatch.setenv("SITE_TITLE", "My Blog")
        assert send_password_reset_email("reader@example.com", "tok123")
        msg = _FakeSMTP.sent[0]
        assert msg["Subject"] == "Reset your My Blog password"
        text = _text_part(msg)
        assert "My Blog" in text
        assert "tok123" in text
        assert "https://blog.example.com/reset-password?token=tok123" in text

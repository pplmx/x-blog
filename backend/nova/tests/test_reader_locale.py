"""Contract tests for reader-language notification copy (DEC-338, TASK-395).

Notification copy was hardcoded Chinese for every reader — durable inbox titles
(系列更新 / 新文章发布 / 《…》), the per-event email Subject (item.title) and
body, and the weekly digest were all zh regardless of the reader's UI language
or ``site_language`` (the site ships en + zh locales). This suite proves the
per-reader ``locale`` (default zh, preserving existing behavior) selects the
language of the fan-out copy: an en reader gets English inbox titles, email
Subject/body, and digest; a zh reader (or one who never set a locale) keeps the
zh copy; switching locale affects only subsequent fan-outs.

Covers: auth + validation + set/get on PUT /api/reader/me/locale; default zh;
en inbox titles/body; en series kind; locale switch affecting later fan-outs
only; email copy matching locale (SMTP sink); digest localized per reader.
"""

from email.message import EmailMessage

from app.crud import utc_now_naive
from app.digest import build_digest_message

NOTIFS = "/api/reader/me/notifications"
LOCALE = "/api/reader/me/locale"


def _register(client, email, password="readerpass123"):
    resp = client.post("/api/reader/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _follow_category(client, token, cat_id):
    resp = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=_auth(token))
    assert resp.status_code in (200, 201), resp.text


def _set_locale(client, token, locale):
    return client.put(LOCALE, json={"locale": locale}, headers=_auth(token))


def _publish(client, auth_headers, cat_id, slug):
    resp = client.post(
        "/api/posts",
        json={"title": f"T {slug}", "slug": slug, "content": "content", "published": True, "category_id": cat_id},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


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


def _smtp_sink(monkeypatch):
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


class TestSetLocaleEndpoint:
    def test_requires_reader_token(self, client):
        assert client.put(LOCALE, json={"locale": "en"}).status_code == 401

    def test_rejects_unknown_locale(self, client):
        token = _register(client, "bad-locale@example.com")
        assert _set_locale(client, token, "fr").status_code == 422

    def test_set_and_read_back_en(self, client, db_session):
        from app.auth import ReaderAccount

        token = _register(client, "set-en@example.com")
        resp = _set_locale(client, token, "en")
        assert resp.status_code == 200
        assert resp.json()["locale"] == "en"
        acct = db_session.query(ReaderAccount).filter(ReaderAccount.email == "set-en@example.com").one()
        assert acct.locale == "en"


class TestInboxCopy:
    def test_default_is_zh_copy(self, client, db_session, auth_headers):
        token = _register(client, "dzh@example.com")
        cat = client.post("/api/categories", json={"name": "DZh"}, headers=auth_headers).json()
        _follow_category(client, token, cat["id"])
        _publish(client, auth_headers, cat["id"], "dzh-post")

        inbox = client.get(NOTIFS, headers=_auth(token)).json()
        assert inbox["total"] == 1
        assert inbox["items"][0]["kind"] == "new_post"
        assert inbox["items"][0]["title"] == "新文章发布"
        assert inbox["items"][0]["body"] == "《T dzh-post》"

    def test_en_reader_gets_english_copy(self, client, db_session, auth_headers):
        token = _register(client, "en@example.com")
        assert _set_locale(client, token, "en").status_code == 200
        cat = client.post("/api/categories", json={"name": "EnCat"}, headers=auth_headers).json()
        _follow_category(client, token, cat["id"])
        _publish(client, auth_headers, cat["id"], "en-post")

        inbox = client.get(NOTIFS, headers=_auth(token)).json()
        assert inbox["total"] == 1
        assert inbox["items"][0]["kind"] == "new_post"
        assert inbox["items"][0]["title"] == "New post"
        assert inbox["items"][0]["body"] == "T en-post"

    def test_en_series_kind_is_localized(self, client, db_session, auth_headers):
        token = _register(client, "en-series@example.com")
        assert _set_locale(client, token, "en").status_code == 200
        series = client.post(
            "/api/series", json={"title": "S", "slug": "s-en", "description": "d"}, headers=auth_headers
        ).json()
        resp = client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert resp.status_code in (200, 201), resp.text
        client.post(
            "/api/posts",
            json={"title": "Part", "slug": "en-part", "content": "c", "published": True, "series_id": series["id"]},
            headers=auth_headers,
        )

        inbox = client.get(NOTIFS, headers=_auth(token)).json()
        assert inbox["total"] == 1
        assert inbox["items"][0]["kind"] == "series_new_part"
        assert inbox["items"][0]["title"] == "Series update"

    def test_switching_locale_changes_only_subsequent_fanouts(self, client, db_session, auth_headers):
        token = _register(client, "switch@example.com")
        cat = client.post("/api/categories", json={"name": "Sw"}, headers=auth_headers).json()
        _follow_category(client, token, cat["id"])

        _publish(client, auth_headers, cat["id"], "switch-zh")
        assert client.get(NOTIFS, headers=_auth(token)).json()["items"][0]["title"] == "新文章发布"

        assert _set_locale(client, token, "en").status_code == 200
        _publish(client, auth_headers, cat["id"], "switch-en")

        inbox = client.get(NOTIFS, headers=_auth(token)).json()
        assert inbox["total"] == 2
        # newest first: the en publish landed after the switch
        assert inbox["items"][0]["title"] == "New post"
        # the older row keeps its zh copy
        assert inbox["items"][1]["title"] == "新文章发布"


class TestEmailCopy:
    def test_email_subject_and_body_follow_locale(self, client, db_session, auth_headers, monkeypatch):
        sink = _smtp_sink(monkeypatch)
        en_token = _register(client, "en-mail@example.com")
        zh_token = _register(client, "zh-mail@example.com")
        assert _set_locale(client, en_token, "en").status_code == 200
        for token in (en_token, zh_token):
            resp = client.patch(
                "/api/reader/me/notification-preferences",
                json={"kind": "email_new_post", "enabled": True},
                headers=_auth(token),
            )
            assert resp.status_code == 200, resp.text
        cat = client.post("/api/categories", json={"name": "MailCat"}, headers=auth_headers).json()
        _follow_category(client, en_token, cat["id"])
        _follow_category(client, zh_token, cat["id"])
        _publish(client, auth_headers, cat["id"], "mail-post")

        sent = {m["To"]: m for m in sink.sent}
        assert set(sent) == {"en-mail@example.com", "zh-mail@example.com"}
        assert sent["en-mail@example.com"]["Subject"] == "New post"
        assert _text_part(sent["en-mail@example.com"]).startswith("New post")
        assert "T mail-post" in _text_part(sent["en-mail@example.com"])
        assert sent["zh-mail@example.com"]["Subject"] == "新文章发布"
        assert "《T mail-post》" in _text_part(sent["zh-mail@example.com"])


class TestDigestLocalized:
    def test_digest_subject_and_body_follow_reader_locale(self, db_session):
        from app import models

        now = utc_now_naive()
        # build_digest_message is called per recipient by send_weekly_digest;
        # feed it the same args with each reader's locale the way the digest
        # job will, and prove the en/zh copy splits on the locale argument.
        post = models.Post(title="Digest Post", slug="digest-post", content="c", published=True)
        db_session.add(post)
        db_session.flush()
        base = {
            "from_addr": "blog@example.com",
            "posts": [post],
            "base_url": "https://blog.example.com",
            "window_start": now,
            "now_naive": now,
        }

        en_msg = build_digest_message(to_email="en-dig@example.com", display_name="EnReader", locale="en", **base)
        zh_msg = build_digest_message(to_email="zh-dig@example.com", display_name="中读者", locale="zh", **base)

        assert en_msg["Subject"] == "Weekly digest: 1 new post"
        assert "EnReader," in _text_part(en_msg)
        assert "this week" in _text_part(en_msg)
        assert "《" not in _text_part(en_msg)
        assert zh_msg["Subject"] == "本周精选：1 篇新文章"
        assert "中读者，" in _text_part(zh_msg)
        assert "本周精选" in _text_part(zh_msg)

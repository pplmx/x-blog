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


def _register(client, email, password="readerpass123", display_name=None):
    body = {"email": email, "password": password}
    if display_name is not None:
        body["display_name"] = display_name
    resp = client.post("/api/reader/register", json=body)
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


class TestNotificationCopyMatrix:
    """Direct unit matrix for every kind × locale (DEC-338/DEC-340)."""

    def test_matrix(self):
        from app.crud import notification_copy

        # (kind, post_title, locale, commenter, zh_title, zh_body, en_title, en_body)
        cases = [
            ("new_post", "hi", None, None, "新文章发布", "《hi》", "New post", "hi"),
            ("series_new_part", "hi", "zh", None, "系列更新", "《hi》", "Series update", "hi"),
            (
                "reply",
                "hi",
                "zh",
                None,
                "有人回复了你的评论",
                "《hi》有新回复",
                "Someone replied to your comment",
                "New reply on hi",
            ),
            (
                "thread_comment",
                "hi",
                "en",
                None,
                "你订阅的讨论有新评论",
                "《hi》有新评论",
                "New comment in a thread you follow",
                "New comment on hi",
            ),
            (
                "mention",
                "hi",
                "en",
                "Riki",
                "有人在评论中提到了你",
                "Riki 在《hi》中提到了你",
                "You were mentioned in a comment",
                "Riki mentioned you in hi",
            ),
        ]
        for kind, title, _locale, commenter, zh_t, zh_b, en_t, en_b in cases:
            # zh is the default (NULL / "zh" / any non-en) — assert it first.
            assert notification_copy(kind, title, "zh", commenter=commenter) == (zh_t, zh_b), kind
            assert notification_copy(kind, title, None, commenter=commenter) == (zh_t, zh_b), kind
            assert notification_copy(kind, title, "en", commenter=commenter) == (en_t, en_b), kind


class TestCommentKindCopy:
    def test_reply_copy_is_localized(self, client, db_session, auth_headers, monkeypatch):
        """An approved reply to an English reader's comment persists an English
        inbox row + email; a zh (default) reader keeps the Chinese copy."""
        sink = _smtp_sink(monkeypatch)
        en_email, zh_email, en_token, zh_token, parent_id = self._parent_comments(client, db_session, auth_headers)
        # Both parents opted into reply emails.
        for token in (en_token, zh_token):
            resp = client.patch(
                "/api/reader/me/notification-preferences",
                json={"kind": "email_reply", "enabled": True},
                headers=_auth(token),
            )
            assert resp.status_code == 200, resp.text
        # Reply to both and approve (admin) -> each parent gets a localized row.
        post_id = self._post_id
        for parent in (parent_id["en"], parent_id["zh"]):
            created = client.post(
                f"/api/comments/post/{post_id}",
                json={"nickname": "Replier", "email": "replier@example.com", "content": "r", "parent_id": parent},
            )
            assert created.status_code == 201, created.text
            ap = client.patch(
                f"/api/comments/{created.json()['id']}/approve", json={"approved": True}, headers=auth_headers
            )
            assert ap.status_code == 200, ap.text

        en_inbox = client.get(NOTIFS, headers=_auth(en_token)).json()["items"]
        zh_inbox = client.get(NOTIFS, headers=_auth(zh_token)).json()["items"]
        assert en_inbox[0]["kind"] == "reply"
        assert en_inbox[0]["title"] == "Someone replied to your comment"
        assert en_inbox[0]["body"] == "New reply on notif-locale-post"
        assert zh_inbox[0]["kind"] == "reply"
        assert zh_inbox[0]["title"] == "有人回复了你的评论"

        emails = {m["To"]: m for m in sink.sent}
        assert emails[en_email]["Subject"] == "Someone replied to your comment"
        assert "New reply on notif-locale-post" in _text_part(emails[en_email])
        assert emails[zh_email]["Subject"] == "有人回复了你的评论"

    def test_thread_comment_copy_is_localized(self, client, db_session, auth_headers):
        """An English reader following a thread gets an English thread-comment
        row; the zh default reader keeps the zh copy (same approval event)."""
        en_token = _register(client, "thr-en@example.com")
        zh_token = _register(client, "thr-zh@example.com")
        assert _set_locale(client, en_token, "en").status_code == 200

        from app.crud import create_post
        from app.schemas import PostCreate

        post = create_post(
            db_session, PostCreate(title="Locale thread", slug="locale-thread", content="c", published=True)
        )
        for token in (en_token, zh_token):
            sub = client.put(f"/api/posts/{post.id}/subscription", headers=_auth(token))
            assert sub.status_code in (200, 201), sub.text

        other = _register(client, "thr-other@example.com")
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "O", "email": "o@example.com", "content": "new comment"},
            headers=_auth(other),
        )
        assert created.status_code == 201, created.text
        ap = client.patch(
            f"/api/comments/{created.json()['id']}/approve", json={"approved": True}, headers=auth_headers
        )
        assert ap.status_code == 200, ap.text

        en_inbox = client.get(NOTIFS, headers=_auth(en_token)).json()["items"]
        zh_inbox = client.get(NOTIFS, headers=_auth(zh_token)).json()["items"]
        assert en_inbox[0]["kind"] == "thread_comment"
        assert en_inbox[0]["title"] == "New comment in a thread you follow"
        assert zh_inbox[0]["kind"] == "thread_comment"
        assert zh_inbox[0]["title"] == "你订阅的讨论有新评论"

    def test_mention_copy_is_localized(self, client, db_session, auth_headers):
        """An approved comment that @-mentions an English reader persists an
        English mention row with the commenter's label; zh stays Chinese."""
        en_token = _register(client, "men-en@example.com", display_name="Riki")
        zh_token = _register(client, "men-zh@example.com", display_name="张伟")
        assert _set_locale(client, en_token, "en").status_code == 200

        from app.crud import create_post
        from app.schemas import PostCreate

        post = create_post(
            db_session, PostCreate(title="Locale mention", slug="locale-mention", content="c", published=True)
        )
        other = _register(client, "men-other@example.com", display_name="Bob")
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "Bob", "email": "bob@example.com", "content": "hi @Riki and @张伟"},
            headers=_auth(other),
        )
        assert created.status_code == 201, created.text
        ap = client.patch(
            f"/api/comments/{created.json()['id']}/approve", json={"approved": True}, headers=auth_headers
        )
        assert ap.status_code == 200, ap.text

        en_inbox = client.get(NOTIFS, headers=_auth(en_token)).json()["items"]
        zh_inbox = client.get(NOTIFS, headers=_auth(zh_token)).json()["items"]
        assert en_inbox[0]["kind"] == "mention"
        assert en_inbox[0]["title"] == "You were mentioned in a comment"
        assert en_inbox[0]["body"] == "Bob mentioned you in Locale mention"
        assert zh_inbox[0]["kind"] == "mention"
        assert zh_inbox[0]["title"] == "有人在评论中提到了你"
        assert zh_inbox[0]["body"] == "Bob 在《Locale mention》中提到了你"

    # -- helpers ------------------------------------------------------------
    _post_id = None

    def _parent_comments(self, client, db_session, auth_headers):
        """Two approved reader root comments (one en, one zh default). Returns
        both emails, both tokens, and a {en: id, zh: id} parent-id map."""
        from app.crud import approve_comment, create_post
        from app.schemas import PostCreate

        post = create_post(
            db_session, PostCreate(title="notif-locale-post", slug="notif-locale-post", content="c", published=True)
        )
        self._post_id = post.id
        en_email = "par-en@example.com"
        zh_email = "par-zh@example.com"
        en_token = _register(client, en_email, display_name="PEn")
        zh_token = _register(client, zh_email, display_name="PZh")
        assert _set_locale(client, en_token, "en").status_code == 200
        ids = {}
        for mail, tok in ((en_email, en_token), (zh_email, zh_token)):
            created = client.post(
                f"/api/comments/post/{post.id}",
                json={"nickname": mail.split("@")[0], "email": mail, "content": "parent"},
                headers=_auth(tok),
            )
            assert created.status_code == 201, created.text
            approve_comment(db_session, created.json()["id"], approved=True)
            ids["en" if mail == en_email else "zh"] = created.json()["id"]
        return en_email, zh_email, en_token, zh_token, ids


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

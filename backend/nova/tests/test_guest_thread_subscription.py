"""Guest email thread-follow contract + fan-out tests (DEC-427, TASK-438).

Comment-thread follow (DEC-078) was reader-gated — ``PUT /posts/{id}/subscription``
requires a reader account and the post-page control redirects guests to /login
— yet the blog already emails anonymous addresses for the newsletter (DEC-351)
and reply notices (DEC-332). This feature gives an anonymous visitor the same
ability for a discussion: subscribe a post's thread by email (double opt-in,
mirroring ``NewsletterSubscriber``), get one email per new APPROVED comment
with a one-click unsubscribe, and never need an account.

Key properties:
- POST /api/posts/{id}/comment-subscription/guest {email} is auth-free, 202,
  and returns a generic message (no address-existence oracle); a NEW row sends
  exactly ONE double-opt-in confirmation email, a resubscribe sends none;
- confirm/unsubscribe ({token}) are auth-free, idempotent 200 on the happy/
  stale path and a uniform 404 for an unknown token (no token oracle);
- fan-out: on comment approval, every CONFIRMED guest subscriber of the post
  gets a per-comment email (deep link + one-click unsubscribe), pending and
  unsubscribed rows get nothing, and the commenter's own guest address is
  skipped; best effort (SMTP unconfigured never breaks the approval).
"""

from uuid import uuid4

from app.schemas import PostCreate

BASE = "/api/posts/{post_id}/comment-subscription/guest"


def _create_post(db_session, slug=None):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(
            title=f"Thread {uuid4().hex[:4]}",
            slug=slug or f"guest-thread-{uuid4().hex[:8]}",
            content="# Hi",
            published=True,
        ),
    )


def _subscribe(client, post_id, email):
    return client.post(BASE.format(post_id=post_id), json={"email": email})


def _confirm(client, token):
    return client.post("/api/posts/comment-subscription/guest/confirm", json={"token": token})


def _unsubscribe(client, token):
    return client.post("/api/posts/comment-subscription/guest/unsubscribe", json={"token": token})


def _digest(client, token, digest_weekly):
    return client.post(
        "/api/posts/comment-subscription/guest/digest",
        json={"token": token, "digest_weekly": digest_weekly},
    )


def _comment(client, post_id, content, token=None, nickname="Guest", email=None):
    body = {"content": content, "nickname": nickname, "email": email or "guest@example.com"}
    client_headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(f"/api/comments/post/{post_id}", json=body, headers=client_headers)


def _approve(client, auth_headers, comment_id):
    resp = client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    sent: list = []
    instances: list = []

    def __init__(self, *args, **kwargs):
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def starttls(self, context=None):
        return None

    def login(self, user, password):
        return None

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)

    def quit(self):
        return None


def _sink(monkeypatch) -> type[FakeSMTP]:
    """Configure SMTP against the fake sink and reset its capture per test."""
    FakeSMTP.instances = []
    FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    return FakeSMTP


def _to(sink: type[FakeSMTP], address: str) -> list:
    return [m for m in sink.sent if m["To"] == address]


def _plain(msg) -> str:
    parts = [p for p in msg.walk() if p.get_content_type() == "text/plain"]
    return "\n".join(p.get_payload(decode=True).decode("utf-8", "replace") for p in parts)


def _fanout_to(sink: type[FakeSMTP], address: str) -> list:
    """Thread fan-out emails to ``address``, excluding the double-opt-in confirm."""
    return [m for m in _to(sink, address) if "/comment-subscribe/confirm" not in _plain(m)]


class TestSubscribeContract:
    def test_missing_or_invalid_email_is_422(self, client, db_session):
        post = _create_post(db_session)
        for payload in ({}, {"email": ""}, {"email": "nope"}):
            r = client.post(BASE.format(post_id=post.id), json=payload)
            assert r.status_code == 422, payload

    def test_auth_free_and_generic(self, client, db_session):
        post = _create_post(db_session)
        r = _subscribe(client, post.id, "guest@example.com")
        assert r.status_code == 202
        assert r.json()["subscribed"] is True

    def test_confirmation_email_sent_on_new_row_only(self, client, db_session, monkeypatch):
        post = _create_post(db_session)
        sink = _sink(monkeypatch)
        assert _subscribe(client, post.id, "dup@example.com").status_code == 202
        assert _subscribe(client, post.id, "dup@example.com").status_code == 202
        # Exactly ONE confirmation email for the address, whatever the outcome.
        assert len(_to(sink, "dup@example.com")) == 1
        body = _plain(_to(sink, "dup@example.com")[0])
        assert "/comment-subscribe/confirm" in body

    def test_email_normalized_lowercase(self, client, db_session):
        from app import models

        post = _create_post(db_session)
        _subscribe(client, post.id, "   MiXeD@Example.COM ")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "mixed@example.com")
            .one()
        )
        assert row.post_id == post.id
        assert row.is_confirmed is False

    def test_unknown_post_is_uniform_404(self, client):
        assert _subscribe(client, 999999, "nobody@example.com").status_code == 404

    def test_subscribe_accepts_digest_weekly_cadence(self, client, db_session):
        """The subscribe body may pick the weekly cadence up front (DEC-429)."""
        from app import models

        post = _create_post(db_session)
        r = client.post(
            BASE.format(post_id=post.id),
            json={"email": "weekly@example.com", "digest_weekly": True},
        )
        assert r.status_code == 202
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "weekly@example.com")
            .one()
        )
        assert row.digest_weekly is True
        # Default stays per-comment.
        r2 = client.post(BASE.format(post_id=post.id), json={"email": "instant@example.com"})
        assert r2.status_code == 202
        row2 = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "instant@example.com")
            .one()
        )
        assert row2.digest_weekly is False


class TestConfirmAndUnsubscribe:
    def test_confirm_flips_confirmed_and_is_idempotent(self, client, db_session, monkeypatch):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "cf@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "cf@example.com")
            .one()
        )
        assert _confirm(client, row.token).status_code == 200
        db_session.refresh(row)
        assert row.is_confirmed is True
        # Second click is a 200, still confirmed.
        assert _confirm(client, row.token).status_code == 200

    def test_unsubscribe_flips_off_and_is_idempotent(self, client, db_session, monkeypatch):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "un@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "un@example.com")
            .one()
        )
        _confirm(client, row.token)
        assert _unsubscribe(client, row.token).status_code == 200
        db_session.refresh(row)
        assert row.is_confirmed is False
        assert _unsubscribe(client, row.token).status_code == 200

    def test_unknown_token_is_404(self, client):
        assert _confirm(client, "bogus").status_code == 404
        assert _unsubscribe(client, "bogus").status_code == 404
        assert _digest(client, "bogus", True).status_code == 404

    def test_unsubscribe_stamps_unsubscribed_at(self, client, db_session, monkeypatch):
        """Unsubscribing marks the row's consent as cancelled (TASK-485)."""
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "stamp@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "stamp@example.com")
            .one()
        )
        _confirm(client, row.token)
        _unsubscribe(client, row.token)
        db_session.refresh(row)
        assert row.is_confirmed is False
        assert row.unsubscribed_at is not None

    def test_replaying_old_confirm_link_after_unsubscribe_is_400(self, client, db_session, monkeypatch):
        """The round-393 consent-restart gate must cover the guest thread too
        (TASK-485/ISS-561): replaying the ORIGINAL confirmation link after an
        unsubscribe silently re-subscribed before — now it is a 400."""
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "replay@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "replay@example.com")
            .one()
        )
        _confirm(client, row.token)
        _unsubscribe(client, row.token)
        resp = _confirm(client, row.token)
        assert resp.status_code == 400
        assert "unsubscribed" in resp.json()["error"]["message"]
        db_session.refresh(row)
        assert row.is_confirmed is False  # not silently re-subscribed

    def test_resubscribing_unsubscribed_address_restarts_opt_in(self, client, db_session, monkeypatch):
        """Re-subscribing a cancelled address rotates the token and sends a
        FRESH double-opt-in email (TASK-485) — no more dead-end that claimed
        success while no mail would ever arrive."""
        from uuid import uuid4

        from app import models

        post = _create_post(db_session)
        sink = _sink(monkeypatch)
        email = f"again-{uuid4().hex[:6]}@example.com"
        _subscribe(client, post.id, email)
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == email)
            .one()
        )
        _confirm(client, row.token)
        _unsubscribe(client, row.token)
        db_session.refresh(row)
        old_token = row.token

        assert _subscribe(client, post.id, email).status_code == 202
        db_session.refresh(row)
        # Token rotated, consent reset, cancellation cleared — a fresh cycle.
        assert row.token != old_token
        assert row.is_confirmed is False
        assert row.unsubscribed_at is None
        # Exactly ONE confirmation email for this address in total, and the
        # second (re-activation) one carries the NEW token's link.
        confirm_msgs = _to(sink, email)
        assert len(confirm_msgs) == 2
        assert "/comment-subscribe/confirm" in _plain(confirm_msgs[0])
        assert "/comment-subscribe/confirm" in _plain(confirm_msgs[1])

    def test_reactivated_row_confirms_with_fresh_token(self, client, db_session, monkeypatch):
        """After a re-subscribe rotates the token, only the NEW confirmation
        link confirms; the old token no longer resolves (rotated away -> 404),
        so a stale link from a cancelled cycle can never re-activate."""
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "fresh@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "fresh@example.com")
            .one()
        )
        _confirm(client, row.token)
        _unsubscribe(client, row.token)
        db_session.refresh(row)
        old_token = row.token
        _subscribe(client, post.id, "fresh@example.com")
        db_session.refresh(row)

        # Old (rotated) link: 404 — gone, no oracle. New link: 200 and confirmed.
        assert _confirm(client, old_token).status_code == 404
        assert _confirm(client, row.token).status_code == 200
        db_session.refresh(row)
        assert row.is_confirmed is True

    def test_confirm_reports_digest_weekly_cadence(self, client, db_session, monkeypatch):
        """The confirm response rides the stored cadence back so the confirm page
        can seed its weekly-summary toggle (DEC-429, newsletter parity)."""
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "seed@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "seed@example.com")
            .one()
        )
        body = _confirm(client, row.token).json()
        assert body["confirmed"] is True
        assert body["digest_weekly"] is False
        assert _digest(client, row.token, True).status_code == 200
        body = _confirm(client, row.token).json()
        assert body["digest_weekly"] is True

    def test_digest_flip_is_idempotent(self, client, db_session, monkeypatch):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "flip@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "flip@example.com")
            .one()
        )
        assert _digest(client, row.token, True).json() == {"digest_weekly": True, "updated": True}
        db_session.refresh(row)
        assert row.digest_weekly is True
        # Re-flipping to the same value is a 200 (idempotent).
        assert _digest(client, row.token, True).status_code == 200
        assert _digest(client, row.token, False).json() == {"digest_weekly": False, "updated": True}
        db_session.refresh(row)
        assert row.digest_weekly is False


class TestThreadFanOut:
    def _setup(self, client, db_session, monkeypatch, guest_email, post=None):
        from app import models

        post = post or _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, guest_email)
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == guest_email)
            .one()
        )
        _confirm(client, row.token)
        return post, row

    def test_confirmed_guest_gets_email_per_approved_comment(self, client, db_session, monkeypatch, auth_headers):
        post, _ = self._setup(client, db_session, monkeypatch, "fan@example.com")
        sink = FakeSMTP
        created = _comment(client, post.id, "a new thread comment", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])
        msgs = _fanout_to(sink, "fan@example.com")
        assert len(msgs) == 1
        body = _plain(msgs[0])
        assert f"/posts/{post.slug}#comment-" in body  # deep link
        assert "/comment-subscribe/unsubscribe" in body  # one-click unsubscribe

    def test_pending_subscriber_gets_nothing(self, client, db_session, monkeypatch, auth_headers):
        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "pending@example.com")  # never confirmed
        created = _comment(client, post.id, "chatter", email="x@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "pending@example.com") == []

    def test_unsubscribed_rows_stay_silent(self, client, db_session, monkeypatch, auth_headers):
        from app import models

        post, _ = self._setup(client, db_session, monkeypatch, "gone@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "gone@example.com")
            .one()
        )
        _unsubscribe(client, row.token)
        created = _comment(client, post.id, "after unsub", email="x@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "gone@example.com") == []

    def test_commenters_own_guest_email_is_skipped(self, client, db_session, monkeypatch, auth_headers):
        post, _ = self._setup(client, db_session, monkeypatch, "mine@example.com")
        # The same guest who follows the thread comments on it afterward.
        created = _comment(client, post.id, "also following", email="mine@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "mine@example.com") == []

    def test_digest_weekly_subscriber_gets_no_per_comment_mail(self, client, db_session, monkeypatch, auth_headers):
        """A follower on the weekly cadence is served by the digest only — one
        channel per subscriber (DEC-429), so the approval fan-out stays silent."""
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "dig@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "dig@example.com")
            .one()
        )
        assert _digest(client, row.token, True).status_code == 200
        _confirm(client, row.token)
        created = _comment(client, post.id, "for the weekly shrinker", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "dig@example.com") == []
        # They still got exactly ONE mail so far: the double-opt-in confirm.
        assert len(_to(FakeSMTP, "dig@example.com")) == 1

    def test_all_confirmed_subscribers_are_emailed(self, client, db_session, monkeypatch, auth_headers):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        for email in ("one@example.com", "two@example.com", "three@example.com"):
            _subscribe(client, post.id, email)
            row = (
                db_session.query(models.GuestCommentSubscription)
                .filter(models.GuestCommentSubscription.email == email)
                .one()
            )
            _confirm(client, row.token)
        # Reset the instance counter so the count below isolates the approval's
        # fan-out from the 3 per-confirmation sessions above.
        FakeSMTP.instances = []
        created = _comment(client, post.id, "broadcast", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert len(_fanout_to(FakeSMTP, "one@example.com")) == 1
        assert len(_fanout_to(FakeSMTP, "two@example.com")) == 1
        assert len(_fanout_to(FakeSMTP, "three@example.com")) == 1
        # Round-433 capacity regression: every recipient must be delivered over
        # ONE SMTP session. The old per-subscriber send opened a fresh
        # connection per address in a serial loop (3 subscribers = 3 SMTP
        # connects inside one approval request); the batched fan-out must spin
        # up exactly one.
        assert len(FakeSMTP.instances) == 1, FakeSMTP.instances

    def test_reader_comment_also_fans_out(self, client, db_session, monkeypatch, auth_headers):
        from uuid import uuid4 as _u4

        post, _ = self._setup(client, db_session, monkeypatch, "rfan@example.com")
        token = client.post(
            "/api/reader/register",
            json={"email": f"reader{_u4().hex[:4]}@example.com", "password": "readerpass123"},
        ).json()["access_token"]
        created = _comment(client, post.id, "reader take", token=token, nickname="R")
        _approve(client, auth_headers, created.json()["id"])
        assert len(_fanout_to(FakeSMTP, "rfan@example.com")) == 1

    def test_smtp_unconfigured_never_breaks_approval(self, client, db_session, monkeypatch, auth_headers):
        post, _ = self._setup(client, db_session, monkeypatch, "off@example.com")
        monkeypatch.delenv("SMTP_HOST", raising=False)
        monkeypatch.delenv("SMTP_PORT", raising=False)
        created = _comment(client, post.id, "no email infra", email="x@example.com")
        resp = client.patch(
            f"/api/comments/{created.json()['id']}/approve",
            json={"approved": True},
            headers=auth_headers,
        )
        assert resp.status_code == 200


class TestThreadWeeklyDigest:
    """The weekly thread-digest job (DEC-429): a confirmed follower on the
    weekly cadence gets ONE summary email per (address, thread) with that
    window's approved comments instead of a mail per comment; the window starts
    at the last send and the job never raises."""

    def _run(self, db_session, **kw):
        from app.digest import send_weekly_digest

        return send_weekly_digest(db_session, **kw)

    def _confirm_digest_row(self, client, db_session, email, post_id):
        from app import models

        _subscribe(client, post_id, email)
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == email)
            .one()
        )
        assert _digest(client, row.token, True).status_code == 200
        _confirm(client, row.token)
        return row

    def test_confirmed_weekly_follower_gets_one_digest_email(self, client, db_session, monkeypatch, auth_headers):
        post = _create_post(db_session)
        _sink(monkeypatch)
        row = self._confirm_digest_row(client, db_session, "dwk@example.com", post.id)
        created = _comment(client, post.id, "digest me", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])

        summary = self._run(db_session)
        assert summary["thread_subscribers"] == 1

        msgs = _to(FakeSMTP, "dwk@example.com")
        assert len(msgs) == 2  # the double-opt-in confirm + ONE digest
        assert "本周 1 条新评论" in msgs[1]["Subject"]
        body = _plain(msgs[1])
        assert f"/posts/{post.slug}#comment-{created.json()['id']}" in body
        assert "/comment-subscribe/unsubscribe" in body
        db_session.refresh(row)
        assert row.digest_sent_at is not None

    def test_digest_aggregates_only_approved_comments_in_window(self, client, db_session, monkeypatch, auth_headers):
        from datetime import UTC, datetime, timedelta

        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        self._confirm_digest_row(client, db_session, "scope@example.com", post.id)
        # Approved BEFORE the window (10 days ago) — must not appear.
        old = _comment(client, post.id, "old news", email="other@example.com")
        old_row = db_session.get(models.Comment, old.json()["id"])
        old_row.created_at = datetime.now(UTC) - timedelta(days=10)
        db_session.commit()
        _approve(client, auth_headers, old.json()["id"])
        # Still PENDING in the window — must not appear (moderation gate).
        pending = _comment(client, post.id, "still pending", email="other2@example.com")
        # Fresh approved comment — appears.
        fresh = _comment(client, post.id, "fresh news", email="other3@example.com")
        _approve(client, auth_headers, fresh.json()["id"])

        self._run(db_session)
        digest = _to(FakeSMTP, "scope@example.com")[-1]
        body = _plain(digest)
        assert f"#comment-{fresh.json()['id']}" in body
        assert f"#comment-{old.json()['id']}" not in body
        assert f"#comment-{pending.json()['id']}" not in body

    def test_digest_is_idempotent_after_stamp(self, client, db_session, monkeypatch, auth_headers):
        post = _create_post(db_session)
        _sink(monkeypatch)
        self._confirm_digest_row(client, db_session, "once@example.com", post.id)
        created = _comment(client, post.id, "one summary lap", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])

        assert self._run(db_session)["thread_subscribers"] == 1
        # The window now starts at the stamped send time: no new comments -> no mail.
        assert self._run(db_session)["thread_subscribers"] == 0
        assert len(_to(FakeSMTP, "once@example.com")) == 2  # confirm + the one digest

    def test_pending_and_unsubscribed_rows_never_get_a_digest(self, client, db_session, monkeypatch, auth_headers):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        # Weekly cadence but never confirmed — the confirm gate still applies.
        _subscribe(client, post.id, "pend@example.com")
        pend = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "pend@example.com")
            .one()
        )
        _digest(client, pend.token, True)
        # Confirmed weekly then unsubscribed — consent revoked.
        _subscribe(client, post.id, "gone@example.com")
        gone = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "gone@example.com")
            .one()
        )
        _digest(client, gone.token, True)
        _confirm(client, gone.token)
        _unsubscribe(client, gone.token)
        # One healthy weekly control.
        self._confirm_digest_row(client, db_session, "ctl@example.com", post.id)
        created = _comment(client, post.id, "for the control", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])

        summary = self._run(db_session)
        assert summary["thread_subscribers"] == 1
        # pend/gone still hold only their subscribe-time confirm email.
        assert len(_to(FakeSMTP, "pend@example.com")) == 1
        assert len(_to(FakeSMTP, "gone@example.com")) == 1
        assert len(_to(FakeSMTP, "ctl@example.com")) == 2  # confirm + digest

    def test_smtp_unconfigured_never_breaks_the_job(self, client, db_session, monkeypatch, auth_headers):
        post = _create_post(db_session)
        _sink(monkeypatch)
        row = self._confirm_digest_row(client, db_session, "offwk@example.com", post.id)
        created = _comment(client, post.id, "no smtp", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])

        monkeypatch.delenv("SMTP_HOST", raising=False)
        monkeypatch.delenv("SMTP_PORT", raising=False)
        summary = self._run(db_session)
        assert summary["reason"] == "smtp_not_configured"
        db_session.refresh(row)
        assert row.digest_sent_at is None

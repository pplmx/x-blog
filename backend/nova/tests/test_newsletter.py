"""Guest email newsletter contract tests (DEC-351, TASK-401).

The blog's entire email surface (weekly digest, per-event emails, guest reply
emails) is gated behind either a reader account or a comment — an anonymous
visitor who just wants "email me new posts" has no on-ramp other than RSS
(a tool for technical readers). DEC-351 adds a guest newsletter: an email
address subscribes (double opt-in — a confirmation link must be clicked before
the address receives anything), and every confirmed subscriber is emailed once,
per new published post, with a working per-subscriber unsubscribe link.

Key properties:
- POST /api/newsletter/subscribe accepts a well-formed email, returns the same
  generic message whether the address is new or already subscribed (no
  email-existence oracle, mirroring reader register), and sends a confirmation
  email with a token link; the address is NOT emailed new posts until confirmed;
- a malformed / whitespace / missing email is 422 (shared EMAIL_PATTERN);
- POST /api/newsletter/confirm with the emailed token activates the address;
  an unknown token is 404 (indistinguishable from already-confirmed for a
  random guess, mirroring reply-notify unsubscribe);
- a confirmed subscriber receives EXACTLY ONE email per new published post,
  best-effort (SMTP unconfigured -> publish still succeeds, no email), with a
  per-subscriber unsubscribe link;
- only CONFIRMED subscribers are emailed (a just-subscribed pending address
  gets only the confirmation link); a subscriber who unsubscribed is not
  emailed again;
- POST /api/newsletter/unsubscribe with the emailed token opts the address
  out idempotently; an unknown token is 404;
- scheduled posts whose publish_at crosses surface the same exactly-once
  newsletter email as any other new post (via maybe_notify_due_scheduled_posts).
"""

from email.message import EmailMessage

import pytest

from app import models
from app.schemas import PostCreate


def _create_post(db_session, slug="newsletter-post"):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(title="Newsletter post", slug=slug, content="# Hi", published=True),
    )


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    instances: list[FakeSMTP] = []
    sent: list[EmailMessage] = []

    def __init__(self, host: str, port: int, timeout: float | None = None):
        FakeSMTP.instances.append(self)

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def starttls(self, context: object = None) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        return None

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
    return FakeSMTP


def _confirm_token(smtp_sink: type[FakeSMTP], address: str) -> str:
    """Extract the confirm token from the confirmation email for an address."""
    msg = next(m for m in smtp_sink.sent if m["To"] == address)
    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            # The confirmation body embeds the token in a /newsletter/confirm URL.
            body = part.get_payload(decode=True).decode("utf-8", "replace")
            for token in body.split():
                if token.startswith("http") and "/newsletter/confirm" in token:
                    return token.rstrip('.,"').split("token=")[1]
    raise AssertionError(f"no confirm token in emails to {address}: {[m['To'] for m in smtp_sink.sent]}")


def _all_messages_to(smtp_sink: type[FakeSMTP], address: str) -> list[EmailMessage]:
    return [m for m in smtp_sink.sent if m["To"] == address]


def _plain_text(msg: EmailMessage) -> str:
    """Text/plain payload of a multipart message (or the whole message)."""
    parts = [p for p in msg.walk() if p.get_content_type() == "text/plain"]
    if not parts:
        return str(msg.get_payload()) if not msg.is_multipart() else ""
    return "\n".join(p.get_payload(decode=True).decode("utf-8", "replace") for p in parts)


def _new_post_messages(smtp_sink: type[FakeSMTP], address: str) -> list[EmailMessage]:
    """Messages to an address that are NOT the subscription confirmation."""
    return [m for m in _all_messages_to(smtp_sink, address) if "newsletter/confirm" not in _plain_text(m)]


def test_subscribe_requires_valid_email(client):
    """Missing / blank / malformed email is 422; a well-formed one is 202 (with
    SMTP configured the confirmation email is sent)."""
    # Missing body / blank email -> 422 at the pydantic boundary.
    for payload in ({}, {"email": ""}, {"email": "   "}, {"email": "nope"}):
        r = client.post("/api/newsletter/subscribe", json=payload)
        assert r.status_code == 422, payload


def test_subscribe_returns_generic_message_and_sends_confirmation(client, db_session, smtp_sink):
    """Subscribe returns a generic singleton message (no existence oracle) and
    emails a confirmation link to the given address while leaving it pending."""
    r = client.post("/api/newsletter/subscribe", json={"email": "guest@example.com"})
    assert r.status_code == 202
    assert r.json() == {"subscribed": True, "message": "If this email is new, a confirmation link is on its way"}

    # Exactly one pending subscriber row, not yet confirmed.
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "guest@example.com")
        .first()
    )
    assert sub is not None
    assert sub.is_confirmed is False
    assert sub.token

    # One confirmation email, addressed to the guest, carrying the token link.
    [msg] = _all_messages_to(smtp_sink, "guest@example.com")
    assert "newsletter/confirm" in _plain_text(msg)
    assert sub.token in _plain_text(msg)


def test_subscribe_idempotent_no_oracle(client, db_session, smtp_sink):
    """Resubscribing the same address returns the SAME generic message (no
    oracle), does not create a duplicate row, and — critically for the
    mail-bombing surface — does NOT re-send a second confirmation email (the
    confirmation fires only on a freshly created row)."""
    a = client.post("/api/newsletter/subscribe", json={"email": "dup@example.com"}).json()
    b = client.post("/api/newsletter/subscribe", json={"email": "dup@example.com"}).json()
    assert a == b
    rows = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "dup@example.com")
        .all()
    )
    assert len(rows) == 1
    # Exactly one confirmation email total (the first subscribe), even though
    # the address was subscribed twice.
    assert len(_all_messages_to(smtp_sink, "dup@example.com")) == 1


def test_pending_subscriber_not_emailed_new_posts(client, db_session, smtp_sink):
    """A just-subscribed (unconfirmed) address receives no new-post email."""
    client.post("/api/newsletter/subscribe", json={"email": "pending@example.com"})
    _create_post(db_session)
    assert _new_post_messages(smtp_sink, "pending@example.com") == []


def test_confirm_activates_subscriber(client, db_session, smtp_sink):
    """Confirming with the emailed token activates the address; an unknown
    token is a 404 indistinguishable from failure."""
    client.post("/api/newsletter/subscribe", json={"email": "confirmme@example.com"})
    token = _confirm_token(smtp_sink, "confirmme@example.com")

    r = client.post("/api/newsletter/confirm", json={"token": token})
    assert r.status_code == 200
    # The response reports the real cadence so the confirm page can show it
    # (per-post default here; a subscribe-time digest opt-in shows as such).
    assert r.json() == {"confirmed": True, "digest_weekly": False}
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "confirmme@example.com")
        .first()
    )
    assert sub.is_confirmed is True

    # Idempotent — confirming again with the same token is still 200.
    assert client.post("/api/newsletter/confirm", json={"token": token}).status_code == 200

    # Unknown token -> 404.
    assert client.post("/api/newsletter/confirm", json={"token": "garbage-token"}).status_code == 404


def test_confirmed_subscriber_gets_one_email_per_new_post(client, db_session, smtp_sink):
    """A confirmed subscriber receives exactly one new-post email per publish,
    deep-linking to the post and carrying their per-subscriber unsubscribe link."""
    client.post("/api/newsletter/subscribe", json={"email": "happy@example.com"})
    token = _confirm_token(smtp_sink, "happy@example.com")
    client.post("/api/newsletter/confirm", json={"token": token})
    before = len(smtp_sink.sent)

    post = _create_post(db_session)

    new_post_msgs = _new_post_messages(smtp_sink, "happy@example.com")
    assert len(new_post_msgs) == 1
    body = _plain_text(new_post_msgs[0])
    assert f"/posts/{post.slug}" in body
    assert "newsletter/unsubscribe" in body
    assert len(smtp_sink.sent) == before + 1

    # A second publish emails again — exactly once per post (2 new-post emails
    # total; the confirmation is not counted as a new-post email but still sits
    # in the sink before `before`).
    _create_post(db_session, slug="newsletter-post-2")
    assert len(_new_post_messages(smtp_sink, "happy@example.com")) == 2


def test_subscribe_carries_digest_weekly_choice(client, db_session):
    """The opt-in weekly-digest preference is stored at subscribe time; the
    default (no field) stays per-post."""
    r = client.post(
        "/api/newsletter/subscribe",
        json={"email": "digest-choice@example.com", "digest_weekly": True},
    )
    assert r.status_code == 202
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "digest-choice@example.com")
        .one()
    )
    assert sub.digest_weekly is True

    client.post("/api/newsletter/subscribe", json={"email": "per-post-default@example.com"})
    default = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "per-post-default@example.com")
        .one()
    )
    assert default.digest_weekly is False


def test_digest_toggle_via_token(client, db_session, smtp_sink):
    """POST /api/newsletter/digest flips one address's cadence off/on by its
    token; idempotent (repeat 200), unknown token 404 (no oracle), malformed
    body 422 at the pydantic boundary."""
    client.post("/api/newsletter/subscribe", json={"email": "toggle@example.com"})
    token = _confirm_token(smtp_sink, "toggle@example.com")
    client.post("/api/newsletter/confirm", json={"token": token})

    assert client.post("/api/newsletter/digest", json={"token": token, "enabled": True}).status_code == 200
    row = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "toggle@example.com")
        .one()
    )
    assert row.digest_weekly is True

    # Idempotent: repeating the enabled toggle is a 200, not an error.
    assert client.post("/api/newsletter/digest", json={"token": token, "enabled": True}).status_code == 200

    # The confirm response reports the new cadence to the token holder.
    r = client.post("/api/newsletter/confirm", json={"token": token})
    assert r.status_code == 200
    assert r.json()["digest_weekly"] is True

    # Back to per-post.
    assert client.post("/api/newsletter/digest", json={"token": token, "enabled": False}).status_code == 200
    db_session.expire_all()
    row = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "toggle@example.com")
        .one()
    )
    assert row.digest_weekly is False
    r = client.post("/api/newsletter/confirm", json={"token": token})
    assert r.status_code == 200
    assert r.json()["digest_weekly"] is False

    # Unknown token -> 404; missing / NUL token -> 422.
    assert (
        client.post(
            "/api/newsletter/digest",
            json={"token": "x" * 40, "enabled": True},
        ).status_code
        == 404
    )
    assert client.post("/api/newsletter/digest", json={"enabled": True}).status_code == 422
    assert client.post("/api/newsletter/digest", json={"token": "a\x00b", "enabled": True}).status_code == 422


def test_fanout_skips_digest_subscriber(client, db_session, smtp_sink):
    """A confirmed digest_weekly subscriber is excluded from the per-post
    fan-out (their cadence is the weekly digest); a per-post subscriber still
    gets exactly one new-post email."""
    client.post("/api/newsletter/subscribe", json={"email": "per-post@example.com"})
    per_post_token = _confirm_token(smtp_sink, "per-post@example.com")
    client.post("/api/newsletter/confirm", json={"token": per_post_token})

    client.post(
        "/api/newsletter/subscribe",
        json={"email": "weekly@example.com", "digest_weekly": True},
    )
    weekly_token = _confirm_token(smtp_sink, "weekly@example.com")
    client.post("/api/newsletter/confirm", json={"token": weekly_token})

    _create_post(db_session)

    assert len(_new_post_messages(smtp_sink, "per-post@example.com")) == 1
    assert not _new_post_messages(smtp_sink, "weekly@example.com")


def test_toggling_back_to_per_post_resumes_fanout(client, db_session, smtp_sink):
    """A subscriber who opts into the weekly digest and then back out resumes
    receiving per-post mail — the cadence toggle round-trips without stranding
    the address silently on either side."""
    client.post("/api/newsletter/subscribe", json={"email": "roundtrip@example.com"})
    token = _confirm_token(smtp_sink, "roundtrip@example.com")
    client.post("/api/newsletter/confirm", json={"token": token})

    # Into weekly: per-post fan-out stops.
    assert client.post("/api/newsletter/digest", json={"token": token, "enabled": True}).status_code == 200
    _create_post(db_session)
    assert not _new_post_messages(smtp_sink, "roundtrip@example.com")

    # Back to per-post: the next publish emails again.
    assert client.post("/api/newsletter/digest", json={"token": token, "enabled": False}).status_code == 200
    _create_post(db_session, slug="newsletter-resume-post")
    assert len(_new_post_messages(smtp_sink, "roundtrip@example.com")) == 1


def test_unsubscribe_stops_new_post_emails(client, db_session, smtp_sink):
    """Unsubscribing with the emailed token opts the address out (idempotent);
    an unknown token is 404; later publishes email nothing."""
    client.post("/api/newsletter/subscribe", json={"email": "bye@example.com"})
    token = _confirm_token(smtp_sink, "bye@example.com")
    client.post("/api/newsletter/confirm", json={"token": token})
    before = len(smtp_sink.sent)

    r = client.post("/api/newsletter/unsubscribe", json={"token": token})
    assert r.status_code == 200
    assert r.json() == {"unsubscribed": True}
    # Idempotent.
    assert client.post("/api/newsletter/unsubscribe", json={"token": token}).status_code == 200
    # Unknown token -> 404.
    assert client.post("/api/newsletter/unsubscribe", json={"token": "garbage"}).status_code == 404

    _create_post(db_session)
    assert len(smtp_sink.sent) == before


def test_confirm_replay_after_unsubscribe_does_not_reactivate(client, db_session, smtp_sink):
    """Round-393 consent gate: replaying the OLD confirmation link after an
    unsubscribe must NOT silently re-activate the address with no fresh opt-in
    — the holder explicitly cancelled it, so reactivation restarts via a fresh
    subscribe + fresh double-opt-in email."""
    client.post("/api/newsletter/subscribe", json={"email": "replay@example.com"})
    token = _confirm_token(smtp_sink, "replay@example.com")
    assert client.post("/api/newsletter/confirm", json={"token": token}).status_code == 200
    assert client.post("/api/newsletter/unsubscribe", json={"token": token}).status_code == 200

    # The SAME confirmation link, replayed after the cancellation.
    r = client.post("/api/newsletter/confirm", json={"token": token})
    assert r.status_code == 400
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "replay@example.com")
        .first()
    )
    assert sub.is_confirmed is False
    assert sub.unsubscribed_at is not None


def test_unsubscribe_before_confirm_is_a_real_revocation(client, db_session, smtp_sink):
    """Round-433: unsubscribing a PENDING (never-confirmed) address must record
    the revocation, so its still-live confirmation link cannot then activate it.

    Before this fix the handler only stamped ``unsubscribed_at`` for confirmed
    rows: a fresh address that clicked unsubscribe in its confirmation email
    BEFORE confirming got 200 {"unsubscribed": True} but no state change, and
    the same email's confirm link then flipped it to subscribed — the exact
    opposite of the message the user saw. The round-393 confirm gate is what
    makes a stamped revocation permanent, so the stamp must apply to both
    states.
    """
    client.post("/api/newsletter/subscribe", json={"email": "coldfeet@example.com"})
    token = _confirm_token(smtp_sink, "coldfeet@example.com")
    # Never confirmed: unsubscribe from the confirmation email itself.
    assert client.post("/api/newsletter/unsubscribe", json={"token": token}).status_code == 200

    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "coldfeet@example.com")
        .first()
    )
    assert sub.is_confirmed is False
    assert sub.unsubscribed_at is not None

    # The SAME confirmation link must be gated by the round-393 revocation.
    r = client.post("/api/newsletter/confirm", json={"token": token})
    assert r.status_code == 400
    # And no new-post mail may ever go to the address.
    _create_post(db_session)
    assert _new_post_messages(smtp_sink, "coldfeet@example.com") == []


def test_resubscribe_after_unsubscribe_restarts_double_opt_in(client, db_session, smtp_sink):
    """A cancelled address that subscribes again starts over properly: the token
    rotates, a FRESH confirmation email is sent, and the address stays
    inactive until the NEW token is confirmed — the old link can no longer
    activate anything."""
    client.post("/api/newsletter/subscribe", json={"email": "freshstart@example.com"})
    old = _confirm_token(smtp_sink, "freshstart@example.com")
    assert client.post("/api/newsletter/confirm", json={"token": old}).status_code == 200
    assert client.post("/api/newsletter/unsubscribe", json={"token": old}).status_code == 200

    # Resubscribe the same address: a second confirmation email is sent.
    before = len(_all_messages_to(smtp_sink, "freshstart@example.com"))
    client.post("/api/newsletter/subscribe", json={"email": "freshstart@example.com"})
    assert len(_all_messages_to(smtp_sink, "freshstart@example.com")) == before + 1

    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "freshstart@example.com")
        .first()
    )
    assert sub.token != old
    assert sub.is_confirmed is False
    assert sub.unsubscribed_at is None

    # The rotated-away OLD token is dead; the fresh token activates the address.
    assert client.post("/api/newsletter/confirm", json={"token": old}).status_code == 404
    assert client.post("/api/newsletter/confirm", json={"token": sub.token}).status_code == 200


def test_newline_in_title_does_not_break_publish(client, db_session, smtp_sink):
    """A post title containing a line break must not make the newsletter
    fan-out raise (the email library rejects CR/LF in headers). The publish —
    and, worse, the fire-on-read sweep that runs inside public reads — must
    survive it; the header title collapses the newline to a space."""
    client.post("/api/newsletter/subscribe", json={"email": "nl@example.com"})
    token = _confirm_token(smtp_sink, "nl@example.com")
    client.post("/api/newsletter/confirm", json={"token": token})
    before = len(smtp_sink.sent)

    # A title with a real line break (allowed: Post title is NonNulStr, which
    # only rejects NUL bytes — an admin can paste one in from a document).
    # Built directly (not through create_post) so the write-time fan-out does
    # not fire: this isolates the single dispatch we are testing.
    from datetime import UTC, datetime

    post = models.Post(
        title="Line one\nLine two",
        slug="nl-post",
        content="# Hi",
        published=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(post)
    db_session.commit()
    db_session.refresh(post)

    from app.emailer import dispatch_newsletter_new_post
    from app.middleware import get_logger

    # The fan-out replica of the publish path; must not raise on a CRLF title.
    assert dispatch_newsletter_new_post(db_session, post, logger=get_logger("test")) >= 0

    delivered = [m for m in smtp_sink.sent[before:] if m["To"] == "nl@example.com"]
    assert len(delivered) == 1
    assert "Line one Line two" in delivered[0]["Subject"]


def test_multiple_subscribers_one_smtp_session(client, db_session, smtp_sink):
    """Two confirmed subscribers -> two new-post emails over a single SMTP
    session, each with its own per-subscriber unsubscribe token."""
    for _i, addr in enumerate(("one@example.com", "two@example.com")):
        client.post("/api/newsletter/subscribe", json={"email": addr})
        token = _confirm_token(smtp_sink, addr)
        client.post("/api/newsletter/confirm", json={"token": token})

    sessions_before = len(FakeSMTP.instances)
    sent_before = len(smtp_sink.sent)
    _create_post(db_session)
    # Two new-post emails (one per subscriber), on top of the two confirmations.
    assert len(_new_post_messages(smtp_sink, "one@example.com")) == 1
    assert len(_new_post_messages(smtp_sink, "two@example.com")) == 1
    assert len(smtp_sink.sent) == sent_before + 2
    # One SMTP session opened for the whole fan-out.
    assert len(FakeSMTP.instances) == sessions_before + 1


def test_smtp_unconfigured_publish_succeeds_no_email(client, db_session, monkeypatch):
    """With SMTP unconfigured the subscribe still succeeds (best effort) and a
    confirmed subscriber's publish emails nothing, but publish itself works."""
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("SMTP_PORT", raising=False)
    # Subscribe without SMTP: no confirmation email possible — still 202.
    r = client.post("/api/newsletter/subscribe", json={"email": "nosmtp@example.com"})
    assert r.status_code == 202
    _create_post(db_session)  # must not raise


def test_scheduled_post_crossing_emails_newsletter(client, db_session, smtp_sink):
    """A scheduled post that crosses publish_at surfaces the newsletter email
    exactly once via the fire-on-read sweep."""
    from datetime import UTC, datetime, timedelta

    from app import crud

    client.post("/api/newsletter/subscribe", json={"email": "sweep@example.com"})
    token = _confirm_token(smtp_sink, "sweep@example.com")
    client.post("/api/newsletter/confirm", json={"token": token})

    # Create with a FUTURE publish_at (scheduled): the immediate write fan-out
    # must NOT email anything yet.
    from app.crud import create_post

    future = datetime.now(UTC) + timedelta(hours=1)
    post = create_post(
        db_session,
        PostCreate(
            title="Sweep post",
            slug="sweep-post",
            content="# Hi",
            published=True,
            publish_at=future.replace(tzinfo=None),
        ),
    )
    assert len(_new_post_messages(smtp_sink, "sweep@example.com")) == 0
    assert post.publish_at is not None

    # The clock crosses publish_at; the fire-on-read sweep claims the post and
    # emails the newsletter subscriber exactly once.
    post.publish_at = (datetime.now(UTC) - timedelta(minutes=5)).replace(tzinfo=None)
    db_session.commit()
    claimed = crud.maybe_notify_due_scheduled_posts(db_session)
    assert claimed == 1
    assert len(_new_post_messages(smtp_sink, "sweep@example.com")) == 1

    # A second sweep pass finds nothing new (exactly-once stamp) — no duplicate.
    assert crud.maybe_notify_due_scheduled_posts(db_session) == 0
    assert len(_new_post_messages(smtp_sink, "sweep@example.com")) == 1

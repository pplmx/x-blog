"""Admin weekly-digest overview contract tests (DEC-423, TASK-436).

The weekly digest (DEC-201, TASK-222) has complete backend machinery —
``send_weekly_digest`` with an advisory lock, idempotent ``digest_sent_at``
stamping, a ``dry_run`` preview and a summary dict — plus a superuser
``POST /api/admin/digests/send-weekly`` trigger. But until round 378 (DEC-423)
an operator had no *reading* surface for it: no way to see how many readers
and guests opted into the weekly cadence, when the last digest actually went
out, or how many posts the current window would contain. Those are exactly the
numbers that decide whether the digest is alive and healthy, so the overview
endpoint completes the monitoring loop next to the existing trigger.

Key properties:
- GET /api/admin/newsletter/digest/overview requires an admin tier (401
  anonymous, 403 for an authenticated non-admin role);
- returns reader_digest_subscribers (active readers opted into
  email_weekly_digest), guest_digest_subscribers (confirmed newsletter
  addresses on the digest_weekly cadence), last_sent_at (the max digest-send
  timestamp across reader prefs and newsletter rows — null when nothing has
  ever gone out), and window_posts (public posts in the rolling digest
  window, via collect_digest_posts);
- counts are live: creating/opting extra recipients, stamping a digest_sent_at
  or publishing a post in the window moves the numbers.
"""

from datetime import UTC, datetime, timedelta

from app import models
from app.digest import WEEKLY_WINDOW_DAYS


def _overview(client, headers: dict) -> dict:
    r = client.get("/api/admin/newsletter/digest/overview", headers=headers)
    assert r.status_code == 200
    return r.json()


def _reader(db, email: str, *, digest: bool = True) -> int:
    from app.auth import ReaderAccount

    row = ReaderAccount(email=email, password="x", display_name=email.split("@")[0], is_active=True)
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
    created_days_ago: int = 1,
) -> int:
    from app import crud

    now = crud.utc_now_naive()
    row = models.Post(
        title=title,
        slug=slug,
        content="# Hello",
        published=published,
        created_at=now - timedelta(days=created_days_ago),
    )
    if publish_at is not None:
        row.publish_at = publish_at
    db.add(row)
    db.flush()
    return row.id


def test_requires_admin(client):
    """Anonymous / non-admin calls are 401 on the overview."""
    assert client.get("/api/admin/newsletter/digest/overview").status_code == 401


def test_non_admin_role_rejected(client, db_session):
    """An authenticated account outside the admin tiers is 403."""
    from app.auth import User, create_access_token, get_password_hash

    viewer = User(
        username="vieweronly",
        password=get_password_hash("pass12345"),
        role="viewer",
        is_superuser=False,
    )
    db_session.add(viewer)
    db_session.flush()
    token = create_access_token({"sub": viewer.id}, token_version=viewer.token_version or 0)
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/admin/newsletter/digest/overview", headers=headers).status_code == 403


def test_empty_blanks(client, admin_token):
    """With no recipients and no posts in the window: zeros + null last_sent."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    body = _overview(client, headers)
    assert body == {
        "reader_digest_subscribers": 0,
        "guest_digest_subscribers": 0,
        "last_sent_at": None,
        "window_posts": 0,
    }


def test_counts_reader_and_guest_recipients(client, db_session, admin_token):
    """Reader prefs (email_weekly_digest) and newsletter rows (confirmed +
    digest_weekly) each feed their count; non-opted / non-confirmed rows do not."""
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Two digest readers, one reader opted out counterexample.
    _reader(db_session, "a@example.com", digest=True)
    _reader(db_session, "b@example.com", digest=True)
    _reader(db_session, "c@example.com", digest=False)

    # One confirmed digest_weekly guest, one per-post guest, one pending.
    client.post("/api/newsletter/subscribe", json={"email": "guest-weekly@example.com", "digest_weekly": True})
    client.post("/api/newsletter/subscribe", json={"email": "guest-perpost@example.com", "digest_weekly": False})
    client.post("/api/newsletter/subscribe", json={"email": "guest-pending@example.com", "digest_weekly": True})

    # Confirm the digest_weekly subscriber (double opt-in) — mirror the admin
    # cadence test which reads the row after subscribe.
    db_session.flush()
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "guest-weekly@example.com")
        .one()
    )
    sub.is_confirmed = True
    db_session.commit()

    body = _overview(client, headers)
    assert body["reader_digest_subscribers"] == 2
    assert body["guest_digest_subscribers"] == 1


def test_last_sent_at_reflects_stamped_digest(client, db_session, admin_token):
    """last_sent_at is the max of reader/guest digest_sent_at; null before any"""
    headers = {"Authorization": f"Bearer {admin_token}"}
    rid = _reader(db_session, "stamped@example.com", digest=True)
    pref = db_session.query(models.ReaderNotificationPref).filter(models.ReaderNotificationPref.reader_id == rid).one()
    stamp = datetime(2026, 9, 10, 8, 30, tzinfo=UTC)

    # Nothing stamped yet -> null.
    assert _overview(client, headers)["last_sent_at"] is None

    pref.digest_sent_at = stamp.replace(tzinfo=None)
    db_session.commit()

    body = _overview(client, headers)
    # Serialized as ISO with a date component.
    assert body["last_sent_at"] is not None
    assert body["last_sent_at"].startswith("2026-09-10")


def test_last_sent_at_takes_newer_of_readers_and_guests(client, db_session, admin_token):
    """The cross-table MAX: a guest stamp newer than the reader stamp wins
    (and a reader-only stamp is still reported when no guest ever went out)."""
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Reader stamped earlier.
    rid = _reader(db_session, "older@example.com", digest=True)
    pref = db_session.query(models.ReaderNotificationPref).filter(models.ReaderNotificationPref.reader_id == rid).one()
    pref.digest_sent_at = datetime(2026, 9, 1, 8, 0, tzinfo=UTC).replace(tzinfo=None)
    db_session.commit()
    assert _overview(client, headers)["last_sent_at"].startswith("2026-09-01")

    # Guest stamped later -> the newer guest stamp is reported.
    client.post("/api/newsletter/subscribe", json={"email": "later-guest@example.com", "digest_weekly": True})
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "later-guest@example.com")
        .one()
    )
    sub.is_confirmed = True
    sub.digest_sent_at = datetime(2026, 9, 15, 10, 0, tzinfo=UTC).replace(tzinfo=None)
    db_session.commit()
    assert _overview(client, headers)["last_sent_at"].startswith("2026-09-15")


def test_window_posts_counts_public_posts_in_window(client, db_session, admin_token):
    """window_posts = collect_digest_posts length: published posts whose
    effective publish time falls in the last WEEKLY_WINDOW_DAYS days."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    from app import crud

    now = crud.utc_now_naive()

    _make_post(db_session, "In window", "in-window", created_days_ago=1)
    _make_post(
        db_session,
        "Scheduled in window",
        "scheduled-in-window",
        publish_at=now - timedelta(days=2),
    )
    # Draft: not public, must not count.
    _make_post(db_session, "Draft", "draft", published=False, created_days_ago=1)
    # Published but older than the window: must not count either way.
    _make_post(db_session, "Old", "old", created_days_ago=WEEKLY_WINDOW_DAYS + 5)

    body = _overview(client, headers)
    assert body["window_posts"] == 2

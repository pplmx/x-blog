"""Reader-to-reader follow contract tests (round 365, DEC-403).

The last un-followable identity gets a follow axis: a signed-in reader can
follow another READER (the person-shaped counterpart of author/tag/series/
category follows) and — the actual capability — gets a durable inbox row when
that reader's comment is approved. The follow itself is idempotent (201/200),
self-follow is rejected, and unknown targets are a uniform 404 (no
followability oracle). The public profile carries a follower count, plus the
CALLER's own is_following (false for guests), so the profile header can render
a Follow/Following button without leaking who follows whom.
"""

from uuid import uuid4

FOLLOW = "/api/reader/me/follows/readers/{reader_id}"
LIST = "/api/reader/me/follows/readers"
NOTIFS = "/api/reader/me/notifications"
PROFILE = "/api/readers/{reader_id}"

_EMAIL_COUNTER = 0


def _register(client, email=None, password="readerpass123"):
    """Register a fresh reader with a per-test unique email + public name."""
    global _EMAIL_COUNTER
    _EMAIL_COUNTER += 1
    email = email or f"rf-{_EMAIL_COUNTER}@example.com"
    resp = client.post(
        "/api/reader/register",
        json={"email": email, "password": password, "display_name": f"RF{_EMAIL_COUNTER}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _reader(client, email=None):
    """Register one reader and return (access_token, reader_id)."""
    reg = _register(client, email=email)
    return reg["access_token"], reg["reader"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_post(db_session, **overrides):
    """Create a published post directly via crud (bypasses the admin API)."""
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "Follow post",
                "slug": f"follow-post-{uuid4().hex[:8]}",
                "content": "# Hi\n\nWorld",
                "published": True,
                **overrides,
            }
        ),
    )


class TestFollowManage:
    def test_follow_is_idempotent_and_lists_the_followed_reader(self, client):
        a_token, a_id = _reader(client, email="rf-a@example.com")  # the followed one
        b_token, _ = _reader(client, email="rf-b@example.com")  # the follower
        first = client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        assert first.status_code == 201
        again = client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        assert again.status_code == 200

        listing = client.get(LIST, headers=_auth(b_token)).json()
        assert listing["total"] == 1
        item = listing["items"][0]
        assert item["reader_id"] == a_id
        assert item["display_name"] == "RF1"
        assert item["notify"] is True

    def test_unfollow_is_idempotent(self, client):
        b_token, a_id = _reader(client)
        _, b_id = _reader(client)
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        assert client.delete(FOLLOW.format(reader_id=a_id), headers=_auth(b_token)).status_code == 204
        assert client.get(LIST, headers=_auth(b_token)).json()["total"] == 0
        # Idempotent re-delete.
        assert client.delete(FOLLOW.format(reader_id=a_id), headers=_auth(b_token)).status_code == 204

    def test_cannot_follow_self(self, client):
        a_token, a_id = _reader(client)
        resp = client.put(FOLLOW.format(reader_id=a_id), headers=_auth(a_token))
        assert resp.status_code == 400

    def test_cannot_follow_an_unknown_reader(self, client):
        b_token, _ = _reader(client)
        resp = client.put(FOLLOW.format(reader_id=99999), headers=_auth(b_token))
        assert resp.status_code == 404  # same as any non-followable target — no oracle

    def test_follow_state_is_per_direction(self, client):
        a_token, a_id = _reader(client)
        b_token, b_id = _reader(client)
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        assert client.get(LIST, headers=_auth(b_token)).json()["total"] == 1
        # A did NOT follow B back.
        a_follows = client.get(LIST, headers=_auth(a_token)).json()
        assert a_follows["total"] == 0


class TestProfileSurface:
    def test_guest_sees_the_count_and_no_caller_stance(self, client):
        _, a_id = _reader(client, email="rf-profa@example.com")
        b_token, _ = _reader(client, email="rf-profb@example.com")
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        guest = client.get(PROFILE.format(reader_id=a_id)).json()["profile"]
        assert guest["follower_count"] >= 1
        assert guest["is_following"] is False

    def test_the_caller_s_stance_is_reflected_only_for_them(self, client):
        _, a_id = _reader(client, email="rf-profa2@example.com")
        b_token, _ = _reader(client, email="rf-profb2@example.com")
        c_token, _ = _reader(client, email="rf-profc2@example.com")
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        b_view = client.get(PROFILE.format(reader_id=a_id), headers=_auth(b_token)).json()["profile"]
        assert b_view["is_following"] is True
        c_view = client.get(PROFILE.format(reader_id=a_id), headers=_auth(c_token)).json()["profile"]
        assert c_view["is_following"] is False


class TestCommentFanOut:
    def _post_reader_comment(self, client, admin_token, db_session, token, content="A fresh take"):
        """A reader comments on a seeded public post and a moderator approves."""
        post = _create_post(db_session)
        created = client.post(
            f"/api/comments/post/{post.id}",
            # The CommentCreate schema requires nickname/email for EVERYTHING;
            # a reader-attributed comment still sends placeholders (stamped
            # from the JWT, ignored server-side) — same as the notify tests.
            json={"content": content, "nickname": "RF Commenter", "email": "rf@example.com"},
            headers=_auth(token),
        )
        assert created.status_code == 201, created.text
        comment = created.json()
        approved = client.patch(
            f"/api/comments/{comment['id']}/approve",
            json={"approved": True},
            headers=_auth(admin_token),
        )
        assert approved.status_code == 200
        return comment

    def test_followed_reader_comment_approval_notifies_the_follower(self, client, admin_token, db_session):
        a_token, a_id = _reader(client, email="rf-fanout-a@example.com")
        b_token, _ = _reader(client, email="rf-fanout-b@example.com")
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))

        comment = self._post_reader_comment(client, admin_token, db_session, a_token)

        rows = client.get(NOTIFS, headers=_auth(b_token)).json()["items"]
        reader_rows = [r for r in rows if r["kind"] == "reader_comment"]
        assert reader_rows, "follower got no reader_comment inbox row"
        # The row deep-links to the comment (not just the post headline), the
        # same landing guarantee as the other comment fan-outs (DEC-321).
        assert f"#comment-{comment['id']}" in reader_rows[0]["url"]

    def test_nobody_unrelated_gets_the_fan_out(self, client, admin_token, db_session):
        a_token, a_id = _reader(client, email="rf-fanout-c@example.com")
        c_token, _ = _reader(client, email="rf-fanout-d@example.com")  # NOT following A
        self._post_reader_comment(client, admin_token, db_session, a_token)
        rows = client.get(NOTIFS, headers=_auth(c_token)).json()["items"]
        assert not [r for r in rows if r["kind"] == "reader_comment"]

    def test_reply_does_not_double_notify_a_following_parent(self, client, admin_token, db_session):
        """A reply feeds its replied-to reader's targeted `reply` row — the
        reader_comment fan-out must skip that same parent even when they also
        follow the commenter, else one comment = two inbox rows (DEC-064
        non-doubling contract)."""
        a_token, _ = _reader(client, email="rf-reply-a@example.com")
        b_token, b_id = _reader(client, email="rf-reply-b@example.com")
        # A follows B so the parent (A) is inside B's fan-out target set when
        # B's reply is approved.
        client.put(FOLLOW.format(reader_id=b_id), headers=_auth(a_token))

        post = _create_post(db_session)
        top = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "top comment", "nickname": "N1", "email": "n1@example.com"},
            headers=_auth(a_token),
        ).json()
        assert (
            client.patch(
                f"/api/comments/{top['id']}/approve", json={"approved": True}, headers=_auth(admin_token)
            ).status_code
            == 200
        )

        reply = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "a reply", "nickname": "N2", "email": "n2@example.com", "parent_id": top["id"]},
            headers=_auth(b_token),
        ).json()
        assert (
            client.patch(
                f"/api/comments/{reply['id']}/approve", json={"approved": True}, headers=_auth(admin_token)
            ).status_code
            == 200
        )

        rows = client.get(NOTIFS, headers=_auth(a_token)).json()["items"]
        kinds = [r["kind"] for r in rows]
        assert "reply" in kinds, "the replied-to parent was not notified"
        assert "reader_comment" not in kinds, "parent got a duplicate reader_comment row for the same reply"

    def test_deactivated_follower_gets_no_fan_out(self, client, admin_token, db_session):
        """Deactivation silences every channel (DEC-194): an inactive follower
        is dropped from the fan-out target set before any row is written."""
        from app import auth as auth_mod
        from app import models as m

        a_token, a_id = _reader(client, email="rf-deact-a@example.com")
        b_token, b_id = _reader(client, email="rf-deact-b@example.com")
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        deactivated = db_session.get(auth_mod.ReaderAccount, b_id)
        deactivated.is_active = False
        db_session.commit()

        self._post_reader_comment(client, admin_token, db_session, a_token)

        rows = db_session.query(m.ReaderNotification).filter(m.ReaderNotification.reader_id == b_id).all()
        assert not [r for r in rows if r.kind == "reader_comment"]

    def test_opted_out_follower_gets_no_fan_out(self, client, admin_token, db_session):
        """reader_comment is a real per-kind opt-out (DEC-171): a follower who
        switched it off gets no inbox row, on any approve path."""
        a_token, a_id = _reader(client, email="rf-optout-a@example.com")
        b_token, _ = _reader(client, email="rf-optout-b@example.com")
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))
        updated = client.patch(
            "/api/reader/me/notification-preferences",
            json={"kind": "reader_comment", "enabled": False},
            headers=_auth(b_token),
        ).json()
        assert updated["reader_comment"] is False

        self._post_reader_comment(client, admin_token, db_session, a_token)

        rows = client.get(NOTIFS, headers=_auth(b_token)).json()["items"]
        assert not [r for r in rows if r["kind"] == "reader_comment"]

    def test_notification_failure_cannot_break_approval(self, client, admin_token, db_session, monkeypatch):
        """The fan-out is strictly best-effort: a notification-write crash must
        never turn an approval into a 500."""
        a_token, a_id = _reader(client, email="rf-fail-a@example.com")
        b_token, _ = _reader(client, email="rf-fail-b@example.com")
        client.put(FOLLOW.format(reader_id=a_id), headers=_auth(b_token))

        from app.routers import comments as comments_router

        def boom(*_args, **_kwargs):
            raise RuntimeError("notifications backend down")

        monkeypatch.setattr(comments_router.crud, "record_reader_follow_notifications", boom)

        post = _create_post(db_session)
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "will approve", "nickname": "N", "email": "n@example.com"},
            headers=_auth(a_token),
        )
        assert created.status_code == 201, created.text
        resp = client.patch(
            f"/api/comments/{created.json()['id']}/approve",
            json={"approved": True},
            headers=_auth(admin_token),
        )
        assert resp.status_code == 200, resp.text

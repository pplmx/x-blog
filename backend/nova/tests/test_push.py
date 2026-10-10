"""Contract tests for the Web Push slice (DEC-055, TASK-117).

Covers:
- GET /api/push/vapid-public-key returns the VAPID public key (503 unconfigured).
- POST /api/push/subscribe validates endpoint/p256dh/auth and upserts by endpoint.
- DELETE /api/push/subscribe removes a subscription (idempotent).
- POST /api/push/notify is superuser-only, dispatches to every subscription,
  retires 410/404 endpoints, and counts failures without failing the request.
- Unconfigured VAPID makes every push endpoint fail closed with 503.
"""

import base64
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from app import models, webpush

# A syntactically-valid push endpoint (any https URL the push service style uses).
ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/AAAAAAAAAAAAAAAAAAAA"
NEW_ENDPOINT = "https://fcm.googleapis.com/fcm/send/BBBBBBBBBBBBBBBBBBBBBBBB"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _valid_keys(prefix: int = 4, auth_byte: int = 1) -> dict:
    """A 65-byte EC point (0x04 || x32 || y32) and 16-byte auth, base64url."""
    point = b"\x04" + bytes([prefix] * 32) + bytes([prefix + 1] * 32)
    return {"p256dh": _b64url(point), "auth": _b64url(bytes([auth_byte]) * 16)}


def _subscribe_body(endpoint: str = ENDPOINT, prefix: int = 4) -> dict:
    return {"endpoint": endpoint, "keys": _valid_keys(prefix=prefix)}


class TestVapidPublicKey:
    async def test_returns_valid_65_byte_point(self, client):
        response = await client.get("/api/push/vapid-public-key")
        assert response.status_code == 200
        key = response.json()["public_key"]
        raw = base64.urlsafe_b64decode(key + "=" * ((4 - len(key) % 4) % 4))
        assert len(raw) == 65
        assert raw[0] == 4  # uncompressed EC point marker

    async def test_fails_closed_when_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = await client.get("/api/push/vapid-public-key")
        assert response.status_code == 503


class TestSubscribe:
    async def test_subscribe_stores_row(self, client, db_session):
        response = await client.post("/api/push/subscribe", json=_subscribe_body())
        assert response.status_code == 200
        data = response.json()
        assert data["endpoint"] == ENDPOINT
        row = (
            await db_session.execute(
                select(models.PushSubscription).where(models.PushSubscription.endpoint == ENDPOINT)
            )
        ).scalar_one()
        assert row.p256dh == _valid_keys()["p256dh"]
        assert row.auth == _valid_keys()["auth"]

    async def test_resubscribe_upserts_not_duplicates(self, client, db_session):
        await client.post("/api/push/subscribe", json=_subscribe_body(prefix=4))
        first_id = (await db_session.execute(select(models.PushSubscription))).scalar_one().id
        # Same endpoint, rotated keys (fresh browser subscription round).
        updated = _subscribe_body(prefix=9)
        response = await client.post("/api/push/subscribe", json=updated)
        assert response.status_code == 200
        assert response.json()["id"] == first_id
        rows = (await db_session.execute(select(models.PushSubscription))).scalars().all()
        assert len(rows) == 1
        assert rows[0].p256dh == updated["keys"]["p256dh"]

    async def test_race_winner_path_applies_new_keys(self, client, db_session, monkeypatch):
        """A concurrent subscribe that loses the unique-key insert race must
        still refresh the winner row with THIS request's rotated keys/prefs.

        Regression (ISS-449 / backend deep-dive): the IntegrityError branch
        returned the winner row verbatim, so a browser that re-signed fresh
        p256dh/auth during the race kept a row with stale keys — every later
        dispatch to that endpoint failed http-ece decryption (counted as
        `failed`) until an unlucky future subscribe overwrote them."""
        from sqlalchemy import delete
        from sqlalchemy.ext.asyncio import AsyncSession

        # Pre-make a subscription whose endpoint already exists (the row the
        # 'racing winner' owns) with OLD keys. The test session shares ONE root
        # transaction across every request in a test (conftest), so a winner
        # row written by an earlier client.post would live inside that root
        # transaction and be rolled back when the losing request's
        # db.rollback() clears the failed INSERT. Real deployments commit per
        # request, so committing the winner through its OWN connection is what
        # reproduces production isolation: the post-rollback re-query then
        # finds the row, exactly like a real concurrent subscriber would.
        old = _subscribe_body(prefix=4)
        engine = db_session.bind.engine  # AsyncEngine bound to this worker's DB

        async def _seed_winner() -> int:
            async with AsyncSession(engine) as ws:
                ws.add(
                    models.PushSubscription(
                        endpoint=old["endpoint"],
                        p256dh=old["keys"]["p256dh"],
                        auth=old["keys"]["auth"],
                    )
                )
                await ws.commit()
                win = (
                    await ws.execute(
                        select(models.PushSubscription).where(models.PushSubscription.endpoint == old["endpoint"])
                    )
                ).scalar_one()
                return win.id

        winner_id = await _seed_winner()

        try:
            # Force the losing request down the INSERT path: its pre-check query
            # sees no existing row, but the row actually exists → the INSERT hits
            # the unique constraint → IntegrityError → the winner path runs.
            real_execute = db_session.execute
            # Exactly ONE miss across every PushSubscription lookup in the
            # losing request: the pre-check (before the INSERT) must see "no
            # row", but the post-IntegrityError re-query must find the winner
            # row so the winner path can refresh it.
            missed = {"v": False}

            def is_subscription_select(stmt) -> bool:
                return "push_subscriptions" in str(stmt)

            async def miss_first_sub_execute(stmt, *args, **kwargs):
                if not missed["v"] and is_subscription_select(stmt):
                    # The losing request's first PushSubscription lookup is its
                    # pre-check: report "no row" so the subsequent INSERT hits the
                    # unique constraint (the real winner row is durably committed
                    # above on its own connection).
                    missed["v"] = True
                    return await real_execute(select(models.PushSubscription).where(False))
                return await real_execute(stmt, *args, **kwargs)

            monkeypatch.setattr(db_session, "execute", miss_first_sub_execute)

            fresh = _subscribe_body(prefix=9)
            response = await client.post("/api/push/subscribe", json=fresh)
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == winner_id

            rows = (await db_session.execute(select(models.PushSubscription))).scalars().all()
            assert len(rows) == 1
            # The winner row now carries the LOSER's fresh keys, so the stored
            # subscription is decryptable again.
            assert rows[0].p256dh == fresh["keys"]["p256dh"]
            assert rows[0].auth == fresh["keys"]["auth"]
        finally:
            # Undo the durably-committed winner row so nothing leaks into
            # later tests. Release the shared session's root transaction first
            # (SQLite holds a read lock while it is open, which would otherwise
            # block this separate writer connection).
            await db_session.rollback()
            async with engine.begin() as conn:
                await conn.execute(
                    delete(models.PushSubscription).where(models.PushSubscription.endpoint == old["endpoint"])
                )

    @pytest.mark.parametrize(
        "endpoint",
        [
            "ftp://uploads.example.com/push",
            "javascript:alert(1)",
            "not-a-url",
            "http://",  # no netloc
        ],
    )
    async def test_rejects_unsafe_endpoint_schemes(self, client, endpoint):
        response = await client.post("/api/push/subscribe", json=_subscribe_body(endpoint=endpoint))
        assert response.status_code == 422

    async def test_rejects_overlong_endpoint(self, client):
        response = await client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint="https://example.com/" + "x" * 500),
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "mutator",
        [
            lambda k: {**k, "p256dh": _b64url(b"\x04" + b"\x00" * 32)},  # 33-byte point
            lambda k: {**k, "p256dh": "not-base64!!"},  # invalid alphabet
            lambda k: {**k, "auth": _b64url(b"\x00" * 8)},  # 8 bytes, not 16
        ],
    )
    async def test_rejects_invalid_keys(self, client, mutator):
        """p256dh must be a 65-byte EC point, auth a 16-byte salt — the route
        layer rejects anything else so http-ece can always encrypt (422)."""
        body = _subscribe_body()
        body["keys"] = mutator(body["keys"])
        response = await client.post("/api/push/subscribe", json=body)
        assert response.status_code == 422

    async def test_fails_closed_when_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = await client.post("/api/push/subscribe", json=_subscribe_body())
        assert response.status_code == 503


class TestUnsubscribe:
    async def test_removes_existing(self, client, db_session):
        await client.post("/api/push/subscribe", json=_subscribe_body())
        response = await client.post("/api/push/unsubscribe", json=_subscribe_body())
        assert response.status_code == 204
        assert (await db_session.execute(select(func.count()).select_from(models.PushSubscription))).scalar_one() == 0

    async def test_removing_absent_is_idempotent(self, client):
        response = await client.post("/api/push/unsubscribe", json=_subscribe_body())
        assert response.status_code == 204

    async def test_removes_only_matching_endpoint(self, client, db_session):
        await client.post("/api/push/subscribe", json=_subscribe_body())
        await client.post("/api/push/subscribe", json=_subscribe_body(endpoint=NEW_ENDPOINT, prefix=8))
        await client.post("/api/push/unsubscribe", json=_subscribe_body())
        remaining = (await db_session.execute(select(models.PushSubscription))).scalars().all()
        assert len(remaining) == 1
        assert remaining[0].endpoint == NEW_ENDPOINT

    async def test_requires_proof_of_possession_for_unsubscribe(self, client, db_session):
        """Deleting by endpoint ALONE must not work — the keys the browser
        holds are the proof of possession, so a captured endpoint (dispatch
        logs, the reader's own listing) cannot be used to kill someone's
        subscription (security review)."""
        await client.post("/api/push/subscribe", json=_subscribe_body())
        # Correct endpoint, wrong keys (attacker knows the endpoint's URL only).
        forged = _subscribe_body(prefix=99)  # different p256dh/auth
        forged["endpoint"] = ENDPOINT
        response = await client.post("/api/push/unsubscribe", json=forged)
        assert response.status_code == 204
        assert (await db_session.execute(select(func.count()).select_from(models.PushSubscription))).scalar_one() == 1
        # The true browser, holding its real keys, still revokes normally.
        response = await client.post("/api/push/unsubscribe", json=_subscribe_body())
        assert response.status_code == 204
        assert (await db_session.execute(select(func.count()).select_from(models.PushSubscription))).scalar_one() == 0


class TestSubscribeHardening:
    """SSRF literal guard + per-source caps + reader-binding ownership (sec review)."""

    @pytest.mark.parametrize(
        "endpoint",
        [
            "https://127.0.0.1:9090/push",
            "http://10.0.0.5:8080/internal",
            "https://[::1]/push",
            "https://169.254.169.254/latest/meta-data",
            "https://localhost/push",
            "https://db.internal/push",
            "https://printer.local/push",
        ],
    )
    async def test_rejects_internal_literal_hosts(self, client, endpoint):
        """A push endpoint pointing at loopback/private/link-local/literal
        internal hosts is refused at subscribe (SSRF layer 1, DNS-free)."""
        response = await client.post("/api/push/subscribe", json=_subscribe_body(endpoint=endpoint))
        assert response.status_code == 422

    async def test_rejects_reader_stealing_another_readers_binding(self, client, db_session):
        """Re-subscribing an endpoint already bound to another reader must not
        silently repoint it (would let reader B steal + revoke reader A's
        subscriptions using only A's logged endpoint)."""

        # Reader A subscribes while signed in.
        register_a = await client.post(
            "/api/reader/register",
            json={"email": "a@test.com", "password": "password123"},
        )
        token_a = register_a.json()["access_token"]
        await client.post("/api/push/subscribe", json=_subscribe_body(), headers={"Authorization": f"Bearer {token_a}"})
        row = (await db_session.execute(select(models.PushSubscription))).scalar_one()
        assert row.reader_id is not None

        # Reader B tries to bind the same endpoint to themselves.
        register_b = await client.post(
            "/api/reader/register",
            json={"email": "b@test.com", "password": "password123"},
        )
        token_b = register_b.json()["access_token"]
        response = await client.post(
            "/api/push/subscribe",
            json=_subscribe_body(),
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert response.status_code == 409
        await db_session.refresh(row)
        # Binding unchanged — A still owns it.
        assert row.reader_id == register_a.json()["reader"]["id"]

    async def test_caps_anonymous_subscriptions_per_ip(self, client, db_session):
        """Anonymous growth is bounded per client IP (one browser = one
        endpoint, so a handful of rows per IP is generous; security review)."""
        from app import webpush

        cap = webpush.MAX_PUSH_SUBSCRIPTIONS_PER_SOURCE
        for i in range(cap):
            r = await client.post(
                "/api/push/subscribe",
                json=_subscribe_body(endpoint=f"https://push.example.com/push-{i}", prefix=i),
            )
            assert r.status_code == 200, r.text
        # At the cap, one more anonymous endpoint is denied.
        over = await client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=f"https://push.example.com/push-{cap}", prefix=99),
        )
        assert over.status_code == 429


class TestNotifyAuth:
    async def test_anonymous_forbidden(self, client):
        response = await client.post("/api/push/notify", json={"title": "Hi", "url": "/posts/x"})
        assert response.status_code == 401

    async def test_editor_forbidden(self, client, editor_headers):
        """Broadcasting to every subscriber is superuser-privileged, not editor work."""
        response = await client.post(
            "/api/push/notify",
            json={"title": "Hi", "url": "/posts/x"},
            headers=editor_headers,
        )
        assert response.status_code == 403

    @pytest.mark.parametrize(
        "url",
        [
            "https://evil.example.com/phish",
            "//evil.example.com/phish",
            "javascript:alert(1)",
            "posts/no-leading-slash",
        ],
    )
    async def test_rejects_off_site_or_malformed_url(self, client, auth_headers, url):
        response = await client.post(
            "/api/push/notify",
            json={"title": "Hi", "url": url},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestNotifyDispatch:
    async def test_dispatches_to_every_subscription_with_vapid(self, client, auth_headers):
        await client.post("/api/push/subscribe", json=_subscribe_body())
        await client.post("/api/push/subscribe", json=_subscribe_body(endpoint=NEW_ENDPOINT, prefix=8))

        captured = []
        with patch("app.webpush.send_push") as mock_send:
            mock_send.side_effect = lambda **kw: captured.append(kw)
            response = await client.post(
                "/api/push/notify",
                json={"title": "新文章", "body": "Go read it", "url": "/posts/hello"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert mock_send.call_count == 2
        assert response.json() == {"total": 2, "sent": 2, "failed": 0, "removed": 0, "skipped": 0}
        endpoints = {c["endpoint"] for c in captured}
        assert endpoints == {ENDPOINT, NEW_ENDPOINT}
        for call in captured:
            assert call["payload"]["title"] == "新文章"
            assert call["payload"]["url"] == "/posts/hello"

    async def test_410_gone_retires_subscription(self, client, auth_headers, db_session):
        await client.post("/api/push/subscribe", json=_subscribe_body())
        await client.post("/api/push/subscribe", json=_subscribe_body(endpoint=NEW_ENDPOINT, prefix=8))

        from pywebpush import WebPushException

        def _gone(**_):  # noqa: ARG001
            class _Resp:
                status_code = 410
                text = "p320 Gone"

            raise WebPushException("gone", response=_Resp())

        with patch("app.webpush.send_push", side_effect=_gone):
            response = await client.post(
                "/api/push/notify",
                json={"title": "Hi", "url": "/posts/x"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["sent"] == 0
        assert response.json()["removed"] == 2
        assert (await db_session.execute(select(func.count()).select_from(models.PushSubscription))).scalar_one() == 0

    async def test_non_gone_failure_counts_and_keeps_subscription(self, client, auth_headers, db_session):
        await client.post("/api/push/subscribe", json=_subscribe_body())

        from pywebpush import WebPushException

        def _down(**_):  # noqa: ARG001
            class _Resp:
                status_code = 500
                text = "Server Error"

            raise WebPushException("down", response=_Resp())

        with patch("app.webpush.send_push", side_effect=_down):
            response = await client.post(
                "/api/push/notify",
                json={"title": "Hi", "url": "/posts/x"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json() == {"total": 1, "sent": 0, "failed": 1, "removed": 0, "skipped": 0}
        assert (await db_session.execute(select(func.count()).select_from(models.PushSubscription))).scalar_one() == 1

    async def test_fails_closed_when_unconfigured(self, client, auth_headers, monkeypatch):
        await client.post("/api/push/subscribe", json=_subscribe_body())
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = await client.post(
            "/api/push/notify",
            json={"title": "Hi", "url": "/posts/x"},
            headers=auth_headers,
        )
        assert response.status_code == 503


class TestSendPushTimeout:
    def test_send_push_forwards_a_per_endpoint_timeout(self):
        """A dead push service must not stall the whole broadcast forever: the
        requests call gets a bounded timeout, so a hanging endpoint is counted
        as failed instead of eating the app's 30s request budget (504)."""
        with (
            patch("app.webpush.webpush") as mock_webpush,
            # The SSRF guard resolves the host live at dispatch (DNS); tests
            # may run offline, and this case is about timeout wiring, not
            # SSRF. The literal guard + resolver are covered separately.
            patch("app.webpush._endpoint_targets_internal", return_value=False),
        ):
            webpush.send_push(
                endpoint=ENDPOINT,
                p256dh=_valid_keys()["p256dh"],
                auth=_valid_keys()["auth"],
                payload={"title": "x"},
            )
        kwargs = mock_webpush.call_args.kwargs
        assert kwargs["timeout"] == 10.0
        assert kwargs["vapid_claims"] == {"sub": "mailto:test@example.com"}
        assert kwargs["data"] == '{"title": "x"}'
        assert kwargs["vapid_private_key"]  # lazy env read present in tests

    def test_send_push_refuses_a_non_public_endpoint(self):
        """The authoritative SSRF guard resolves the host now and refuses an
        internal destination before any outbound request (DNS rebinding)."""
        with patch("app.webpush.webpush") as mock_webpush, pytest.raises(ValueError, match="non-public"):
            webpush.send_push(
                endpoint="https://127.0.0.1:9090/push",
                p256dh=_valid_keys()["p256dh"],
                auth=_valid_keys()["auth"],
                payload={"title": "x"},
            )
        mock_webpush.assert_not_called()

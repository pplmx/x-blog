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

from app import models

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
    def test_returns_valid_65_byte_point(self, client):
        response = client.get("/api/push/vapid-public-key")
        assert response.status_code == 200
        key = response.json()["public_key"]
        raw = base64.urlsafe_b64decode(key + "=" * ((4 - len(key) % 4) % 4))
        assert len(raw) == 65
        assert raw[0] == 4  # uncompressed EC point marker

    def test_fails_closed_when_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = client.get("/api/push/vapid-public-key")
        assert response.status_code == 503


class TestSubscribe:
    def test_subscribe_stores_row(self, client, db_session):
        response = client.post("/api/push/subscribe", json=_subscribe_body())
        assert response.status_code == 200
        data = response.json()
        assert data["endpoint"] == ENDPOINT
        row = db_session.query(models.PushSubscription).filter_by(endpoint=ENDPOINT).one()
        assert row.p256dh == _valid_keys()["p256dh"]
        assert row.auth == _valid_keys()["auth"]

    def test_resubscribe_upserts_not_duplicates(self, client, db_session):
        client.post("/api/push/subscribe", json=_subscribe_body(prefix=4))
        first_id = db_session.query(models.PushSubscription).one().id
        # Same endpoint, rotated keys (fresh browser subscription round).
        updated = _subscribe_body(prefix=9)
        response = client.post("/api/push/subscribe", json=updated)
        assert response.status_code == 200
        assert response.json()["id"] == first_id
        rows = db_session.query(models.PushSubscription).all()
        assert len(rows) == 1
        assert rows[0].p256dh == updated["keys"]["p256dh"]

    @pytest.mark.parametrize(
        "endpoint",
        [
            "ftp://uploads.example.com/push",
            "javascript:alert(1)",
            "not-a-url",
            "http://",  # no netloc
        ],
    )
    def test_rejects_unsafe_endpoint_schemes(self, client, endpoint):
        response = client.post("/api/push/subscribe", json=_subscribe_body(endpoint=endpoint))
        assert response.status_code == 422

    def test_rejects_overlong_endpoint(self, client):
        response = client.post(
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
    def test_rejects_invalid_keys(self, client, mutator):
        """p256dh must be a 65-byte EC point, auth a 16-byte salt — the route
        layer rejects anything else so http-ece can always encrypt (422)."""
        body = _subscribe_body()
        body["keys"] = mutator(body["keys"])
        response = client.post("/api/push/subscribe", json=body)
        assert response.status_code == 422

    def test_fails_closed_when_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = client.post("/api/push/subscribe", json=_subscribe_body())
        assert response.status_code == 503


class TestUnsubscribe:
    def test_removes_existing(self, client, db_session):
        client.post("/api/push/subscribe", json=_subscribe_body())
        response = client.post("/api/push/unsubscribe", json=_subscribe_body())
        assert response.status_code == 204
        assert db_session.query(models.PushSubscription).count() == 0

    def test_removing_absent_is_idempotent(self, client):
        response = client.post("/api/push/unsubscribe", json=_subscribe_body())
        assert response.status_code == 204

    def test_removes_only_matching_endpoint(self, client, db_session):
        client.post("/api/push/subscribe", json=_subscribe_body())
        client.post("/api/push/subscribe", json=_subscribe_body(endpoint=NEW_ENDPOINT, prefix=8))
        client.post("/api/push/unsubscribe", json=_subscribe_body())
        remaining = db_session.query(models.PushSubscription).all()
        assert len(remaining) == 1
        assert remaining[0].endpoint == NEW_ENDPOINT


class TestNotifyAuth:
    def test_anonymous_forbidden(self, client):
        response = client.post("/api/push/notify", json={"title": "Hi", "url": "/posts/x"})
        assert response.status_code == 401

    def test_editor_forbidden(self, client, editor_headers):
        """Broadcasting to every subscriber is superuser-privileged, not editor work."""
        response = client.post(
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
    def test_rejects_off_site_or_malformed_url(self, client, auth_headers, url):
        response = client.post(
            "/api/push/notify",
            json={"title": "Hi", "url": url},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestNotifyDispatch:
    def test_dispatches_to_every_subscription_with_vapid(self, client, auth_headers):
        client.post("/api/push/subscribe", json=_subscribe_body())
        client.post("/api/push/subscribe", json=_subscribe_body(endpoint=NEW_ENDPOINT, prefix=8))

        captured = []
        with patch("app.routers.push.send_push") as mock_send:
            mock_send.side_effect = lambda **kw: captured.append(kw)
            response = client.post(
                "/api/push/notify",
                json={"title": "新文章", "body": "Go read it", "url": "/posts/hello"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert mock_send.call_count == 2
        assert response.json() == {"total": 2, "sent": 2, "failed": 0, "removed": 0}
        endpoints = {c["endpoint"] for c in captured}
        assert endpoints == {ENDPOINT, NEW_ENDPOINT}
        for call in captured:
            assert call["payload"]["title"] == "新文章"
            assert call["payload"]["url"] == "/posts/hello"

    def test_410_gone_retires_subscription(self, client, auth_headers, db_session):
        client.post("/api/push/subscribe", json=_subscribe_body())
        client.post("/api/push/subscribe", json=_subscribe_body(endpoint=NEW_ENDPOINT, prefix=8))

        from pywebpush import WebPushException

        def _gone(**_):  # noqa: ARG001
            class _Resp:
                status_code = 410
                text = "p320 Gone"

            raise WebPushException("gone", response=_Resp())

        with patch("app.routers.push.send_push", side_effect=_gone):
            response = client.post(
                "/api/push/notify",
                json={"title": "Hi", "url": "/posts/x"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["sent"] == 0
        assert response.json()["removed"] == 2
        assert db_session.query(models.PushSubscription).count() == 0

    def test_non_gone_failure_counts_and_keeps_subscription(self, client, auth_headers, db_session):
        client.post("/api/push/subscribe", json=_subscribe_body())

        from pywebpush import WebPushException

        def _down(**_):  # noqa: ARG001
            class _Resp:
                status_code = 500
                text = "Server Error"

            raise WebPushException("down", response=_Resp())

        with patch("app.routers.push.send_push", side_effect=_down):
            response = client.post(
                "/api/push/notify",
                json={"title": "Hi", "url": "/posts/x"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json() == {"total": 1, "sent": 0, "failed": 1, "removed": 0}
        assert db_session.query(models.PushSubscription).count() == 1

    def test_fails_closed_when_unconfigured(self, client, auth_headers, monkeypatch):
        client.post("/api/push/subscribe", json=_subscribe_body())
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = client.post(
            "/api/push/notify",
            json={"title": "Hi", "url": "/posts/x"},
            headers=auth_headers,
        )
        assert response.status_code == 503

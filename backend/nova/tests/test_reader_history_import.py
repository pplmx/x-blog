"""Reader device-trail history import tests (TASK-303, RIL ISS-386).

A guest's reads live in the on-device localStorage trail; after sign-in the
/history page reads the server trail, so the device records silently disappear
unless migrated. /me/history/import merges a device trail by post slug —
idempotent, preserves each record's original read instant (newer wins), and
only ever imports publicly visible posts (drafts/scheduled never leak).
"""

_n = 0


def _register(client, email="imp@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="imp@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_post(client, auth_headers, title, slug, published=True):
    global _n
    _n += 1
    resp = client.post(
        "/api/posts",
        json={
            "title": title,
            "slug": f"{slug}-{_n}",
            "content": "body",
            "published": published,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _import(client, token, items):
    return client.post("/api/reader/me/history/import", json={"items": items}, headers=_auth(token))


def _list_slugs(client, token):
    data = client.get("/api/reader/me/history", headers=_auth(token)).json()
    return data["items"], data["total"]


class TestReaderHistoryImport:
    def test_import_adds_a_read_with_its_original_instant(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Imported Read", "imp")

        resp = _import(client, token, [{"slug": p["slug"], "viewed_at": "2024-03-01T10:30:00"}])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"imported": 1, "skipped": 0}

        items, total = _list_slugs(client, token)
        assert total == 1
        assert items[0]["slug"] == p["slug"]
        # The guest's original read instant is preserved, not overwritten with now.
        assert items[0]["viewed_at"].startswith("2024-03-01T10:30:00")

    def test_import_is_idempotent(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Idempotent Read", "idem")

        items = [{"slug": p["slug"], "viewed_at": "2024-03-01T10:30:00"}]
        assert _import(client, token, items).json() == {"imported": 1, "skipped": 0}
        # Re-importing the same record must not duplicate the row.
        assert _import(client, token, items).json() == {"imported": 1, "skipped": 0}

        _items, total = _list_slugs(client, token)
        assert total == 1

    def test_import_never_moves_a_read_backwards(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Bookmark Read", "bookmark")
        # Server-side view first (viewed_at = now, well after 2020).
        assert client.post(f"/api/reader/me/history/{p['id']}", headers=_auth(token)).status_code == 200

        # An older device timestamp must not downgrade the newer server record.
        assert _import(client, token, [{"slug": p["slug"], "viewed_at": "2020-01-01T00:00:00"}]).json() == {
            "imported": 1,
            "skipped": 0,
        }
        items, _total = _list_slugs(client, token)
        assert not items[0]["viewed_at"].startswith("2020")

        # A newer device timestamp wins the merge — but only within the
        # present. A far-future read is clamped to now (TASK-348/ISS-450), so
        # the merge still applies (imported=1); it just lands at "now" instead
        # of pinning the post to 2099 forever.
        assert _import(client, token, [{"slug": p["slug"], "viewed_at": "2099-12-31T23:59:59"}]).json() == {
            "imported": 1,
            "skipped": 0,
        }
        items, _total = _list_slugs(client, token)
        assert not items[0]["viewed_at"].startswith("2099-12-31")

    def test_import_clamps_a_far_future_viewed_at_to_now(self, client, auth_headers):
        """A fast-clock device's year-in-the-future read must not pin the post
        at the top of history forever (TASK-348/ISS-450): the stored instant
        lands at "now", never at the bogus 2099."""
        from datetime import UTC, datetime, timedelta

        token = _token(client)
        p = _create_post(client, auth_headers, "Fast Clock", "fastclock")

        resp = _import(client, token, [{"slug": p["slug"], "viewed_at": "2099-12-31T23:59:59"}])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"imported": 1, "skipped": 0}

        items, _total = _list_slugs(client, token)
        viewed = items[0]["viewed_at"]
        assert not viewed.startswith("2099")
        # Clamped to the present, not to some other arbitrary epoch.
        parsed = datetime.fromisoformat(viewed)
        assert datetime.now(UTC).replace(tzinfo=None) - parsed < timedelta(days=1)

    def test_unknown_slug_is_skipped(self, client, auth_headers):
        token = _token(client)
        resp = _import(client, token, [{"slug": "no-such-post", "viewed_at": "2024-03-01T10:30:00"}])
        assert resp.json() == {"imported": 0, "skipped": 1}
        _items, total = _list_slugs(client, token)
        assert total == 0

    def test_draft_post_is_skipped_and_never_leaks(self, client, auth_headers):
        token = _token(client)
        draft = _create_post(client, auth_headers, "Secret Draft", "draft", published=False)

        resp = _import(client, token, [{"slug": draft["slug"], "viewed_at": "2024-03-01T10:30:00"}])
        assert resp.json() == {"imported": 0, "skipped": 1}
        items, total = _list_slugs(client, token)
        assert total == 0
        slugs = [i["slug"] for i in items]
        assert draft["slug"] not in slugs

    def test_duplicate_slugs_fold_to_one_row(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Folded Read", "fold")

        resp = _import(
            client,
            token,
            [
                {"slug": p["slug"], "viewed_at": "2024-03-01T08:00:00"},
                {"slug": p["slug"], "viewed_at": "2024-03-01T10:30:00"},
            ],
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"imported": 1, "skipped": 0}

        items, total = _list_slugs(client, token)
        assert total == 1
        assert items[0]["viewed_at"].startswith("2024-03-01T10:30:00")

    def test_viewed_at_coerced_from_zone_marked_iso(self, client, auth_headers):
        # A device may send a zone-marked instant; it must land as naive-UTC
        # (the stored/read contract, DEC-213) so the list returns the same
        # instant without an aware-vs-naive comparison crash.
        token = _token(client)
        p = _create_post(client, auth_headers, "Zoned Read", "zoned")

        resp = _import(client, token, [{"slug": p["slug"], "viewed_at": "2024-03-01T18:30:00+08:00"}])
        assert resp.json() == {"imported": 1, "skipped": 0}

        items, _total = _list_slugs(client, token)
        assert items[0]["viewed_at"].startswith("2024-03-01T10:30:00")

    def test_requires_token(self, client):
        assert (
            client.post(
                "/api/reader/me/history/import",
                json={"items": [{"slug": "x"}]},
            ).status_code
            == 401
        )

    def test_empty_items_rejected(self, client, auth_headers):
        token = _token(client)
        assert _import(client, token, []).status_code == 422

    def test_over_cap_items_rejected(self, client, auth_headers):
        token = _token(client)
        items = [{"slug": f"s-{i}"} for i in range(1001)]
        assert _import(client, token, items).status_code == 422

    def test_response_is_no_store(self, client, auth_headers):
        # Write-on-read/private endpoints keep the global no-store default
        # (middleware cache policy — TASK-129); a shared cache must never hold
        # a reader's history mutation response.
        token = _token(client)
        resp = _import(client, token, [{"slug": "missing", "viewed_at": None}])
        assert resp.status_code == 200
        assert resp.headers.get("cache-control") == "no-store"

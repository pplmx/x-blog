"""Server-backed reading-history API contract tests (DEC-116, TASK-170).

A signed-in reader's view history is persisted server-side one row per
(reader, post) with a ``viewed_at`` stamp — idempotent upsert on record, a
newest-first publicly-visible list, pagination, isolation between readers, and
a clear-history action. Mirrors the bookmark contract (auth scoping, no
draft-oracle, hidden-post read-path invariant).
"""

HISTORY = "/api/reader/me/history"


def _register(client, email="historian@example.com", password="readerpass123"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _token(client, email="historian@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, published=True, draft=False, **overrides):
    """Create a post directly via crud (bypasses the admin API for brevity)."""
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "Readable post",
                "slug": f"history-{_slug_counter}",
                "content": "# Hello\n\nWorld",
                "published": False if draft else published,
                **overrides,
            }
        ),
    )


class TestAuthRequired:
    def test_list_requires_reader_token(self, client):
        assert client.get(HISTORY).status_code == 401

    def test_record_requires_reader_token(self, client):
        assert client.post(f"{HISTORY}/1").status_code == 401

    def test_clear_requires_reader_token(self, client):
        assert client.delete(HISTORY).status_code == 401

    def test_admin_token_cannot_access_history(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        assert client.get(HISTORY, headers=headers).status_code == 401


class TestRecordView:
    def test_record_appears_in_list(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, title="First", slug="first-read")
        resp = client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["post_id"] == post.id
        assert body["already_existed"] is False

        listed = client.get(HISTORY, headers=_auth(token)).json()
        assert listed["total"] == 1
        item = listed["items"][0]
        assert item["id"] == post.id
        assert item["title"] == "First"
        assert item["slug"] == "first-read"
        assert "content" not in item
        assert item["viewed_at"] is not None

    def test_record_is_idempotent_upsert(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        assert client.post(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["already_existed"] is False
        again = client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert again.status_code == 200
        assert again.json()["already_existed"] is True
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 1  # no duplicate

    def test_revisit_moves_post_to_front(self, client, db_session):
        token = _token(client)
        a = _create_post(db_session, slug="hist-front-a")
        b = _create_post(db_session, slug="hist-front-b")
        client.post(f"{HISTORY}/{a.id}", headers=_auth(token))
        client.post(f"{HISTORY}/{b.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["items"][0]["id"] == b.id
        # Re-reading A bumps it to the front.
        client.post(f"{HISTORY}/{a.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["items"][0]["id"] == a.id

    def test_record_draft_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="draft-read", draft=True)
        assert client.post(f"{HISTORY}/{post.id}", headers=_auth(token)).status_code == 404

    def test_record_unknown_post_rejected(self, client):
        token = _token(client)
        assert client.post(f"{HISTORY}/999999", headers=_auth(token)).status_code == 404

    def test_record_scheduled_future_post_rejected(self, client, db_session):
        from datetime import UTC, datetime, timedelta

        token = _token(client)
        post = _create_post(
            db_session,
            slug="future-read",
            published=True,
            publish_at=(datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        )
        assert client.post(f"{HISTORY}/{post.id}", headers=_auth(token)).status_code == 404


class TestListHistory:
    def test_empty_list(self, client):
        token = _token(client)
        resp = client.get(HISTORY, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_newest_first_ordering(self, client, db_session):
        token = _token(client)
        p1 = _create_post(db_session, title="1")
        p2 = _create_post(db_session, title="2")
        p3 = _create_post(db_session, title="3")
        for pid in (p1.id, p2.id, p3.id):
            client.post(f"{HISTORY}/{pid}", headers=_auth(token))
        listed = client.get(HISTORY, headers=_auth(token)).json()
        assert [i["id"] for i in listed["items"]] == [p3.id, p2.id, p1.id]

    def test_pagination(self, client, db_session):
        token = _token(client)
        posts = [_create_post(db_session) for _ in range(3)]
        for p in posts:
            client.post(f"{HISTORY}/{p.id}", headers=_auth(token))

        page1 = client.get(f"{HISTORY}?page=1&limit=2", headers=_auth(token)).json()
        assert page1["total"] == 3
        assert page1["total_pages"] == 2
        assert len(page1["items"]) == 2

        page2 = client.get(f"{HISTORY}?page=2&limit=2", headers=_auth(token)).json()
        assert page2["total"] == 3
        assert len(page2["items"]) == 1

    def test_pagination_is_applied_in_sql(self, client, db_session, test_engine):
        from sqlalchemy import event

        token = _token(client)
        posts = [_create_post(db_session) for _ in range(3)]
        for post in posts:
            client.post(f"{HISTORY}/{post.id}", headers=_auth(token))

        statements = []

        def capture_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(test_engine, "before_cursor_execute", capture_statement)
        try:
            response = client.get(f"{HISTORY}?page=2&limit=1", headers=_auth(token))
        finally:
            event.remove(test_engine, "before_cursor_execute", capture_statement)

        assert response.status_code == 200
        history_queries = [
            statement for statement in statements if "JOIN reading_history" in statement and "FROM posts" in statement
        ]
        count_queries = [
            statement
            for statement in statements
            if "count(reading_history.id)" in statement and "JOIN posts" in statement
        ]
        assert history_queries
        assert count_queries
        assert "LIMIT" in history_queries[0]
        assert "OFFSET" in history_queries[0]
        for statement in (history_queries[0], count_queries[0]):
            assert "posts.published" in statement
            assert "posts.publish_at" in statement

    def test_history_without_viewed_timestamp_is_excluded(self, client, db_session):
        from app import auth, models

        token = _token(client)
        reader = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "historian@example.com").one()
        post = _create_post(db_session)
        db_session.add(models.ReadingHistory(reader_id=reader.id, post_id=post.id, viewed_at=None))
        db_session.flush()
        db_session.query(models.ReadingHistory).filter(
            models.ReadingHistory.reader_id == reader.id,
            models.ReadingHistory.post_id == post.id,
        ).update({models.ReadingHistory.viewed_at: None})
        db_session.flush()

        response = client.get(HISTORY, headers=_auth(token))

        assert response.status_code == 200
        assert response.json()["total"] == 0
        assert response.json()["items"] == []

    def test_unpublished_post_disappears_from_list(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        post = _create_post(db_session, slug="goes-dark-read")
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 1
        update_post(db_session, post.id, PostUpdate(published=False))
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 0

    def test_list_isolation_between_readers(self, client, db_session):
        t1 = _token(client, email="iso1@example.com")
        t2 = _token(client, email="iso2@example.com")
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))
        assert client.get(HISTORY, headers=_auth(t1)).json()["total"] == 1
        assert client.get(HISTORY, headers=_auth(t2)).json()["total"] == 0


class TestClearHistory:
    def test_clear_empties_and_is_idempotent(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 1

        first = client.delete(HISTORY, headers=_auth(token))
        assert first.status_code == 204
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 0

        again = client.delete(HISTORY, headers=_auth(token))
        assert again.status_code == 204  # idempotent no-op

    def test_clear_does_not_affect_other_reader(self, client, db_session):
        t1 = _token(client, email="clr1@example.com")
        t2 = _token(client, email="clr2@example.com")
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t2))
        client.delete(HISTORY, headers=_auth(t1))
        assert client.get(HISTORY, headers=_auth(t1)).json()["total"] == 0
        assert client.get(HISTORY, headers=_auth(t2)).json()["total"] == 1


class TestReadingStats:
    STATS = f"{HISTORY}/stats"

    def test_stats_requires_reader_token(self, client):
        assert client.get(self.STATS).status_code == 401

    def test_empty_stats(self, client):
        token = _token(client)
        resp = client.get(self.STATS, headers=_auth(token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_posts"] == 0
        assert body["total_reading_minutes"] == 0
        assert body["last_viewed_at"] is None
        assert body["recent"] == []

    def test_stats_aggregate(self, client, db_session):
        token = _token(client)
        posts = [_create_post(db_session, title=f"P{i}") for i in range(3)]
        for p in posts:
            client.post(f"{HISTORY}/{p.id}", headers=_auth(token))
        body = client.get(self.STATS, headers=_auth(token)).json()
        assert body["total_posts"] == 3
        # Each short post reads as 1 minute (schemas.reading_minutes floor).
        assert body["total_reading_minutes"] == 3
        assert body["last_viewed_at"] is not None
        # recent is newest-first post summaries (no content dump).
        assert [i["id"] for i in body["recent"]] == [posts[2].id, posts[1].id, posts[0].id]
        assert "content" not in body["recent"][0]

    def test_stats_recent_capped(self, client, db_session):
        token = _token(client)
        for _ in range(10):
            p = _create_post(db_session)
            client.post(f"{HISTORY}/{p.id}", headers=_auth(token))
        body = client.get(self.STATS, headers=_auth(token)).json()
        assert body["total_posts"] == 10
        assert len(body["recent"]) == 6  # top-N most recent

    def test_stats_excludes_unpublished(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(self.STATS, headers=_auth(token)).json()["total_posts"] == 1
        update_post(db_session, post.id, PostUpdate(published=False))
        assert client.get(self.STATS, headers=_auth(token)).json()["total_posts"] == 0

    def test_stats_isolated_between_readers(self, client, db_session):
        t1 = _token(client, email="stats1@example.com")
        t2 = _token(client, email="stats2@example.com")
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))
        assert client.get(self.STATS, headers=_auth(t1)).json()["total_posts"] == 1
        assert client.get(self.STATS, headers=_auth(t2)).json()["total_posts"] == 0

    def test_stats_sums_stored_minutes_not_live_content(self, client, db_session):
        """ISS-451 regression: total_reading_minutes is a SQL aggregate of the
        denormalized reading_history.reading_minutes column (the estimate as of
        the last read), NOT a live scan of post content — so editing a post
        after it was read leaves the reader's aggregate unchanged, and the
        stats page never materializes content."""
        from app.crud import update_post
        from app.schemas import PostUpdate, reading_minutes

        token = _token(client, email="minutes@example.com")
        long_content = " ".join(f"word{i}" for i in range(460))  # round(460/200) -> 2 min
        assert reading_minutes(long_content) == 2
        post = _create_post(db_session, content=long_content)

        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        body = client.get(self.STATS, headers=_auth(token)).json()
        assert body["total_reading_minutes"] == 2

        # Post shrinks to a 1-minute read after the reader already viewed it:
        # the stored read-time estimate (2) must win.
        update_post(db_session, post.id, PostUpdate(content="now tiny"))
        body = client.get(self.STATS, headers=_auth(token)).json()
        assert body["total_reading_minutes"] == 2


class TestScrollPosition:
    """Per-post resume position (DEC-167, TASK-200).

    ``scroll_position`` is an optional pixel offset saved with a view so a
    signed-in reader can resume where they left off inside a post. The record
    endpoint accepts an optional JSON body: a plain view (no body / null)
    preserves an existing position, an explicit ``0`` clears it, and a save
    updates it in place. ``GET /me/history/{post_id}`` reads the position back
    for the post page to restore on return (null when never viewed).
    """

    def test_record_with_body_requires_reader_token(self, client):
        assert client.post(f"{HISTORY}/1", json={"scroll_position": 100}).status_code == 401

    def test_position_read_requires_reader_token(self, client):
        assert client.get(f"{HISTORY}/1").status_code == 401

    def test_position_saved_and_read_back(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-readback")
        resp = client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 420}, headers=_auth(token))
        assert resp.status_code == 200, resp.text
        got = client.get(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert got.status_code == 200
        assert got.json() == {"post_id": post.id, "scroll_position": 420, "scroll_fraction": None}

    def test_plain_view_preserves_existing_position(self, client, db_session):
        """Re-opening a post (no body) must not wipe the saved position."""
        token = _token(client)
        post = _create_post(db_session, slug="pos-preserve")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 500}, headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["scroll_position"] == 500

    def test_position_zero_overwrites(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-zero")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 500}, headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 0}, headers=_auth(token))
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["scroll_position"] == 0

    def test_position_updated_in_place(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-update")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 100}, headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 2400}, headers=_auth(token))
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["scroll_position"] == 2400

    def test_negative_position_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-negative")
        resp = client.post(f"{HISTORY}/{post.id}", json={"scroll_position": -1}, headers=_auth(token))
        assert resp.status_code == 422

    def test_excessive_position_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-huge")
        resp = client.post(
            f"{HISTORY}/{post.id}",
            json={"scroll_position": 99_000_000_000},
            headers=_auth(token),
        )
        assert resp.status_code == 422

    def test_unviewed_post_returns_null_position(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-unviewed")
        got = client.get(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert got.status_code == 200
        assert got.json() == {"post_id": post.id, "scroll_position": None, "scroll_fraction": None}

    def test_position_read_draft_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="pos-draft", draft=True)
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).status_code == 404

    def test_position_is_reader_isolated(self, client, db_session):
        t1 = _token(client, email="pos1@example.com")
        t2 = _token(client, email="pos2@example.com")
        post = _create_post(db_session, slug="pos-isolated")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 777}, headers=_auth(t1))
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(t1)).json()["scroll_position"] == 777
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(t2)).json()["scroll_position"] is None

    def test_position_not_exposed_in_public_post(self, client, db_session):
        """Anonymous visitors cannot read a reader's saved position."""
        post = _create_post(db_session, slug="pos-public")
        assert client.get(f"{HISTORY}/{post.id}").status_code == 401


class TestScrollFraction:
    """Cross-viewport resume fraction (DEC-346, TASK-399).

    ``scroll_fraction`` (0..1, nullable) is the reader's resume position as a
    fraction of the scrollable document height, saved alongside the pixel
    offset so a phone->desktop continuation restores at the same place. The
    record endpoint accepts it in the same optional body as ``scroll_position``
    (saved/updated in place, preserved on a plain view); ``GET`` returns both.
    Like the pixel, it must be bounded, reader-isolated, never public, and
    rejected out of range.
    """

    def test_fraction_saved_and_read_back(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="fr-saved")
        resp = client.post(
            f"{HISTORY}/{post.id}",
            json={"scroll_position": 3000, "scroll_fraction": 0.25},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        got = client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()
        assert got == {"post_id": post.id, "scroll_position": 3000, "scroll_fraction": 0.25}

    def test_plain_view_preserves_existing_fraction(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="fr-preserve")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_fraction": 0.75}, headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["scroll_fraction"] == 0.75

    def test_fraction_zero_is_valid(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="fr-zero")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 500, "scroll_fraction": 0.5}, headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 0, "scroll_fraction": 0.0}, headers=_auth(token))
        got = client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()
        assert got["scroll_fraction"] == 0.0

    def test_fraction_updated_in_place(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="fr-update")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_fraction": 0.25}, headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", json={"scroll_fraction": 0.9}, headers=_auth(token))
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["scroll_fraction"] == 0.9

    def test_out_of_range_fraction_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="fr-oob")
        for bad in (-0.1, 1.5):
            resp = client.post(f"{HISTORY}/{post.id}", json={"scroll_fraction": bad}, headers=_auth(token))
            assert resp.status_code == 422, resp.text
        assert client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["scroll_fraction"] is None

    def test_legacy_row_reads_back_null_fraction(self, client, db_session):
        """Rows saved before the fraction existed keep null fraction + pixel —
        the client falls back to the pixel, so old data still resumes."""
        from app import models

        token = _token(client, email="fr-legacy@example.com")
        post = _create_post(db_session, slug="fr-legacy")
        # Simulate a pre-feature row: pixel only, no fraction.
        from app.auth import ReaderAccount

        rid = db_session.query(ReaderAccount).filter(ReaderAccount.email == "fr-legacy@example.com").one().id
        from app.crud import utc_now_naive

        db_session.add(
            models.ReadingHistory(
                reader_id=rid,
                post_id=post.id,
                viewed_at=utc_now_naive(),
                scroll_position=1200,
            )
        )
        db_session.commit()
        got = client.get(f"{HISTORY}/{post.id}", headers=_auth(token)).json()
        assert got["scroll_position"] == 1200
        assert got["scroll_fraction"] is None


class TestInProgress:
    """Server-trail continue reading (DEC-348, TASK-400).

    The home page's "Continue reading" row is localStorage-only today, so a
    signed-in reader on a new device sees nothing even though the server trail
    holds their resume positions. This endpoint surfaces the cross-device trail
    outside /history: posts with a saved, POSITIVE resume position
    (``scroll_position > 0``) exposed newest-first. Plain views (no saved
    position) and rows cleared back to the top (0) are not "in progress";
    drafts/scheduled posts stay hidden (same non-leak invariant as the list).
    """

    def test_requires_reader_token(self, client):
        assert client.get(f"{HISTORY}/in-progress").status_code == 401

    def test_literal_route_does_not_collide_with_post_id(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="ip-collide")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 500}, headers=_auth(token))
        # A numeric id must NOT be routed to the literal in-progress endpoint.
        assert client.get(f"{HISTORY}/in-progress", headers=_auth(token)).status_code == 200

    def test_only_saved_positions_are_in_progress(self, client, db_session):
        token = _token(client)
        plain = _create_post(db_session, slug="ip-plain")  # viewed, no position saved
        started = _create_post(db_session, slug="ip-started")  # scrolled into
        cleared = _create_post(db_session, slug="ip-cleared")  # jumped back to top = 0
        for p in (plain, started, cleared):
            client.post(f"{HISTORY}/{p.id}", headers=_auth(token))
        client.post(
            f"{HISTORY}/{started.id}",
            json={"scroll_position": 800, "scroll_fraction": 0.1},
            headers=_auth(token),
        )
        client.post(
            f"{HISTORY}/{cleared.id}",
            json={"scroll_position": 0, "scroll_fraction": 0.0},
            headers=_auth(token),
        )

        body = client.get(f"{HISTORY}/in-progress?limit=10", headers=_auth(token)).json()
        assert [i["id"] for i in body["items"]] == [started.id]
        assert body["total"] == 1
        item = body["items"][0]
        assert item["slug"] == "ip-started"
        assert item["viewed_at"] is not None
        assert "content" not in item

    def test_legacy_row_without_fraction_is_in_progress(self, client, db_session):
        """Rows saved before the fraction existed carry a pixel only; the
        predicate is on scroll_position, so they still count as in-progress."""
        token = _token(client)
        post = _create_post(db_session, slug="ip-legacy")
        client.post(f"{HISTORY}/{post.id}", json={"scroll_position": 1200}, headers=_auth(token))
        body = client.get(f"{HISTORY}/in-progress", headers=_auth(token)).json()
        assert [i["id"] for i in body["items"]] == [post.id]

    def test_newest_first_and_revisit_bumps_to_front(self, client, db_session):
        token = _token(client)
        older = _create_post(db_session, slug="ip-older")
        newer = _create_post(db_session, slug="ip-newer")
        client.post(f"{HISTORY}/{older.id}", json={"scroll_position": 300}, headers=_auth(token))
        client.post(f"{HISTORY}/{newer.id}", json={"scroll_position": 600}, headers=_auth(token))
        assert [i["id"] for i in client.get(f"{HISTORY}/in-progress", headers=_auth(token)).json()["items"]] == [
            newer.id,
            older.id,
        ]
        # Re-reading the older post bumps its viewed_at to the front.
        client.post(f"{HISTORY}/{older.id}", json={"scroll_position": 300}, headers=_auth(token))
        assert [i["id"] for i in client.get(f"{HISTORY}/in-progress", headers=_auth(token)).json()["items"]] == [
            older.id,
            newer.id,
        ]

    def test_limit_is_respected(self, client, db_session):
        token = _token(client)
        posts = [_create_post(db_session, slug=f"ip-limit-{i}") for i in range(3)]
        for p in posts:
            client.post(f"{HISTORY}/{p.id}", json={"scroll_position": 400}, headers=_auth(token))
        body = client.get(f"{HISTORY}/in-progress?limit=2", headers=_auth(token)).json()
        assert [i["id"] for i in body["items"]] == [posts[2].id, posts[1].id]
        assert body["total"] == 3

    def test_empty_when_nothing_in_progress(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="ip-empty")
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))  # plain view only
        body = client.get(f"{HISTORY}/in-progress", headers=_auth(token)).json()
        assert body == {"items": [], "total": 0, "page": 1, "limit": 6, "total_pages": 0}

    def test_draft_and_reader_isolated(self, client, db_session):
        """A post that went dark (draft/scheduled) with a saved position must
        not leak; another reader's positions are not in progress for this
        reader."""
        from app import models
        from app.auth import ReaderAccount
        from app.crud import utc_now_naive

        token = _token(client, email="ip-iso@example.com")
        rid = db_session.query(ReaderAccount).filter(ReaderAccount.email == "ip-iso@example.com").one().id
        draft = _create_post(db_session, draft=True, slug="ip-dark")
        db_session.add(
            models.ReadingHistory(
                reader_id=rid,
                post_id=draft.id,
                viewed_at=utc_now_naive(),
                scroll_position=500,
            )
        )
        db_session.commit()
        assert [i["id"] for i in client.get(f"{HISTORY}/in-progress", headers=_auth(token)).json()["items"]] == []

        other = _create_post(db_session, slug="ip-other")
        other_token = _token(client, email="ip-other@example.com")
        client.post(f"{HISTORY}/{other.id}", json={"scroll_position": 500}, headers=_auth(other_token))
        assert [i["id"] for i in client.get(f"{HISTORY}/in-progress", headers=_auth(token)).json()["items"]] == []


class TestActivityStreak:
    """Reading-streak + daily-activity stats (DEC-169, TASK-201).

    ``ReadingStatsResponse`` gains ``current_streak`` / ``longest_streak`` and an
    ``activity`` list of per-day read counts covering the last 52 weeks (UTC
    dates, zeros included). Streaks are computed from the distinct UTC
    ``viewed_at`` dates of publicly-visible reads; the current streak counts
    consecutive days ending today (or yesterday, while today is still being
    read); the longest is the longest run anywhere.
    """

    ACTIVITY_DAYS = 364  # must match crud.ACTIVITY_DAYS

    def _reader_id(self, db_session, email="historian@example.com"):
        from app.auth import ReaderAccount

        return db_session.query(ReaderAccount).filter(ReaderAccount.email == email).first().id

    def _seed(self, db_session, reader_id, post_ids, dates):
        """Insert reading_history rows directly with fixed UTC viewed_at dates."""
        from app import models

        for pid, d in zip(post_ids, dates, strict=True):
            db_session.add(models.ReadingHistory(reader_id=reader_id, post_id=pid, viewed_at=d))
        db_session.commit()

    def _dates_from_now(self, offsets, hour=12):
        from datetime import UTC, datetime, timedelta

        return [datetime.now(UTC) - timedelta(days=o) for o in offsets]

    def _stats(self, client, token, tz=None):
        params = {"tz": tz} if tz is not None else None
        return client.get(f"{HISTORY}/stats", params=params, headers=_auth(token)).json()

    def test_empty_stats_have_zero_streaks_and_zeroed_activity(self, client, db_session):
        token = _token(client)
        body = self._stats(client, token)
        assert body["current_streak"] == 0
        assert body["longest_streak"] == 0
        assert len(body["activity"]) == self.ACTIVITY_DAYS
        assert all(a["count"] == 0 for a in body["activity"])
        assert body["activity"][-1]["count"] == 0  # today untracked until read

    def test_single_day_read_gives_streak_of_one_and_counts_today(self, client, db_session):

        token = _token(client)
        reader_id = self._reader_id(db_session)
        posts = [_create_post(db_session) for _ in range(2)]
        self._seed(db_session, reader_id, [p.id for p in posts], self._dates_from_now([0, 0]))

        body = self._stats(client, token)
        assert body["current_streak"] == 1
        assert body["longest_streak"] == 1
        assert body["activity"][-1]["count"] == 2  # two reads today

    def test_consecutive_days_count_toward_current_streak(self, client, db_session):
        token = _token(client)
        reader_id = self._reader_id(db_session)
        posts = [_create_post(db_session) for _ in range(3)]
        # Today, yesterday, day-before: a 3-day current streak.
        self._seed(db_session, reader_id, [p.id for p in posts], self._dates_from_now([0, 1, 2]))

        body = self._stats(client, token)
        assert body["current_streak"] == 3
        assert body["longest_streak"] == 3

    def test_gap_today_counts_from_yesterday_and_longest_wins(self, client, db_session):
        token = _token(client)
        reader_id = self._reader_id(db_session)
        posts = [_create_post(db_session) for _ in range(6)]
        # A 5-day past run (today-4..today-8) plus activity only yesterday.
        dates = self._dates_from_now([1, 4, 5, 6, 7, 8])
        self._seed(db_session, reader_id, [p.id for p in posts], dates)

        body = self._stats(client, token)
        # Today is inactive -> current stretches back from yesterday (length 1);
        # the longest run anywhere is the 5-day one.
        assert body["current_streak"] == 1
        # NB: current run from yesterday only touches day 1; it does not merge
        # with the -4..-8 run (day 2,3 gap), so it stays 1.
        assert body["longest_streak"] == 5

    def test_activity_buckets_counts_per_date(self, client, db_session):
        token = _token(client)
        reader_id = self._reader_id(db_session)
        posts = [_create_post(db_session) for _ in range(4)]
        today, yesterday = self._dates_from_now([0, 1])
        self._seed(
            db_session,
            reader_id,
            [posts[0].id, posts[1].id, posts[2].id, posts[3].id],
            [today, today, yesterday, yesterday],
        )

        body = self._stats(client, token)
        by_date = {a["date"]: a["count"] for a in body["activity"]}
        assert by_date[today.date().isoformat()] == 2
        assert by_date[yesterday.date().isoformat()] == 2
        assert len([a for a in body["activity"] if a["count"]]) == 2  # only two lit days

    def test_streak_ignores_non_public_posts(self, client, db_session):

        token = _token(client)
        reader_id = self._reader_id(db_session)
        draft = _create_post(db_session, slug="streak-draft", draft=True)
        self._seed(db_session, reader_id, [draft.id], self._dates_from_now([0]))

        body = self._stats(client, token)
        assert body["current_streak"] == 0
        assert body["activity"][-1]["count"] == 0

    # --- timezone-aware bucketing (round 319, DEC-316/TASK-386) ---------------
    # The pre-fix endpoint bucketed every day in UTC while the face the reader
    # sees renders those buckets in local time, so for every non-UTC reader the
    # streak and heatmap disagreed with their own calendar. The stats endpoint
    # now accepts an IANA ``tz`` and buckets reads (and anchors the streak +
    # activity window) to the reader's local calendar day.

    def test_tz_query_shifts_bucket_dates_to_the_reader_local_calendar(self, client, db_session):
        """A read whose UTC date differs from its Honolulu local date must be
        bucketed (and thus shown on the heatmap) under the LOCAL calendar day
        when ``tz`` is sent. The 2026-06-01T00:30Z instant is 2026-05-31 14:30
        in Pacific/Honolulu — the fixed instant makes this deterministic
        regardless of when the suite runs."""
        from datetime import datetime

        token = _token(client)
        reader_id = self._reader_id(db_session)
        post = _create_post(db_session)
        self._seed(db_session, reader_id, [post.id], [datetime(2026, 6, 1, 0, 30)])

        def lit_dates(body):
            return sorted(a["date"] for a in body["activity"] if a["count"])

        assert lit_dates(self._stats(client, token)) == ["2026-06-01"]  # UTC default
        assert lit_dates(self._stats(client, token, tz="Pacific/Honolulu")) == ["2026-05-31"]

    def test_unknown_tz_is_rejected_with_a_422(self, client):
        token = _token(client)
        resp = client.get(f"{HISTORY}/stats", params={"tz": "Not\\A/Timezone"}, headers=_auth(token))
        assert resp.status_code == 422

    def test_streak_and_activity_anchor_to_the_reader_local_today(self, client, db_session):
        """The current streak and the heatmap's final (today) cell must align to
        the reader's LOCAL calendar day, not UTC. We pick the test zone so its
        local date is guaranteed to differ from the UTC date at this instant
        (UTC−10 and UTC+14 straddle the date line such that at least one always
        differs at any UTC hour), seed a read "right now", and require the
        server to credit it to that local today — the pre-fix response credited
        UTC today instead and failed on every non-UTC reader."""
        from datetime import UTC, datetime
        from zoneinfo import ZoneInfo

        utc_now = datetime.now(UTC)
        utc_today = utc_now.date()
        tz_id = None
        for candidate in ("Pacific/Kiritimati", "Pacific/Honolulu"):
            if utc_now.astimezone(ZoneInfo(candidate)).date() != utc_today:
                tz_id = candidate
                break
        assert tz_id is not None  # at least one straddles the date line at any instant

        token = _token(client)
        reader_id = self._reader_id(db_session)
        post = _create_post(db_session)
        self._seed(db_session, reader_id, [post.id], [utc_now])

        body = self._stats(client, token, tz=tz_id)
        local_today = utc_now.astimezone(ZoneInfo(tz_id)).date().isoformat()
        assert body["activity"][-1]["date"] == local_today
        assert body["activity"][-1]["count"] == 1
        assert body["current_streak"] >= 1

    def test_day_activity_window_ends_at_the_supplied_local_today(self):
        from datetime import date, timedelta

        from app.crud import ACTIVITY_DAYS, _day_activity

        out = _day_activity({date(2026, 9, 13): 2}, today=date(2026, 9, 13))
        assert len(out) == ACTIVITY_DAYS
        assert out[-1] == {"date": "2026-09-13", "count": 2}
        assert out[0]["date"] == (date(2026, 9, 13) - timedelta(days=ACTIVITY_DAYS - 1)).isoformat()

    def test_current_streak_uses_the_supplied_local_today(self):
        from datetime import date

        from app.crud import _current_streak

        dates = {date(2026, 9, 12), date(2026, 9, 13)}
        assert _current_streak(dates, today=date(2026, 9, 13)) == 2  # today active
        # Today idle → the anchor falls back to yesterday (the "hasn't read
        # *yet* today" grace), so the run still counts 13+12 = 2.
        assert _current_streak(dates, today=date(2026, 9, 14)) == 2
        # Neither today nor yesterday active under the *supplied* anchor → 0,
        # even if another wall-clock yearns for "today" (the tz anchor is
        # authoritative, DEC-316).
        assert _current_streak(dates, today=date(2026, 9, 15)) == 0

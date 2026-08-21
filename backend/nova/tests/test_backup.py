"""Full-blog backup & restore contract tests (DEC-082, TASK-153).

Covers:
- GET /api/admin/backup is superuser-only (401 anon/reader, 403 editor) and
  returns the whole blog as an ``x-blog-backup`` v1 snapshot — categories,
  tags, series, posts (category/tags/series links + view/like counters) and
  comment threads with parent ordinals and the reader-attributed marker —
  while NEVER carrying auth data (no reader accounts / users / password
  hashes / push subscriptions).
- POST /api/admin/backup/restore round-trips the snapshot: categories/tags by
  name, series by slug, posts by slug, comments re-attached (post-level) with
  parents re-wired across export order; reader-linked comments degrade to
  anonymous (reader accounts don't round-trip).
- Restoring the same snapshot twice is idempotent (import_key dedupe — no
  duplicate comments; posts upserted, not duplicated).
- Unknown format / too many posts are rejected with 422.
"""

from app import models
from app.crud import create_post
from app.schemas import PostCreate


def _create_post(db_session, slug, *, category=None, tags=None, series=None, published=True):
    post = create_post(
        db_session,
        PostCreate(title=f"Title {slug}", slug=slug, content=f"# {slug}", published=published),
    )
    if category is not None:
        post.category = category
    if tags:
        post.tags = tags
    if series is not None:
        post.series = series
        post.series_order = 1
    db_session.flush()
    return post


def _seed_blog(db_session):
    cat = models.Category(name="技术")
    tag_a = models.Tag(name="python")
    tag_b = models.Tag(name="nuxt")
    srs = models.Series(title="系列一", slug="series-one", description="d")
    db_session.add_all([cat, tag_a, tag_b, srs])
    db_session.flush()

    post = _create_post(db_session, "hello-world", category=cat, tags=[tag_a, tag_b], series=srs)
    post.views = 123
    post.likes = 4
    parent = models.Comment(
        post_id=post.id,
        nickname="Guest",
        email="g@x.com",
        content="top comment",
        is_approved=True,
    )
    db_session.add(parent)
    db_session.flush()
    db_session.add(
        models.Comment(
            post_id=post.id,
            parent_id=parent.id,
            nickname="Reader",
            email=None,
            content="a reply",
            is_approved=False,
            reader_id=99,  # reader 99 does not exist here — the link must degrade
        )
    )
    _create_post(db_session, "draft-post", published=False, tags=[tag_b])
    db_session.flush()
    return post


def _wipe_content(db_session):
    db_session.query(models.Comment).delete()
    # post_tags is the join table with FKs into posts/tags — clear it before
    # deleting either side (SQLite enforces FKs in the test engine).
    db_session.execute(models.post_tags.delete())
    db_session.query(models.Post).delete()
    db_session.query(models.Series).delete()
    db_session.query(models.Tag).delete()
    db_session.query(models.Category).delete()
    db_session.flush()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


class TestBackupAuthz:
    def test_anonymous_rejected(self, client):
        assert client.get("/api/admin/backup").status_code == 401

    def test_reader_token_rejected(self, client):
        from app.auth import create_reader_token

        token = create_reader_token({"sub": 1})
        assert client.get("/api/admin/backup", headers=_auth(token)).status_code == 401

    def test_editor_rejected(self, client, editor_headers):
        # Export carries commenter PII and restore is a bulk write — both are
        # superuser-only (editors moderate content but must not dump/overwrite).
        assert client.get("/api/admin/backup", headers=editor_headers).status_code == 403
        assert (
            client.post(
                "/api/admin/backup/restore",
                json={"format": "x-blog-backup", "version": 1, "posts": []},
                headers=editor_headers,
            ).status_code
            == 403
        )

    def test_restore_anonymous_rejected(self, client):
        assert (
            client.post(
                "/api/admin/backup/restore",
                json={"format": "x-blog-backup", "version": 1, "posts": []},
            ).status_code
            == 401
        )


class TestBackupSnapshot:
    def test_exports_full_blog_without_auth_data(self, client, db_session, auth_headers):
        _seed_blog(db_session)
        response = client.get("/api/admin/backup", headers=auth_headers)
        assert response.status_code == 200
        snap = response.json()
        assert snap["format"] == "x-blog-backup"
        assert snap["version"] == 1
        assert [c["name"] for c in snap["categories"]] == ["技术"]
        assert {t["name"] for t in snap["tags"]} == {"python", "nuxt"}
        assert [s["slug"] for s in snap["series"]] == ["series-one"]
        by_slug = {p["slug"]: p for p in snap["posts"]}

        post = by_slug["hello-world"]
        assert post["category"] == "技术"
        assert set(post["tags"]) == {"python", "nuxt"}
        assert post["series"] == "series-one"
        assert post["views"] == 123
        assert post["likes"] == 4
        assert post["published"] is True

        comments = post["comments"]
        assert len(comments) == 2
        top = next(c for c in comments if c["nickname"] == "Guest")
        reply = next(c for c in comments if c["nickname"] == "Reader")
        assert top["parent_ordinal"] is None
        assert reply["parent_ordinal"] == comments.index(top)
        assert top["reader"] is False
        assert reply["reader"] is True
        assert by_slug["draft-post"]["published"] is False

        # Auth data must never leak into the snapshot. (`import_key` is part of
        # the format — the restore idempotency anchor — so it's expected.)
        raw = response.text
        for forbidden in ("password", "want_new_posts", "reader_accounts", "token_version"):
            assert forbidden not in raw, f"backup must not contain {forbidden!r} (leaked auth/impl data)"


class TestBackupRestore:
    def test_round_trip_restores_full_blog(self, client, db_session, auth_headers):
        _seed_blog(db_session)
        snap = client.get("/api/admin/backup", headers=auth_headers).json()

        _wipe_content(db_session)
        assert db_session.query(models.Post).count() == 0

        response = client.post("/api/admin/backup/restore", json=snap, headers=auth_headers)
        assert response.status_code == 200, response.text
        counts = response.json()
        assert counts["categories"] == 1
        assert counts["tags"] == 2
        assert counts["series"] == 1
        assert counts["posts_created"] == 2
        assert counts["posts_updated"] == 0
        assert counts["comments_created"] == 2
        assert counts["comments_skipped"] == 0

        # Categories/tags/series by natural key.
        assert db_session.query(models.Category).filter_by(name="技术").count() == 1
        assert db_session.query(models.Tag).count() == 2
        series = db_session.query(models.Series).filter_by(slug="series-one").one()

        # Posts restored with links + counters; comments re-attached + parent
        # re-wired (restore re-creates the reply and its parent link).
        post = db_session.query(models.Post).filter_by(slug="hello-world").one()
        assert post.views == 123 and post.likes == 4
        assert post.category.name == "技术"
        assert {t.name for t in post.tags} == {"python", "nuxt"}
        assert post.series_id == series.id
        draft = db_session.query(models.Post).filter_by(slug="draft-post").one()
        assert draft.published is False

        comments = db_session.query(models.Comment).filter_by(post_id=post.id).all()
        assert len(comments) == 2
        reply = next(c for c in comments if c.nickname == "Reader")
        assert reply.parent_id is not None  # parent link survived the round trip
        assert reply.parent.nickname == "Guest"
        # reader-linked comment degrades to anonymous; import_key preserved.
        assert reply.reader_id is None
        assert reply.import_key == "hello-world#1"

    def test_restore_into_existing_blog_upserts_and_merges(self, client, db_session, auth_headers):
        """Re-importing into an existing restore: same slugs are UPDATED, and
        comments already imported (their import_key matches) are skipped —
        never duplicated."""
        _seed_blog(db_session)
        snap = client.get("/api/admin/backup", headers=auth_headers).json()
        _wipe_content(db_session)
        first = client.post("/api/admin/backup/restore", json=snap, headers=auth_headers)
        assert first.status_code == 200  # comments now carry import_key

        # Perturb the live post, then restore again: the existing row updates.
        post = db_session.query(models.Post).filter_by(slug="hello-world").one()
        post.title = "changed locally"
        post.published = False
        db_session.commit()
        db_session.refresh(post)

        response = client.post("/api/admin/backup/restore", json=snap, headers=auth_headers)
        assert response.status_code == 200
        counts = response.json()
        assert counts["posts_created"] == 0  # both slugs already exist
        assert counts["posts_updated"] == 2
        assert counts["comments_skipped"] == 2  # import_key matches the imported rows

        post = db_session.query(models.Post).filter_by(slug="hello-world").one()
        assert post.title == "Title hello-world"  # restored from the snapshot
        assert post.published is True
        assert db_session.query(models.Comment).filter_by(post_id=post.id).count() == 2  # no dupes

    def test_restore_same_snapshot_twice_is_idempotent(self, client, db_session, auth_headers):
        _seed_blog(db_session)
        snap = client.get("/api/admin/backup", headers=auth_headers).json()
        _wipe_content(db_session)

        first = client.post("/api/admin/backup/restore", json=snap, headers=auth_headers).json()
        assert first["comments_created"] == 2
        second = client.post("/api/admin/backup/restore", json=snap, headers=auth_headers).json()
        assert second["posts_created"] == 0
        assert second["comments_created"] == 0
        assert second["comments_skipped"] == 2
        assert db_session.query(models.Post).count() == 2
        assert db_session.query(models.Comment).count() == 2

    def test_restore_rejects_unknown_format(self, client, auth_headers):
        response = client.post(
            "/api/admin/backup/restore",
            json={"format": "nope", "version": 1, "posts": []},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_restore_rejects_too_many_posts(self, client, auth_headers):
        response = client.post(
            "/api/admin/backup/restore",
            json={"format": "x-blog-backup", "version": 1, "posts": [{"slug": f"p{i}"} for i in range(21_000)]},
            headers=auth_headers,
        )
        assert response.status_code == 422

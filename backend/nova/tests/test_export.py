"""Tests for export endpoints.

Covers admin-authorized CSV export plus a security regression test verifying that
the comment/PII export endpoints CANNOT be accessed unauthenticated (they expose
commenter email + ip_address, so they must require admin auth).
"""


class TestExportPostsCsv:
    def test_export_posts_csv(self, client, auth_headers):
        response = client.get("/api/export/posts.csv", headers=auth_headers)
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]
        assert "attachment" in response.headers["content-disposition"]
        assert "posts.csv" in response.headers["content-disposition"]

    def test_export_posts_csv_has_headers(self, client, auth_headers):
        response = client.get("/api/export/posts.csv", headers=auth_headers)
        assert response.status_code == 200
        lines = response.text.strip().split("\n")
        assert len(lines) >= 1  # At least header row
        headers = lines[0].split(",")
        assert len(headers) > 0

    def test_export_posts_csv_requires_auth(self, client):
        """Export endpoints expose post data and must require admin auth."""
        response = client.get("/api/export/posts.csv")
        assert response.status_code == 401

    def test_export_posts_csv_uses_admin_style_filters(self, client, auth_headers, db_session):
        """status/date filters shape the exported row set (RIL TASK-079)."""
        from app import models

        published = models.Post(
            title="Published Export",
            slug="published-export",
            content="C",
            published=True,
            pinned=True,
        )
        draft = models.Post(title="Draft Export", slug="draft-export", content="C", published=False)
        db_session.add_all([published, draft])
        db_session.commit()

        all_rows = client.get("/api/export/posts.csv", headers=auth_headers).text.strip().split("\n")
        assert any("published-export" in r for r in all_rows)
        # status=None ("all") includes the draft too
        assert any("draft-export" in r for r in all_rows)

        draft_rows = client.get("/api/export/posts.csv?status=draft", headers=auth_headers).text.strip().split("\n")
        assert any("draft-export" in r for r in draft_rows)
        assert not any("published-export" in r for r in draft_rows)

        published_rows = (
            client.get("/api/export/posts.csv?status=published", headers=auth_headers).text.strip().split("\n")
        )
        assert any("published-export" in r for r in published_rows)
        assert not any("draft-export" in r for r in published_rows)

    def test_export_posts_csv_includes_status_columns(self, client, auth_headers):
        """Posts CSV carries Status/Pinned/Publish At columns (RIL TASK-079)."""
        response = client.get("/api/export/posts.csv", headers=auth_headers)
        headers = response.text.strip().split("\n")[0].split(",")
        assert "Status" in headers and "Pinned" in headers and "Publish At" in headers


class TestExportCommentsCsv:
    def test_export_comments_csv(self, client, auth_headers):
        response = client.get("/api/export/comments.csv", headers=auth_headers)
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]
        assert "attachment" in response.headers["content-disposition"]
        assert "comments.csv" in response.headers["content-disposition"]

    def test_export_comments_csv_has_headers(self, client, auth_headers):
        response = client.get("/api/export/comments.csv", headers=auth_headers)
        assert response.status_code == 200
        lines = response.text.strip().split("\n")
        assert len(lines) >= 1  # At least header row

    def test_export_comments_csv_requires_auth(self, client):
        """Comments CSV exposes PII (email + ip_address) and must NOT be public."""
        response = client.get("/api/export/comments.csv")
        assert response.status_code == 401

    def test_export_comments_csv_neutralizes_formula_injection(self, client, auth_headers):
        """Attacker-controlled comment fields must not become spreadsheet formulas."""
        create_post = client.post(
            "/api/posts",
            json={
                "title": "CSV Test Post",
                "slug": "csv-test-post",
                "content": "Test content",
                "published": True,
            },
            headers=auth_headers,
        )
        post_id = create_post.json()["id"]
        client.post(
            f"/api/comments/post/{post_id}",
            json={
                "nickname": "=cmd|' /C calc'!A0",
                # A formula-triggering address that still validates (ISS-145
                # rejects garbage shapes, so use a valid-but-hostile one).
                "email": "=cmd@evil.example",
                "content": '=HYPERLINK("https://evil.example","click")',
            },
        )
        response = client.get("/api/export/comments.csv", headers=auth_headers)
        assert response.status_code == 200
        body = response.text
        # Neutralized cells start with a single quote so Excel renders them as text
        assert "'=cmd|' /C calc'!A0" in body
        assert "'=cmd@evil.example" in body
        assert "'=HYPERLINK(" in body

    def test_export_comments_csv_filters_by_status_and_has_status_column(self, client, auth_headers, db_session):
        """comments.csv supports is_approved filter + a Status column (RIL TASK-079)."""
        from datetime import UTC, datetime

        from app import models

        post = models.Post(title="Export Comments", slug="export-comments", content="C", published=True)
        db_session.add(post)
        db_session.commit()
        approved = models.Comment(
            post_id=post.id,
            nickname="ApprovedCommenter",
            content="approved",
            is_approved=True,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        pending = models.Comment(
            post_id=post.id,
            nickname="PendingCommenter",
            content="pending",
            is_approved=False,
            created_at=datetime(2026, 2, 1, tzinfo=UTC),
        )
        db_session.add_all([approved, pending])
        db_session.commit()

        all_rows = client.get("/api/export/comments.csv", headers=auth_headers).text.strip().split("\n")
        assert all_rows[0].split(",")[-2] == "Status" or "Status" in all_rows[0]
        assert any("ApprovedCommenter" in r for r in all_rows)
        assert any("PendingCommenter" in r for r in all_rows)

        pending_rows = (
            client.get("/api/export/comments.csv?is_approved=false", headers=auth_headers).text.strip().split("\n")
        )
        assert any("PendingCommenter" in r for r in pending_rows)
        assert not any("ApprovedCommenter" in r for r in pending_rows)

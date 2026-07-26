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

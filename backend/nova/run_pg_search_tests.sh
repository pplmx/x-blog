#!/usr/bin/env bash
# Postgres-gated CJK search integration (DEC-070, TASK-143).
#
# The local SQLite suite cannot execute to_tsvector, so the original bug (CJK
# queries failing partial/prefix match on Postgres full-text search) only
# reproduces against a real PostgreSQL. This runner targets the operator's dev
# host (10.112.9.49:13310) — fill in the DB/user/password and run:
#
#   TEST_DATABASE_URL=postgresql://USER:PASS@10.112.9.49:13310/xblog \
#     ./run_pg_search_tests.sh
#
# The test creates (and leaves) one scratch post ("中文帖子" / zh-pg-post) and
# asserts a partial CJK term matches — RED on the old tsvector code, GREEN with
# the ILIKE fallback.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${TEST_DATABASE_URL:-}" != postgresql://* ]]; then
  echo "Set TEST_DATABASE_URL to a PostgreSQL URL (e.g. postgresql://USER:PASS@10.112.9.49:13310/xblog)" >&2
  exit 2
fi

.venv/bin/python -m pytest tests/test_search_cjk.py -k "Postgres" -o addopts='' -q

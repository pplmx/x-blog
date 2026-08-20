#!/usr/bin/env bash
cd /workspace/x-blog/backend/nova
.venv/bin/python -m pytest \
  tests/test_comments.py tests/test_reader_comments.py tests/test_reader_auth.py \
  tests/test_reader_bookmarks.py tests/test_reader_reply_notifications.py tests/test_push.py \
  -o addopts='' -q 2>&1 | tail -8

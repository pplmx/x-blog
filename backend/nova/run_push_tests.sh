#!/usr/bin/env bash
cd /workspace/x-blog/backend/nova
.venv/bin/python -m pytest tests/test_push.py -o addopts='' -q 2>&1 | tail -4

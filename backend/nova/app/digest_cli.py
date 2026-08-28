#!/usr/bin/env python
"""Weekly digest CLI — the cron-friendly entrypoint (DEC-201, TASK-222).

The digest job has two triggers: the admin "send now" button
(``POST /api/admin/digests/send-weekly``) and this standalone command for a
cron/systemd timer. No in-process timer exists on purpose (see app/digest.py
module docstring): a periodic job belongs in the deploy layer, not a worker.

Examples::

    # Deliver the digest to today's eligible readers.
    python -m app.digest_cli send-weekly

    # Report who/what would go out without sending or stamping anything.
    python -m app.digest_cli send-weekly --dry-run

Exit code 0 even when SMTP is not configured or delivery is skipped — the job
is best-effort and the cron log is the audit trail.
"""

import argparse
import json
import sys

from app.database import SessionLocal
from app.digest import send_weekly_digest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="digest_cli", description="X-Blog weekly email digest")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and report without sending any mail or stamping digest_sent_at.",
    )
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        summary = send_weekly_digest(db, dry_run=args.dry_run)
    finally:
        db.close()
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

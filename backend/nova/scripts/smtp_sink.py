#!/usr/bin/env python3
"""Tiny SMTP sink for local/e2e development (DEC-286, TASK-371).

The `just e2e` harness and local dev have no real mail server; a password-reset
journey (and any future email flow) needs somewhere to *send*. This is a
minimal, dependency-free SMTP server (Python 3.12+ removed the stdlib smtpd,
so we speak a slice of the protocol ourselves) that accepts any mail and
appends every message to a JSONL file. The e2e suite reads that file to
extract the single-use reset token and drive the browser through the flow.

Only implements what our emailer sends: EHLO/HELO, MAIL FROM, RCPT TO, DATA,
QUIT (+ NOOP/RSET). Everything is accepted and dropped except the message
body, which is persisted. Never for production; dev-only (log file path is
fully under our control via CLI arg).
"""

from __future__ import annotations

import argparse
import json
import logging
import socketserver
import sys
from email import policy
from email.parser import BytesParser
from pathlib import Path

logger = logging.getLogger("smtp_sink")


class SMTPSessionHandler(socketserver.StreamRequestHandler):
    """Handle one SMTP client connection: read a message, dump it, die."""

    mail_from: str | None = None
    rcpt_to: list[str]
    data_lines: list[bytes]

    def setup(self) -> None:
        super().setup()
        self.rcpt_to = []
        self.data_lines = []

    def _send(self, text: str) -> None:
        self.wfile.write(f"{text}\r\n".encode())

    def handle(self) -> None:
        self._send("220 localhost E2E SMTP sink ready")
        in_data = False
        try:
            for raw in self.rfile:
                line = raw.rstrip(b"\r\n")
                if in_data:
                    if line == b".":
                        in_data = False
                        self._store_message()
                        self._send("250 OK queued (discarded)")
                        self.data_lines = []
                    else:
                        # SMTP dot-stuffing: a line starting with '.' is sent
                        # with an extra '.' that must be stripped.
                        if line.startswith(b".."):
                            line = line[1:]
                        self.data_lines.append(line)
                    continue
                upper = line.decode("utf-8", "replace").upper()
                if upper.startswith("EHLO") or upper.startswith("HELO"):
                    self._send("250-localhost")
                    self._send("250 8BITMIME")
                elif upper.startswith("MAIL FROM"):
                    self.mail_from = line.decode("utf-8", "replace")
                    self._send("250 OK")
                elif upper.startswith("RCPT TO"):
                    self.rcpt_to.append(line.decode("utf-8", "replace"))
                    self._send("250 OK")
                elif upper.startswith("DATA"):
                    self._send("354 End data with <CR><LF>.<CR><LF>")
                    in_data = True
                elif upper.startswith("QUIT"):
                    self._send("221 Bye")
                    return
                elif upper.startswith("NOOP") or upper.startswith("RSET"):
                    self._send("250 OK")
                else:
                    self._send("250 OK")
        except ConnectionResetError, BrokenPipeError:
            logger.debug("client disconnected mid-session")

    def _store_message(self) -> None:
        server: SMTPDumpServer = self.server  # type: ignore[assignment]
        # Normalize to a bare address: RCPT TO arrives as "<a@b.com>".
        to = self.rcpt_to[-1].partition(":")[2].strip(" <>") if self.rcpt_to else ""
        msg = BytesParser(policy=policy.default).parsebytes(b"\r\n".join(self.data_lines))
        # The raw bytes are base64 (UTF-8) for the body; the e2e suite grep's
        # the reset deep link out of *decoded* plain text, so store both.
        text_part = msg.get_body(preferencelist=("plain",))
        record = {
            "to": to,
            "subject": str(msg.get("Subject", "")),
            "text": text_part.get_content() if text_part else "",
            "raw": b"\r\n".join(self.data_lines).decode("utf-8", "replace"),
        }
        with Path(server.dump_path).open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        logger.info("captured mail to %s: %s", to, record["subject"])


class SMTPDumpServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

    def __init__(self, addr: tuple[str, int], dump_path: str) -> None:
        self.dump_path = dump_path
        super().__init__(addr, SMTPSessionHandler)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2525)
    parser.add_argument("--dump", default="/tmp/x-blog-smtp-sink.jsonl")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    with SMTPDumpServer((args.host, args.port), args.dump) as server:
        logger.info("SMTP sink listening on %s:%s -> %s", args.host, args.port, args.dump)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            logger.info("shutting down")
    return 0


if __name__ == "__main__":
    sys.exit(main())

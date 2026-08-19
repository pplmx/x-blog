"""Conditional-response helper: strong ETag, If-None-Match 304, Cache-Control.

Public GET endpoints opt out of the global ``no-store`` default
(``middleware/cache.py``, TASK-129) by building their responses through here: a
strong ETag lets revalidating clients (feed readers, crawlers, browsers) get a
cheap 304 instead of a re-downloaded body, and ``Cache-Control`` bounds how long
browsers and shared caches may serve the payload before revalidating —
so a post write is visible within that window via the changed ETag.

The feeds/sitemap used an inline version of this (``rss._feed_response``,
TASK-089); this is now the single implementation for both feeds and the public
JSON list endpoints. Write-on-read and private endpoints keep the ``no-store``
default on purpose.
"""

import json
from hashlib import sha1

from fastapi import Request
from fastapi.responses import Response

# Cache-Control for cacheable public payloads. ``max-age=60`` bounds how long a
# response may be served without revalidation after a write (~60s staleness
# window for a blog); beyond that a conditional GET revalidates with
# If-None-Match and, if unchanged, returns a 304 instead of the body.
PUBLIC_CACHE_CONTROL = "public, max-age=60"


def conditional_response(
    body: str,
    media_type: str,
    request: Request,
    cache_control: str = PUBLIC_CACHE_CONTROL,
) -> Response:
    """Build a 200 with a strong ETag + Cache-Control, or a 304 on a revalidate.

    The ETag is a stable hash of the serialized body: it only changes when the
    underlying data changes, so ``If-None-Match`` revalidation gets a 304 while
    the content is unchanged. A 304 carries the same Cache-Control so the stored
    copy's freshness window is refreshed instead of becoming unusable.
    """
    etag = f'"{sha1(body.encode("utf-8")).hexdigest()}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and etag in {tag.strip() for tag in if_none_match.split(",")}:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": cache_control},
        )
    return Response(
        content=body,
        media_type=media_type,
        headers={"ETag": etag, "Cache-Control": cache_control},
    )


def conditional_json(
    serialized: object,
    request: Request,
    cache_control: str = PUBLIC_CACHE_CONTROL,
) -> Response:
    """Serialize an already-validated payload to JSON and wrap it conditionally.

    Uses compact separators so the hash input is deterministic; the same
    function is used for both the 200 body and the 304 ETag computation.
    """
    body = json.dumps(serialized, ensure_ascii=False, separators=(",", ":"))
    return conditional_response(body, "application/json", request, cache_control)

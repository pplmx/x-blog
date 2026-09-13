# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[English](./CHANGELOG.md) · [中文](./CHANGELOG.zh-CN.md)

## [Unreleased]

- **Sitemap completeness: series + every post, no silent cap (DEC-318)**: the
  sitemap omitted series entirely — `/series/[slug]` pages are indexable but
  were unreachable-by-sitemap — and fetched posts with a hard `limit=1000` and
  no pagination, so a blog past 1000 published posts silently lost every older
  post from the sitemap (and thus from search). `sitemap.xml` now page-walks
  ALL published posts (one page per fetch, bounded memory, no cap) and emits a
  `/series/{slug}` entry for every series; creating a series now busts the
  rendered sitemap cache immediately instead of waiting out the TTL. Backend
  contract tests (pagination loop exercised with a paged stub; series entries)
  and an e2e fetching the sitemap through the Nuxt origin after creating a
  series. No DDL.
- **Reader-local reading streak & heatmap (DEC-316)**: the `/history` reading
  streak and 52-week activity heatmap used to bucket every read in UTC while
  rendering in the browser's local time, so for any reader outside UTC the
  streak credited the wrong calendar day and the heatmap tooltips / "today"
  column disagreed with the reader's own calendar (an evening read could be
  booked to the next UTC day, and the tooltip showed one local day earlier). The
  stats fetch now declares the browser's IANA timezone and the backend buckets
  reads (and anchors the streak + heatmap window) to the reader's local calendar
  day; the heatmap labels then read those already-local dates as-is instead of
  re-shifting them by the browser offset. Backend contract tests (bucket shift
  across the date line, 422 on an unknown timezone, local-today anchoring),
  frontend tests, and a timezone-pinned Playwright journey that forces the local
  date to differ from UTC (UTC−1) — the today cell's tooltip must show the local
  day and never the UTC-only label; a reverted UTC-only implementation fails it
  deterministically. No DDL; the backend image now pins `tzdata` so IANA zone
  resolution is reliable in production (a missing zone would otherwise reject
  every stats request once the page always declares a timezone).
- **Tag-scoped RSS works through the Nuxt proxy (DEC-314)**: the tags page
  scopes its feed as `/rss/feed.xml?tag_id={id}` (autodiscovery + subscribe
  button), but the Nuxt origin's feed proxy stripped the query string — in the
  default compose/`nuxt preview` stack (no nginx in front) a reader who
  subscribed to one tag silently received the GLOBAL feed with no error. The
  sibling scoped feeds (category/series, path-form) always proxied correctly,
  making the tag feed the one broken scope. `proxyConditionalFeed` now forwards
  the inbound query to the backend (mirroring the API proxy), so a tag-scoped
  subscribe stays scoped; the backend's per-body ETag keeps 304 revalidation
  correct across scopes. Covered by a server unit test (the proxied URL carries
  `tag_id`, and the plain global URL stays query-less) and a Playwright e2e
  that fetches the tag-scoped feed THROUGH the Nuxt origin (where the browser
  actually goes) and verifies only that tag's posts appear.
- **Delete individual notifications (DEC-312)**: the reader notification
  inbox (DEC-160) is durable but had no prune path — mark read / mark-all-read
  only clear the badge, so consumed rows accumulated forever for a reader
  following several series/categories. A signed-in reader can now delete any
  single notification from `/notifications` (a per-row trash button beside
  mark-read), and the row leaves the list with an unread-count drop if it was
  still unread. New `DELETE /api/reader/me/notifications/{id}` (reader_id-
  scoped like every reader table: an unknown or another reader's id is a 404,
  never a cross-reader delete). Backend contract tests (delete, isolation,
  404, oversized-id 422), frontend page tests (row removed, failure keeps the
  row, badge stays truthful), and a Playwright e2e journey (seed two rows,
  API-delete one, UI-delete the survivor to empty state).
- **Moderated-comment surfacing fix (DEC-310)**: on a moderated deployment
  (auto-approve off — the default) the create endpoint returns the pending
  comment but the list only serves approved rows, so after submitting, the
  thread surfacing code used to jump pages and walk the whole thread hunting a
  comment that structurally could not render — silent scroll flailing that read
  as a failed post and invited double-submitting. The comment list now sees
  `is_approved === false` from the create response and skips the jump/page-walk
  entirely, keeping the truthful "awaiting review" confirmation; an approved
  comment (auto-approve reader tier) still surfaces and scrolls as before.
  Frontend-only; the pending comment's moderation result appears when the
  reader revisits the post. Covered by unit tests (pending skips fetch/scroll,
  approved still surfaces) and an e2e asserting no post-submit paging requests.
- **Comment-image lightbox (DEC-308)**: clicking an image inside a comment
  opens the same fullscreen viewer that post images use (DEC-302) — full
  resolution, Escape/backdrop/close to dismiss, arrow keys browse THAT
  comment's images (its body plus nested replies), focus returns to the
  trigger. The comment body previously rendered markdown images as plain,
  column-width, un-scrutinizable `<img>` (same marked+sanitizer pipeline as
  posts, but no viewer); a commenter pasting a screenshot/diagram had no way
  to zoom. Click delegation on the comment list collects only loadable
  http(s)/relative srcs through the same `sanitizeUrl` safety filter, so a
  `javascript:`/`data:` src can never open the viewer. New unit coverage
  (click opens, dangerous src excluded) and Playwright e2e journeys in
  `comment-lightbox.spec.ts`.
- **Comment live preview (DEC-306)**: the comment form advertises
  sanitized-Markdown rendering (DEC-088) and every comment waits in the
  moderation queue (DEC-066), but a commenter had no way to see their draft
  render before submitting — a malformed markup draft would burn an approval
  cycle with zero feedback. The form now has a Write/Preview toggle: the
  Preview tab renders the draft through the exact `commentMarkdownToHtml`
  pipeline the comment list ships (same sanitizer, same lazy highlight.js for
  fenced code), so "what you see here" IS "what gets posted". A successful
  submit returns to a clean Write tab; empty drafts show a hint instead of a
  blank box. Net-additive frontend slice (no backend/DDL), with unit tests
  (rendering, XSS-inert preview, draft preserved on toggle, submit-reset) and
  Playwright e2e (markdown render + script/event-handler payloads never reach
  the DOM) and zh/en i18n.
- **Markdown image lightbox (DEC-302)**: clicking any image inside a post
  opens it at full resolution in a dark fullscreen viewer — Escape, a backdrop
  click or the close button dismisses it, arrow keys (or on-screen arrows)
  browse the post's images with wrap-around and an "n / total" counter, and
  keyboard focus returns to the image that opened the viewer. Markdown image
  syntax (`![alt](src)`, the way posts are authored) is now extracted into the
  same lazy-loaded segment pipeline as HTML `<img>` tags (it previously sailed
  past the segmenter into a plain inline `<img>`, missing lazy-loading and
  ever reaching a viewer); a `javascript:`/`data:` image src is sanitised out
  of the viewer set so it can never open. The `cursor-zoom-in` affordance,
  removed years ago for promising a viewer that didn't exist, is truthful
  again. New `MarkdownLightbox.vue` (Teleport overlay with focus management
  and body-scroll lock) wired into `MarkdownContent.vue`, plus component,
  composable and Playwright e2e coverage and zh/en i18n.
- **Reader avatars (DEC-299)**: a reader can now set a profile picture from
  `/account` (upload or remove), completing the reader-identity surface that
  reader profiles (DEC-294) opened. The avatar renders on the public
  `/readers/{id}` profile page and beside the verified reader's name on every
  comment they leave; readers without a picture keep the initial-letter
  placeholder. New `POST /api/reader/me/avatar` (multipart, reusing the media
  uploader's defense-in-depth image validation — content-type whitelist, size
  cap, magic bytes, full Pillow decode, never-larger re-encode) and
  `DELETE /api/reader/me/avatar`, an additive `reader_accounts.avatar_url`
  column (DDL-preserving, DEC-009), and avatar_url threaded through the reader
  profile, public profile and comment-reader schemas. Backend contract tests,
  frontend page/component tests, Playwright e2e and zh/en i18n.
- **Reader privacy fix (TASK-377)**: a signed-in reader who never set a display
  name was shown on the public comment list under their stored email (the
  comment nickname falls back to the account email). Those comments now render
  a generic "Reader" identity instead — the email never appears as a public
  name on the post's comment list (existing rows included), while the
  verified-reader badge stays.
- **Public reader profiles (DEC-294)**: a commenter's verified display name is
  now a clickable identity — on a post, an approved signed-in reader's name
  links to `/readers/{id}`, a public (no sign-in) profile page with their
  display name, join date and approved comments on publicly-visible posts,
  paginated. Anonymous commenters stay under their typed nickname; an unknown
  reader id renders a "reader not found" state instead of an empty page. The
  comment-list link keys off the reader identity (not the nickname, which the
  backend stamps with the display name) so it renders for every verified
  commenter. New `GET /api/readers/{id}` route (profile + comment list, no
  email/last-login PII) + backend tests, page + component tests, Playwright
  e2e and zh/en i18n.
- **Dedicated follows-feed page (DEC-292)**: a new `/follows` page for signed-in
  readers showing every new post from their followed categories, series and
  tags, paged beyond the 12-post home cap. The follows-feed endpoint
  (`GET /api/reader/me/follows-feed`) is now a paginated `{items, pagination}`
  envelope, the home "Latest from your follows" row gains a "View all" link
  into it, and a stale/expired session drops the reader back to sign-in like
  the notifications inbox. Backend contract tests (incl. page/total/total_pages
  and out-of-range clamps) + frontend page tests + Playwright e2e + zh/en i18n.
- **In-place series-follow (DEC-290)**: the post page's in-series nav box gains
  a follow control for signed-in readers — follow/unfollow the current series
  and toggle new-part notifications right where they were reading part N,
  instead of having to leave the post for the `/series/[slug]` page. Mirrors
  the in-place tag-follow on the post footer (DEC-196); the follow persists to
  the account page's Followed-series section.
- **Reading density (DEC-288)**: post pages gain an A−/A+ body-text scale
  (three sizes) remembered per device across page loads — long-form reading
  comfort with no account required.
- **Per-post reading trend (DEC-287)**: the admin post editor shows a 30-day
  view sparkline for the open post (`GET /api/admin/stats/views/posts/{id}`) so
  the author sees whether a post is gaining or decaying readership at a glance.
- **Reader password recovery (DEC-286)**: a reader who forgot their password can
  request a single-use email reset link at `/forgot-password` and redeem it at
  `/reset-password` (new password → all sessions revoked → auto-login). The
  request endpoint is deliberately not an account-existence oracle, and the
  reset token carries its own JWT audience so it can never be replayed as a
  reader or admin credential. Backend endpoints
  `POST /api/reader/password-reset/{request,confirm}` + tests; frontend
  `/forgot-password` and `/reset-password` pages + zh/en i18n + tests.
- Deploy fix: pin the frontend Docker build to `node:24.20.0-alpine3.24` — the
  previously pinned `node:24.8.1-alpine3.20` was pruned from Docker Hub, so
  `Build and push frontend` failed in the Deploy workflow.

## [0.1.0] - 2026-09-09

First tagged release of X-Blog — a modern full-stack blog built on FastAPI +
Nuxt. This release captures the complete feature set that has landed on `main`
since the project began in April 2026 (1381 commits; 1243 backend + 1317 frontend
tests, 93.5% backend coverage).

### Added

#### Reader experience

- **Markdown publishing** with Mermaid diagrams, KaTeX math, and code
  highlighting (backend `markdown` pipeline + Nuxt renderer).
- **Full-text post search** with a search page, query highlighting, and
  snippet escaping.
- **RSS & Atom feeds** — site-wide and per-category/tag scoped feeds with
  autodiscovery (DEC-074).
- **Tags & categories** — post organization, browse pages, sidebar chips, and
  filtered home feeds.
- **Series** — ordered multi-part sequences with in-series prev/next
  navigation (DEC-189).
- **Nested comments** with reply support, threaded rendering, and moderation
  status (DEC-066).
- **Reader accounts** — register/login with a reader JWT, plus an account page
  (email, display name, password change).
- **Cloud bookmark sync** — local bookmarks merge to the cloud on sign-in and
  stay synced across devices.
- **Resume reading** — the post page remembers a signed-in reader's scroll
  position server-side and drops them back on return (DEC-167).
- **Reading streaks & activity heatmap** — `/history` shows current/longest
  consecutive-day streaks and a 52-week heatmap (DEC-169).
- **Reader notification inbox** — durable in-app read/unread list of new posts
  in followed series/categories, replies, and followed-thread comments
  (DEC-160).
- **Per-kind notification preferences** — silence any notification type from
  `/notifications` (DEC-171).
- **Tag follow** — follow a topic tag for new-post push + inbox rows
  (DEC-195).
- **Email notifications + weekly digest** — per-event emails and an optional
  weekly summary (DEC-197, DEC-201).
- **New-post Web Push** — category/all-new-posts browser push subscription
  (DEC-076).
- **Comment-thread subscription** — push when a comment is approved on a
  followed discussion (DEC-078).

#### Admin

- **Admin dashboard** with live/scheduled/draft post buckets, pending-comment
  queue, top-posts-by-views chart, and site-wide stats.
- **Post editor** with cover image, category/tag assignment, Markdown preview
  via MarkdownContent, schedule/draft/publish states, unsaved-changes guard,
  and autosave with 401 handling.
- **Media library** — browse every uploaded image (grid, preview, copy URL,
  in-use badge), delete unreferenced uploads, insert into the editor (DEC-183).
- **Editorial calendar** — publishing plan on a month grid with click-through
  to the editor (DEC-162).
- **Comments moderation** — pending/approved/rejected management with push
  alerts on new comments (DEC-080).
- **Backup & restore** — one portable JSON snapshot (categories, tags, series,
  posts, comments), restorable into an empty instance (DEC-082).
- **Data export** — posts/comments as CSV.
- **Series management** and **post_count** on categories/tags lists.
- **Reader management** and **reading analytics** with per-day readership
  trend + hot posts (DEC-086).

#### Platform

- **REST API** with typed Pydantic schemas, OpenAPI docs, and a consistent
  envelope (data + error + pagination metadata).
- **PostgreSQL support** as the production dialect (tsvector full-text search,
  advisory locks, naive-UTC storage) with a SQLite default for local dev.
- **Alembic migrations** auto-applied at startup (`alembic upgrade head`) with
  a drift-check gate in CI.
- **Rate limiting** on all endpoints (read/write/auth/register/search/comment/
  export) with per-endpoint overridable limits and trusted-proxy client IP
  recovery.
- **Full-text search, pinned posts, SEO** — Open Graph, JSON-LD, sitemap.
- **Docker Compose deployment** (PostgreSQL + backend + frontend behind a
  Nuxt proxy with nginx), GHCR image build + SSH deploy via GitHub Actions.
- **Dark mode** (system-preference aware), **TypeScript + Pydantic type
  safety**, and **i18n** (zh/en with locale-aware dates).

### Fixed

- Import history is idempotent under unique-key race conditions (retry once
  instead of 500, ISS-419).
- Reading-history clear can no longer be resurrected by a stale in-flight
  response (ISS-425).
- TOC anchors and heading deep links land on the correct section; modified
  clicks open in new tabs (ISS-422).
- Push subscribe is single-flight so a double-fired flow cannot paint a false
  "denied" app-wide (ISS-423, ISS-442).
- Search snippets/excerpts keep the XSS-safety contract on every fallback path
  (ISS-424).
- Reader write endpoints are rate-limited; dead-session follow controls drop
  the token and offer sign-in (ISS-429, ISS-434).
- Admin dashboard pending-comments card and header show the real global queue,
  not a page-local slice (ISS-431, ISS-439).
- Series episode reorder is single-flight (ISS-430).
- Stale unread-badge polls are dropped after a newer refresh (ISS-442).
- Media delete-path reference lookup is bounded with a targeted probe
  (ISS-432), and the media picker pager is disabled + single-flight during a
  page refetch (ISS-440).
- Thread-comment notification fan-out is batched — one flush+prune+commit, not
  O(followers) transactions (ISS-427).
- Bookmark folder re-assign failures surface instead of silently losing the
  folder (ISS-428).
- A stale in-flight unread-badge poll no longer overwrites a newer refresh.
- CI gates tightened: branch coverage gate is now actually enforced
  (previously latent), and the full backend suite runs against PostgreSQL.

### Security

- All authenticated reader mutations are rate-limited (ISS-429).
- Admin create/update write endpoints rate-limited (ISS-017).
- API proxy request body size bounded server-side and at the nginx edge.
- Numeric `post_id` bound to 64-bit range.
- FastAPI `/docs`, `/redoc`, `/openapi.json` not exposed at the public edge.
- Web Push / VAPID endpoints fail closed (503) when unconfigured; throwaway
  keys in CI so e2e never ships real credentials.
- Sendgrid/SMTP and Web Push credentials live strictly in environment
  variables.

### Performance

- Media reference map cached with post-write invalidation (ISS-432).
- Thread-comment fan-out batched to a single transaction (ISS-427).
- Feed cache keyed by full/excerpt flag to avoid body collisions.
- Static Nuxt SSR caching behind nginx (`proxy_cache`).
- Optimized queries for pending-count, feed, and dashboard stats.

[0.1.0]: https://github.com/pplmx/x-blog/releases/tag/v0.1.0

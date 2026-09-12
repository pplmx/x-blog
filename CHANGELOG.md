# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[English](./CHANGELOG.md) · [中文](./CHANGELOG.zh-CN.md)

## [Unreleased]

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

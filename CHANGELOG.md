# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

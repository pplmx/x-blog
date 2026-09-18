# X-Blog

<div align="center">

![Nuxt](https://img.shields.io/badge/Nuxt-4-0F172A?style=for-the-badge&logo=nuxt)
![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009989?style=for-the-badge&logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python)

A modern full-stack blog application built with FastAPI + Nuxt

[English](./README.md) · [中文](./README.zh-CN.md)

</div>

## ✨ Features

- 🚀 **Modern Tech Stack** - Nuxt 4, FastAPI, Vue 3, TypeScript, Python 3.14
- 📝 **Markdown Support** - Write posts with Mermaid diagrams, KaTeX math, code highlighting
- 💬 **Comment live preview** - the comment form renders your draft on a Write/Preview toggle through the same sanitized-Markdown pipeline the list ships, so what you see is what gets posted (DEC-306)
- 🖼️ **Comment-image lightbox** - click an image inside a comment to open the same fullscreen viewer as post images, with arrows browsing that comment's own image set (DEC-308)
- 🖼️ **Image Lightbox** - click any post image (markdown or HTML) for a fullscreen full-resolution viewer with arrow navigation, ESC/backdrop/button close and focus return (DEC-302)
- 🎨 **Beautiful UI** - Clean design with Tailwind CSS v4
- 📱 **Responsive** - Mobile-friendly responsive layout
- 🔒 **Admin Panel** - Built-in admin dashboard for content management
- 🧪 **Well Tested** - 2500+ tests (1243 backend + 1317 Nuxt), 93.5% backend coverage
- ✅ **Type Safe** - Full TypeScript support + Pydantic validation
- 🔍 **Full-text Search** - Post search, plus comment search (the Comments mode on `/search`, round 366)
- 💬 **Latest Discussion** - the public `/discussion` page streams the newest approved comments across the whole site — each card carries the commenter, the content, and the post brief, and clicks straight through to that comment on its post (round 367)
- 📡 **Discussion RSS/Atom** - the conversation is findable (round 366) and browsable (round 367) — now it's subscribable too: `/rss/comments.xml` (RSS 2.0) and `/rss/comments.atom.xml` (Atom) stream the newest approved comments site-wide, one item per comment carrying the commenter + post title and deep-linking onto that comment, with a subscribe link + auto-discovery tags on `/discussion` (round 368)
- 🔍 **My-comments keyword search** - a reader with a long comment history can find a single comment by what it says: the `/comments` page now has a debounced recall-search box, and `GET /api/reader/me/comments` takes an optional `q` matching comment content (escape-aware, composes with the status filter) — searched server-side, so the whole history is covered, not just the loaded page (round 369)
- 🌙 **Dark Mode** - System preference aware dark mode
- 📊 **Reading Analytics** - View counts, like counts, reading progress, and a per-day readership trend with hot posts for the operator (DEC-086)
- 💬 **Comments** - Nested comment support with replies
- 🏷️ **Tags & Categories** - Organize posts with tags and categories
- 🔔 **Tag follow** - a signed-in reader follows a topic tag from the tag page and gets a new-post push + durable inbox row whenever the author publishes a post carrying it, with per-follow notify control and an account-page Followed-tags list (DEC-195)
- 📚 **Series** - Group posts into ordered multi-part sequences with in-series prev/next navigation, and follow the current series in place from the post page for a new-part notification (DEC-290)
- ✍️ **Author follow** - at a multi-editor blog a reader who loved one writer's posts subscribes to just that person: a follow button sits on every post byline AND the writer's public `/authors/{id}` archive header, every post page carries a "More from {author}" strip so the writer's other work is discoverable in place, and every new post lands in the follower's inbox as a durable row plus a Web Push (rounds 353/355/356)
- 📝 **Writer bio** - the person-shaped author surface finally speaks for itself: a superuser sets a short public "about this writer" text (next to the pen name in admin/users, same 500-char plain-text cap as the reader bio) and it renders under the writer's name on their `/authors/{id}` archive header — plus a one-line window on the `/authors` index card — so a reader deciding about a writer learns who they actually are, not just what they published (round 357)
- 🖼️ **Writer avatar** - the person-shaped author surface now has a face too: a superuser
  uploads a small profile picture next to the pen name in admin/users (same validated,
  re-encoded pipeline + `static/avatars` storage as the reader avatar, round 358) and it
  renders on every public rendering of the writer — the post byline chip, the post-page
  byline, the More-from-author strip, the `/authors` index card, and the archive header —
  so a reader recognizes a writer at a glance instead of a generic user icon (round 358)
- 📰 **Follows feed** - a signed-in reader gets a full paginated `/follows` page of every new post from their followed categories, series, tags and writers (beyond the home row's 12-post cap), with a "View all" entry from the home page — authored cards carry their byline (DEC-292, authors round 354)
- 🔖 **Cloud Bookmark Sync** - Reader accounts keep your bookmarks synced across devices (sign in → local bookmarks merge to the cloud)
- 📚 **Bookmark To-read/Done queue** - a saved post is either in the To-read queue or marked Done (round 361): the `/bookmarks` page has All/To-read/Done filter chips with live counts plus a per-row toggle, so "saved to read later" no longer conflates with "already read, keeping it" — the state is cloud-synced like the bookmark itself
- ❤️ **Cloud-synced likes + liked-posts list** - a signed-in reader's like is now a durable, cross-device cloud row (round 359): the post-page heart is a real toggle (a second click un-likes it and decrements the count), a like made while signed out is promoted to a cloud row on sign-in, and the new auth-gated `/liked` page — the "posts I appreciated" surface joining bookmarks (saved to read) and history (read) — merges the server's liked set down on mount, so a like made on one device shows up on the next
  `/liked` also gained a debounced recall-search box (round 370, `GET /api/reader/me/likes?q=` matches title/excerpt) so a reader who liked a lot finds the specific one they recall, and a per-card unlike control (round 371) so a like can be taken back right from the page — no visit to the post needed
- 👥 **Public "Liked posts" profiles** - the first reader-to-reader discovery surface (round 360): a reader can opt in on `/account` to publish a "Liked posts" tab on their public `/readers/{id}` profile, listing their liked posts for anyone to browse — no sign-in needed. Off by default, so a reader's likes stay private taste unless they explicitly choose to share them, and a reader who never opts in has no tab and no public endpoint at all (nothing to leak)
- 🏷️ **Public "Saved posts" profiles** - the second opt-in discovery surface (round 363): next to the "Liked posts" tab, a reader can publish a "Saved posts" tab listing the posts they chose to keep — anyone can browse it, no sign-in needed. Off by default as a separate flag from public_likes, so a reader's list stays private until shared; a never-opted reader has no tab and the endpoint 404s like an unknown reader (nothing to leak)
- 👥 **Reader-to-reader follow** - the last un-followable identity closes the loop (round 365): from a reader's public `/readers/{id}` profile a signed-in reader can follow the commenter behind the byline — the person-shaped cousin of author follow — and a deep-linked inbox row lands when an approved comment goes live, with a per-kind opt-out on `/notifications`. Every visitor sees the follower count; guests have no control, own profiles hide the button, `/account` lists followed readers for one-click unfollow
- 🔐 **Reader two-factor authentication (TOTP)** - a reader can enable 2FA from `/account` (scan a QR / back up the base32 secret, then confirm with password + one code), and from then on every login asks for a 6-digit code from their authenticator app after the password — turning it off needs the password AND a code too (round 364): reader accounts guard durable private data (cloud-synced bookmarks/likes/history, GDPR export), so a leaked password alone is no longer enough to take the whole account over
- 📈 **Reader-local reading streak & heatmap** - the /history reading streak and 52-week activity heatmap count your days in YOUR calendar, not the server's: the page declares the browser's timezone and the backend buckets reads (and anchors "today") to your local timezone, so an evening read counts as today wherever you live (DEC-316)
  A reading-insights panel (round 372, `GET /api/reader/me/history/insights`) adds the "what/how much" shape beside the heatmap — distinct posts read all-time and in the trailing 30 days, plus the most-read categories
- ✨ **Recommended for you on the post page** - the homepage's affinity-scored "Recommended for you" (DEC-128) now also appears at the end of every article for signed-in readers (round 362): after finishing a post, the high-intent "what should I read next?" moment serves posts scored from the reader's own reading-history/bookmark affinity instead of only topic-similar related posts — guests and cold-start readers (no affinity) see nothing
- 💬 **Reader Comment Management** - a signed-in reader sees their own comments with moderation status (pending / approved / rejected) and can delete them (DEC-066); the "on post" jump deep-links to the exact comment, not the headline (DEC-321)
- 🪪 **Public Reader Profiles** - an approved signed-in reader's comment name links to their public `/readers/{id}` page (display name, join date, approved comments), no sign-in needed; unknown ids show a "reader not found" state (DEC-294)
- 🖼️ **Reader Avatars** - readers set a profile picture from `/account` (upload or remove); it renders on their public profile and beside their verified name on every comment, falling back to an initial-letter placeholder when unset (DEC-299)
- 📝 **Reader profile bio** - readers write a short "about me" in `/account` (plain text, 500-char cap) that renders under their display name on their public `/readers/{id}` page, completing the identity surface next to avatar, streak and approved comments (round 352)
- 🎯 **SEO Optimized** - Open Graph, JSON-LD structured data, and a complete sitemap covering every published post (no cap), every series (DEC-318), every published static page at `/pages/{slug}` and every pen-named writer's archive at `/authors/{id}` — page writes bust the feed cache so a publish reaches the sitemap immediately (round 348)
- ⬆️ **Pinned Posts** - Pin important posts to top
- 📤 **Data Export** - Export posts/comments as CSV; signed-in readers get a complete GDPR-style "download my data" bundle (profile, bookmarks, comments, history, follows, notification prefs, inbox rows, push devices — DEC-126, DEC-334)
- 🗓️ **Editorial Calendar** - admins see the publishing plan at a glance — live / scheduled / draft posts placed on their date in a month grid, click into the editor (DEC-162)
- 🔀 **Slug-change redirects** - re-slugging a post, series or static page never orphans the old URL: every previously-shared link (link-shares, search results, RSS, bookmarks) answers a permanent 301 to the canonical new slug — crawlers keep the link equity, and repeated renames collapse so A→B then B→C resolves A→C in one hop (round 350)
- 🔒 **Per-post comment control** - a high-noise or privacy-sensitive post can have its comments closed from the editor without deleting the conversation or disabling comments site-wide: the public page keeps the existing thread but swaps the form for a "comments are closed" notice, and the API refuses new comments with a clear 403 (round 351)
- 📋 **Duplicate post** - an editor running repeat-shaped content (weekly digests, release notes, episode templates) seeds a sibling draft from the posts list with one click: same content + taxonomy + attribution, a new unique slug, and every publication-metadata field cleared (unpublished, unscheduled, unpinned, zeroed views/likes) — a private template that can never leak or announce itself (round 349)
- 💾 **Backup & Restore** - download the whole blog as one portable JSON snapshot (categories, tags, series, posts, comments) and restore it into an empty instance (DEC-082)
- 📡 **RSS & Atom Feeds** - Subscribe to the site-wide feed or a single category/tag via scoped feeds with autodiscovery (DEC-074); tag-scoped feeds stay scoped through the Nuxt origin (DEC-314)
- 🔔 **New-post Web Push** - Follow a category (or all new posts) and get a browser push when the author publishes (DEC-076)
- ⏰ **Scheduled-post fan-out** - a post saved as published-but-future `publish_at` (editorial calendar) announces itself the moment it goes live: followers of its series/category/tags get exactly one new-post notification (inbox + push + email where opted in), fired on the first public read after publish-time crosses — on every surface that shows the post (list, detail, /follows, search, RSS/Atom, sitemap), exactly-once even across workers (DEC-336, DEC-344)
- 🌐 **Reader-language notifications** - signed-in readers receive their durable inbox titles, notification emails, and weekly digest in their chosen language (en or zh) — the language switcher persists to the account, so an English reader stops getting 系列更新 / 新文章发布 rows and Chinese emails the moment they switch; covers every kind (new posts, replies, followed threads, @-mentions) and the digest; readers who never switch keep the zh copy (DEC-338, DEC-340)
- 💬 **Comment-thread subscription** - Follow a post's discussion; a push lands when a new comment is approved (DEC-078)
- 🔔 **Moderation alerts** - admins get a push the moment a new comment awaits approval, deep-linking to the moderation queue (DEC-080)
- 🔔 **Reader notification inbox** - signed-in readers get a durable in-app list (read/unread) of new posts in followed series/categories, replies to their comments, new comments on followed threads, and @-mentions of their display name — even when the browser push is missed or Web Push is off (DEC-160)
- 🏷️ **@-mention notifications** - a comment that names a reader's display name (e.g. `@Riki`) notifies them once approved, with a deep link to the exact comment; names match at word boundaries and the mention kind is an opt-out preference, on by default (DEC-322)
- ⌨️ **@-mention autocomplete** - typing `@` in the comment box suggests matching readers (public suggest endpoint, prefix-first, bounded); picking one inserts `@<name>` at the caret that really notifies them (DEC-324)
- 🔕 **Per-kind notification preferences** - a signed-in reader silences any notification type (new posts / replies / followed-thread comments / mentions) from the /notifications page; an off kind stops both the inbox row and the push at every dispatch point (DEC-171)
- 🗑️ **Delete inbox notifications** - a signed-in reader deletes any single consumed notification from /notifications, keeping the durable inbox (which otherwise accumulates forever) tidy (DEC-312)
- 📧 **Email notifications + weekly digest** - opted-in readers get per-event emails (new posts / replies / thread comments / @-mentions) and, optionally, one email per week summarizing everything newly published — both straight from the /notifications page (DEC-197, DEC-201, DEC-326)
- 🌏 **Site-language guest & recovery emails** - the guest reply email and the password reset email render in the site's configured language (`SITE_LANGUAGE`) and name (`SITE_TITLE`), so an English-configured site never sends Chinese or misnamed mail (DEC-342)
- 📧 **Guest email newsletter** - a footer form is the "email me new posts" on-ramp: any visitor enters an address, clicks the emailed double opt-in link, and is emailed once per new published post (deep-linked to the post, with a per-subscriber unsubscribe link); subscribe always answers with the same generic message (no existence oracle), scheduled posts surface the same exactly-once email, and mail failure never breaks the publish (DEC-351)
- 📧 **Admin newsletter management** - admins see every newsletter subscriber (email, confirmed/pending chip, subscription date) on a filterable, searchable, paginated admin page, and remove an address entirely (row + token) when it was subscribed by someone else, the mailbox is dead, or the owner lost their token (DEC-354)
- 📧 **Newsletter digest cadence** - a guest subscriber can choose one weekly summary instead of one email per post (the footer form's checkbox, or a toggle on the confirm page): digest subscribers are excluded from the per-post fan-out and get one aggregated, site-language digest per week with their token unsubscribe footer — the same weekly-digest machinery accounts get, now for guests (DEC-355)
- 🚫 **Reader blocks** - the reader-to-reader follow and @-mention fan-out had
  no off switch for an abusive sender: a signed-in reader can block another
  commenter straight from their public profile (one-way and invisible — the
  blocked reader is never told and can keep commenting), which stops that
  commenter's @-mentions, replies, thread-comments and follow-activity from
  reaching them; `/account` lists blocked readers for one-click unblock that
  restores the fan-out (DEC-425, TASK-437)
- 📧 **Guest thread-follow by email** - "Follow a discussion" was reader-gated, so a
  visitor who wants to follow ONE post's comments by email had no on-ramp but
  registering: a compact form in the comment header takes an address and double
  opt-in confirms it (newsletter-style, no oracle, one confirmation email per new
  row), then one email lands per APPROVED comment — deep-linked to the comment and
  carrying a per-subscription one-click unsubscribe that stops all thread mail from
  the inbox. No account ever needed (DEC-427, TASK-438)
- 📧 **Weekly summary for followed discussions** - following a thread by email
  used to mean a mail per approved comment, which gets noisy across several
  threads. On the confirm page a guest picks "weekly summary instead": the
  per-comment fan-out goes silent and the weekly digest job (same CLI / admin
  trigger as the newsletter digest) sends one summary per followed thread with
  that week's approved comments, deep-linked and carrying the same one-click
  unsubscribe — the cadence choice the newsletter already had, now for
  discussions (DEC-429, TASK-439)
- 📧 **Digest operator console on `/admin/newsletter`** - the weekly digest
  (reader + guest) had complete backend machinery but zero admin surface: an
  operator could trigger it by CLI or the superuser endpoint but could not see
  who opted into the weekly cadence or when the last one went out. A new digest
  panel shows reader and guest digest-subscriber counts, the last-send time, and
  how many posts the next window would carry, with a dry-run **preview**
  (send-weekly?dry_run=true, nothing sent) and a confirmed **send now** for
  superusers — the monitoring and preview loop next to the existing trigger
  (DEC-423, TASK-436)
- ✉️ **Change sign-in email** - a reader whose address changed can switch it from `/account` (new address + current password): the backend emails a single-use verification link to the NEW address (60-min expiry, a repeat request replaces a pending change), and opening it swaps the email, bumps the token version (revoking every pre-change session) and auto-signs in under the new address — no more being stranded on a dead inbox, and no endpoint reveals whether an address belongs to an account (DEC-357)
- ✍️ **Author bylines & archive pages** - on a multi-editor blog every post now says who wrote it: an admin sets a public pen name (deliberately distinct from the login username — admin login is no-oracle, so the username never surfaces), that byline renders on the post page and every list card linking to `/authors/{id}`, and the per-author page lists just that writer's published posts, titled by pen name. The post editor's author picker lets any admin
  attribute a post to another pen-named writer (or the default "me") (DEC-359,
  TASK-406); each writer also has a scoped RSS feed — autodiscovery + subscribe
  link on `/authors/{id}` serving `/rss/authors/{id}.xml` (round 345), and
  `/authors` is a writers index now — a card per pen-named writer with their
  published-post count, each linking to their archive (round 346)
- 📑 **Static pages CMS** - a self-hosted blog should answer for itself (privacy policy, terms, contact, changelog), but the only static page was a hardcoded `/about`. Admins can now publish curated markdown pages at `/pages/{slug}` from a dedicated manager (title + auto-slug + markdown body + a published toggle; inline edit, publish/unpublish, delete with confirm); an unpublished or unknown slug answers the same 404
  (no way to enumerate drafts), and published pages are linked from the site footer so they're discoverable without a code deploy (round 347)
- 📧 **Guest reply emails** - an anonymous commenter who ticks "email me when someone replies" gets one email when a reply to their comment is approved (deep-linked to the exact reply, with a working unsubscribe link) — the same off-site channel readers get, now honoring the email guests must leave (DEC-332)
- 📖 **Resume Reading** - signed-in readers pick up right where they left off: the post page remembers their scroll position server-side and drops them back on return, with a resume chip offering back-to-top (DEC-167); the position is also saved as a fraction of the scrollable height so a phone→desktop continuation lands at the same spot (DEC-346); the home page's Continue-reading row is fed from that server trail for signed-in readers, so the posts they left partway surface on any device (DEC-348)
- 🔥 **Reading streaks & activity heatmap** - /history shows a signed-in reader's current/longest consecutive-day streak and a GitHub-style 52-week heatmap of days they read (DEC-169)
- 🖼️ **Media Library** - admins browse every uploaded image (grid, preview, copy URL, in-use badge), delete unreferenced uploads (referenced ones are refused server-side), and insert a previously uploaded image straight from the post editor toolbar (DEC-183)

## 🚀 Quick Start

### Prerequisites

| Tool    | Version | Install                               |
| ------- | ------- | ------------------------------------- |
| Python  | 3.14+   | [uv](https://github.com/astral-sh/uv) |
| Node.js | 24+     | [Node.js](https://nodejs.org/)        |
| pnpm    | 10+     | `npm install -g pnpm`                 |
| just    | 1.0+    | [just](https://github.com/casey/just) |

```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Installation

```bash
# Install all dependencies
just install

# Or manually:
cd backend && uv sync
cd frontend/aura && pnpm install
```

### Development

```bash
# Run both backend and frontend
just dev

# Or run separately:
just backend  # http://localhost:18888
just frontend # http://localhost:34567
```

### 🐳 Docker Deployment

```bash
# Clone and start
git clone https://github.com/pplmx/x-blog.git
cd x-blog

# Configure environment
cp backend/.env.example backend/.env

# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f
```

See [docs/deployment.md](./docs/deployment.md) for detailed deployment guide.

## 🛠️ Commands

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `just install`       | Install all dependencies             |
| `just dev`           | Run dev servers (backend + frontend) |
| `just backend`       | Run FastAPI server                   |
| `just frontend`      | Run Nuxt dev server                  |
| `just lint`          | Lint code (ruff)                     |
| `just format`        | Format code                          |
| `just test`          | Run all tests (backend + Nuxt)       |
| `just test-backend`  | Run backend tests (parallel)         |
| `just test-frontend` | Run Nuxt frontend tests              |
| `just ci`            | Run lint + format + test             |
| `just clean`         | Clean generated files                |

## 📡 API Endpoints

### Posts

| Method | Endpoint                  | Description            |
| ------ | ------------------------- | ---------------------- |
| GET    | `/api/posts`              | List posts (paginated) |
| GET    | `/api/posts/{slug}`       | Get post by slug       |
| GET    | `/api/posts/{id}/related` | Get related posts      |
| POST   | `/api/posts`              | Create post            |
| PUT    | `/api/posts/{id}`         | Update post            |
| DELETE | `/api/posts/{id}`         | Delete post            |
| POST   | `/api/posts/{id}/like`    | Like a post            |
| POST   | `/api/posts/{id}/view`    | Increment view count   |

### Series

| Method | Endpoint            | Description                              |
| ------ | ------------------- | ---------------------------------------- |
| GET    | `/api/series`       | List public series (with post counts)    |
| GET    | `/api/series/{slug}`| Series detail with ordered visible posts |
| POST   | `/api/series`       | Create series (admin)                    |
| PUT    | `/api/series/{id}`  | Update series (admin)                    |
| DELETE | `/api/series/{id}`  | Delete series, unlinks posts (admin)     |

A series groups posts into an author-ordered sequence (`Post.series_id` + `Post.series_order`); the public series detail renders them in that order and series posts show a chip plus prev/next-in-series navigation.

### Comments (Moderated)

| Method | Endpoint                     | Description                                         |
| ------ | ---------------------------- | --------------------------------------------------- |
| GET    | `/api/comments/post/{id}`    | Get approved comments                               |
| POST   | `/api/comments/post/{id}`    | Create comment                                      |
| DELETE | `/api/comments/{id}`         | Delete comment (admin)                              |
| PATCH  | `/api/comments/{id}/approve` | Approve/reject (admin)                              |
| GET    | `/api/readers/{id}`          | Public reader profile + approved comments (DEC-294) |

Comments are moderation-gated (new comments must be approved). A **signed-in
reader** comments under their verified account identity (DEC-062): the form
omits name/email, the backend stamps the account's display name (client-supplied
identity is ignored — no spoofing), and the comment list shows a verified-reader
badge. Anonymous commenters keep the free-text nickname/email path.
`GET /api/reader/me/comments` lists a reader's own comment history across
statuses, with an optional `q` content keyword filter (escape-aware, composes
with the status filter — DEC-411, round 369).

### Admin

| Method | Endpoint                            | Description                                                  |
| ------ | ----------------------------------- | ------------------------------------------------------------ |
| POST   | `/api/admin/login`                  | Admin login                                                  |
| GET    | `/api/admin/stats`                  | Dashboard analytics                                          |
| GET    | `/api/posts?all=true`               | List all (incl. drafts)                                      |
| GET    | `/api/comments?approved=false`      | List pending comments                                        |
| PATCH  | `/api/comments/{id}/approve`        | Approve comment                                              |
| POST   | `/api/upload`                       | Upload image                                                 |
| GET    | `/api/upload/files`                 | Media library — list uploads with reference status (DEC-183) |
| DELETE | `/api/upload/files/{y}/{m}/{file}`  | Delete an upload; 409 while referenced by a post (DEC-183)   |
| GET    | `/api/export/posts.csv`             | Export posts (admin)                                         |
| GET    | `/api/export/comments.csv`          | Export comments (admin)                                      |
| GET    | `/api/admin/calendar?month=YYYY-MM` | Posts bucketed by date for the editorial calendar (DEC-162)  |

### Search, SEO & Stats

| Method | Endpoint                  | Description                                                                                |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/search?q=`          | Full-text search (CJK-aware, DEC-070)                                                      |
| GET    | `/api/search/comments?q=` | Comment search — approved comments with highlighted snippets + post brief (DEC-405)        |
| GET    | `/api/comments/feed`      | Latest discussion — newest approved comments across the site + post brief (DEC-407)        |
| GET    | `/rss/comments.xml`       | Discussion RSS — newest approved comments site-wide, deep-linked to each comment (DEC-409) |
| GET    | `/rss/comments.atom.xml`  | Discussion Atom — newest approved comments site-wide (DEC-409)                             |
| GET    | `/api/stats`              | Blog statistics                                                                            |
| GET    | `/rss/feed.xml`           | RSS 2.0 feed                                                                               |
| GET    | `/rss/atom.xml`           | Atom feed                                                                                  |
| GET    | `/sitemap.xml`            | XML sitemap                                                                                |
| GET    | `/robots.txt`             | robots.txt                                                                                 |
| GET    | `/health`                 | Health check                                                                               |

### Web Push (optional, needs VAPID keys)

| Method | Endpoint                     | Description                               |
| ------ | ---------------------------- | ----------------------------------------- |
| GET    | `/api/push/vapid-public-key` | VAPID public key for browser subscribe    |
| POST   | `/api/push/subscribe`        | Store a reader's browser subscription     |
| POST   | `/api/push/unsubscribe`      | Remove a subscription (idempotent)        |
| POST   | `/api/push/notify`           | Broadcast to subscribers (superuser only) |

> Web Push is opt-in and off until `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are set
> (see `backend/nova/.env.example`). Without them every push endpoint fails
> closed with 503.

**Reader reply notifications (DEC-064)**: a signed-in reader's browser
subscription is bound to their account (`POST /api/push/subscribe` carries the
reader JWT), so when someone replies to their comment they receive a push
notification ("有人回复了你的评论"). Anonymous subscribers still just receive
the superuser broadcast. The reply-notification copy is configurable via
`REPLY_NOTIFICATION_TITLE`/`REPLY_NOTIFICATION_BODY`.

### Reader Accounts & Cloud Bookmark Sync

Reader accounts are the identity layer for cloud-synced bookmarks (audience-
separated from admin JWTs; see `docs/security.md`). Registration is rate-
limited (default 5/min/IP).

| Method | Endpoint                                  | Description                                                                                                                                            |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/reader/register`                    | Create a reader account (returns a reader JWT, auto-login)                                                                                             |
| POST   | `/api/reader/login`                       | Reader login (email + password)                                                                                                                        |
| GET    | `/api/reader/me`                          | Current reader profile                                                                                                                                 |
| GET    | `/api/reader/me/bookmarks`                | Cloud-synced bookmark list (publicly-visible posts only; optional `folder_id` and `done` queue filters)                                                |
| PUT    | `/api/reader/me/bookmarks/{id}`           | Add a bookmark (idempotent: 201 new / 200 already)                                                                                                     |
| PATCH  | `/api/reader/me/bookmarks/{id}/done`      | Move a bookmark between To-read and Done (idempotent; 404 if not saved) (DEC-395)                                                                      |
| DELETE | `/api/reader/me/bookmarks/{id}`           | Remove a bookmark (idempotent 204)                                                                                                                     |
| GET    | `/api/reader/me/comments`                 | Reader's own comments across statuses, with optional `q` content keyword filter (DEC-066; q DEC-411)                                                   |
| DELETE | `/api/reader/me/comments/{id}`            | Delete one of the reader's own comments (any status)                                                                                                   |
| PATCH  | `/api/reader/me`                          | Update display name (bookmarks/email live on their own endpoints) (DEC-067)                                                                            |
| POST   | `/api/reader/me/avatar`                   | Upload/replace the reader's profile picture (DEC-299)                                                                                                  |
| DELETE | `/api/reader/me/avatar`                   | Remove the reader's profile picture (DEC-299)                                                                                                          |
| POST   | `/api/reader/me/password`                 | Change password (revokes other sessions, returns fresh token)                                                                                          |
| POST   | `/api/reader/me/email/request`            | Start an email change: verify the current password, email a single-use link to the NEW address (202; 409 if taken, 503 if SMTP unconfigured) (DEC-357) |
| POST   | `/api/reader/me/email/confirm`            | Redeem the emailed link: swap the email, revoke all pre-change sessions, auto-login (no auth — the link is the credential) (DEC-357)                   |
| POST   | `/api/reader/password-reset/request`      | Email a password-reset link (generic 202; 503 only if email unconfigured) (DEC-286)                                                                    |
| POST   | `/api/reader/password-reset/confirm`      | Redeem the reset token: set a new password, revoke all sessions, auto-login (DEC-286)                                                                  |
| GET    | `/api/reader/me/push-subscriptions`       | Reader's push devices (no keys) (DEC-067)                                                                                                              |
| DELETE | `/api/reader/me/push-subscriptions/{id}`  | Revoke one push device (DEC-067)                                                                                                                       |
| GET    | `/api/reader/me/notifications`            | Reader's durable notification inbox (read/unread) (DEC-160)                                                                                            |
| POST   | `/api/reader/me/notifications/{id}/read`  | Mark one notification read (DEC-160)                                                                                                                   |
| POST   | `/api/reader/me/notifications/read-all`   | Mark all notifications read (DEC-160)                                                                                                                  |
| GET    | `/api/reader/me/notification-preferences` | Read the reader's per-kind notification switches (DEC-171)                                                                                             |
| PATCH  | `/api/reader/me/notification-preferences` | Toggle one notification kind on/off (DEC-171)                                                                                                          |
| GET    | `/api/reader/me/history/in-progress`      | Posts with a saved resume position, newest-first — the home Continue-reading trail (DEC-348)                                                           |
| GET    | `/api/reader/me/history/{post_id}`        | Reader's saved resume offset for a post — pixel and scrollable-height fraction (null if never read) (DEC-167, DEC-346)                                 |
| POST   | `/api/reader/me/history/{post_id}`        | Record a view; optional body `{scroll_position, scroll_fraction}` saves the resume offset (DEC-167/346, TASK-200/399)                                  |
| GET    | `/api/reader/me/history/insights`         | Reading insights: distinct posts read all-time + trailing 30 days, most-read categories (publicly-visible only) (DEC-417)                              |

Bookmarks are stored localStorage-first on the browser and merged to the cloud
when a reader signs in — offline changes survive and re-concile on the next
login. Reader bookmarks never appear in shared caches (`Cache-Control:
no-store`).

**Reader notification inbox (DEC-160)**: `/notifications` shows the signed-in
reader a durable, read/unread list of their follow/reply/thread activity — new
posts in followed series/categories, replies to their comments, and new comments
on followed threads — each deep-linking to the source. These rows persist
server-side at the same points that fire the browser push, so a reader sees
activity they missed even when Web Push is off or the browser was closed.

**Reader comment management (DEC-066)**: `/comments` shows the signed-in
reader their own comments with a moderation status (待审核 / 已发布 / 未通过 —
a moderated blog hides pending comments from everyone but their author), a
link back to each thread, and a delete action scoped to their own comment.

**Reader account self-service (DEC-067)**: `/account` lets a signed-in reader
edit their display name and rotate their password (the current password is
verified, all other sessions are signed out, and a fresh token is issued), and
inspect/revoke the browser push devices bound to their account.

**Reader password recovery (DEC-286)**: a reader who forgot their password
requests a reset link at `/forgot-password`; the backend emails a single-use,
30-minute reset token to the registered address and `/reset-password` redeems
it (set a new password → all old sessions revoked → auto-login). The request is
deliberately not an account-existence oracle (same generic 202 for known and
unknown addresses), and a reset token can never be replayed as a reader or
admin credential (dedicated JWT audience). Email recovery needs SMTP configured
(the same infra as the notification emails, DEC-197).

**Per-post reading trend (DEC-287)**: the post editor shows a 30-day view
sparkline for the open post (`GET /api/admin/stats/views/posts/{id}`) so the
author can see whether a post is gaining or decaying readership at a glance —
the per-post companion to the dashboard's aggregate trend (DEC-086).

**Reading density (DEC-288)**: on every post page the reader can scale the
article body text with A−/A+ (three sizes). The choice is remembered per device
(localStorage) and applies to freshly loaded documents too — long-form reading
comfort with no account required.

## 🏗️ Architecture

![Architecture Diagram](./docs/x-blog-architecture.png)

> 📁 [Interactive HTML version](./docs/x-blog-architecture.html) — open locally in browser for zoom/pan. SVG diagram covering: Nuxt Frontend, FastAPI Backend, SQLite DB, JWT Auth, Admin Zone, and DevOps tooling.

## 🗂️ Project Structure

```text
x-blog/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── main.py         # Application entry
│   │   ├── config.py       # Configuration
│   │   ├── database.py     # Database setup
│   │   ├── models.py       # SQLAlchemy models
│   │   ├── schemas.py      # Pydantic schemas
│   │   ├── crud.py         # Database operations
│   │   └── routers/        # API routes
│   ├── tests/              # pytest tests (1243 tests)
│   └── pyproject.toml      # Python config
│
├── frontend/
│   └── nuxt/               # Nuxt 4 app (Vue-based frontend)
│       ├── app/            # Pages, layouts
│       ├── components/     # Vue components
│       ├── composables/    # Composables (useApi, useI18n, etc.)
│       ├── server/         # Server routes (RSS, sitemap, etc.)
│       ├── tests/          # Unit tests
│       ├── e2e/            # E2E tests
│       ├── package.json
│       └── Dockerfile
├── docs/                   # Documentation
├── justfile                # Task runner (recommended)
└── package.json            # Root config (for pnpm workspaces)
```

## 🧰 Tech Stack

### Backend

- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- **ORM**: [SQLAlchemy](https://www.sqlalchemy.org/) - Database ORM
- **Database**: SQLite (default), easily switch to PostgreSQL/MySQL
- **Validation**: [Pydantic](https://docs.pydantic.dev/) - Data validation
- **Testing**: [pytest](https://pytest.org/) - Python testing with pytest-xdist for parallel execution
- **Linting**: [ruff](https://docs.astral.sh/ruff/) - Fast Python linter and formatter

### Frontend

- **Framework**: [Nuxt 4](https://nuxt.com/) - Vue framework with SSR/SSG
- **UI**: Custom Vue components with Tailwind CSS
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) - CSS framework
- **Testing**: [Vitest](https://vitest.dev/) - Unit testing, [Playwright](https://playwright.dev/) - E2E testing
- **Icons**: [@iconify/vue](https://icon-sets.iconify.design/) with lucide icons

### DevOps

- **Package Managers**: [uv](https://github.com/astral-sh/uv) (Python), [pnpm](https://pnpm.io/) (Node.js)
- **Task Runner**: [just](https://github.com/casey/just) - Command runner
- **Linting**: [ruff](https://docs.astral.sh/ruff/) (Python)
- **Git Hooks**: [prek](https://github.com/astral-sh/prek) - Git hooks manager

## 🧪 Testing

```bash
# Run all tests
just test

# Run backend tests (parallel)
just test-backend

# Run frontend tests
just test-frontend

# Run tests with coverage
just test-frontend-coverage
```

### Testing with PostgreSQL

The backend tests run on SQLite by default. To test against PostgreSQL:

```bash
# Run backend tests against a PostgreSQL database
TEST_DATABASE_URL="postgresql://user:password@host:port/dbname" just test-backend-postgres

# Or directly with uv
TEST_DATABASE_URL="postgresql://user:password@host:port/dbname" uv run pytest -n auto
```

The PostgreSQL test suite includes dedicated connection validation tests (`tests/test_postgres_connection.py`) covering connection establishment, schema creation, transactions, CRUD operations, and concurrent connections.

**Test Statistics:**

- Backend: 1243 tests (pytest + pytest-xdist), 93.5% coverage
- Nuxt (frontend): 1317 tests (Vitest)
- **Total: 2523 tests, 0 failures**

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests to ensure everything passes (`just test`)
4. Fix any lint issues (`just fix`)
5. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🚀 Deployment Guide

See [Deployment Guide](./docs/deployment.md) for detailed instructions on:

- Local development setup
- Docker production deployment
- Separated backend/frontend deployment
- Environment configuration

---

<div align="center">

Built with ❤️ using FastAPI + Nuxt

</div>

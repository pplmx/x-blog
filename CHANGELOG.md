# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[English](./CHANGELOG.md) · [中文](./CHANGELOG.zh-CN.md)

## [Unreleased]

- 🛠️ **Reader-auth polish round (round 392)**: a deep-dive across the sign-in
  surface found the auth forms were showing ofetch's **technical error strings**
  (`"[POST] ...: 401 Unauthorized"`) instead of the backend's human message — a
  wrong password, a bad 2FA code or a rejected registration now surface the real
  reason ("Incorrect email or password", "Email already registered", …), read
  from the `{"error":{"message":…}}` envelope with fallbacks (login, 2FA,
  register, password-reset). The session store is also **hardened against a
  throwing localStorage write**: private-mode quota or Safari's storage block no
  longer fails an auth call that already succeeded server-side — the in-memory
  session carries the tab. **Sign-in redirect can no longer be abused**:
  `?redirect=/\evil.com` passes the old same-origin check but WHATWG URL
  normalization folds the backslash into `//`, turning it into an external-origin
  navigation — backslash-bearing values now fall back to /bookmarks. The
  **register display-name field** carries the backend's 50-char cap as a
  client-side `maxlength`, so an over-long name fails fast instead of a
  post-submit 422. And the **password-reset "← Back to login" link now actually
  goes to /login** — with a token present it was mislabeled navigation to
  /forgot-password. Frontend 2399 unit tests (+10), typecheck/lint green (round
  392, DEC-446/447).
- 🛠️ **Bug-fix & polish round (round 391)**: five verified defects fixed across
  the stack. **Account deletion now truly total**: `delete_reader_account` left
  post-likes, author-follows and both directions of reader follows/blocks
  behind, so on SQLite (no AUTOINCREMENT) a future account could inherit a
  recycled id with another reader's data or a grafted relationship — these rows
  are now reaped too. **Reply-notification deep-links land on the new reply**
  instead of your own parent comment (the promised "tap and get taken to the
  reply" of DEC-072 was pointing at the wrong anchor). **Upload storage
  directory** is keyed on the same naive-UTC clock the media library uses, so a
  non-UTC server can no longer write files a month ahead of their listed
  timestamp. On **search**, a zero-hit comments-mode query no longer says
  "adjust your filters" with a dead "clear all" button (the search mode was
  miscounted as a filter), and **"did you mean" chips refresh when you correct
  one typo into another** instead of lingering on the old term. An
  **admin-frontend pass** on the same round fixed four more: **"Notify
  subscribers" no longer broadcasts the unsaved form** (it flushes the editor
  first and refuses with a "save first" message if the save didn't land — an
  unsaved slug edit used to push a 404 deep-link to every subscriber), the post
  editor's **Cancel now confirms** before discarding unsaved changes (it sat
  silently beside Save), the three raw-fetch admin flows (image upload,
  change-password, the moderation-alert push toggle) now **route expired
  sessions to login** instead of stranding the operator with a generic error,
  and the dashboard's **pending-comment counters stay in sync** after
  approve/reject (the big stat card used to contradict the quick card, and the
  quick card went empty despite server backlog). Backend 1873 + 10 skipped,
  frontend 2389 unit tests, typecheck/lint all green (round 391, DEC-444/445).
- 💡 **"Did you mean" search suggestions (round 390)**: the post search is
  exact substring + tsvector with no fuzzy layer, so a misspelled or
  half-remembered query ("recatvie", a CJK typo like 异步编程实贱) dead-ends on
  an empty page. A zero-hit POST search now calls a new `GET
  /api/search/suggest?q=` that scores a bounded vocabulary — tag/category
  names + recent public post titles — with plain Python edit distance, so a
  one-character CJK typo scores exactly like an ASCII one with no Postgres
  extension involved. The suggestion chips ("你是不是想找：") appear in the
  empty state, and tapping one re-runs the search with the corrected term
  (preserving any active category/tag/date filters). The backend never offers
  a zero-hit topic, bounds the vocabulary, and shares the search rate-limit
  bucket — the client only fires it after a search genuinely returned zero
  hits. Backend 1873 + frontend 2386 unit tests + a Playwright journey
  (publish → typo search → suggestion chip → corrected results) all green
  (round 390, DEC-443).
- 🔎 **Search inside a comment thread (round 389)**: a long discussion (sorted
  newest/oldest/helpful, arbitrarily paginated) had no way to find "that answer
  that mentioned X" — the global comment search cannot scope to a post. The
  thread now has its own debounced search box beside the sort control: typing
  narrows the list server-side to approved comments whose content matches every
  term (`GET /api/comments/post/{id}?q=`, case-insensitive substring AND, the
  same dialect-agnostic path the global comment search uses, so Chinese terms
  match partial runs). The term resets to page 1, composes with any sort, a
  clear button restores the full thread, and LIKE metacharacters are escaped so
  a `%` query matches literally. Backend 1846 + frontend 2382 unit tests + a
  Playwright journey (seed a marked thread → box narrows → clear restores) all
  green (round 389, DEC-442).
- 📝 **Inline Markdown footnotes (round 388)**: an author citing a source had no
  way to render a footnote — the GFM `[^1]` / `[^1]: ...` marker printed as
  literal raw text mid-article. The frontend marked integration (markdown
  renderer shared by the post body, print/PDF route, and the admin editor
  preview) now ships a zero-dependency footnote extension: the in-text marker
  becomes a backlinked `<sup>`, the definition lines become a compact citation
  list with an id per item and a "↩" backref, and inline markdown (bold, links,
  code) keeps working inside a footnote. The same fix lands in the backend's
  full-content RSS/Atom feeds (the python-markdown `footnotes` extension plus
  the `id`/`class` allowlist the backlink anchors need). One renderer change
  heals every consuming surface. Backend 1844 + frontend 2378 unit tests + a
  Playwright journey (publish → citation renders → raw marker absent) all green
  (round 388, DEC-441).
- 🔥 **Trending this week (round 387)**: the home page's Popular row ranked by
  all-time views, so a brand-new post being read right now had no way to
  surface. The home page now also shows a "Trending this week" row ranked by
  in-window views from the analytics table that already counts every pageview
  by day (`post_views_daily`, DEC-086) — each card carries the weekly read
  count ("N reads this week"), distinct from the all-time counter. Public
  `GET /api/posts/trending/list?days=7&limit=5` (published, effective-live
  posts only; an empty window returns `[]` and the section hides, since fresh
  installs track the daily table forward only). Backend 1843 + frontend 2371
  unit tests + a Playwright journey (publish → view burst → appears in the
  row) all green (round 387, DEC-438).
- 👤 **Hide blocked readers' comments (round 386)**: round 379's reader
  blocking (DEC-425) suppressed the notification fan-outs but promised more —
  "a blocked commenter is invisible to them even mid-thread" — which no render
  path honored: a blocked reader's comments kept showing in the post thread,
  the discussion feed, and comment search. Blocking is a receiver-side opt-out,
  so suppression now happens on the blocker's own device: the thread
  (CommentList), the `/discussion` feed and comment search each load the
  viewer's `/me/blocks` list once and drop rows authored by blocked readers,
  while unblocked third-party replies survive via the existing parent-missing
  promote (the blocked author is hidden, their audience is never censored).
  Anonymous visitors and readers with an empty block list see today's exact
  page, and pagination totals stay the server's real count (blocking is a
  per-viewer view, not a global deletion). A Playwright journey covers all
  three surfaces — thread → discussion feed → comment search. Frontend 2367
  unit tests + the e2e journey all green (round 386, DEC-436/DEC-437).
- ✏️ **Guest comment management (round 385)**: comment edit/delete was
  signed-in-reader only, so an anonymous commenter who made a typo had no way
  to fix or withdraw it (and every comment is moderated, so it became
  permanent the moment it was approved). A guest who left an email now gets a
  "your comment is live — manage it" email at approval carrying the same
  per-comment secret token the reply email already used (DEC-332); that link
  opens a flat `/comment-manage` page where they can edit the text (it
  re-enters moderation, exactly like a signed-in reader's edit) or delete the
  comment (replies are reparented so the thread stays intact). New token-gated
  GET/PATCH/DELETE `/api/comments/manage` endpoints mirror the reader
  ownership semantics; an unknown token is a 404 so nothing is enumerable.
  Zero-DDL — it reuses the existing token column and delivery path. Backend
  1839 + frontend 2358 unit tests + a Playwright journey (comment with consent
  → approval → emailed link → edit → delete → link spent) all green
  (round 385, DEC-435).
- 📴 **Offline reading (round 384)**: the service worker existed only for web
  push, and only for readers who opted in — everyone else had no offline story
  at all. `/sw.js` is now registered app-wide in production builds and keeps a
  network-first, bounded runtime cache of successful same-origin GETs: visiting
  a post caches its document + JS/CSS chunks + images, so reloading it with the
  connection off still renders the article. While online every request still
  hits the network (the cache is only an offline fallback — nothing is ever
  stale), the cache auto-evicts oldest entries past 60, and API/admin/feeds and
  cross-origin requests pass through untouched. 2351 frontend unit tests + an
  offline-reading e2e (register → visit a post → drop the network → reload →
  article still renders) green (round 384).
- 🐎 **Bounded reading-summary aggregation (round 383)**: `/me/history/stats`
  used to scan a reader's entire history and materialize every post row —
  including `content` — to compute reading-minutes in Python (multi-MB per
  /history pageview for heavy readers). A denormalized
  `reading_history.reading_minutes` column (maintained by the record/import
  write paths, backfilled for existing rows so totals don't jump) lets the
  summary aggregate in SQL: COUNT/SUM/MAX plus narrow viewed_at timestamps for
  the streak heatmap; no post content ever leaves the database in that endpoint.
  The estimate tracks the content as last READ, so editing a post afterwards no
  longer mutates a reader's total. Migration verified on SQLite and
  PostgreSQL 18 (round 383, ISS-451).
- 🕳️ **Naive-UTC hardening (round 383)**: `comments.reviewed_at/edited_at` and
  `reading_history.viewed_at` are naive-UTC DateTime columns, but four write
  sites (crud approve/edit/record/import + the admin bulk-approve stamp + the
  viewed_at ORM default) assigned aware `datetime.now(UTC)` — a latent trap if
  a row is cached or serialized above the DB. Writes now use the `utc_now_naive`
  helper consistently (round 383, ISS-452).
- 🧭 **Compact top nav with a "My" avatar menu (round 382)**: the signed-in
  header had grown to 14 flat links plus search, push, language and theme — it
  needed 1400px+ in English (hidden-scrollbar overflow at xl) and its width
  jumped when a reader signed in. Every reader-personal link (bookmarks,
  history, my comments, liked, follows, notifications, account) now lives in a
  single "我的" avatar dropdown: a mini profile header (→ /account), a public
  profile link (→ /readers/{id}), the unread badge on the avatar itself, and
  sign-out — with the same keyboard/outside-click contract as the language
  switcher. Signing in now just swaps the Sign-in button for the avatar, so the
  bar width is constant across auth states; the mobile panel shows the same
  links in an always-expanded "我的" section. The old "authOnly links must be
  appended last (SSR node reuse)" constraint collapses to a single trailing
  avatar node, and the redundant flat /search link is gone — HeaderSearch is
  ever-present. 2347 frontend unit tests, typecheck and lint all green; the
  my-comments e2e now drives the avatar menu (history, a guest journey,
  navigates directly).
- 🚫 **Reader blocks (round 379)**: the blog had reader-to-reader follows,
  public profiles and @-mention fan-out, but no way for a reader to stop a
  barking commenter's mentions, replies and activity landing in their inbox.
  A Block/Unblock toggle on a reader's public profile — one-way and invisible
  (the blocked reader is never told and can keep commenting) — backs onto
  GET/PUT/DELETE `/api/reader/me/blocks`, and every dispatch point drops a
  blocker-of-the-commenter: @-mentions, replies, thread-comment broadcasts and
  follow-activity each suppress a blocked commenter's fan-out, while `/account`
  lists blocked readers for one-click unblock that restores everything. 1799
  backend tests @93.77% (+18, Postgres-verified), 2318 frontend tests (+9), and
  a reader-block e2e journey all green (DEC-425, TASK-437).
- 📧 **Guest thread-follow by email (round 380)**: comment-thread follow was
  reader-gated, so a visitor wanting to follow ONE discussion by email had no
  on-ramp but registering. A compact form on a post's comment header takes an
  address and double opt-in confirms it (auth-free 202, generic no-oracle
  answer, one confirmation email per new row, mirrored from the newsletter);
  once confirmed, every new APPROVED comment fans out one email — deep-linked
  to the comment and carrying a per-subscription one-click unsubscribe — and
  pending/unsubscribed rows stay silent while a commenter's own address is
  skipped. Never needs an account. 1814 backend tests @93.72% (+15,
  Postgres-verified), 2332 frontend tests (+14), and a guest-thread-follow e2e
  journey all green (DEC-427, TASK-438).
- 📧 **Weekly summary for followed discussions (round 381)**: round-380 guest
  thread-follow emails once per approved comment — a follower of several active
  threads is spammed daily with no cadence choice, the same gap the newsletter
  closed in DEC-355. A confirmed follower can now pick "one weekly summary"
  (subscribe-time flag, the confirm-page checkbox, or the token-gated
  `/guest/digest` flip): weekly rows are excluded from the per-comment fan-out
  (one channel per subscriber) and the weekly digest job (same CLI / admin
  trigger as the newsletter + reader digests) sends one summary per followed
  thread aggregating that week's approved comments — deep-linked to each, same
  one-click unsubscribe. 1823 backend tests @93.67% (+9, Postgres-verified),
  2335 frontend tests (+3), and the guest-thread-follow e2e journeys (two tests)
  all green (DEC-429, TASK-439).
- 📧 **Weekly-digest operator console (round 378)**: the weekly digest (for both
  readers and guests) ran on complete backend machinery with no admin reading
  surface —
  an operator could trigger it by CLI or the superuser endpoint but could not
  see who opted into the weekly cadence, when the last one went out, or what
  the next window held. A new digest panel on `/admin/newsletter`
  (`GET /api/admin/newsletter/digest/overview`: active-reader and confirmed-guest
  digest-subscriber counts, the max `digest_sent_at` as last-sent, and the
  rolling-window public-post count) gives that reading surface, plus a dry-run
  **preview** (`send-weekly?dry_run=true`, reports the summary without sending
  or stamping) and a confirmed **send now** for superusers — the monitoring and
  preview loop that completes the digest feature. 1781 backend tests @93.75%
  (+7, Postgres-verified), 2309 frontend tests (+5), and a digest-panel e2e
  journey all green (DEC-423, TASK-436).
- 📊 **Reading insights on `/history` (round 372)**: the streak and 52-week
  heatmap (DEC-316) showed the *calendar shape* of reading — but a reader
  wondering "how many posts have I read in the last month" or "which topics do
  I actually read most" had no aggregate to look at, only the raw row list. A
  new `GET /api/reader/me/history/insights` returns the *content shape*:
  distinct publicly-visible posts read all-time and in the trailing 30 days,
  plus the most-read categories (top 5 by distinct post count, one row per
  reader-post so repeat visits on the same post count once). The `/history`
  page renders a compact insights panel beside the heatmap — a "read in the
  last 30 days" card and most-read-category chips — for signed-in readers
  only, fetched best-effort in parallel (hidden for guests and on any failure,
  never blocking the list). Same public-visibility invariant as every history
  read path: un-published and scheduled posts neither leak nor count.
  1774 backend tests @93.74% (+7), 2304 frontend tests, and a new
  reading-insights e2e journey all green.
- 💔 **In-place unlike on `/liked` (round 371)**: every reader-owned list
  surface had a management control except the liked-posts page — bookmarks has
  per-row remove and the To-read/Done toggle, but taking a like back meant
  visiting the post and hitting the heart. Now each `/liked` card carries one:
  a heart-off button that unlikes in place via the existing idempotent
  `DELETE /api/reader/me/likes/{id}` (decrementing the public counter), drops
  the card and its count immediately (single-flight per row, restored with an
  error line if the request fails), and clears the local like marker too — so
  the post-page heart reflects it on the next visit. The card was restructured
  so the button sits outside the link (no interactive-inside-anchor), and a
  drain-clamp reloads when the last page empties. Frontend-only: the backend
  endpoint already existed. 2300 frontend tests and a new liked-unlike e2e
  journey all green.
- 🔍 **Liked-posts recall search (round 370)**: the last reader-owned surface
  without keyword search finally gets it — bookmarks (DEC-124), `/history`
  (DEC-148) and my-comments (round 369) could all be filtered by term, but the
  `/liked` page (round 359) only paginated, so a reader who'd liked a lot of
  posts couldn't find the one they now recalled. `/liked` now has a debounced
  (300 ms) search box and `GET /api/reader/me/likes` takes an optional `q` that
  matches the post title or excerpt case-insensitively (escape-aware LIKE),
  composing with the public-visibility gate and pagination. A new search
  restarts at page 1; a term with no match shows a "no liked posts match" empty
  state with a one-click clear-search reset. The filter runs in SQL, so the
  whole liked set is searched, not just the loaded grid. 93.72% coverage;
  1767 backend tests, 2296 frontend tests, and a new liked-search e2e journey
  all green.
- 🔍 **My-comments keyword search (round 369)**: a reader with a long comment
  history can now find a single comment by what it says — recall-search for the
  comment you left, the last reader-owned surface still without it (bookmarks
  and `/history` gained theirs in DEC-124/DEC-148). The `/comments` page gains
  a debounced (300 ms) search box, and `GET /api/reader/me/comments` takes an
  optional `q` that matches comment content case-insensitively (escape-aware
  LIKE, so `%`/`_` match literally), composes with the status filter, and stays
  scoped to the caller's own comments. A new search restarts at page 1; a term
  with no match shows a "no matching comments" empty state with a one-click
  clear-search reset rather than the misleading "you haven't commented yet".
  The filter runs in SQL, so the whole history is searched, not just the loaded
  page. 93.72% coverage; 1757 backend tests, 28 frontend page tests, and a new
  my-comments-search e2e journey all green.
- **Discussion RSS/Atom (round 368)**: the conversation is findable (round 366)
  and browsable (round 367) — now it's SUBSCRIBABLE too, since the RSS/Atom
  line-up previously covered posts only (site/category/tag/author/series).
  New `/rss/comments.xml` (RSS 2.0) and `/rss/comments.atom.xml` (Atom) stream
  the newest approved comments site-wide: one item per comment carrying the
  commenter (display name/nickname) + post title, with a perma link ON the
  comment (`#comment-{id}`, DEC-321) rather than just the post headline. The
  visibility gate matches the discussion feed/search exactly — pending/rejected
  comments and comments on draft or not-yet-published posts never appear, and
  the content never carries email/ip — and the feeds are cached under scoped
  keys and served with ETags/conditional responses like the post feeds. The
  `/discussion` page now has a "Subscribe to the discussion RSS" link and
  RSS/Atom auto-discovery tags, fronted by dedicated Nuxt proxy routes. 93.72%
  coverage; 1748 backend tests, 7 frontend tests, and 2 discussion-RSS e2e
  journeys all green.
- **Latest discussion feed (round 367)**: round 366 made the discussion
  findable, but a visitor who wants to see what the site is talking about right
  now still had no entry point — the thread is the blog's second content
  asset, with no "what's happening" surface beyond each post's comment list and
  the search box. The new public `/discussion` page (also linked from the
  footer) streams the newest approved comments site-wide, newest first: each
  card carries the commenter identity (display name for signed-in commenters),
  the comment content, and the title of the post it lives on, and clicking
  deep-links ONTO that exact comment (`#comment-{id}`, DEC-321) rather than
  just the post headline. The visibility gate matches comment search exactly:
  pending/rejected comments and comments on draft or not-yet-published posts
  never appear; emails/IPs never leave the backend. Public, no auth,
  paginated, SEO'd. 93.71% coverage; 1741 backend tests, 13 frontend tests,
  and 2 discussion-feed e2e journeys all green.
- **Public comment search (round 366)**: the search box could find articles,
  but the discussion — the blog's second content asset — was unsearchable.
  `/search` now gains a Comments mode (a search-scope tablist, living in the
  URL as `?type=comments` so a comment-search share link lands straight in that
  mode): it matches approved comments by content (every term must hit, newest
  first), and each hit carries a highlighted snippet (escaped before `<mark>`,
  so XSS-safe) plus the post brief, with the card deep-linking ONTO the comment
  (`#comment-{id}`, DEC-321) instead of just the post headline. The
  visibility gate mirrors article search: pending/rejected comments and
  comments on draft or not-yet-published posts never match; emails/IPs never
  leave the backend. Posts-only filters (category/tag/sort/date range) hide in
  comment mode, and paging or refining the term keeps the active mode; LIKE
  metacharacters like `%`/`_` are matched literally (review feedback). 93.69%
  coverage; 1734 backend tests, 58 frontend search tests, and 2 comment-search
  e2e journeys all green.
- **Reader-to-reader follow (round 365)**: the follow wheel — categories,
  series, tags and authors all already had a "tell me when this speaks" axis —
  finally gains its person-to-person entry: a signed-in reader can follow
  ANOTHER READER (the commenter behind a public profile) from their
  `/readers/{id}` profile header. Every visitor sees the public follower count
  (like an author-follow count); a signed-in non-self reader gets a
  Follow/Following toggle that subscribes them to that reader's approved
  comments. Whenever a moderator approves a comment from someone you follow, a
  deep-linked `reader_comment` inbox row lands under 通知 — replies still
  notify the replied-to reader, and a parent who also follows the commenter is
  never double-pushed for the same comment. Deactivated followers and anyone
  who turned the kind off are skipped, and a notification-write failure can
  never break the approval. `/account` gains a "Followed readers" section for
  one-click unfollow (which stops the fan-out), `reader_comment` is a real
  per-kind opt-out on /notifications (DEC-171) like the other inbox kinds, and
  the new follower count + the caller's own follow stance ride the public
  profile payload (no new endpoint, no PII). Self-follow is rejected and an
  unknown/deactivated target is a uniform 404 — no followability oracle.
  Additive `reader_follows` table (unique per pair, `notify` reserved for
  future per-follow control) + a `reader_notification_prefs.reader_comment`
  column (migrations l5n7p9r1t3v5, m7d9f1a3b5c7; round-trip SQLite + Postgres).
- **Reader two-factor authentication (round 364)**: reader accounts have
  accumulated durable private data over rounds 358–363 — cloud-synced
  bookmarks/likes/history, the GDPR export bundle, email, follows, notification
  prefs and push devices — all behind a single email+password credential, so a
  leaked password exposed the whole surface. A reader can now raise that to
  password + a TOTP code (RFC 6238, works with any authenticator app) from
  `/account`: setup hands back a base32 secret + `otpauth://` provisioning URI
  (rendered as a QR), and enabling requires the current password AND a live
  code — so a stolen session alone can't register a factor the owner can't
  remove (security review MEDIUM). With 2FA on, `POST /api/reader/login`
  returns NO access token — only a short-lived, single-purpose `mfa_token`
  (own `aud=x-blog-reader-2fa` audience, 5-minute expiry, tied to
  `token_version` so a password change kills outstanding challenges) — and
  `POST /api/reader/login/2fa` exchanges code + token for the real session.
  Every failure on that second step is one indistinguishable 401 (no oracle for
  "is my stolen challenge still live?" vs "is the code wrong?"); disabling also
  requires the current password AND a valid code, and the seed is cleared
  (re-enroll from setup). Additive `two_factor_enabled` (`sa.false()`) +
  nullable `two_factor_secret` columns (migration j3l7o9q1s5t3, round-trips
  SQLite + Postgres); the secret is never serialized into any profile or token
  response. `pyotp` added as the TOTP backend.
- **Public "Saved posts" profiles (round 363)**: round 360 gave readers an
  opt-in "Liked posts" discovery tab; the companion curation axis is what a
  reader chose to KEEP (save-for-later / done queue) rather than merely
  appreciate. A second `/account` checkbox (off by default, fuchsia, distinct
  from the likes flag) now publishes a "Saved posts" tab on the public
  `/readers/{id}` profile, fed by a public `GET /api/readers/{id}/bookmarks`
  anyone can browse, newest save first. Privacy posture mirrors round 360
  exactly: the flag defaults OFF, a reader who never opts in gets no tab, and
  the endpoint 404s identically for an unknown reader and an opted-out one
  (one indistinguishable answer — no oracle), while the published list is
  filtered to publicly-visible posts only (no draft/scheduled leak). The flag
  rides `/account` PATCH, the `/me` + public profile envelopes, and the
  portable data export; additive `public_bookmarks` column (migration
  i2k4m6n8p0r2, `sa.false()` default like the round-361 dialect fix), served
  no-store per-reader.
- **Recommended for you on the post page (round 362)**: the homepage has had
  an affinity-scored "Recommended for you" row since round 278 (DEC-128), but
  the post page — the single highest-intent "what should I read next?" moment —
  only offered topic-similar Related Posts and person-shaped
  "More from this author", neither keyed to what the reader actually likes.
  A signed-in reader who finishes an article now gets a personalized strip at
  the article end, scored from their own reading-history/bookmark affinity
  (the same `/api/reader/me/recommendations` call the homepage uses). Guests
  and signed-out readers see nothing, and a reader with no affinity (cold
  start) sees no orphaned heading — the strip appears only when there is
  actually something to show.
- **Bookmark To-read vs Done queue (round 361)**: a saved post used to be a
  single undifferentiated concept — bookmarks were "things to read later" and
  also "things I've already read and want to keep", conflated in one list with
  no way to tell them apart. The `/bookmarks` page now separates them: a new
  All / To-read / Done chip row (with live counts, composing with the folder
  and search filters) and a per-row toggle that marks a saved post Done (pruned
  from the To-read queue) or moves it back To-read, with a green "Done" badge
  on read rows. The state is a first-class reader-owned field: additive
  `reader_bookmarks.done` column (migration g1h3i5k7m9n1, defaults off so every
  existing bookmark reads as To-read), `GET /api/reader/me/bookmarks?done=…`
  filter, idempotent `PATCH /api/reader/me/bookmarks/{id}/done`, per-bookmark
  `done` in the list serializer and the portable data export (DEC-334), and
  cloud-synced for signed-in readers — the flip is PATCHed up immediately and
  the merge preserves a Done mark made while logged out (the PUT push can't
  carry done, so a freshly-pushed server row must not clobber it). Also fixes a
  latent SQLite dialect bug the migration review surfaced: `done`/`public_likes`
  now default via `sa.false()` so pre-existing rows read back `false` on both
  engines (the string form stored TEXT `'false'` that SQLite read back True).
- **Public "Liked posts" profiles (round 360)**: round 359 made a reader's
  likes durable cloud rows, but the only surface was the reader's own private
  `/liked` page — the likes were invisible to everyone else. Now a reader can
  opt in on `/account` (a checkbox beside the bio/avatar, off by default) to
  publish a "Liked posts" tab on their public `/readers/{id}` profile, fed by
  a public `GET /api/readers/{id}/likes` that anyone can browse — the first
  reader-to-reader discovery axis. Privacy posture is unchanged: the flag
  defaults OFF, a reader who never opts in has no tab at all, and the public
  endpoint 404s for both unknown readers and readers who chose not to publish
  (one indistinguishable answer — no oracle for "does this reader exist" or
  "what do they like"). The flag rides `/account` PATCH, the `/me` + public
  profile envelopes, and the portable data export (likes + flag join the
  bundle, DEC-334). Additive `public_likes` column (migration f6h8j0l2n4p6),
  no cache interaction (per-reader, served no-store).
- **Cloud-synced likes + liked-posts list (round 359)**: a like used to be a
  localStorage marker that a reader could only ever add — one-shot, device-
  local, no list, no way back. A signed-in reader's like is now a durable,
  cross-device cloud row: the post-page heart is a real toggle (a second click
  un-likes and decrements the count — the server decrements only on a real
  removal), a like made while signed out is promoted to a cloud row on sign-in
  (the same "local wins for adds" merge bookmarks document), and a new
  auth-gated `/liked` page — the "posts I appreciated" surface joining
  bookmarks (saved to read) and history (read) — merges the server's liked set
  down on mount, newest-like-first and paginated, so a like made on one device
  shows up on the next. Guests keep the anonymous client-deduped like, and a
  stale session surfaces a sign-in warning on `/liked` instead of silently
  losing markers.
- **Writer avatar (round 358)**: the person-shaped author surface had a
  voice (bio, round 357) but no face — every rendering was a generic user
  icon while readers had had avatars since round 299. A superuser now uploads
  a small profile picture next to the pen name in admin/users (the same
  validated media pipeline + dedicated `static/avatars` storage as the reader
  avatar), and that face renders everywhere the writer appears publicly: the
  post byline chip, the post-page byline, the "More from this author" strip,
  the `/authors` index card, and the archive header. No-oracle posture holds:
  the avatar is a filename-scoped `/static` URL only, and a username-only
  admin still answers 404 with nothing to leak.
- **Writer bio (round 357)**: the person-shaped author surface (rounds 343-356)
  built bylines, archives, indexes, follow — but never introduced the person.
  A superuser now sets a short public "about this writer" text next to the pen
  name in admin/users (same 500-char plain-text cap as the reader bio from
  round 352), and it renders under the writer's name on their `/authors/{id}`
  archive header — the page where a reader decides about them — plus a
  one-line window on the writer's `/authors` index card. The archive envelope
  carries it (a new `AuthorArchive` shape) while per-post bylines stay slim,
  so no list payload repeats the text on every card. No-oracle posture holds:
  a username-only admin still answers 404 with no bio to leak.
- **More from this author (round 356)**: a reader who just finished and loved
  one post used to have no in-place path to the writer's other work — the
  related-posts block is topic-shaped (category/tags), and the archive was a
  click away but left the article. Every post by a pen-named writer now ends
  with a "More from {author}" strip: up to four of the writer's other recent
  posts (newest-first, the post being read excluded so it never re-links
  under itself) with a "All posts by {author}" door to the archive. Built on
  the existing public author-archive endpoint (no backend change) — the
  person-shaped discovery surface that rounds 353-355 followed, made
  browsable at the very moment of enjoyment.
- **Follow a writer from their archive (round 355)**: the author follow
  (round 353) lived on post bylines and in `/account`, but not on the page
  where a reader actually decides about a writer — the public `/authors/{id}`
  archive. Its header already offered an RSS subscribe link; now signed-in
  readers get the same in-app follow (new-post inbox + Web Push + a place in
  the `/follows` feed) right next to it, one click, with the full
  guest-hidden / stale-session / failure semantics the byline control already
  has. Reusing that component also fixes a genuine dead end: a writer with
  nothing published yet has no byline buttons anywhere, so the archive was
  the only place that follow could exist at all.
- **Followed authors enter the follows feed (round 354)**: round 353 let a
  reader follow a writer, but that follow had no browsing surface — only the
  mixed notification inbox showed the writer's new posts. Now the author
  follow pays the same discovery payoff as the topic follows: the `/follows`
  feed and the home "Latest from your follows" row (they share the same
  endpoint) include every recent post from a followed writer, deduped with the
  category/series/tag matches, newest-first as always, and authored cards
  carry the writer's pen-name byline (a `lucide:user` chip) so you can see at
  a glance which posts you got for the person and which for the topic.
- **Author follow (round 353)**: on a multi-editor blog a reader who loved one
  writer's posts wants to follow just that person — a topic-shaped
  category/series/tag follow can't express it. Every post's author byline now
  carries a follow button (signed-in readers only): one click subscribes the
  reader to that writer's new posts; the followed-writers list in `/account`
  shows each author with its own notify toggle and unfollow; and every new
  post from that writer lands in the follower's inbox as a durable row plus a
  Web Push — the same fan-out shape as the topic follows, but scoped to a
  person. Unfollow stops the flow instantly, and only a pen-named writer is
  followable — a username-only admin answers the same 404 as an unknown id
  (the no-oracle posture the rest of the site already keeps).
- **Reader profile bio (round 352)**: a reader community is only as good as
  the people in it, and a profile made of a name, an avatar and a join date
  has nothing to say. Readers can now write a short "about me" in
  `/account` — plain text, one paragraph, capped at 500 chars — that renders
  under their display name on the public `/readers/{id}` page (alongside
  their approved comments and streak), completing the identity surface of a
  commenter readers actually get to know.
- **Per-post comment control (round 351)**: a blog lives a long time, and a
  post that draws every comment the internet has to offer — high-noise
  threads, stale evergreen content, a privacy-sensitive piece — now lets the
  operator close the door on that one post without deleting the conversation
  or disabling comments site-wide. A "Comments open / Comments closed" toggle
  in the post editor flips `posts.comments_enabled`; the public post keeps
  rendering its existing thread but replaces the comment form with a
  "Comments are closed" note, and the API refuses new comments with a clear
  403 (existing comments stay readable either way).
- **Slug-change redirects (round 350)**: when an operator re-slugs a post,
  series or static page, every URL that was already out in the wild — shared
  links, search results, RSS feeds, in-app bookmarks — used to dead-end at a
  404. Re-slugging now records a permanent redirect: the old URL keeps
  answering 404 through the API (the public surface stays no-oracle) but
  carries an `X-Redirect-To` header naming the canonical target, and the
  public site turns that into a true HTTP 301 — crawlers transfer link equity
  instead of wasting it, link-shares and bookmarks land on the new slug, and
  repeated renames never chain: A→B then B→C resolves A→C in one hop.
- **Admin "duplicate post" (round 349)**: an editor running repeat-shaped
  content (weekly digests, release notes, episode templates) had to hand-copy
  the previous post for every sibling. A "Duplicate" action on the admin posts
  list clones a post into a fresh draft — same content, excerpt, cover,
  category, tags, series membership and author attribution carried over, a new
  unique `{slug}-copy[-N]` slug derived, and every publication-metadata field
  cleared (unpublished, unscheduled, unpinned, zeroed views/likes) so the copy
  is a private draft that can neither leak nor announce itself — then the
  editor jumps straight into the new draft. No comments or notifications are
  copied.
- **Sitemap covers pages & authors (round 348)**: the sitemap grew with the
  site — `/pages/{slug}` (round 347) and the pen-named `/authors/{id}`
  archives + `/authors` index (rounds 343/346) are real, indexable pages, but
  the cached `/sitemap.xml` still only listed posts, series, categories and
  tags, so a freshly published privacy policy or writer archive was
  reachable-by-link yet invisible to crawlers. The sitemap now emits every
  published page (with `lastmod`; drafts stay out) and every pen-named
  writer's archive (username-only admins stay out, preserving no-oracle), and
  any page create/update/delete busts the feed cache so a publish reaches the
  sitemap on the next render, not after a TTL expiry.
- **Static pages CMS (round 347)**: a self-hosted blog is expected to speak
  for itself — privacy policy, terms, contact, changelog — but the only static
  page was a hardcoded `/about`, so a site owner needed a code change +
  redeploy for every such page. Admins can now create, publish and manage
  curated markdown pages from a dedicated `/admin/pages` manager (title +
  CJK-safe auto-slug + markdown body + published toggle, inline edit,
  publish/unpublish row toggle, delete with confirm) and they render publicly
  at `/pages/{slug}` through the same markdown pipeline as posts (code, math,
  mermaid, images). The public surface is no-oracle — an unpublished or
  unknown slug answers the same 404, so drafts can't be enumerated — and
  published pages are linked from the site footer, so a privacy policy or
  terms page is discoverable without a code deploy.
- **Public writers index (DEC-359, round 346)**: `/authors` was a one-page
  dead end before — a byline or archive link could take you to one writer, but
  there was nowhere listing every pen-named writer, so discovery on a
  multi-editor blog (and the top-level Authors nav item, which previously had
  no destination) fell back to memory. `/authors` is now an index: one card per
  pen-named writer with their published-post count, each card linking to that
  writer's archive — backed by a new anonymous, caching-friendly `GET
  /api/authors` that only ever lists writers with a public pen name (username-
  only admins stay invisible, preserving the no-oracle posture), plus a "All
  writers" back link on the archive page.
- **Per-author RSS feed (DEC-359, round 345)**: RSS consumers can now follow a
  single writer — `/authors/{id}` emits an autodiscovery `<link>` and a visible
  subscribe link to `/rss/authors/{id}.xml`, which serves exactly that
  pen-named writer's published posts on the same scoped-feed contract as the
  category/series feeds. Unknown ids and username-only admins answer the same
  404 as the archive page, so the feed cannot enumerate admins.
- **Admin post-editor author assignment (DEC-359/TASK-406)**: the post editor
  gains an author picker — any admin can attribute a post they wrote to
  another pen-named writer (or keep the default "the writing admin"); the
  editor pre-selects a post's stored author, and the public byline/archive
  follow the assigned writer. A dedicated `/api/admin/authors` endpoint
  (admin-auth, deliberately not superuser-only) exposes only pen names, so
  editors can assign authors without ever touching the credential-adjacent
  `/api/admin/users`.
- **Post author attribution (DEC-359)**: a multi-editor blog displayed posts,
  categories, series, tags — but never who wrote them: a post carried no
  author identity, no byline, and there was no way to browse one writer's
  published posts. Posts now carry an author, defaulted at create to the
  writing admin; admins get a public pen name — deliberately separate from the
  login username, which stays private (admin login is no-oracle, so publishing
  usernames would hand out the first half of a credential) — and every
  published post with a pen-named author shows a byline on the post page and
  the list cards, linking to `/authors/{id}`: a paginated archive of exactly
  that writer's published posts, titled by pen name even before they have
  published anything. Unknown ids and username-only admins answer the same 404,
  so the surface cannot enumerate admins.
- **Reader email change (DEC-357)**: the login email was immutable with no
  verification flow, so a reader whose address changed was stranded — per-event
  mail and the weekly digest went to the dead address and the only "fix" was
  deleting the account (total data loss). A signed-in reader can now switch
  login email from the account settings: enter the new address + current
  password, get a single-use verification email at the NEW address (60-minute
  expiry, request repeatable — a new request replaces a pending change), and
  open the link to swap the email, revoke every pre-change session (token
  version bump) and auto-sign in under the new address. The old address keeps
  working until the link is opened, a target taken by another account while
  pending is a 409, and no endpoint ever reveals whether an address belongs to
  an account.
- **Newsletter digest cadence (DEC-355)**: the guest newsletter (DEC-351) had
  exactly one cadence — one email per new post, so a high-volume blog filled a
  subscriber's inbox daily with no lighter option (reader accounts already had
  both per-event mail and a weekly digest, DEC-201/DEC-326). A guest subscriber
  can now choose the weekly digest instead: opt in at the footer form (a
  checkbox) or from the confirm page, and the weekly digest job — the same one
  that serves readers (one advisory lock, one SMTP session, the same rolling
  7-day window, after-delivery idempotency stamping) — sends one aggregated,
  site-language summary per week, deep-linked posts with the subscriber's own
  token unsubscribe footer. A digest subscriber is excluded from the per-post
  fan-out, so they get exactly the cadence they chose, never both. Per-post
  stays the default; the digest is opt-in like the reader schema.
- **Admin newsletter management (DEC-354)**: the guest newsletter (DEC-351) had
  no operator surface — an admin could not see who was subscribed, how many were
  confirmed vs pending, or remove an address. The admin section now lists every
  subscriber (email, confirmed/pending chip, subscription date) with a status
  filter, case-insensitive email search, pagination, and a per-row remove action
  (row + token gone, so a subsequently posted unsubscribe token is a 404 —
  indistinguishable from never-subscribed, no oracle). A newsletter with no
  management loop cannot serve an address someone else subscribed, a dead
  mailbox, or a subscriber who asked to be removed and lost their token — this
  page closes that loop.
- **Guest email newsletter (DEC-351)**: the blog's entire email surface (weekly
  digest, per-event emails, guest reply emails) was gated behind a reader
  account or a comment, so an anonymous visitor who just wanted "email me new
  posts" had no on-ramp other than RSS (a tool for technical readers). A
  footer form is now that on-ramp: any visitor enters an email address, gets a
  double opt-in confirmation link (the address receives NOTHING until it is
  clicked), and a confirmed subscriber is emailed once per new published post —
  deep-linked to the post, carrying a working per-subscriber unsubscribe link,
  in the site's configured language. The email is never an existence oracle
  (subscribe always answers with the same generic message, mirroring reader
  register), confirm/unsubscribe are idempotent with an unknown token 404
  (mirroring reply-notify), scheduled posts that cross publish_at surface the
  same exactly-once email via the fire-on-read sweep, and a mail failure never
  breaks the publish that triggered it (best effort, fail-closed without SMTP).
- **Server-trail "Continue reading" on the home page (DEC-348)**: the home
  Continue-reading row was a purely device-local localStorage trail — a signed-in
  reader on a new device saw an empty row even though the server-side reading
  trail held exactly what they left. The row now sources a signed-in reader's
  posts with a saved resume position from the server (newest-first), each link
  opening the post at the restored spot, so continue-reading works across
  devices exactly where the resume trail lives. The server trail wins over the
  device-local row; guests keep the lightweight local trail unchanged.
- **Cross-device resume reading (DEC-346)**: the resume position was an
  absolute pixel offset saved against one device's layout — a reader who left
  off at 900px on a desktop returns and instantly finds themselves "900px" is
  a different place on their phone. The post page now also saves the position
  as a 0..1 fraction of the scrollable document height (`scroll_fraction`,
  alongside `scroll_position`) and prefers it on restore, converting it for
  the current viewport — so a phone→desktop (or any size) continuation lands
  at the same spot. Pre-feature rows keep working via the pixel fallback, and
  the back-to-top clear wipes both values.
- **Scheduled-post sweep on every surface (DEC-344)**: the fire-on-read
  announcement for crossed scheduled posts (DEC-336) covered the post list,
  post detail, and sitewide feeds — but other surfaces that show a just-live
  post (`/follows`, the follower's own aggregate feed; search; category/series
  feeds; the sitemap) did not trigger it, so a follower who watches `/follows`
  could see the post appear with no push/inbox/email. Every such surface now
  fires the same exactly-once fan-out, so no follower loses the notification
  no matter where they look.
- **Site-language guest & recovery emails (DEC-342)**: the reader-side emails
  were localized per reader (DEC-338/DEC-340), but the sender-side ones were
  still hardcoded Chinese — the guest reply email (a visitor with no account
  got 有人回复了你的评论) and the password reset email (a bilingual subject with
  a fully Chinese body, and a hardcoded "X-Blog" instead of the site's name).
  Both now render in the site's configured language (`SITE_LANGUAGE`, default
  zh preserves the existing copy) and the reset email uses the configured
  `SITE_TITLE` — an English-configured site now sends English, correctly-named
  guest and recovery emails everywhere.
- **Reader-language reply/thread/mention copy (DEC-340)**: the reader-locale
  story (DEC-338) covered only new-post notifications — an English reader got
  an English "New post" email while the reply / followed-thread / @-mention
  rows and emails stayed hardcoded Chinese. The remaining kinds are now
  localized per reader too: an English reader gets "Someone replied to your
  comment", "New comment in a thread you follow", and "You were mentioned in a
  comment" (with the commenter's label) inbox rows and emails the moment they
  switch, in the same batch as a Chinese reader keeping 有人回复了你的评论 /
  你订阅的讨论有新评论 / 有人在评论中提到了你. Browser-push payloads stay the
  operator-global copy (a single payload can't vary per reader browser).
- **Reader-language notification copy (DEC-338)**: notification copy was
  hardcoded Chinese for every reader — durable inbox titles (系列更新 /
  新文章发布 / 《…》), the per-event email Subject + body, and the weekly digest
  were all zh regardless of the reader's UI language or the site's. A signed-in
  reader's language switcher now persists their locale (new `PUT
  /api/reader/me/locale`), and the fan-out renders each reader's copy in their
  language: an English reader gets English "New post" / "Series update" inbox
  rows, emails, and digest from the moment they switch, while a reader who
  never switches (or any existing reader) keeps the zh copy unchanged — the
  locale column is additive and NULL reads as the site default.
- **Scheduled posts notify followers when they go live (DEC-336)**: a post
  written as published-but-future `publish_at` is a first-class editorial-calendar
  affordance, but the new-post fan-out only ran at WRITE time when the post was
  already visible — so the moment the clock crossed `publish_at` and the post
  became public, nobody got a push, durable inbox row, or email for it (there is
  no background scheduler to notice the crossing). A new fire-on-read sweep
  (`crud.maybe_notify_due_scheduled_posts`) announces every crossed-but-unannounced
  post exactly once, on the first public read that surfaces it (post list, post
  detail, RSS/Atom feeds — an external feed poller is the most reliable trigger);
  the same durable `new_post_notified_at` stamp is set by the write-time paths
  (create/update/restore/admin editor), so a post can never be notified twice.
  Exactly-once even under concurrent workers, and retroactive: a scheduled post
  that already crossed before this shipped is announced on its next public read.
- **Complete reader data export (DEC-334)**: `GET /api/reader/me/export` is the
  GDPR-style "download my data" bundle, but it shipped only
  account/bookmarks/comments/history — a reader couldn't recover their follows,
  notification preferences, inbox history, or device registrations. The bundle
  now adds `follows` (categories/tags/series with their notify flags),
  `notification_prefs`, `notifications` (the durable inbox rows), and
  `push_subscriptions` (endpoints + created_at — never the cryptographic keys).
  Cross-reader data and draft/scheduled-post leakage invariants unchanged;
  contract tests cover a fully-populated reader through the real API.
- **Guest commenter reply-email (DEC-332)**: the comment form REQUIRES an
  anonymous commenter to leave an email, and that email was stored on the
  comment row but never used — the reply-notify guard was
  `parent.reader_id is not None`, so a reply to an anonymous comment notified
  nobody, in every channel. A guest who ticks the new "email me when someone
  replies" consent (default off) now receives one email when a reply to their
  comment is approved, deep-linking to the exact reply and carrying a
  per-comment unsubscribe link; a guest who never opted in (or later
  unsubscribed) is never emailed, and approval still succeeds when SMTP is
  unconfigured (best effort, like every other notification path). Additive —
  `reply_notify_email` + `reply_notify_token` on `comments` (DEC-009) — with a
  public `POST /api/comments/reply-notify/unsubscribe` (idempotent; unknown
  token 404; the landing page tells a spent/unknown link apart from a network
  outage, so the holder of a still-valid token isn't told their link is dead)
  and a `/comment-reply-unsubscribe?token=` landing page. Backend contract
  tests (opt-in email fires on approval with deep link + token; no consent /
  no email / reader-parent → reader fan-out only; self-reply skip; unsubscribe
  stops later mail; unknown token 404; unconfigured SMTP no-op; token/consent
  never on the public thread list), CommentForm checkbox unit tests, the
  unsubscribe page test, and an e2e journey through the SMTP sink.
- **Email copy of @-mentions (DEC-326)**: the @-mention fan-out (DEC-322) only
  reached the durable inbox and the browser push, so a reader who relies on the
  opt-in email channel (DEC-197) never heard about the single most personal
  notification — being called out by name. Mention dispatch now also sends the
  email when the reader opted into the new per-kind `email_mention` preference
  (off by default like the other email kinds), gated independently of the
  in-app mention toggle (a reader can mute the inbox row and still get the
  email, or vice versa); the email carries the same title/body/deep link as the
  inbox row. Additive `email_mention` column on `reader_notification_prefs`
  (DEC-009). Backend contract tests (email off by default but inbox still
  lands; email on sends to the registered address; email survives an in-app
  mention opt-out; pref toggle round-trip; prefs surface exposes the new kind)
    - a frontend page test for the new preferences row.
- **@-mention autocomplete (DEC-324)**: an approved comment could @-mention a
  reader (DEC-322), but the commenter had to type the exact display name from
  memory — zero discovery, so the capability was near-unusable in practice.
  Typing `@` in the comment box now opens a suggestion list of active readers
  whose display name matches what follows (prefix matches ranked first,
  substring after, bounded to 8 results), served by a new public
  `GET /api/readers/suggest` returning only id + display name + avatar (never
  the email). Arrow/Enter/Escape and click all work; picking a suggestion
  inserts `@<display name>` at the caret so the submitted comment really
  mentions that reader. Backend contract tests (substring + prefix ranking,
  LIKE wildcard escaping, inactive/nameless readers excluded, bounded results,
  no email/PII), CommentForm picker unit tests (open/move/insert/escape/no-
  results), and an e2e (type `@pick` → picker → pick → submit → approve → the
  named reader's inbox gains the mention row). No DDL.
- **@-mention notifications (DEC-322)**: when an approved comment names a
  reader's display name (e.g. `@Riki`), that reader now gets an inbox
  notification deep-linking to the exact comment. Before this there was no way
  to call a specific person into a discussion — you could only reply to a
  comment or hope a reader followed the thread/category. The fan-out runs at
  moderation time (a pending comment notifies nobody), skips the commenter
  themselves, respects the reader's per-kind opt-out, and matches names at word
  boundaries (`@Riki` never notifies a reader named `Ri`). The new kind is
  `mention`: an opt-out inbox/`@`-mention preference on by default like the
  other in-app kinds (consistent with DEC-171), backed by an additive
  `mention` column on `reader_notification_prefs` (DEC-009 DDL-preserving; the
  `ReaderNotification.kind` field is a `String`, so the new kind needs no
  notification-table DDL). Backend contract tests (dispatch, self-mention skip,
  disabled preference, deactivated reader, boundary matching, batched scan),
  frontend page tests (kind label + preference toggle), and an e2e journey (a
  guest comment `@<name>` → admin approve → the named reader's inbox shows the
  `mention` row and its `#comment-<id>` link lands).
- **Comment-history deep links (DEC-321)**: the /comments page and public reader
  profiles linked each comment back to its post's HEADLINE, so a reader hunting
  their own (or a profile's) comment landed at the top of the thread. The "on
  post" jump now carries the `#comment-<id>` anchor — the post page's comment
  list landing machinery (already proven by reply-notification deep links,
  DEC-072) scrolls the reader to the exact comment. Frontend-only: two `NuxtLink`
  targets (`app/pages/comments.vue`, `app/pages/readers/[id].vue`); page unit
  tests + an e2e journey (comment → approve → `/comments` → click → lands on
  `#comment-<id>`).
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

# X-Blog

<div align="center">

![Nuxt](https://img.shields.io/badge/Nuxt-4-0F172A?style=for-the-badge&logo=nuxt)
![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009989?style=for-the-badge&logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python)

A modern full-stack blog engine: a **FastAPI + SQLAlchemy 2** backend and a **Nuxt 4 + Vue** frontend, driven end-to-end by `just`. Highlights: an installable PWA with offline reading of saved posts, cloud-synced reader data, a full notification stack, and a local CI gate that mirrors the pipeline.

[English](./README.md) · [中文](./README.zh-CN.md)

</div>

## ✨ Features

**Publishing & content**

- Markdown posts with code highlighting, Mermaid diagrams, and KaTeX math
- Tags, categories, **series** (ordered multi-part), pinned posts, and a static-pages CMS
- Editorial calendar with scheduled publishing and exactly-once fan-out; one-click duplicate-post seeding; per-post comment control
- Slug-change **301 redirects**, so re-slugging never orphans an old URL

**Reader experience**

- Cloud-synced **bookmarks** (with a To-read/Done queue) and **likes**, plus liked-posts lists
- Reading history: streaks, a 52-week heatmap, resume-reading, insights, and per-day trends
- Follow categories, tags, series, authors, and readers — each with a durable inbox + push + email

**Engagement & notifications**

- Nested, moderated comments with live preview, image lightbox, and @-mention autocomplete
- Email reply/thread/newsletter + weekly digest, per-kind preferences, and guest opt-in
- Optional Web Push (needs VAPID keys) and admin moderation alerts

**Identity & privacy**

- Reader accounts with **2FA (TOTP)**, password reset, email change, and GDPR-style data export
- Public reader profiles, avatars, bios, opt-in public liked/saved lists, and reader blocks

**Admin, SEO & PWA**

- Admin dashboard, media library, JSON backup/restore, CSV export
- Full-text + comment search, RSS/Atom feeds, sitemap, Open Graph / JSON-LD
- **Installable PWA** with offline reading of saved posts (service worker)

## 🚀 Getting Started

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

### Install & seed

```bash
just install   # cd backend/nova && uv sync; also installs git hooks (just hooks)
just init-db   # seed the dev DB with sample data (admin/admin123)
```

### Run

```bash
just backend   # FastAPI (uvicorn) on :18888
just nuxt      # Nuxt dev server on :34567   (alias: just frontend)
just dev       # both — on Windows run the two in separate terminals
just e2e       # Playwright e2e against a live Nuxt server (auto-starts backend + Nuxt)
```

## 🔒 Development & Quality Gates

- **`just ci`** is the local mirror of CI's runnable gate:
  `fmt-check lint typecheck audit migrate-check rumdl-check test frontend-build`.
- The backend suite is gated at **80% app coverage** (`just test-backend` →
  `pytest -n auto --cov-fail-under=80`); don't weaken it.
- Git hooks (`just hooks`): **pre-commit** runs ruff / ty / rumdl / uv-lock /
  frontend-lint; **pre-push** runs the full `just ci`.
- `ty` (type-checking), `ruff`, and `rumdl` are **global `uv tool` installs**, not
  project dependencies.
- PostgreSQL parity is verified via `just test-backend-postgres [workers]` with
  `TEST_DATABASE_URL`.

## 🛠️ Common Commands

| Command                                                  | Description                                  |
| -------------------------------------------------------- | -------------------------------------------- |
| `just install` / `just hooks`                            | Install deps / git hooks                     |
| `just backend` / `just nuxt` (`dev`)                     | Dev servers (:18888 / :34567)                |
| `just init-db`                                           | Seed dev DB (admin/admin123)                 |
| `just e2e`                                               | Playwright e2e against a live server         |
| `just test-backend` / `just test-nuxt`                   | Backend (80% coverage gate) / frontend tests |
| `just lint` / `just fmt-check` / `fix`                   | Ruff lint / format-check / auto-fix          |
| `just typecheck`                                         | `ty` type checking                           |
| `just audit`                                             | `uv audit` — dependency vulnerabilities      |
| `just migration` / `just migrate` / `just migrate-check` | Alembic autogenerate / upgrade / drift check |
| `just rumdl` / `just rumdl-check`                        | Format / check markdown                      |
| `just frontend-build`                                    | Nuxt `pnpm build`                            |
| `just ci`                                                | Full local CI gate                           |

Also available: `just test-nuxt-coverage`, `just test-backend-postgres [N]`,
`just test-backend-seq`, `just clean`, `just migration-history`. Run `just --list`
for everything.

## 📡 API Reference

Core routes are summarized below; the full contract lives in
`backend/nova/app/routers/`.

| Method | Endpoint                          | Description                         |
| ------ | --------------------------------- | ----------------------------------- |
| GET    | `/api/posts`                      | List posts (paginated)              |
| GET    | `/api/posts/{slug}`               | Get post by slug                    |
| POST   | `/api/posts`                      | Create post (admin)                 |
| PUT    | `/api/posts/{id}`                 | Update post (admin)                 |
| DELETE | `/api/posts/{id}`                 | Delete post (admin)                 |
| POST   | `/api/posts/{id}/like`            | Like a post                         |
| POST   | `/api/posts/{id}/view`            | Increment view count                |
| GET    | `/api/series`                     | List series (with post counts)      |
| GET    | `/api/series/{slug}`              | Series detail with ordered posts    |
| POST   | `/api/series`                     | Create series (admin)               |
| GET    | `/api/comments/post/{id}`         | Approved comments for a post        |
| POST   | `/api/comments/post/{id}`         | Create a comment (moderation-gated) |
| DELETE | `/api/comments/{id}`              | Delete comment (admin)              |
| PATCH  | `/api/comments/{id}/approve`      | Approve / reject (admin)            |
| GET    | `/rss/feed.xml` / `/rss/atom.xml` | Site-wide RSS / Atom feeds          |
| GET    | `/rss/comments.xml` / `.atom.xml` | Latest discussion feeds             |
| GET    | `/sitemap.xml` / `/robots.txt`    | SEO                                 |
| GET    | `/health`                         | Health check                        |

Comments are moderation-gated (new comments must be approved). A signed-in
reader comments under their verified account identity — the backend stamps the
account's display name (client-supplied identity is ignored), and anonymous
commenters keep the free-text nickname/email path.

### Reader & admin

| Method               | Endpoint                            | Description                                        |
| -------------------- | ----------------------------------- | -------------------------------------------------- |
| POST                 | `/api/reader/register`              | Create a reader account (returns a reader JWT)     |
| POST                 | `/api/reader/login`                 | Reader login (email + password)                    |
| GET                  | `/api/reader/me`                    | Current reader profile                             |
| GET                  | `/api/reader/me/bookmarks`          | Cloud-synced bookmarks (optional `done` filter)    |
| PUT / PATCH / DELETE | `/api/reader/me/bookmarks/{id}`     | Add / set done / remove a bookmark                 |
| GET                  | `/api/reader/me/comments`           | Reader's comments (optional `q` content filter)    |
| GET                  | `/api/reader/me/notifications`      | Durable notification inbox (read/unread)           |
| GET                  | `/api/reader/me/history/{post_id}`  | Saved resume position for a post                   |
| POST                 | `/api/reader/me/history/{post_id}`  | Record a view / save the scroll offset             |
| POST                 | `/api/admin/login`                  | Admin login                                        |
| GET                  | `/api/admin/stats`                  | Dashboard analytics                                |
| GET                  | `/api/admin/calendar?month=YYYY-MM` | Editorial calendar                                 |
| POST                 | `/api/upload`                       | Upload an image                                    |
| GET                  | `/api/upload/files`                 | Media library — list uploads with reference status |
| GET                  | `/api/search?q=`                    | Full-text search (CJK-aware)                       |
| GET                  | `/api/export/posts.csv`             | Export posts (admin)                               |

Web push is opt-in and off until `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are set
(see `backend/nova/.env.example`); without them push endpoints fail closed with 503.

## 🏗️ Architecture

![Architecture Diagram](./docs/x-blog-architecture.png)

> 📁 [Interactive HTML version](./docs/x-blog-architecture.html) — open locally in a
> browser for zoom/pan. Covers the Nuxt frontend, FastAPI backend, SQLite DB, JWT auth,
> admin zone, and DevOps tooling.

## 🗂️ Project Structure

```text
x-blog/
├── backend/nova/            # FastAPI backend (Python 3.14, uv)
│   ├── app/                 # main.py, config, models, schemas
│   │   ├── repositories/    # data-access layer (async SQLAlchemy)
│   │   ├── services/        # business-orchestration layer
│   │   └── routers/         # thin HTTP shells (validation, rate limits)
│   ├── migrations/          # Alembic migrations
│   ├── tests/               # pytest suite
│   └── pyproject.toml       # Python config
├── frontend/aura/           # Nuxt 4 + Vue app (pnpm)
│   ├── app/                 # pages, layouts, plugins
│   ├── components/          # Vue components
│   ├── composables/         # composables (useApi, useI18n, useOfflineBookmarks, …)
│   ├── server/              # server routes (RSS, sitemap, …)
│   ├── public/              # static assets + service worker (sw.js)
│   ├── tests/               # unit tests
│   ├── e2e/                 # Playwright e2e tests
│   └── package.json
├── docs/                    # guides (deployment, security, …)
├── justfile                 # task runner (recommended entry point)
└── .rumdl.toml              # markdown lint config
```

## 🧰 Tech Stack

- **Backend**: [FastAPI](https://fastapi.tiangolo.com/) · [SQLAlchemy 2](https://www.sqlalchemy.org/) (async) · [Pydantic](https://docs.pydantic.dev/) · [pytest](https://pytest.org/)
- **Frontend**: [Nuxt 4](https://nuxt.com/) + [Vue 3](https://vuejs.org/) · [Tailwind CSS v4](https://tailwindcss.com/) · [Vitest](https://vitest.dev/) · [Playwright](https://playwright.dev/)
- **Tooling**: [uv](https://github.com/astral-sh/uv) · [pnpm](https://pnpm.io/) · [just](https://github.com/casey/just) · [ruff](https://docs.astral.sh/ruff/) · `ty` · [rumdl](https://github.com/astral-sh/rumdl)

## 🗄️ Docker Deployment

```bash
git clone https://github.com/pplmx/x-blog.git && cd x-blog
cp backend/nova/.env.example backend/nova/.env
docker-compose up -d
```

See [docs/deployment.md](./docs/deployment.md) for full deployment options.

## 🤝 Contributing

1. Fork the repo and create a feature branch (`git checkout -b feature/...`)
2. Ensure everything passes: `just ci`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (`type(scope): subject` + bulleted body)
4. Push and open a Pull Request

Run `just hooks` after cloning so the pre-commit/pre-push gates are active.

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ using FastAPI + Nuxt

</div>

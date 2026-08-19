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
- 🎨 **Beautiful UI** - Clean design with Tailwind CSS v4
- 📱 **Responsive** - Mobile-friendly responsive layout
- 🔒 **Admin Panel** - Built-in admin dashboard for content management
- 🧪 **Well Tested** - 912 tests (475 backend + 437 Nuxt), 85% backend coverage
- ✅ **Type Safe** - Full TypeScript support + Pydantic validation
- 🔍 **Full-text Search** - Post search functionality
- 🌙 **Dark Mode** - System preference aware dark mode
- 📊 **Reading Analytics** - View counts, like counts, reading progress
- 💬 **Comments** - Nested comment support with replies
- 🏷️ **Tags & Categories** - Organize posts with tags and categories
- 📚 **Series** - Group posts into ordered multi-part sequences with in-series prev/next navigation
- 🔖 **Cloud Bookmark Sync** - Reader accounts keep your bookmarks synced across devices (sign in → local bookmarks merge to the cloud)
- 🎯 **SEO Optimized** - Open Graph, JSON-LD structured data
- ⬆️ **Pinned Posts** - Pin important posts to top
- 📤 **Data Export** - Export posts/comments as CSV

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

| Method | Endpoint                       | Description           |
| ------ | ------------------------------ | --------------------- |
| GET    | `/api/comments/post/{id}`      | Get approved comments |
| POST   | `/api/comments/post/{id}`      | Create comment        |
| DELETE | `/api/comments/{id}`           | Delete comment (admin)|
| PATCH  | `/api/comments/{id}/approve`   | Approve/reject (admin)|

### Admin

| Method | Endpoint                       | Description             |
| ------ | ------------------------------ | ----------------------- |
| POST   | `/api/admin/login`             | Admin login             |
| GET    | `/api/admin/stats`             | Dashboard analytics     |
| GET    | `/api/posts?all=true`          | List all (incl. drafts) |
| GET    | `/api/comments?approved=false` | List pending comments   |
| PATCH  | `/api/comments/{id}/approve`   | Approve comment         |
| POST   | `/api/upload`                  | Upload image            |
| GET    | `/api/export/posts.csv`        | Export posts (admin)    |
| GET    | `/api/export/comments.csv`     | Export comments (admin) |

### Search, SEO & Stats

| Method | Endpoint              | Description                    |
| ------ | --------------------- | ------------------------------ |
| GET    | `/api/search?q=`      | Full-text search               |
| GET    | `/api/stats`          | Blog statistics                |
| GET    | `/rss/feed.xml`       | RSS 2.0 feed                   |
| GET    | `/rss/atom.xml`       | Atom feed                      |
| GET    | `/sitemap.xml`        | XML sitemap                    |
| GET    | `/robots.txt`         | robots.txt                     |
| GET    | `/health`             | Health check                   |

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

### Reader Accounts & Cloud Bookmark Sync

Reader accounts are the identity layer for cloud-synced bookmarks (audience-
separated from admin JWTs; see `docs/security.md`). Registration is rate-
limited (default 5/min/IP).

| Method | Endpoint                        | Description                                                |
| ------ | ------------------------------- | ---------------------------------------------------------- |
| POST   | `/api/reader/register`          | Create a reader account (returns a reader JWT, auto-login) |
| POST   | `/api/reader/login`             | Reader login (email + password)                            |
| GET    | `/api/reader/me`                | Current reader profile                                     |
| GET    | `/api/reader/me/bookmarks`      | Cloud-synced bookmark list (publicly-visible posts only)   |
| PUT    | `/api/reader/me/bookmarks/{id}` | Add a bookmark (idempotent: 201 new / 200 already)         |
| DELETE | `/api/reader/me/bookmarks/{id}` | Remove a bookmark (idempotent 204)                         |

Bookmarks are stored localStorage-first on the browser and merged to the cloud
when a reader signs in — offline changes survive and re-concile on the next
login. Reader bookmarks never appear in shared caches (`Cache-Control:
no-store`).

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
│   ├── tests/              # pytest tests (475 tests)
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

- Backend: 475 tests (pytest + pytest-xdist), 85% coverage
- Nuxt (frontend): 437 tests (Vitest)
- **Total: 912 tests, 0 failures**

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

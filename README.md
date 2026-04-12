# X-Blog

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009989?style=for-the-badge&logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python)

A modern full-stack blog application built with FastAPI + Next.js

[English](./README.md) · [中文](./README.zh-CN.md)

</div>

## ✨ Features

- 🚀 **Modern Tech Stack** - Next.js 16, FastAPI, TypeScript, Python 3.14
- 📝 **Markdown Support** - Write posts in Markdown with live preview
- 🎨 **Beautiful UI** - Clean design with Tailwind CSS + shadcn/ui
- 📱 **Responsive** - Mobile-friendly responsive layout
- 🔒 **Admin Panel** - Built-in admin dashboard for content management
- 🧪 **Well Tested** - pytest (backend) + Vitest (frontend)
- ✅ **Type Safe** - Full TypeScript support + Pydantic validation
- 🐳 **Docker Ready** - Docker + Docker Compose support
- ☁️ **Cloud Ready** - CI/CD with GitHub Actions

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.14+ | [uv](https://github.com/astral-sh/uv) |
| Node.js | 24+ | [Node.js](https://nodejs.org/) |
| pnpm | 10+ | `npm install -g pnpm` |
| Docker | 24+ | [Docker](https://docker.com) |

```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Installation

```bash
# Install all dependencies
pnpm install

# Or manually:
cd backend && uv sync
cd frontend && pnpm install
```

### Development

```bash
# Run both backend and frontend
pnpm dev

# Or run separately:
just backend  # http://localhost:8000
just frontend # http://localhost:3000
```

### 🐳 Docker Deployment

```bash
# Clone and start
git clone https://github.com/your-username/x-blog.git
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

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Run dev servers (backend + frontend) |
| `pnpm backend` | Run FastAPI server |
| `pnpm frontend` | Run Next.js dev server |
| `pnpm lint` | Lint code (ruff + biome) |
| `pnpm format` | Format code |
| `pnpm test` | Run tests |
| `pnpm clean` | Clean generated files |

## 📡 API Endpoints

### Posts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/posts` | List posts |
| GET | `/api/posts/{id}` | Get post by ID |
| POST | `/api/posts` | Create post |
| PUT | `/api/posts/{id}` | Update post |
| DELETE | `/api/posts/{id}` | Delete post |

### Categories & Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List categories |
| GET | `/api/tags` | List tags |

## 🏗️ Project Structure

```
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
│   ├── tests/              # pytest tests
│   └── pyproject.toml      # Python config
│
├── frontend/               # Next.js frontend
│   ├── app/
│   │   ├── page.tsx        # Home page
│   │   ├── admin/          # Admin dashboard
│   │   ├── posts/          # Post pages
│   │   └── about/          # About page
│   ├── components/         # React components
│   │   ├── ui/             # shadcn/ui components
│   │   └── *.tsx
│   ├── lib/                # Utilities & API client
│   ├── types/              # TypeScript types
│   └── package.json
│
├── docs/                   # Design docs
├── .husky/                 # Git hooks
├── justfile                # Task runner
└── package.json            # Root config
```

## 🧰 Tech Stack

### Backend

- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- **ORM**: [SQLAlchemy](https://www.sqlalchemy.org/) - Database ORM
- **Validation**: [Pydantic](https://docs.pydantic.dev/) - Data validation
- **Testing**: [pytest](https://pytest.org/) - Python testing

### Frontend

- **Framework**: [Next.js 16](https://nextjs.org/) - React framework
- **UI**: [shadcn/ui](https://ui.shadcn.com/) - UI components
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) - CSS framework
- **Forms**: [React Hook Form](https://react-hook-form.com/) - Form handling
- **Testing**: [Vitest](https://vitest.dev/) - Unit testing

### DevOps

- **Package Managers**: [uv](https://github.com/astral-sh/uv) (Python), [pnpm](https://pnpm.io/) (Node.js)
- **Linting**: [ruff](https://docs.astral.sh/ruff/) (Python), [Biome](https://biomejs.dev/) (JS/TS)
- **Git Hooks**: [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged)
- **Commits**: [Commitlint](https://commitlint.js.org/) - Conventional commits

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🚀 Deployment Guide

See [Deployment Guide](./README.deploy.md) for detailed instructions on:
- Local development setup
- Docker production deployment
- Separated backend/frontend deployment
- Environment configuration

---

<div align="center">

Built with ❤️ using FastAPI + Next.js

</div>
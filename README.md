# X-Blog

A modern blog built with FastAPI + Next.js.

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, Pydantic, uv
- **Frontend**: Next.js 14, React 18, Tailwind CSS, pnpm
- **Linting**: ruff (backend), ESLint + Prettier (frontend)

## Quick Start

### Prerequisites

- Python 3.14+
- Node.js 25+
- [uv](https://github.com/astral-sh/uv) - `pip install uv`
- [pnpm](https://pnpm.io/) - `npm install -g pnpm`

### Installation

```bash
# Install all dependencies
make install
# Or manually:
cd backend && uv sync
cd frontend && pnpm install
```

### Development

```bash
# Run both backend and frontend
make dev

# Or run separately:
make backend  # http://localhost:8000
make frontend # http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `make install` | Install all dependencies |
| `make dev` | Run both services |
| `make backend` | Run FastAPI server |
| `make frontend` | Run Next.js dev server |
| `make lint` | Lint both projects |
| `make format` | Format code |
| `make test` | Run backend tests |
| `make clean` | Clean generated files |

## API Endpoints

- `GET /api/posts` - List posts
- `GET /api/posts/{id}` - Get post
- `POST /api/posts` - Create post
- `PUT /api/posts/{id}` - Update post
- `DELETE /api/posts/{id}` - Delete post
- `GET /api/categories` - List categories
- `GET /api/tags` - List tags

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py       # FastAPI app
│   │   ├── config.py     # Settings
│   │   ├── database.py   # DB connection
│   │   ├── models.py     # SQLAlchemy models
│   │   ├── schemas.py    # Pydantic schemas
│   │   ├── crud.py       # Database operations
│   │   └── routers/      # API routes
│   └── tests/            # Unit tests
├── frontend/
│   ├── app/              # Next.js App Router
│   ├── components/       # React components
│   ├── lib/              # API client
│   └── types/            # TypeScript types
└── Makefile              # Convenience commands
```
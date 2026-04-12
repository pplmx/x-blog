# X-Blog Just Commands

# Install all dependencies
install:
    cd backend && uv sync
    pnpm --filter x-blog-frontend install

# Run both backend and frontend (Windows: run in two terminals)
# Terminal 1: just backend
# Terminal 2: just frontend
dev:
    @echo "⚠️ Windows 用户请在两个终端分别运行:"
    @echo "  just backend"
    @echo "  just frontend"
    @echo ""
    @echo "或使用 VS Code / IntelliJ 的 Run Dashboard"
    cd backend && uv run uvicorn app.main:app --reload --port 8000 &
    pnpm --filter x-blog-frontend dev

# Run backend only
backend:
    cd backend && uv run uvicorn app.main:app --reload --port 8000

# Run frontend only
frontend:
    pnpm --filter x-blog-frontend dev

# Lint code
lint:
    cd backend && uvx ruff check . --fix
    pnpm --filter x-blog-frontend lint

# Format code
format:
    cd backend && uvx ruff format .
    pnpm --filter x-blog-frontend format

# Run all tests
test: test-backend test-frontend

# Run backend tests
test-backend:
    cd backend && uv run pytest

# Run frontend tests
test-frontend:
    cd frontend && pnpm test

# Run frontend tests with coverage
test-frontend-coverage:
    cd frontend && pnpm test:coverage

# Clean generated files
clean:
    rm -f backend/*.db
    rm -rf frontend/.next
    rm -rf backend/.pytest_cache
    rm -rf .ruff_cache backend/.ruff_cache
    rm -rf frontend/node_modules/.vite
    rm -rf frontend/coverage

# Initialize database with sample data
init:
    cd backend && uv run python scripts/init_db.py
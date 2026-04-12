# X-Blog Just Commands

# Install all dependencies and git hooks
install:
    cd backend && uv sync
    cd frontend && pnpm install

# Install git hooks
hooks:
    @echo "Installing git hooks..."
    uv tool install prek
    uv tool install rumdl
    uv tool install ruff
    prek install --hook-type commit-msg --hook-type pre-push
    @echo "✓ Git hooks installed"

# Initialize database with sample data
init-db:
    cd backend && uv run python scripts/init_db.py

# Run both backend and frontend (Windows: run in two terminals)
# Terminal 1: just backend
# Terminal 2: just frontend
dev:
    @echo "⚠️ Windows 用户请在两个终端分别运行:"
    @echo "  just backend"
    @echo "  just frontend"
    @echo ""
    @echo "或使用 VS Code / IntelliJ 的 Run Dashboard"
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
    cd frontend && pnpm dev

# Run backend only
backend:
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Run frontend only
frontend:
    cd frontend && pnpm dev

# Lint code
lint:
    cd backend && uvx ruff check . --fix
    cd frontend && pnpm lint
    rumdl fmt

# Format code
format:
    cd backend && uvx ruff format .
    cd frontend && pnpm format

# Format check (CI style)
fmt-check:
    cd backend && uvx ruff format --check .
    cd frontend && pnpm format --check

# Auto-fix issues
fix:
    cd backend && uvx ruff check . --fix
    cd backend && uvx ruff format .
    cd frontend && pnpm lint --write
    cd frontend && pnpm format
    rumdl fmt

# CI: run all checks
ci: fmt-check lint test

# Run all tests
test: test-backend test-frontend

# Run backend tests
test-backend:
    cd backend && uv run pytest -n auto

# Run backend tests sequentially (debug)
test-backend-seq:
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

# Lint and format markdown
rumdl:
    rumdl fmt

# Show help
default:
    @just --list
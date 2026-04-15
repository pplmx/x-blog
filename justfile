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
    cd frontend && pnpm biome check --write
    rumdl fmt

# Format code
format:
    cd backend && uvx ruff format .
    cd frontend && pnpm biome format --write

# Format check (CI style)
fmt-check:
    cd backend && uvx ruff format --check .
    cd frontend && pnpm biome ci
    rumdl fmt

# Auto-fix issues
fix:
    cd backend && uvx ruff check . --fix
    cd backend && uvx ruff format .
    cd frontend && pnpm biome check --write
    cd frontend && pnpm biome format --write
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

# Run e2e tests (requires just dev running in separate terminals)
# Or use: just test-e2e for self-contained mode
test-e2e:
    cd frontend && pnpm test:e2e

# Run e2e tests against live dev servers (auto-starts backend + frontend)
e2e:
    @echo "Starting backend..."
    cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
    @sleep 3 && curl -sf http://localhost:8000/health > /dev/null || (echo "Backend failed to start" && exit 1)
    @echo "Starting frontend..."
    cd frontend && pnpm dev &
    @sleep 5 && curl -sf http://localhost:3000 > /dev/null || (echo "Frontend failed to start" && exit 1)
    @echo "Running e2e tests..."
    cd frontend && pnpm playwright test
    @echo "Stopping services..."
    @pkill -f "uvicorn app.main:app" 2>/dev/null; pkill -f "next dev" 2>/dev/null; echo "done"

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

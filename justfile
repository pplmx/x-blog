# X-Blog Just Commands

# Install all dependencies and git hooks
install:
    cd backend/nova && uv sync
    cd frontend/aura && pnpm install

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
    cd backend/nova && uv run python scripts/init_db.py

# Run both backend and frontend (Windows: run in two terminals)
# Terminal 1: just backend
# Terminal 2: just nuxt
dev:
    @echo "⚠️ Windows 用户请在两个终端分别运行:"
    @echo "  just backend"
    @echo "  just nuxt        (Nuxt on :13334)"
    @echo ""
    @echo "或使用 VS Code / IntelliJ 的 Run Dashboard"
    cd backend/nova && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888 &
    cd frontend/aura && pnpm dev --port 13334

# Run backend + Nuxt dev server (alias for `dev`)
dev-nuxt: dev

# Run backend only
backend:
    cd backend/nova && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888

# Run frontend (alias for nuxt)
frontend:
    cd frontend/aura && pnpm dev --port 13334

# Run Nuxt dev server
nuxt:
    cd frontend/aura && pnpm dev --port 13334

# Lint code
lint:
    cd backend/nova && uvx ruff check . --fix
    rumdl fmt

# Format code
format:
    cd backend/nova && uvx ruff format .

# Format check (CI style)
fmt-check:
    cd backend/nova && uvx ruff format --check .
    rumdl fmt

# Auto-fix issues
fix:
    cd backend/nova && uvx ruff check . --fix
    cd backend/nova && uvx ruff format .
    rumdl fmt

# CI: run all checks
ci: fmt-check lint test

# Run all tests
test: test-backend test-nuxt

# Run backend tests
test-backend:
    cd backend/nova && uv run pytest -n auto

# Run backend tests sequentially (debug)
test-backend-seq:
    cd backend/nova && uv run pytest

# Run frontend tests (alias for test-nuxt)
test-frontend:
    cd frontend/aura && pnpm test

# Run frontend tests with coverage (alias for test-nuxt-coverage)
test-frontend-coverage:
    cd frontend/aura && pnpm test:coverage

# Run Nuxt tests
test-nuxt:
    cd frontend/aura && pnpm test

# Run Nuxt tests with coverage
test-nuxt-coverage:
    cd frontend/aura && pnpm test:coverage

# Run e2e tests (alias for e2e-nuxt)
test-e2e:
    cd frontend/aura && pnpm test:e2e

# Run e2e tests against live Nuxt dev server (auto-starts backend + Nuxt)
e2e:
    @echo "Starting backend..."
    cd backend/nova && uv run uvicorn app.main:app --host 0.0.0.0 --port 18888 &
    @sleep 3 && curl -sf http://localhost:18888/health > /dev/null || (echo "Backend failed to start" && exit 1)
    @echo "Starting Nuxt..."
    cd frontend/aura && pnpm dev --port 13334 &
    @sleep 8 && curl -sf http://localhost:13334 > /dev/null || (echo "Nuxt failed to start" && exit 1)
    @echo "Running e2e tests..."
    cd frontend/aura && pnpm test:e2e
    @echo "Stopping services..."
    @pkill -f "uvicorn app.main:app" 2>/dev/null; pkill -f "nuxt dev" 2>/dev/null; echo "done"

# Run e2e tests against live Nuxt dev server (alias for `e2e`)
e2e-nuxt: e2e

# Clean generated files
clean:
    rm -f backend/nova/*.db
    rm -rf frontend/aura/.output
    rm -rf frontend/aura/.nuxt
    rm -rf backend/nova/.pytest_cache
    rm -rf .ruff_cache backend/nova/.ruff_cache
    rm -rf frontend/aura/coverage

# Lint and format markdown
rumdl:
    rumdl fmt

# Show help
default:
    @just --list

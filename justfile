# X-Blog Just Commands

# Install all dependencies and git hooks
install:
    cd backend && uv sync
    cd frontend/next && pnpm install
    cd frontend/nuxt && pnpm install

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
    @echo "  just frontend    (Next.js on :13333)"
    @echo "  just nuxt        (Nuxt on :13334)"
    @echo ""
    @echo "或使用 VS Code / IntelliJ 的 Run Dashboard"
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888 &
    cd frontend/next && pnpm dev --port 13333

# Run backend + Nuxt (Windows: run in two terminals)
dev-nuxt:
    @echo "⚠️ Windows 用户请在两个终端分别运行:"
    @echo "  just backend"
    @echo "  just nuxt"
    @echo ""
    @echo "或使用 VS Code / IntelliJ 的 Run Dashboard"
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888 &
    cd frontend/nuxt && pnpm dev --port 13334

# Run backend only
backend:
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888

# Run frontend only
frontend:
    cd frontend/next && pnpm dev --port 13333

# Run Nuxt dev server
nuxt:
    cd frontend/nuxt && pnpm dev --port 13334

# Lint code
lint:
    cd backend && uvx ruff check . --fix
    cd frontend/next && pnpm biome check --write
    rumdl fmt

# Format code
format:
    cd backend && uvx ruff format .
    cd frontend/next && pnpm biome format --write

# Format check (CI style)
fmt-check:
    cd backend && uvx ruff format --check .
    cd frontend/next && pnpm biome ci
    rumdl fmt

# Auto-fix issues
fix:
    cd backend && uvx ruff check . --fix
    cd backend && uvx ruff format .
    cd frontend/next && pnpm biome check --write
    cd frontend/next && pnpm biome format --write
    rumdl fmt

# CI: run all checks
ci: fmt-check lint test

# Run all tests
test: test-backend test-frontend test-nuxt

# Run backend tests
test-backend:
    cd backend && uv run pytest -n auto

# Run backend tests sequentially (debug)
test-backend-seq:
    cd backend && uv run pytest

# Run frontend tests
test-frontend:
    cd frontend/next && pnpm test

# Run frontend tests with coverage
test-frontend-coverage:
    cd frontend/next && pnpm test:coverage

# Run Nuxt tests
test-nuxt:
    cd frontend/nuxt && pnpm test

# Run Nuxt tests with coverage
test-nuxt-coverage:
    cd frontend/nuxt && pnpm test:coverage

# Run e2e tests (requires just dev running in separate terminals)
# Or use: just test-e2e for self-contained mode
test-e2e:
    cd frontend/next && pnpm test:e2e

# Run e2e tests against live dev servers (auto-starts backend + frontend)
e2e:
    @echo "Starting backend..."
    cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 18888 &
    @sleep 3 && curl -sf http://localhost:18888/health > /dev/null || (echo "Backend failed to start" && exit 1)
    @echo "Starting frontend..."
    cd frontend/next && pnpm dev --port 13333 &
    @sleep 5 && curl -sf http://localhost:13333 > /dev/null || (echo "Frontend failed to start" && exit 1)
    @echo "Running e2e tests..."
    cd frontend/next && pnpm playwright test
    @echo "Stopping services..."
    @pkill -f "uvicorn app.main:app" 2>/dev/null; pkill -f "next dev" 2>/dev/null; echo "done"

# Run e2e tests against live Nuxt dev server (auto-starts backend + Nuxt)
e2e-nuxt:
    @echo "Starting backend..."
    cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 18888 &
    @sleep 3 && curl -sf http://localhost:18888/health > /dev/null || (echo "Backend failed to start" && exit 1)
    @echo "Starting Nuxt..."
    cd frontend/nuxt && pnpm dev --port 13334 &
    @sleep 8 && curl -sf http://localhost:13334 > /dev/null || (echo "Nuxt failed to start" && exit 1)
    @echo "Running e2e tests..."
    cd frontend/nuxt && pnpm test:e2e
    @echo "Stopping services..."
    @pkill -f "uvicorn app.main:app" 2>/dev/null; pkill -f "nuxt dev" 2>/dev/null; echo "done"

# Clean generated files
clean:
    rm -f backend/*.db
    rm -rf frontend/next/.next
    rm -rf frontend/nuxt/.output
    rm -rf frontend/nuxt/.nuxt
    rm -rf backend/.pytest_cache
    rm -rf .ruff_cache backend/.ruff_cache
    rm -rf frontend/node_modules/.vite
    rm -rf frontend/next/coverage
    rm -rf frontend/nuxt/coverage

# Lint and format markdown
rumdl:
    rumdl fmt

# Show help
default:
    @just --list

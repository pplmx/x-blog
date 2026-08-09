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

# Initialize database with sample data (dev: creates admin/admin123)
init-db:
    cd backend/nova && APP_ENV=development ADMIN_PASSWORD=admin123 uv run python scripts/init_db.py

# Run both backend and frontend (Windows: run in two terminals)
# Terminal 1: just backend
# Terminal 2: just nuxt
dev:
    @echo "⚠️ Windows 用户请在两个终端分别运行:"
    @echo "  just backend"
    @echo "  just nuxt        (Nuxt on :34567)"
    @echo ""
    @echo "或使用 VS Code / IntelliJ 的 Run Dashboard"
    cd backend/nova && APP_ENV=development ALLOWED_ORIGINS="http://localhost:34567,http://localhost:3001,http://localhost:3000,http://localhost:3003" uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888 &
    cd frontend/aura && pnpm dev --port 34567

# Run backend + Nuxt dev server (alias for `dev`)
dev-nuxt: dev

# Run backend only
backend:
    cd backend/nova && APP_ENV=development uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888

# Run frontend (alias for nuxt)
frontend:
    cd frontend/aura && pnpm dev --port 34567

# Run Nuxt dev server
nuxt:
    cd frontend/aura && pnpm dev --port 34567

# Lint code
lint:
    cd backend/nova && uv run ruff check . --fix
    cd frontend/aura && pnpm lint:fix
    uv run --project backend/nova rumdl fmt

# Format code
format:
    cd backend/nova && uv run ruff format .

# Format check (CI style)
fmt-check:
    cd backend/nova && uv run ruff format --check .
    cd frontend/aura && pnpm lint
    uv run --project backend/nova rumdl fmt

# Auto-fix issues
fix:
    cd backend/nova && uv run ruff check . --fix
    cd backend/nova && uv run ruff format .
    cd frontend/aura && pnpm lint:fix
    uv run --project backend/nova rumdl fmt

# Run Python type checking (pyright, config in backend/nova/pyproject.toml)
typecheck:
    cd backend/nova && uv run pyright

# CI: run all checks
ci: fmt-check lint typecheck test

# Run all tests
test: test-backend test-nuxt

# Run backend tests
test-backend:
    cd backend/nova && uv run pytest -n auto

# Run backend tests sequentially (debug)
test-backend-seq:
    cd backend/nova && uv run pytest

# Run backend tests against a PostgreSQL database
# Set TEST_DATABASE_URL to your PostgreSQL connection string.
# Example: TEST_DATABASE_URL=postgresql://user:pass@host:port/dbname just test-backend-postgres
test-backend-postgres:
    cd backend/nova && TEST_DATABASE_URL=$$DATABASE_URL uv run pytest -n auto

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

# Run e2e tests against live Nuxt dev server (auto-starts backend + Nuxt).
# Playwright's webServer (playwright.config.ts) starts the Nuxt dev server
# itself on :34567 with the right env — do NOT start a second one here (it
# only causes nuxt.lock conflicts and a poisoned module cache).
e2e:
    @echo "Seeding database (dev admin: admin/admin123)..."
    cd backend/nova && APP_ENV=development ADMIN_PASSWORD=admin123 uv run python scripts/init_db.py
    @echo "Starting backend..."
    # RATE_LIMIT_AUTH relaxed: the suite logs in per spec file (~15×/min),
    # which exhausts the production 10/min per-IP login budget
    cd backend/nova && APP_ENV=development RATE_LIMIT_AUTH_PER_MINUTE=1000 uv run uvicorn app.main:app --host 0.0.0.0 --port 18888 &
    @sleep 3 && curl -sf http://localhost:18888/health > /dev/null || (echo "Backend failed to start" && exit 1)
    @echo "Running e2e tests (Playwright starts Nuxt on :34567)..."
    cd frontend/aura && pnpm test:e2e
    @echo "Stopping services..."
    @pkill -f "uvicorn app.main:app" 2>/dev/null; echo "done"

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

# Generate Alembic migration (auto-detect)
migration:
    cd backend/nova && uv run alembic revision --autogenerate -m "describe_your_change"

# Apply pending migrations
migrate:
    cd backend/nova && uv run alembic upgrade head

# Show migration history
migration-history:
    cd backend/nova && uv run alembic history

# Lint and format markdown
rumdl:
    uv run --project backend/nova rumdl fmt

# Show help
default:
    @just --list

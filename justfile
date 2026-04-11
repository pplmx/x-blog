# X-Blog Just Commands

# Install all dependencies
install:
    cd backend && uv sync
    cd frontend && pnpm install

# Run both backend and frontend
dev:
    cd backend && uv run uvicorn app.main:app --reload --port 8000 &
    cd frontend && pnpm dev

# Run backend only
backend:
    cd backend && uv run uvicorn app.main:app --reload --port 8000

# Run frontend only
frontend:
    cd frontend && pnpm dev

# Lint code
lint:
    cd backend && uv run ruff check .
    cd frontend && pnpm lint

# Format code
format:
    cd backend && uv run ruff format .
    cd frontend && pnpm format

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
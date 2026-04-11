.PHONY: install dev backend frontend lint format test test:backend test:frontend clean

install:
	cd backend && uv sync
	cd frontend && pnpm install

dev:
	cd backend && uv run uvicorn app.main:app --reload --port 8000 &
	cd frontend && pnpm dev

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && pnpm dev

lint:
	cd backend && uv run ruff check .
	cd frontend && pnpm lint

format:
	cd backend && uv run ruff format .
	cd frontend && pnpm format

test: test:backend test:frontend

test:backend:
	cd backend && uv run pytest

test:frontend:
	cd frontend && pnpm test

test:frontend:coverage:
	cd frontend && pnpm test:coverage

clean:
	rm -f backend/*.db
	rm -rf frontend/.next
	rm -rf backend/.pytest_cache
	rm -rf .ruff_cache backend/.ruff_cache
	rm -rf frontend/node_modules/.vite
	rm -rf frontend/coverage
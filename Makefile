.PHONY: install dev backend frontend lint format test clean

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

test:
	cd backend && uv run pytest

clean:
	rm -f backend/*.db
	rm -rf frontend/.next
	rm -rf backend/.pytest_cache
	rm -rf .ruff_cache backend/.ruff_cache
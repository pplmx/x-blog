# X-Blog Just Commands

# Install all dependencies
install:
    cd backend && uv sync
    pnpm --filter x-blog-frontend install

# Run both backend and frontend
dev:
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
    cd backend && uv run python -c "
import sys
sys.path.insert(0, '.')
from app.database import SessionLocal
from app import models, auth

db = SessionLocal()

# Create admin user
admin = auth.User(
    username='admin',
    password=auth.get_password_hash('admin123'),
    is_superuser=True
)
db.add(admin)

# Categories
categories = ['前端开发', '后端开发', '技术分享', '学习笔记']
for name in categories:
    db.add(models.Category(name=name))

# Tags
tags = ['React', 'Next.js', 'Python', 'FastAPI', 'TypeScript', 'JavaScript', 'CSS', '数据库']
for name in tags:
    db.add(models.Tag(name=name))

db.commit()
print('✓ Admin user created (admin/admin123)')
print('✓ Categories and tags created')
db.close()
"
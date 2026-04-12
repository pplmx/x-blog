# DevOps 和文档设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. DevOps

### 1.1 Docker 架构

```text
┌─────────────────────────────────────────────┐
│              Nginx Reverse Proxy            │
│  - :80  → Frontend (Next.js)            │
│  - :80  → /api → Backend (FastAPI)     │
└─────────────────────────────────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐   ┌─────────────────┐
│   Frontend      │   │    Backend     │
│   Dockerfile    │   │    Dockerfile  │
│   (Next.js)    │   │    (FastAPI)   │
└─────────────────┘   └─────────────────┘
```

### 1.2 Docker Compose

```yaml
services:
  frontend:
    build: frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=/api

  backend:
    build: backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=sqlite:///./aurora.db

  nginx:
    image: nginx:latest
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - frontend
      - backend
```

### 1.3 CI/CD

- **GitHub Actions**: 测试 → 构建镜像 → 推送到 GHCR → SSH 部署

## 2. 文档

| 文档               | 内容                 |
| ------------------ | -------------------- |
| README.md          | 补充 Docker 启动方式 |
| docs/deployment.md | 服务器部署指南       |

## 3. 文件结构

```text
.
├── backend/
│   └── Dockerfile
├── frontend/
│   └── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── .dockerignore
├── .github/
│   └── workflows/
│       └── deploy.yml
└── docs/
    └── deployment.md
```

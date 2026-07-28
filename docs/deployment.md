# X-Blog 部署指南

一个优雅、简洁的博客系统部署方案。

---

## 环境要求

| 依赖              | 版本  | 说明                             |
| ----------------- | ----- | -------------------------------- |
| Node.js           | ≥24   | 前端运行                         |
| pnpm              | ≥8    | 前端包管理                       |
| Python            | ≥3.14 | 后端运行                         |
| uv                | -     | Python 包管理 (推荐)             |
| PostgreSQL (可选) | -     | 生产环境数据库 (默认使用 SQLite) |

---

## 数据库配置

### 默认 (SQLite)

开箱即用，无需额外配置。

### 生产环境 (PostgreSQL)

```bash
# 安装 psycopg2
uv pip install psycopg2-binary

# 配置环境变量
echo "DATABASE_URL=postgresql://user:password@localhost:5432/xblog" > backend/nova/.env

# 初始化数据库
cd backend/nova && uv run python scripts/init_db.py

# 启动后端
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18888
```

### 测试 (PostgreSQL)

后端测试默认使用 SQLite，但支持通过 TEST_DATABASE_URL 环境变量切换到 PostgreSQL：

```bash
# 运行后端测试 (PostgreSQL)
TEST_DATABASE_URL="postgresql://user:password@host:port/dbname" just test-backend-postgres

# 运行完整测试套件 (PostgreSQL)
TEST_DATABASE_URL="postgresql://user:password@host:port/dbname" uv run pytest -n auto
```

---

## 快速开始

### 方式一：一键启动（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/pplmx/x-blog.git
cd x-blog

# 2. 安装依赖
just install

# 3. 启动开发服务器
just dev
```

访问 http://localhost:13334

### 方式二：分别启动

```bash
# 终端 1 - 后端
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 终端 2 - 前端
cd frontend/aura
pnpm install
pnpm dev
```

---

## Docker 部署（生产环境）

### 1. 环境配置

```bash
# 后端配置
cp backend/.env.example backend/.env
# 编辑 backend/.env，设置 JWT_SECRET_KEY

# 前端配置 (可选) - Nuxt 使用 Docker 环境变量
```

### 2. 一键启动

```bash
# 开发测试
docker-compose up -d

# 构建生产镜像
docker-compose build
docker-compose up -d
```

### 3. 访问服务

| 服务     | 地址                        |
| -------- | --------------------------- |
| 前端     | http://localhost:13334      |
| 后端 API | http://localhost:18888      |
| API 文档 | http://localhost:18888/docs |

---

## 本地分离部署

后端和前端在不同机器时：

### 后端（服务器/VM）

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 前端（本地 Windows）

```bash
# 创建环境变量文件
echo "NUXT_API_URL=http://<后端IP>:18888" > frontend/aura/.env

cd frontend/aura
pnpm install
pnpm dev
```

---

## 初始化数据

首次部署后，运行初始化脚本创建示例数据：

```bash
# 创建管理员账号、分类、标签、示例文章
just init-db
```

默认管理员账号：`admin` / `admin123`

---

## 项目结构

```text
x-blog/
├── backend/           # FastAPI 后端
│   ├── app/
│   │   ├── routers/  # API 路由
│   │   ├── models/   # 数据模型
│   │   └── main.py   # 入口
│   └── pyproject.toml
├── frontend/          # 前端 (Nuxt 4)
│   └── aura/          # Nuxt 应用
└── package.json
├── docker-compose.yml
├── justfile                # 任务脚本
└── README.md
```

---

## 可用命令

```bash
just install          # 安装所有依赖
just dev              # 启动开发服务器
just backend          # 仅启动后端
just frontend         # 仅启动前端
just test             # 运行所有测试
just lint             # 代码检查
just format           # 代码格式化
just init-db          # 初始化数据库
just clean            # 清理缓存
```

---

## 功能特性

- ✅ Markdown 文章支持
- ✅ 分类与标签管理
- ✅ 评论系统
- ✅ 阅读量统计
- ✅ RSS 订阅
- ✅ Sitemap
- ✅ SEO 优化
- ✅ 响应式设计
- ✅ 管理后台

---

## 许可证

MIT License

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

访问 http://localhost:34567

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
cp backend/nova/.env.example backend/nova/.env
# 编辑 backend/nova/.env，设置 JWT_SECRET_KEY

# Docker Compose 默认使用 PostgreSQL + 自动建表
# 如需自定义 PostgreSQL 密码:
export POSTGRES_PASSWORD=your-strong-password

# 前端配置 (可选) - Nuxt 使用 Docker 环境变量
```

### 2. 一键启动

```bash
# 启动全部服务 (PostgreSQL + Backend + Frontend)
docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 停止并删除数据卷 (清空数据库)
docker compose down -v
```

**注意**: 首次启动时，PostgreSQL 自动创建数据库和用户。FastAPI 在启动时通过 Alembic 将 schema 升级到最新版本 (base `alembic upgrade head`)，无需手动初始化。

### GitHub Actions 自动部署

`Test` 工作流在 `main` 的 push 上全部通过后，`Deploy` 工作流会构建并推送后端、前端镜像，再按镜像 digest 部署该次测试对应的 commit。服务器需要：

- 在 `/opt/x-blog` 放置此仓库的 Git clone，并允许部署用户执行 `git fetch`。
- 安装 Git、Docker 和支持 `docker compose up --wait` 的 Docker Compose。
- 在仓库 Actions secrets 中配置 `SERVER_HOST`、`SERVER_USER`、`SSH_KEY` 和 `SERVER_KNOWN_HOSTS`。
- 创建受保护的 `production` environment，并限制为 `main` 分支；建议配置 required reviewers。
- 为 `main` 启用分支保护，要求 `Test` 状态检查通过。

`SERVER_KNOWN_HOSTS` 应保存目标主机完整的 OpenSSH `known_hosts` 记录（主机名、key 类型和公钥），并通过可信渠道核对服务器 SSH host key，不能只信任首次网络扫描结果。部署使用临时 SSH 和 Docker 凭据目录，拉取完成或失败后都会清理私钥与 GHCR token。

### 2.5 (可选) Web Push 推送通知

读者可在浏览器订阅新文章推送 (DEC-055)。启用需生成一次 ES256 (P-256) VAPID 密钥对并写入后端 `.env`：

```bash
cd backend/nova
cp .env.example .env
uv run python -c "import base64; from cryptography.hazmat.primitives.asymmetric import ec; k=ec.generate_private_key(ec.SECP256R1()); p=k.public_key().public_numbers(); print('VAPID_PUBLIC_KEY='+base64.urlsafe_b64encode(b'\x04'+p.x.to_bytes(32,'big')+p.y.to_bytes(32,'big')).rstrip(b'=').decode()); print('VAPID_PRIVATE_KEY='+base64.urlsafe_b64encode(k.private_numbers().private_value.to_bytes(32,'big')).rstrip(b'=').decode())"
```

把输出的两个值填入 `.env` 的 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`，并设置 `VAPID_SUBJECT=mailto:you@example.com`，然后重启后端。未配置时所有 `/api/push/*` 端点 fail-closed 返回 503，前端订阅按钮自动隐藏。

### 3. 访问服务

| 服务     | 地址                        |
| -------- | --------------------------- |
| 前端     | http://localhost:34567      |
| 后端 API | http://localhost:18888      |
| API 文档 | http://localhost:18888/docs |

---

## 本地分离部署

后端和前端在不同机器时：

### 后端（服务器/VM）

```bash
cd backend/nova
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 18888
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

## 限流与可信代理

所有生产 API 端点都带速率限制（默认按端点区分：读 120/min、写 30/min、登录 10/min、**注册 5/min**、搜索 60/min、评论 20/min、导出 10/min）。每个值都可通过同名环境变量覆盖，例如 `RATE_LIMIT_WRITE_PER_MINUTE=60`。读者注册（`RATE_LIMIT_REGISTER_PER_MINUTE`，DEC-059）比登录更严，因为开放注册是典型的垃圾账号/滥用入口。

> **注意**：`RATE_LIMIT_PER_MINUTE` 是历史遗留的无效变量，代码不读取它，请使用上面按端点的变量名。

### 为什么需要 TRUSTED_PROXIES

后端通过 `request.client.host`（TCP 对端）识别客户端。当请求经由代理转发（本仓库的 docker-compose 前端 Nuxt 代理，或 nginx），后端看到的对端是**代理容器/节点的 IP**，而不是真实访客 IP —— 所有访客会共享同一个限流桶，按 IP 的限流保护失效。

`TRUSTED_PROXIES` 让后端信任来自这些代理的 `X-Forwarded-For` 头取回真实客户端 IP：

```bash
# 逗号分隔的可信代理 IP 列表
TRUSTED_PROXIES=172.20.0.2,203.0.113.10

# 只有后端端口不对外暴露时，才可对单一网关拓扑使用通配符
TRUSTED_PROXIES=*
```

- 不设置时保持默认安全行为：忽略上游 `X-Forwarded-For`，直接访客无法伪造新桶。
- docker-compose 默认不设置（保持默认安全行为）；若你部署在单网关后且后端端口未公开，可在 `.env` 中设置 `TRUSTED_PROXIES=*` 恢复按客户端的限流桶。
- 部署在 nginx 后时，把 nginx 的 IP（或 `*`，后端不公开时）填入以恢复按客户端限流。nginx 已透传 `X-Forwarded-For`。
- **读者认证端点（DEC-059）**：默认 compose 拓扑下所有浏览器请求都经 Nuxt 代理到达后端，若未配置
  `TRUSTED_PROXIES`，读者注册/登录会共享**同一个**代理级桶（注册 5/min、登录 10/min 全站共享）——
  一个攻击者即可耗尽桶导致全站读者注册/登录被限流。要在生产恢复按客户端桶，必须把代理 IP 填入
  `TRUSTED_PROXIES`（单网关后且后端 18888 端口未公开时可用 `*`）。

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
├── backend/               # 后端实现
│   └── nova/              # FastAPI (Python)
│       ├── app/
│       │   ├── routers/  # API 路由
│       │   ├── models.py # 数据模型
│       │   └── main.py   # 入口
│       └── pyproject.toml
├── frontend/              # 前端实现
│   └── aura/              # Nuxt 4 (Vue 3)
│       ├── app/
│       └── pages/
├── docker-compose.yml     # Docker 编排 (PostgreSQL + Backend + Frontend)
├── justfile               # 任务脚本
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

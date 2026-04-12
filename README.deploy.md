# X-Blog 部署指南

一个优雅、简洁的博客系统部署方案。

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥18 | 前端运行 |
| pnpm | ≥8 | 前端包管理 |
| Python | ≥3.11 | 后端运行 |
| uv | - | Python 包管理 (推荐) |

---

## 快速开始

### 方式一：一键启动（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/your-repo/x-blog.git
cd x-blog

# 2. 安装依赖
just install

# 3. 启动开发服务器
just dev
```

访问 http://localhost:3000

### 方式二：分别启动

```bash
# 终端 1 - 后端
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 终端 2 - 前端
cd frontend
pnpm install
pnpm dev
```

---

## Docker 部署（生产环境）

### 1. 环境配置

```bash
# 复制环境变量模板
cp .env.example .env
```

编辑 `.env`：
```env
# 必须修改
JWT_SECRET_KEY=your-super-secret-key-change-this

# 可选配置
DATABASE_URL=sqlite:///./x-blog.db
```

### 2. 一键启动

```bash
# 开发测试
docker-compose up -d

# 构建生产镜像
docker-compose -f docker-compose.yml build
docker-compose up -d
```

### 3. 访问服务

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost |
| 后端 API | http://localhost/api |
| API 文档 | http://localhost/docs |

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
echo "NEXT_PUBLIC_API_URL=http://<后端IP>:8000" > frontend/.env.local

cd frontend
pnpm install
pnpm dev
```

---

## 初始化数据

首次部署后，运行初始化脚本创建示例数据：

```bash
# 创建管理员账号、分类、标签、示例文章
just init
```

默认管理员账号：`admin` / `admin123`

---

## 项目结构

```
x-blog/
├── backend/           # FastAPI 后端
│   ├── app/
│   │   ├── routers/  # API 路由
│   │   ├── models/   # 数据模型
│   │   └── main.py   # 入口
│   └── pyproject.toml
├── frontend/          # Next.js 前端
│   ├── app/          # App Router 页面
│   ├── components/   # 组件
│   └── package.json
├── docker-compose.yml
├── nginx.conf        # Nginx 配置
├── justfile          # 任务脚本
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
just init             # 初始化数据
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
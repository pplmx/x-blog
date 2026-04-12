# X-Blog

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009989?style=for-the-badge&logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python)

现代化的全栈博客系统，基于 FastAPI + Next.js 构建

[English](./README.md) · [中文](./README.zh-CN.md)

</div>

## ✨ 特性

- 🚀 **现代技术栈** - Next.js 16, FastAPI, TypeScript, Python 3.14
- 📝 **Markdown 支持** - 支持 Mermaid 图表、KaTeX 数学公式、代码高亮
- 🎨 **精美 UI** - Tailwind CSS v4 + shadcn/ui 构建
- 📱 **响应式设计** - 完美适配移动端
- 🔒 **管理后台** - 内置内容管理后台
- 🧪 **完善测试** - 154 个测试 (后端 68 + 前端 86)
- ✅ **类型安全** - 完整 TypeScript 支持 + Pydantic 验证
- 🔍 **全文搜索** - 文章搜索功能
- 🌙 **深色模式** - 跟随系统偏好的深色模式
- 📊 **阅读统计** - 浏览量、点赞数、阅读进度
- 💬 **评论系统** - 支持楼中楼回复
- 🏷️ **标签分类** - 使用标签和分类组织文章
- 📱 **PWA 支持** - 可安装为 Web 应用
- 🎯 **SEO 优化** - Open Graph、JSON-LD 结构化数据
- ⬆️ **文章置顶** - 将重要文章置顶显示
- 📤 **数据导出** - 导出文章/评论为 CSV

## 🚀 快速开始

### 环境要求

| 工具    | 版本  | 安装方式                              |
| ------- | ----- | ------------------------------------- |
| Python  | 3.14+ | [uv](https://github.com/astral-sh/uv) |
| Node.js | 24+   | [Node.js](https://nodejs.org/)        |
| pnpm    | 10+   | `npm install -g pnpm`                 |
| just    | 1.0+  | [just](https://github.com/casey/just) |

```bash
# 安装 uv (Python 包管理器)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 安装

```bash
# 安装所有依赖
just install

# 或者手动安装:
cd backend && uv sync
cd frontend && pnpm install
```

### 开发

```bash
# 运行后端和前端
just dev

# 或者分别运行:
just backend  # http://localhost:8000
just frontend # http://localhost:3000
```

### 🐳 Docker 部署

```bash
# 克隆并启动
git clone https://github.com/your-username/x-blog.git
cd x-blog

# 配置环境变量
cp backend/.env.example backend/.env

# 使用 Docker Compose 启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

详细部署指南见 [docs/deployment.md](./docs/deployment.md)

## 🛠️ 命令

| 命令                | 说明                              |
| ------------------- | --------------------------------- |
| `just install`      | 安装所有依赖                      |
| `just dev`          | 运行开发服务器 (后端 + 前端)       |
| `just backend`      | 运行 FastAPI 后端                 |
| `just frontend`     | 运行 Next.js 前端                 |
| `just lint`         | 代码检查 (ruff + biome)           |
| `just format`       | 代码格式化                        |
| `just test`         | 运行所有测试 (68 后端 + 86 前端)  |
| `just test-backend` | 运行后端测试 (并行)               |
| `just test-frontend`| 运行前端测试                     |
| `just fix`          | 自动修复代码问题                  |
| `just ci`           | 运行 lint + format + test         |
| `just clean`        | 清理生成文件                      |

## 📡 API 接口

### 文章

| 方法   | 路径                        | 说明              |
| ------ | --------------------------- | ----------------- |
| GET    | `/api/posts`                | 获取文章列表      |
| GET    | `/api/posts/{slug}`         | 根据 slug 获取文章 |
| GET    | `/api/posts/{id}/related`   | 获取相关文章      |
| POST   | `/api/posts`                | 创建文章          |
| PUT    | `/api/posts/{id}`           | 更新文章          |
| DELETE | `/api/posts/{id}`           | 删除文章          |
| POST   | `/api/posts/{id}/like`      | 点赞文章          |
| POST   | `/api/posts/{id}/view`      | 增加浏览量        |

### 分类和标签

| 方法 | 路径                         | 说明              |
| ---- | ---------------------------- | ----------------- |
| GET  | `/api/categories`            | 获取分类列表      |
| GET  | `/api/tags`                  | 获取标签列表      |
| GET  | `/api/posts?tag_id=X`        | 根据标签获取文章  |
| GET  | `/api/posts?category_id=X`   | 根据分类获取文章  |

### 评论

| 方法 | 路径                        | 说明              |
| ---- | --------------------------- | ----------------- |
| GET  | `/api/comments/post/{id}`   | 获取文章评论      |
| POST | `/api/comments/post/{id}`   | 发表评论          |

### 导出

| 方法 | 路径                      | 说明              |
| ---- | ------------------------- | ----------------- |
| GET  | `/api/export/posts.csv`   | 导出所有文章      |
| GET  | `/api/export/comments.csv`| 导出所有评论      |

## 🏗️ 项目结构

```text
x-blog/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py         # 应用入口
│   │   ├── config.py       # 配置
│   │   ├── database.py     # 数据库连接
│   │   ├── models.py       # SQLAlchemy 模型
│   │   ├── schemas.py      # Pydantic schemas
│   │   ├── crud.py         # 数据库操作
│   │   └── routers/        # API 路由
│   ├── tests/              # 单元测试 (68 个)
│   └── pyproject.toml      # Python 配置
│
├── frontend/               # Next.js 前端
│   ├── app/
│   │   ├── page.tsx        # 首页
│   │   ├── admin/          # 管理后台
│   │   ├── posts/          # 文章页面
│   │   ├── tags/           # 标签页面
│   │   └── about/          # 关于页面
│   ├── components/         # React 组件
│   │   ├── ui/             # shadcn/ui 组件
│   │   └── *.tsx
│   ├── lib/                # 工具函数 & API 客户端
│   ├── types/              # TypeScript 类型
│   └── package.json
│
├── docs/                   # 文档
├── justfile                # 任务运行器 (推荐)
└── package.json            # 根目录配置 (pnpm workspaces)
```

## 🧰 技术栈

### 后端

- **框架**: [FastAPI](https://fastapi.tiangolo.com/) - 现代 Python Web 框架
- **ORM**: [SQLAlchemy](https://www.sqlalchemy.org/) - 数据库 ORM
- **数据库**: SQLite (默认)，可轻松切换到 PostgreSQL/MySQL
- **验证**: [Pydantic](https://docs.pydantic.dev/) - 数据验证
- **测试**: [pytest](https://pytest.org/) - Python 测试框架，支持 pytest-xdist 并行执行
- **代码检查**: [ruff](https://docs.astral.sh/ruff/) - 快速的 Python linter 和格式化工具

### 前端

- **框架**: [Next.js 16](https://nextjs.org/) - React 框架，使用 App Router
- **UI**: [shadcn/ui](https://ui.shadcn.com/) - UI 组件库
- **样式**: [Tailwind CSS v4](https://tailwindcss.com/) - CSS 框架
- **表单**: [React Hook Form](https://react-hook-form.com/) - 表单处理
- **测试**: [Vitest](https://vitest.dev/) - 单元测试
- **代码检查**: [Biome](https://biomejs.dev/) - 快速的 JS/TS linter 和格式化工具

### 开发工具

- **包管理**: [uv](https://github.com/astral.sh/uv) (Python), [pnpm](https://pnpm.io/) (Node.js)
- **任务运行**: [just](https://github.com/casey/just) - 命令运行器
- **代码检查**: [ruff](https://docs.astral.sh/ruff/) (Python), [Biome](https://biomejs.dev/) (JS/TS)
- **Git Hooks**: [prek](https://github.com/astral-sh/prek) - Git hooks 管理器

## 🧪 测试

```bash
# 运行所有测试
just test

# 运行后端测试 (并行)
just test-backend

# 运行前端测试
just test-frontend

# 运行带覆盖率测试
just test-frontend-coverage
```

**测试统计:**
- 后端: 68 个测试 (pytest + pytest-xdist)
- 前端: 86 个测试 (Vitest)
- **总计: 154 个测试**

## 🤝 贡献

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 运行测试确保一切正常 (`just test`)
4. 修复任何代码问题 (`just fix`)
5. 使用[约定式提交](https://www.conventionalcommits.org/)提交更改
6. 推送分支 (`git push origin feature/amazing-feature`)
7. 提交 Pull Request

## 📄 许可证

MIT License - 查看 [LICENSE](LICENSE) 了解详情。

## 🚀 部署指南

详细部署指南见 [docs/deployment.md](./docs/deployment.md)：

- 本地开发环境搭建
- Docker 生产部署
- 分离后端/前端部署
- 环境配置

---

<div align="center">

使用 ❤️ 基于 FastAPI + Next.js 构建

</div>

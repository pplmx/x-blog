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
- 📝 **Markdown 支持** - 使用 Markdown 写作，支持实时预览
- 🎨 **精美 UI** - 使用 Tailwind CSS + shadcn/ui 构建
- 📱 **响应式设计** - 完美适配移动端
- 🔒 **管理后台** - 内置内容管理后台
- 🧪 **完善测试** - pytest (后端) + Vitest (前端)
- ✅ **类型安全** - 完整 TypeScript 支持 + Pydantic 验证

## 🚀 快速开始

### 环境要求

| 工具 | 版本 | 安装方式 |
|------|------|----------|
| Python | 3.14+ | [uv](https://github.com/astral-sh/uv) |
| Node.js | 25+ | [nvm](https://github.com/nvm-sh/nvm) |
| pnpm | 9+ | `npm install -g pnpm` |

```bash
# 安装 uv (Python 包管理器)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 安装

```bash
# 克隆项目
git clone https://github.com/pplmx/x-blog.git
cd x-blog

# 安装所有依赖
pnpm install

# 或者手动安装:
cd backend && uv sync
cd frontend && pnpm install
```

### 开发

```bash
# 运行后端和前端
pnpm dev

# 或者分别运行:
make backend  # http://localhost:8000
make frontend # http://localhost:3000

# 查看 API 文档
# http://localhost:8000/docs
```

## 📖 文档

- **API 文档**: http://localhost:8000/docs (Swagger)
- **管理后台**: http://localhost:3000/admin
- **博客前台**: http://localhost:3000

## 🛠️ 命令

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装所有依赖 |
| `pnpm dev` | 运行开发服务器 |
| `make backend` | 运行 FastAPI 后端 |
| `make frontend` | 运行 Next.js 前端 |
| `make lint` | 代码检查 |
| `make format` | 代码格式化 |
| `make test` | 运行测试 |
| `make clean` | 清理生成文件 |

## 📡 API 接口

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/posts` | 获取文章列表 |
| GET | `/api/posts/{id}` | 获取文章详情 |
| POST | `/api/posts` | 创建文章 |
| PUT | `/api/posts/{id}` | 更新文章 |
| DELETE | `/api/posts/{id}` | 删除文章 |

### 分类和标签

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 获取分类列表 |
| GET | `/api/tags` | 获取标签列表 |

## 🏗️ 项目结构

```
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
│   ├── tests/              # 单元测试
│   └── pyproject.toml      # Python 配置
│
├── frontend/               # Next.js 前端
│   ├── app/
│   │   ├── page.tsx        # 首页
│   │   ├── admin/          # 管理后台
│   │   ├── posts/          # 文章页面
│   │   └── about/          # 关于页面
│   ├── components/         # React 组件
│   │   ├── ui/             # shadcn/ui 组件
│   │   └── *.tsx
│   ├── lib/                # 工具函数 & API 客户端
│   ├── types/              # TypeScript 类型
│   └── package.json
│
├── docs/                   # 设计文档
├── .husky/                 # Git hooks
├── Makefile                # 便捷命令
└── package.json            # 根目录配置
```

## 🧰 技术栈

### 后端

- **框架**: [FastAPI](https://fastapi.tiangolo.com/) - 现代 Python Web 框架
- **ORM**: [SQLAlchemy](https://www.sqlalchemy.org/) - 数据库 ORM
- **验证**: [Pydantic](https://docs.pydantic.dev/) - 数据验证
- **测试**: [pytest](https://pytest.org/) - Python 测试框架

### 前端

- **框架**: [Next.js 16](https://nextjs.org/) - React 框架
- **UI**: [shadcn/ui](https://ui.shadcn.com/) - UI 组件库
- **样式**: [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- **表单**: [React Hook Form](https://react-hook-form.com/) - 表单处理
- **测试**: [Vitest](https://vitest.dev/) - 单元测试

### 开发工具

- **包管理**: [uv](https://github.com/astral-sh/uv) (Python), [pnpm](https://pnpm.io/) (Node.js)
- **代码检查**: [ruff](https://docs.astral.sh/ruff/) (Python), [Biome](https://biomejs.dev/) (JS/TS)
- **Git Hooks**: [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged)
- **提交规范**: [Commitlint](https://commitlint.js.org/) - 约定式提交

## 🤝 贡献

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 使用[约定式提交](https://www.conventionalcommits.org/)提交更改
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 📄 许可证

MIT License - 查看 [LICENSE](LICENSE) 了解详情。

---

<div align="center">

使用 ❤️ 基于 FastAPI + Next.js 构建

</div>
# 安全加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公开部署的博客系统提供企业级基础安全

**Architecture:** 通过环境变量配置 JWT secret，添加 slowapi 频率限制，配置安全 Headers 和 CORS

**Tech Stack:** FastAPI, slowapi, python-dotenv

---

## 文件结构

- Modify: `backend/app/auth.py` - JWT secret 环境变量
- Modify: `backend/app/main.py` - 频率限制、安全 Headers、CORS
- Modify: `backend/pyproject.toml` - 添加依赖
- Modify: `backend/.env.example` - 添加环境变量文档

---

## Task 1: 添加 slowapi 依赖

**Files:**
- Modify: `backend/pyproject.toml`
- Test: `backend/pyproject.toml`

- [ ] **Step 1: 添加 slowapi 和 python-dotenv 依赖**

```toml
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "sqlalchemy>=2.0.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "python-jose[cryptography]>=3.3.0",
    "bcrypt>=4.0.0",
    "python-multipart>=0.0.6",
    "slowapi>=0.1.9",
    "python-dotenv>=1.0.0",
]
```

- [ ] **Step 2: 安装依赖**

Run: `cd /var/tmp/aurora/backend && uv sync`

- [ ] **Step 3: Commit**

```bash
git add backend/pyproject.toml
git commit -m "deps: add slowapi and python-dotenv for security"
```


## Task 2: JWT Secret 环境变量

**Files:**
- Modify: `backend/app/auth.py:13`

- [ ] **Step 1: 修改 auth.py 从环境变量读取 SECRET_KEY**

```python
import os
import warnings

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "x-blog-secret-key-dev-only")
ALGORITHM = "HS256"

# 警告：生产环境必须设置 JWT_SECRET_KEY
if SECRET_KEY == "x-blog-secret-key-dev-only":
    warnings.warn(
        "JWT_SECRET_KEY not set! Using insecure default. "
        "Set JWT_SECRET_KEY environment variable for production."
    )
```

- [ ] **Step 2: 运行测试验证**

Run: `cd /var/tmp/aurora/backend && uv run pytest tests/test_auth.py -v`
Expected: 7 passed

- [ ] **Step 3: Commit**

```bash
git add backend/app/auth.py
git commit -m "security: add JWT_SECRET_KEY env var support"
```


## Task 3: 频率限制

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: 在 main.py 添加频率限制**

```python
import os
from slowapi import Limiter
from slowapi.util import get_remote_address

RATE_LIMIT_PER_MINUTE = os.getenv("RATE_LIMIT_PER_MINUTE", "60")
limiter = Limiter(key_func=get_remote_address)

# 在 app 创建后添加
app.state.limiter = limiter

def rate_limit_exceeded_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests"}
    )

app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
```

- [ ] **Step 2: 在登录端点添加频率限制装饰器**

在 `backend/app/routers/admin.py` 的 login 函数添加:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/login")
@limiter.limit("60/minute")
def login(...):
    ...
```

- [ ] **Step 3: 运行测试验证**

Run: `cd /var/tmp/aurora/backend && uv run pytest tests/ -v --tb=no`
Expected: 46 passed

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py backend/app/routers/admin.py
git commit -m "security: add rate limiting with slowapi"
```


## Task 4: 安全 Headers 中间件

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: 添加安全 Headers 中间件**

```python
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response
```

- [ ] **Step 2: 运行测试验证**

Run: `cd /var/tmp/aurora/backend && uv run pytest tests/ -v --tb=no -x`
Expected: 46 passed

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "security: add security headers middleware"
```


## Task 5: CORS 配置

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/.env.example`

- [ ] **Step 1: 修改 main.py 添加 CORS 中间件**

```python
from fastapi.middleware.cors import CORSMiddleware

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 2: 更新 .env.example**

```bash
# Aurora Blog Backend Configuration
DATABASE_URL=sqlite:///./aurora.db

# Security
JWT_SECRET_KEY=your-secret-key-here
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
RATE_LIMIT_PER_MINUTE=60
```

- [ ] **Step 3: 运行测试验证**

Run: `cd /var/tmp/aurora/backend && uv run pytest tests/ -v --tb=no`
Expected: 46 passed

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py backend/.env.example
git commit -m "security: add CORS configuration"
```


## Task 6: 最终验证

- [ ] **Step 1: 运行完整测试**

Run: `cd /var/tmp/aurora && pnpm test`
Expected: All tests pass

- [ ] **Step 2: 运行 lint**

Run: `cd /var/tmp/aurora && pnpm lint`
Expected: All checks passed

- [ ] **Step 3: 验证环境变量功能**

验证 JWT secret 警告在未设置时触发

---

## 验收

- [ ] JWT_SECRET_KEY 从环境变量读取
- [ ] 未设置时警告
- [ ] 频率限制生效 (60/minute)
- [ ] 安全 Headers 添加
- [ ] CORS 正确配置
- [ ] 46 测试通过
- [ ] Lint 通过

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-11-security-hardening.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
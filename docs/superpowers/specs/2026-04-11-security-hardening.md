# 安全加固设计

**日期**: 2026-04-11  
**状态**: 已批准

## 1. 目标

为公开部署的博客系统提供企业级基础安全

## 2. 架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Client     │────▶│  FastAPI (中间件) │────▶│  Handlers   │
└─────────────┘     │  - Rate Limit    │     └─────────────┘
                    │  - Security HDRS │
                    │  - CORS          │
                    └──────────────────┘
```

## 3. 实现

### 3.1 JWT Secret 环境变量

**文件**: `backend/app/auth.py`

```python
import os
from functools import lru_cache

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "x-blog-secret-key-dev-only")
if SECRET_KEY == "x-blog-secret-key-dev-only":
    import warnings
    warnings.warn("JWT_SECRET_KEY not set! Using insecure default for production.")
```

### 3.2 频率限制

**依赖**: `slowapi`

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_remote_address)

@app.post("/api/admin/login")
@limiter.limit("60/minute")
def login():
    ...
```

### 3.3 安全 Headers

```python
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response
```

### 3.4 CORS 配置

```python
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## 4. 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| JWT_SECRET_KEY | (警告) | JWT 签名密钥 |
| ALLOWED_ORIGINS | localhost:3000 | 允许的域名 |
| RATE_LIMIT_PER_MINUTE | 60 | 每分钟请求限制 |

## 5. 验收标准

- [ ] JWT_SECRET_KEY 从环境变量读取
- [ ] 未设置时警告
- [ ] 频率限制生效
- [ ] 安全 Headers 添加
- [ ] CORS 正确配置
- [ ] 测试通过
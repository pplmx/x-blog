# 图片上传功能设计

**日期**: 2026-04-11  
**状态**: 已批准 (简化版)

## 1. 目标

为博客系统添加图片上传功能：文章封面图、Markdown 图片插入

**注意**: 个人部署的博客只有管理员一人，用户头像功能不需要

## 2. 架构

```text
┌──────────┐     ┌───────────┐     ┌──────────────┐
│ Frontend │────▶│  FastAPI  │────▶│  Local Files │
│          │     │  /upload  │     │  /static/    │
└──────────┘     └───────────┘     └──────────────┘
```

## 3. 实现

### 3.1 后端 API

**路由**: `backend/app/routers/upload.py`

```python
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
from datetime import datetime
import uuid
import os

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5MB

@router.post("")
async def upload_image(file: UploadFile = File(...)):
    # 验证文件类型
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Unsupported file type")

    # 验证文件大小
    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, "File too large (max 5MB)")

    # 生成文件名
    ext = file.filename.split(".")[-1]
    filename = f"{uuid.uuid4()}.{ext}"

    # 按年月存储
    now = datetime.now()
    upload_dir = Path(f"backend/static/uploads/{now.year}/{now.month:02d}")
    upload_dir.mkdir(parents=True, exist_ok=True)

    # 保存文件
    filepath = upload_dir / filename
    filepath.write_bytes(contents)

    # 返回 URL
    return {"url": f"/static/uploads/{now.year}/{now.month:02d}/{filename}"}
```

### 3.2 数据模型

**Post 添加 cover_image 字段**:

```python
class Post(Base):
    cover_image = Column(String(500), nullable=True)
```

### 3.3 前端

**上传组件** (`frontend/components/ImageUpload.tsx`):

```tsx
// 支持拖拽、粘贴、点击上传
// 返回上传后的 URL
// 支持进度显示
```

**Admin 文章编辑**:

- 封面图上传按钮
- Markdown 编辑器图片插入

**Admin 用户设置**:

- 头像上传

## 4. 文件结构

- Create: `backend/app/routers/upload.py` - 上传 API
- Modify: `backend/app/models.py` - 添加 cover_image
- Modify: `backend/app/main.py` - 注册路由 + 配置静态文件

**静态文件配置** (main.py):

```python
from fastapi.staticfiles import StaticFiles
app.mount("/static", StaticFiles(directory="backend/static"), name="static")
```

- Create: `frontend/components/ImageUpload.tsx` - 上传组件
- Create: `frontend/app/admin/profile/page.tsx` - 用户设置页面
- Modify: `frontend/app/admin/posts/[id]/page.tsx` - 封面图

## 5. 验收标准

- [ ] 图片上传 API 正常工作
- [ ] 文件类型/大小验证
- [ ] 文章封面图上传
- [ ] Markdown 图片插入
- [ ] 测试通过

## 6. 环境变量

| 变量                 | 默认值           | 描述               |
| -------------------- | ---------------- | ------------------ |
| UPLOAD_MAX_SIZE      | 5242880          | 最大文件大小 (5MB) |
| UPLOAD_ALLOWED_TYPES | jpg,png,gif,webp | 允许的文件类型     |

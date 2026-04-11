# 图片上传实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为博客系统添加图片上传功能（文章封面图、Markdown 图片）

**Architecture:** 后端提供图片上传 API + 静态文件服务，前端提供上传组件

**Tech Stack:** FastAPI, Next.js, python-multipart

---

## 文件结构

- Create: `backend/app/routers/upload.py` - 上传 API
- Modify: `backend/app/models.py` - 添加 cover_image
- Modify: `backend/app/main.py` - 注册路由 + 静态文件
- Create: `frontend/components/ImageUpload.tsx` - 上传组件
- Modify: `frontend/app/admin/posts/[id]/page.tsx` - 封面图

---

## Task 1: 后端 - 数据模型添加 cover_image

**Files:**
- Modify: `backend/app/models.py`

- [ ] **Step 1: 在 Post 模型中添加 cover_image 字段**

```python
# 在 Post 类中添加
cover_image = Column(String(500), nullable=True)
```

- [ ] **Step 2: 运行测试验证**

Run: `cd /var/tmp/aurora/backend && uv run pytest tests/ -v --tb=no`
Expected: 46 passed

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add cover_image field to Post model"
```


## Task 2: 后端 - 上传 API

**Files:**
- Create: `backend/app/routers/upload.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建 upload.py**

```python
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5MB

@router.post("")
async def upload_image(file: UploadFile = File(...)):
    # 验证文件类型
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, detail="Unsupported file type")
    
    # 验证文件大小
    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, detail="File too large (max 5MB)")
    
    # 生成文件名
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
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

- [ ] **Step 2: 在 main.py 注册路由和静态文件**

```python
from fastapi.staticfiles import StaticFiles
from app.routers import upload

app.include_router(upload.router)
app.mount("/static", StaticFiles(directory="backend/static"), name="static")
```

- [ ] **Step 3: 运行测试验证**

Run: `cd /var/tmp/aurora/backend && uv run pytest tests/ -v --tb=no`
Expected: 46 passed

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/upload.py backend/app/main.py
git commit -m "feat: add image upload API"
```


## Task 3: 前端 - 上传组件

**Files:**
- Create: `frontend/components/ImageUpload.tsx`

- [ ] **Step 1: 创建 ImageUpload 组件**

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X } from 'lucide-react';

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

export function ImageUpload({ value, onChange, disabled }: ImageUploadProps) {
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleUpload = async (file: File) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');

      const data = await res.json();
      onChange(data.url);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative w-full h-40 border rounded-lg overflow-hidden">
          <img src={value} alt="Cover" className="w-full h-full object-cover" />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => onChange('')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center ${
            dragActive ? 'border-primary' : 'border-muted'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            拖拽图片到这里，或点击选择
          </p>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            id="image-upload"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            disabled={disabled || loading}
          />
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={() => document.getElementById('image-upload')?.click()}
            disabled={disabled || loading}
          >
            {loading ? '上传中...' : '选择图片'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 运行 lint**

Run: `cd /var/tmp/aurora && pnpm lint`
Expected: All checks passed

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ImageUpload.tsx
git commit -m "feat: add ImageUpload component"
```


## Task 4: 前端 - 文章编辑页面集成封面图

**Files:**
- Modify: `frontend/app/admin/posts/[id]/page.tsx`

- [ ] **Step 1: 在文章编辑页面添加封面图上传**

在 form 中添加:
```tsx
import { ImageUpload } from '@/components/ImageUpload';

<div>
  <label className="block text-sm font-medium mb-1">封面图</label>
  <ImageUpload
    value={formData.cover_image || ''}
    onChange={(url) => setFormData({ ...formData, cover_image: url || undefined })}
  />
</div>
```

同时更新 formData 类型和状态:
```tsx
const [formData, setFormData] = useState<Partial<PostCreate>>({
  // ...existing fields
  cover_image: undefined,
});
```

- [ ] **Step 2: 运行 lint**

Run: `cd /var/tmp/aurora && pnpm lint`
Expected: All checks passed

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/posts/[id]/page.tsx
git commit -m "feat: add cover image upload to post editor"
```


## Task 5: 最终验证

- [ ] **Step 1: 运行完整测试**

Run: `cd /var/tmp/aurora && pnpm test`
Expected: All tests pass

- [ ] **Step 2: 运行 lint**

Run: `cd /var/tmp/aurora && pnpm lint`
Expected: All checks passed

---

## 验收

- [ ] Post.cover_image 字段添加
- [ ] 图片上传 API 正常工作
- [ ] 文件类型/大小验证
- [ ] 文章封面图上传功能
- [ ] 46 测试通过
- [ ] Lint 通过

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-11-image-upload.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
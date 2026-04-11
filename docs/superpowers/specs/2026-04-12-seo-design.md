# X-Blog SEO 设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. 功能

### 1.1 Meta 标签
- 文章标题、描述、作者
- Open Graph (Facebook/LinkedIn 分享)
- Twitter Card
- JSON-LD 结构化数据

### 1.2 Sitemap
- `/sitemap.xml` 端点
- 自动生成，包含所有文章

### 1.3 RSS
- `/rss.xml` 端点
- 文章标题、链接、描述、发布时间

## 2. 技术实现

### 2.1 Meta 标签
- 修改 Next.js layout.tsx 和文章详情页
- 使用 next/font 优化
- JSON-LD 通过脚本注入

### 2.2 Sitemap
- 使用 next-sitemap 或自定义 API 端点
- 动态生成

### 2.3 RSS
- 自定义 API 端点返回 XML 格式

## 3. 前端

### 页面
- `/sitemap.xml` - 站点地图
- `/rss.xml` - RSS 订阅

## 4. 后端

### API
- `GET /api/posts` - 支持 limit 参数，用于 sitemap/rss
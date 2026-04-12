# X-Blog 性能优化设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. 优化项

### 1.1 图片优化

- 使用 Next.js Image 组件
- 配置 remotePatterns/CDN
- 添加图片占位符 (blur)
- 响应式图片

### 1.2 缓存优化

- API 响应缓存 (unstable_cache)
- 数据预加载 (generateStaticParams)
- 静态页面生成 (SSG)

### 1.3 代码分割

- 动态导入 (next/dynamic)
- 路由预加载 (link prefetch)
- 组件懒加载

## 2. 实现

### 2.1 图片

- 更新 Markdown 渲染支持 next/image
- 配置 next.config.mjs image 域名

### 2.2 缓存

- 部分页面使用 generateStaticParams 静态生成
- API 响应添加缓存头

### 2.3 代码分割

- 动态导入评论组件
- 配置 link prefetch

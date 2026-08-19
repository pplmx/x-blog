# X-Blog 安全头与内容安全策略 (CSP)

本文档记录 X-Blog 全站的安全响应头与 Content-Security-Policy 现状、设计取舍与验证方式（RIL DEC-057 里程碑，TASK-125/126/127）。

## 覆盖范围

系统有两个提供 HTTP 响应的来源，各自携带独立的安全头：

| 来源          | 位置                                                          | 说明                                                                      |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 后端 API      | `backend/nova/app/middleware/security.py`                     | FastAPI 返回的 JSON/`/docs`；通过 `add_security_headers` 中间件逐响应设置 |
| 前端 SSR HTML | `frontend/aura/server/plugins/csp.ts` + `server/utils/csp.ts` | Nuxt 渲染的文档页面；通过 nitro `render:html` 钩子逐请求设置              |

## 前端 HTML 的策略

Nuxt 4 移除了 `csp` 配置项，因此策略由 nitro 插件在 `render:html` 钩子中发出：

1. 为每个请求生成一次性 nonce（`randomBytes(18).toString("base64url")`）；
2. 把所有 SSR 内联 `<script>`（importmap、主题 bootstrap、JSON-LD、Nuxt 载荷）打上
   `nonce="<nonce>"`；
3. 在响应头写入嵌入同一 nonce 的 `Content-Security-Policy`。

```text
default-src 'self'
script-src 'self' 'nonce-<n>'      # 无 'unsafe-inline'：内联脚本必须持有 nonce
style-src 'self' 'unsafe-inline'   # KaTeX/Mermaid 在浏览器运行时注入 <style>/style=""
img-src 'self' data: blob: https:
font-src 'self' data:
connect-src 'self' https://api.iconify.design https://api.unisvg.com https://api.simplesvg.com [apiUrl]
object-src 'none'
base-uri 'self'
frame-ancestors 'none'
form-action 'self'
```

### 设计取舍

- **`script-src` 无 `'unsafe-inline'`**：这是本次加固的核心。内联脚本（含 Nuxt
  载荷）只有在持有每请求 nonce 时才执行；同源 Vite 打包产物走 `'self'`。
- **`style-src 'unsafe-inline'` 是刻意保留的**：KaTeX 与 Mermaid 在浏览器端运行时
  注入 `<style>` 标签与 `style=""` 属性。内联样式是比内联脚本更低的风险类别（不执行
  代码），且方案经过浏览器验证（`e2e/csp.spec.ts`）。
- **`connect-src` 允许 iconify 图标 API**：`components/Icon.vue` 包装的
  `@iconify/vue` 在运行时按需从 `api.iconify.design`（及其备用 `api.unisvg.com` /
  `api.simplesvg.com`）拉取 lucide 图标 JSON（只读数据，非脚本）。离线打包
  （`addCollection` + `@iconify-json/lucide`）是未来优化，届时可移除这些域名。
- **SRI 不在范围内**：所有脚本/样式均为同源 Vite 打包产物，没有第三方 CDN 引用，
  SRI 针对的 CDN 篡改威胁模型不成立（DEC-057 记录为范围取舍而非缺口）。
- **开发模式放宽**：`import.meta.dev` 下额外允许 `'unsafe-inline'`/`'unsafe-eval'`
  以及 `ws://localhost:*`/`http://localhost:*`，保证 vite HMR 可用；生产构建不受影响。

### 其余安全头（前端 HTML）

与后端一致的基础头集合（`server/utils/csp.ts` 的 `HTML_SECURITY_HEADERS`）：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`（结合 CSP 的 `frame-ancestors 'none'`）
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

## 后端 API 的策略

API 不渲染用户 HTML（只返回 JSON 与开发用 Swagger UI / ReDoc 文档页），所以策略是
保守基线而不是前端那样的严格 nonce 方案。`script-src 'unsafe-inline'` 仅用于让
CDN 托管的 Swagger UI / ReDoc 引导脚本（含内联配置对象）继续工作；本源上没有用户可控
脚本执行。

```text
default-src 'self'
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com
style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com
font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com
img-src 'self' data: https://fastapi.tiangolo.com
connect-src 'self'
object-src 'none'
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

后端其余头（`Referrer-Policy`、`Permissions-Policy`、`Cross-Origin-Opener-Policy`、
nosniff、XFO、XSS、HSTS）与前端一致，由 `add_security_headers` 中间件通过
`setdefault` 施加——路由显式设置的头（如 CSV 导出的 `X-Content-Type-Options` /
`Content-Disposition`）不会被覆盖。

## 验证

- **单元测试**：`frontend/aura/tests/server/csp.spec.ts`（nonce 注入、策略构建、
  开发放宽、iconify/apiUrl 放行；16 例）；`backend/nova/tests/test_errors.py`
  （后端安全头与 `/docs` CSP 放行回归）。
- **浏览器验证（关键）**：`frontend/aura/e2e/csp.spec.ts` 提供 live-browser
  验证（DEC-051 曾因无法在真实浏览器验证而推迟本项）：断言 CSP 头带 nonce、所有内联
  脚本携带该 nonce、`script-src` 无 `'unsafe-inline'`；首页与含 KaTeX/Mermaid 的文章页
  **零 CSP 违规控制台错误**；暗色主题 bootstrap 内联脚本在策略下真实执行（暗色模式
  生效）且 JSON-LD 完整。
- 运行方式：`cd frontend/aura && pnpm test:e2e e2e/csp.spec.ts`（CI 的 `e2e-test`
  job 在真实浏览器与 PostgreSQL 后端下运行全部 e2e）。

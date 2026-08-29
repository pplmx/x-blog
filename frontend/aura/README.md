# Nuxt Alternative Frontend

A Nuxt 4 alternative frontend for X-Blog, running in parallel with the Next.js app.

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (port 34567)
pnpm dev
```

前端自带同源 API 代理（`server/routes/api/[...path].ts`）：浏览器只请求 Nuxt 自身的
`/api/**`，由 Nuxt 服务端转发到后端（默认目标 `http://localhost:18888`）。因此**开发时
不要设置 `NUXT_API_URL`** —— 该变量会被注入浏览器端 `runtimeConfig.public.apiUrl`，使
浏览器绕过代理跨源直连后端并触发 CORS 预检；一旦用局域网 IP（如
`http://10.112.9.49:34567`）访问站点，所有接口都会 `Failed to fetch`
（详见 `docs/deployment.md`「本地分离部署」）。无论用 `localhost` 还是 IP 访问，走同源
代理都不产生跨域。

后端在别的机器上时，用服务端专属变量指定代理转发目标（不会注入浏览器端）：

```bash
echo "NUXT_PROXY_TARGET=http://<后端IP>:18888" > .env
```

## Environment Variables

| Variable            | Default                  | Description                                   |
| ------------------- | ------------------------ | --------------------------------------------- |
| `NUXT_PROXY_TARGET` | `http://localhost:18888` | Nuxt 服务端代理转发的后端地址（不注入浏览器） |
| `NUXT_SITE_URL`     | `http://localhost:3000`  | 站点 URL（SEO/OG 等）                         |

## Build

```bash
pnpm build
pnpm preview
```

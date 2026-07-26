# Nuxt Alternative Frontend

A Nuxt 4 alternative frontend for X-Blog, running in parallel with the Next.js app.

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (port 13334)
NUXT_API_URL=http://localhost:18888 pnpm dev
```

## Environment Variables

| Variable       | Default                  | Description     |
| -------------- | ------------------------ | --------------- |
| `NUXT_API_URL` | `http://localhost:18888` | Backend API URL |

## Build

```bash
pnpm build
pnpm preview
```

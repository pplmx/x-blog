FROM node:24-alpine AS base

# Install pnpm
FROM base AS pnpm
RUN corepack enable pnpm && corepack prepare pnpm@latest --activate

# Build stage
FROM pnpm AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["node", "server.js"]
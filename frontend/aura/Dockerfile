# =============================================================================
# Frontend Dockerfile - Multi-stage build for Nuxt 4 (Nitro server)
# =============================================================================
# Multi-stage build for Nuxt 4 (Nitro server).

# -----------------------------------------------------------------------------
# Stage 1: Base - Node.js with pnpm
# -----------------------------------------------------------------------------
FROM node:24.8.1-alpine3.20 AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# -----------------------------------------------------------------------------
# Stage 2: Dependencies - Install node_modules
# -----------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Copy dependency files first for better caching
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (build needs dev deps for nuxt build)
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3: Builder - Build the application
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build the application (outputs to .output/)
ENV NUXT_TELEMETRY_DISABLED=1
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 4: Production - Minimal runtime image
# -----------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built artifacts from builder
COPY --from=builder --chown=nextjs:nodejs /app/.output ./
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Also copy package.json for any runtime-only deps
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./

# Install production dependencies for the Nitro server
RUN pnpm install --prod --frozen-lockfile

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Start the Nitro server
CMD ["node", ".output/server/index.mjs"]

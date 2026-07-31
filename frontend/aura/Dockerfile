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

# Copy dependency files first for better caching. pnpm-workspace.yaml +
# pnpm-approved.json are required: without them pnpm 11 treats the project
# as a non-workspace and never runs the approved esbuild postinstall, so
# `nuxt build` fails with a missing esbuild binary.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml pnpm-approved.json ./

# Install all dependencies (build needs dev deps for nuxt build).
# --ignore-scripts: the postinstall would run `nuxt prepare`, but
# nuxt.config.ts is not copied into this stage yet; the builder stage
# runs the real `nuxt build` (which prepares itself).
RUN pnpm install --frozen-lockfile --ignore-scripts

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

# Copy font assets needed by the OG image generator
COPY --from=builder --chown=nextjs:nodejs /app/assets/fonts ./assets/fonts

# Also copy package.json + pnpm files for any runtime-only deps
# (--frozen-lockfile needs the lockfile and workspace config)
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/pnpm-approved.json ./

# Install production dependencies for the Nitro server. --ignore-scripts:
# the postinstall would run `nuxt prepare`, which needs the app source
# (nuxt.config.ts) that the runner stage deliberately doesn't have.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Start the Nitro server
CMD ["node", ".output/server/index.mjs"]

# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────
# QuoteMate · multi-stage Dockerfile for Railway / Fly / any Docker host
# Vercel ignores this file (uses its own build pipeline).
# Build: docker build -t quotemate-automation .
# Run:   docker run -p 3000:3000 --env-file .env.local quotemate-automation
# ─────────────────────────────────────────────────────────────────────

# ─── Base image — pinned Node 20 LTS Alpine ──────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ─── Stage 1: install dependencies ───────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ─── Stage 2: build the Next.js app ──────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Build-time env vars must be present here for any NEXT_PUBLIC_* values
# baked into the client bundle. Railway/Vercel inject these from the
# project's environment variable settings; locally pass via --build-arg
# or just let them be missing (page.tsx etc. read them at runtime).
RUN pnpm build

# ─── Stage 3: minimal runtime ────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as non-root for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only what the standalone server needs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Railway sets PORT dynamically; Next.js's standalone server.js honours it.
# Locally and on most other hosts, default 3000.
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
EXPOSE 3000

CMD ["node", "server.js"]

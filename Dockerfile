# syntax=docker/dockerfile:1

# Fallback deployment image for the @focal-ai/web Next.js app (pnpm monorepo).
# Build from the repo root:  docker build -t focal-web .
# Run:                       docker run --rm -p 3000:3000 -e QLOO_MOCK=1 focal-web
# Live mode needs QLOO_API_KEY (hackathon key) passed at run time; never baked in.

FROM node:24-slim AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app

# Manifests + workspace config first so the install layer caches on lockfile changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @focal-ai/web build

FROM node:24-slim AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Next standalone output mirrors the monorepo root, so the server lives at
# apps/web/server.js. Static assets and public/ are not traced; copy them in.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# Production image for the whole product: the Hono API and the built SPA served
# from one origin, on one port. Same-origin is a hard requirement, not a
# convenience - the Better Auth browser client derives its base URL from
# window.location.origin and ignores VITE_API_URL, so splitting the origins
# breaks sign-in. Serving both here also removes the need for a reverse proxy
# that knows about /api, /connections and /telegram (see OPS.md).
#
# Build context is the REPOSITORY ROOT (both apps and the workspace manifests):
#   docker build -t spend-tracker .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable

# Workspace manifests first so dependency layers cache across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

# Backend build.
COPY apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY apps/backend/src ./apps/backend/src
RUN pnpm --filter backend build

# Web build. No VITE_APP_MODE is set, so the real login gate stays active, and
# VITE_API_URL defaults to /api, which is same-origin here.
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/index.html ./apps/web/
COPY apps/web/src ./apps/web/src
# Static documents served verbatim next to the SPA (privacy policy, terms).
# Vite copies public/ into dist/ as-is.
COPY apps/web/public ./apps/web/public
RUN pnpm --filter web exec vite build

FROM node:22-slim AS runtime
WORKDIR /repo
RUN corepack enable
# node:22-slim ships with neither curl nor wget, and Coolify's container
# healthcheck shells out to one of them. Without this the app starts correctly
# and is still marked unhealthy, which rolls the deployment back.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV TZ=America/Lima
# Consumed by apps/backend/src/index.ts to enable static serving. Relative to
# WORKDIR, which is what @hono/node-server's serveStatic resolves against.
ENV WEB_DIST_PATH=./apps/web/dist

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN pnpm install --filter backend --frozen-lockfile --prod

COPY --from=build /repo/apps/backend/dist ./apps/backend/dist
COPY --from=build /repo/apps/web/dist ./apps/web/dist

EXPOSE 3000
CMD ["node", "apps/backend/dist/index.js"]

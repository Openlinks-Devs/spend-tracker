# Build with the REPOSITORY ROOT as the Docker context (the backend depends on
# the workspace root: pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.base.json):
#   docker build -f apps/backend/Dockerfile -t spend-tracker .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN pnpm install --filter backend --frozen-lockfile
# Backend sources (tsconfig.json extends ../../tsconfig.base.json copied above).
COPY apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY apps/backend/src ./apps/backend/src
RUN pnpm --filter backend build

FROM node:22-slim AS runtime
WORKDIR /repo
RUN corepack enable
ENV NODE_ENV=production
ENV TZ=America/Lima
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN pnpm install --filter backend --frozen-lockfile --prod
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist
EXPOSE 3000
CMD ["node", "apps/backend/dist/index.js"]

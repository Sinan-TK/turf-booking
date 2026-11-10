# syntax=docker/dockerfile:1
#
# One image recipe for every app in the monorepo. Pick the app with the APP build argument:
#   docker build --build-arg APP=api   -t turf-api   .
#   docker build --build-arg APP=web   -t turf-web   .   (also owner, admin)
# docker-compose.yml builds and runs all four. No secrets go into an image: the API's settings (database URL, keys)
# are given to the container when it starts. The web apps only bake in their NEXT_PUBLIC_* values, which are public.

FROM node:26-slim AS base
# openssl: the Prisma query engine needs it. corepack: installs the pnpm version the repo pins.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

# Dependencies come first and from the package manifests alone, so this layer is reused until a dependency changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/e2e/package.json apps/e2e/
COPY apps/owner/package.json apps/owner/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

# The shared packages (built once, reused by every app), then the chosen app.
FROM deps AS build
COPY . .
RUN pnpm db:generate \
 && pnpm --filter @venue/shared build \
 && pnpm --filter @venue/config build \
 && pnpm --filter @venue/database build
ARG APP
RUN test -n "$APP" || (echo "Set --build-arg APP=api|web|owner|admin" && exit 1)
RUN pnpm --filter @venue/${APP} build

FROM build AS run
ARG APP
ENV APP=${APP}
# `start` is `node dist/main.js` for the API and `next start` (on the app's own port) for the web apps.
CMD ["sh", "-c", "pnpm --filter @venue/${APP} start"]

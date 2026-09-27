# The game's production image: the built client and the bundled server, one
# Node process (docker-compose.prod.yml runs it behind nginx). The same three
# stages as lawcel's image; the differences are a pnpm workspace to install
# and a server bundle to build.

FROM node:26-slim AS base
# Node 25 and later ship without corepack, so pnpm comes from npm, pinned to
# the version package.json's packageManager names. Without its install script
# pnpm runs through node rather than a native binary, which is all a build
# needs.
RUN npm install -g --ignore-scripts pnpm@12.4.1

FROM base AS build
WORKDIR /workspace
# Manifests first, so the install layer is reused until a dependency changes.
# pnpm-workspace.yaml's allowBuilds lets esbuild's install script run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/ packages/
# The commit being built. The server reports it at /api/health and the client
# carries it in index.html (<meta name="animath-build">).
ARG GIT_SHA=dev
ENV VITE_BUILD_SHA=$GIT_SHA
# The client's source maps stay out of the image: served, they would hand
# anyone the whole source of a private repo, comments and all. (The server's
# stay: they make its stack traces readable, and nothing serves them.)
RUN pnpm build && find packages/client/dist -name '*.map' -delete

FROM node:26-slim AS production
LABEL org.opencontainers.image.source=https://github.com/ulfaslak/mathgame
# The server finds the client at ../client/dist, from where it runs.
WORKDIR /app/packages/server
COPY --from=build /workspace/packages/client/dist /app/packages/client/dist
COPY --from=build /workspace/packages/server/dist ./dist
COPY --from=build /workspace/packages/server/drizzle ./drizzle
ARG GIT_SHA=dev
ENV NODE_ENV=production GIT_SHA=$GIT_SHA
USER node
EXPOSE 3000
# dist/migrate.mjs applies the migrations; scripts/deploy.sh runs it before a
# new image takes any traffic.
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

# syntax=docker/dockerfile:1
#
# SERVE single-domain image: one Node process serving the API (/api),
# Socket.IO (/socket.io) and the three web apps (/, /staff/, /admin/).
#
# Everything is built from source inside the image: the backend, the staff
# and admin apps (Vite) and the student web app (Flutter), with the same
# scripts/build-web.mjs as a build outside Docker. A host that builds from Git
# (Render) therefore needs nothing prebuilt. The public Firebase web values are
# build arguments; Render passes a service's environment variables to the
# Docker build automatically:
#   docker build --build-arg FIREBASE_API_KEY=<web api key> \
#                --build-arg FIREBASE_PROJECT_ID=<project id> -t serve .
# Runtime configuration (database, Firebase service account, payment mode)
# comes from the environment when the container runs; no secret is a build
# argument or part of the image.
#
#   CMD                                   the server only
#   backend/scripts/start-production.sh   migrations + release tasks + server
#                                         (Render, see render.yaml)
# One-off tasks with the Prisma CLI and tsx use the build stage:
#   docker build --target build -t serve-tools .
# See docs/deployment.md and docs/render.md.

ARG NODE_VERSION=22.22.0
# Keep in step with the Flutter version the student app is developed with.
ARG FLUTTER_VERSION=3.47.4
ARG FLUTTER_SHA256=5b45f0ceda99b9bebdc873e7e69f6450aeb4c30f454b505e2e62fc9255a907d3

# Workspace manifests: npm needs all of them to install from the lockfile.
FROM node:${NODE_VERSION}-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/contracts/package.json packages/contracts/
COPY packages/web-shared/package.json packages/web-shared/
COPY apps/staff/package.json apps/staff/
COPY apps/admin/package.json apps/admin/
COPY e2e/package.json e2e/

FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY backend backend
RUN npm run build --workspace backend

FROM manifests AS deps
RUN npm ci --omit=dev --no-audit --no-fund && rm -rf node_modules/@serve

# The official Flutter SDK, checked against its published SHA-256. The full
# (non-slim) Node image already has the curl, git, unzip and xz Flutter needs.
FROM node:${NODE_VERSION}-bookworm AS flutter
ARG FLUTTER_VERSION
ARG FLUTTER_SHA256
RUN curl -fsSLo /tmp/flutter.tar.xz \
    "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
  && echo "${FLUTTER_SHA256}  /tmp/flutter.tar.xz" | sha256sum -c - \
  && tar -xJf /tmp/flutter.tar.xz -C /opt \
  && rm /tmp/flutter.tar.xz \
  && git config --global --add safe.directory /opt/flutter
ENV PATH=/opt/flutter/bin:$PATH
RUN flutter config --no-analytics && flutter precache --web

# The three web apps, exactly as `npm run build:web` builds them.
FROM flutter AS web
WORKDIR /app
COPY --from=build /app /app
COPY packages packages
COPY apps apps
COPY scripts/build-web.mjs scripts/
ARG FIREBASE_API_KEY
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_AUTH_DOMAIN=""
RUN node scripts/build-web.mjs

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=5001 \
    WEB_ROOT=/app/web
WORKDIR /app
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/backend/package.json /app/backend/prisma.config.ts backend/
COPY --from=build /app/backend/prisma backend/prisma
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/scripts/start-production.sh backend/scripts/
COPY --from=web /app/dist/web web
USER node
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "backend/dist/server.js"]

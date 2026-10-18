# syntax=docker/dockerfile:1
#
# SERVE single-domain image: one Node process serving the API (/api),
# Socket.IO (/socket.io) and the three web apps (/, /staff/, /admin/).
#
# The web apps are built BEFORE `docker build` (the Flutter SDK is not part of
# this image), so the image contains exactly what you built and tested:
#   FIREBASE_API_KEY=<web api key> FIREBASE_PROJECT_ID=<project id> npm run build:web
#   docker build -t serve .
# One-off tasks (migrations, catalogue seed, admin provisioning) use the build
# stage, which has the Prisma CLI and tsx:
#   docker build --target build -t serve-tools .
# Runtime configuration (database, Firebase service account, payment mode)
# comes from the environment at `docker run`; none of it is baked in.
# See docs/deployment.md.

ARG NODE_VERSION=22.22.0

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

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=5001 \
    WEB_ROOT=/app/web
WORKDIR /app
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist
COPY dist/web web
USER node
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "backend/dist/server.js"]

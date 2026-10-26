#!/bin/sh
# Production start for hosts without a separate release step (Render's free
# plan has no pre-deploy command and no shell). In order:
#   1. prisma migrate deploy   applies pending migrations; never resets or drops data
#   2. release tasks           first-boot catalogue, optional first admin (src/ops/release.ts)
#   3. the server              exec'd, so it receives SIGTERM for a graceful shutdown
# If step 1 or 2 fails the server does not start, and the platform keeps the
# previous deploy running. Run from anywhere; needs the production environment.
set -eu
cd "$(dirname "$0")/.."
../node_modules/.bin/prisma migrate deploy
node dist/ops/release.js
exec node dist/server.js

FROM node:24-slim AS build-base

# Install build tooling needed to compile native dependencies during npm install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

FROM node:24-slim AS runner-base

# Install only the runtime tools the production container needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gosu \
    mariadb-client \
    && rm -rf /var/lib/apt/lists/*

FROM build-base AS deps
WORKDIR /app

# Copy package.json files only (no lockfile). The lockfile is generated on
# macOS and lacks Linux platform-specific optional packages like
# @swc/core-linux-arm64-gnu and @parcel/watcher-linux-arm64-glibc.
# Without the lockfile constraint, npm install resolves the correct
# platform packages on the target Linux host.
COPY package.json ./
COPY apps/web/package.json ./apps/web/

# Install dependencies (including devDependencies for build)
RUN npm install --workspace=apps/web

FROM build-base AS prod-deps
WORKDIR /app
COPY package.json ./
COPY apps/web/package.json ./apps/web/
RUN npm install --omit=dev --workspace=apps/web

FROM build-base AS builder
ARG IMAGE_BASE_URL
ARG UPLOAD_MAX_TOTAL_BYTES
ENV IMAGE_BASE_URL=${IMAGE_BASE_URL}
ENV UPLOAD_MAX_TOTAL_BYTES=${UPLOAD_MAX_TOTAL_BYTES}
WORKDIR /app
# Full node_modules for build step (includes devDependencies needed by next build)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/apps/web
RUN node scripts/ensure-site-config.mjs

# Build the app
RUN npm run build

FROM runner-base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Disable next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV UPLOAD_ORIGINAL_ROOT="/app/data/uploads/original"

# Copy necessary files from apps/web (public is mounted at runtime)
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=builder --chown=node:node /app/apps/web/scripts/migrate.js ./apps/web/scripts/migrate.js
COPY --from=builder --chown=node:node /app/apps/web/scripts/mysql-connection-options.js ./apps/web/scripts/mysql-connection-options.js
COPY --chown=node:node apps/web/scripts/entrypoint.sh /usr/local/bin/

# Production dependencies for migrate.js (needs argon2, mysql2, drizzle-orm natively).
# Standalone output already bundles runtime deps — this is only for the migration script.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Create persistence directories and cache
RUN mkdir -p apps/web/public/uploads /app/data/uploads/original apps/web/.next/cache && chown -R node:node apps/web/public/uploads /app/data apps/web/.next

# Make entrypoint executable
RUN chmod +x /usr/local/bin/entrypoint.sh

# Health check — liveness only. Keep DB-aware readiness on /api/health so a
# transient DB outage does not restart an otherwise-live web process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/live').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Expose port
EXPOSE 3000

# Use entrypoint to handle permissions/user switching
ENTRYPOINT ["entrypoint.sh"]

# Start command
CMD ["sh", "-c", "node apps/web/scripts/migrate.js && node apps/web/server.js"]

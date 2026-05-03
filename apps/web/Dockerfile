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

# Copy package manifests with the committed lockfile so container builds are
# reproducible and install exactly the reviewed dependency graph.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

# Install dependencies (including devDependencies for build).
# Sharp ships prebuilt platform-specific binaries via optionalDependencies
# (@img/sharp-linux-arm64 etc.). Some macOS-generated package-lock.json
# files do not propagate the linux-arm64 binary into the container even
# though the lockfile lists it; the symptom is `Could not load the
# "sharp" module using the linux-arm64 runtime` at build time.
#
# Fix: install the workspace deps, then EXPLICITLY install Sharp's
# platform-specific prebuilt binary as a top-level dep (no-save) so it
# lands in /app/node_modules/@img regardless of how the optional-dep
# resolver chose at `npm ci` time. TARGETARCH is auto-populated by
# buildx (defaults to arm64 to match the gallery.atik.kr Mac mini).
ARG TARGETARCH
RUN npm ci --workspace=apps/web --include=optional && \
    npm install --workspace=apps/web --include=optional --no-save \
        @img/sharp-linux-${TARGETARCH:-arm64} \
        @img/sharp-libvips-linux-${TARGETARCH:-arm64}

FROM build-base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev --workspace=apps/web

FROM build-base AS builder
ARG BASE_URL
ARG IMAGE_BASE_URL
ARG UPLOAD_MAX_TOTAL_BYTES
ENV BASE_URL=${BASE_URL}
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

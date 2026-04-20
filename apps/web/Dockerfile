FROM node:24-slim AS base

# Install system dependencies needed for sharp and better-sqlite3 + gosu
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gosu \
    mariadb-client \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app

# Copy package.json and lock file from monorepo root
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

# Install dependencies (including devDependencies for build)
RUN npm ci --workspace=apps/web

FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev --workspace=apps/web

FROM base AS builder
WORKDIR /app
# Full node_modules for build step (includes devDependencies needed by next build)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/apps/web
# Use real site-config.json if present in build context, otherwise fall back to example
RUN if [ ! -f src/site-config.json ]; then cp src/site-config.example.json src/site-config.json; fi

# Build the app
RUN npm run build

FROM base AS runner
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
COPY --chown=node:node apps/web/scripts/entrypoint.sh /usr/local/bin/

# Production dependencies for migrate.js (needs argon2, mysql2, drizzle-orm natively).
# Standalone output already bundles runtime deps — this is only for the migration script.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Create persistence directories and cache
RUN mkdir -p apps/web/public/uploads /app/data/uploads/original apps/web/.next/cache && chown -R node:node apps/web/public/uploads /app/data apps/web/.next

# Make entrypoint executable
RUN chmod +x /usr/local/bin/entrypoint.sh

# Health check — verifies the app is responsive and DB is reachable
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Expose port
EXPOSE 3000

# Use entrypoint to handle permissions/user switching
ENTRYPOINT ["entrypoint.sh"]

# Start command
CMD ["sh", "-c", "node apps/web/scripts/migrate.js && node apps/web/server.js"]

FROM node:26-slim AS build-base

# Supply-chain note: keep this base on the latest Node 24 LTS line, and record
# the resolved `node:24-slim` digest in deploy/build logs before changing this
# file. Debian security package updates are intentionally consumed from the
# base image rather than frozen in apt install lines.

# Install build tooling needed to compile native dependencies during npm install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

FROM node:26-slim AS runner-base

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
# Native binaries that ship per-platform via optionalDependencies. The
# macOS-authored lockfile sometimes fails to materialize the linux-arm64
# variants inside the container even though the lockfile lists them, so
# we install every needed Linux native explicitly with --no-save. Order
# matters: dependent libvips before sharp.
RUN npm ci --workspace=apps/web --include=optional && \
    case "${TARGETARCH:-arm64}" in \
        amd64) npm_arch="x64" ;; \
        arm64) npm_arch="arm64" ;; \
        *) echo "Unsupported TARGETARCH=${TARGETARCH:-unset}; expected amd64 or arm64" >&2; exit 1 ;; \
    esac && \
    npm install --workspace=apps/web --include=optional --no-save \
        @img/sharp-libvips-linux-${npm_arch}@1.2.4 \
        @img/sharp-linux-${npm_arch}@0.34.5 \
        @parcel/watcher-linux-${npm_arch}-glibc@2.5.6 \
        @swc/core-linux-${npm_arch}-gnu@1.15.43 \
        @next/swc-linux-${npm_arch}-gnu@16.2.10 \
        lightningcss-linux-${npm_arch}-gnu@1.32.0

# Guarantee the workspace-nested tree exists even if a future lockfile hoists
# everything to the root — the builder stage COPYs this path unconditionally.
RUN mkdir -p apps/web/node_modules

FROM build-base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
ARG TARGETARCH
# Runtime deps need the same Linux-native Sharp workaround as the build deps:
# `sharp` is externalized from the standalone bundle and is required by uploads,
# topic covers, CLIP image embedding, and per-photo OG generation at runtime.
RUN npm ci --omit=dev --workspace=apps/web && \
    case "${TARGETARCH:-arm64}" in \
        amd64) npm_arch="x64" ;; \
        arm64) npm_arch="arm64" ;; \
        *) echo "Unsupported TARGETARCH=${TARGETARCH:-unset}; expected amd64 or arm64" >&2; exit 1 ;; \
    esac && \
    npm install --workspace=apps/web --omit=dev --include=optional --no-save \
        @img/sharp-libvips-linux-${npm_arch}@1.2.4 \
        @img/sharp-linux-${npm_arch}@0.34.5 && \
    node -e "require('sharp')"

# Guarantee the workspace-nested tree exists even if a future lockfile hoists
# everything to the root — the runner stage COPYs this path unconditionally.
RUN mkdir -p apps/web/node_modules

FROM build-base AS builder
ARG BASE_URL
ARG IMAGE_BASE_URL
ARG UPLOAD_MAX_TOTAL_BYTES
ARG NEXT_UPLOAD_BODY_MAX_BYTES
ENV BASE_URL=${BASE_URL}
ENV IMAGE_BASE_URL=${IMAGE_BASE_URL}
ENV UPLOAD_MAX_TOTAL_BYTES=${UPLOAD_MAX_TOTAL_BYTES}
ENV NEXT_UPLOAD_BODY_MAX_BYTES=${NEXT_UPLOAD_BODY_MAX_BYTES}
WORKDIR /app
# Full node_modules for build step (includes devDependencies needed by next build)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Workspace-nested node_modules: npm's workspace installer places some
# packages under apps/web/node_modules instead of hoisting them to the root
# (e.g. drizzle-kit 0.31.x and its private esbuild tree, per the committed
# package-lock.json layout). The root COPY above only brings /app/node_modules,
# and `COPY . .` cannot supply the nested tree because the build context
# excludes node_modules — so without this line the in-image `next build`
# typecheck fails with TS2307 "Cannot find module 'drizzle-kit'" in
# drizzle.config.ts (tsconfig includes **/*.ts). The deps stage guarantees the
# directory exists via `mkdir -p` even if a future lockfile hoists everything.
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

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
ENV HOSTNAME="127.0.0.1"
ENV UPLOAD_ORIGINAL_ROOT="/app/data/uploads/original"
# CLIP model weights root — weights are NOT baked into the image.
# They are seeded once on the deploy host into ./data/models/clip (the ./data
# bind mount persists across deploys) and loaded at runtime by the CLIP encoder.
# See "CLIP semantic search" ops note in CLAUDE.md for the seed procedure.
ENV CLIP_MODELS_ROOT="/app/data/models/clip"
# R14C14 / C14-01: take ownership of POSIX signal handling. Next's standalone
# server (start-server.js) installs its OWN SIGTERM handler that calls
# process.exit(143) unless NEXT_MANUAL_SIG_HANDLE is set. With the cycle-13
# `exec` fix node IS PID 1 and DOES receive Docker's SIGTERM — but that SIGTERM
# would then fire BOTH Next's handler AND the app's gracefulShutdown
# (instrumentation.ts), racing to process.exit(): whichever wins truncates the
# other, nondeterministically cutting off the view-count buffer flush and
# clobbering the deliberate 0/1 exit code with 143. Setting this makes the app's
# instrumentation handler the sole shutdown owner, so the flush + exit code are
# honored deterministically. (Trade-off: Next's in-flight-HTTP server.close()
# drain is also suppressed; consistent with the app's "flush then exit promptly"
# design — the deploy recreates the container regardless.)
ENV NEXT_MANUAL_SIG_HANDLE=true

# Copy necessary files from apps/web. Immutable public assets are packaged in
# the image; only public/uploads and public/resources are mounted at runtime.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=builder --chown=node:node /app/apps/web/scripts/migrate.js ./apps/web/scripts/migrate.js
COPY --from=builder --chown=node:node /app/apps/web/scripts/mysql-connection-options.js ./apps/web/scripts/mysql-connection-options.js
COPY --from=builder --chown=node:node /app/apps/web/scripts/restore-maintenance-recovery.mjs ./apps/web/scripts/restore-maintenance-recovery.mjs
COPY --chown=node:node apps/web/scripts/entrypoint.sh /usr/local/bin/

# Production dependencies outside standalone output: migrate.js needs argon2,
# mysql2, and drizzle-orm, while runtime paths need externalized native packages
# such as sharp for uploads, topic covers, CLIP image embedding, and OG cards.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Workspace-nested runtime deps (same class as the builder-stage nested copy):
# today every nested package under apps/web/node_modules is dev-only, so this
# copies an empty directory — but if a future lockfile nests a PRODUCTION dep
# there, the runtime would break without it. prod-deps guarantees the source
# directory exists via `mkdir -p`.
COPY --from=prod-deps --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules

# Create persistence directories and cache.
# /app/data/models/clip is created here so the path exists even before the
# ./data bind mount is populated; the actual weights are seeded on the host.
RUN mkdir -p apps/web/public/uploads apps/web/public/resources /app/data/uploads/original /app/data/models/clip apps/web/.next/cache && chown -R node:node apps/web/public/uploads apps/web/public/resources /app/data apps/web/.next

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

# Start command.
# `exec` replaces the shell with the node process AFTER migrate.js completes, so
# `node server.js` becomes PID 1 and receives Docker's SIGTERM directly. Without
# `exec`, the non-interactive `sh -c` stays PID 1 and does NOT forward SIGTERM to
# its child, so the app's graceful-shutdown handler (instrumentation.ts) never
# runs and the container is SIGKILLed at stop_grace_period (exit 137) on every
# deploy — silently dropping the view-count buffer flush (R13C13 / AGG-R13-01).
CMD ["sh", "-c", "node apps/web/scripts/migrate.js && exec node apps/web/server.js"]

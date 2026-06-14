#!/bin/bash
set -euo pipefail

# Gallery Deployment Script
# Must be run from the repo root (e.g., /home/ubuntu/gallery)

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "Pulling latest changes..."
git pull --ff-only

echo "Starting Gallery Deployment..."

# Check if .env.local exists
if [ ! -f apps/web/.env.local ]; then
    echo "Error: apps/web/.env.local file not found!"
    echo "Please create apps/web/.env.local with DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, SESSION_SECRET, and ADMIN_PASSWORD."
    exit 1
fi

if [ ! -f apps/web/src/site-config.json ]; then
    echo "Error: apps/web/src/site-config.json file not found!"
    echo "Copy apps/web/src/site-config.example.json to apps/web/src/site-config.json and customize it before deploying."
    exit 1
fi

echo "Building and Starting Containers..."

# Build and start detached (docker-compose.yml references Dockerfile via relative paths from repo root)
docker compose -f apps/web/docker-compose.yml up -d --build

# --- Docker disk hygiene (run on EVERY deploy) -------------------------------
# The deploy host has 124 G total; repeated rebuilds accumulate stale images +
# BuildKit cache that have previously filled the disk to 100 % and broken the
# next `git pull` ("No space left on device"). Reclaim that space every deploy.
#
# DATA SAFETY — in-use data is NEVER deleted, guaranteed three ways:
#   1. GalleryKit persistence is BIND MOUNTS, not Docker volumes:
#        ./data  -> /app/data                  (originals + DB backups)
#        ./public -> /app/apps/web/public       (processed derivatives)
#        ./src/site-config.json                 (config, read-only)
#      Bind mounts are host directories; `docker volume prune` cannot touch them.
#   2. MySQL runs on the host (network_mode: host, 127.0.0.1) — there is no DB
#      Docker volume to prune.
#   3. Pruning runs AFTER a successful `up -d` (set -e aborts earlier on failure),
#      so the live `gallerykit-web` container + its just-built image are "in use"
#      and survive `image prune -a`. `volume prune` (no -a) only removes
#      anonymous/dangling volumes, never named ones.
# Each prune is best-effort (|| true) so a cleanup hiccup never fails a good deploy.
echo "Cleaning up old/unused Docker artifacts (in-use bind-mounted data is never touched)..."
docker container prune -f || true     # stopped containers only — the running web container survives
docker image prune -af || true        # images unused by any container — the new live image is kept
docker builder prune -af || true      # BuildKit cache — the biggest reclaim on repeated rebuilds
docker volume prune -f || true        # anonymous/dangling volumes only — gallery data is bind-mounted, not a volume
df -h / || true                       # report remaining disk so a near-full host is visible in deploy logs

echo "Deployment Complete!"
echo "App is running at http://localhost:3000"
echo "Data is persisted under apps/web/data and apps/web/public"

#!/bin/bash
set -euo pipefail

# Gallery Deployment Script
# Must be run from the repo root (e.g., /home/ubuntu/gallery)

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "Pulling latest changes..."
git pull --ff-only

echo "Starting Gallery Deployment..."

env_file="apps/web/.env.local"

# Check if .env.local exists and is private before Docker Compose consumes it.
if [ ! -f "$env_file" ]; then
    echo "Error: $env_file file not found!"
    echo "Please create $env_file with DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, SESSION_SECRET, and ADMIN_PASSWORD."
    exit 1
fi

if [ ! -O "$env_file" ]; then
    echo "Refusing to deploy with runtime env file not owned by the current user: $env_file" >&2
    exit 1
fi

env_mode="$(stat -c '%a' "$env_file" 2>/dev/null || true)"
if [[ -z "$env_mode" ]]; then
    env_mode="$(stat -f '%Lp' "$env_file")"
fi
if [[ ! "$env_mode" =~ ^[0-7]+$ ]]; then
    echo "Error: could not determine numeric runtime env file permissions ($env_mode): $env_file" >&2
    exit 1
fi
env_perms=$((10#$env_mode))
env_group_perms=$(((env_perms / 10) % 10))
env_world_perms=$((env_perms % 10))
if (( env_group_perms != 0 || env_world_perms != 0 )); then
    echo "Refusing to deploy with unsafe runtime env file permissions ($env_mode): $env_file" >&2
    echo "Run: chmod 600 \"$env_file\"" >&2
    exit 1
fi

if [ ! -f apps/web/src/site-config.json ]; then
    echo "Error: apps/web/src/site-config.json file not found!"
    echo "Copy apps/web/src/site-config.example.json to apps/web/src/site-config.json and customize it before deploying."
    exit 1
fi

echo "Building and Starting Containers..."

# Build and start detached. The explicit env file keeps build args and runtime
# env in sync even when Docker Compose is launched from the repo root.
docker compose --env-file "$env_file" -f apps/web/docker-compose.yml up -d --build

echo "Waiting for gallerykit-web health..."
health_deadline=$((SECONDS + 90))
health_ok=0
while [ "$SECONDS" -lt "$health_deadline" ]; do
    health_status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' gallerykit-web 2>/dev/null || true)"
    if [ "$health_status" = "healthy" ]; then
        health_ok=1
        break
    fi
    if command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/live >/dev/null 2>&1; then
        health_ok=1
        break
    fi
    sleep 2
done

if [ "$health_ok" -ne 1 ]; then
    echo "Error: gallerykit-web did not become healthy after deploy."
    docker logs --tail 120 gallerykit-web || true
    exit 1
fi

# --- Docker disk hygiene (run on EVERY deploy) -------------------------------
# The deploy host has 124 G total; repeated rebuilds accumulate stale images +
# BuildKit cache that have previously filled the disk to 100 % and broken the
# next `git pull` ("No space left on device"). Reclaim that space every deploy.
#
# DATA SAFETY — in-use data is NEVER deleted, guaranteed three ways:
#   1. GalleryKit persistence is BIND MOUNTS, not Docker volumes:
#        ./data  -> /app/data                  (originals + DB backups)
#        ./public/uploads -> /app/apps/web/public/uploads       (processed derivatives)
#        ./public/resources -> /app/apps/web/public/resources   (topic covers)
#        ./src/site-config.json                 (config, read-only)
#      Other immutable public assets come from the freshly built image.
#      Bind mounts are host directories; `docker volume prune` cannot touch them.
#   2. MySQL runs on the host (network_mode: host, 127.0.0.1) — there is no DB
#      Docker volume to prune.
#   3. Pruning runs AFTER a successful `up -d` AND a bounded health check,
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
echo "Data is persisted under apps/web/data, apps/web/public/uploads, and apps/web/public/resources"

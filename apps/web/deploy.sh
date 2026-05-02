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

echo "Deployment Complete!"
echo "App is running at http://localhost:3000"
echo "Data is persisted under apps/web/data and apps/web/public"

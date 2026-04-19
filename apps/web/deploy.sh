#!/bin/bash

# Gallery Deployment Script
# Must be run from the repo root (e.g., /home/ubuntu/gallery)

echo "Pulling latest changes..."
git pull

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting Gallery Deployment..."

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "Error: .env.local file not found!"
    echo "Please create apps/web/.env.local with DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, SESSION_SECRET, and ADMIN_PASSWORD."
    exit 1
fi

echo "Building and Starting Containers..."

# Build and start detached
docker compose up -d --build

echo "Deployment Complete!"
echo "App is running at http://localhost:3000"
echo "Data is persisted under apps/web/data and apps/web/public"

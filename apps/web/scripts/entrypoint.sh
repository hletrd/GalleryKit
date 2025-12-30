#!/bin/sh
set -e

# Fix permissions on data directory (if mounted as root)
chown -R node:node /app/data
chown -R node:node /app/apps/web/public/uploads

# Ensure .next folder exists and has correct permissions
# Create cache directory explicitly to avoid runtime EACCES
# Ensure .next/cache exists (Next.js needs this to be writable)
mkdir -p /app/apps/web/.next/cache

# Fix permissions for the entire .next directory
# This is crucial because standard COPY commands might leave some files as root
# or the cache directory created above constitutes a new permission requirement
if [ -d "/app/apps/web/.next" ]; then
    chown -R node:node /app/apps/web/.next
fi

# Set UV_THREADPOOL_SIZE to CPU count if not set
if [ -z "$UV_THREADPOOL_SIZE" ]; then
    if command -v nproc > /dev/null; then
        export UV_THREADPOOL_SIZE=$(nproc)
    else
        export UV_THREADPOOL_SIZE=4
    fi
    echo "Auto-configured UV_THREADPOOL_SIZE=$UV_THREADPOOL_SIZE"
fi

# Drop privileges and execute command
exec gosu node "$@"

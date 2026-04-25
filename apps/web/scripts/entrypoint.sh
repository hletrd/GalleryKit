#!/bin/sh
set -e

# Fix permissions on data directory only if not already owned by node
if [ "$(stat -c '%U' /app/data 2>/dev/null || echo root)" != "node" ]; then
    chown -R node:node /app/data
fi
if [ "$(stat -c '%U' /app/apps/web/public/uploads 2>/dev/null || echo root)" != "node" ]; then
    chown -R node:node /app/apps/web/public/uploads
fi

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
        detected_parallelism=$(nproc)
    else
        detected_parallelism=4
    fi
    if [ "$detected_parallelism" -gt 8 ]; then
        detected_parallelism=8
    fi
    export UV_THREADPOOL_SIZE="$detected_parallelism"
    echo "Auto-configured UV_THREADPOOL_SIZE=$UV_THREADPOOL_SIZE"
fi

# Drop privileges and execute command
exec gosu node "$@"

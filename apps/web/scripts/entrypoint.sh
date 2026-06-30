#!/bin/sh
set -e

ensure_node_writable_dir() {
    dir="$1"
    mkdir -p "$dir"
    if [ "$(stat -c '%U' "$dir" 2>/dev/null || echo root)" != "node" ]; then
        chown node:node "$dir"
    fi
    if ! gosu node sh -c "test -w \"\$1\"" sh "$dir"; then
        echo "Error: $dir is not writable by node. Fix host ownership before deploy, for example: chown -R 3000:3000 $dir" >&2
        exit 1
    fi
}

ensure_node_writable_dir /app/data
ensure_node_writable_dir /app/data/backups
ensure_node_writable_dir /app/data/uploads
ensure_node_writable_dir /app/data/uploads/original
ensure_node_writable_dir /app/apps/web/public/uploads
ensure_node_writable_dir /app/apps/web/public/uploads/avif
ensure_node_writable_dir /app/apps/web/public/uploads/jpeg
ensure_node_writable_dir /app/apps/web/public/uploads/webp
ensure_node_writable_dir /app/apps/web/public/resources

# Ensure .next folder exists and has correct permissions
# Create cache directory explicitly to avoid runtime EACCES
# Ensure .next/cache exists (Next.js needs this to be writable)
ensure_node_writable_dir /app/apps/web/.next/cache

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

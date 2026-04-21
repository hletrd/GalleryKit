#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing deploy env file: $ENV_FILE" >&2
  echo "Copy .env.deploy.example to .env.deploy and customize DEPLOY_CMD first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DEPLOY_CMD:?Missing DEPLOY_CMD in $ENV_FILE}"

echo "[deploy] Running DEPLOY_CMD from $ENV_FILE"
exec bash -lc "$DEPLOY_CMD"

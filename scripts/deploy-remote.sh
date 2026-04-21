#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy}"

expand_tilde_path() {
  local value="${1:-}"
  if [[ "$value" == "~" ]]; then
    printf '%s\n' "$HOME"
    return
  fi

  if [[ "$value" == "~/"* ]]; then
    printf '%s/%s\n' "$HOME" "${value#~/}"
    return
  fi

  printf '%s\n' "$value"
}

build_deploy_command() {
  local host="${DEPLOY_HOST:-}"
  local user="${DEPLOY_USER:-}"
  local path="${DEPLOY_PATH:-}"
  local key="${DEPLOY_KEY:-}"
  local remote_script="${DEPLOY_REMOTE_SCRIPT:-bash apps/web/deploy.sh}"

  : "${host:?Missing DEPLOY_HOST in $ENV_FILE}"
  : "${user:?Missing DEPLOY_USER in $ENV_FILE}"
  : "${path:?Missing DEPLOY_PATH in $ENV_FILE}"

  local remote_cmd
  printf -v remote_cmd 'cd %q && %s' "$path" "$remote_script"

  local -a command=(ssh)
  if [[ -n "$key" ]]; then
    key="$(expand_tilde_path "$key")"
    command+=(-i "$key")
  fi

  command+=("${user}@${host}" "$remote_cmd")
  printf '%q ' "${command[@]}"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing deploy env file: $ENV_FILE" >&2
  echo "Copy .env.deploy.example to .env.deploy and customize DEPLOY_HOST / DEPLOY_USER / DEPLOY_PATH (or DEPLOY_CMD) first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

deploy_cmd="${DEPLOY_CMD:-}"
if [[ -z "$deploy_cmd" ]]; then
  deploy_cmd="$(build_deploy_command)"
fi

echo "[deploy] Running deploy command from $ENV_FILE"
exec bash -lc "$deploy_cmd"

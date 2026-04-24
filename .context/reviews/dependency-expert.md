# Cycle 3 Dependency / Runtime / API / Package Review

## Scope inspected

Reviewed the dependency and runtime contract surfaces in this repo:

- `package.json`, `package-lock.json`
- `apps/web/package.json`
- `apps/web/Dockerfile`, `apps/web/docker-compose.yml`
- `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/eslint.config.mjs`
- `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/queue-shutdown.ts`
- environment/docs cross-checks in `README.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/.dockerignore`

## Verification

- `npm audit --json` → **0 vulnerabilities**
- `npm run typecheck --workspace=apps/web` → **passed**

## Findings

### DE-01 — Docker build/runtime env drift breaks build-time Next config
- **Status:** confirmed
- **Severity:** HIGH
- **Confidence:** HIGH
- **File / region:** `apps/web/Dockerfile:21-44`, `apps/web/docker-compose.yml:13-17`, `apps/web/.dockerignore:1-8`, `apps/web/next.config.ts:1-96`
- **What’s wrong:** `next.config.ts` reads `process.env.IMAGE_BASE_URL` and `process.env.UPLOAD_MAX_TOTAL_BYTES` at build time, but the Docker path never passes those values into the build. `.dockerignore` excludes `.env*`, and `docker-compose.yml` only injects `.env.local` into the **runtime** container via `env_file`, not the build stage. Docker/Next docs both treat build args / build-phase config as separate from runtime container env.
- **Failure scenario:** An operator follows the docs, sets `IMAGE_BASE_URL` or a custom upload cap in `apps/web/.env.local`, then runs `docker compose ... --build`. The resulting image is built without those values, so `remotePatterns` / CSP allowances remain at defaults and any custom request-body limit diverges between the framework and the app. CDN-hosted optimized images can fail, and custom upload-size deployments can become inconsistent or reject traffic unexpectedly.
- **Suggested fix:** Thread the build-time values through `docker-compose.yml` `build.args` and matching `ARG` / build-stage `ENV` declarations in `apps/web/Dockerfile`, or add a prebuild gate that fails when required build-time settings are only present in runtime env.
- **Risk:** the image is reproducible only for the default env set; any non-default deployment config can silently bake the wrong Next runtime contract.

### DE-02 — mysql2 session init race leaves `GROUP_CONCAT` at default on Drizzle query path
- **Status:** confirmed
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **File / region:** `apps/web/src/db/index.ts:28-67`, `apps/web/src/lib/data.ts:398-417`, `apps/web/src/app/[locale]/admin/db-actions.ts:33-99`
- **What’s wrong:** The pool-connection hook issues `SET group_concat_max_len = 65535` asynchronously, but `mysql2/promise`’s `query`/`execute` paths call the core pool’s `getConnection()` / `query()` flow and do **not** wait for that per-connection promise. The `getConnection` wrapper only protects explicit `pool.getConnection()` callers; the app’s main Drizzle paths use `db.select(...)`, which goes through pool queries directly. That means a fresh connection can start a `GROUP_CONCAT` query before the session variable has finished applying.
- **Failure scenario:** Under startup churn or when the pool creates a new connection, one of the `GROUP_CONCAT` queries in `apps/web/src/lib/data.ts` or the CSV export in `apps/web/src/app/[locale]/admin/db-actions.ts` can still run at MySQL’s default 1024-byte limit and silently truncate long tag lists.
- **Suggested fix:** Do not rely on an async `connection` event for session state. Either gate all query entry points on an awaited per-connection bootstrap before the first statement runs, or remove the session dependence and replace the affected tag-aggregation queries with a strategy that does not depend on `group_concat_max_len`.
- **Risk:** truncation is silent, so the symptom is data loss in exports / tag displays rather than a hard error.

## Sources used for the dependency/runtime claims

- Docker Compose build args: https://docs.docker.com/reference/compose-file/build/
- Dockerfile ARG scoping: https://docs.docker.com/reference/dockerfile/
- Next.js config phase/build behavior: https://nextjs.org/docs/app/api-reference/config/next-config-js
- mysql2 promise pool / core pool behavior:
  - https://raw.githubusercontent.com/sidorares/node-mysql2/master/lib/promise/pool.js
  - https://raw.githubusercontent.com/sidorares/node-mysql2/master/lib/base/pool.js

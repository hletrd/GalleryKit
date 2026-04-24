# Dependency / Release Review — PROMPT 1, cycle 4/100

Repository scope reviewed: package/config/deploy files, dependency versions, scripts, Docker/runtime assumptions, package-lock health, security posture, external library usage, and dependency-driven performance hazards.

## Executive summary
- Security posture is currently clean: `npm audit --omit=dev` reported **0 vulnerabilities**.
- I did **not** flag the Docker MariaDB client choice as a hard mismatch; MariaDB documents that the legacy `mysql` name remains available as a Unix symlink to `mariadb`.
- The main actionable risks are a **TypeScript 6 / typescript-eslint compatibility gap**, a **prerelease migration tool release risk**, and a **CPU/threadpool oversubscription hazard** in the native image/auth hot path.

## Findings

### 1) TypeScript 6 is outside the declared typescript-eslint support window
- **Severity:** medium
- **Confidence:** high
- **Classification:** confirmed
- **File / region:** `apps/web/package.json:63-70`; `package-lock.json:5794-5810`; `package-lock.json:3368-3609`
- **What I found:** The app pins `typescript` to `^6`, while `eslint-config-next` pulls in `typescript-eslint` 8.50.0 and the locked `@typescript-eslint/*` packages declare a peer range of `>=4.8.4 <6.0.0`.
- **Concrete failure scenario:** a clean install or a future lockfile refresh can leave the lint/type tooling in an unsupported state. That can surface as peer-dependency warnings today and as lint/parser breakage or incompatible rule behavior after the next TypeScript 6.x minor or a typescript-eslint update.
- **Suggested fix:** either pin TypeScript below 6 until the lint stack explicitly supports 6, or upgrade the `typescript-eslint` / ESLint stack to a release line that declares TS 6 support before allowing the TypeScript major to float.
- **Primary source:** https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/package.json

### 2) `drizzle-kit` is pinned to a prerelease line with documented breakage risk
- **Severity:** low/medium
- **Confidence:** medium
- **Classification:** risk
- **File / region:** `apps/web/package.json:56-63`; `package-lock.json:4941-4955`
- **What I found:** `drizzle-kit` is locked to `1.0.0-beta.9-e89174b`. Drizzle’s own beta release notes explicitly warn that the v1 beta line can introduce breaking changes.
- **Concrete failure scenario:** schema generation or migration commands can change behavior between lockfile refreshes or after a registry re-resolve, which can turn a routine deploy or database bootstrap into a migration drift incident.
- **Suggested fix:** move to a stable `drizzle-kit` release if one matches the schema workflow, or keep this prerelease line tightly pinned and covered by migration-focused CI so lockfile regeneration does not happen casually.
- **Primary source:** https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2

### 3) Native image processing and password hashing can oversubscribe CPU / libuv threads in containers
- **Severity:** medium
- **Confidence:** medium
- **Classification:** likely risk
- **File / region:** `apps/web/scripts/entrypoint.sh:24-31`; `apps/web/src/lib/process-image.ts:16-23`; `apps/web/src/app/actions/auth.ts:57-66, 157-160`
- **What I found:** the entrypoint sets `UV_THREADPOOL_SIZE` from `nproc`, and `process-image.ts` sets sharp concurrency from `os.cpus().length - 1`. Node’s docs say `os.cpus().length` should not be used to estimate application parallelism, and sharp’s docs note that its concurrency maps to libvips thread creation and is capped by the libuv threadpool.
- **Concrete failure scenario:** on a container with a tight CPU quota but many host cores, the process can start far more native workers than the container can actually run. A batch photo import or a burst of login checks can then saturate the event loop, inflate queue time, and degrade unrelated requests.
- **Suggested fix:** use `os.availableParallelism()` or a small fixed cap for both sharp and `UV_THREADPOOL_SIZE`, and keep the defaults conservative rather than deriving them from host CPU count.
- **Primary sources:** https://nodejs.org/download/release/v20.9.0/docs/api/os.html ; https://www.npmjs.com/package/sharp/v/0.9.3?activeTab=readme

## Checks that passed
- `npm audit --omit=dev` reported **0 vulnerabilities**.
- The Docker runtime client choice looks internally consistent: MariaDB docs state the `mysql` command remains available as a Unix symlink on Unix-like systems.

## Notes
- I did not find a package-lock integrity failure that blocked installation.
- I did not flag `apps/web/Dockerfile` / `apps/web/docker-compose.yml` as a runtime package mismatch beyond the CPU/threadpool concern above.

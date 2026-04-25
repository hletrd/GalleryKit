# Dependency / Toolchain / Runtime Review — Cycle 8, Prompt 1

Scope reviewed: root/workspace manifests, lockfile, `.nvmrc`, Next/TypeScript config, Docker/Compose, CI, deploy scripts, and dependency-sensitive source (`next.config.ts`, `proxy.ts`, `process-image.ts`, `auth.ts`, `image-queue.ts`, `content-security-policy.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `.github/workflows/quality.yml`).

Checks run:
- `npm audit --json --audit-level=high`
- `npm outdated --workspace=apps/web --json --long`
- `npm ls --workspace=apps/web --depth=0 --json`

## Executive summary

I found **2 confirmed issues** and **1 likely runtime risk**:

1. **TypeScript 6 is outside the supported `typescript-eslint` peer range**.
2. **Next still locks a vulnerable PostCSS 8.4.31 copy through its transitive dependency tree**.
3. **The image-processing/auth native-thread heuristics can oversubscribe CPU-limited containers**.

I did **not** find a Node/Next/React engine mismatch, a next-intl peer mismatch, or a Docker/CI version skew.

## Findings

### 1) TypeScript 6 is not supported by the pinned `typescript-eslint` stack

- **Severity:** medium
- **Confidence:** high
- **Classification:** confirmed
- **Files / regions:** `apps/web/package.json:56-70`; `package-lock.json:3360-3387,3399-3422`
- **What I found:** the app pins `typescript` to `^6`, but the locked `@typescript-eslint/*` packages declare `typescript: ">=4.8.4 <6.0.0"` in their peer dependencies.
- **Failure scenario:** a clean install, lockfile refresh, or lint-stack update can leave the repo in an unsupported state. That can show up as peer warnings today and parser/rule breakage or inconsistent lint behavior once the toolchain is re-resolved against TS 6.
- **Concrete fix:** either pin TypeScript below 6 until the lint stack explicitly supports TS 6, or upgrade the ESLint / `typescript-eslint` line to a release that declares TS 6 support before allowing the TypeScript major to float.
- **Sources:** https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/package.json

### 2) The PostCSS override does not remove the vulnerable `next`-scoped copy

- **Severity:** medium
- **Confidence:** high
- **Classification:** confirmed
- **Files / regions:** `apps/web/package.json:7-10`; `package-lock.json:7978-7990,8116-8139`
- **What I found:** the root override pins `postcss`, but the lockfile still records `next@16.2.3` depending on `postcss@8.4.31`. `npm audit` reports GHSA-qx2v-qp2m-jg93 (“PostCSS has XSS via Unescaped </style> in its CSS Stringify Output”) against that version path.
- **Failure scenario:** any build-time or server-side CSS stringification path that reaches this PostCSS copy can trigger the advisory. The app does not appear to process arbitrary user CSS, so exploitability is constrained, but the dependency tree still ships a known moderate security issue.
- **Concrete fix:** regenerate the lockfile so the `next`-scoped PostCSS resolution is at least `8.5.10` as well, or move to a Next/PostCSS combination that no longer pins the vulnerable version. Re-run `npm ls postcss` and `npm audit` afterward to verify the vulnerable path is gone.
- **Sources:** https://github.com/advisories/GHSA-qx2v-qp2m-jg93 ; https://www.npmjs.com/package/next/v/16.2.3

### 3) Native worker sizing is derived from host CPUs, which can oversubscribe containers

- **Severity:** medium
- **Confidence:** medium
- **Classification:** likely
- **Files / regions:** `apps/web/scripts/entrypoint.sh:24-31`; `apps/web/src/lib/process-image.ts:16-23`; `apps/web/src/app/actions/auth.ts:157-160`
- **What I found:** the entrypoint sets `UV_THREADPOOL_SIZE` from `nproc`, and `process-image.ts` sets `sharp.concurrency()` from `os.cpus().length - 1`. Node’s own docs recommend `os.availableParallelism()` for parallelism sizing, and sharp documents that its concurrency is bounded by libuv’s threadpool.
- **Failure scenario:** on a CPU-limited container with a larger host core count, the process can start too many native workers. A burst of uploads or login checks can then saturate libuv threads and delay unrelated requests.
- **Concrete fix:** switch both sizing heuristics to `os.availableParallelism()` or a deliberately small fixed cap, and keep `UV_THREADPOOL_SIZE` conservative instead of mirroring host core count.
- **Sources:** https://nodejs.org/download/release/v20.9.0/docs/api/os.html#osavailableparallelism ; https://nodejs.org/download/release/v12.22.6/docs/api/cli.html#uv_threadpool_size_size ; https://sharp.pixelplumbing.com/performance/ ; https://sharp.pixelplumbing.com/api-utility/

## Manual-validation / maintenance notes

- **Workspace install drift:** `npm ls --workspace=apps/web --json` currently reports `postcss@8.5.9` as invalid against the workspace override, while the committed lockfile intends `8.5.10` at the root (`package-lock.json:8566-8569`). This is not a committed repo defect, but it means local audit output can be misleading until `npm ci` refreshes the install tree.
- **`drizzle-kit` prerelease pin:** `apps/web/package.json:56-63` uses a prerelease build. I did not flag it as a defect because the current lock is exact and the registry metadata is recent, but any migration-tool refresh should be regression-tested before changing that line.

## Missed-issues sweep

- **Node/Next runtime alignment:** `.nvmrc:1`, `apps/web/package.json:5-7`, `apps/web/Dockerfile:1-16`, and `.github/workflows/quality.yml:42-49` all converge on Node 24. That is above Next 16’s minimum Node requirement, so I did not find a runtime-version mismatch.
- **next-intl compatibility:** `package-lock.json:8031-8055` shows `next-intl@4.9.1` explicitly supports Next 16 and React 19, so there is no peer-range conflict there.
- **Native package packaging:** `apps/web/next.config.ts:30-33` externalizes `sharp`, and `apps/web/Dockerfile:50-70` ships the runtime deps needed for the standalone server plus migration scripts. I did not find a native-module bundling mismatch.
- **Deployment/body-size layering:** `apps/web/src/lib/upload-limits.ts:1-25`, `apps/web/next.config.ts:52-58`, and `apps/web/nginx/default.conf:20-23,60-65` keep the app, Next runtime, and nginx upload ceilings broadly aligned.

## Verdict

**Recommendation: REQUEST CHANGES**

Reason: the repo currently carries one confirmed compatibility gap (`typescript` 6 vs. `typescript-eslint`) and one confirmed security issue in the dependency tree (`next` → `postcss@8.4.31`). The threadpool sizing issue is likely but lower urgency; it should be fixed in the same pass if you are touching the native-image or auth hot path.

# Verifier review — cycle 1

## Verdict
PARTIAL

## Scope checked
I reviewed the repo claims and runtime assumptions across:
- docs: `README.md`, `CLAUDE.md`, `apps/web/README.md`
- config/scripts: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/proxy.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/seed-e2e.ts`, `apps/web/deploy.sh`, `.github/workflows/quality.yml`
- route guards and auth/runtime helpers: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`
- guarded routes/actions: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- targeted tests: request-origin, action-guards, backup-download-route, health-route, live-route, next-config, gallery-config-shared, restore-maintenance, rate-limit, auth-rate-limit, auth-rate-limit-ordering, public-actions, session, serve-upload, storage-local, db-pool-connection-handler, revalidation, validation, check-action-origin, check-api-auth

## Findings

### 1) Fresh-clone / CI build breaks when `src/site-config.json` is absent
**Severity:** high
**Confidence:** high

**Evidence:**
- `apps/web/.gitignore:49` ignores `/src/site-config.json`, so a clean checkout does not contain the required file.
- `apps/web/scripts/ensure-site-config.mjs:4-8` hard-fails if `src/site-config.json` is missing.
- `.github/workflows/quality.yml:48-76` runs `npm run build` and `npm run test:e2e` but never creates/copies `apps/web/src/site-config.json`.
- `apps/web/deploy.sh:21-24` separately documents the same file as required.
- I verified the failure path locally by removing the file and running `npm run build --workspace=apps/web`; `ensure-site-config.mjs` aborted immediately with the missing-file error.

**Failure scenario:**
On GitHub Actions, or any fresh clone that follows the repo instructions but does not manually create `apps/web/src/site-config.json`, the build/test pipeline fails before Next.js finishes building. That blocks CI and any automated deploy path that starts from a clean checkout.

**Fix:**
Add a deterministic prep step before build/test in CI, for example copying `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json` (or generating an equivalent default), or commit a checked-in default that the app can build from. Make the workflow and deploy path use the same rule.

### 2) E2E seed script loads `.env.local` too late to honor local overrides
**Severity:** low
**Confidence:** medium

**Evidence:**
- `apps/web/scripts/seed-e2e.ts:1-24` imports `UPLOAD_ROOT` / `UPLOAD_ORIGINAL_ROOT` and computes `SEED_IMAGE_SIZES` before `dotenv.config(...)` runs.
- `apps/web/playwright.config.ts:5-9` preloads `.env.local` for the standard Playwright path, which hides the ordering bug in the normal `npm run test:e2e` flow.

**Failure scenario:**
If someone runs `npm run e2e:seed` directly, or another script reuses it without preloading env first, any `UPLOAD_ROOT`, `UPLOAD_ORIGINAL_ROOT`, or `IMAGE_SIZES` values from `.env.local` are ignored. The script then seeds derivatives into the wrong directories and/or with the wrong size set, which can make E2E assets drift from the app configuration.

**Fix:**
Move `dotenv.config(...)` to the top of `seed-e2e.ts` before importing `upload-paths` and before computing `SEED_IMAGE_SIZES`, or document that the script requires preloaded env and does not self-load `.env.local`.

## Verification notes
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run test --workspace=apps/web -- --run src/__tests__/request-origin.test.ts src/__tests__/action-guards.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/health-route.test.ts src/__tests__/live-route.test.ts src/__tests__/next-config.test.ts src/__tests__/gallery-config-shared.test.ts src/__tests__/restore-maintenance.test.ts src/__tests__/rate-limit.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/auth-rate-limit-ordering.test.ts src/__tests__/public-actions.test.ts src/__tests__/session.test.ts src/__tests__/serve-upload.test.ts src/__tests__/storage-local.test.ts src/__tests__/db-pool-connection-handler.test.ts src/__tests__/revalidation.test.ts src/__tests__/validation.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-api-auth.test.ts` passed (20 files, 151 tests).
- `npm run build --workspace=apps/web` passes when `apps/web/src/site-config.json` exists and fails immediately when it is absent, confirming the build gate is real.

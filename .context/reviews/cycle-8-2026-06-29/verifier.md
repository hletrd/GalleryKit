# Cycle 8 Verifier Report

Date: 2026-06-29
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `d43f9fc5` (`fix(cycle-7): harden upload processing contracts`)
Scope: evidence-based verifier pass against docs, tests, scripts, schema, config, and source. No implementation files were edited.

## Inventory

Required first reads:
- `AGENTS.md`
- `CLAUDE.md`

Review-relevant inventory inspected:
- Project docs and contracts: `CLAUDE.md`, `README.md`, `AGENTS.md`, `.env.deploy.example`, `.gitignore`, package scripts.
- Prior review and plan context: `.context/reviews/_aggregate.md`, current run/cycle review directories, Cycle 7 findings, and targeted deferred/prior-context files to avoid duplicates.
- Gate scripts and fixtures: `apps/web/scripts/check-action-origin.ts`, `check-api-auth.ts`, `check-public-route-rate-limit.ts`, `typecheck-scripts.mjs`, `migrate.js`, `deploy.js`, `verify-migration-journal.mjs`, and matching tests under `apps/web/src/__tests__/`.
- Schema and migrations: `apps/web/drizzle/**/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`, and migration reconciliation code.
- Server actions and routes: `apps/web/src/app/actions/**`, public and admin API routes, sitemap/image routes, localized pages, admin pages, and shared page modules.
- Core data and processing code: `apps/web/src/lib/data.ts`, `process-image.ts`, `image-queue.ts`, semantic search modules, privacy guards, rate-limit modules, and analytics code.
- UI surfaces relevant to prior findings: tag filter/home client, admin navigation, upload/settings/token pages, grid/image source handling, and Korean messages.
- Config/deploy/runtime surfaces: root and workspace `package.json`, Next/TS/Vitest configs, Docker/NGINX/deploy scripts, PWA service worker generation.

Skipped intentionally:
- Binary assets, uploads/runtime data, `.next`, generated caches, ignored env/secrets, and screenshot artifacts.
- Historical review bodies were not exhaustively re-reviewed after targeted duplicate checks, because current source and active aggregate were the evidence base.

## Findings

### C8-V-01: Action-origin documentation still claims `public.ts` is excluded, but the scanner now enforces a public-action sub-contract

Severity: Low
Confidence: High
Status: Confirmed
Type: docs/comment/test-name mismatch with a security-gate contract

Evidence:
- `CLAUDE.md:590-602` says `lint:action-origin` excludes basenames `auth` and `public`, and repeats that `auth.ts` and `public.ts` are intentionally excluded by name.
- `apps/web/scripts/check-action-origin.ts:47-72` excludes only basename `auth`.
- `apps/web/scripts/check-action-origin.ts:328-342` has an explicit `actions/public.ts` branch that allows exempt public mutations only when `publicActionCallsRateLimitBeforeMutation(body)` proves a pre-mutation public rate-limit call.
- `apps/web/src/__tests__/check-action-origin.test.ts:383-393` has a stale test title saying it excludes `auth.* and public.*`, but the assertions prove `public.tsx` is discovered.
- `apps/web/src/__tests__/check-action-origin.test.ts:476-501` tests the current intended public analytics behavior: exempt public mutations pass only with pre-insert rate limiting and fail without it.
- `apps/web/src/app/actions/public.ts:311-314` still says `public.ts` is excluded from the action-origin gate by name, while `apps/web/src/app/actions/public.ts:352-400` contains exempt public analytics actions whose pass/fail status is governed by the scanner's public rate-limit branch.

Concrete failure scenario:
A future maintainer follows `CLAUDE.md` or the `public.ts` header and assumes `public.ts` is outside `lint:action-origin`. They add or review a public mutating action using only an exempt comment, then misunderstand why the gate fails or, worse, document a bypass model that no longer exists. The gate currently catches missing pre-mutation rate limiting, so this is not a present auth bypass, but the stale contract makes future reviews and runbook-driven changes less reliable.

Concrete fix:
Update `CLAUDE.md:590-602` and `apps/web/src/app/actions/public.ts:311-314` to state that only `auth` is excluded by basename. Document that `public.ts` is scanned and may use `@action-origin-exempt` only for public actions that are read-only or satisfy the scanner's public rate-limit-before-mutation sub-contract. Rename `apps/web/src/__tests__/check-action-origin.test.ts:383` to match the assertions, for example "excludes auth.* while keeping public.* discoverable".

## Verified Non-Findings

- Cycle 7 upload-processing fixes are present in source: derivative generation now refreshes base width before processing, uses `Promise.allSettled` cleanup handling, and persists upload-time processing settings through queued work.
- Cycle 7 public source/state fixes are present: tag filters receive canonical current tags, failed image suppression is no longer only process-local for queue bootstrap, token administration is documented/navigable, and semantic routes return failure status for production no-embedding/enrichment-error cases instead of silent empty success.
- Fresh-install docs now tell operators to create a category before upload; this avoids duplicating the prior Cycle 7 finding.
- The current gates prove the public-action sub-contract described in C8-V-01 even though the surrounding docs/comments are stale.

## Validation Evidence

Passed:
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run lint --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm test --workspace=apps/web` (`249` files passed, `2` skipped; `2309` tests passed, `4` skipped)
- `npm run build --workspace=apps/web`

Build note:
- `npm run build --workspace=apps/web` completed successfully. During sitemap generation, local MySQL was unavailable (`ECONNREFUSED 127.0.0.1:3306`), so the sitemap fell back to homepage-only as designed. The build regenerated `apps/web/public/sw.js`; that generated verification churn was reverted so this review keeps only the report file.

Not run:
- Live MySQL migration smoke against a real database.
- Browser/Playwright visual pass.
- Production deploy.

## Final Sweep

The final missed-issue sweep rechecked docs against gate scripts, current Cycle 7 fixes against source/tests, public/admin route auth and rate-limit coverage, server action same-origin handling, migration journal/reconciliation shape, package quality gates, deploy/runtime docs, and UI surfaces tied to prior findings. No additional blocker or duplicate finding was confirmed.

# Run 10 Cycle 6 Implementation Plan

Date: 2026-07-07
Source reviews: `.context/reviews/*` and merged `.context/reviews/_aggregate.md`

## Goal

Fix the non-deferrable Cycle 6 findings while preserving broader performance, e2e, and operator-validation findings in the deferred register with original severity/confidence.

## Scheduled Fixes

### P6-01 - Restore-aware maintenance scheduler

- Review findings: AGG-C6-01 (`CQR6-01`, `TRC6-01`)
- Severity/confidence: Medium / High
- Files: `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, tests under `apps/web/src/__tests__`
- Plan:
  1. Make `runMaintenanceSweep()` skip work when `isRestoreMaintenanceActive()` is true.
  2. Track in-flight maintenance sweep promises.
  3. Expose a drain helper and call it from restore preparation after durable maintenance begins and before import.
  4. Add source/behavior regression coverage.
- Progress: implemented; focused regression coverage passed in `npm test --workspace=apps/web -- maintenance-scheduler-source auth-mutation-barrier-source image-zoom-source-contracts photo-viewer-auto-lightbox-source nginx-config`.

### P6-02 - Password-change restore mutation barrier

- Review findings: AGG-C6-02 (`DBG-C6-01`)
- Severity/confidence: Medium / High
- Files: `apps/web/src/app/actions/auth.ts`, auth tests
- Plan:
  1. Acquire `acquireAdminMutationSlot()` in `updatePassword()` after origin/maintenance admission and before long Argon2 work.
  2. Return the existing restore-in-progress message if the slot cannot be acquired.
  3. Add a source or behavior test pinning the barrier usage.
- Progress: implemented; focused regression coverage passed.

### P6-03 - Clear vulnerable nested esbuild audit

- Review findings: AGG-C6-03 (`SR6-C01`)
- Severity/confidence: Medium / High
- Files: `package.json`, `package-lock.json`, possibly `apps/web/package.json`
- Plan:
  1. Check current npm registry versions for `drizzle-kit` and relevant transitive packages.
  2. Upgrade or override the vulnerable nested `esbuild` path without using `npm audit fix --force`.
  3. Verify `npm ls esbuild --workspace=apps/web` and `npm audit --workspace=apps/web --audit-level=moderate`.
- Progress: partially mitigated and blocked by upstream stable packages. `npm view` shows latest stable `drizzle-kit` is `0.31.10`, latest stable `next` is `16.2.10`, and latest `esbuild` is `0.28.1`. Root dev `esbuild@^0.28.1` fixes the local Vite peer resolution (`npm ls esbuild --workspace=apps/web` passes). `npm audit --workspace=apps/web --audit-level=moderate` still fails because latest stable `drizzle-kit` depends on deprecated `@esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild@0.18.20`, and latest stable Next still pins nested `postcss@8.4.31`; npm proposes breaking downgrades or Next canary, neither permitted by repo/latest-stable policy.

### P6-04 - Host-neutral nginx template

- Review findings: AGG-C6-04 (`CRIT-C6-01`, `ARCH-C6-02`, `PM-C6-02`)
- Severity/confidence: Medium / High
- Files: `apps/web/nginx/default.conf`, nginx/source-contract tests, docs if needed
- Plan:
  1. Replace the active `gallery.atik.kr` server name with a host-neutral template value.
  2. Add a regression test that fails if the committed nginx template contains the demo domain as an active server name.
  3. Keep live host-nginx application as deferred/manual validation.
- Progress: implemented; focused nginx config test passed.

### P6-05 - SEO locale and site-config expectation alignment

- Review findings: AGG-C6-05 (`CRIT-C6-02`, `ARCH-C6-01`, `DOC-C6-01`, `DOC-C6-02`, `PM-C6-01`)
- Severity/confidence: Low-Medium / High
- Files: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `apps/web/messages/en.json`, tests if wording is pinned
- Plan:
  1. Clarify runtime DB SEO fields versus build-time JSON fields.
  2. Describe `seo_locale` as an OpenGraph locale fallback, not a normal route-locale override.
  3. Correct title/nav/footer ownership descriptions.
  4. Add or update source/doc contract coverage if an existing test suite covers these docs.
- Progress: implemented in docs; focused nginx/config-related tests passed. Broader docs are validated by review/provenance rather than a dedicated doc snapshot.

### P6-06 - Product copy for semantic search and trusted teams

- Review findings: AGG-C6-06 (`PM-C6-03`, `PM-C6-04`)
- Severity/confidence: Low-Medium / High
- Files: `README.md`, `apps/web/README.md`, `CLAUDE.md`
- Plan:
  1. Clarify semantic search production mode as operator-runbook-only, while disabled/stub modes are admin-testable.
  2. Replace vague "small teams" wording with trusted owner/co-admin wording.
  3. Preserve the no-editing/no-culling/no-scoring product boundary.
- Progress: implemented in README/app README/CLAUDE wording.

### P6-07 - ImageZoom pointer activation

- Review findings: AGG-C6-07 (`UXR-C6-01`)
- Severity/confidence: High / High
- Files: `apps/web/src/components/image-zoom.tsx`, tests
- Plan:
  1. Change the click guard to ignore nested interactive descendants but not the zoom container itself.
  2. Add focused regression coverage for the container-role guard.
- Progress: implemented; focused regression coverage passed.

### P6-08 - Auto-lightbox hydration safety

- Review findings: AGG-C6-08 (`UXR-C6-02`)
- Severity/confidence: Medium / High
- Files: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`, tests
- Plan:
  1. Initialize `showLightbox` deterministically to `false`.
  2. Consume `sessionStorage.gallery_auto_lightbox` after mount with Strict Mode-safe semantics.
  3. Remove first-render `sessionStorage` reads from the loading fallback or make it deterministic.
  4. Add source/e2e-style regression coverage.
- Progress: implemented; focused source regression coverage passed.

## Verification Plan

Run the full configured gates before final commit/push:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web` only if browser-flow coverage is required by the implemented changes or if the seeded environment is available

## Verification Results

- PASS: `npm run lint --workspace=apps/web`
- PASS: `npm run lint:api-auth --workspace=apps/web`
- PASS: `npm run lint:action-origin --workspace=apps/web`
- PASS: `npm run lint:public-route-rate-limit --workspace=apps/web`
- PASS after one fix: `npm run typecheck --workspace=apps/web`
- PASS: `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web`
- PASS: `npm test --workspace=apps/web`
- E2E local blocked: `npm run test:e2e --workspace=apps/web` could not start because local MySQL at `127.0.0.1:3306` refused connections during `npm run init`.
- E2E remote read-only partial: `E2E_ADMIN_ENABLED=false E2E_BASE_URL=https://gallery.atik.kr npm run test:e2e --workspace=apps/web` ran 44 tests; relevant photo hydration/lightbox/focus tests passed, but 5 tests failed because the live remote dataset does not contain local seeded fixtures (`e2e-smoke`, `E2E Landscape`, fixed share/group keys). This is recorded as a validation gap, not a source regression.
- Audit residual: `npm audit --workspace=apps/web --audit-level=moderate` still fails on latest stable upstream `drizzle-kit`/`next` chains; see P6-03.

## Commit/Deploy Plan

- Commit review/plan artifacts and implementation fixes in fine-grained signed Conventional Commit + gitmoji commits.
- If the normal hook requires a prohibited co-author trailer, use the repo-authorized git plumbing flow from the cycle prompt.
- Pull with rebase before every push.
- After all commits are pushed and gates are green, run `npm run deploy` once for per-cycle deploy.

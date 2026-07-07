# Cycle 18 Architecture Review

Role: architect
Cycle: review-plan-fix 18/100
Scope: architectural/design risks, ownership boundaries, coupling, layering, single-writer assumptions, runtime/deploy topology, module contracts, and maintainability. No source code changes were made.

## Review Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-17-2026-07-08-plan.md`, `.context/plans/cycle-17-2026-07-08-deferred.md`.

Inventory basis: `rg --files` over the app, scripts, public assets, e2e specs, and migrations found 873 files. Architectural review focused on the repo's control surfaces and shared contracts:

- Runtime/deploy topology: `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/single-writer-guard.ts`, nginx/proxy/CSP surfaces.
- State and DB ownership: `apps/web/src/db/**`, migrations/journal, `apps/web/scripts/migrate.js`, restore helpers, advisory locks, mutation barrier, background write tracking.
- Server action/API boundaries: all `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, admin/public API routes, auth/token wrappers, scanners under `apps/web/scripts/check-*.ts`.
- Image/color/semantic contracts: upload actions/routes, image queue, color backfill runner/scripts, process-image, serve-upload, service worker build/template, CLIP/semantic modules.

## Confirmed Issues

### ARCH18-01: `withAdminAuth` mixes authentication with route-specific usage mutation before route gates run

Severity: Low-Medium
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/src/lib/api-auth.ts:58-85` owns both PAT authentication and the `markTokenUsed()` side effect.
- `apps/web/src/lib/admin-tokens.ts:171-175` persists token usage through `UPDATE admin_tokens SET last_used_at = NOW()`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-99` is the only shipped scoped-token route and performs restore-maintenance admission inside the handler, after wrapper side effects.
- `apps/web/src/app/[locale]/admin/db-actions.ts:511-632` shows restore maintenance, mutation draining, and lock release are route/runtime lifecycle concerns, not generic auth concerns.

Why this is a real problem:
The auth wrapper has crossed a boundary: it authenticates requests and also commits route-visible telemetry before the route can apply its operational gates. That coupling makes `last_used_at` semantics depend on wrapper ordering, not on successful route admission. It also makes future token-backed routes inherit the same behavior even if their own maintenance, quota, or resource-admission rules differ.

Concrete failure scenario:
A valid Lightroom PAT request arrives during a restore maintenance window. The wrapper verifies scope and writes `last_used_at`; only then does the handler reject at its maintenance gate. Operators later see a fresh token-use timestamp even though the route intentionally refused the upload. A future `lr:delete` or `lr:read` route added behind the same wrapper would get this pre-gate mutation by default.

Suggested fix:
Keep `withAdminAuth` side-effect-light: verify identity/scope and expose the verified token, but let each token-backed route mark usage after its route-specific gates pass. Alternatively, add an explicit wrapper option that defers token usage marking until the handler returns an admitted/success status. If the product wants to track authenticated rejected attempts, model that as separate audit data instead of overloading `last_used_at`.

### ARCH18-02: Pipeline-version history is duplicated and stale in the Sharp pipeline module

Severity: Low
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/src/lib/gallery-config-shared.ts:10-22` defines `IMAGE_PIPELINE_VERSION = 7` and records v7 semantics.
- `apps/web/src/lib/process-image.ts:371-397` still presents the "Color-pipeline version" history only through v6, then re-exports the shared constant.
- `CLAUDE.md:137` correctly states that the current version is defined in `gallery-config-shared.ts` and currently 7.

Why this is a real problem:
`process-image.ts` is the encoder module maintainers naturally inspect when changing Sharp/libvips behavior. Its local version-history block is now a stale duplicate of the canonical contract. The runtime constant is correct, but the design documentation at the old re-export site can mislead future encoder changes, backfill decisions, or cache-invalidation reviews.

Concrete failure scenario:
A future color-pipeline author searches `process-image.ts` before changing encoder bytes, sees history ending at v6, and either treats v7 as unexplained accidental state or adds v8 without preserving the v7 decision record. Reviewers then lose the chain connecting byte semantics, backfill selection, ETag/SW invalidation, and operator runbooks.

Suggested fix:
Delete the duplicate history from `process-image.ts` and point to `gallery-config-shared.ts`, or update it to include v7 and add a source-contract test that the highest history entry near the re-export matches `IMAGE_PIPELINE_VERSION`. Prefer one authoritative version ledger.

## Likely Issues

None newly identified.

## Manual-Validation Risks

The larger architectural risks from Cycle 17 remain explicitly deferred and were not re-filed as new findings: warning-only single-writer enforcement, independent background DB budgets, server-global advisory lock names, manual restore writer registry, SQL-only backup/file consistency, build/runtime `IMAGE_BASE_URL` split, proxy topology/client-IP validation, and CLIP production host proof.

## Architecture Sweep Notes

No additional boundary defect was confirmed in browser upload, restore import, image queue, delete cleanup, service-worker cache stamping, semantic/similar routes, or migration journal handling. Browser admin mutations consistently use the process-local mutation barrier; restore drains queue/background/sweep/admin writers before import; upload/processing locks protect the image contract in the documented single-web-instance topology. No tests were run because this prompt required review artifacts only.

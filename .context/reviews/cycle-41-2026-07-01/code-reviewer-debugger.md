# Cycle 41 Code-Reviewer + Debugger Review

Reviewer lane: correctness, logic, edge cases, race conditions, state consistency, latent bugs, maintainability, scanner/lint guardrails, and test vacuity.

Result: no new actionable findings.

## Scope and Baseline

- Current HEAD reviewed: `ae71bd5a` (`fix(cycle-40): align download labels and scanners`).
- Cycle 40 baseline: `.context/reviews/cycle-40-2026-07-01/_aggregate.md`.
- Scheduled cycle-40 fixes were treated as baseline work:
  - `UI-C40-01`: wide-gamut JPEG download labels derive from public-safe gamut + `forceSrgbDerivatives`.
  - `TV-40-01`: `lint:action-origin` treats Drizzle relational reads as protected reads before auth.
  - `TV-40-02`: `lint:public-route-rate-limit` treats DB-backed imported data helpers as expensive public reads.
- Deferred/carry-forward items were not re-raised without new current-code evidence:
  - `TV-40-03`: semantic checking for JS operational scripts.
  - `PERF-C39-03` / `PERF-C39-04`: migration/index planning.
  - `AGG-C38-07`: broad imported-helper side-effect classification.
  - `AGG-C38-08`: sidecar keyset pagination.

## Review-Relevant Inventory

Cycle-40 touched files inspected:

- `apps/web/src/lib/download-labels.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/__tests__/download-labels.test.ts`
- `apps/web/src/__tests__/is-p3-pipeline.test.ts`
- `apps/web/src/__tests__/photo-viewer-no-hdr-download.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`

High-risk runtime surfaces inspected:

- Browser upload/delete/retry/bulk flows: `apps/web/src/app/actions/images.ts`
- Lightroom/PAT upload API: `apps/web/src/app/api/admin/lr/upload/route.ts`
- Processing queue, bootstrap, claims, side effects, and restore quiesce: `apps/web/src/lib/image-queue.ts`
- Upload quota tracking: `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`
- Upload/restore/settings serialization lock: `apps/web/src/lib/upload-processing-contract-lock.ts`
- Restore maintenance and durable marker: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`
- Restore action/drain sequence: `apps/web/src/app/[locale]/admin/db-actions.ts`
- Background DB write drain: `apps/web/src/lib/background-db-writes.ts`
- Public action rate limits and analytics writes: `apps/web/src/app/actions/public.ts`
- Shared-group buffered view counts and data access: `apps/web/src/lib/data.ts`
- Admin API auth wrapper and scanner: `apps/web/src/lib/api-auth.ts`, `apps/web/scripts/check-api-auth.ts`
- Public semantic/similar/OG API routes: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`

Discovery inventory:

- Public API route files found under `apps/web/src/app/api`: 8 total, with 2 admin routes.
- Server action files found under `apps/web/src/app/actions`: 13 files plus `app/[locale]/admin/db-actions.ts` and top-level `app/actions.ts`.

## Evidence

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed and printed per-route coverage for public routes including uploads, OG, semantic, similar, feeds, health, and live routes.
- `npm run lint:action-origin --workspace=apps/web` passed and printed coverage for every scanned action export.
- Targeted regression suite passed:
  - `npm test --workspace=apps/web -- --run src/__tests__/download-labels.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/check-action-origin.test.ts`
  - 3 files, 145 tests.
- Synthetic scanner probes confirmed current cycle-40 guardrail behavior:
  - Dynamic `await import('@/lib/data')` expensive GET before a gate fails.
  - Expensive work hidden in a branch before a gate fails.
  - Local alias `export { handler as GET }` with an imported expensive helper after a rate-limit gate passes.
  - External `export { POST } from './handlers'` fails closed as an unsupported/missing-rate-limit mutating export.
- Upload browser path claim/settle behavior is still paired around post-claim early exits and failures at `apps/web/src/app/actions/images.ts:252` through `apps/web/src/app/actions/images.ts:617`.
- Lightroom upload preclaims declared bytes before multipart parsing, settles invalid/rejected paths, and reconciles success to actual file bytes at `apps/web/src/app/api/admin/lr/upload/route.ts:130` through `apps/web/src/app/api/admin/lr/upload/route.ts:176` and `apps/web/src/app/api/admin/lr/upload/route.ts:500` through `apps/web/src/app/api/admin/lr/upload/route.ts:504`.
- Delete flows remove queue bookkeeping, delete DB rows transactionally, and clean full derivative sets by prefix scan at `apps/web/src/app/actions/images.ts:694` through `apps/web/src/app/actions/images.ts:743` and `apps/web/src/app/actions/images.ts:806` through `apps/web/src/app/actions/images.ts:903`.
- Queue processing acquires per-image advisory locks, verifies derivative files, conditionally marks rows processed, cleans generated variants if a row disappears, and tracks caption/embedding side effects for restore/shutdown drains at `apps/web/src/lib/image-queue.ts:537` through `apps/web/src/lib/image-queue.ts:850`.
- Restore preparation flushes shared-group view buffers, quiesces the image queue, and drains tracked background DB writes before `runRestore()` at `apps/web/src/app/[locale]/admin/db-actions.ts:492` through `apps/web/src/app/[locale]/admin/db-actions.ts:503`.
- Public route/action rate-limit gates still run before expensive DB/image/embedding work in the inspected API routes and public actions.

## Findings

No new actionable findings.

The cycle-40 changes are internally consistent with the reviewed contracts:

- JPEG download labels no longer depend on admin-only `color_pipeline_decision`; they use `color_primaries` plus `forceSrgbDerivatives`.
- The scanner expansions cover the newly scheduled defect classes and have focused tests.
- Upload, LR upload, delete, queue, restore, and public route paths still show explicit claim/settle, auth/origin, rate-limit, and maintenance ordering.

## Not Re-Raised

- The action-origin scanner still has hypothetical blind spots for future protected helper shapes outside its current regex/AST model, such as some imported helper names that do not match `getAdmin*`, `list*ForUser`, `readAdmin*`, `queryAdmin*`, or `loadAdmin*`. Current exempt admin getters authenticate before such helper calls, and this overlaps the existing deferred `AGG-C38-07` broad imported-helper classification item, so I am not scheduling it from this lane.
- JS operational script semantic typing remains a real guardrail gap, but cycle 40 already deferred it as `TV-40-03` with a dedicated migration requirement.
- Some tests remain source-contract tests rather than runtime behavior tests. For the cycle-40 scanner changes, the high-risk scanner logic also has runtime fixture tests, so I did not find a current vacuity defect to schedule.

## Missed-Issues Sweep

- Re-read cycle-40 aggregate, plan, deferred list, and code/architecture/debugger review.
- Reviewed the `HEAD` stat/diff for cycle-40 changes.
- Ran targeted lint gates and scanner/download tests listed above.
- Searched route/action export shapes, public/admin API handlers, action exemptions, DB relational reads, helper-name reads, restore-maintenance usage, and source-contract tests.
- No additional current-code failure scenario met the bar for a new concrete finding.

## Residual Risk

- I did not run the full blocking gate set (`lint`, `typecheck`, `build`, full `npm test`, or Playwright e2e`) because this was a prompt-1 deep review lane and targeted scanner tests were sufficient for the inspected changes.
- No production DB, filesystem, or deployed-host behavior was exercised.

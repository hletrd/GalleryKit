# Run-10 Cycle 33/100 Implementation Plan

Status: IMPLEMENTED - signed push complete at `5124d17e`; deploy/live smoke superseded by Cycle 34
Aggregate: `.context/reviews/run10-cycle33/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `959e45afdfcf901f9f88e3eb8e675a12545ced8c`

## Scope

This cycle fixes four bounded review findings: pending-file cleanup ownership in bulk delete, action-origin scanner provenance for public rate-limit helpers, restore serialization for the alt-text sidecar, and stale Cycle 32 release-ledger status. No schema migration, product UI change, or new dependency is required.

Repo rules read before scheduling: `AGENTS.md`, `CLAUDE.md`, the review-plan-fix skill, `.context/plans/README.md`, `.context/plans/run10-cycle32/plan.md`, `.context/plans/run10-cycle32/deferred.md`, and the Cycle 33 review artifacts.

## Scheduled Work Packages

### WP1 - Bound bulk-delete file cleanup to rows deleted by this transaction

Finding: `C33-01`.

Files:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/__tests__/pending-file-deletions-source.test.ts`

Plan:

1. Insert the pending cleanup row per image inside the transaction.
2. Delete image tags and the image row per image.
3. Push a pending cleanup record only when that image delete returns `affectedRows === 1`.
4. Remove the pending cleanup row and skip filesystem cleanup when the image row was already gone.
5. Pin the source contract so future bulk cleanup cannot run against stale pending rows.

Acceptance:

- Bulk delete never calls `cleanupPendingFileDeletion` for a pending row whose owning image delete was not proven.
- Existing successful deletion behavior remains unchanged.

### WP2 - Reject fake public rate-limit helper imports in action-origin lint

Finding: `C33-03`.

Files:

- `apps/web/scripts/check-action-origin.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`

Plan:

1. Treat public limiter helper names imported from non-approved modules as shadowed/untrusted.
2. Keep same-file public helper declarations valid for the existing `actions/public.ts` implementation.
3. Add a focused fixture importing `checkViewRecordRateLimit` from `./fake-rate-limit` and expecting the exemption check to fail.

Acceptance:

- `npm run lint:action-origin --workspace=apps/web` still passes on current source.
- The fake-import scanner fixture fails as intended.

### WP3 - Serialize alt-text sidecar writes with restore

Finding: `C33-04`.

Files:

- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/scripts/backfill-alt-text.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/__tests__/advisory-locks.test.ts`
- `apps/web/src/__tests__/advisory-lock-release-contract.test.ts`
- `apps/web/src/__tests__/restore-upload-lock.test.ts`
- `apps/web/src/__tests__/restore-blocker-messages.test.ts`
- `apps/web/src/__tests__/cycle-71-source-contracts.test.ts`
- `CLAUDE.md`

Plan:

1. Add centralized `LOCK_ALT_TEXT_BACKFILL = 'gallerykit_alt_text_backfill'`.
2. Have `backfill-alt-text.ts` acquire the lock for the full run and release it on every exit path.
3. Have `restoreDatabase()` acquire the alt-text lock after color and semantic backfill locks and before durable maintenance begins.
4. Map alt-text contention to `restoreBlockedByBackfill`, mirroring the color and semantic branches.
5. Update source contracts and docs for the new lock name and restore serialization rule.

Acceptance:

- Restore fails fast while an alt-text backfill sidecar is active.
- The alt-text sidecar exits non-zero while restore or another alt-text run holds the lock.
- Lock constants remain unique and documented as server-scoped.

### WP4 - Close Cycle 32 ledger ambiguity

Finding: `C33-02`.

Files:

- `.context/plans/README.md`
- `.context/plans/run10-cycle32/plan.md`

Plan:

1. Move Cycle 32 out of active current-cycle plans.
2. Mark signed push complete with `959e45af`.
3. Preserve the committed deploy/live-smoke gap honestly and state that Cycle 33's per-cycle deploy supersedes production evidence.

Acceptance:

- The plan index lists Cycle 33 as active and Cycle 32 as recently completed/pushed.
- Cycle 32 no longer claims signed push is pending.
- The absence of committed Cycle 32 deploy evidence remains visible.

## Finding Disposition Map

- C33-01: scheduled in WP1.
- C33-02: scheduled in WP4.
- C33-03: scheduled in WP2.
- C33-04: scheduled in WP3.

Deferred this cycle: none.

## Progress

- [x] Prompt 1 review artifacts written and aggregated.
- [x] Prompt 2 plan written.
- [x] WP1 bulk-delete cleanup ownership.
- [x] WP2 public limiter import provenance.
- [x] WP3 alt-text restore serialization.
- [x] WP4 Cycle 32 ledger update.
- [x] Required full gates.
- [x] Signed commit/push (`5124d17e`).
- [ ] Per-cycle deploy and live smoke superseded by Cycle 34's required per-cycle deploy.

## Gate Evidence

Focused pre-gate checks already passed:

- `npm test --workspace=apps/web -- --run src/__tests__/pending-file-deletions-source.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/restore-blocker-messages.test.ts src/__tests__/advisory-locks.test.ts src/__tests__/advisory-lock-release-contract.test.ts src/__tests__/cycle-71-source-contracts.test.ts` (7 files, 150 tests).
- `npm run lint:action-origin --workspace=apps/web`.
- `npm run typecheck:scripts --workspace=apps/web`.
- `git diff --check`.

Required full gates:

- ESLint passed: `npm run lint --workspace=apps/web`.
- Admin API auth lint passed: `npm run lint:api-auth --workspace=apps/web`.
- Server-action origin lint passed: `npm run lint:action-origin --workspace=apps/web`.
- Public route rate-limit lint passed: `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Production dependency audit passed: `npm run audit:prod` (`found 0 vulnerabilities`).
- Typecheck passed: `npm run typecheck --workspace=apps/web`.
- Production build passed: `npm run build --workspace=apps/web` (Next.js 16.2.10).
- Full unit suite passed: `npm test --workspace=apps/web` (361 files passed, 2 skipped; 3392 tests passed, 4 skipped).
- Browser e2e not run: Cycle 33 changed server actions, operator scripts, lint scanner behavior, tests, and docs only; no browser-flow behavior changed.

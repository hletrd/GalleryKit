# Run-10 Cycle 33/100 Aggregate Review

Date: 2026-07-08 KST
Review start HEAD: `959e45afdfcf901f9f88e3eb8e675a12545ced8c`

## Review Lanes

Completed:

- `code-debug-trace` -> `.context/reviews/run10-cycle33/code-debug-trace.md`
- `perf-ops-reviewer` -> `.context/reviews/run10-cycle33/perf-ops-reviewer.md`
- `test-verifier` -> `.context/reviews/run10-cycle33/test-verifier.md`
- `architect` -> `.context/reviews/run10-cycle33/architect.md`
- `security-reviewer` -> `.context/reviews/run10-cycle33/security-reviewer.md`
- `designer` -> `.context/reviews/run10-cycle33/designer.md`

Agent failures: none.

## Merged Findings

### C33-01 - Bulk delete can clean files for rows it did not delete

- **Severity/Confidence:** High / High.
- **Sources:** code-debug-trace.
- **Citations:** `apps/web/src/app/actions/images.ts:814-865`; `apps/web/src/lib/pending-file-deletions.ts`; `.context/reviews/run10-cycle33/code-debug-trace.md`.
- **Problem:** `deleteImages()` inserted pending cleanup rows for every pre-fetched image, then ran one batch image delete and cleaned every pending row even when `affectedRows` was lower than the pre-fetch count.
- **Scenario:** a concurrent delete or restore interleaving removes an image after pre-fetch but before this transaction's batch delete. The stale pending row can still be cleaned, unlinking files for a row this transaction did not delete.
- **Disposition:** scheduled in Cycle 33. Only enqueue and clean pending file deletions for image rows whose delete is proven by this transaction; remove stale pending rows inside the transaction.

### C33-02 - Cycle 32 release ledger still marks pushed work as pending

- **Severity/Confidence:** Medium / High.
- **Sources:** perf-ops-reviewer.
- **Citations:** `.context/plans/run10-cycle32/plan.md:3`; `.context/plans/run10-cycle32/plan.md:80-81`; `.context/plans/README.md:36`; `git log --oneline -1 --decorate`.
- **Problem:** Cycle 32's plan and index still list signed push and deploy/live smoke as pending even though `959e45af` is present at `origin/master`.
- **Scenario:** a later operator may treat Cycle 32 as both active and unresolved, or assume deploy evidence exists when the committed plan only proves local gates and remote push.
- **Disposition:** scheduled in Cycle 33. Record the pushed hash, keep the committed deploy/live-smoke gap explicit, and supersede production evidence with Cycle 33's required per-cycle deploy.

### C33-03 - `lint:action-origin` accepts fake imported public rate-limit helpers

- **Severity/Confidence:** Medium / High.
- **Sources:** test-verifier.
- **Citations:** `apps/web/scripts/check-action-origin.ts`; `apps/web/src/__tests__/check-action-origin.test.ts`; `.context/reviews/run10-cycle33/test-verifier.md`.
- **Problem:** public action exempt mutations were allowed to satisfy rate-limit checks by calling a protected helper name imported from any module, not only same-file helpers or approved rate-limit imports.
- **Scenario:** a future public analytics mutation imports `checkViewRecordRateLimit` from a fake module, checks the fake return value, and ships without the real per-IP limiter because the scanner trusts the bare identifier name.
- **Disposition:** scheduled in Cycle 33. Reject public limiter helper names imported from unapproved modules and add a scanner fixture for the spoof.

### C33-04 - Alt-text sidecar can write across a restore window

- **Severity/Confidence:** Medium / High.
- **Sources:** architect.
- **Citations:** `apps/web/scripts/backfill-alt-text.ts`; `apps/web/src/app/[locale]/admin/db-actions.ts`; `apps/web/src/lib/advisory-locks.ts`; `.context/reviews/run10-cycle33/architect.md`.
- **Problem:** `backfill-alt-text.ts` marker-polled restore maintenance but did not hold a restore-visible advisory lock, leaving a cross-process check-to-write gap before `alt_text_suggested` updates.
- **Scenario:** an operator starts the sidecar, it passes a marker check and begins caption generation, then database restore starts and imports a dump. The sidecar can write stale pre-restore suggestions after the restore window opens.
- **Disposition:** scheduled in Cycle 33. Add an alt-text backfill advisory lock held by the sidecar and acquired fail-fast by restore before maintenance begins.

## Non-Findings

- No new auth/authz, PAT, same-origin, public-route rate-limit, upload path traversal, restore SQL-scan, CSP, privacy projection, or secret exposure security finding was confirmed.
- No new UI/UX, accessibility, keyboard/focus, touch-target, responsive layout, i18n, or photographer color-intent defect was confirmed.
- Existing deferred items remain in their authoritative deferred registers and the consolidated carry-forward register; none are re-counted as Cycle 33 findings.

## Disposition

- **New findings produced:** 4.
- **Scheduled:** C33-01, C33-02, C33-03, C33-04.
- **Deferred:** none new.

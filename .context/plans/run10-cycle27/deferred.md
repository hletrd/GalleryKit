# Run-10 Cycle 27/100 Deferred Findings

Status: OPEN
Aggregate: `.context/reviews/run10-cycle27/_aggregate.md`
Date: 2026-07-08 KST

This register records every Cycle 27 aggregate finding not scheduled in `plan.md`. Severity and confidence are preserved. Deferred work remains bound by repo policy: GPG-signed Conventional Commits with gitmoji, `git pull --rebase` before push, required gates, no force-push, no `--no-verify`, and the repo's toolchain/deploy rules.

Repo rule basis for deferral: `CLAUDE.md` documents restore-maintenance/corrective recovery behavior; `.context/plans/README.md` defines carry-forward budgeting; `apps/web/src/__tests__/restore-upload-lock.test.ts` explicitly pins corrective restore attempts as not rejected by a pre-lock maintenance check.

## Deferred Items

| ID | Severity / Confidence | Citation | Reason for deferral | Exit criterion |
|----|-----------------------|----------|---------------------|----------------|
| AGG-C27-02 | Medium / Medium-High | `apps/web/src/app/[locale]/admin/db-actions.ts:421-428`; `apps/web/src/app/[locale]/admin/db-actions.ts:545-552`; `apps/web/src/__tests__/restore-upload-lock.test.ts:104-126` | A naive `getRestoreMaintenanceMessage()` fast-path before `isAdmin()` would violate the repo's existing corrective-restore contract pinned by `restore-upload-lock.test.ts`: active maintenance must not reject a corrective restore before advisory-lock acquisition. A safe fix needs a narrower design that distinguishes true concurrent restores from stale-marker corrective restores, likely involving restore-lock acquisition before auth plus a short unauthenticated lock-hold risk analysis. | Approved restore-action ordering design, a production incident/noisy auth-table read during restore, or a refactor that exposes a safe "active owner vs stale marker" signal. |
| AGG-C27-04 | Medium / High | `apps/web/src/app/[locale]/admin/db-actions.ts:674-690`; `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:46-55`; `apps/web/src/__tests__/restore-maintenance.test.ts:104-110` | No current behavior bug was confirmed; helper-level behavior is covered, but action-level finalizer behavior needs extraction or an injectable restore harness. This is test-strength work broader than the selected ordering fix. | Restore finalizer extraction, restore action harness work, or any future change to marker-clear / queue-resume / post-clear cleanup logic. |
| AGG-C27-05 | Low-Medium / High | `apps/web/src/components/lightbox-color-pip.tsx:167-204`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253`; `apps/web/src/app/[locale]/(public)/map/page.tsx:55-67`, `:99-108`; `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:57-82` | No current rendered UI regression was confirmed. The gap is render/e2e strength for Cycle 26 UI fixes and requires seeded browser fixtures or component render coverage. | UI/browser test-hardening cycle, regression in color-pip disclosure semantics, empty shared-group copy, or map label fallback. |

## Scheduled, Not Deferred

Scheduled in `plan.md`: `AGG-C27-01`, `AGG-C27-03`.

## Age-Budget Check

No newly discovered High-severity finding is deferred. The Medium concurrent-restore ordering item is deferred only because the repo currently pins an overlapping corrective-restore behavior contract that a narrow patch must not break.

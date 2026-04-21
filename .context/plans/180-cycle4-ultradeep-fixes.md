# Plan 180 — Cycle 4 Ultradeep Fixes

**Created:** 2026-04-22
**Status:** DONE
**Purpose:** Implement every confirmed cycle-4 finding from `.context/reviews/_aggregate.md` while honoring the user-injected requirements for a deeper ultradeep sweep and self-resolved deploy execution.

## Scheduled fixes

### C180-01: Quiesce background writers around database restore
**Severity:** HIGH | **Confidence:** High
**Sources:** `C4-01` in `.context/reviews/_aggregate.md`
**Files:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/images.ts`, new restore-maintenance helper and tests if needed

Implementation:
1. Add a short-lived restore-maintenance state that becomes active only while `restoreDatabase()` is running.
2. Flush buffered shared-group view counts before restore starts and suppress new view-count buffering during the restore window.
3. Quiesce queued image-processing work before restore, and re-bootstrap the queue afterward.
4. Reject new uploads while the restore-maintenance gate is active so fresh queue work cannot race the restore.

### C180-02: Use thumbnail-sized derivatives for shared-group gallery cards
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `C4-02` in `.context/reviews/_aggregate.md`
**Files:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/lib/gallery-config-shared.ts`, tests if needed

Implementation:
1. Keep the existing OG-sized derivative only for metadata/social images.
2. Add/use a grid-target helper that chooses a thumbnail-sized configured derivative for shared-group card grids.
3. Reuse the helper in the shared-group page so the browser downloads smaller assets for masonry cards.

### C180-03: Surface image-cleanup failures instead of silently reporting delete success
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `C4-03` in `.context/reviews/_aggregate.md`
**Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/components/image-manager.tsx`, messages files if new localized warning strings are needed

Implementation:
1. Replace the current best-effort delete cleanup with `Promise.allSettled`-style tracking so failed original/variant deletions are recorded.
2. Return a warning/partial-cleanup signal to the admin UI while keeping the successful DB delete result.
3. Show warning toasts for both single-delete and bulk-delete cleanup failures.
4. Log actionable cleanup details instead of the current generic error string.

### C180-04: Make missing-`TRUST_PROXY` warnings one-time and runtime-actionable
**Severity:** LOW | **Confidence:** High
**Sources:** `C4-04` in `.context/reviews/_aggregate.md`
**Files:** `apps/web/src/lib/rate-limit.ts`, optional runtime bootstrap if needed

Implementation:
1. Remove the import-time production warning.
2. Emit the warning only once from a guarded runtime path when proxy headers would otherwise degrade to `unknown`.
3. Preserve the security posture (never trust proxy headers unless explicitly configured).

### C180-05: Delete dead toolchain/config baggage
**Severity:** LOW | **Confidence:** High
**Sources:** `C4-05` in `.context/reviews/_aggregate.md`
**Files:** `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/playwright-test.config.ts`

Implementation:
1. Remove the unused `better-sqlite3`, `@types/better-sqlite3`, and `@vitejs/plugin-react` devDependencies.
2. Refresh the lockfile accordingly.
3. Delete the orphaned `apps/web/playwright-test.config.ts` file.
4. Tighten stale Docker comments that still mention the removed sqlite/native toolchain baggage.

## User-injected TODOs to honor this cycle

### U180-01: `deeper` / `ultradeep comprehensive`
Implementation:
1. Do an extra repo-wide sweep after the code fixes and after all gates finish.
2. Capture any newly discovered issue in the cycle report rather than silently ignoring it.

### U180-02: `find yourself and make sure to not ask again.`
Implementation:
1. Use the repo/env-provided deploy command from the run context without asking the user for deploy details.
2. Keep deployment/documentation/tooling changes self-resolving from repository state.

## Verification
- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`
- [x] Reviewed repo-wide warning output against `.context/plans/164-deferred-gate-warnings-2026-04-20.md`; the recurring Next.js edge-runtime, `next start`, and `NO_COLOR` warnings remain expected deferred gate warnings rather than new cycle-4 findings.
- [x] Extra repo-wide sweep after the gates found no new actionable issues; remaining `better-sqlite3` mentions only exist as transitive peer-optional metadata inside `package-lock.json`.

## Progress
- [x] C180-01: Restore-maintenance writer quiescence
- [x] C180-02: Shared-group thumbnail sizing
- [x] C180-03: Delete cleanup visibility
- [x] C180-04: One-time `TRUST_PROXY` warning
- [x] C180-05: Toolchain/config cleanup
- [x] U180-01: Extra final ultradeep sweep
- [x] U180-02: Self-resolved deploy execution

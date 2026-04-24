# test-engineer — cycle 2 rpl

HEAD: `00000006e`.

## Gap analysis
Vitest: 41 test files under `apps/web/src/__tests__/`. Playwright: 4 e2e spec files + helpers. The `lint:api-auth` gate asserts admin API routes use `withAdminAuth`. There is NO parallel static check asserting server actions use `hasTrustedSameOrigin`.

## Findings

### TE2R-01 — No test asserts `hasTrustedSameOrigin` is called on every mutating server action
- **Severity / confidence:** MEDIUM / HIGH.
- **Why it matters:** cycle 1 rpl hardened the `login`/`updatePassword` paths. Without a test that enumerates mutating actions and asserts their provenance check, future additions or deletions silently regress the defense-in-depth posture. The `lint:api-auth` gate demonstrates this pattern is possible and already accepted by the repo.
- **Fix:** add a lint-style script `lint:action-origin.ts` that AST-scans `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts` for exported `'use server'` functions that neither call `hasTrustedSameOrigin(...)` nor explicitly opt out via an allowlisted comment. Gate on it in CI alongside `lint:api-auth`.

### TE2R-02 — No test asserts `unstable_rethrow` pattern on outer catch blocks
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** pairs with CRIT2R-02. A single tiny static check would catch the missing rethrow in `updatePassword` and any future catch that omits it.
- **Fix:** defer, low value until `unstable_rethrow` is applied uniformly.

### TE2R-03 — `admin.spec.ts` is the only playwright test exercising admin mutation flows end-to-end
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** `admin.spec.ts` now auto-enables locally (C1R-07) and covers GPS toggle, but doesn't exercise upload → process → share → revoke → delete lifecycle. Gap, not regression.
- **Fix:** defer — matches the pre-existing deferral of broader test-surface expansion (D6-14).

### TE2R-04 — `request-origin.test.ts` covers `hasTrustedSameOrigin` but not the opt-out callsite at `/api/admin/db/download`
- **Severity / confidence:** LOW / LOW.
- **Why it matters:** the download route already uses `{ allowMissingSource: false }` and it has its own unit test at `apps/web/src/__tests__/backup-download-route.test.ts`. The opt-out behavior in `request-origin.ts` is locked by the existing strict-mode test (line 108-113). No gap.
- **Fix:** none.

### TE2R-05 — No test exercises concurrent `updatePassword` from the same IP to verify the rate-limit clear-after-commit ordering
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** C1R-02 fixed the ordering, but there's no regression test that asserts the clear runs AFTER the transaction. A future refactor that moves the clear back into the try block would re-introduce the bug.
- **Fix:** defer — this is concurrent-ordering which is fussy to test; rely on code review for now.

## Summary
One meaningful new test-gap finding (TE2R-01 — action-origin lint). All others are re-confirmations of pre-existing deferrals.

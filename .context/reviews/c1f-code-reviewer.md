# Code Quality Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.

## Inventory reviewed

All primary source files in `apps/web/src/` (lib/ 38 files, components/ 30 files, app/ actions and routes 40+ files, db/ 3 files). Focused on logic correctness, cross-file interactions, edge cases, and maintainability risks.

---

## Findings

### C1F-CR-01 (Medium / High). `restoreDatabase` releases advisory lock but inner finally also releases — double-release on the happy path

- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:330-349`
- The outer `try/finally` block at line 344 releases `conn.release()`. The inner `try/finally` at line 330-343 calls `RELEASE_LOCK('gallerykit_db_restore')` and then `uploadContractLock?.release()`. However, on the early-return path where `beginRestoreMaintenance()` returns false (line 299-318), the code releases both the advisory lock and upload contract lock, then falls through to the outer `finally` which calls `conn.release()`. This is correct — the connection is released after the lock.
- **Actual concern**: On the `runRestore` success path, the inner finally (line 330) releases the advisory lock, then the outer finally (line 344) releases the connection. But `conn.release()` returns the connection to the pool *after* `RELEASE_LOCK` was already called. If `RELEASE_LOCK` fails silently (network blip), the connection goes back to the pool with a held advisory lock. This is a pre-existing known limitation documented in CLAUDE.md.
- **Revised severity**: Low — this is documented behavior. MySQL advisory locks auto-release on connection close.
- Suggested fix: None needed — documented limitation.

### C1F-CR-02 (Medium / Medium). `uploadImages` pre-increments tracker bytes before disk-space check completes — TOCTOU between tracker claim and actual file write

- Location: `apps/web/src/app/actions/images.ts:243-245`
- The upload tracker's `bytes` and `count` are incremented at line 243-245 *after* all validation but *before* individual file processing begins. If a file fails mid-processing (e.g., Sharp rejects it), `settleUploadTrackerClaim` at line 406/411 adjusts the tracker. However, between the pre-increment and the settle, concurrent upload requests from the same user+IP see an inflated tracker count, potentially rejecting legitimate uploads.
- **Scenario**: User uploads 1.8 GiB in two concurrent requests. The first request pre-claims 1.0 GiB. The second request sees tracker.bytes = 1.0 GiB and its own 0.8 GiB passes the cumulative check. First request fails entirely, settle reduces by 1.0 GiB. Second request was allowed based on inflated state. This is actually safe — the second request was within limits.
- **Revised concern**: The real TOCTOU is between the `tracker.bytes + totalSize` check (line 226) and the pre-increment (line 243). Two concurrent requests could both read `tracker.bytes < MAX_TOTAL_UPLOAD_BYTES` and both pre-increment, exceeding the cap. However, the `settleUploadTrackerClaim` correction makes this self-healing.
- **Revised severity**: Low — self-healing via settle; cap exceedance is transient and bounded.

### C1F-CR-03 (Medium / Medium). `searchImages` runs 3 sequential DB queries for tag/alias results even when the main query already returned enough

- Location: `apps/web/src/lib/data.ts:947-1059`
- The `searchImages` function correctly short-circuits when the main query fills the limit (line 984-986). When it doesn't, it runs tag and alias queries in parallel (line 1006-1048). However, the tag query uses `GROUP BY` on all selected columns (lines 1016-1026) — 10 columns including TEXT fields. This is functionally correct with Drizzle/MySQL but produces verbose SQL.
- **Actual concern**: The `searchFields` object used for both the main query and the sub-queries includes `topic_label: topics.label`, which comes from a LEFT JOIN. The sub-queries also LEFT JOIN topics. If a topic is deleted but images still reference it, the LEFT JOIN correctly returns NULL for `topic_label`. This is fine.
- **Revised severity**: Low — verbose SQL but correct.

### C1F-CR-04 (High / High). `login` rate-limit rollback on unexpected error uses decrement, but concurrent legitimate failures may have their count reduced

- Location: `apps/web/src/app/actions/auth.ts:249-258`
- When an unexpected error occurs during login (e.g., DB connection lost mid-verify), the code rolls back the pre-incremented rate-limit count using `rollbackLoginRateLimit` (which decrements by 1). If two concurrent requests from the same IP both fail with unexpected errors, both roll back. But if one was a genuine failed attempt (wrong password) and the other was an infrastructure error, the rollback of the infrastructure error reduces the count, effectively giving the attacker an extra attempt.
- **Scenario**: Attacker makes 5 rapid attempts. On attempt 3, the DB blips and Argon2 verify fails with an unexpected error. The rollback decrements the count from 3 back to 2. The attacker now has 3 more attempts instead of 2. Over a 15-minute window with repeated DB blips, the attacker could get significantly more than 5 attempts.
- **Severity**: Medium — the attacker would need to trigger infrastructure errors, which is difficult but not impossible (e.g., by overloading the DB).
- **Fix**: Instead of decrementing on unexpected error, consider a separate "infrastructure error" counter that doesn't reduce the failed-attempt budget. Or simply don't roll back on unexpected errors — the user can retry after a brief wait.

### C1F-CR-05 (Low / Low). `image-manager.tsx` has 6 empty catch blocks that silently swallow errors

- Location: `apps/web/src/components/image-manager.tsx` lines 136, 164, 188, 213, 246, 429
- Multiple catch blocks in the image manager component silently swallow errors. While some are best-effort UI operations, delete/update failures should at minimum log the error.
- **Fix**: Add `console.warn` or `console.error` to the delete/update error catches.

### C1F-CR-06 (Low / Low). `console.log()` usage in `db/seed.ts` and `db/index.ts`

- Location: `apps/web/src/db/seed.ts` line 26, `apps/web/src/db/index.ts` lines 5, 10
- `console.log()` is used instead of `console.debug()` or `console.warn()`. Inconsistent with the rest of the codebase.
- **Fix**: Replace with `console.debug()` or `console.warn()`.

### C1F-CR-07 (Medium / Low). Multiple oversized functions across the codebase

- `uploadImages` (318 lines, `actions/images.ts:117`)
- `login` (192 lines, `actions/auth.ts:70`)
- `getImage` (121 lines, `lib/data.ts:649`)
- `searchImages` (116 lines, `lib/data.ts:947`)
- `enqueueImageProcessing` (140 lines, `lib/image-queue.ts:211`)

These exceed reasonable function-size thresholds and increase maintenance burden.

- **Fix**: Refactor into named helper functions per phase.

### C1F-CR-08 (Medium / Medium). `sanitizeAdminString` returns stripped value even when `rejected=true`

- Location: `apps/web/src/lib/sanitize.ts:130-148`
- When Unicode formatting characters are detected, the function returns `{ value: stripped, rejected: true }`. If a caller forgets to check `rejected`, the stripped value (which may look visually identical) gets persisted. Current callers all check `rejected`, but future callers may not.
- **Fix**: Return `null` as value when `rejected` is true, forcing explicit handling.

# Plan 131 -- Cycle 22 Fixes

**Created:** 2026-04-19 (Cycle 22)
**Status:** COMPLETE

---

## Findings Addressed

### C22-02: `deleteTag` logs audit event even when transaction deletes 0 rows
- **Severity:** LOW / Confidence: MEDIUM
- **Files:** `apps/web/src/app/actions/tags.ts` lines 90-98
- **Implementation:** Capture `affectedRows` from the tag delete inside the transaction, same pattern as `deleteImage` at images.ts line 357. Only log the audit event when `affectedRows > 0`. The transaction already contains `await tx.delete(tags).where(eq(tags.id, id))` -- capture its result and expose `affectedRows` outside the transaction via a `let` variable.
- **Verification:** Two concurrent deletions of the same tag should only produce one audit log entry.
- **Progress:** [x] Complete -- capture `affectedRows` from tag delete in transaction, only log audit when `deletedRows > 0`

---

## Retracted Findings

### ~~C22-01: `searchImagesAction` double-increments DB rate-limit counter~~
- **Retraction reason:** Incorrect analysis. `checkRateLimit` only reads the DB counter; `incrementRateLimit` is called exactly once at line 82. The DB counter is incremented once per request, not twice. The in-memory counter is also incremented once (lines 55-59). The pattern is correct.

---

## Deferred Items

### C22-03: `deleteGroupShareLink` fetches group key outside the transaction
- **File:** `apps/web/src/app/actions/sharing.ts` lines 283-301
- **Original severity:** LOW / Confidence: LOW
- **Reason for deferral:** Negligible impact. The stale key is only used for cache revalidation of a URL that no longer resolves. No data inconsistency, no security risk, no user-facing harm. The race window is extremely narrow.
- **Exit criterion:** Multiple user reports of stale cache for shared groups, or a broader refactoring of sharing actions.

# Data Integrity Review — Cycle 2 (2026-04-19)

## C2-DI-01: `updatePassword` rate limit pre-increment not present (TOCTOU)
**File:** `apps/web/src/app/actions/auth.ts:209-225`
**Confidence:** HIGH **Severity:** MEDIUM

The `updatePassword` function checks the rate limit (line 214-215) and then performs the expensive Argon2 verify before incrementing (line 258-265). This is the same TOCTOU pattern that was fixed for login (commit 1036d7b) and search (commit f9f0566). Concurrent password change attempts can all pass the check before any of them record the attempt.

Unlike login, password changes are self-rate-limited (the user must know their current password), but the TOCTOU still allows burst attempts within the 15-minute window.

**Fix:** Move the in-memory increment before the Argon2 verify, matching the login fix pattern. If the password is correct, roll back the increment.

---

## C2-DI-02: `flushGroupViewCounts` silently catches DB errors with `console.debug`
**File:** `apps/web/src/lib/data.ts:23-29`
**Confidence:** MEDIUM **Severity:** LOW

Individual view count flush failures are caught with `.catch(console.debug)`. If the DB is temporarily unavailable, view counts are silently lost (they're already cleared from the buffer before the flush). This means page views are dropped without any retry or alerting.

For a personal gallery, lost view counts are acceptable. The alternative (retrying indefinitely) could cause unbounded memory growth.

**Fix:** Consider logging at `console.warn` level instead of `console.debug` so operators can see data loss in production logs.

---

## C2-DI-03: `createPhotoShareLink` race window between share_key check and UPDATE
**File:** `apps/web/src/app/actions/sharing.ts:25-27,30-58`
**Confidence:** MEDIUM **Severity:** LOW

Between checking `if (image.share_key)` and the `UPDATE ... WHERE share_key IS NULL`, a concurrent request could set the same share_key. The code handles this correctly via the `affectedRows` check and re-fetch, so this is not a data integrity issue. However, the retry loop (5 attempts) means under high concurrency, some requests will waste work.

**Fix:** No fix needed — the atomic UPDATE + re-fetch pattern is correct. Document the concurrency handling.

---

## C2-DI-04: `deleteImages` uses `foundIds` (deduplicated) for DB deletion but `imageRecords` (may have duplicates) for file cleanup
**File:** `apps/web/src/app/actions/images.ts:322-337,341-352`
**Confidence:** LOW **Severity:** LOW

`foundIdSet` is created from `imageRecords.map(img => img.id)`, which deduplicates IDs. The DB deletion uses `foundIds` (deduplicated). File cleanup iterates `imageRecords` which could theoretically contain duplicate rows if the same image ID appears multiple times in the input `ids` array. However, MySQL's `IN` clause returns each row once, so `imageRecords` won't have duplicates. The `Set` construction is still good defensive programming.

**Fix:** No fix needed — `db.select().where(inArray(...))` returns distinct rows.

---

## C2-DI-05: `batchUpdateImageTags` counts `added`/`removed` inside transaction but returns them after commit
**File:** `apps/web/src/app/actions/tags.ts:228-262`
**Confidence:** LOW **Severity:** LOW

The `added` and `removed` counters are incremented inside the transaction. If the transaction fails and rolls back, the function returns the error object with `added: 0, removed: 0`. If it succeeds, the counters reflect the actual work done. This is correct behavior.

However, the `warnings` array is populated for tag slug collisions but only logged via `console.warn` — the warning is NOT included in the `batchUpdateImageTags` return value, unlike `addTagToImage` which returns a `warning` field.

**Fix:** Consider including slug collision warnings in the return value for UI feedback.

---

## Summary

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| C2-DI-01 | MEDIUM | HIGH | updatePassword rate-limit TOCTOU (same as login/search pattern) |
| C2-DI-02 | LOW | MEDIUM | View count flush silently drops on DB failure |
| C2-DI-03 | LOW | MEDIUM | createPhotoShareLink concurrent access (handled correctly) |
| C2-DI-05 | LOW | LOW | batchUpdateImageTags doesn't return slug collision warnings |

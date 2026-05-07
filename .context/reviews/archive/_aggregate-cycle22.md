# Aggregate Review -- Cycle 22 (2026-04-19)

**Source reviews:** Single-agent deep review (code-reviewer + security + perf + debugger + architect + verifier + test-engineer + critic + tracer + designer + document-specialist perspectives combined).

---

## RETRACTION

C22-01 (double-increment of DB rate limit in `searchImagesAction`) was an **incorrect finding**. Upon closer code review, `checkRateLimit` at line 63 only reads the DB counter; `incrementRateLimit` at line 82 is the sole write to the DB. Each search request increments the DB counter exactly once. The in-memory counter is also incremented exactly once (lines 55-59). The pattern is correct: pre-increment in-memory (TOCTOU fix), check DB, increment DB.

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

All findings from cycles 1-21 were re-verified. The following are **new** findings not previously identified or fixed.

### C22-02: `deleteTag` logs audit event even when transaction deletes 0 rows [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/tags.ts` lines 90-98
- **Description**: Same pattern as C21-04 (which was fixed for `deleteImage` in images.ts). The `deleteTag` function wraps the delete in a transaction but logs the audit event unconditionally after the transaction completes. If two admins delete the same tag concurrently, both transactions succeed but one deletes 0 rows (the tag was already gone). Both log audit events, creating a duplicate.
- **Concrete failure scenario**: Two admins delete the same tag simultaneously. Both transactions succeed (one deletes 1 row, the other 0). Both log `tag_delete` audit events, creating a misleading duplicate entry.
- **Fix**: Capture `affectedRows` from the tag delete inside the transaction (same pattern as `deleteImage` at images.ts line 357). Only log the audit event when `affectedRows > 0`.

### C22-03: `deleteGroupShareLink` fetches group key outside the transaction, risking stale data [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/sharing.ts` lines 283-301
- **Description**: The function fetches the group key at line 283 (`db.select`) BEFORE entering the transaction at line 288. If the group is deleted by another admin between the SELECT and the transaction start, the SELECT returns the key but the transaction deletes 0 rows and throws `GROUP_NOT_FOUND`. The revalidation at line 303 uses the stale group key, which is harmless (just a cache invalidation for a now-deleted group's URL), but the pattern is inconsistent with how `deleteImage` handles this.
- **Concrete failure scenario**: Very narrow race window. Two admins delete the same shared group. Admin A's SELECT fetches the key. Admin B's transaction deletes the group. Admin A's transaction finds 0 rows and throws. The revalidation for the stale key is a no-op (the URL no longer resolves), so the impact is nil.
- **Fix**: Low priority. Move the SELECT inside the transaction and use the fetched key for both the WHERE clause and revalidation. This is consistent with the `deleteImage` pattern.
- **Status**: DEFERRED -- negligible impact, narrow race window, no user-facing harm.

---

## PREVIOUSLY FIXED -- Confirmed Resolved

All cycle 1-21 findings remain resolved. The following cycle 21 findings are confirmed resolved in the current codebase:

- C21-01 (orphaned files on DB insert failure): **RESOLVED** -- `savedOriginalFilename` tracking and cleanup at images.ts lines 190 and 266.
- C21-02 (missing unit tests): **RESOLVED** -- `upload-tracker.test.ts` added with 8 tests.
- C21-04 (deleteImage audit on 0 rows): **RESOLVED** -- `affectedRows` check at images.ts line 362.
- C21-07 (deleteAdminUser doc comment): **RESOLVED** -- Updated comment at admin-users.ts line 156.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged:

- C21-03: `x-forwarded-proto` spoofing risk (deployment-dependent)
- C22-03: `deleteGroupShareLink` stale key fetch (negligible impact)
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps

---

## AGENT FAILURES

None -- single-agent review completed successfully.

---

## TOTALS

- **0 CRITICAL** findings
- **0 MEDIUM** findings
- **2 LOW** findings (C22-02: deleteTag audit, C22-03: stale key fetch)
- **2 total** new findings

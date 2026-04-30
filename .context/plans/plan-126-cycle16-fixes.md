# Plan 126 — Cycle 16 Fixes

**Created:** 2026-04-19 (Cycle 16)
**Status:** COMPLETE

---

## Scope

Addresses findings from the Cycle 16 aggregate review (`_aggregate-cycle16.md`).

### C16-01: `rateLimitBuckets.bucket_start` uses `bigint({ mode: 'number' })` — change to `int` [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/db/schema.ts` line 138
- **Fix:** Change `bigint("bucket_start", { mode: 'number' })` to `int("bucket_start")`. The bucket_start column stores unix-second timestamps aligned to rate-limit window boundaries. These values are always well within the `int` range (max 2,147,483,647 = year 2038). This eliminates the bigint-to-number truncation risk entirely.
- **Implementation:**
  1. In `schema.ts`, change `bucketStart: bigint("bucket_start", { mode: 'number' }).notNull()` to `bucketStart: int("bucket_start").notNull()`
  2. In `rate-limit.ts`, verify `getRateLimitBucketStart()` returns a number within int range (it does — `Math.floor(nowMs / 1000)` for current timestamps is ~1.77 billion, well within int range)
  3. Run `npm run db:push` to update the DB schema

### C16-03: `flushGroupViewCounts` re-buffers failed increments individually — batch instead [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 54-58
- **Fix:** Replace the per-increment `bufferGroupViewCount()` loop with a single Map.set operation.
- **Implementation:**
  1. Change the catch block from:
     ```ts
     .catch(() => {
         for (let i = 0; i < count; i++) {
             bufferGroupViewCount(groupId);
         }
     })
     ```
     to:
     ```ts
     .catch(() => {
         // Re-buffer failed increment in one operation with capacity check
         if (viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)) {
             console.warn(`[viewCount] Buffer at capacity, dropping re-buffered increment for group ${groupId}`);
             return;
         }
         viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
     })
     ```

### C16-04: `updateImageMetadata` does not sanitize null bytes or control characters [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 480-524
- **Fix:** Strip null bytes and control characters from title and description before storing.
- **Implementation:**
  1. Add a helper function:
     ```ts
     function stripControlChars(s: string | null): string | null {
         if (!s) return s;
         return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
     }
     ```
  2. In `updateImageMetadata`, apply `stripControlChars` to title and description before the DB update:
     ```ts
     const sanitizedTitle = stripControlChars(title?.trim()) || null;
     const sanitizedDescription = stripControlChars(description?.trim()) || null;
     ```
  3. Also apply in the `.set()` call instead of the raw values.

### C16-08: SQL restore scan overlap increased from 256 to 1024 bytes [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts` line 276
- **Fix:** Increase the overlap from 256 to 1024 bytes to make chunk-boundary bypass significantly harder.
- **Implementation:**
  1. Change `const OVERLAP = 256;` to `const OVERLAP = 1024;`

---

## Not In Scope (Deferred)

See Plan 127 (deferred carry-forward) for items not addressed this cycle.

## Gate Checks

After all changes:
- [x] `eslint` passes (0 errors, 3 pre-existing warnings)
- [x] `next build` succeeds
- [x] `vitest` passes (66/66 tests)
- [x] `tsc --noEmit` passes

## Commits

1. `0000000a` fix(schema): change rateLimitBuckets.bucket_start from bigint to int
2. `0000000d` perf(data): batch re-buffer failed view count increments in flushGroupViewCounts
3. `00000008` fix(images): strip null bytes and control characters from image metadata
4. `00000008` fix(db): increase SQL restore scan chunk overlap from 256 to 1024 bytes

Deployed to production: 2026-04-20

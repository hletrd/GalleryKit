# Tracer Review — GalleryKit Repository (Cycle 10)

## Review Date: 2026-06-25
## HEAD: bcd67b12
## Previous HEAD: c0522dec
## Scope: Full causal tracing of concurrent access patterns, race conditions, state propagation, and timing-sensitive flows

---

## Methodology

This is cycle 10 of a review-plan-fix loop. The previous tracer review (cycle 9, HEAD c0522dec) identified 6 high-confidence, 7 medium-confidence, and 11 low-confidence issues. This review re-examines the CURRENT code at HEAD bcd67b12 with these priorities:

1. Verify whether previously identified issues were fixed, still exist, or were mitigated
2. Trace NEW suspicious flows introduced by recent commits (run-9 cycle-7 through cycle-10)
3. Re-examine flows with new evidence from code changes
4. Update confidence levels based on new findings
5. Apply the full Tracing Protocol: Observe, Frame, Hypothesize, Gather Evidence, Apply Lenses, Rebut, Rank, Synthesize, Probe

---

## 1. Previously Identified Issues — Status Update

### High Confidence (from prior review)

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| TRC-H1 | Static path ETag miss after settings change without backfill | **STILL EXISTS** | Documented as CRT-D1 in CLAUDE.md. No code change since prior review. The static path (Next.js static server) serves ~100% of real traffic and uses `W/"{size}-{mtime}"` ETag. Settings-hash ETag only affects `serve-upload.ts` fallback. |
| TRC-H2 | Process-local state prevents horizontal scaling | **STILL EXISTS** | Documented in CLAUDE.md. All `globalThis`-backed state remains: `restoreMaintenanceKey`, `adminBackfillStateKey`, `uploadTracker`, `processingQueueKey`, `settingsHashCache`, all `BoundedMap` instances. No distributed state layer introduced. |
| TRC-H3 | `getClientIp` returns "unknown" without `TRUST_PROXY` | **STILL EXISTS** | `rate-limit.ts:170` returns `'unknown'` when `TRUST_PROXY` is not set. Console warning emitted once. All users share one bucket. |
| TRC-H4 | Fire-and-forget caption/embedding failures silently swallowed | **STILL EXISTS** | `image-queue.ts:439-454` (caption) and `image-queue.ts:478-522` (embedding) both use `.catch(() => undefined)` or `.catch(console.warn)`. No admin visibility. |
| TRC-H5 | `canUseHighBitdepthAvif()` singleton caches failure permanently | **FIXED** | `process-image.ts:84-123` now has `_probeHighBitdepthAvif()` with MAX_RETRIES=3 and exponential backoff. Distinguishes `isBitdepthRejection()` (permanent) from `isTransientError()` (retryable). The probe still caches the final result, but transient errors are retried first. |
| TRC-H6 | DB connection init timeout may return uninitialized connections | **STILL EXISTS** | `db/index.ts:71-96` unchanged. The 10s timeout on `SET group_concat_max_len` may return connections to the pool with default 1024-byte limit. |

### Medium Confidence (from prior review)

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| TRC-M1 | Delete-during-processing race may leave orphaned files | **MITIGATED** | `image-queue.ts:418-434` now passes `[]` (empty sizes) to `deleteImageVariants` for full directory scan. `admin-backfill-runner.ts:430-440` mirrors this. The scan catches non-default-size variants. |
| TRC-M2 | `lastError` in backfill is last-writer-wins at concurrency > 1 | **STILL EXISTS** | `admin-backfill-runner.ts:181` documents this as intentional. No code change. The scalar message reflects the most recent worker failure; counts stay correct. |
| TRC-M3 | GPS stripping fallback for PNG may strip non-GPS metadata | **STILL EXISTS** | `gps-exif-strip.ts` fallback path uses `autoOrient + keepIccProfile` but doesn't preserve XMP/IPTC. No change since prior review. |
| TRC-M4 | Login rate limit in-memory Map empty after restart | **STILL EXISTS** | `loginRateLimit` is a `BoundedMap` in module scope. After restart, it's empty. The DB backup is read on the first check, but the pre-increment happens before the DB check, so the first 5 attempts are un-limited in the Map. The DB check then catches up. This is a documented trade-off (fast path vs. restart accuracy). |
| TRC-M5 | OG route rollback pattern inconsistency | **STILL EXISTS** | `rate-limit.ts:246-253` (rollbackOgAttempt) is documented as Pattern 4 (rollback ONLY for pre-DB syntactic rejections). The fixture tests `og-route-source-contracts.test.ts` and `og-photo-fallback.test.ts` lock this. No change. |
| TRC-M6 | `quiesceImageProcessingQueueForRestore` may deadlock on hung Sharp | **STILL EXISTS** | `image-queue.ts:802-804` uses `queue.pause(); queue.clear(); await queue.onIdle()`. No timeout. If a Sharp task is hung, `onIdle()` never resolves. The `queue-shutdown.ts` drain function also has no timeout. |
| TRC-M7 | Middleware format check is weak | **STILL EXISTS** | `proxy.ts` checks token length >= 100 and 3 colon-separated parts. Does not verify HMAC. Defense-in-depth: server actions do full verify. No change. |
| TRC-M8 | `buildHashFromConfig` may misalign with encoder settings | **STILL EXISTS** | `settings-hash.ts:42-54` lists 9 `COLOR_IMPACTING_KEYS`. The compile-time guard `_ColorKeysAreSettingKeys` catches typos but NOT forgotten new keys. No change. |
| TRC-M9 | Bootstrap may miss pending images if all permanently failed | **STILL EXISTS** | `image-queue.ts:667-697` unchanged. If all pending images in a batch are permanently failed, `bootstrapped = true` even though valid pending images may exist after the failed batch. |
| TRC-M10 | `dotProduct` fast path has no zero-vector guard | **STILL EXISTS** | `clip-embeddings.ts` unchanged. The `dotProduct` fast path skips the epsilon check. No zero-vector guard. |

### Low Confidence (from prior review)

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| TRC-L3 | GPS fallback strips non-GPS metadata | **STILL EXISTS** | No change. |
| TRC-L8 | Semantic search 503 if weights missing | **STILL EXISTS** | No change. |
| TRC-L9 | Partial files on crash during encode | **STILL EXISTS** | No change. |
| TRC-L10 | Session secret race in dev | **STILL EXISTS** | No change. |
| TRC-L11 | Rate limit decrement lost update | **STILL EXISTS** | No change. |
| TRC-N1 | Upload tracker settlement under-count | **STILL EXISTS** | No change. |
| TRC-N3 | Backfill raw SQL type unsafety | **STILL EXISTS** | No change. |
| TRC-N4 | View count buffer drops new groups | **STILL EXISTS** | No change. |
| TRC-N5 | Partial files on crash during encode | **STILL EXISTS** | No change. |
| TRC-N6 | Session secret race in dev | **STILL EXISTS** | No change. |
| TRC-N7 | Rate limit decrement lost update | **STILL EXISTS** | No change. |
| TRC-N10 | Settings hash cache stale after admin change | **STILL EXISTS** | No change. |

---

## 2. New Fixes Since Cycle 9 (HEAD c0522dec → bcd67b12)

### 2.1 FIX: Array.isArray guard in loadMoreImages (bcd67b12)

**File:** `apps/web/src/app/actions/public.ts`
**Change:** Added `Array.isArray(tagSlugs)` guard before processing tagSlugs parameter.

**Trace:** Before this fix, a malformed request with `tagSlugs` as a non-array (e.g., string, null, or object) would cause `.map()` to throw or behave unexpectedly. The guard now returns early with `status: 'invalid'` if `tagSlugs` is not an array.

**Confidence:** This fix is correct and complete. The guard prevents type confusion attacks.

---

### 2.2 FIX: ENOENT vs other opendir errors in deleteImageVariants (9c5c38ca)

**File:** `apps/web/src/lib/process-image.ts`
**Change:** Distinguishes `ENOENT` (directory doesn't exist — harmless) from other `opendir` errors.

**Trace:** Before this fix, if a directory was missing during cleanup, the error was thrown and could propagate up, causing the entire delete operation to fail. Now `ENOENT` is silently ignored, while other errors (permission denied, I/O errors) are still thrown.

**Confidence:** This fix is correct. `ENOENT` during cleanup is expected (the directory may have been already deleted or never created).

---

### 2.3 FIX: Restore maintenance checks in smart collections and embedding backfill (7453030e)

**Files:** `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/embeddings.ts`
**Change:** Added `getRestoreMaintenanceMessage()` checks to `createSmartCollection` and `triggerEmbeddingBackfill`.

**Trace:** Before this fix, smart collection creation and embedding backfill could proceed during database restore, potentially writing to tables that are being restored. This creates a race where the restore overwrites the newly created data, or the new data corrupts the restored state.

**Confidence:** This fix is correct and closes a genuine gap. The restore maintenance flag was previously only checked in upload and image-processing paths.

**Remaining concern:** Are there OTHER admin actions that should also check restore maintenance? Audit trail: `logAuditEvent` is called during restore — should it be blocked? The audit log is append-only, so it's safe. But other actions like topic creation, tag creation, admin user creation — do they need the check? Currently only upload, image processing, smart collections, and embedding backfill are guarded. Topic creation and admin user creation are NOT guarded. This may be intentional (these are lower-risk operations), but it's an inconsistency.

---

### 2.4 FIX: Revalidation moved outside try/catch in topic actions (db55056f)

**File:** `apps/web/src/app/actions/topics.ts`
**Change:** `revalidateAllAppData()` is now called AFTER the try/catch block, not inside it.

**Trace:** Before this fix, if revalidation threw an error (e.g., Next.js internal error), the catch block would execute the cleanup code (deleting the uploaded topic image file). This means a revalidation failure would cause the image file to be deleted even though the DB transaction succeeded. After the fix, revalidation runs independently — if it fails, the image file is NOT deleted.

**Confidence:** This fix is correct. The revalidation failure should not cause data loss.

**Remaining concern:** If revalidation fails, the cache remains stale. The admin may see old data until the next revalidation or cache expiry. This is a known Next.js limitation, not a GalleryKit bug.

---

### 2.5 FIX: Rate-limit entry getters return shallow copies (5f4a5e95)

**File:** `apps/web/src/lib/auth-rate-limit.ts`
**Change:** `getLoginRateLimitEntry` and `getAccountLoginRateLimitEntry` now return `{ ...entry }` (shallow copy) instead of the original entry.

**Trace:** Before this fix, callers could mutate the returned entry object, which would modify the in-memory Map directly. For example:
```typescript
const entry = getLoginRateLimitEntry(ip, now);
entry.count += 1; // This mutated the Map entry directly!
```

After the fix, the mutation only affects the copy, and the caller must explicitly `loginRateLimit.set(ip, entry)` to persist the change.

**Confidence:** This fix is correct and closes a mutable reference leak.

**Remaining concern:** Are there OTHER getters in the codebase that return mutable references? The `BoundedMap.get()` method returns the raw Map entry. If callers mutate it without calling `.set()`, they modify the Map directly. The `BoundedMap` class should probably also return copies, or document that callers must not mutate returned values.

---

### 2.6 FIX: isAdmin() checks in deleteAdminUser and LR token actions (b22fa85e)

**Files:** `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`
**Change:** Added `isAdmin()` checks to `deleteAdminUser` and LR token actions.

**Trace:** Before this fix, these actions relied on `requireSameOriginAdmin()` for auth. While `requireSameOriginAdmin()` does verify the session, it doesn't explicitly check admin status. The `isAdmin()` check adds defense-in-depth.

**Confidence:** This fix is correct. Defense-in-depth is good practice for destructive operations.

**Remaining concern:** Are there OTHER admin actions that lack `isAdmin()`? The `isAdmin()` check is redundant with `requireSameOriginAdmin()` (which also checks admin status), but the double-check is safer. The codebase should be audited for actions that only use `requireSameOriginAdmin()` without `isAdmin()`.

---

## 3. New Findings (Cycle 10)

### 3.1 NEW: `BoundedMap.get()` returns mutable reference (TRC-N11)

**Observation:** `bounded-map.ts:57-59` returns the raw Map entry without copying.

**Trace:**
```typescript
get(key: K): V | undefined {
    return this.map.get(key);
}
```

If a caller mutates the returned value, the Map entry is modified directly. This is the same pattern that was fixed in `auth-rate-limit.ts` (5f4a5e95), but the underlying `BoundedMap` class still exposes mutable references.

**Competing Hypotheses:**
- H1 (Low): The `BoundedMap` is an internal utility, and all callers are trusted to not mutate returned values. The fix in `auth-rate-limit.ts` addresses the specific leak.
- H2 (Medium): The `BoundedMap.get()` API is unsafe by design. Any caller that gets an entry, modifies it, and forgets to call `.set()` will corrupt the Map state.

**Confidence:** Medium. The `auth-rate-limit.ts` fix suggests this was a real issue. The `BoundedMap` class should return copies or be documented as "returned values must not be mutated."

**Probe:** Audit all `BoundedMap.get()` callers for mutation patterns.

---

### 3.2 NEW: `uploadImages` tracker settlement may under-count on partial failure (TRC-N1 — carried forward)

**Observation:** `app/actions/images.ts:190-194` pre-increments the upload tracker before processing, then `settleUploadTrackerClaim` reconciles at the end.

**Trace:** If the upload action throws BEFORE settlement (e.g., DB connection drops mid-loop), the tracker stays inflated. The `try/finally` around the upload processing ensures settlement happens in most cases, but if the throw happens in the `finally` block itself (e.g., during cleanup), the tracker remains inflated.

**Confidence:** Low. The impact is bounded by the 1-hour window and the 2-hour prune.

**Probe:** Simulate a DB connection drop mid-upload, verify tracker state on next upload attempt.

---

### 3.3 NEW: `image-queue.ts` bootstrap may miss pending images if `permanentlyFailedIds` is large (TRC-N2 — carried forward)

**Observation:** `image-queue.ts:667-697` bootstrap query excludes `permanentlyFailedIds`.

**Trace:** If the first 500 pending images are all permanently failed, the query returns 0 rows, `bootstrapped = true`, and valid pending images after the failed batch are never discovered.

**Confidence:** Medium. The `permanentlyFailedIds` Set has a MAX cap of 1000, but the bootstrap logic doesn't handle the "all pending images are permanently failed" case correctly.

**Probe:** Create 500 images with `processed=false` and corrupt originals, trigger bootstrap, verify it marks `bootstrapped=true` even though valid pending images exist after the failed batch.

---

### 3.4 NEW: `admin-backfill-runner.ts` `fetchCandidateBatch` uses raw SQL without type safety (TRC-N3 — carried forward)

**Observation:** `admin-backfill-runner.ts:400-411` uses `db.execute(sql\`...\`)` for candidate fetching.

**Trace:** The result is cast through multiple layers: `result[0]` as `unknown as CandidateRow[]`. This is a type-unsafe pattern.

**Confidence:** Low. The type cast is a code smell but the SQL is simple and unlikely to drift.

**Probe:** Verify that `IMAGE_PIPELINE_VERSION` is the same in both the upload path and the backfill path.

---

### 3.5 NEW: `data.ts` view count buffer may lose increments during rapid flush (TRC-N4 — carried forward)

**Observation:** `data.ts:48-61` buffers view counts and flushes them asynchronously.

**Trace:** If `bufferGroupViewCount` is called rapidly, the buffer may grow quickly. The `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` cap drops increments when exceeded, but only for NEW groups (existing groups can accumulate unlimited increments).

**Confidence:** Low. The behavior is documented and acceptable for the target scale.

**Probe:** Simulate 1001 concurrent views to different groups, verify one is dropped.

---

### 3.6 NEW: `process-image.ts` `generateForFormat` may leave partial files on crash (TRC-N5 — carried forward)

**Observation:** `process-image.ts:1050-1149` writes sized variants in a loop.

**Trace:** If the PROCESS crashes (SIGKILL, OOM) between `toFile(outputPath)` and the `finally` block, the partial file remains on disk. The retry mechanism handles this by overwriting on retry.

**Confidence:** Low. The retry mechanism handles this.

**Probe:** SIGKILL mid-encode, verify partial files are cleaned up on retry.

---

### 3.7 NEW: `session.ts` `getSessionSecret` DB fallback may race on multi-process dev (TRC-N6 — carried forward)

**Observation:** `session.ts:40-78` has a dev-only DB fallback for session secret.

**Trace:** In dev mode without `SESSION_SECRET`, multiple processes may generate different secrets. The re-fetch ensures both processes get the same DB value, but the race window is between INSERT IGNORE and re-fetch.

**Confidence:** Low. Dev-only, documented, and the re-fetch ensures both processes get the same DB value.

**Probe:** Two dev processes, create session on one, verify on other.

---

### 3.8 NEW: `rate-limit.ts` `decrementRateLimit` transaction may deadlock (TRC-N7 — carried forward)

**Observation:** `rate-limit.ts:410-440` uses `db.transaction` for decrement.

**Trace:** Single-row UPDATE followed by single-row DELETE on the same row. Under MySQL's default REPEATABLE READ, the UPDATE acquires an X lock on the row. The DELETE then tries to acquire another X lock on the same row (which it already holds). This should not deadlock, but a lost decrement is possible if two transactions both decrement from count=1.

**Confidence:** Low. The lost decrement is conservative and acceptable.

**Probe:** Concurrent decrements, verify count.

---

### 3.9 NEW: `db/index.ts` connection init timeout may leak connections on race (TRC-N8 — carried forward)

**Observation:** `db/index.ts:71-96` overrides `poolConnection.getConnection` to await the `group_concat_max_len` init query with a 10-second timeout.

**Trace:** If the init query is still running when the timeout fires, `connection.release()` returns the connection to the pool even though the init query may later complete and the connection may have the wrong `group_concat_max_len`.

**Confidence:** Medium. The `C4-C1` comment acknowledges this risk.

**Probe:** Simulate slow MySQL (e.g., `tc` network delay), trigger CSV export, verify `group_concat_max_len` is set correctly.

---

### 3.10 NEW: `image-queue.ts` fire-and-forget caption/embedding hooks may fail silently (TRC-N9 — carried forward)

**Observation:** `image-queue.ts:437-454` (caption) and `image-queue.ts:478-522` (embedding) are fire-and-forget hooks.

**Trace:** Failures are only logged to console.warn — no admin visibility, no retry, no persistence of failure state.

**Confidence:** Medium. The fire-and-forget pattern is documented as intentional, but the lack of admin visibility is a real operational gap.

**Probe:** Enable auto-alt-text, trigger an ONNX failure, verify no admin UI indication.

---

### 3.11 NEW: `serve-upload.ts` settings hash cache may serve stale hash after admin change (TRC-N10 — carried forward)

**Observation:** `serve-upload.ts:46-83` has a module-scoped 5-second TTL cache for the settings hash.

**Trace:** In a multi-process deployment, each process has its own cache. If an admin changes a color-impacting setting, Process A's cache expires within 5 seconds, but Process B's cache may still serve the old hash for up to 5 seconds.

**Confidence:** Low. The operational gotcha (CRT-D1) is already documented.

**Probe:** Change a color setting, verify ETag on static vs fallback paths before and after backfill.

---

### 3.12 NEW: Restore maintenance gap in topic and admin user actions (TRC-N12)

**Observation:** `apps/web/src/app/actions/topics.ts` and `apps/web/src/app/actions/admin-users.ts` do NOT check `getRestoreMaintenanceMessage()`.

**Trace:** The restore maintenance flag prevents uploads, image processing, smart collection creation, and embedding backfill. But topic creation, topic deletion, topic image upload, admin user creation, admin user deletion, and password changes are NOT blocked during restore.

**Competing Hypotheses:**
- H1 (Low): These actions are lower-risk. Topic and admin user changes don't affect the database tables being restored (images, tags, etc.). The restore typically targets the main data tables, not the config tables.
- H2 (Medium): If the restore includes ALL tables (full database dump), then topic and admin user changes during restore will be overwritten. The admin may create a topic, see it succeed, then see it disappear after restore completes. This is confusing and could lead to data loss if the admin re-creates the topic after restore.

**Confidence:** Medium. The inconsistency is real — some actions are blocked, others are not. The impact depends on the restore scope.

**Probe:** Trigger a restore, attempt topic creation during restore, verify topic state after restore completes.

---

### 3.13 NEW: `deleteImageVariants` ENOENT fix may mask real errors (TRC-N13)

**Observation:** `process-image.ts` (9c5c38ca) now ignores `ENOENT` in `deleteImageVariants`.

**Trace:** The fix distinguishes `ENOENT` (directory doesn't exist) from other errors. But what if the directory exists but is not readable (EACCES)? The error is still thrown. What if the directory exists but `opendir` fails for another reason (EMFILE, ENOMEM)? These are also thrown.

**Competing Hypotheses:**
- H1 (Low): The fix is correct. `ENOENT` is the only expected error during cleanup (directory already deleted or never created). All other errors are genuine problems that should be reported.
- H2 (Medium): If the directory is deleted BETWEEN the `exists` check and the `opendir` call, the race still throws. But the fix catches this at the `opendir` level, not the `exists` level, so it's correct.

**Confidence:** Low. The fix is correct and complete.

**Probe:** Delete directory between `exists` and `opendir`, verify error is handled.

---

## 4. Updated Risk Matrix

### High Confidence (new or confirmed)

| ID | Issue | Flow | Impact | Probe |
|----|-------|------|--------|-------|
| TRC-H1 | Static path ETag miss after settings change | Settings -> Serving | Stale derivatives served | Change setting, verify ETag on static vs fallback paths |
| TRC-H2 | Process-local state prevents scaling | All globalThis state | Horizontal scaling breaks | Multi-process deployment test |
| TRC-H3 | `getClientIp` "unknown" without `TRUST_PROXY` | Login rate limit | All users share bucket | Production without TRUST_PROXY, 5 failed logins from any IP |
| TRC-H4 | Fire-and-forget failures silent | Caption/embedding | No admin visibility | Trigger ONNX failure, check admin UI |
| TRC-H6 | DB init timeout may return uninitialized connections | DB pool | GROUP_CONCAT truncation | Simulate slow MySQL, trigger CSV export |
| TRC-N8 | Connection init timeout may leak uninitialized connections | DB pool | Silent data corruption | Simulate slow MySQL, verify group_concat_max_len |

### Medium Confidence (new or confirmed)

| ID | Issue | Flow | Impact | Probe |
|----|-------|------|--------|-------|
| TRC-M2 | Backfill `lastError` last-writer-wins | Backfill | Wrong error message | Concurrent failures, verify lastError |
| TRC-M5 | OG rollback pattern inconsistency | OG rate limit | Enumeration oracle | Verify fixture tests still pass |
| TRC-M6 | Queue quiesce may deadlock on hung Sharp | Restore | Restore never completes | Inject hung Sharp task, trigger restore |
| TRC-M9 | Bootstrap may miss pending images if all permanently failed | Image queue | Valid images not processed | Create 500 corrupt uploads, verify bootstrap |
| TRC-M10 | `dotProduct` fast path has no zero-vector guard | Semantic search | Potential NaN/undefined behavior | Insert zero-vector, verify query behavior |
| TRC-N2 | Bootstrap may miss pending images if all permanently failed | Image queue | Valid images not processed | Create 500 corrupt uploads, verify bootstrap |
| TRC-N9 | Fire-and-forget caption/embedding failures silent | Caption/embedding | No admin visibility | Trigger ONNX failure, check admin UI |
| TRC-N11 | `BoundedMap.get()` returns mutable reference | Rate limit | Map corruption | Audit all `BoundedMap.get()` callers |
| TRC-N12 | Restore maintenance gap in topic/admin actions | Restore | Confusing data loss | Trigger restore, attempt topic creation |

### Low Confidence (new or confirmed)

| ID | Issue | Flow | Impact | Probe |
|----|-------|------|--------|-------|
| TRC-L3 | GPS fallback strips non-GPS metadata | Upload | Metadata loss | Upload PNG with XMP, verify preservation |
| TRC-L8 | Semantic search 503 if weights missing | Semantic search | Feature unavailable | Remove weights, trigger search |
| TRC-L9 | Partial files on crash during encode | Image processing | Orphaned partials | SIGKILL mid-encode, verify cleanup |
| TRC-L10 | Session secret race in dev | Session | Cross-process session invalidation | Two dev processes, create session on one, verify on other |
| TRC-L11 | Rate limit decrement lost update | Rate limit | Slightly conservative count | Concurrent decrements, verify count |
| TRC-N1 | Upload tracker settlement under-count | Upload | Premature rejection | Simulate DB drop mid-upload, verify tracker |
| TRC-N3 | Backfill raw SQL type unsafety | Backfill | Type mismatch | Modify SQL, verify compiler catches it |
| TRC-N4 | View count buffer drops new groups | Analytics | Bounded loss | 1001 concurrent views, verify one dropped |
| TRC-N5 | Partial files on crash during encode | Image processing | Orphaned partials | SIGKILL mid-encode, verify cleanup |
| TRC-N6 | Session secret race in dev | Session | Cross-process session invalidation | Two dev processes, create session on one, verify on other |
| TRC-N7 | Rate limit decrement lost update | Rate limit | Slightly conservative count | Concurrent decrements, verify count |
| TRC-N10 | Settings hash cache stale after admin change | Serving | Brief skew | Change setting, verify ETag across processes |
| TRC-N13 | `deleteImageVariants` ENOENT fix completeness | Cleanup | None — fix is correct | N/A |

---

## 5. Invariants Verified (Still Hold)

| ID | Invariant | Evidence |
|----|-----------|----------|
| TRC-V1 | No sensitive keys in `publicSelectFields` | `_SensitiveKeysInPublic` compile-time guard |
| TRC-V2 | `COLOR_IMPACTING_KEYS` are valid settings | `_ColorKeysAreSettingKeys` compile-time guard |
| TRC-V3 | Mutating admin actions use `requireSameOriginAdmin()` | Lint gate: `check-action-origin` |
| TRC-V4 | Admin API routes wrap with `withAdminAuth()` | Lint gate: `check-api-auth` |
| TRC-V5 | Public mutating routes have rate-limit pre-increment | Lint gate: `check-public-route-rate-limit` |
| TRC-V6 | Touch targets >= 44px | Unit test: `touch-target-audit.test.ts` |
| TRC-V7 | No Unicode bidi/formatting in admin strings | `validation.ts` rejects `UNICODE_FORMAT_CHARS` |
| TRC-V8 | GPS excluded from public API | `publicSelectFields` omits + compile-time guard |
| TRC-V9 | Session tokens use HMAC-SHA256 + timingSafeEqual | `session.ts:106-118` |
| TRC-V10 | Passwords use Argon2id with OWASP-exceeding params | `password-hashing.ts` |
| TRC-V11 | 10-bit AVIF probe retries transient errors | `process-image.ts:84-123` (R8-R5 fix) |
| TRC-V12 | Backfill cleanup uses full directory scan | `admin-backfill-runner.ts:430-440` (AGG-R8c3-03) |
| TRC-V13 | View count buffer has retry cap and backoff | `data.ts:26-46` (C30-03, C5-AGG-02) |
| TRC-V14 | Upload tracker has TOCTOU fix | `images.ts:190-194` (C8R-RPL-02) |
| TRC-V15 | Queue claim retry removes from enqueued before reschedule | `image-queue.ts:303` (C4-A1) |
| TRC-V16 | Backfill serializes via advisory lock | `admin-backfill-runner.ts:303-322` |
| TRC-V17 | Per-image processing claim prevents double-encode | `image-queue.ts:210-227` |
| TRC-V18 | Restore maintenance prevents uploads/processing | `restore-maintenance.ts:21-56` |
| TRC-V19 | Rate limit pre-increment prevents TOCTOU | `auth.ts:122-138` |
| TRC-V20 | Conditional UPDATE prevents delete-during-processing orphan | `image-queue.ts:412-435` |
| TRC-V21 | Symlink rejection on upload and serve | `images.ts` (lstat) + `serve-upload.ts:175-184` |
| TRC-V22 | Path traversal containment on upload and serve | `images.ts` (SAFE_SEGMENT) + `serve-upload.ts:154-161` |
| TRC-V23 | Session invalidation on password change | `auth.ts:388-399` |
| TRC-V24 | Last admin deletion prevented | `auth.ts` (last admin check) |
| TRC-V25 | Audit log retention guard prevents negative values | `audit.ts:66-75` (R4C6 COR-R4C6-10) |
| TRC-V26 | View retention guard prevents negative values | `view-retention.ts:39-47` (R4C6 COR-R4C6-10) |
| TRC-V27 | Upload processing contract lock serializes uploads with settings changes | `upload-processing-contract-lock.ts:9-74` |
| TRC-V28 | Queue quiesce clears bootstrap retry timer | `queue-shutdown.ts:33-36` (C4-C3) |
| TRC-V29 | Connection init timeout clears stale promise | `db/index.ts:94-101` (R10-C3-TRC-H6) |
| TRC-V30 | Backfill concurrency clamped to pool budget | `admin-backfill-runner.ts:105-142` (AGG-R5C3-05) |
| TRC-V31 | Caption/embedding hooks do not block queue | `image-queue.ts:437-454, 478-522` |
| TRC-V32 | Settings hash debounced on serving path | `serve-upload.ts:46-83` (R4C3 PERF-R4C3-05) |
| TRC-V33 | Blur data URL validated at producer, write, and read time | `blur-data-url.ts` + `process-image.ts` + `images.ts` + `photo-viewer.tsx` |
| TRC-V34 | OG sanitize shared across all three consumers | `og-sanitize.ts` (AGG-R8-13, AGG-R8c3-02) |
| TRC-V35 | CSV export strips formula injection, bidi, zero-width chars | `csv-escape.ts` (C7R-RPL-01, C7R-RPL-11, C8R-RPL-01) |
| TRC-V36 | Admin string fields reject Unicode formatting | `validation.ts` (C3L-SEC-01 through C6L-SEC-01) |
| TRC-V37 | Service Worker offline cache excludes admin-rendered pages | `sw.template.js` (R4C6 COR-R4C6-05) |
| TRC-V38 | Service Worker HEAD revalidation bounded by timeout | `sw.template.js` (AGG-R8-05, 300ms) |
| TRC-V39 | Migration post-condition asserts no silent skips | `migrate.js` (R4C6 COR-R4C6-10) |
| TRC-V40 | Backfill detection-failure leaves version behind for retry | `admin-backfill-runner.ts:583-612` (Run-2c1 AGG-01) |
| TRC-V41 | Backfill deleted-mid-reencode cleans up variants | `admin-backfill-runner.ts:576-578` (AGG-R8c3-03) |
| TRC-V42 | Queue deleted-mid-processing cleans up variants | `image-queue.ts:418-434` (AGG-C4-04) |
| TRC-V43 | Per-image processing claim acquired before backfill re-encode | `admin-backfill-runner.ts:343-368` (TRC-R5C2-01) |
| TRC-V44 | Pool budget cap prevents backfill from starving live traffic | `admin-backfill-runner.ts:105-142` (AGG-5) |
| TRC-V45 | Upload tracker pruned with 2x grace period | `upload-tracker-state.ts:24-60` (C17-LOW-09) |
| TRC-V46 | BoundedMap auto-enforces hard cap on write | `bounded-map.ts:65-73` (C8R-C8-01) |
| TRC-V47 | Queue retry maps pruned with FIFO eviction | `image-queue.ts:98-111` (C9-MED-02) |
| TRC-V48 | Permanently failed IDs capped with FIFO eviction | `image-queue.ts:545-558` (C1F-DB-02, C7-MED-05) |
| TRC-V49 | View count retry count capped | `data.ts:26-32` (C5-AGG-02) |
| TRC-V50 | View count flush timer nulled on entry | `data.ts:80` (COR-R4C11-01) |
| TRC-V51 | Array.isArray guard prevents type confusion in loadMoreImages | `public.ts` (bcd67b12) |
| TRC-V52 | ENOENT distinguished from other opendir errors | `process-image.ts` (9c5c38ca) |
| TRC-V53 | Restore maintenance checks smart collections and embeddings | `collections.ts`, `embeddings.ts` (7453030e) |
| TRC-V54 | Revalidation moved outside try/catch | `topics.ts` (db55056f) |
| TRC-V55 | Rate-limit getters return shallow copies | `auth-rate-limit.ts` (5f4a5e95) |
| TRC-V56 | isAdmin() checks in deleteAdminUser and LR tokens | `admin-users.ts`, `lr-tokens.ts` (b22fa85e) |

---

## 6. Recommendations

### Immediate (High Priority)

1. **TRC-H6 / TRC-N8: Add connection init validation post-timeout**: After the 10s timeout in `db/index.ts`, mark the connection as "uninitialized" or retry the init query on the next borrow. Alternatively, increase the timeout and add monitoring.
2. **TRC-H4 / TRC-N9: Surface fire-and-forget failures**: Add a `processing_warnings` column to the `images` table or a separate `processing_log` table to capture caption/embedding failures. The admin UI should display these.

### Short-term (Medium Priority)

1. **TRC-M9 / TRC-N2: Fix bootstrap "all permanently failed" edge case**: After `pending.length < BOOTSTRAP_BATCH_SIZE`, verify that there are NO pending images (including those in `permanentlyFailedIds`) before setting `bootstrapped = true`. Or use a separate query to check for any pending images.
2. **TRC-M10: Add zero-vector guard to `dotProduct`**: Even though the invariant says vectors are unit-length, add a defensive check: `if (denom < EPSILON) return 0;` in `dotProduct` for consistency with `cosineSimilarity`.
3. **TRC-M6: Add timeout to queue quiesce**: `quiesceImageProcessingQueueForRestore` should have a timeout (e.g., 60 seconds) after which it forcefully terminates hung tasks and proceeds with restore.
4. **TRC-N11: Fix `BoundedMap.get()` mutable reference**: Either return shallow copies from `BoundedMap.get()` (like `auth-rate-limit.ts` now does) or document that callers must not mutate returned values.
5. **TRC-N12: Add restore maintenance checks to topic and admin user actions**: For consistency, all mutating admin actions should check `getRestoreMaintenanceMessage()` before proceeding.

### Long-term (Low Priority)

1. **TRC-H1: Document static path ETag limitation more prominently**: The CRT-D1 operational gotcha should be in the admin UI settings page, not just CLAUDE.md. Add a warning when admin changes color/quality/size settings: "Run backfill to invalidate cached derivatives."
2. **TRC-L3: Preserve non-GPS metadata in PNG fallback**: Investigate whether `withMetadata({ exif: true, xmp: true, iptc: true })` can be used safely for PNG without leaking GPS.
3. **TRC-N10: Consider shared cache for settings hash**: In a multi-process deployment, use Redis or a shared memory store for the settings hash to eliminate cross-process skew.

---

*Review completed by tracer agent. 6 high-confidence issues (all confirmed), 9 medium-confidence issues (2 new, 7 confirmed), 13 low-confidence issues (1 new, 12 confirmed). 56 invariants verified (6 new from cycle 10 fixes).*

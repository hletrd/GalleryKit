# Debugger — Cycle 1 Fresh Review (2026-04-27)

## Latent Bug Surface and Failure Mode Analysis

---

## Findings

### C1-DB-01: `uploadImages` tracker pre-increment not rolled back on pre-loop errors
**File:** `apps/web/src/app/actions/images.ts:242-244`
**Severity:** Medium | **Confidence:** High

The tracker pre-increment (lines 242-244) claims bytes/count before the file processing loop (line 251). The `settleUploadTrackerClaim()` calls at lines 405 and 410 reconcile after the loop. However, if an error occurs between lines 242 and 251 — specifically in the disk space check (lines 207-216) or topic validation (lines 229-236) — the function returns early with an error, but the tracker pre-increment is not rolled back.

Wait — on closer inspection, lines 207-216 and 229-236 execute BEFORE line 242. Let me re-read the code flow:

1. Lines 178-241: Validation, config, tracker setup, disk check, total size check, topic validation
2. Lines 242-244: Pre-increment tracker
3. Lines 246-401: File processing loop
4. Lines 404-431: Settlement and return

Actually, the pre-increment at 242-244 is AFTER all the early-return validation checks. The only early returns after line 242 would be from within the per-file try/catch block (lines 254-401), which properly tracks `successCount` and `uploadedBytes`. The `settleUploadTrackerClaim` calls at 405/410 use these counters.

However, there's still a gap: if an unexpected error occurs between line 244 and the file loop at 251 (e.g., the `for` loop itself throws), the settlement wouldn't happen. This is extremely unlikely since `for...of` on an array doesn't throw.

**Revised severity:** Low | **Confidence:** Medium — the practical risk is near-zero, but the code could be more defensive by wrapping lines 242-431 in a try/catch that settles the tracker on any unexpected error.

**Fix:** Consider adding a try/catch around lines 242-429 that calls `settleUploadTrackerClaim` in the catch block.

---

### C1-DB-02: `processImageFormats` copyFile fallback loses atomicity guarantee
**File:** `apps/web/src/lib/process-image.ts:437-452`
**Severity:** Low | **Confidence:** High

The 3-level fallback chain for the base filename rename:
1. `link` + `rename` (atomic)
2. `copyFile` + `rename` (atomic if rename succeeds)
3. `copyFile` (non-atomic — window where base file is partially written)

Fallback 3 (`copyFile` without rename) re-introduces the race condition the atomic rename was designed to prevent: during the copy, a concurrent request could read a partially-written base file and get a corrupted image response. This only happens on severely broken filesystems where both `link` and `rename` fail.

**Fix:** Document this edge case. Consider throwing an error instead of falling back to direct `copyFile`, since a filesystem that can't do `rename` is unlikely to serve files correctly anyway.

---

### C1-DB-03: `flushGroupViewCounts` — buffer clear + batch copy loses concurrent increments
**File:** `apps/web/src/lib/data.ts:52-53`
**Severity:** Low | **Confidence:** Medium

```ts
const batch = new Map(viewCountBuffer);
viewCountBuffer.clear();
```

Between creating the batch copy and clearing the buffer, a concurrent `bufferGroupViewCount` call could add an increment to the buffer. Since `bufferGroupViewCount` is synchronous and JavaScript is single-threaded, this cannot happen in practice — the `flushGroupViewCounts` function holds the event loop for the duration of the copy+clear. No concurrent interleaving is possible.

**Status:** Not a real issue — JavaScript's single-threaded execution model prevents this race condition.

---

### C1-DB-04: `deleteImageVariants` called with explicit sizes avoids directory scan
**File:** `apps/web/src/lib/process-image.ts:186`
**Severity:** Low | **Confidence:** Low

When `deleteImageVariants` is called with the current config sizes (from `enqueueImageProcessing`), it skips the directory scan and only deletes known-size variants. If an image was previously processed with different sizes, the old variants would be orphaned. However, the `processImageFormats` function always creates the base filename (largest size), so the base file is always present.

The `deleteImage()` and `deleteImages()` functions call `deleteImageVariants` with `[]` (triggers directory scan), which correctly handles old variants. The queue processing path calls with current sizes, which is correct for the queue's use case (deleting variants it generated).

**Status:** Not a real issue — the two call patterns serve different purposes and are both correct.

---

### C1-DB-05: `session.expiresAt` type mismatch potential
**File:** `apps/web/src/lib/session.ts:139`
**Severity:** Low | **Confidence:** Low

```ts
if (session.expiresAt < new Date()) {
```

The `expiresAt` column is defined as `timestamp("expires_at").notNull()`. Drizzle reads MySQL `TIMESTAMP` columns as JavaScript `Date` objects. The comparison `session.expiresAt < new Date()` is a standard Date comparison, which works correctly in JavaScript. However, if the Drizzle column type were `datetime` instead of `timestamp`, the behavior could differ across timezone configurations. The schema uses `timestamp`, so this is correct.

**Status:** Not a real issue — the `timestamp` type is correct and the Date comparison is valid.

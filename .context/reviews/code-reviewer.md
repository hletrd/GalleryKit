# Code Review — Cycle 16

**Reviewer:** oh-my-claudecode:code-reviewer (independent pass)
**HEAD:** 1f5fb245
**Date:** 2026-06-27
**Scope:** apps/web/src (all .ts/.tsx), apps/web/scripts (key scripts)
**Prior cycle context:** Cycle-15 plan implemented DBG-15-01 (GPS NaN fix), CR-15-01 (BoundedMap shallow-copy pattern), and related rate-limit correctness fixes.

---

## Code Review Summary

**Files Reviewed:** ~30 (deep reads of rate-limit.ts, auth-rate-limit.ts, bounded-map.ts, images.ts, image-queue.ts, upload-tracker-state.ts, upload-tracker.ts, process-image.ts [partial], actions/auth.ts, actions/admin-users.ts, actions/sharing.ts, data.ts [partial])

**Total Issues:** 5 (2 MEDIUM, 3 LOW)

### By Severity

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 2 (both actionable correctness issues)
- LOW: 3 (latent/documentation)

---

## Stage 1 — Spec Compliance

Cycle-15 fixes verified:

- **DBG-15-01 (GPS NaN fix):** `convertDMSToDD` in process-image.ts (lines 1446-1463) correctly validates all three DMS components with `Number.isFinite()` before arithmetic. Fix is complete and correct.
- **CR-15-01 (BoundedMap shallow-copy on `.get()`):** `BoundedMap.get()` (bounded-map.ts line 58-70) returns `{ ...value }` for object values. All callers in `auth-rate-limit.ts` correctly mutate the returned copy and call `.set()` to write back. Pattern is correctly applied.
- **Rate-limit rollback helpers:** `rollbackLoginRateLimit` and siblings in auth-rate-limit.ts correctly use `.get()` (copy) + `.set()` with decremented count. No in-place mutation bugs.

No cycle-15 fixes are broken or partially applied.

---

## Stage 2 — Code Quality Issues

### Issues

---

#### [MEDIUM] TOCTOU race in upload tracker limit enforcement

**File:** `apps/web/src/app/actions/images.ts:196-257`
**Confidence:** HIGH

**Issue:** The file-count and byte-budget limit checks at lines 196 and 227 happen BEFORE the pre-increment at lines 255-257, with two `await` points in between:

- Line 196: `if (tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW)` — **check here**
- Lines 203-218: `await ensureUploadDirectories()` + `await statfs(UPLOAD_DIR_ORIGINAL)` — **async gap 1**
- Lines 243-249: `await db.select(topics)...` — **async gap 2**
- Lines 255-257: `tracker.bytes += totalSize; tracker.count += files.length; uploadTracker.set(...)` — **increment here**

In Node.js's single-threaded async model, two concurrent `uploadImages()` invocations from the same IP (same `uploadTrackerKey`) can both arrive at line 196 before either has executed line 255. Both see `tracker.count = 0`, both pass the check, then both increment — the total may exceed `UPLOAD_MAX_FILES_PER_WINDOW` or `MAX_TOTAL_UPLOAD_BYTES`.

The comment at lines 183-188 ("Registering the entry on the Map up-front makes subsequent mutations share the same object reference") only prevents the cold-IP literal race (two creates racing on a cold key). It does NOT close the check-before-increment race; the shared reference is necessary but not sufficient — the check and increment are not atomic.

**Fix:** Pre-increment before the first `await` and roll back on validation failure. Specifically, claim the budget immediately after retrieving the tracker (before `ensureUploadDirectories`), return an error if the pre-claim would exceed limits, and use `settleUploadTrackerClaim` (already called at lines 507/529) to reconcile:

```ts
// Pre-claim budget immediately (before any await) — closes the TOCTOU window
if (tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW) {
    return { error: t('uploadLimitReached') };
}
tracker.count += files.length;       // claim slots atomically
tracker.bytes += totalSize;          // claim bytes atomically
uploadTracker.set(uploadTrackerKey, tracker);
// ... now safe to await
```

The existing `settleUploadTrackerClaim` at lines 507/529 already handles the reconciliation of claimed vs. actual bytes/count, so the rollback infrastructure is already present.

---

#### [MEDIUM] `BoundedMap.entries()` bypasses the shallow-copy invariant

**File:** `apps/web/src/lib/bounded-map.ts:115-116`
**Confidence:** HIGH

**Issue:** `BoundedMap.get()` (lines 58-70) returns a shallow copy (`{ ...value }`) to protect internal state. But `BoundedMap.entries()` (lines 115-117) returns `this.map.entries()` directly — the raw iterator over actual internal references. Any caller that iterates `.entries()` and mutates a value will directly mutate BoundedMap's internal state, bypassing the invariant that makes cycle-15's CR-15-01 safe.

Current production code has no callers of `.entries()` on a BoundedMap (grep confirmed). The risk is latent but real: the `.entries()` method is public API, and a future caller may reasonably assume copy semantics consistent with `.get()`. The `data` property (line 50-52) is documented as a "direct reads" escape hatch and its semantics are explicit; `.entries()` has no such documentation.

**Fix:** Either copy each value in the entries iterator (matching `get()` semantics):

```ts
*entries(): IterableIterator<[K, V]> {
    for (const [key, value] of this.map.entries()) {
        const copy = (value !== null && typeof value === 'object')
            ? { ...value } as V
            : value;
        yield [key, copy];
    }
}
```

Or add a JSDoc warning that values returned by `entries()` are live references and must not be mutated. The latter is acceptable given there are no current callers.

---

#### [LOW] Comment at images.ts:183-188 overstates TOCTOU protection

**File:** `apps/web/src/app/actions/images.ts:183-188`
**Confidence:** HIGH

**Issue:** The comment explains that pre-registering the tracker entry makes "subsequent mutations share the same object reference across concurrent invocations." This accurately describes the cold-IP race prevention, but a future reader could interpret it as evidence that the TOCTOU is fully resolved. It is not. The check-before-increment race (the MEDIUM issue above) remains open. The comment should be precise about what it does and does not protect.

**Fix:** Update the comment to explicitly note that only the cold-start literal race is closed here, and that the check-before-increment race requires the pre-increment to happen before the first `await`.

---

#### [LOW] `Number(process.env.QUEUE_CONCURRENCY) || 1` silently rejects `"0"`

**File:** `apps/web/src/lib/image-queue.ts:203`
**Confidence:** MEDIUM

**Issue:** `Number("0") || 1` evaluates to `1` because `0` is falsy. If an operator sets `QUEUE_CONCURRENCY=0` intending to pause job processing, the value is silently replaced with `1`. The comment at lines 200-202 suggests `0` is not a legitimate value ("Default to one foreground-friendly job"), but silent rejection of an explicit environment variable is harder to debug than a validation error.

**Fix:** Apply the same `Number.parseInt(..., 10) || DEFAULT` pattern already used at line 761 of images.ts (`CLEANUP_CONCURRENCY`), or explicitly guard with:

```ts
queue: new PQueue({ concurrency: Math.max(1, Number(process.env.QUEUE_CONCURRENCY) || 1) }),
```

(The current code and the fix produce the same runtime behavior for legitimate inputs. The improvement is auditing clarity — `Math.max(1, ...)` makes the floor explicit.)

---

#### [LOW] `BoundedMap.enforceHardCap()` evicts on every `.set()` even when under cap

**File:** `apps/web/src/lib/bounded-map.ts:88-99`
**Confidence:** LOW

**Issue:** `set()` always calls `enforceHardCap()` (line 83). `enforceHardCap()` checks `this.map.size > this.maxKeys` before doing any work, so it is nearly free when under cap. However, in a high-frequency write path (many rate-limit increments per second), calling a method that iterates `this.map.keys()` on every write is marginally wasteful. The iteration only runs if `size > maxKeys`, so this is not a real performance concern at personal-gallery scale. Flagged for documentation, not urgency.

**Fix:** No change required. Document the guard condition in a comment on `enforceHardCap()` so future readers don't reach for a caching optimization prematurely.

---

## Open Questions (low-confidence findings — surfaced, not blocking)

None. All findings above are at HIGH or MEDIUM confidence and have been assigned appropriate severity.

---

## Positive Observations

- **Cycle-15 BoundedMap pattern is correctly applied everywhere.** All three `auth-rate-limit.ts` getters return copies, and all writers use explicit `.set()`. The pattern is consistent and no caller was found to violate it.

- **GPS NaN fix (DBG-15-01) is airtight.** `[dms[0], dms[1], dms[2]].every(Number.isFinite)` validates all three components before any arithmetic. Guards are at both the DMS-to-DD conversion site and in `extractExifForDb` via `cleanNumber`.

- **Image queue claim/retry logic is robust.** MySQL advisory locks (`gallerykit:image-processing:{jobId}`) prevent double-processing across restarts. The claim failure path calls `releaseImageProcessingClaim` in a `finally` block. The conditional `WHERE processed = false` UPDATE correctly detects delete-during-processing and cleans up derivatives.

- **`settleUploadTrackerClaim` already provides the rollback infrastructure** needed to fix the TOCTOU above. The fix is mechanical — move the pre-increment earlier in the function without restructuring the rest.

- **Empty catch blocks in image-queue.ts (lines 396, 503) are intentional and commented.** The DB-unavailable-during-config-load case falls back to Sharp defaults with the comment present; the embedding-mode-detection failure silently skips semantic embeddings. Both are correct graceful degradation behaviors.

- **`requireSameOriginAdmin` is called in 45+ action exports** (grep confirmed). Coverage is broad.

- **Collect-then-delete pattern used correctly** in `BoundedMap.prune()`, `pruneRetryMaps`, `pruneUploadTracker`, and `permanentlyFailedIds` eviction — no iterator-invalidation bugs.

- **Fire-and-forget void IIFEs** for caption and embedding in image-queue.ts each have their own try/catch and `console.warn` so failures are logged and never propagate to the queue job result. Pattern is consistent between the two hooks.

---

## Recommendation

**COMMENT**

No CRITICAL or HIGH issues found. Two MEDIUM issues are present — both relate to the upload tracker subsystem:

1. A real but low-exploitability TOCTOU in admin-only upload quota enforcement (requires concurrent upload requests from the same admin IP).
2. A latent invariant inconsistency in `BoundedMap.entries()` (no current callers).

The three LOW items are documentation/minor-quality concerns. The codebase is in good shape for cycle 16 and the cycle-15 fixes are all correctly applied. The MEDIUM TOCTOU fix is straightforward (move pre-increment before the first `await`) and can be done in a single targeted commit.

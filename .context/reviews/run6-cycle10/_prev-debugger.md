# Debugger Report — Cycle 9 (HEAD af9ae6c5)

**Date:** 2026-06-17
**Scope:** Deep latent-bug sweep, entire repo. CLIP semantic search LIVE in production. Convergence strongly expected after cycle 8 closed 13 findings.

---

## Verification of Cycle-8 Fixes

All cycle-8 fixes confirmed present at HEAD:

| ID | Description | Verified |
|----|-------------|---------|
| AGG-C8-02 | `download-clip-models.ts` pre-checks full manifest before early-return | YES — `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, false)` called over complete manifest before `return` |
| AGG-C8-04 | Short-query guard in `search.tsx` (`countCodePoints < 3 → invalidSemantic`) | YES — `SEMANTIC_MIN_QUERY_CODEPOINTS=3` guard present, `setSearchStatus('invalidSemantic')` wired |
| AGG-C8-05 | `modelVersion` hoisted above `notExists` subquery in `embeddings.ts` | YES — hoisted above the query; subquery filters on both `imageId` AND `modelVersion` |
| AGG-C8-09 | `dotProduct` (not `cosineSimilarity`) in similar route | YES — `similar/[id]/route.ts` uses `dotProduct` exclusively |
| AGG-C8-10 | `lens_model` + `capture_date` added to similar route enrichment | YES — lines 205-206 of `similar/[id]/route.ts` |
| AGG-C8-11 | `aria-controls` / `id` pairing in `similar-photos.tsx` | YES — button has `aria-controls="similar-photos-results"`, div has `id="similar-photos-results"` |
| AGG-C8-12 | `clipModelArtifactDir` guards 2-segment model ID + 40-hex revision | YES — throws on bad model ID and non-hex revision |

---

## New Findings

### DBG-C9-01 — LOW — `SimilarResult` interface missing `lens_model` and `capture_date`

**Symptom:** TypeScript type for API response in `similar-photos.tsx` is narrower than the actual JSON shape.

**Root Cause:** The `SimilarResult` interface at `apps/web/src/components/similar-photos.tsx:14-25` was defined before AGG-C8-10 added `lens_model` and `capture_date` to the similar route's enrichment SELECT. The interface was not updated to match.

```
interface SimilarResult {
    imageId: number;
    score: number;
    title: string | null;
    description: string | null;
    filename_jpeg: string;
    width: number;
    height: number;
    topic: string;
    topic_label: string | null;
    camera_model: string | null;
    // MISSING: lens_model: string | null;
    // MISSING: capture_date: string | null;
}
```

The API (`similar/[id]/route.ts:183-184`) returns both fields; the semantic route (`semantic/route.ts:286`) also returns them in the identical response shape. The component only renders `item.title` and `item.description` from the struct, so no runtime crash occurs — TypeScript drops the extra JSON keys silently. However:

- The type contract is wrong: if a future caller passes a `SimilarResult` to a component that expects `lens_model`/`capture_date` (e.g. a shared result-card component), the type system will not catch the missing fields.
- The semantic route uses the same field set; the `SearchResult` type in `search.tsx` presumably already includes these fields for the semantic route. The divergence is a maintenance hazard.

**Severity:** LOW — no runtime crash, no user-visible defect today. Risk is future type drift.

**Files:**
- `apps/web/src/components/similar-photos.tsx:14-25` — missing fields
- `apps/web/src/app/api/search/similar/[id]/route.ts:183-184` — fields returned by API

**Fix:**
```diff
 interface SimilarResult {
     ...
     camera_model: string | null;
+    lens_model: string | null;
+    capture_date: string | null;
 }
```

**Verification:** `npm run typecheck --workspace=apps/web` must continue to pass after the addition.

---

## Items Verified Robust (Not Re-Reported)

The following areas were examined and found clean at HEAD:

### CLIP Singleton / Retry Safety
`clip-model.ts` `loadPromise` nulled in `.catch()` before re-throw — a failed model load never poisons the singleton; the next call will retry the full load. No regression.

### i18n Key Parity
`search.invalidSemantic`, `search.similarPhotos`, `search.similarEmpty` confirmed present in both `en.json:412,415-416` and `ko.json:412,415-416`.

### Semantic Rate-Limit Rollback Coverage
Both `/api/search/semantic/route.ts` and `/api/search/similar/[id]/route.ts` call `rollbackSemanticAttempt(ip)` on every early-return path after `preIncrementSemanticAttempt`. No leaking increment found.

### Advisory Lock Release in image-queue.ts
`releaseImageProcessingClaim` is called in `finally` at `image-queue.ts:545` — the lock is released even when processing throws, retries, or the image is deleted mid-processing.

### Fire-and-Forget Embedding in image-queue.ts
The embedding write (lines 434-478) is wrapped in `void (async () => {...})()` with its own `catch`. Embedding failure logs a warning but cannot propagate to the main queue job or cause the queue to stall. The fire-and-forget is correct for an optional enrichment step.

### Admin Backfill State Reset
`admin-backfill-runner.ts:636-642` resets `processed`, `errors`, all category counters, and `lastRunHadFailures` at the START of every run. Fatal per-run abort at line 803 sets `state.lastError`. `lastRunHadFailures` is set only on encode/detection/fatal errors — `deletedMidReencode` correctly excluded (line 791).

### Backfill Lock Release on Error
`admin-backfill-runner.ts:807` calls `releaseBackfillLock` in `finally` — the advisory lock is released whether the run completes cleanly or aborts with an exception.

### Bootstrap Cursor / Permanently-Failed ID Exclusion
`bootstrapImageProcessingQueue` at `image-queue.ts:621-628` excludes `permanentlyFailedIds` from the DB query via `notInArray`. Bootstrap cursor (`bootstrapCursorId`) advances keyset-style. No unbounded retry loop for permanently failed rows.

### Retry Map Bounded Growth
`retryCounts`, `claimRetryCounts`, and `lastErrors` are all bounded to `MAX_RETRY_MAP_SIZE = 10000` with FIFO eviction in `pruneRetryMaps` (called in `finally` of every queue job). `permanentlyFailedIds` bounded to `MAX_PERMANENTLY_FAILED_IDS = 1000`.

### `clipModelArtifactDir` Path Safety
Throws on `JINA_CLIP_MODEL_ID` with != 2 segments and on `JINA_CLIP_REVISION` that is not a 40-hex SHA — prevents silent path mis-routing on future model upgrades.

### Similar-Photos Production Gate
`similar-photos.tsx:95` returns `null` when `semanticSearchMode !== 'production'` — the control is never rendered in disabled/stub mode, eliminating the dead-503 layout shift.

### Admin error.tsx
`error.tsx` destructures only `reset` from the error boundary props; the `error` prop is unused but that is a valid Next.js error boundary pattern — no bug.

---

## Summary

**1 new finding: DBG-C9-01 (LOW).**

All cycle-8 fixes verified present. No crash paths, unbounded-growth vectors, advisory-lock wedge conditions, race conditions, or CLIP pipeline regressions found. The codebase is in a strongly converged state.

| ID | Severity | One-line description |
|----|----------|----------------------|
| DBG-C9-01 | LOW | `SimilarResult` interface in `similar-photos.tsx` missing `lens_model` + `capture_date` fields that the API now returns |

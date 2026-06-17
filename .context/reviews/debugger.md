# Debugger Review — Cycle 10 (HEAD 0502ae86)

**Date:** 2026-06-17
**Reviewer:** debugger agent (oh-my-claudecode)
**Scope:** Final-sweep latent-bug hunt. Focus areas: CLIP/semantic surface, recently-touched files, unhandled promise rejections, null/undefined access, type coercion bugs, boundary conditions, error-handling failures, resource leaks, concurrency bugs.

---

## Summary

**No latent bugs found.** After a systematic trace of every runtime-critical path, no real latent bugs were identified that would crash, throw, hang, corrupt state, or produce wrong output under a realistic input/condition. The codebase has converged strongly across cycles 1–9.

---

## What Was Examined

### 1. CLIP model load singleton (`lib/clip-model.ts:76–108`)

The `loadPromise` singleton is nulled in the `.catch()` handler so a failed load allows retry on the next call. `getModelBundle()` never caches a rejected promise. The `embedTextReal` and `embedImageReal` functions both check for missing output keys (`l2norm_text_embeddings`, `l2norm_image_embeddings`) and throw with informative messages. The `EMBEDDING_DIM` lower-bound check covers truncated model outputs. No issue.

### 2. Stub embedding normalization contract (`lib/clip-inference.ts`, `app/api/search/semantic/route.ts:271`)

`deterministicEmbedding()` returns raw `[-1,1]` values without L2 normalization — intentionally. The semantic route gates on `isProd` and uses `cosineSimilarity` for stub mode (not `dotProduct`). The `dotProduct` fast-path is only used when `isProd === true`, where both the query and stored vectors are guaranteed unit-normalized via `truncateAndNormalize`. The similar route (`/api/search/similar/[id]`) is production-only (Gate 5 returns 503 for non-production), so it always uses `dotProduct` correctly. No issue.

### 3. `decodeEmbeddingColumn` case-2 latin1 path (`lib/clip-embeddings.ts:110–118`)

Case-1 handles `value.length === EMBEDDING_BYTES` (2048 bytes — the current write path). Case-2 is only reached when `value.length !== 2048`, meaning the Buffer genuinely contains base64 ASCII (the legacy pre-fix write path). In that scenario `toString('latin1')` produces a 1-byte-per-char string and `Buffer.from(..., 'base64')` correctly decodes it back to raw bytes. A raw float32 buffer mistakenly reaching case-2 would produce `floor(2048 * 3/4) = 1536` bytes, which fails the `=== EMBEDDING_BYTES` check and returns null — silently discarding that row rather than corrupting results. The three-case decode logic is correct and safe. No issue.

### 4. Rate-limit rollback coverage (semantic + similar routes)

Semantic route (`route.ts:228, 243, 258`): rollback on disabled-mode 503, embed failure 503, and DB scan failure 500. The enrichment catch-and-continue path does not roll back — correct, because it returns a 200 with empty results, not an error response. Similar route: rollback at all Gate 5/6/7 early-return paths. No missing rollback. No issue.

### 5. `clampSemanticTopK` boundary conditions (`route.ts:88–91`)

`topK=0` → `Math.max(Math.floor(0), 1) = 1`. `topK=-5` → clamps to 1. `topK=true/false/[]` → rejected by the `typeof raw !== 'number'` guard, returns `SEMANTIC_TOP_K_DEFAULT`. `topK=Infinity` → `Number.isFinite` false → default. All boundary cases are handled correctly. No issue.

### 6. `backfill-clip-embeddings.ts` SEMANTIC_SCAN_LIMIT stop (`scripts/backfill-clip-embeddings.ts:139–145`)

The cursor is advanced on line 139 before the limit check on line 142. When the limit triggers, the current `rows` batch is NOT processed — this is intentional operator-stop behaviour (the script prints "re-run to continue"). On re-run, `cursor` resets to 0 and the `notExists()` filter skips already-embedded rows, so the stopped batch is picked up cleanly. The limit is a safeguard cap, not a correctness invariant. No issue.

### 7. libheif probe singleton (`lib/process-image.ts:69–122`)

`_probeHighBitdepthAvif()` always resolves to `true` or `false` — it never rejects (all error paths `return false`). Therefore `_highBitdepthAvifProbePromise` never holds a rejected promise and is never nulled on failure. This is the correct design: a transient encode error during the probe conservatively disables 10-bit AVIF for the lifetime of the process, which is safe. No issue.

### 8. Advisory lock connection release paths

`admin-backfill-runner.ts` (`acquireBackfillLock`, `acquireImageProcessingClaim`): both release the connection in the `catch` branch on `GET_LOCK` failure. `reprocessOne` releases `claimConn` in a `finally` block. `runBackfill` releases the whole-run lock in its `finally` block via `releaseBackfillLock`. `image-queue.ts`: `acquireImageProcessingClaim` releases on `catch` and on failed-acquire. The queue task releases `lockConnection` in its `finally` block. No leak path found.

### 9. View count flush (`lib/data.ts`)

`flushGroupViewCounts` uses double-buffering (swap-then-drain), correctly nulls `viewCountFlushTimer` on entry (COR-R4C11-01 fix), uses `isFlushing` guard for reentrancy, and re-arms the timer in `finally` when the buffer has pending entries. Exponential backoff on consecutive failures. Re-buffer path respects `VIEW_COUNT_MAX_RETRIES` and `MAX_VIEW_COUNT_BUFFER_SIZE`. No floating promise — the timer callback is void-returning and all DB failures are caught inside. No issue.

### 10. Session purge and GC interval (`lib/image-queue.ts:561, 713–714`)

`purgeExpiredSessions()` has its own internal `try/catch`. The GC `setInterval` and bootstrap retry `setTimeout` attach `.catch()` handlers. No unhandled rejection exposure. No issue.

### 11. `semanticSearchMode` config resolution (`lib/gallery-config.ts:129–150`)

The `production` value heals to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is set. Invalid values fall back to `DEFAULTS.semantic_search_mode` (`'disabled'`). Config unavailability in both routes defaults to `'disabled'` and returns 503. Fail-closed throughout. No issue.

### 12. `canUseHighBitdepthAvif` singleton and `resolveClipModelsRoot` path resolution

Both are correctly memoised. `resolveClipModelsRoot` uses `path.isAbsolute()` to honour absolute bind-mount paths verbatim (preventing the doubled-path bug). `clipModelArtifactDir` validates model-id format and revision SHA at call time. No issue.

### 13. `topK()` with empty input (`lib/clip-embeddings.ts:137–142`)

`topK([], k, threshold)` returns `[]`. `k=0` is impossible at the call site due to `clampSemanticTopK` clamping to minimum 1. No issue.

### 14. `dotProduct` / `cosineSimilarity` with null embeddings

Both throw on dimension mismatch. The scored-map in both routes filters nulls (from `decodeEmbeddingColumn`) before calling the similarity function. No crash path. No issue.

### 15. `backfill-clip-embeddings.ts` production path: null `filenameOriginal`

If a row has a null `filename_original` (schema allows null), `resolveOriginalUploadPath(null)` would throw inside the per-image `try/catch`, incrementing `failed++` and continuing. Correct degradation — individual failures do not abort the run. No issue.

---

## Files Examined

- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-inference.ts`
- `apps/web/src/lib/clip-paths.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`
- `apps/web/scripts/download-clip-models.ts`
- `apps/web/scripts/clip-model-manifest.ts` (partial)
- `apps/web/src/lib/process-image.ts` (libheif probe section)
- `apps/web/src/lib/image-queue.ts` (lock paths, embedding hook, purgeExpiredSessions, GC interval)
- `apps/web/src/lib/data.ts` (view count flush)
- `apps/web/src/lib/gallery-config.ts` (semanticSearchMode resolution)
- `apps/web/src/lib/gallery-config-shared.ts` (validator)
- `apps/web/src/__tests__/admin-backfill-concurrency-cap.test.ts`

---

## Verdict

**0 latent bugs found.** The codebase has converged. All runtime-critical paths examined above are handled correctly. No crash, throw, hang, state-corruption, or wrong-output condition was identified under any realistic input.

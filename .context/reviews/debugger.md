# Debugger Report — Run 6, Cycle 11

**HEAD:** a7de3ebd  
**Scope:** Systematic latent-bug hunt across CLIP/semantic surface and recently-touched runtime-critical paths  
**Verdict: 0 confirmed latent bugs**

---

## Paths Examined

### 1. `lib/clip-model.ts` — load singleton, retry-on-failure, missing-output-key handling, EMBEDDING_DIM check

**Status: Safe.**

- `loadPromise` is nulled in the `.catch()` before re-throwing, so a failed load allows retry on the next call — no stuck-null-promise scenario.
- Both `l2norm_text_embeddings` and `l2norm_image_embeddings` are checked for presence with an explicit throw if missing.
- `data.length < EMBEDDING_DIM` is checked with a throw; the `>=` direction is handled by `truncateAndNormalize` which takes the subarray.
- `env.allowRemoteModels = false` is set before any `from_pretrained` call.
- `getModelBundle()` cache is a module-level `let` — works correctly as a Promise singleton that clears on failure.

### 2. `lib/clip-embeddings.ts` — decodeEmbeddingColumn 3-case decode, topK, dotProduct/cosineSimilarity

**Status: Safe.**

- `decodeEmbeddingColumn`: Case 1 (raw Buffer, 2048 bytes) and Case 2 (legacy base64-in-Buffer via `latin1` decode) and Case 3 (string) are all handled; non-matching returns `null` which callers filter.
- `topK`: empty input array is safe — `.filter().sort().slice()` on an empty array returns `[]`.
- `dotProduct` and `cosineSimilarity` both guard with a dimension-mismatch throw.
- `normalizeEmbedding`: zero-vector guard (`norm === 0` early return) prevents NaN propagation.
- `truncateAndNormalize`: uses `v.subarray(0, EMBEDDING_DIM)` then `Float32Array.from()` (copies, safe), then `normalizeEmbedding`.

### 3. `lib/clip-inference.ts` — stub normalization contract

**Status: Safe.**

- `deterministicEmbedding` returns a non-normalized Float32Array from hash bytes (documented: NOT semantically meaningful).
- The semantic route correctly uses `cosineSimilarity` (not `dotProduct`) for stub mode — the comment at line 271 of `route.ts` calls this out explicitly: stub embeddings are NOT normalized, so `cosineSimilarity` is used, not the unit-vector shortcut.
- No normalization contract violation.

### 4. `app/api/search/semantic/route.ts` — clampSemanticTopK, rate-limit rollback coverage, fail-closed config

**Status: Safe.**

- `clampSemanticTopK`: rejects non-`number` typed values (guards against boolean/array coercion), clamps to `[1, SEMANTIC_TOP_K_MAX]`, uses `Math.floor`, falls back to `SEMANTIC_TOP_K_DEFAULT` for non-finite inputs. Contract is solid.
- Rate-limit rollback: `rollbackSemanticAttempt(ip)` is called on every early-return after the pre-increment — config unavailable (disabled => 503), embed failure (503), DB scan failure (500). No rollback leak found.
- Fail-closed config: the `try/catch` around `getGalleryConfig()` defaults `semanticMode` to `'disabled'` on any exception, then the `!== 'stub' && !== 'production'` guard returns 503 with a rollback.
- `isProd` mode correctly uses `dotProduct` (unit vectors) and `PRODUCTION_COSINE_THRESHOLD`; stub mode uses `cosineSimilarity` and `COSINE_THRESHOLD`.

### 5. `app/api/search/similar/[id]/route.ts` — rate-limit rollback coverage, fail-closed config

**Status: Safe.**

- Same rollback pattern as the semantic route — every early-return after the pre-increment calls `rollbackSemanticAttempt(ip)`.
- Production-only gate: returns 503 with rollback for any non-`'production'` mode.
- Target embedding null check: checks `targetRows.length === 0 || !targetRows[0].embedding` then calls `decodeEmbeddingColumn`; if decoded is `null`, returns 404 with rollback.
- Self-exclusion filter (`row.imageId !== id`) is applied before scoring.
- Always uses `dotProduct` (production-only path, unit vectors guaranteed).

### 6. `scripts/backfill-clip-embeddings.ts` — scan-limit stop, null filenameOriginal degradation

**Status: Safe.**

- `filename_original` is `notNull()` in the Drizzle schema, so `filenameOriginal` cannot be null at the query level.
- `resolveOriginalUploadPath(filename: string)` takes a `string` — type-safe.
- Scan-limit guard: `processed + failed + rows.length > SEMANTIC_SCAN_LIMIT` — runs before processing the batch, stops before exceeding the limit. Cursor correctly advanced with `rows[rows.length - 1].id`.
- Keyset pagination correctly breaks when `rows.length === 0` or `rows.length < BATCH_SIZE`.

### 7. `lib/process-image.ts` — libheif probe singleton never-rejects

**Status: Safe.**

- `_highBitdepthAvifProbePromise` is a module-level `let` initialized to `null`.
- `canUseHighBitdepthAvif()` sets the singleton to the Promise result of `_probeHighBitdepthAvif()` — NOT to the resolved boolean — so concurrent callers all await the same Promise.
- `_probeHighBitdepthAvif()` never throws: bitdepth rejections return `false`, transient errors retry then return `false`, unknown errors return `false`. The promise always resolves.
- No reset path — a `false` result is cached permanently for the process lifetime, which is correct (libheif capability does not change mid-process).

### 8. `lib/admin-backfill-runner.ts` — advisory lock connection release on every path

**Status: Safe.**

- `acquireBackfillLock`: lock connection is released in the `catch` block before re-throwing; `lockConn` set to `null` on handoff to `runBackfill`.
- `runBackfill`: `releaseBackfillLock(lockConn)` is in the `finally` block, executing regardless of success or exception in the `try` body.
- Per-image `acquireImageProcessingClaim`: lock connection is released in the inner `catch` before returning `locked`. The `claimConn` is released in `reprocessOne`'s `finally` after the UPDATE, covering every path (encode success, encode failure, detection failure, deleted-mid-reencode).
- `triggerAdminBackfill`: `lockConn` is released in its outer `catch` when the lock was acquired but an error occurred before handoff.

### 9. `lib/data.ts` — view-count flush double-buffer, timer re-arm, reentrancy guard

**Status: Safe.**

- `viewCountFlushTimer = null` is set on entry to `flushGroupViewCounts` BEFORE the `isFlushing` guard — prevents the stale-handle bug (documented COR-R4C11-01).
- Reentrancy guard (`isFlushing`): when a flush is already in progress, re-arms a timer only if `viewCountBuffer.size > 0 && !viewCountFlushTimer`, then returns. No double-flush.
- Double-buffer swap: `const batch = viewCountBuffer; viewCountBuffer = new Map()` — atomic reference swap. New increments during drain go to the fresh map.
- `finally` block re-arms timer if buffer is non-empty after drain.
- Failed flush re-buffers with retry count check and capacity check; `viewCountRetryCount` is capped at `MAX_VIEW_COUNT_RETRY_SIZE` with FIFO eviction.

### 10. `lib/gallery-config.ts` — semanticSearchMode heal-to-disabled

**Status: Safe.**

- `'production'` stored in DB heals to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION === 'true'`.
- The `catch` block in `_getGalleryConfig` returns `DEFAULTS.semantic_search_mode` (which is `'disabled'`) for any DB read failure.
- `getGalleryConfig` is wrapped in `cache()` (React per-request deduplication) — correct for SSR.

---

## Summary

All 10 paths are clean. No latent bugs found in cycle 11. The codebase continues to converge correctly.

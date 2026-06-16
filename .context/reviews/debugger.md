# Debugger Review — Cycle 2
**Date:** 2026-06-16
**HEAD:** 8ccc8806 (working tree modifications noted where relevant)
**Scope:** Full-repo latent-bug and failure-mode sweep (broad, not CLIP-specific).

---

## Files Examined

`lib/image-queue.ts`, `lib/process-image.ts`, `lib/color-detection.ts`,
`lib/gps-exif-strip.ts`, `lib/admin-backfill-runner.ts`, `lib/serve-upload.ts`,
`lib/auth-rate-limit.ts`, `lib/rate-limit.ts`, `lib/data.ts`,
`lib/use-display-capability.ts`, `lib/gallery-config.ts`, `lib/gallery-config-shared.ts`,
`lib/icc-extractor.ts` (prior session), `lib/icc-chromaticity.ts` (prior session),
`lib/gain-map-detection.ts` (prior session), `lib/upload-paths.ts`,
`lib/upload-tracker.ts`, `lib/admin-tokens.ts`, `lib/smart-collections.ts`,
`app/actions/images.ts`, `app/actions/auth.ts`, `app/actions/admin-users.ts`,
`app/actions/topics.ts`, `app/api/og/photo/[id]/route.tsx`,
`app/api/stripe/webhook/route.ts`, `app/api/checkout/[imageId]/route.ts`,
`app/api/download/[imageId]/route.ts`, `app/api/search/semantic/route.ts`,
`app/api/search/similar/[id]/route.ts`,
`components/photo-viewer.tsx`, `components/histogram.tsx`,
`components/wide-gamut-hint.tsx`, `components/search.tsx`,
`public/sw.js`, peer reviews (tracer, perf-reviewer, critic, code-reviewer).

Total: ~40 files read or grep-swept across ~465 source files.

---

## CRITICAL Findings

None confirmed at CRITICAL severity in this cycle sweep.

---

## HIGH Findings

### DBG-H1 — Upload tracker quota permanently overclaimed when an exception escapes the per-file try/catch
**Confidence:** High
**File:** `apps/web/src/app/actions/images.ts:251-507`
**Status:** Confirmed latent bug

**Root cause:** At line 251–252 the tracker is pre-incremented by the full batch (`tracker.bytes += totalSize; tracker.count += files.length`). `settleUploadTrackerClaim` only appears at line 485 (all-failures path) and line 507 (success path). These two settlement calls are inside the `try` block of the outer `acquireUploadProcessingContractLock` section. If any code between pre-increment and settlement throws an uncaught exception that propagates past the outer try (e.g. an unexpected throw from `headers()`, DB reconnect, or a Next.js framework error during the loop), the tracker is never settled.

The affected `uploadTrackerKey` (user:IP pair) remains overcounted by the full batch size and byte total until the tracker window expires. An admin hitting this error loses their upload quota for the rest of the window. Low exploit risk but poor UX for photographers on a degraded server.

**Fix (minimal):** Move `settleUploadTrackerClaim` into a `finally` block that runs unconditionally, or pre-increment per-file instead of per-batch.

---

### DBG-H2 — Wide-gamut downscale warning uses hardcoded 50 M pixel cap instead of the admin-configured value
**Confidence:** High
**File:** `apps/web/src/app/actions/images.ts:298`
**Status:** Confirmed semantic mismatch

**Root cause:**
```typescript
if (isWideGamutSource && data.width * data.height > 50_000_000) {
    wideGamutDownscaleWarningCount++;
}
```
`uploadConfig` is already fetched at line 177 and exposes `uploadConfig.wideGamutMaxSourcePixels`, but the warning check uses the hardcoded literal `50_000_000`. The actual encoder uses the configured value from `gallery-config.ts`. An admin who raises the cap to 100 M or lowers it to 20 M will see upload warnings that disagree with encoder behavior.

**Fix (minimal):** Replace the literal on line 298 with `uploadConfig.wideGamutMaxSourcePixels`.

---

### DBG-H3 — `serve-upload.ts` file stream has no request-abort signal; fd held open until GC on client cancel
**Confidence:** High
**File:** `apps/web/src/lib/serve-upload.ts:251-256`
**Status:** Confirmed resource-management gap

**Root cause:**
```typescript
fileStream = createReadStream(resolvedPath);
const webStream = Readable.toWeb(fileStream) as ReadableStream;
return new NextResponse(webStream, { headers: responseHeaders });
```
`createReadStream` opens an OS fd. The `destroy()` call in the `catch` block (lines 260–261) only handles errors during setup, not mid-transfer client aborts. When a browser aborts a download (navigation, back button, connection drop), the Node.js stream is not destroyed until GC. Under concurrent masonry grid loads with rapid navigation (common UX: open gallery, scroll fast, navigate away), fds accumulate. Node's default fd limit is 1024 on many Linux deployments; large AVIF files (up to 50 MB+) make aborts more common.

**Fix (minimal):** Attach an abort signal from the request to call `fileStream.destroy()` on abort, or use `response.signal` if available in the Next.js version.

---

## MEDIUM Findings

### DBG-M1 — `bootstrapImageProcessingQueue` resets `gcInterval` on every successful bootstrap run, delaying GC tasks during continuation batches
**Confidence:** Medium
**File:** `apps/web/src/lib/image-queue.ts:698-705`
**Status:** Likely (observable under large pending queues at startup)

**Root cause:**
```typescript
if (state.gcInterval) clearInterval(state.gcInterval);
state.gcInterval = setInterval(..., 60 * 60 * 1000);
```
Each call to `bootstrapImageProcessingQueue` that succeeds — including every continuation batch — clears the prior interval and starts a fresh 1-hour countdown. On a server processing 10 000 pending images (20 continuation batches at BOOTSTRAP_BATCH_SIZE=500), the GC timer is continuously reset and never fires for the entire bootstrap period. `bootstrapCleanupRun` ensures one-shot cleanup at startup, but the `purgeExpiredSessions` / `purgeOldBuckets` / `purgeOldAuditLog` periodic tasks are delayed beyond their intended 1-hour cadence.

**Fix (minimal):** Only arm `state.gcInterval` once — check `if (!state.gcInterval)` before setting it.

---

### DBG-M2 — `wide-gamut-hint.tsx`: `JSON.parse(raw)` from `localStorage` without try/catch will crash the component on malformed stored data
**Confidence:** High
**File:** `apps/web/src/components/wide-gamut-hint.tsx:40`
**Status:** Confirmed crash path

**Root cause:**
```typescript
const parsed = JSON.parse(raw) as PersistedDismiss;
```
`raw` comes from `localStorage.getItem(...)`. Users can write arbitrary strings to their own `localStorage`, and a storage write failure can produce truncated JSON. `JSON.parse` on a non-JSON string throws a `SyntaxError`. This propagates uncaught through the component and crashes the React subtree containing `WideGamutHint`. The photo viewer mounts this component; if no error boundary is placed above it, the crash collapses the entire photo page for the affected user until they clear `localStorage`.

**Fix (minimal):**
```typescript
let parsed: PersistedDismiss | null = null;
try { parsed = JSON.parse(raw) as PersistedDismiss; } catch { /* treat as fresh */ }
```

---

### DBG-M3 — `flushGroupViewCounts` backoff counter resets on any partial success, preventing backoff for consistently failing groups
**Confidence:** Medium
**File:** `apps/web/src/lib/data.ts:152-157`
**Status:** Logic inconsistency (analytics impact only)

**Root cause:**
```typescript
if (succeeded > 0) {
    consecutiveFlushFailures = 0;
} else if (batch.size > 0) {
    consecutiveFlushFailures++;
}
```
A partial flush (some groups succeed, some fail and are re-buffered) resets `consecutiveFlushFailures` to 0. During a sustained partial DB degradation where some shared group rows consistently fail to update, the exponential backoff never engages as long as at least one group succeeds per flush. The failing groups are retried at the base 5-second interval until VIEW_COUNT_MAX_RETRIES. Analytics impact only, but the backoff is ineffective for the failure mode it was designed to handle.

---

### DBG-M4 — `process-image.ts` `_verifyWebpIccChunk`: reads entire WebP file into memory then uses only 1 KB
**Confidence:** High
**File:** `apps/web/src/lib/process-image.ts` (WebP ICC verification function)
**Status:** Confirmed memory waste

**Root cause:** The WebP ICC verification helper uses `fs.readFile(outputPath)` to load the entire file, then uses `buffer.subarray(0, 1024)`. Wide-gamut WebP derivatives can be tens of MB. Under peak concurrency (QUEUE_CONCURRENCY=4, three formats in parallel per image), this transiently allocates `concurrency × 3 × file_size` bytes of unnecessary buffer. For 50 MB WebPs at concurrency 4: ~600 MB of extra allocation per encode cycle.

**Fix (minimal):** Use `fileHandle.read(smallBuf, 0, 1024, 0)` to read only the first 1 KB.

---

### DBG-M5 — `admin-tokens.ts` line 120: `JSON.parse` result used without shape validation
**Confidence:** Medium
**File:** `apps/web/src/lib/admin-tokens.ts:120`
**Status:** Risk (admin-controlled data, not a security hole)

**Root cause:** `JSON.parse(raw)` is inside a try/catch for SyntaxError, but the parsed object is used immediately without field type guards. If the `admin_settings` DB row is corrupted (e.g. manual DB edit, partial write) to contain a structurally valid JSON object with unexpected field types (e.g. `{"tokens": "not-an-array"}`), downstream code that expects `parsed.tokens` to be an array will throw a TypeError at runtime. Requires DB write access, so this is a robustness concern rather than a security issue.

---

### DBG-M6 — `parseCicpFromHeif`: redundant `dataSize >= 11` inner check masks the intent and the outer check is the only effective guard
**Confidence:** Medium
**File:** `apps/web/src/lib/color-detection.ts:251-253`
**Status:** Code clarity issue, no functional impact

```typescript
if (dataSize >= 11) {
    const colourType = buffer.toString('ascii', dataStart, dataStart + 4);
    if (colourType === 'nclx' && dataSize >= 11) {   // <-- always true here
```
The second `dataSize >= 11` check is dead code — the outer guard already enforces it. The `colourType` read requires only `dataSize >= 4`. The redundant check misleads reviewers into thinking the inner condition adds protection. No functional bug, but maintenance hazard if either threshold is changed independently.

---

## LOW Findings

### DBG-L1 — `permanentlyFailedIds` set in image-queue grows without bound; large deployments get unbounded `NOT IN (...)` queries
**Confidence:** Low
**File:** `apps/web/src/lib/image-queue.ts:625-626`
**Status:** Risk (long-running servers)

`permanentlyFailedIds` is a `Set<number>` that is only added to, never evicted. After months of operation with recurring upload failures, the `NOT IN (id1, ..., idN)` clause in each bootstrap query can grow into thousands of entries, degrading MySQL query planning. `pruneRetryMaps` in the GC interval handles the retry count maps but not this set.

---

### DBG-L2 — `color-detection.ts` ICC chromaticity fallback never fires when ICC name implies a known gamut but chromaticity data disagrees
**Confidence:** Low
**File:** `apps/web/src/lib/color-detection.ts:357`
**Status:** Edge-case honesty gap

The chromaticity fallback is gated on `colorPrimaries === 'unknown'`. If an ICC name says "sRGB" but the embedded `rXYZ/gXYZ/bXYZ` tags describe Display P3 (misconfigured export), the name-based result is kept and chromaticity is never consulted. Deliberate design (name takes precedence for known profiles), but worth flagging as a potential misdetection for malformed profiles.

---

### DBG-L3 — `serve-upload.ts` `If-None-Match` parsing splits on bare commas, not RFC 7232 quoted-string-aware commas
**Confidence:** Low
**File:** `apps/web/src/lib/serve-upload.ts` (ETag comparison section)
**Status:** Theoretical (ETag format never contains commas in practice)

The generated ETag is `W/"v7-{mtime}-{size}-{hash}"` — no commas. A comma in an ETag would cause a false-negative 304 miss. Not exploitable, not practically triggerable with the current ETag format.

---

### DBG-L4 — `parseCicpFromHeif`: `Number(buffer.readBigUInt64BE(...))` silently loses precision for boxes > 2^53 bytes
**Confidence:** Low
**File:** `apps/web/src/lib/color-detection.ts:241`
**Status:** Theoretical (files > 8 PB not reachable via 200 MB upload cap)

---

### DBG-L5 — `data.ts` view count re-buffer capacity check bypassed when `groupId` already exists in the new buffer
**Confidence:** Low
**File:** `apps/web/src/lib/data.ts:125-130`
**Status:** Bounded by post-flush enforcer at line 143

Re-buffering checks `!viewCountBuffer.has(groupId)` before the capacity gate, meaning a key already present bypasses the drop check and accumulates unbounded counts. The post-flush `while (viewCountBuffer.size > MAX)` loop at line 143 corrects entry count but not per-entry count magnitudes. Analytics only; no crash.

---

### DBG-L6 — `images.ts` upload action: `data.width * data.height` in the wide-gamut pixel warning is not guarded against integer overflow for extreme resolutions
**Confidence:** Low
**File:** `apps/web/src/app/actions/images.ts:298`
**Status:** Theoretical (200 MB upload cap prevents extreme dimensions in practice)

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 3 | DBG-H1, DBG-H2, DBG-H3 |
| MEDIUM | 6 | DBG-M1, DBG-M2, DBG-M3, DBG-M4, DBG-M5, DBG-M6 |
| LOW | 6 | DBG-L1, DBG-L2, DBG-L3, DBG-L4, DBG-L5, DBG-L6 |

**Top 3 most likely to bite in production:**
1. **DBG-M2** — `wide-gamut-hint.tsx` unguarded `JSON.parse(localStorage)` crashes the photo viewer for any user with corrupted dismiss state. User-visible, no server degradation needed to trigger it.
2. **DBG-H3** — `serve-upload.ts` fd accumulation on client abort. Triggered by normal browser navigation patterns during masonry grid loading; will eventually hit OS fd limits on a busy instance.
3. **DBG-H2** — Hardcoded 50 M pixel cap in upload warning disagrees with admin-configured `wide_gamut_max_source_pixels`. Silently misleads photographers whenever the setting is changed.

**Headline:** The CLIP surface is well-engineered. **Zero confirmed crash/correctness bugs.** The much-feared failure modes (rejected-init-promise cached forever, zero-vector NaN, concurrent-session corruption, embedding-hook breaking the queue race protections) are all handled correctly. Findings below are doc-drift (trivial) and genuine but dark-gated operational latent risks.

---

## CONFIRMED BUGS

**None.** No reproducible crash, data-corruption, or logic defect found on the CLIP surface or in the recently-touched non-CLIP files (`admin-backfill-runner.ts`, `error.tsx`, `page.tsx`, `sw.js`).

---

## Race-protection invariants — VERIFIED INTACT

The task flagged that the US-P51 embedding hook must not break the queue's race protections. Traced `image-queue.ts` line by line:

- The embedding hook (`void (async () => {...})()`, lines 433-470) fires **after** `processed=true` is committed (lines 369-371) and **after** the delete-during-processing cleanup branch (lines 373-390). An embedding failure (line 467-468 `catch`) only `console.warn`s — it never throws into the queue task, never marks the image unprocessed, never blocks the `PQueue`, never leaves orphaned files.
- The per-image advisory lock (`gallerykit:image-processing:{jobId}`) is released in the queue task's `finally` (line 537) — the detached embedding IIFE runs **outside** that lock window but only touches the `image_embeddings` table (its own PK = image_id), never the derivative files or the `processed` flag, so there is no double-encode / interleaved-write hazard.
- The conditional `UPDATE … WHERE processed = false` and orphaned-file cleanup are untouched by the hook. ✔

This is the correct design. The hook is genuinely fire-and-forget and cannot wedge the pipeline.

---

## Lazy-singleton model loader — VERIFIED CORRECT

`clip-model.ts` `getModelBundle()` (lines 54-81):

- **Concurrent first-call de-dup:** `loadPromise` is assigned **synchronously** (line 57) before the first `await`, so N concurrent first-callers all return the same in-flight promise — the ~874 MB weights load **once**, not N times. ✔
- **Rejected-promise NOT cached forever:** the `.catch()` (lines 74-78) sets `loadPromise = null` then re-throws, so a transient load failure does **not** permanently poison the feature — the next call retries. ✔ (This is the exact failure mode the task asked about; it is handled.)
- **Disposal:** the runtime loader deliberately keeps the session alive (it is a process-lifetime singleton); the downloader script calls `model.dispose()` (download-clip-models.ts:109) because it only needs the download side-effect. Correct asymmetry.
- **Concurrent `session.run()`:** the shared singleton is hit concurrently by the fire-and-forget hook, backfill (`BATCH_CONCURRENCY=2`), and the semantic route. onnxruntime's `InferenceSession.run()` is documented thread-safe (weights shared, concurrent run safe), and transformers.js allocates fresh input tensors per call (we pass our own `Tensor`), so there is no shared-mutable-input hazard. **Not a bug.**

**Side note (latent, see LR-3):** the retry-on-rejection is correct for transient faults, but if the model volume is permanently absent in `production` mode, every processed image's fire-and-forget hook re-attempts the full `from_pretrained` load and fails again — an unbounded reload storm. Dark today; flagged below.

---

## Embedding math — VERIFIED ROBUST (no NaN/Inf)

`clip-embeddings.ts`, validated by execution:

- `normalizeEmbedding` zero-vector guard (line 110 `if (norm === 0) return v`) returns the zero vector unchanged — **no divide-by-zero**. ✔
- `cosineSimilarity` denominator guard (line 33 `if (denom === 0) return 0`) returns 0 for a zero/degenerate vector — **no NaN**. A degenerate embedding scores 0 and is filtered below the 0.22 threshold. ✔
- `truncateAndNormalize` Matryoshka head (line 118) + re-normalize is correct for the 1024→512 reduction.
- `clip-inference.ts` `deterministicEmbedding`: the `(uint32 >>> 0) / 2147483648 - 1` mapping yields `[-1, 0.99999999]` (verified) — bounded, no Inf. The chunk loop runs exactly 64 iterations (512/8), `offset` 0→504, no off-by-one, `remaining` lands on 0 cleanly. ✔

---

## Route error handling — VERIFIED (no stack-trace leak)

Both routes (`semantic/route.ts`, `similar/[id]/route.ts`):

- Model-missing in `production` mode: `embedTextReal` throws → caught (semantic:242-245) → returns **503** `{error:'Server error'}` (generic, no stack trace) and rolls back the rate-limit counter. ✔
- `similar/[id]`: id parsed with `parseInt` + `Number.isFinite(id) || id <= 0` guard (line 76); missing embedding → **404**; corrupt embedding (`buf.length !== EMBEDDING_BYTES`) → **404**; empty result → `{results:[]}`. All early-return paths roll back the rate-limit (Pattern 2). ✔
- Self-exclusion in similar (`row.imageId !== id`, line 154) is correct. ✔
- The rate-limit-before-config-read ordering (semantic:207-233) prevents free config-probing; the `'unknown'`-IP shared-bucket fail-closed posture is the intended security behavior.
- Body-size / content-type / chunked-encoding gates in semantic route are thorough; `clampSemanticTopK` correctly rejects non-number `raw` (booleans/arrays) before coercion.

---

## Components — VERIFIED (stale-request & error states handled)

- `search.tsx`: `requestIdRef` monotonic-id guard re-checked after **both** awaits (the `await fetch` at 159 AND the `await resp.json()` at 175) — a slow stale response cannot clobber a fresher one. The 300 ms debounce is cleared on unmount (line 228-230). Status mapping (429→rateLimited, 503→maintenance, else→error) is complete. ✔
- `similar-photos.tsx`: `fetchedRef` guards against double-fetch on toggle; any non-200 (503/404/429) or network error sets `results='error'` and the component returns `null` (line 84) — non-production deployments show no broken UI. ✔
  - **Minor note (LR-4):** neither component aborts the in-flight `fetch` on unmount (no `AbortController`). The `requestIdRef` guard in `search.tsx` prevents stale-state commits but the request still completes in the background. `similar-photos.tsx` has no unmount guard at all — a `setResults`/`setLoading` after unmount would log a benign React warning (no crash, harmless in React 19). Low value; documented for completeness.

---

## LATENT RISKS (real, but dark-gated — not live bugs today)

### LR-1 — Loader has NO checksum verification (downloader does) · Medium confidence
**File:** `clip-model.ts:63-71` vs `download-clip-models.ts:73-130`
**Failure mode:** `download-clip-models.ts` verifies `onnx/model_quantized.onnx` + `tokenizer.json` against a SHA-256 manifest, and its idempotency path (line 73-85) correctly RE-downloads when an existing file's hash mismatches — so an *interrupted download* is caught on the next script run. **But the runtime loader `getModelBundle()` performs no checksum at all.** If a partial/truncated ONNX survives on the volume (download script never re-run after an interrupted first run, or a disk-full event truncates the file after a clean download), the loader loads whatever bytes are present. Best case: opaque ONNX parse error → caught → infinite retry → feature stays dark. Worst case: a structurally-valid-but-wrong file loads and silently produces garbage embeddings that pollute `image_embeddings` at `PRODUCTION_MODEL_VERSION`.
**Trigger:** seed the volume, `kill -9` the download mid-write, then start the app in `production` mode without re-running the verified downloader.
**Expected vs observed:** expected = loader refuses an unverified/corrupt model; observed = loader trusts on-disk bytes unconditionally.
**Fix (when CLIP goes live):** have `getModelBundle()` verify the ONNX SHA-256 against the shared `JINA_CLIP_REVISION` manifest before `from_pretrained`, or gate startup on a `download-clip-models.ts --verify-only` pass. Today the gap is inert because the feature is `disabled`.

### LR-2 — Unbounded detached embedding tasks under production batch upload · Medium confidence
**File:** `image-queue.ts:433-470`
**Failure mode:** the embedding hook is fire-and-forget and runs OUTSIDE `PQueue` concurrency control. In `production` mode each completed Sharp job spawns a detached `embedImageReal` (CPU-heavy ONNX inference, hundreds of ms). A 100-photo batch at `QUEUE_CONCURRENCY=1` processes Sharp jobs serially, but the detached embedding tasks accumulate and run concurrently with each other AND the next Sharp job. onnxruntime's session is thread-safe (verified — no corruption), so this is a **CPU-oversubscription / latency** risk, not a data-corruption one. Each hook also issues a redundant `getGalleryConfig()` DB read (line 436) per image.
**Trigger:** flip `semantic_search_mode='production'`, upload 100+ photos in one batch on a CPU-constrained host.
**Expected vs observed:** expected = embedding work bounded by a concurrency cap or threaded through the queue; observed = N detached tasks contend for libvips/CPU with live encoding.
**Fix (when live):** route embedding through a small bounded `PQueue` (concurrency 1-2), or await it inside the queue task with its own timeout, and read `semanticSearchMode` once from the already-fetched config rather than re-querying. Dark today.

### LR-3 — Model-reload storm when production volume is absent · Low confidence
**File:** `clip-model.ts:74-78` + `image-queue.ts:445-446`
**Failure mode:** the (correct) reject-and-null retry behavior means that if the model volume is permanently missing in `production` mode, every processed image's detached hook re-attempts the full `from_pretrained` load, each failing after the I/O/parse attempt. Combined with LR-2's unbounded fan-out, a batch upload becomes a repeated failed-load storm (log spam + wasted I/O). Bounded only by the number of images processed; no backoff.
**Fix (when live):** add a short negative-cache TTL (e.g. cache the rejection for 30-60 s) so repeated callers fast-fail without re-attempting the load, while still eventually retrying. Dark today.

### LR-4 — Components don't abort in-flight fetches on unmount · Low confidence
**Files:** `search.tsx:138-214`, `similar-photos.tsx:55-81`
**Failure mode:** no `AbortController`. `search.tsx` is protected against stale-state commits by `requestIdRef`, so the only cost is a wasted in-flight request after close. `similar-photos.tsx` has no unmount guard at all — a `setResults` after unmount yields a benign React dev warning (harmless under React 19, no crash). Low value.
**Fix (optional):** thread an `AbortController` and `signal` into the fetch; abort in the effect cleanup / before re-fetch.

---

## DOC-DRIFT (cosmetic — no runtime impact)

### DD-1 — Stale threshold values in route docstrings
- `semantic/route.ts:10` says "above COSINE_THRESHOLD (0.18)" and line 25 says "PRODUCTION_COSINE_THRESHOLD (0.25)".
- `similar/[id]/route.ts:18` references the 0.18-style threshold.
- **Actual constants** (clip-embeddings.ts): `COSINE_THRESHOLD = 0.18` (stub) is right, but `PRODUCTION_COSINE_THRESHOLD = 0.22` (line 103), NOT 0.25. The docstring `(0.25)` is wrong.
- Impact: none at runtime (code reads the constants); misleads a future reader. Fix: update the comment to `0.22`.

### DD-2 — Stale schema comment ("MEDIUMBLOB / 2048 bytes")
- `schema.ts:259` and `:266` describe the `embedding` column as raw "MEDIUMBLOB (2048 bytes = 512 × 4-byte little-endian float32)" and say "the lib layer wraps Buffer reads/writes."
- **Actual behavior:** the column IS `mediumblob` (migration 0012, verified), but the application stores **base64 TEXT** (`buf.toString('base64')` in image-queue.ts:453 / backfill:160) and decodes via `Buffer.from(row.embedding, 'base64')` (routes). The on-disk content is ~2732 ASCII chars, not 2048 raw bytes, and the lib does base64 ↔ Float32Array, not raw Buffer ↔ Float32Array. The comment describes a binary-blob design the code does not use.
- Impact: none at runtime (base64 fits comfortably in a 16 MB MEDIUMBLOB; round-trips correctly). Misleading for maintainers and for column sizing. Fix: correct the comment to "base64-encoded TEXT stored in a MEDIUMBLOB column."

---

## Other surfaces checked — clean
- `admin-backfill-runner.ts`: heavily hardened across prior cycles. Lock acquire/release symmetric, `finally`-based release, pool-budget concurrency clamp guards NaN (line 137), deleted-mid-reencode cleanup, fire-and-forget runner wrapped in try/finally with belt-and-braces `.catch`. No new issue. The `state.running` vs advisory-lock TOCTOU in `triggerAdminBackfill` is intentional belt-and-braces (the lock is the real serializer).
- Empty-catch sweep across `src` (excluding tests): **zero** silent `catch {}` in production code (only a comment match in image-queue.ts). Catch blocks consistently log.
- `error.tsx` (admin): correct, accessible, 44 px touch targets.

---

## Re-confirmed prior known-harmless items (NOT re-reported as new)
- `gain-map-detection.ts:87` unreachable guard — already recorded harmless dead code.
- `isLosslessWebpByChunk` ANMF branch — already recorded.

---

## Aggregator summary (severity · confidence)

- **[INFO · High]** CLIP surface: 0 confirmed bugs. Queue race-protection invariants intact; lazy-singleton de-dups concurrent loads and does NOT cache rejection forever; concurrent ONNX `session.run()` is thread-safe; zero-vector cosine returns 0 (no NaN); routes leak no stack traces; components guard stale responses.
- **[LOW (latent) · Medium]** LR-1: runtime loader `clip-model.ts:63` performs NO model checksum (downloader does) — a corrupt/partial on-disk ONNX would load unverified → opaque error or silent garbage embeddings. Dark-gated.
- **[LOW (latent) · Medium]** LR-2: production embedding hook (`image-queue.ts:433`) is unbounded fire-and-forget — CPU oversubscription on large batch uploads + redundant per-image config DB read. Dark-gated.
- **[LOW (latent) · Low]** LR-3: model-reload storm (`clip-model.ts:74`) when production volume is permanently absent — no negative-cache backoff. Dark-gated.
- **[LOW (latent) · Low]** LR-4: `search.tsx` / `similar-photos.tsx` don't `AbortController`-cancel in-flight fetches on unmount — benign (stale-commit already guarded in search.tsx; React-19-harmless warning in similar-photos.tsx).
- **[TRIVIAL · High]** DD-1: route docstrings state `PRODUCTION_COSINE_THRESHOLD (0.25)`; actual is `0.22`. Comment-only.
- **[TRIVIAL · High]** DD-2: `schema.ts:259/266` comment claims raw binary "2048 bytes" storage; code stores base64 TEXT in the mediumblob. Comment-only.

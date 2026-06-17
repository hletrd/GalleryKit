# Debugger Review — CLIP Semantic Search Activation (Run 6 / Cycle 8)

**HEAD:** 1a325fa6  
**Scope:** New code since last converged review: e0da12ee, b1d6331c, 1a325fa6 (CLIP activation).  
**Agent:** debugger  
**Date:** 2026-06-17

---

## Summary

**Total findings: 2 (1 HIGH, 1 LOW)**  
No process-crash or hang conditions found. No unhandled rejections. The HIGH finding is a silent wrong-result / persistent-503 condition reachable from a partially-completed prior download.

---

## Finding 1 — HIGH: Download idempotency fast-path passes on a partial seed missing `tokenizer.json` (and config files)

**File:** `apps/web/scripts/download-clip-models.ts:63-76`  
**Related:** `apps/web/scripts/clip-model-manifest.ts:25-30`

### Root Cause

The idempotency fast-path checks only the ONNX binary:

```ts
// download-clip-models.ts:63-70
const onnxPath = join(modelCacheDir, 'onnx', 'model_quantized.onnx');
if (existsSync(onnxPath)) {
    const actual = await sha256File(onnxPath);
    const expected = MANIFEST['onnx/model_quantized.onnx'];
    if (actual === expected) {
        console.log('[download-clip-models] Checksum OK — already up to date. Nothing to do.');
        return;   // returns here WITHOUT checking tokenizer.json
    }
```

`CLIP_MODEL_MANIFEST` covers two keys: `'onnx/model_quantized.onnx'` AND `'tokenizer.json'`. The full `verifyAndCleanArtifacts()` path (lines 106-116) checks both. But the early-return at lines 63-76 skips `tokenizer.json` entirely. In addition, `config.json` and `tokenizer_config.json` are not in the manifest at all — by design, as "small, self-describing" files — but `AutoTokenizer.from_pretrained` (clip-model.ts:96) requires `tokenizer_config.json` at runtime for offline load.

### Trigger Condition

A partially-completed prior download where:
- `onnx/model_quantized.onnx` is present and SHA-256 matches, AND
- `tokenizer.json` is absent or corrupt (interrupted download, partial volume mount, manual partial seed), OR
- `tokenizer_config.json` / `config.json` are absent (never covered by the manifest)

### Resulting Failure

The script exits 0: "already up to date". Next app start, or the first real semantic query triggering the lazy loader, calls `AutoTokenizer.from_pretrained(JINA_CLIP_MODEL_ID, { revision: JINA_CLIP_REVISION })` with `allowRemoteModels=false` (clip-model.ts:96). If `tokenizer_config.json` is missing, this throws. The `.catch()` at clip-model.ts:101-105 nulls `loadPromise` for retry — but every retry hits the same missing file and fails again. The semantic route catches the throw at semantic/route.ts:239-244, rolls back the rate limit, and returns 503. Every production semantic search request returns 503 indefinitely until the operator notices and re-runs the download script.

### Reproduction

1. Seed only the ONNX file into `<modelCacheDir>/onnx/model_quantized.onnx` (omit tokenizer files).
2. `npx tsx scripts/download-clip-models.ts` → prints "already up to date", exits 0.
3. Set `semantic_search_mode=production` and POST to `/api/search/semantic`.
4. Every request returns 503; `from_pretrained` error in process log.

### Fix (minimal)

Replace the bespoke ONNX-only fast-path (lines 63-76) with a call to the already-existing `verifyAndCleanArtifacts` helper using `deleteOnMismatch=false` (inspect only, no mutation on the fast-path):

```ts
// Replace lines 63-76 in download-clip-models.ts with:
const quickCheck = await verifyAndCleanArtifacts(modelCacheDir, MANIFEST, false);
if (quickCheck.ok) {
    console.log('[download-clip-models] All artifacts verified — already up to date. Nothing to do.');
    return;
}
console.log('[download-clip-models] Some artifacts missing or mismatched — (re-)downloading...');
for (const line of quickCheck.log) console.log(`[download-clip-models] ${line}`);
```

This reuses the existing helper, eliminates the parallel logic, and gates the fast-return on ALL manifest keys passing. Lines changed: ~14 → ~7. Note: `config.json` / `tokenizer_config.json` are still not in the manifest; a separate decision is needed to add them if their absence at runtime has been observed to cause failures.

**Confidence: HIGH** — code path is directly readable; the missing-tokenizer failure is confirmed by `allowRemoteModels=false` + `from_pretrained` requiring `tokenizer_config.json` for offline load per HuggingFace Transformers.js semantics.

---

## Finding 2 — LOW: `clipModelArtifactDir` silently produces wrong path if `JINA_CLIP_MODEL_ID` ever has fewer or more than 2 slash segments

**File:** `apps/web/src/lib/clip-paths.ts:79`

### Root Cause

```ts
export function clipModelArtifactDir(resolvedRoot: string): string {
    return join(resolvedRoot, ...JINA_CLIP_MODEL_ID.split('/'), JINA_CLIP_REVISION);
}
```

`JINA_CLIP_MODEL_ID.split('/')` spreads variably into `join()`. For the current `'jinaai/jina-clip-v2'` this is two segments — correct. A bare name (`'jina-clip-v2'`) or a three-segment path would silently produce a different cache directory. The downloader would write to a different path than the loader reads, breaking the seed→offline-load contract with no error at script time (the downloader would complete "successfully", the loader would fail to find the artifacts).

### Severity

LOW — the current `JINA_CLIP_MODEL_ID` is a hardcoded constant (`'jinaai/jina-clip-v2'`, clip-model-id.ts:13). The `'main'` revision concern is moot: `JINA_CLIP_REVISION` is a pinned 40-hex SHA (`e10d47f5...`). This is a latent guard-rail gap that only matters on a future model upgrade.

### Fix (optional, low-urgency)

Add a segment-count assertion in `clipModelArtifactDir`:

```ts
const segments = JINA_CLIP_MODEL_ID.split('/');
if (segments.length !== 2 || segments.some(s => s.length === 0)) {
    throw new Error(`clip-paths: JINA_CLIP_MODEL_ID must be "org/name", got: ${JINA_CLIP_MODEL_ID}`);
}
return join(resolvedRoot, ...segments, JINA_CLIP_REVISION);
```

Lines changed: 3 added. Fires at startup/download time rather than silently producing a wrong path.

**Confidence: LOW (latent only)** — current constant is correct; guard prevents silent wrong-path on future model upgrades.

---

## Non-Findings (investigated and closed)

- **`resolveClipModelsRoot` empty-string env**: `envValue && envValue.length > 0` correctly falls through to `DEFAULT_CLIP_MODELS_ROOT` for empty string. No bug. (clip-paths.ts:64)
- **`loadPromise` cached-as-rejected forever**: Confirmed nulled at clip-model.ts:101-105 inside `.catch()`. Clean retry on next call.
- **Concurrent first-request race on `getModelBundle`**: `loadPromise` is assigned before the async body runs (line 81). All concurrent callers before first resolution receive the same Promise. Correct singleton — one load, no double-init.
- **`embedTextReal` unhandled rejection in semantic route**: Wrapped at semantic/route.ts:239-244; rolls back rate limit and returns 503. Clean.
- **NaN/negative/non-integer topK**: `clampSemanticTopK` at semantic/route.ts:87-91 guards NaN, non-finite, non-number, and negative. Floor applied before clamp. Safe.
- **Empty embeddings table**: `rows` query returns `[]`; `scored` is `[]`; `results` is `[]`; returns `{ results: [] }` with 200. Correct.
- **Model-missing → process crash**: `allowRemoteModels=false` + missing weights → throw → `loadPromise` nulled → 503 from catch block in the route. Does not crash the process.
- **Upload embed failure isolation**: `void (async () => { ... })()` at image-queue.ts:434 is fire-and-forget; catch at line 475 logs a warn and does not rethrow. Upload path fully isolated.
- **Backfill embed failure isolation**: Per-image catch at backfill-clip-embeddings.ts:181-184; increments `failed` counter; does not abort the loop.
- **`JINA_CLIP_REVISION = 'main'` flat-path concern**: Actual value is a pinned 40-hex SHA. Moot for current deployment.
- **`JINA_CLIP_MODEL_ID` ≠ 2 segments today**: Current constant is `'jinaai/jina-clip-v2'` — exactly 2 segments. No live issue.

---

## References

- `apps/web/scripts/download-clip-models.ts:63-76` — ONNX-only idempotency fast-path; root cause of Finding 1.
- `apps/web/scripts/clip-model-manifest.ts:25-30` — manifest covers only 2 keys; `verifyAndCleanArtifacts` would cover both; fast-path bypasses it.
- `apps/web/src/lib/clip-model.ts:79-108` — lazy singleton; `loadPromise` nulled on failure (line 103); no permanent rejection cache.
- `apps/web/src/lib/clip-model.ts:90-98` — `AutoModel.from_pretrained` + `AutoTokenizer.from_pretrained`, both with `allowRemoteModels=false`; `tokenizer_config.json` required for tokenizer offline load.
- `apps/web/src/lib/clip-paths.ts:77-80` — `clipModelArtifactDir` spreads split without length guard; root cause of Finding 2.
- `apps/web/src/app/api/search/semantic/route.ts:239-244` — `embedTextReal` throw caught, rate limit rolled back, 503 returned; no unhandled rejection.
- `apps/web/src/lib/image-queue.ts:434-478` — fire-and-forget embed hook; fully isolated from upload success path.

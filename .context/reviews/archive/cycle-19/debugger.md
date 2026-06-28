# Debugger Review — Cycle 19

**Date:** 2026-06-27
**Scope:** Latent bugs, failure modes, and regressions across six high-risk areas.
**Method:** Static analysis — full source read of hot paths plus targeted grep across the codebase.

---

## Findings

### F1 — `parseInt` silently truncates scientific-notation env var (VIEW_RETENTION_DAYS)

**Severity:** LOW
**Confidence:** MEDIUM
**File:line:** `apps/web/src/lib/view-retention.ts:43`

**Root cause:**
```typescript
const retentionDays = Number.parseInt(process.env.VIEW_RETENTION_DAYS ?? '', 10);
```
`Number.parseInt` with radix 10 stops at the first non-decimal character, so `parseInt('1e3', 10)` returns `1` (not 1000). An operator setting `VIEW_RETENTION_DAYS=1e3` or `VIEW_RETENTION_DAYS=1e6` to express 1000 or 1000000 days gets 1-day retention instead.

**Observed failure:** Analytics view events are purged after 1 day instead of the intended 1000 days. The `> 0` guard passes (1 > 0 is true), so no fallback to the 395-day default is triggered. All three view tables (`image_views`, `topic_views`, `shared_group_views`) are swept to near-empty on the next hourly GC.

**Trigger input:** `VIEW_RETENTION_DAYS=1e3` in `.env.local`.

**Similar pattern:** `apps/web/src/lib/process-image.ts:45` uses the same `Number.parseInt(..., 10)` for `SHARP_CONCURRENCY`. There the effect is conservative (1 thread instead of 1000 — just slow), but the pattern is inconsistent with the rest of the codebase which uses `Number(raw)` + `Number.isFinite()` for numeric env var coercion.

**Fix:**
```typescript
// view-retention.ts:43
const retentionDays = Number(process.env.VIEW_RETENTION_DAYS ?? '');
return Number.isFinite(retentionDays) && retentionDays > 0
    ? retentionDays * 24 * 60 * 60 * 1000
    : DEFAULT_VIEW_RETENTION_MS;
```
`Number('1e3')` returns 1000. This matches the pattern used in `gallery-config-shared.ts` (`Number.isFinite(n)`) and the rest of the config parsing layer. Same fix applies to `SHARP_CONCURRENCY` at `process-image.ts:45` (low urgency since under-counting threads is safe).

**Verification:** Add a test: mock `VIEW_RETENTION_DAYS=1e3`, assert `resolveRetentionMs()` returns `1000 * 24 * 60 * 60 * 1000`, not `86400000` (1 day).

---

### F2 — ISOBMFF walker stops silently on 64-bit extended-size box, leaving GPS intact

**Severity:** LOW
**Confidence:** LOW
**File:line:** `apps/web/src/lib/gps-exif-strip.ts` — `walkChildren` generator (line ~395)

**Root cause:** The bounded `walkChildren` generator checks for oversized 64-bit box sizes:
```typescript
if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    return; // generator stops
}
```
When a crafted or malformed HEIF/AVIF box declares a 64-bit extended size above `Number.MAX_SAFE_INTEGER` (~9 PB), the generator exits. The outer `stripGpsFromIsobmffBuffer` receives no GPS-bearing boxes and returns `{ stripped: false }`.

**Observed failure:** `strip_gps_on_upload` is a no-op for this file. GPS coordinates remain in the stored original. The function does NOT return `null` (which would trigger the fallback re-encode path in `process-image.ts`'s `stripGpsFromOriginal`); it returns `{ stripped: false }` — so the caller sees a successful non-strip and the original is preserved as-is with GPS data intact.

**Trigger input:** A HEIF or AVIF file where a container box in the path to the GPS-bearing `iinf`/`iloc` box has `largesize > 2^53`. This is unlikely in genuine camera output but trivially constructable.

**Note:** This is a safe failure mode — no crash, no data corruption — but it is a silent privacy-affecting bypass of the GPS strip feature for specifically crafted files.

**Fix:** After the `walkChildren` generator exits without stripping and GPS was not found, treat the oversized-box case as a fallback trigger (return `null` rather than `{ stripped: false }`) so `stripGpsFromOriginal` falls back to the metadata-free re-encode path. Alternatively, add a log warning at the oversized-box early-return so operators can detect the bypass.

---

### F3 — AVIF 10-bit fallback uses mutated `base` instance after `toFile()` failure

**Severity:** LOW
**Confidence:** LOW
**File:line:** `apps/web/src/lib/process-image.ts:1215`

**Root cause:**
```typescript
// First attempt (mutates base in-place — Sharp returns `this` from each method):
await base.toColorspace(avifIcc).withIccProfile(avifIcc).avif({...bitdepth:10}).toFile(outputPath);
// Fallback after throw:
await base.clone().toColorspace(avifIcc).withIccProfile(avifIcc).avif({...bitdepth:8}).toFile(outputPath);
```

`base` is a Sharp pipeline builder. Sharp methods return `this`, so the chain mutates `base` in-place: by the time the first `toFile()` throws, `base` already has `toColorspace`, `withIccProfile`, and `avif({bitdepth:10})` appended. The fallback calls `base.clone()` on this already-consumed instance, then appends the same operations AGAIN. The `bitdepth:8` override in the retry works because Sharp merges AVIF options on each `.avif()` call, with later values winning — this is explicitly acknowledged in the R4C8 COR-R4C8-06 comment.

**Observed failure:** No known bug today. The correctness depends on Sharp's internal option-merge semantics remaining stable across versions. If a Sharp update changed `.avif()` from merge-on-call to set-on-call, or changed how `toColorspace`/`withIccProfile` behaves when called twice on a clone, the fallback would produce wrong output (possibly double colorspace conversion or incorrect bitdepth).

**Trigger input:** A Sharp build where the 10-bit AVIF probe passes but specific image content causes per-image encode failure, triggering the fallback branch.

**Fix (minimal):** Capture a factory function for the base operations so both attempts use a fresh instance:
```typescript
const mkBase = () => needsRgb16
    ? sharp(processingInputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
        .pipelineColorspace('rgb16').resize({ width: resizeWidth })
    : sharp(processingInputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
        .resize({ width: resizeWidth });

await mkBase().toColorspace(avifIcc).withIccProfile(avifIcc).avif({...bitdepth:10}).toFile(outputPath);
// fallback:
await mkBase().toColorspace(avifIcc).withIccProfile(avifIcc).avif({...bitdepth:8}).toFile(outputPath);
```
This makes both attempts independent of Sharp's mutation semantics.

---

## Areas Verified Clean

The following areas were fully analyzed with no bugs found.

### Numeric / env-var parsing

- `gallery-config-shared.ts` — all numeric settings use `Number.isFinite()` guards; `normalizeConfiguredImageSizes` returns null on invalid input; `VALIDATORS` enforces ranges at write time.
- `gallery-config.ts` — `validatedNumber()` falls back to defaults on invalid DB values; full catch block returns all defaults on DB error.
- `admin-backfill-runner.ts` — `resolveBackfillConcurrency(requested, poolLimit)` correctly handles NaN/0/negative; `Number(process.env.ADMIN_BACKFILL_CONCURRENCY) || 1` at line 665 is safe (0-concurrency PQueue would hang; documented as intentional).
- `rate-limit.ts` — `getTrustedProxyHopCount` uses `parseInt` with fallback on `< 1` or non-integer; `purgeOldBuckets` cutoff arithmetic is correct.
- `image-queue.ts:212` — `Number(process.env.QUEUE_CONCURRENCY) || 1` correctly handles NaN/0/unset; `|| 1` fallback documented as intentional (0-concurrency PQueue would hang all uploads).

### Image pipeline

- `process-image.ts` — 10-bit AVIF probe is a Promise-singleton (`_highBitdepthAvifProbePromise`); race-free across concurrent AVIF encodes. WI-15 downscale intermediate is always cleaned up in the `finally` block at line 1358 (`if (processingInputPath !== inputPath) await safeUnlink(processingInputPath)`). The `writtenSizedPaths` cleanup on `catch` correctly removes partial files across all three formats. `avif10bit` shared closure variable is written only by the AVIF format path; no cross-format race.
- `gps-exif-strip.ts` — JPEG/TIFF/WebP paths all have robust bounds checking: TIFF IFD walker limited by `MAX_IFD_CHAIN=8`, `MAX_IFD_ENTRIES=1024`, cycle detection via visited Set; JPEG post-EOI trailer check returns null on non-trivial trailers; WebP RIFF chunk walk retags XMP to JUNK. The ISOBMFF path has the silent-stop finding (F2) but is otherwise bounded correctly.
- `color-detection.ts` — ISOBMFF `colr` box scanner depth-limited at `MAX_DEPTH=5`, scan-limited at 1 MB; bounded safe-integer check for 64-bit sizes present.

### Concurrency

- `image-queue.ts` — claim/mark logic correct; connection released in catch before rethrowing; `MAX_PERMANENTLY_FAILED_IDS=1000` with FIFO eviction via `Set.prototype.values().next().value` correct. Delete-during-processing race handled by `affectedRows === 0` → `deleteImageVariants(dir, fn, [])`. Bootstrap continuation logic correctly handles all four states (empty/continuation/partial/full). `quiesceImageProcessingQueueForRestore` correctly does `pause(); clear(); await onIdle()` to avoid deadlock.
- `admin-backfill-runner.ts` — `resolveBackfillConcurrency` math verified at pool=10: `RESERVED = max(3, ceil(10/2)) = 5`, `cap = max(1, floor((10-5-1)/2)) = 2`. Detection failure path does NOT bump `pipeline_version`. Delete-mid-reencode `affectedRows=0` path cleans orphan files via full directory scan.
- `bounded-map.ts` — FIFO eviction via insertion-order iteration is correct. `enforceHardCap()` called on every `set()` so growth is bounded even without `prune()`. `get()` returns shallow copies; `entries()` yields live references (documented at lines 116-125 with a WARNING comment). No production callers use `entries()` on a BoundedMap (confirmed by grep across all of `apps/web/src/` — zero hits). The asymmetry is a maintenance hazard, not an active bug.
- `auth-rate-limit.ts` — account-scoped rate limit mirrors IP-scoped correctly; rollback functions use spread pattern; `prune*` delegates to `BoundedMap.prune()`.

### Client

- `use-display-capability.ts` — `_cachedSnapshot` module-level memoization is correct; `detect()` value-compares before creating a new object to prevent `useSyncExternalStore` infinite loop (React #185). SSR default `{ colorGamut: 'p3', isHdr: false }` correctly suppresses `WideGamutHint` on first paint.
- `photo-viewer.tsx` — `blur_data_url` guarded by `isSafeBlurDataUrl()` before use as CSS `background-image`; validated at line 157.
- `histogram.tsx` — Worker lifecycle correct: created in one `useEffect([])` with `terminate()` + null cleanup at unmount; image loading in a separate `useEffect([effectiveUrl, ...])` with `aborted` flag, `AbortController`, and `img.src = ''` cleanup. No worker leak on unmount.

### JSON / date / locale parsing

- `smart-collections.ts` — `parseSmartCollectionQuery` wraps `JSON.parse` in try/catch; `isScalarValue` rejects NaN; depth checked at `> MAX_DEPTH (4)`; `compileTagPredicate` uses parameterized binding (no string interpolation of untrusted values).
- `clip-embeddings.ts` — `decodeEmbeddingColumn` handles raw 2048-byte Buffer, legacy base64 Buffer, and defensive string case; returns null for anything not yielding exactly `EMBEDDING_BYTES` bytes. `cosineSimilarity` has `EPSILON=1e-15` guard against NaN on zero vectors. `normalizeEmbedding` handles zero vector (norm=0 → returns unchanged, avoids NaN). `dotProduct` has no runtime unit-length assertion (documented as usage contract; not exploitable in current callers).
- `view-retention.ts` — `resolveRetentionMs` correctly rejects `maxAgeMs <= 0` and non-finite values when called programmatically. The only issue is the `parseInt` env-var path (F1 above).

---

## References

- `apps/web/src/lib/view-retention.ts:43` — `Number.parseInt` truncates scientific-notation input (F1)
- `apps/web/src/lib/view-retention.ts:44-46` — return path multiplies integer-truncated value (F1)
- `apps/web/src/lib/process-image.ts:45` — same `Number.parseInt(..., 10)` pattern for `SHARP_CONCURRENCY` (companion to F1; low-impact)
- `apps/web/src/lib/gps-exif-strip.ts:~395` — `if (big > BigInt(Number.MAX_SAFE_INTEGER)) return;` in `walkChildren` generator (F2)
- `apps/web/src/lib/process-image.ts:1204-1226` — AVIF 10-bit fallback using `base.clone()` after mutated-`base.toFile()` failure (F3)
- `apps/web/src/lib/bounded-map.ts:123` — `entries()` yields live internal references (documented asymmetry vs `get()` shallow copies; no active callers)

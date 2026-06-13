# Debugger Review — GalleryKit (run-8 cycle-2)

**Date:** 2026-06-13
**Scope:** Latent bug surface — async lifecycle (setState-after-unmount, stale closures, effect cleanup), error handling (unhandled rejections, swallowed errors, wrong status), numeric edge cases (÷0, NaN, Infinity, overflow), null/undefined deref, queue/backfill/restore races, parser boundary conditions (ISOBMFF walker, ICC extractor, chromaticity, gain-map, EXIF).
**Method:** Empirical — every finding traced to an exact code path; arithmetic / bounds reasoned by hand. Working tree CLEAN (only `.context/reviews/*` + new plan files dirty; no source changes vs HEAD), HEAD = `77867144`.

**Gate baseline AT HEAD (per run-7 aggregate, not re-run this pass — working tree is byte-identical to the reviewed HEAD):** lint exit 0, typecheck exit 0, full vitest green. No source diffs to invalidate that baseline.

---

## Prior debugger findings — verification at HEAD

| Prior ID | Finding | Fix commit | Status at HEAD |
|---|---|---|---|
| **BUG-1 / AGG-R7-02** | settings-client backfill poll `setTimeout`s leak past unmount (no clearTimeout, no mounted guard) | `f11746cd` | **CLOSED — verified.** `backfillMountedRef` (settings-client.tsx:87) gates the setState in `refreshBackfillStatus` (line 96); `backfillPollTimers` ref (line 83) collects both timer ids (lines 169-172) and the dedicated unmount effect (lines 122-131) flips `mounted.current=false` AND `clearTimeout`s every pending timer. Both halves of the AGG-15 prescription now landed. |
| **BUG-2 / AGG-R7-10** | load-more.tsx in-flight `loadMoreImages()` resolving post-unmount runs the setState block | (none) | **STILL OPEN** — re-reported below as BUG-1 (LOW). |
| **AGG-R7-12** | home-client.tsx containIntrinsicSize divides by `image.width` → Infinitypx for 0-width row | (none) | **STILL OPEN** — re-reported below as BUG-2 (LOW). |

---

## Findings this cycle

| ID | Severity | File:line | Symptom | Confidence |
|---|---|---|---|---|
| BUG-1 | **LOW** | `components/load-more.tsx:36-88` | In-flight `loadMoreImages()` resolving after the component unmounts still runs the `setHasMore`/`setOffset`/`setCursor`/`setLoading`/`onLoadMore` block — `queryVersionRef` guards a query-KEY change mid-flight, and the observer disconnect (line 124) stops only NEW intersections; neither catches a single request already awaiting at unmount. | High |
| BUG-2 | **LOW** | `components/home-client.tsx:278,280` | `aspectRatio: "${image.width} / ${image.height}"` and `containIntrinsicSize: "auto ${Math.round(estimatedCardWidth * image.height / image.width)}px"` produce `"0 / 0"` / `"auto Infinitypx"` (invalid CSS, silently dropped) when `image.width === 0`. `estimatedCardWidth` is now floored `>0`, so the numerator is safe; the bare `/ image.width` denominator is not. | High (theoretical) |
| BUG-3 | **LOW** | `lib/admin-backfill-runner.ts:441-456` (`reprocessOne`) | The backfill passes `row.width` straight from the DB into `processImageFormats` with NO `> 0` re-validation. The UPLOAD path validates `width>0` before encoding (`process-image.ts:825-830`), but the backfill does not. A legacy/corrupt row with `width = 0` makes `processingBaseWidth = 0` → `resizeWidth = 0` → Sharp `.resize({width:0})` throws → counted as `encode-failed` (no version bump). Non-fatal, no crash, but the row silently never backfills and reads as a normal encode failure. | Medium (latent — `width` is NOT NULL with Sharp-derived values) |

No HIGH or MEDIUM latent bugs found this cycle.

---

## BUG-1 (LOW · High) — load-more setState after unmount on the single in-flight fetch

**File:** `apps/web/src/components/load-more.tsx:36-88`

`loadMore()` awaits `loadMoreImages(...)` / `loadMoreSmartCollectionImages(...)` (lines 43-45), then on resolve runs `setHasMore` (48/67), `onLoadMore` (50), `setOffset` (52), `setCursor` (55), `setStatusMessage`, and in `finally` `setLoading`/`loadingRef` (83-86). Three guards exist but none covers unmount of an in-flight request:

- `queryVersionRef` (lines 41/46/83) bumps on `queryKey`/initial-prop change and short-circuits a STALE-query resolve — but on unmount the version is unchanged, so the guard passes.
- `loadingRef` only prevents a second concurrent `loadMore`.
- The unmount effect (line 124) `disconnect()`s the observer, stopping NEW intersection-triggered loads — it does nothing for a request already awaiting.

**Trigger:** sentinel scrolls into view → `loadMore()` fires → server action in flight → user navigates away (route change, topic switch that unmounts the list) before it resolves. The resolve path then calls setState on a dead fiber + invokes the parent-owned `onLoadMore` (parent is also unmounting).

**Symptom:** React state-update-on-unmounted dev warning + one wasted render targeting a dead fiber. Benign leak, not corruption — which is why it is LOW and was never the regression.

**Fix (minimal, symmetric with the settings-client BUG-1 fix):** add `const mountedRef = useRef(true); useEffect(() => () => { mountedRef.current = false; }, []);` and gate every post-await setState (`if (mountedRef.current) …`), or wrap the whole resolve block. Long-standing pattern, NOT introduced by any recent change.

---

## BUG-2 (LOW · High-theoretical) — containIntrinsicSize / aspectRatio divide-by-zero on 0-width row

**File:** `apps/web/src/components/home-client.tsx:277-281`

```ts
style={{
    aspectRatio: `${image.width} / ${image.height}`,          // "0 / 0" if width=0
    containIntrinsicSize: `auto ${Math.round(estimatedCardWidth * image.height / image.width)}px`, // "auto Infinitypx"
}}
```

`estimatedCardWidth` was hardened (line 201 returns `w > 0 ? w : 300`), closing the numerator, but `/ image.width` still divides by the raw column. `image.width === 0` → `Infinity` → `Math.round(Infinity)` → `Infinity` → `"auto Infinitypx"`, an invalid CSS value the browser silently discards (the layout simply loses its size hint; no crash). `aspectRatio: "0 / 0"` is likewise invalid-and-ignored.

**Trigger:** any gallery row whose `images.width` column is 0. Near-impossible in practice — Sharp metadata width is validated `>0` at upload (`process-image.ts:825-830`) and the column is NOT NULL — so this is latent/theoretical, pre-existing, unchanged since the AGG-R7-12 report.

**Fix:** `const w = image.width > 0 ? image.width : 1;` (or guard the whole style object), then divide by `w`. One line.

---

## BUG-3 (LOW · Medium) — backfill encodes with unvalidated DB width

**File:** `apps/web/src/lib/admin-backfill-runner.ts:402-462` (`reprocessOne` → `processImageFormats` call at 441-456)

The candidate row carries `width: number` straight from the `images.width` column (`CandidateRow`, line 77; SELECT at line 382). It is forwarded as `baseWidth` to `processImageFormats` with no `> 0` guard. Inside the encoder, `processingBaseWidth = baseWidth` (process-image.ts:976) and the size loop computes `resizeWidth = processingBaseWidth < size ? processingBaseWidth : size` (line 1054). For `width = 0`: `resizeWidth = 0`, and `sharp(...).resize({ width: 0 })` throws (`Expected positive integer for width`). That throw is caught by the `encode-failed` branch (line 459-462) → `encodeFailures++`, no `pipeline_version` bump → the row stays a candidate and re-fails every run.

Contrast: the upload path rejects `width <= 0` up front (process-image.ts:825-830 deletes the original and throws), so fresh uploads can never have `width = 0`. Only the backfill, which trusts the stored column, is exposed.

**Severity rationale:** no crash (caught), no corruption, no leak. The failure mode is a silently un-progressing row that surfaces as a generic encode failure rather than a clear "bad metadata" signal — an observability edge under a near-impossible precondition (the column is NOT NULL and only ever written from validated Sharp metadata). Medium confidence because I cannot prove zero legacy rows exist with width 0; LOW severity because the blast radius is one un-backfilled row.

**Fix (optional, defensive):** in `reprocessOne`, before the claim, `if (!Number.isFinite(row.width) || row.width <= 0) return { ok: false, reason: 'encode-failed' };` — or better, surface a distinct `bad-metadata` skip reason so the admin status can tell a genuine codec failure from a width-0 row. Not required this cycle.

---

## Verified-CLEAN (specifically stress-tested this pass)

### `lib/color-detection.ts` — `parseCicpFromHeif` ISOBMFF walker — CLEAN
Bounded correctly. `while (pos + 8 <= limit)` with `limit = min(end, offset+1MB, buffer.length)`. 64-bit size (`size===1`) guards `pos+16 > buffer.length` before `readBigUInt64BE`; a malicious >2^53 size loses `Number()` precision but is rejected by `size < headerSize || pos+size > buffer.length` (line 243) since the buffer is ≤1 MB. `size===0` → `size = buffer.length - pos` (positive) → `pos = boxEnd` strictly advances ≥8 bytes/iteration → no infinite loop. `colr`/`nclx` reads (`dataStart+4..+10`) gated behind `dataSize >= 11`. Recursion depth-capped at 5. `meta` FullBox version+flags skip gated on `dataSize >= 4`. NCLX_TRANSFER_MAP / PRIMARIES / MATRIX all `?? 'unknown'` on miss. **No OOB, no loop, no crash.**

### `lib/icc-extractor.ts` — `extractIccProfileName` desc + mluc — CLEAN
`tagCount = min(readUInt32BE(128), 100)`. Per-tag `tagOffset+12 > iccLen` break. `desc` v2: `strEnd = strStart + max(0, strLen-1)`, guarded `strEnd > iccLen || strStart >= strEnd` → break (a `declaredLength===1` null-only string is caught). `mluc`: `numRecords` capped at 100, `recordSize < 12` break, per-record `recOffset+12` AND `dataOffset+dataSize` double-bound, text slice double-bound (`strEnd > iccLen || strEnd > dataOffset+dataSize || strStart >= strEnd`). UTF-16BE decode is `TextDecoder` (cannot OOB). `clampUtf8Bytes` iterates by code point, never splits a multi-byte char. Whole body in try/catch. **No OOB, no crash.**

### `lib/icc-chromaticity.ts` — `detectGamutFromIccChromaticity` — CLEAN
`tagCount` finite+positive guard, capped at 100; `tagTableEnd = min(132+tagCount*12, 132+4KB, icc.length)`. Tag loop `i+12 <= tagTableEnd ≤ icc.length` so `readUInt32BE(i+4/+8)` in-bounds. `offset+size > icc.length || size > 4KB` → skip (unsigned 32-bit sums stay safe JS integers, no overflow). `readS15Fixed16` guards `offset+4 > buf.length` → NaN; `readXyzTag`/`readChadMatrix` reject on any non-finite component. `xyzToXy` returns null on |sum|<1e-9 (÷0 guard). `invert3x3` returns null on |det|<1e-12 (singular-matrix guard). Missing-required-tag → null. **No ÷0, no OOB, no NaN leak.**

### `lib/gain-map-detection.ts` — `hasGainMap` infe/iinf/iref walker — CLEAN
`readBoxHeader` returns null on `pos+8 > length`, on `size===1 && pos+16 > length`, and on `size < headerSize || pos+size > length`; `size===0 → length-pos`. Non-null size always ≥ headerSize (≥8) so `pos = boxEnd` strictly advances. `parseIinf`/`parseIref` cap iterations at 1024 AND `entryCount`/refCount. `parseInfe` bounds every field read against `dataEnd`; only v2/v3 parsed, else null. `readNullTerminatedAscii` clamps to `min(end, length)`. Recursion depth-capped 5, scan-capped 1 MB. Whole `walk` in try/catch returning `false`. **No infinite loop, no OOB, never throws to caller.**

### `lib/process-image.ts` dimension math + verifiers — CLEAN
- WI-15 downscale (lines 990-1011): triggers only when `basePixels > WIDE_GAMUT_MAX_SOURCE_PIXELS` (>0), so `Math.sqrt(positive/positive)` finite, `targetWidth = max(1, round(...))` floors ≥1. `baseHeight` floored to 0 only on the guard, and the multiply path is only reached when the source is wide-gamut + over cap, which requires valid metadata.
- `decimalToRational` (1336-1343): `1/val` only reached with `val > 0` (both call sites 1317/1324 pre-guard `Number.isFinite && val > 0`) → no ÷0.
- `verifyAvifNclxInBuffer` / `verifyWebpIccInBuffer`: audit-only (log warnings, never throw/block). Loop bounds: AVIF `i < length-12` with `<16` early-return; WebP `nextOffset <= offset || nextOffset > length` break prevents loop stall on a malformed chunk. Even a wrong result is non-fatal.
- EXIF `convertDMSToDD` (1366-1378): `!dms || dms.length < 3` early-return; per-component range checks; final `|dd| > maxDegrees` clamp. `cleanNumber`/`normalizeExposureTime` reject non-finite. **No crash on malformed EXIF.**

### `lib/admin-backfill-runner.ts` counter logic across ALL branches — CLEAN
`processed++` ONLY on `result.ok` (line 625). Every `ok:false` reason maps 1:1 to its own counter (missing-original / locked / encode-failed / detection-failed, lines 627-645). Fatal per-row throw → `errors++` (648) AND populates `state.lastError` (657). `hadFailures = encodeFailures>0 || detectionFailures>0 || errors>0` (702) covers all non-clean exits; `skippedLocked`/`skippedMissingOriginal` correctly do NOT count as failures (documented "retry next run"). Detection-failed-encode-succeeded branch (530-536) persists `was_downscaled`/`avif_10bit` but NOT `pipeline_version` — correct resume contract (row re-picked next run). At concurrency>1 the `processed++`/`errors++` JS increments are atomic under Node's single thread (no `await` between read-modify-write; each worker's `reprocessOne` fully resolves before the increment). `resolveBackfillConcurrency` arithmetic NaN/0/negative/Infinity-safe (re-confirmed against the run-6/run-7 machine-verified table; `Number.isFinite` fallback to 10, `Math.max(1, …)` floors). **No miscount, no NaN-freeze.**

### `lib/image-queue.ts` claim/retry lifecycle — CLEAN
`acquireImageProcessingClaim` releases the conn on a non-`acquired===1` path and on throw. The task `finally` (lines 526-538) ALWAYS calls `releaseImageProcessingClaim` (which catches its own errors) and gates `enqueued`/`retryCounts`/`lastErrors`/`claimRetryCounts` cleanup on the `retried`/`claimRetryScheduled` flags so a deliberate re-enqueue/claim-retry doesn't have its tracking deleted out from under it. Bounded `MAX_RETRIES=3` + `MAX_CLAIM_RETRIES=10` + escalating backoff with `retryTimer.unref()`, `permanentlyFailedIds` FIFO-capped with associated-map cleanup on eviction. `failed_at` uses `toMySqlDateTime` (no trailing-`Z` ER_1292 — the R4C2 fix holds). **No claim-connection leak, no stuck-enqueued set, no infinite re-enqueue.**

### Async-effect / event-handler sweep — CLEAN (except BUG-1 above)
- `settings-client.tsx`: BUG-1/AGG-R7-02 fixed (mounted ref + clearTimeout). Mount-fetch effect (101-115) `cancelled`-guarded. `handleSave`/`handleBackfill` are `useTransition` event handlers; their post-await setStates are event-context (acceptable) and the backfill one now flows through the guarded `refreshBackfillStatus`.
- `home-client.tsx`: scroll-restore effect (138-163) cancels rAF×2 + clearTimeout + `cancelled` flag; scroll listener removed (184); prop-sync `setAllImages(images)` is a sanctioned prop-driven reset (stale load-more responses guarded by LoadMore's own queryVersionRef).
- `photo-viewer.tsx`: the two `onClick={async}` handlers (checkout 616-636, share 678-698) setState in `finally` after await — same unmount class as BUG-1 but lower exposure (checkout redirects via `window.location.href`, so the tree is leaving regardless; share is a short single-shot). Not separately reported; folds into the BUG-1 mounted-ref pattern if the team wants symmetry. The `cancelled`-guarded AVIF-probe effect (323-362) cleans up.

### Error-handling / status-code sweep — CLEAN
- Stripe webhook: `parseInt(imageIdStr,10)` guarded `!Number.isFinite || <= 0` (route.ts:238); deleted-image paid session answers 200 (not a retry-storming 500) with reconciliation log (273-279); unknown tier rejected 200. `async_payment_succeeded` gap is the ONLY entitlement issue and is already-owned (AGG-R7-13 / plan-316) — not re-opened.
- download `[imageId]`: `parseInt` + the `header?.affectedRows ?? 1` shape-fallback (route.ts:396-397) explicitly avoids a false-410 on driver shape drift; FileHandle closed on every error branch.
- `smart-collections.ts`: `JSON.parse` wrapped (310-312) → typed `SmartCollectionQueryError`; `isScalarValue` rejects non-finite numbers (327-328), closing the object/NaN→SQL-fragment vector at write time.

---

## Final sweep notes
- No NEW source changes since run-7 HEAD (working tree carries only review/plan `.md` files), so no working-tree-introduced regression to flag this cycle. The run-7 fixes (`f11746cd` settings timers, `0d2312cd`/`61cfd235` a11y, `4852bcf5` home-OG base JPEG, `d035de10` regression tests) are all present and consistent.
- The three findings above (load-more unmount, home-client ÷width, backfill width validation) are ALL pre-existing latent/LOW; none is a crash or corruption under realistic inputs.
- Parser-injection surface (ISOBMFF walkers ×3, ICC ×2, EXIF, smart-collection JSON) is uniformly bounds-checked, depth/scan-capped, NaN-guarded, and wrapped so malformed/adversarial input degrades to "unknown / no signal / typed error" rather than throwing or looping. This is the strongest part of the codebase.

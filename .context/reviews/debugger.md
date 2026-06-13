# Debugger Review — Latent Bug Surface (Cycle 3 of review-plan-fix)

**Repo:** GalleryKit (`/Users/hletrd/flash-shared/gallery`)
**HEAD reviewed:** `ada92ba5` (prompt stated `ada92ba5`; the `e8fce327` latent-bug-hardening batch is in history and verified intact below).
**Scope:** boundary/parsing (ISOBMFF/ICC/GPS), async/lifecycle, concurrency, numeric/arithmetic, error handling.
**Method:** Empirical — every finding traced to an exact code path; arithmetic and buffer bounds reasoned by hand. Working tree has only `.context/reviews/*` + new plan files dirty; no source drift vs HEAD.

---

## VERIFICATION of prior-cycle (e8fce327) hardening — ALL INTACT at HEAD

| Guard | File:line | Status |
|---|---|---|
| load-more setState-after-unmount | `components/load-more.tsx:36,51,88,133-138` | ✅ `mountedRef` flipped on unmount; checked before AND after the await, and in `finally`. Symmetric. |
| home-client containIntrinsicSize / aspectRatio 0-width | `components/home-client.tsx:278-282` | ✅ `hasValidDims = width>0 && height>0`; falls back to `1/1` + square reservation. |
| settings-client backfill poll unmount + timer cleanup | `settings/settings-client.tsx:83,87,96,122-130,169-171` | ✅ `backfillMountedRef` + `backfillPollTimers` cleared on unmount; status setState gated on the flag. |
| admin-backfill-runner width re-validation | `lib/admin-backfill-runner.ts:430-436` | ✅ `!Number.isFinite(row.width) || row.width <= 0` → `encode-failed`, NO version bump (stays a candidate). |

None regressed. I did not re-report any of these.

---

## CONFIRMED LATENT BUGS

### BUG-2 — SW image-cache metadata is a lost-update under concurrent gallery paints — LOW (pre-existing, not from e8fce327)
**File:** `public/sw.template.js` — `getMeta()`/`setMeta()` (70-91), `recordAndEvict()` (95-122), `touchMeta()` (152-161).
**Precondition:** a masonry paint fires N concurrent `staleWhileRevalidateImage` calls; each cache-hit tile independently does `getMeta()` → mutate its own URL entry → `setMeta()` (whole-doc overwrite, no compare-and-swap).
**Failure (silent-wrong-result):** classic read-modify-write race. Concurrent `touchMeta`/`recordAndEvict` each read the same meta snapshot and write back the entire doc → last-writer-wins → other tiles' size/timestamp updates are dropped. Effect: LRU `total` byte accounting drifts low (cache can exceed the 50 MB cap until the browser quota evicts) or recency timestamps are lost (suboptimal eviction order).
**Likelihood:** High frequency, near-zero user impact — the 50 MB cap is best-effort and the browser quota is the real backstop. No effect on served bytes or correctness.
**Fix:** serialize meta mutations behind a single-flight promise chain (module-level `metaWriteLock = metaWriteLock.then(mutate)`), OR accept as documented best-effort. A code change must also update `sw-template-contract.test.ts` (it pins the template) and re-stamp `sw.js` via `build-sw.ts`.
**Confidence:** High that the race exists; High that impact is negligible. This is the only finding with any consequence, and it is consistent with the codebase's documented "best-effort LRU" posture, so deferring is defensible.

---

## CHECKED-AND-CORRECT (the surfaces the prompt flagged — no action)

### CHK-1 — CICP code-2 ("Unspecified") branch in `color-detection.ts`
**File:** `lib/color-detection.ts:175-200` (maps), `:343-345` (ICC inference), `:370-387` (NCLX per-field override).
Code 2 is intentionally absent from every `NCLX_*_MAP`. The run-8 c2 fix (`74235265`) applies each mapped NCLX value **only when defined** (`if (nclxX !== undefined)`), so a partially-specified NCLX box no longer clobbers an ICC-derived transfer/matrix/primary with `'unknown'`. The documented "NCLX > ICC chromaticity > ICC name" precedence holds per-field. Final `isHdr` is `transfer in {pq,hlg}`. **Correct.**

### CHK-2 — ISOBMFF / ICC / GPS parsers (adversarial input)
Every `readUInt*` / `readBigUInt64BE` / `toString` in `parseCicpFromHeif` (color-detection 217-283), `hasGainMap` (gain-map-detection 57-291), `detectGamutFromIccChromaticity` (icc-chromaticity 220-322), `extractIccProfileName` (icc-extractor 45-127), and the five `stripGpsFrom*` walkers (gps-exif-strip) is **bounds-checked before access**, depth/scan/count-capped, and the top-level walk is `try/catch`-wrapped to return a safe default (null / false / unmodified buffer). I found **no** OOB read/write, ÷0, NaN-escape, or throw-to-caller in any of them:
- `xyzToXy` rejects `|sum| < 1e-9`; `invert3x3` rejects `|det| < 1e-12`; `readS15Fixed16`/`readXyzTag`/`readChadMatrix` return NaN/null on OOB and every consumer checks `Number.isFinite`. (icc-chromaticity 106-200, 291-295)
- gps-exif-strip `readSized` returns `null` for size ∉ {0,4,8} and rejects 8-byte values `> MAX_SAFE_INTEGER`; the final `start<0 || length<0 || start+length>buf.length` (521) bounds every `buf.fill`; `construction_method !== 0 → return null` (513). Adversarial iloc cannot drive an OOB write.
- WebP last-chunk odd-size padding (585-588) lands `next` 1 byte past `buf.length`; the loop condition `offset+8 <= buf.length` terminates next iteration, and the TIFF/XMP read already validated `dataEnd > buf.length → return null`. Benign.
- icc-extractor `desc` `strEnd = strStart + max(0, strLen-1)` intentionally drops the trailing NUL (ICC v2 `declaredLength` includes it) — correct, not an off-by-one.

### CHK-3 — Async/lifecycle (AbortController, timers, promise rejection)
- **histogram.tsx:526-577** — worker terminated on unmount; the image-load effect uses BOTH a local `aborted` flag and `AbortController` + `signal.aborted` guard before every `setHistogramState`; `img.onload/onerror` nulled and `img.src=''` on cleanup. No setState-after-unmount, no double-fetch. **Correct.**
- **og-photo-fetch.ts:52-66** — `AbortSignal.timeout` is per-fetch and caught locally (miss → null). No leak. **Correct.**
- **admin-backfill-runner.ts:792-794** — fire-and-forget runner wrapped so its `finally` (742-745) is the single release point for `running`, the advisory lock, and the lock connection; the outer `.catch` swallows a synchronous pre-try throw to avoid `unhandledRejection`. **Correct.**

### CHK-4 — Numeric / arithmetic
- `resolveBackfillConcurrency` (admin-backfill-runner 129-142): `Number.isFinite(poolLimit)` fallback to 10, `Math.max(1, …)` floor, `req = Math.max(1, Math.floor(requested)||1)` — output always ≥ 1 and finite; can never freeze PQueue with NaN/0. The documented `cap=2` at pool=10 is correct.
- `home-client.tsx:196-202,278-282` — `estimatedCardWidth` floors at 300 on non-positive; aspect/intrinsic-height guarded on 0-width. **Correct.**
- `process-image.ts:1010-1029` — wide-gamut downscale `scale = sqrt(CAP/basePixels)`, `targetWidth = max(1, round(width*scale))`; `basePixels` uses guarded `baseHeight` (`>0 ? : 0`). Upload path rejects width/height ≤ 0 at 843-847. tmp intermediate unlinked in `finally` (1300-1304); `wasDownscaled` computed pre-finally and the finally never reassigns the var. **Correct.**

### CHK-5 — Concurrency (losing-worker / cleanup / leak correctness)
- **Per-image claim (upload queue)** `image-queue.ts:259-281,372-380,520`: loser retries (escalating, max 10), winner runs conditional `UPDATE … WHERE processed=false`; `affectedRows===0` (deleted mid-process) → cleans its own 3 variant dirs; lock released in `finally`. No leak.
- **Backfill claim (in-app)** `admin-backfill-runner.ts:333-358,464-568`: loser/pool-exhausted → `locked` skip, NO version bump; winner holds claim across encode→detect→UPDATE; detection-fail persists `was_downscaled`/`avif_10bit` WITHOUT version bump (resume contract, locked by `admin-backfill-runner-detection-failure.test.ts`). Released in `finally`.
- **Backfill keyset non-snapshot walk** (377-401): termination rests on the backfill advisory lock + fresh uploads landing at CURRENT version; both hold.
- **Delete-while-processing** `app/actions/images.ts:587-602`: DB txn + queue-state clear; in-flight worker detects `affectedRows===0` and self-cleans.
- **Restore quiesce** `image-queue.ts:692-733`: pause→clear→onIdle (the COR-R4C12-01 deadlock fix present); `enqueueImageProcessing` fronts every path with `isRestoreMaintenanceActive()`, so a late claim-retry timer (275-280) is suppressed during maintenance.
- **Topic create / tag batch** `topics.ts:145-175`, `tags.ts:387-456`: ER_DUP_ENTRY catch (TOCTOU-safe), `INSERT IGNORE` + collision detection, image-file cleanup on failure.
All correct — no orphaned files, no leaked locks/connections, no half-written rows on the paths I traced.

---

## BOTTOM LINE

**Confirmed latent bugs of any consequence: 1**
- **BUG-2** — SW image-cache metadata lost-update (LOW; pre-existing; best-effort cache only, browser quota is the backstop).

**No new CRIT/HIGH/MED latent bugs.** Every parser/lifecycle/concurrency/arithmetic surface the prompt flagged (CICP code-2, ISOBMFF walker, ICC desc/mluc, chromaticity ÷0/NaN, gain-map, GPS byte-strip on malformed/truncated files, the SW bounded-HEAD abort path, backfill concurrency math, 0-width CSS) is either already correctly defended at HEAD, an intended/bounded trade-off, or unreachable with adversarial input. The boundary parsers are uniformly bounds-checked and `try/catch`-wrapped; the e8fce327 hardening batch is intact and symmetric.

**Recommendation this cycle:** optionally serialize SW meta writes (BUG-2) only if the team wants the 50 MB image-cache cap to be hard rather than best-effort. Otherwise no code changes are warranted on the latent-bug surface.

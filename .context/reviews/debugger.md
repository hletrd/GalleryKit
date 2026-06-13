# Debugger Review — Latent Bug Surface (Cycle 5, fresh pass at current HEAD)

**Repo:** GalleryKit (`/Users/hletrd/flash-shared/gallery`)
**HEAD reviewed:** `1dde9b1e` ("docs: correct cache() count + og:image/JSON-LD comment honesty"). Working tree clean save for `.context/reviews/*` + new plan files.
**Date:** 2026-06-13
**Baseline delta:** the prior debugger sweep ran at `ce0029aa`. Current HEAD is **7 commits ahead** (`8ce8f914`..`1dde9b1e`) — the AGG-C4 cycle-4 batch landed in those commits. So the genuinely-NEW-since-prior-sweep code is:
- `40a65aef` touch-target regex `(?<!max-)` lookbehind fix (test-file)
- `300009d4` **sidecar `flushBatch` deferred orphan-cleanup** (biggest change, +73 lines, PRODUCTION backfill path)
- `fd708c1e` sales StatusBadge a11y (no logic)
- `18de78eb` **`image-queue.ts` delete-race cleanup `[]` dir-scan** (+16 lines)
- `2251b122` new runner detection-failure delete-race test (+226 lines)
- `1dde9b1e` doc/comment-only (`page.tsx` ×2, CLAUDE.md, one test docstring)

**Scope:** binary parsers (ISOBMFF/ICC/GPS), Sharp pipeline + queue, advisory locks / pool connections, SW, AbortController/timeout, React effect cleanup, boundary arithmetic, resource leaks, unhandled rejections, error-path correctness, `affectedRows` guards, `useSyncExternalStore` snapshot stability.
**Method:** Empirical — every finding traced to an exact code path; buffer bounds and arithmetic reasoned by hand against adversarial input; the 5 touched-file test groups RE-RUN live (22/22 + the new pin 1/1). Prior-sweep VERIFIED-CLEAN items were re-touched (not trusted) and re-confirmed; they are NOT re-reported as new.

---

## VERIFICATION of the 7 new commits since the prior sweep — ALL CLEAN

| Change | File:line (current HEAD) | Status |
|---|---|---|
| **AGG-C4-02** sidecar `flushBatch` deferred orphan-cleanup (`300009d4`) | `scripts/backfill-color-pipeline.ts:337-391, 393-412` | ✅ Correct. SELECT (`:272`) fetches `filename_avif/webp/jpeg`; `BatchFilenames` populated from those (`:398-402`); `splice(0,len)` (`:339-340`) is synchronous → two concurrent PQueue workers (BACKFILL_CONCURRENCY=2) cannot grab the same items / double-UPDATE / double-cleanup; `affectedRows===0` checked on BOTH the color-update and derivative-only UPDATE (`:362,373`); cleanup runs AFTER `db.transaction` commits (`:386`) so a best-effort unlink error can't roll back sibling updates; `deleteImageVariants(dir, fn, [])` (`:331-333`) does the full dir-scan (catches non-default sizes); ENOENT-tolerant per-file `.catch(()=>{})`. `deletedMidReencode` is its own counter; `processed -= n` is cosmetic (console summary), `errors` untouched → `process.exit(errors>0?1:0)` (`:442`) exit code correct. Matches the in-app runner contract exactly. |
| **AGG-C4-04** upload-queue delete-race `[]` dir-scan (`18de78eb`) | `image-queue.ts:384-386` | ✅ Correct. All three `deleteImageVariants(UPLOAD_DIR_*, job.filename*, [])` now pass `[]` → `deleteImageVariants` (`process-image.ts:505`) hits the `sizes.length===0` dir-scan branch, removing every `{name}_{size}{ext}` variant regardless of the admin-configured size list. Closes the prior orphan-of-non-default-sizes gap. UUID basenames preclude the `${name}_` scan touching another image. |
| **AGG-C4-05** runner detection-failure delete-race test (`2251b122`) | `__tests__/admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` | ✅ Non-vacuous. Mocks `detectColorSignals`→throw (forces detection-failure branch), mocks UPDATE→`affectedRows:0`, asserts all 3 dirs cleaned (webp/avif/jpeg), third arg `=== []` (`:207-208`), outcome `deleted-mid-reencode` (not `detection-failed`), `processed===0`/`detectionFailures===0`/`errors===0`, and `lastRunHadFailures===false`. RE-RAN live: 1/1 pass. |
| **AGG-C4-01** touch-target `(?<!max-)` lookbehind (`40a65aef`) | `__tests__/touch-target-audit.test.ts` | ✅ Correct, no new false-negative. `\b(?<!max-)h-8\b`: `min-h-8` → lookbehind sees `min-` ≠ `max-` → matches (correct, `min-h-8` IS a real 32px floor); `max-h-8` → lookbehind sees `max-` → rejected (correct, ceiling). `min-h`/`min-w`/`size` deliberately unguarded. 9 negative-fixture pins added. Test-file only — gate precision, not runtime. RE-RAN live: 12/12 pass. |
| Doc/comment-only (`1dde9b1e`, `fd708c1e`) | `(public)/page.tsx:103-115`, `p/[id]/page.tsx:217-227`, `sales-client.tsx`, CLAUDE.md | ✅ Zero logic on the latent-bug surface. The two `page.tsx` diffs are pure comment additions (verified via `git show`); sales is a Tailwind class swap. |

The prior sweep's hardening (load-more unmount, home-client 0-width, settings-client poll cleanup, backfill width guard, histogram lifecycle, gps-exif fail-closed) remains intact at `1dde9b1e` — re-spot-checked, none regressed.

---

## CONFIRMED LATENT BUGS

### BUG-1 — SW image-cache metadata is a lost-update under concurrent gallery paints — LOW (pre-existing; = AGG-C4-08 / AGG-R8c3-10, KNOWN; RE-CONFIRMED unchanged)
**File:** `public/sw.js` — `getMeta()` (`:70`), `setMeta()` (`:82`), `recordAndEvict()` (`:95`), `touchMeta()` (`:152`). (Mirror in `public/sw.template.js`.)
**Trigger:** a masonry paint fires N concurrent `staleWhileRevalidateImage` calls; each cache-hit tile independently does `getMeta()` → mutate its own URL entry → `setMeta()` — a whole-document overwrite with no compare-and-swap or single-flight lock.
**Failure (silent-wrong-result):** classic read-modify-write race. Concurrent `touchMeta`/`recordAndEvict` each read the same meta snapshot and write back the entire doc → last-writer-wins → other tiles' size/timestamp updates are dropped. Effect: the LRU `total` byte accounting drifts LOW (the 50 MB image cache can exceed its soft cap until the browser quota evicts), or recency timestamps are lost → suboptimal eviction order.
**Blast radius:** cache-housekeeping ONLY. No served-byte impact, no correctness impact, no crash/leak. The browser quota is the real backstop for the 50 MB cap.
**Fix (only if the team wants a HARD cap):** serialize meta mutations behind a module-level single-flight promise chain (`metaWriteLock = metaWriteLock.then(mutate)`). A code change MUST also update `sw-template-contract.test.ts` (pins the template) and re-stamp `sw.js` via `scripts/build-sw.ts`.
**Confidence:** High that the race exists; High that impact is negligible. **Defensible to DEFER** per the documented best-effort cache posture (CLAUDE.md). Unchanged from prior cycles — explicitly carried as AGG-C4-08.

This remains the **only** finding of any consequence, and it is a known carried item — not net-new this cycle.

---

## NEEDS-VALIDATION / OBSERVATIONS (no defect, recorded for completeness)

### OBS-1 — Sidecar `flushBatch` rejection is not individually caught inside its `queue.add` task — INFO (operator-script-only, no lock leak, NOT introduced by AGG-C4-02)
**File:** `scripts/backfill-color-pipeline.ts:394-412` (`queue.add(async () => { … await flushBatch() … })`) + `:427-442` (post-drain).
**Mechanism:** `flushBatch`'s `db.transaction(...)` (`:346`) can reject on a mid-run DB drop / deadlock. The `queue.add` task body has no surrounding try/catch and the call site has no `.catch`. `await queue.onIdle()` (`:427`) resolves when the queue DRAINS regardless of task outcome, so a mid-loop `flushBatch` rejection surfaces as an **unhandled promise rejection** (Node logs it; on modern Node it does not by itself kill the process, but the `errors` counter is not incremented for it). If instead the FINAL flush (`:430`) rejects, control jumps to the top-level `main().catch()` (`:447`) → `process.exit(1)` **without** reaching the explicit `RELEASE_LOCK` (`:436`) / `lockConn.release()` (`:440`).
**Why it is NOT a bug:** (1) the advisory lock is held on a dedicated `lockConn`, and MySQL releases `GET_LOCK` automatically on connection close — `process.exit(1)` tears down the TCP connection → lock released (the script header documents exactly this). No permanent lock leak. (2) The `db.transaction` is atomic — a throw rolls back that batch's UPDATEs, no half-written rows. (3) This is a **pre-existing structural property** of the batched script: the original code had `await tx.execute(...)` in the identical uncaught position. The AGG-C4-02 change added the `affectedRows` check and post-commit cleanup INSIDE the same flow and added no new throw site (the cleanup itself is per-file `.catch(()=>{})`). (4) One-shot operator script, run by an admin, exits non-zero on failure → operator re-runs (idempotent). **No action** beyond recording. (A defensive `try/catch` around the task body that increments `errors` and a `finally` lock-release in `main` would make the failure path tidier, but is cosmetic given connection-close auto-release.)

### OBS-2 — `baseOffset + extentOffset` HEIF-iloc sum could lose integer precision, but cannot OOB — INFO (= prior OBS-1, re-confirmed at current lines)
**File:** `gps-exif-strip.ts:514, 521`.
`start = baseOffset + extentOffset`, where each addend is a `readSized` value (≤ 8 bytes; `readSized` rejects 8-byte values `> MAX_SAFE_INTEGER`). The SUM of two near-`MAX_SAFE_INTEGER` values can exceed `MAX_SAFE_INTEGER` (~9.0e15) and lose exact integer precision. **NOT exploitable:** line 521's `start + length > buf.length` compares against `buf.length` (≤ hundreds of MB ≈ 1e8). Any imprecise `start` near 1.8e16 is unambiguously `>> buf.length` → `return null`. The float imprecision never lands inside `[0, buf.length]`. No OOB read/write. Adversarial input crafted to hit this still fails closed. **No action.**

### OBS-3 — view-count flush timer is a bare `setTimeout(asyncFn)` but cannot reject — INFO (= prior OBS-2, re-confirmed)
**File:** `data.ts:54, 84, 160` schedule `setTimeout(flushGroupViewCounts, …)`; `flushGroupViewCounts` is `async`. Every per-group DB write inside `Promise.all` carries its own `.then().catch()`, so `await Promise.all(...)` cannot reject, and the outer body has no synchronously-throwing statement. The detached timer never produces an unhandled rejection. **No action.**

### OBS-4 — copy-button `setTimeout(() => setCopied(false), …)` is not cleaned on unmount — INFO (= prior OBS-3, re-confirmed)
**File:** `color-details-section.tsx`, `lightbox-color-pip.tsx`. If the component unmounts within the timeout window of a copy click, `setCopied(false)` fires post-unmount. In React 18+/19 a setState-after-unmount is a **silent no-op** (the dev-only warning was removed in React 18). Not a bug on this React version. **No action.**

---

## CHECKED-AND-CORRECT (the surfaces the prompt flagged — re-verified at `1dde9b1e`)

### CHK-1 — ISOBMFF / ICC / GPS parsers (adversarial input)
Re-walked every `readUInt*` / `readBigUInt64BE` / `toString` / `subarray` / `fill` in `parseCicpFromHeif` (color-detection), `parseGainMapFromHeif` / `hasGainMap` (gain-map-detection), `detectGamutFromIccChromaticity` (icc-chromaticity), `extractIccProfileName` (icc-extractor), and the five `stripGpsFrom*` walkers (gps-exif-strip). Every access bounds-checked before use; depth/scan/count-capped (`MAX_DEPTH=5`, `MAX_SCAN_BYTES=1MB`, `itemCount>4096`/`extentCount>64` rejects, `:501`); the top-level walk `try/catch`-wrapped to a safe default. **No OOB, no ÷0, no NaN-escape, no throw-to-caller.** Specifics re-confirmed:
- `gps-exif-strip` HEIF iloc: `constructionMethod !== 0 → return null` (`:513`); `start<0 || length<0 || start+length>buf.length` (`:521`) bounds every `buf.fill`/`stripGpsFromTiffRegion`; `headerOffset > length-8 → return null` (`:527`, with `length>=8` from `:525`); `tiffStart` ⊆ `[0,buf.length]`.
- `gps-exif-strip` WebP: `dataEnd > buf.length → return null` (`:568`); `next <= offset → return null` (`:587`) kills any zero/negative-advance infinite loop; odd-size last-chunk padding lands `next` ≤ 1 byte past EOF, loop terminates benignly.
- icc-chromaticity: `xyzToXy` rejects `|sum| < 1e-9`; `invert3x3` rejects `|det| < 1e-12`; every `readS15Fixed16`/`readXyzTag` consumer checks `Number.isFinite`.

### CHK-2 — `useDisplayCapability` snapshot stability (React #185) — CLEAN
**File:** `lib/use-display-capability.ts:47-82, 123-125`.
`detect()` caches the last snapshot by VALUE in module-scope `_cachedSnapshot` (`:47`) and returns the SAME reference when `colorGamut`+`isHdr` are unchanged (`:73-79`) — so `useSyncExternalStore`'s `Object.is(prev,next)` check sees a stable reference → **no infinite re-render loop**. The module-global cache is correct here (all consumers observe the same physical display). `subscribe` (`:84-113`) registers MQ change handlers + focus/visibilitychange fallbacks and returns a cleanup that removes every one (`:112`); unsupported-MQ `matchMedia` throws are swallowed (`:95`). SSR/getServerSnapshot returns the stable `SERVER_DEFAULT` constant. **No leak, no loop, no setState-after-unmount.**

### CHK-3 — Histogram worker lifecycle + transferable (AbortController, StrictMode) — CLEAN
**File:** `components/histogram.tsx:129-167, 173-228, 526-588`.
- Worker effect (`:526`) creates a fresh `Worker` and `terminate()`s + nulls it in cleanup → StrictMode double-mount safe.
- Image-load effect (`:534`) uses BOTH a local `aborted` flag AND `AbortController`/`signal.aborted` before every `setHistogramState`; nulls `img.onload/onerror` + sets `img.src=''` on cleanup → no setState-after-unmount, no double-fetch.
- **Transferable is correct:** `computeHistogramAsync` calls `ctx.getImageData` (`:219`) → a FRESH ArrayBuffer per call; passes `imageData: imageData.data.buffer` (`:223`, the ArrayBuffer, not the ImageData object); `postMessage({…}, [payload.imageData])` (`:165`) transfers that ArrayBuffer. No detached-buffer reuse across retries — every compute re-creates a fresh canvas + fresh `getImageData`.
- `requestId` is a module-global monotonic `++` counter; `handleMessage` filters by `requestId` AND each component listens only on its OWN worker → no cross-instance message collision even with lightbox+viewer mounted simultaneously. `handleMessage`/`handleAbort` both `cleanup()` their listeners → no listener leak.

### CHK-4 — Both backfill paths' `affectedRows===0` delete-race cleanup — CLEAN (in-app + sidecar now identical)
- **In-app runner** `admin-backfill-runner.ts:430-440` (`cleanupDeletedMidReencodeVariants`), `:556-577` (success branch), `:594-609` (detection-failure branch): BOTH UPDATE branches check `affectedRows===0 → cleanup([]) → return deleted-mid-reencode`; `wasDownscaled`/`avif10bit` captured from the successful `processImageFormats` result (`:515-516`) BEFORE the detection try-block so they're never stale on the detection-failure path; per-image claim released in `finally` (`:610-614`); whole-run advisory lock + lock connection released in `runBackfill`'s `finally`.
- **Sidecar** `scripts/backfill-color-pipeline.ts:337-391`: now mirrors the runner (see VERIFICATION table). The CLAUDE.md "both paths share the guard / SAME column set" claim is now TRUE for the cleanup contract — the AGG-C4-02 divergence the prior cycle flagged is closed.

### CHK-5 — Numeric / arithmetic
- `resolveBackfillConcurrency` (admin-backfill-runner): `Number.isFinite(poolLimit)?:10` fallback, `Math.max(1,…)` floor, `req = Math.max(1, Math.floor(requested)||1)` → output always ≥1 and finite; can never freeze PQueue with NaN/0.
- `process-image.ts` wide-gamut downscale `scale=sqrt(CAP/basePixels)`, `targetWidth=max(1,round(w*scale))`, upload rejects w/h ≤ 0, tmp unlinked in `finally`.
- Sidecar `reportEvery = Math.max(1, Math.floor(rows.length/20))` → never 0 → no ÷0 in the `(index+1)%reportEvery` progress log.

### CHK-6 — Concurrency (losing-worker / cleanup / lock+connection release / affectedRows)
- Per-image claim (upload queue) `image-queue.ts`: claim-fail → re-enqueue + `enqueued.delete` (no lost job, no double-enqueue); winner runs conditional `UPDATE … WHERE processed=false`; `affectedRows===0 → cleanup([])` (`:384-386`, now dir-scan); claim connection released in `finally`.
- Restore quiesce, topic-create `ER_DUP_ENTRY` catch, tag `INSERT IGNORE` + collision detection — all release locks/connections in `finally`, clean up orphaned files on the losing path.
- All fire-and-forget hooks (caption/embedding in image-queue, `runBackfill(...).catch()`) are caught → cannot escape as unhandledRejection. Bootstrap retry + GC interval both `.unref?.()` and guard against double-arm.

---

## BOTTOM LINE

**Net-new latent bugs this cycle: 0.**

The AGG-C4 batch (commits `40a65aef`..`1dde9b1e`) is clean on the latent-bug surface:
- The **sidecar `flushBatch` orphan-cleanup (AGG-C4-02)** correctly mirrors the in-app runner — synchronous `splice` is concurrency-safe under PQueue, cleanup runs post-commit so unlink errors can't roll back sibling updates, `[]` dir-scan catches non-default sizes, ENOENT-tolerant. No double-cleanup, no lock leak (auto-released on connection close), exit code unaffected.
- The **upload-queue `[]` dir-scan (AGG-C4-04)** correctly closes the non-default-size orphan gap.
- The **new detection-failure delete-race test (AGG-C4-05)** is non-vacuous and RE-RAN green (1/1).
- The **touch-target `(?<!max-)` lookbehind (AGG-C4-01)** introduces no new false-negative on real Tailwind tokens; test-file only.
- The doc/comment changes touch zero logic.

`useDisplayCapability` is correctly value-memoized → no React #185 loop. Histogram worker transferable is the ArrayBuffer (not ImageData), freshly allocated per compute → no detached-buffer reuse. Every ISOBMFF/ICC/GPS parser is bounds-checked + `try/catch`-wrapped against adversarial input; `baseOffset+extentOffset` precision loss fails CLOSED. Every lock/connection releases in `finally` (or via connection-close auto-release on the operator script); every fire-and-forget is caught; every detached timer is cleaned or a documented no-op on React 19; no integer-overflow/NaN/÷0 escapes.

**The sole carried item of any consequence is BUG-1 (SW metadata lost-update)** — LOW, pre-existing, best-effort cache only, browser quota is the backstop, **DEFER** per the documented posture. Recorded OBS-1 (sidecar task-rejection tidiness) is operator-script-only with no lock leak and is not introduced by this cycle.

**Recommendation this cycle:** no code change is warranted on the latent-bug surface. Honest convergence — the recent fixes landed clean and closed the prior cycle's one open concurrency divergence.

**Live re-runs this pass:** `backfill-color-pipeline` + `admin-backfill-runner-detection-failure` + `admin-backfill-runner-deleted-mid-reencode-detection-failure` + `touch-target-audit` + `process-image-variant-scan` → **23/23 pass** (22 in the batch + 1 standalone re-run of the new pin).

NET-NEW BUGS THIS CYCLE: 0

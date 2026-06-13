# Debugger Review — Latent Bug Surface (run-8, post-cycle-3 fresh sweep)

**Repo:** GalleryKit (`/Users/hletrd/flash-shared/gallery`)
**HEAD reviewed:** `ce0029aa` (working tree clean save for `.context/reviews/*` + new plan files). **The prompt's stated `ce0029aa` baseline is 10 commits AHEAD of the prior debugger sweep's `ada92ba5`** — this pass re-verifies the new commits `22387f32` (NCLX code-2 comment), `0028ede4` (og-sanitize), `6454c4a3`/`6be638d2`/`ecd093ab` (tests/i18n/a11y), `5f097262`/`ce0029aa` (docs), and the **AGG-R8c3-03 backfill orphan-cleanup** (`admin-backfill-runner.ts`), none of which existed at the prior sweep.
**Scope:** binary parsers (ISOBMFF/ICC/GPS), Sharp pipeline + queue, advisory locks / pool connections, SW, AbortController/timeout, React effect cleanup, boundary arithmetic, resource leaks, unhandled rejections, error-path correctness, `affectedRows` guards.
**Method:** Empirical — every finding traced to an exact code path; buffer bounds and arithmetic reasoned by hand against adversarial input. I did NOT re-report the prior-sweep VERIFIED-CLEAN set unless I re-touched it and found a regression (none).

---

## VERIFICATION of new commits since the prior sweep — ALL CLEAN

| Change | File:line | Status |
|---|---|---|
| **AGG-R8c3-03** backfill orphan-file cleanup (NEW) | `admin-backfill-runner.ts:421-440, 556-608` | ✅ Correct. Both UPDATE branches (success + detection-failed) check `affectedRows === 0` → `cleanupDeletedMidReencodeVariants(row)` → return `deleted-mid-reencode`. Mirrors the upload-queue `affectedRows===0` cleanup. `deletedMidReencode` is its OWN tally (not a failure → does not flip `lastRunHadFailures`, line 791). Variant cleanup passes `[]` sizes → full dir scan catches all prior-config variants; wrapped in `.catch()` (best-effort, like `deleteImage`). |
| `getLatestImageForOg` minimal OG accessor (NEW, AGG-R8c3-05) | `data.ts:872-883`, used `page.tsx:93` | ✅ Sound. `buildImageConditions(undefined, tagSlugs, false)` → `processed=true` + optional tag `IN(subquery)`; topic is `undefined` so the `null` return is unreachable, and the caller handles `null` anyway (`latestImage ? […] : []`). `cache()`-wrapped for SSR dedup. `LIMIT 1` over the homepage composite index. No tag JOIN/GROUP_CONCAT. |
| NCLX code-2 `isHdr` side-effect (comment-only, `22387f32`) | `color-detection.ts:384-399` | ✅ Behavior unchanged from the prior sweep's CHK-1; the diff adds only a clarifying comment. Per-field `!== undefined` guards preserve ICC transfer/matrix; code-2 absent from all NCLX maps; `isHdr = transfer in {pq,hlg}`. The documented upload-rejection side-effect is intentional. |
| og-sanitize unification + i18n + a11y (`0028ede4`/`6be638d2`/`ecd093ab`) | (no logic on the latent-bug surface) | ✅ No parser/lifecycle/arithmetic impact. |

The prior sweep's e8fce327 hardening (load-more unmount, home-client 0-width, settings-client poll cleanup, backfill width guard) remains intact at `ce0029aa` — re-spot-checked, none regressed.

---

## CONFIRMED LATENT BUGS

### BUG-1 — SW image-cache metadata is a lost-update under concurrent gallery paints — LOW (pre-existing; = AGG-R8c3-10, KNOWN)
**File:** `public/sw.js` — `getMeta()`/`setMeta()` (70-91), `recordAndEvict()` (95-122), `touchMeta()` (152-161). (Mirror in `public/sw.template.js`.)
**Trigger:** a masonry paint fires N concurrent `staleWhileRevalidateImage` calls; each cache-hit tile independently does `getMeta()` → mutate its own URL entry → `setMeta()` — a whole-document overwrite with no compare-and-swap or single-flight lock.
**Failure (silent-wrong-result):** classic read-modify-write race. Concurrent `touchMeta`/`recordAndEvict` each read the same meta snapshot and write back the entire doc → last-writer-wins → other tiles' size/timestamp updates are dropped. Effect: the LRU `total` byte accounting drifts LOW (the 50 MB image cache can exceed its cap until the browser quota evicts), or recency timestamps are lost → suboptimal eviction order.
**Blast radius:** cache-housekeeping ONLY. No served-byte impact, no correctness impact, no crash/leak. The browser quota is the real backstop for the 50 MB cap.
**Fix (only if the team wants a HARD cap):** serialize meta mutations behind a module-level single-flight promise chain (`metaWriteLock = metaWriteLock.then(mutate)`). A code change MUST also update `sw-template-contract.test.ts` (pins the template) and re-stamp `sw.js` via `scripts/build-sw.ts`.
**Confidence:** High that the race exists; High that impact is negligible. **Defensible to DEFER** given the documented best-effort cache posture (CLAUDE.md "SW image-cache metadata is a lost-update … Defensible to DEFER").

This is the **only** finding of any consequence, and it is unchanged from the prior cycle — explicitly carried as the known latent item AGG-R8c3-10.

---

## NEEDS-VALIDATION / OBSERVATIONS (no defect, recorded for completeness)

### OBS-1 — `baseOffset + extentOffset` HEIF-iloc sum could lose integer precision, but cannot OOB — INFO
**File:** `gps-exif-strip.ts:514, 521`.
`start = baseOffset + extentOffset`, where each addend is a `readSized` value (≤ 8 bytes, and `readSized` already rejects 8-byte values `> MAX_SAFE_INTEGER`). The SUM of two near-`MAX_SAFE_INTEGER` values can exceed `MAX_SAFE_INTEGER` (~9.0e15) and lose exact integer precision. **This is NOT exploitable:** line 521's `start + length > buf.length` compares against `buf.length` (≤ hundreds of MB ≈ 1e8). Any imprecise `start` near 1.8e16 is unambiguously `>> buf.length` → `return null`. The float imprecision never lands inside `[0, buf.length]`. No OOB read/write. **No action.** (Adversarial-input crafted to hit this still fails closed.)

### OBS-2 — view-count flush timer is a bare `setTimeout(asyncFn)` but cannot reject — INFO
**File:** `data.ts:54, 84, 160` schedule `setTimeout(flushGroupViewCounts, …)`; `flushGroupViewCounts` is `async`. Every per-group DB write inside `Promise.all` carries its own `.then(...).catch(...)` (the `.catch` returns), so `await Promise.all(...)` cannot reject, and the outer `try { … } finally { … }` body has no synchronously-throwing statement. `flushGroupViewCounts` therefore never produces an unhandled rejection from the detached timer. **No action.**

### OBS-3 — copy-button `setTimeout(() => setCopied(false), 1200)` is not cleaned on unmount — INFO
**File:** `color-details-section.tsx:276`, `lightbox-color-pip.tsx:100`. If the component unmounts within 1.2 s of a copy click, `setCopied(false)` fires post-unmount. In React 18+/19 a setState-after-unmount is a **silent no-op** (no warning, no leak — the dev-only warning was removed in React 18). Not a bug on this React version. **No action.**

---

## CHECKED-AND-CORRECT (the surfaces the prompt flagged — re-verified at `ce0029aa`)

### CHK-1 — ISOBMFF / ICC / GPS parsers (adversarial input)
Re-walked every `readUInt*` / `readBigUInt64BE` / `toString` / `subarray` / `fill` in `parseCicpFromHeif` (color-detection 217-283), `parseGainMapFromHeif` / `hasGainMap` (gain-map-detection), `detectGamutFromIccChromaticity` (icc-chromaticity), `extractIccProfileName` (icc-extractor), and the five `stripGpsFrom*` walkers (gps-exif-strip). Every access is bounds-checked before use; depth/scan/count-capped (`MAX_DEPTH=5`, `MAX_SCAN_BYTES=1MB`, `itemCount>4096`/`extentCount>64` rejects); the top-level walk is `try/catch`-wrapped to a safe default (null/false/unmodified buffer). **No OOB, no ÷0, no NaN-escape, no throw-to-caller.** Specifics:
- `parseCicpFromHeif`: `size < headerSize || pos+size > buffer.length → break`; `colr` reads gated by `dataSize >= 11` (so `dataStart+10 < pos+size <= buffer.length`); size-1 64-bit path checks `pos+16 > buffer.length`. The double `dataSize >= 11` (lines 251, 253) is redundant but harmless.
- `gps-exif-strip` HEIF iloc: `construction_method !== 0 → return null` (513); `headerOffset > length-8 → return null` (527, with `length>=8` from 525); `tiffStart` ∈ `[start, start+length-4]` ⊆ `[0, buf.length]` (521); the `start<0 || length<0 || start+length>buf.length` guard (521) bounds every `buf.fill` / `stripGpsFromTiffRegion`.
- `gps-exif-strip` WebP: `dataEnd > buf.length → return null` (568); `next <= offset → return null` (587) kills any zero/negative-advance infinite loop; odd-size last-chunk padding lands `next` ≤ 1 byte past EOF and the loop terminates next iteration — benign, as the prior sweep found.
- icc-chromaticity: `xyzToXy` rejects `|sum| < 1e-9`; `invert3x3` rejects `|det| < 1e-12`; every `readS15Fixed16`/`readXyzTag` consumer checks `Number.isFinite`.

### CHK-2 — CICP code-2 ("Unspecified") branch (color-detection)
As CHK-1 in the prior sweep, re-confirmed at HEAD with the new comment (`22387f32`). Per-field `!== undefined` override preserves ICC-derived transfer/matrix/primary; the documented NCLX>ICC-chromaticity>ICC-name precedence holds per-field; `isHdr` derivation correct.

### CHK-3 — Async / lifecycle (AbortController, timers, promise rejection, StrictMode)
- **histogram.tsx:526-577** — worker effect creates a fresh `Worker` and terminates it in cleanup (StrictMode double-mount safe); the image-load effect uses BOTH a local `aborted` flag AND `AbortController`/`signal.aborted` before every `setHistogramState`, and nulls `img.onload/onerror` + `img.src=''` on cleanup. No setState-after-unmount, no double-fetch, no leaked worker.
- **optimistic-image.tsx:28** — retry `setTimeout` handle stored in a ref and `clearTimeout`'d on unmount. The `key={src}` remount resets state cleanly. Correct.
- **og-photo-fetch.ts:53** — per-fetch `AbortSignal.timeout(OG_PHOTO_FETCH_TIMEOUT_MS)`, caught locally → null. No leak, no double-fire.
- **sw.js:227-247** — the cached-image HEAD probe carries `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)`; abort/304/200-different-ETag all fall through cleanly to stale-serve + background revalidate (`startRevalidate()` is a single-flight lazy closure with `.catch(()=>null)`). No hang, no unhandled rejection.
- **image-queue.ts** fire-and-forget caption (385-400) + embedding (424-453) hooks: each wrapped in `.then().catch()` / `try/catch` inside the IIFE — cannot escape as unhandledRejection. Bootstrap retry (560-564) + GC interval (675-681) both `.unref?.()` and guarded against double-arm; GC interval `clearInterval`'d before re-set.

### CHK-4 — Numeric / arithmetic
- `resolveBackfillConcurrency` (admin-backfill-runner 129-142): `Number.isFinite(poolLimit)?:10` fallback, `Math.max(1, …)` floor, `req = Math.max(1, Math.floor(requested)||1)` — output always ≥ 1 and finite; can never freeze PQueue with NaN/0. `cap=2` at pool=10 correct.
- `home-client.tsx` `estimatedCardWidth`/aspect/intrinsic-height 0-width guards intact (prior sweep CHK-4).
- `process-image.ts` wide-gamut downscale `scale=sqrt(CAP/basePixels)`, `targetWidth=max(1,round(w*scale))`, upload rejects w/h ≤ 0, tmp unlinked in finally — intact.

### CHK-5 — Concurrency (losing-worker / cleanup / lock+connection release / affectedRows)
- **Per-image claim (upload queue)** `image-queue.ts:259-281, 372-381, 519-532`: claim-fail → `setTimeout(enqueueImageProcessing)` + `enqueued.delete` (so the re-enqueue passes the `enqueued.has` guard, line 245) — no lost job, no double-enqueue. Winner runs conditional `UPDATE … WHERE processed=false`; **`affectedRows===0` (deleted mid-process) → cleans its 3 variant dirs**. Claim connection released in `finally` (null-safe). MAX_CLAIM_RETRIES=10 / MAX_RETRIES=3 with permanently-failed FIFO-capped set.
- **Backfill claim (in-app)** `admin-backfill-runner.ts:343-368, 442-615`: pool-exhausted/held → `locked` skip (no version bump); claim held across encode→detect→UPDATE; **both UPDATE branches now check `affectedRows===0` → cleanup + `deleted-mid-reencode`** (AGG-R8c3-03 — the gap the prior cycle flagged, now closed); detection-fail persists `was_downscaled`/`avif_10bit` WITHOUT version bump (resume contract); claim released in `finally`; whole-run advisory lock + lock connection released in `runBackfill`'s `finally` (805-808); fire-and-forget `runBackfill(...).catch()` swallows a synchronous pre-try throw.
- **Restore quiesce** `image-queue.ts:692-733`: pause→clear→onIdle (COR-R4C12-01 deadlock fix) order correct; bootstrap retry timer `clearTimeout`'d; all retry maps cleared; `enqueueImageProcessing` fronts every path with `isRestoreMaintenanceActive()`.
- **Topic create / tag batch** `topics.ts`, `tags.ts`: `ER_DUP_ENTRY` catch (TOCTOU-safe), `INSERT IGNORE` + collision detection, image-file cleanup on failure.
All release locks/connections in `finally`, clean up orphaned files on the losing path, and (now on BOTH the upload and backfill paths) guard `affectedRows===0`. No orphaned files, no leaked locks/connections, no half-written rows on any path traced.

---

## BOTTOM LINE

**Confirmed latent bugs of any consequence: 1**
- **BUG-1** — SW image-cache metadata lost-update (LOW; pre-existing; = known AGG-R8c3-10; best-effort cache only, browser quota is the backstop; **DEFER unless a hard 50 MB cap is wanted**).

**No new CRIT/HIGH/MED latent bug.** The 10 commits that landed since the prior debugger sweep are clean on the latent-bug surface: the **AGG-R8c3-03 backfill orphan-cleanup closed the one open concurrency gap** the prior cycle identified (now both the upload-queue AND in-app-backfill paths guard `affectedRows===0` and clean up orphaned derivatives on a delete-during-processing race); the new `getLatestImageForOg` accessor is sound; the NCLX code-2 change was comment-only. Every parser is bounds-checked and `try/catch`-wrapped against adversarial input; every lock/connection releases in `finally`; every fire-and-forget is caught; every detached timer is cleaned or `unref`'d; no integer-overflow/NaN/÷0 escapes; no unhandled rejection.

**Recommendation this cycle:** no code change is warranted on the latent-bug surface. BUG-1 remains the sole optional hardening (serialize SW meta writes), and it is defensible to leave as documented best-effort.

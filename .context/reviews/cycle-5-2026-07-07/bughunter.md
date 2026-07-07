# Cycle 5 — High-Confidence Bug Lane (bughunter)

Start HEAD: `d9bcbf4c` (cycle-4 terminal). Reviewed all 14 cycle-4 commits
line-by-line and traced edge cases, then swept the broader committed
lib/actions/api/components/db surface for pre-existing high-severity defects.
Read the cycle-4 aggregate (C4-01..C4-47) and the carry-forward register first
so every item below is NEW signal, not a re-report.

## NEW findings

### C5-BH-01 — MED / Confirmed — SWR "true-revalidate" path drops the recency-authority meta write on SW termination
- **Where:** `apps/web/public/sw.template.js:429` and its generated mirror
  `apps/web/public/sw.js:429`, inside `staleWhileRevalidateImage` (committed HEAD).
- **The bug:** the true stale-while-revalidate branch (reached when the cached
  entry has no ETag to probe, or the HEAD revalidation probe network-failed)
  serves the cached bytes and kicks off the background revalidation as a bare
  `startRevalidate();` — **neither `await`-ed nor wrapped in
  `extendLifetime(event, …)`/`event.waitUntil`.** It is the ONLY one of the six
  revalidation call sites in that function without lifetime coverage:
  - L396 304-path `touchMeta` → `await extendLifetime(event, …)` ✅
  - L402 / L408 / L424 / L434 `startRevalidate()` → `await …` inside the
    respondWith chain ✅ (covered by `respondWith` itself)
  - L415 same-ETag-200 `touchMeta` → `await extendLifetime(event, …)` ✅
  - **L429 `startRevalidate();` → bare fire-and-forget ❌**
- **Why it's a real defect (not cosmetic):** `startRevalidate()`
  (`sw.js:321-339`) does `imageCache.put(...)` (fresh bytes),
  `recordAndEvict(request.url, size)` (writes the meta **timestamp — the sole
  recency authority per C3-10** — and runs the LRU eviction walk), and on
  404/410 `imageCache.delete` + `deleteMeta` (tombstone cleanup). Because the
  branch resolves `respondWith` immediately with `return cached`, the browser
  is free to terminate the SW while that async chain is still pending —
  Service Workers are killed aggressively once the fetch handler settles. The
  dropped write means the recency timestamp for an **actively-served** entry is
  frozen; per the exact C3-10 argument, a frozen timestamp then makes the entry
  age out and get spuriously evicted at the 1 h staleness boundary even though
  the server keeps confirming it fresh — plus the fresh bytes aren't cached and
  a 404/410 tombstone can be missed (stale entry re-served).
- **Root cause / lineage:** this is the incomplete-coverage residual of
  **C4-42 / PERF4-02** (commit `31ff51f5`). That fix routed the two `touchMeta`
  sites through `extendLifetime` and de-gated the response, but left the
  true-SWR-path `startRevalidate()` bare — the recurring "fixed one sibling,
  missed the next" pattern this repo has hit repeatedly (touch-target scanner,
  the `max-` lookbehind, etc.). Same defect *class* as C3-10 (TRC3-02/CRIT3-05),
  which was empirically reproduced for the 304 path.
- **Confidence:** HIGH that this is a genuine coverage gap of the established
  "background writes to the recency authority must be lifetime-covered"
  invariant. MEDIUM on blast radius: the effect is self-healing across
  subsequent requests, and only bites when the SW is terminated in the window
  between `return cached` and the revalidation settling.
- **Suggested fix:** `extendLifetime(event, startRevalidate());` (mirrors the
  existing `touchMeta` call sites), then regenerate + commit `sw.js` and pin it
  with a `sw-template-contract` assertion.
- **Corroboration / heads-up:** a concurrent cycle-5 implementation lane is
  *already* editing exactly this line in the working tree (see "Working-tree
  context" below) and has added a matching `sw-template-contract` test. That
  independently confirms the gap is real; this entry documents it against the
  committed HEAD the lane was mandated to review, and provides an independent
  second signal if that fix needs verification.

## Cycle-4 commit verification (traced; no NEW committed bug found)

Each cycle-4 fix was read in full and its edge cases traced. All are sound:

- **b68d09e2 migrate DML-baseline guard** — `journalSqlContainsDml` is
  deliberately lexical (comments stripped, split on `statement-breakpoint`/`;`,
  `^(INSERT|UPDATE|DELETE|REPLACE)\b`). False-negatives (e.g. block-commented or
  CTE-led DML) are only a *weakening* of a brand-new defense, never a regression
  vs the prior silent-baseline behavior, and the allowlist (`0001` only) +
  null-cursor/below-cursor coverage are correct. Clean.
- **ce15103a single-writer-guard self-heal** — traced the re-acquire loop:
  `scheduleReacquire` is idempotent (reacquireTimer guard, synchronous), the
  keepalive-catch and `conn.on('error')` both guard on `heldConnection === conn`
  so they can't double-schedule, `stopping` latch is checked at every re-entry
  point, and `holdConnection` resets `lapseWarned`/`contentionEmittedSinceLapse`.
  The open-conn→tryAcquire→holdConnection window without an `error` listener is a
  pre-existing pattern (also in `reprobeOnce`/`startSingleWriterGuard`) and is
  safe because mysql2 surfaces in-query failures as the query rejection (caught),
  not an unhandled `'error'` event. Clean.
- **12037508 detached-config invalidation + rename** — `invalidateDetachedGalleryConfigCache()`
  is placed after the settings transaction commits and before the success
  return; the empty-`sanitizedSettings` early-return correctly skips it (nothing
  written). All call sites use `getGalleryConfigDetached`; the deprecated alias
  is a pure re-export. Clean.
- **ad1fd22d SW phantom-byte fix** — making `total -= entry.size` unconditional
  restores the invariant `total == Σ size(entries)` (each add/remove is now
  symmetric); `evicted` staying gated on `deleted` is correct (it reports
  actually-freed Cache Storage bytes). Cannot under/over-count or go negative.
  Clean.
- **31ff51f5 SW waitUntil de-gate** — `networkFirstHtml` clones the body
  synchronously before `return networkResponse`, so the background put reads an
  independent tee; the HTML cache is offline-only best-effort so the `void`
  (fire-and-forget) put is acceptable there. The two image `touchMeta` sites are
  correctly `await extendLifetime(event, …)`. (This is the commit whose coverage
  C5-BH-01 finds incomplete — the L429 SWR path was not migrated.)
- **4afacfa8 viewer pin deterministic render** — SSR-safe (`useState(false)` +
  mount-effect restore). Minor: the `pinRestoredRef` gate in the persist effect
  is effectively dead (the restore effect, declared first, sets the ref true in
  the same commit), so a transient `false` is still written then immediately
  overwritten by the correct value on the next commit — harmless (correct end
  state; only an unmount between the two same-tick commits could strand it).
  Not a finding.
- **0da58d6b shared-group shallow URL sync** — verified the locale is preserved:
  `syncPhotoQueryBasePath` = `localizePath(locale, /g/${key})` which always
  includes the `/{locale}` prefix (localePrefix `'always'`), and
  `window.location.pathname` carries the same prefix, so the `current ===
  targetUrl` guard matches and `replaceState(null,'',targetUrl)` never strips the
  locale. Documented App-Router shallow-routing pattern. Clean.
- **d79f6f70 neighbor-preload deps** — reads `photoViewerSizes` from a ref;
  the ref-update effect is declared before the preload effect so the fresh value
  is visible on a photo change, and `sizes` is only a responsive hint anyway.
  Clean.
- **9dccebcd zoom touchmove non-passive** — native `{passive:false}` listener on
  the container ref; handler uses refs (no stale-closure hazard), stable identity
  (`useCallback([applyTransform])`), React `onTouchMove` removed. Clean.
- **5f0388ed settings-hash no-arg normalize** — verified `config.imageSizes` is
  itself `parseImageSizes(...)` (deduped+sorted, `gallery-config.ts:105`), so the
  config path's `[...].sort()` and the DB path's `parseImageSizes(...).join(',')`
  produce identical CSV even for duplicate stored inputs. No residual mismatch.
- **18b6cbb4 health probe coalesce** — the `HEALTH_CHECK_DB !== 'true'`
  liveness-only gate survived the refactor (`route.ts:62`); the shared-inflight
  promise + `.finally` reset coalesces correctly; the sustained-wedge
  one-conn-per-2s residual is documented, not new. Clean.
- **e3d221e3 serve-upload ETag helper** — pure extraction; both sites now call
  `buildDerivativeEtag`. Clean.
- **678ebbeb nav swipe-settle skip-reset** — `skipNextHardReset` is set on
  swipe-success and cleared by the `[prevId,nextId]` layout effect. Low-risk
  theoretical leak if a swipe-success ever failed to change prev/next (would skip
  one later hard reset), but the success branch already animates to the resting
  0 state, so even a leaked flag leaves visuals correct. Not a finding.
- **d7ca37de embedding model-version reset** — the `activeModelVersion` reset is
  computed after the `disabled` early-return and after `applyRuntimeSemanticGate`,
  the defensive backfill in `getProcessingQueueState` handles a legacy
  `undefined` field, and the reset couples correctly to the version-scoped
  `isNull` join. Clean.

## Pre-existing sweep (ruled out — verified correctly guarded)

- **`admin-backfill-runner.ts` delete-mid-reencode** — the `affectedRows === 0`
  path (`cleanupIfUpdateMissedDeletedRow`, L468-485) re-probes row existence
  (`imageRowStillExists`) BEFORE deleting variants, correctly defusing MySQL's
  changed-rows-vs-matched-rows gotcha (a same-value UPDATE cannot spuriously
  delete a live image's derivatives).
- **`view-retention.ts` purge** — `resolveRetentionMs` guard (`Number(...)`,
  finite-and-`> 0` else default) makes a future cutoff impossible; the DELETE is
  chunked (`VIEW_PURGE_BATCH` 5000 × `MAX_BATCHES_PER_TABLE` 200) with a per-sweep
  cap. No data-loss path.
- **`clip-embeddings.ts` decode** — `bufferToEmbedding` guards exact
  `EMBEDDING_BYTES`, handles byteOffset-alignment and endianness; the zero-copy
  view is a documented retention contract (callers copy), not a bug.
- **`image-queue.ts` embedding bootstrap** — the `affectedRows === 0` claim path
  uses `WHERE processed = false` (always a real value change, so 0 genuinely
  means no matching row); model-version cursor reset is correct.
- **`sharing.ts` conditional revoke/link** — `affectedRows === 0` on the
  conditional `share_key` UPDATE and the link-count `!==` check are correct
  race guards.
- **`api/admin/lr/upload/route.ts`** — tracker claim/settle pairing is idempotent
  and rolled back on every early-return/throw; the post-commit try/catch keeps a
  committed row from surfacing a non-JSON 500. No leak/orphan path found.

## Working-tree context (NOT a committed bug — flag for the orchestrator)

The shared working tree is being modified by a **concurrent cycle-5
implementation lane** while this review ran (observed live): uncommitted changes
to `sw.template.js`, `image-queue.ts`, `instrumentation.ts`, `search.tsx`,
`backfill-color-pipeline.ts`, `sw-template-contract.test.ts`, plus new
`lib/maintenance-scheduler.ts` + `maintenance-scheduler-source.test.ts` (the
C4-17 scheduled-next extraction). One of those in-flight edits is exactly the
C5-BH-01 fix (wrapping `sw.template.js:429` in `extendLifetime`). At one point I
observed the template edited but `sw.js` not yet regenerated — that transient
`sw.template.js`↔`sw.js` drift is WIP being actively regenerated, **not** a
committed defect: committed HEAD `d9bcbf4c` has both files consistent
(`startRevalidate();`, version `ccbc2e28-p7`). Note that my own `build-sw.ts`
runs during investigation touched the working-tree `sw.js`; the fix lane owns
that file and should regenerate/commit it as its final step.

## NEW-finding counts
- Confirmed/High-confidence: **1** (C5-BH-01, MED severity / Confirmed mechanism).
- Medium-confidence: 0 additional.
- Low/speculative (not counted, per lane filter): 2 noted inline (4afacfa8 dead
  pin-restore gate; 678ebbeb skip-reset leak) — both cosmetic, correct end state.

# Code-Reviewer Deep Review — Run-8 Cycle-3 follow-on (post-fix verification)

**Date:** 2026-06-13
**HEAD:** `ce0029aa` (working tree CLEAN — the git-status snapshot in the task prompt was stale; `git status --short` and `git diff --stat` both empty)
**Reviewer angle:** code quality, logic correctness, SOLID, maintainability, error handling, edge cases.

## What I verified

I read the latest `_aggregate.md` (run-8 cycle-3, 17 findings AGG-R8c3-01..17) in full, then independently verified — against current code, not the plan's word — the 10 fix commits `6453f360`..`ce0029aa` that closed that aggregate's actionable set. I systematically reviewed from my angle:

- **Recent fixes (commit-by-commit):** backfill orphaned-derivative cleanup (`0017a34e`), NCLX code-2 isHdr side-effect pin (`22387f32`), JSON-LD shared `sanitizeForOg` (`0028ede4`), home-OG minimal query (`e9040d17`), `retryFailedImage` i18n (`6be638d2`), latent-bug batch (`e8fce327`: load-more unmount guard / home-client 0-width CSS / backfill width guard), test-pinning (`6454c4a3`), amber dark-mode a11y (`ecd093ab`), destructive-text a11y (`77013cd0`), alias-button a11y (`d70c1d98`).
- **Adjacent / not-recently-touched surfaces:** `admin-backfill-runner.ts` (full), `image-queue.ts` (claim + cleanup paths), `api/download/[imageId]/route.ts` (full), `actions/auth.ts` (rate-limit flow), `auth-rate-limit.ts`, `bounded-map.ts`, `actions/images.ts` uploadImages (tracker + contract lock), `upload-tracker.ts`, `upload-processing-contract-lock.ts`, `data.ts` (`getLatestImageForOg` + listing queries + cursor), `smart-collections.ts` (JSON parse/validate), `admin-tokens.ts` (parseScopes), `og-photo-fetch.ts`, `gallery-config-shared.ts` (numeric parsing), `request-origin.ts`, `analytics.ts` (TLD+1), `validation.ts`, `og-sanitize.ts`, `collections.ts`, `load-more.tsx`, `lightbox.tsx` (per-photo reset), `sw.js` / `sw.template.js`.
- **Pattern sweeps:** empty catch blocks, `as any`, `@ts-ignore`/`@ts-expect-error`, off-by-one (`<=`, `length-1`, `length-2` indexing), unguarded `Number()`/`JSON.parse()`, TODO/FIXME/HACK markers.

---

## FINDINGS

### No new genuinely-open code-quality / logic / error-handling defect at HEAD `ce0029aa`.

This is an honest convergence result, not a content-free sign-off. I actively hunted for adjacent gaps the recent fixes might have left and for fresh defects in unreviewed files; the items below are what I scrutinized and why each is NOT a defect. Where I confirm a prior fix, I cite the mechanism I checked.

The aggregate's open set (AGG-R8c3-01..17) is accurate. The two behavior-touching MEDs (AGG-R8c3-01 NCLX/isHdr, AGG-R8c3-03 backfill orphan-leak) landed correct, test-backed fixes (`22387f32`, `0017a34e`). The remaining open items are LOW a11y/test-depth/doc — outside my correctness lane and already enumerated there; I do not duplicate them.

### Items I scrutinized hardest (candidate defects → confirmed NOT defects)

1. **Upload-quota check-then-act TOCTOU (the one I most expected to find).** `actions/images.ts` reads `tracker.count` at `:197` and `tracker.bytes` at `:223`, but the actual increment is deferred to `:251-253`, PAST several `await` points (disk `statfs` `:204-214`, topic `db.select` `:239-242`). In isolation this is a classic check-then-act gap that two concurrent same-key uploads could each pass before either increments. **NOT a defect:** the entire `uploadImages` body (`:171`→`:534` finally) runs under the GLOBAL MySQL advisory lock `LOCK_UPLOAD_PROCESSING_CONTRACT` (single lock name, not per-key — verified in `upload-processing-contract-lock.ts`). All upload invocations across the instance are fully serialized, so no second upload can interleave between the check and the increment. The up-front `set()` (C8R-RPL-02) is belt-and-braces under this lock, not the primary guard. Confidence: High.

2. **Backfill orphan-cleanup polarity & scope (`admin-backfill-runner.ts:430-440, 556-608`).** Verified the AGG-R8c3-03 fix is correct end-to-end: `cleanupDeletedMidReencodeVariants` calls `deleteImageVariants(dir, filename, [])`, and `deleteImageVariants` with empty `sizes` (`process-image.ts:505-522`) does a full directory scan for `{name}_*{ext}` — so it catches the NEW derivatives `processImageFormats` just wrote under the same base filenames, even across a sizes-config change. The `Promise.all([...]).catch()` swallows unlink failures (best-effort, mirrors `deleteImage`). Both UPDATE branches (success `:573` and detection-failed `:605`) read `affectedRows` and clean up on 0. The new `deleted-mid-reencode` outcome is tallied separately and deliberately excluded from `hadFailures` (`:791`) so it doesn't flip the WITH-FAILURES banner — and excluded from the version bump so the row is simply gone. The counter partition (`handled = processed + ... + deletedMidReencode + errors`, `:752`) stays exact. Confidence: High this is correct.

3. **`load-more.tsx` `mountedRef` vs StrictMode + query-key reset.** Traced the interaction: `useRef(true)` init + the mount effect re-asserting `mountedRef.current = true` (`:133-138`) is REQUIRED for React 19 StrictMode (mount→unmount→mount would otherwise leave it `false` after the first cleanup). The stale-query short-circuit (`version !== queryVersionRef.current`, `:51`) and the unmount guard (`!mountedRef.current`) are independent and composable; the `finally` (`:88`) correctly skips clearing `loadingRef`/`setLoading` when stale-or-unmounted because the reset effect (`:101-108`) already cleared them on a key change. No double-set, no leaked `loadingRef`. Confidence: High.

4. **`extractTldPlusOne` length-2 indexing (`analytics.ts:116-123`).** `labels[labels.length - 2]` is only reached after the `labels.length <= 2` early return (`:113`), so no OOB on bare/two-label hosts. Trailing-dot normalization (`:111`) handles the attacker-suppliable Referer. NOT a defect.

5. **Download route handle-leak surface (`api/download/[imageId]/route.ts`).** Re-walked every post-`open()` path: `openedHandle` alias closes on the stat-throw window (`:355`), claim-UPDATE failure closes (`:387`), already-used 410 closes (`:399`), stream-setup catch closes (`:456`), success relies on `autoClose`. Open-before-claim ordering means a missing file never burns the token. Traversal containment is doubled (string `startsWith` `:309` + post-`realpath` `:334`). Exemplary — no leak on any branch.

### Confirmed-correct fixes (mechanism verified, not trusted)

- **AGG-R8c3-01 (NCLX code-2 → isHdr):** `color-detection.ts:386-399` — the per-field code-2 guard preserves the ICC-name-inferred transfer, so an HDR-named ICC under NCLX transfer=Unspecified yields `isHdr=true` and the upload gate rejects by default. Comment now corrects the false "no delivered-byte impact" claim; pinned by `color-detection.test.ts` ("nclx code-2 transfer + PQ-named ICC → isHdr true"). Behavior is the intended one.
- **AGG-R8c3-02 (JSON-LD sanitizer):** `p/[id]/page.tsx` now imports the shared `sanitizeForOg` from `@/lib/og-sanitize` (Unicode-format + C0 strip); the weaker local copy and its lying docstring are gone. `sanitize-for-og-global.test.ts` `it.each` now pins all three consumers (both OG routes + the JSON-LD page) to the shared import — which also closes AGG-R8c3-11/TEST-1 (home OG route was previously unpinned).
- **AGG-R8c3-05 (home OG perf):** `data.ts:873-887` `getLatestImageForOg` selects only `{id, title}`, reuses `buildImageConditions` (tag filter rides an IN-subquery), single `.limit(1)` over the homepage composite index, `cache()`-wrapped at `:1597` as `getLatestImageForOgCached`. `page.tsx` calls the cached accessor. Shape locked by `data-tag-names-sql.test.ts` (asserts no `tagNamesAgg`/`GROUP_CONCAT`/`.leftJoin`/`.groupBy`).
- **AGG-R8c3-16(b) (i18n):** `retryFailedImage` (`images.ts:1085`) now returns `t('invalidImageId')` instead of the hardcoded string; key exists in both locales.

---

## VERIFIED-CLEAN / re-confirmed-fixed (prior findings checked, found genuinely closed)

- **AGG-R8-07** (load-more unmount): `mountedRef` guard present and StrictMode-safe (`load-more.tsx:36,51,88,133-138`). CLOSED.
- **AGG-R8-08** (home-client 0-width CSS): `hasValidDims` fallback to `1 / 1` aspect-ratio + square `containIntrinsicSize` (`home-client.tsx:268-280` region per `e8fce327`). CLOSED.
- **AGG-R8-09** (backfill width guard): `!Number.isFinite(row.width) || row.width <= 0` → distinct log + `encode-failed` (no version bump, idempotent retry) at `admin-backfill-runner.ts:461-467`. CLOSED.
- **AGG-R8-05 / DOC SW HEAD bound:** `HEAD_REVALIDATE_TIMEOUT_MS = 300` + `AbortSignal.timeout(...)` present in BOTH `sw.js:38,230` and `sw.template.js`. SW_VERSION stamp `ee0f38bd-p7` current. CLOSED.
- **AGG-R8-13 / AGG-R8c3-02 (OG-sanitize symmetry, all three copies):** shared `og-sanitize.ts` strips Unicode-format (global twin) + C0 controls; all three consumers import it. CLOSED.
- **Empty catch / `as any` / type-suppression hygiene:** zero empty catch blocks in non-test code, zero `as any` in non-test code, all eslint-disables documented with rationale. CLEAN.
- **JSON.parse safety:** both runtime `JSON.parse` sites (`admin-tokens.ts:120` parseScopes, `smart-collections.ts:310` parseSmartCollectionQuery) wrapped in try/catch with downstream structural validation (`validateNode`, `normalizeScopes`). CLEAN.
- **Numeric-parse guards:** cursor parsing (`data.ts:753,1374` `Math.max(Math.floor(Number(...)) || 0, 0)`), config parsing (`gallery-config-shared.ts:233-252,296-311` `Number.isInteger` + range), `resolveBackfillConcurrency` NaN guard (`admin-backfill-runner.ts:137`) — all defended. CLEAN.
- **Rate-limit count/window logic:** `getLoginRateLimitEntry` resetting `count=0` without resetting `lastAttempt` is harmless — window expiry keys off `lastAttempt` only while count is 0, and the increment path sets `lastAttempt=now` fresh (`auth-rate-limit.ts:21-39`, `auth.ts:124-139`). Global pre-increment-before-Argon2 TOCTOU fix intact. CLEAN.

---

## Severity tally (this lane, this pass)

- CRITICAL: 0
- HIGH (high-confidence): 0
- MEDIUM: 0 new (the 2 behavior-touching MEDs from the aggregate are already fixed and re-verified here)
- LOW: 0 new (aggregate's LOW a11y/test/doc items stand; outside this lane)
- Open Questions (low-confidence): none

**Verdict for my lane: APPROVE / honest convergence.** No CRITICAL or HIGH-confidence defect. The run-8-c3 fix batch is solid and the fixes landed exactly as the commits claim (verified by mechanism, not message). I manufactured no low-value churn — the surfaces most likely to harbor adjacent gaps (backfill cleanup polarity, upload-quota concurrency, async-resolve unmount, download handle leaks) were each traced to a real guard.

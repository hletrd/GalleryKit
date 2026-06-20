# Code Reviewer — run-7 cycle-4 (HEAD 25bb2794)

**Angle:** code correctness — logic bugs, edge cases, race conditions, error handling, invariant violations, data-flow / state consistency.
**Verdict:** ✅ **0 new actionable findings.** This run is genuinely converged on the correctness axis.

## Scope & method

- Confirmed the delta `c6eff919..HEAD` is comments + docs + a compile-time guard + a SW stamp only — **no new application logic** (per task brief; verified via `git diff --stat`).
- Despite the trivial delta, performed a deep, whole-repo correctness sweep (focus `apps/web/src/**`, 235 non-test source files). Examined the highest-risk subsystems directly and via 6 parallel skeptical sub-reviews:
  - Color parsing: `color-detection.ts` ISOBMFF/NCLX walker, `icc-*`, `gain-map-detection.ts`
  - Byte-level metadata: `gps-exif-strip.ts` (JPEG/TIFF/HEIF/AVIF/WebP)
  - Pipeline: `image-queue.ts`, `process-image.ts`
  - Data layer: `data.ts` (masonry lists, `tagNamesAgg`, prev/next nav, privacy split), `data-timeline.ts`
  - Auth/limits: `auth-rate-limit.ts`, `bounded-map.ts`, `download-tokens.ts`, `admin-tokens.ts`, `api-auth.ts`
  - Payments: `stripe/webhook/route.ts`, `checkout/[imageId]/route.ts`, `view-retention.ts`, `advisory-locks.ts`
  - Client state: `use-display-capability.ts`, `image-zoom-math.ts`, `photo-viewer.tsx`, `lightbox-color-pip.tsx`

## Delta verification (the only code change this run)

- **`settings-hash.ts:63-66` — new `_ColorKeysAreSettingKeys` compile-time guard (AGG-R7C3-02):** Correct. `(typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey` is a sound subset assertion mirroring the `data.ts` privacy guards. `tsc -p tsconfig.typecheck.json` passes with **0 errors**, confirming all 9 keys are valid `GallerySettingKey`s. The docstring honestly notes it cannot catch a *forgotten new* byte-impacting key — accurate.
- **`color-detection.ts:190-208` — NCLX comment clarifications (AGG-R7C3-01):** Comment-only. No mapped value changed. The maps remain correct vs ITU-T H.273 (code 5 = BT.470BG gamma 2.8 → `gamma28`; code 8 = YCgCo matrix; 14/15 = BT.2020 SDR → `gamma24`; 16 = PQ; 17 = `gamma26`; 18 = HLG). `settings-hash.test.ts` + `color-detection.test.ts` → **60/60 pass**.

## Candidate findings investigated and REFUTED (with decisive evidence)

Six candidates surfaced by sub-reviews; all independently verified against the actual code and refuted:

1. **`data.ts:562-576` `buildTagFilterCondition` — claimed `ONLY_FULL_GROUP_BY` rejection.** REFUTED. `tags.slug` is referenced ONLY inside `COUNT(DISTINCT …)` in the `HAVING` clause (an aggregate); the SELECT/GROUP BY use only `imageTags.imageId`. This is valid under `ONLY_FULL_GROUP_BY`. Live-wired to the public homepage/topic tag filter (`actions/public.ts:78 loadMoreImages`, `(public)/page.tsx`); a strict-mode rejection would 500 every tag-filter click in production — it does not.

2. **`data.ts:1034-1074` prev/next nav for an undated current image — claimed it returns earliest instead of latest dated predecessor.** REFUTED. Grid order is `capture_date DESC NULLS LAST`; undated rows sort *after* all dated rows, so the predecessor of the first undated image is the **oldest** (smallest capture_date) dated row. The prev query's `ORDER BY asc(capture_date) LIMIT 1` correctly returns exactly that. The sub-review confused the grid direction; the in-code comment (1026-1029) is correct.

3. **`data-timeline.ts:241` `new Date(capture_date).getMonth()` — claimed UTC/local month shift.** REFUTED. The space-separated `'YYYY-MM-DD HH:mm:ss'` form is parsed as **local** time by V8/Node (UTC parsing applies only to the ISO `T` form without offset). Parse-local + read-local (`getMonth()`) → correct wall-clock month. NaN inputs are dropped by the `Number.isFinite/1..12` guard.

4. **`gps-exif-strip.ts:539-543` — claimed OOB / extent-boundary read in HEIF EXIF.** REFUTED. Line 539 explicitly guards `buf.length - tiffStart >= 6`, so `subarray(tiffStart, tiffStart+6)` is buffer-bounds-safe. `tiffStart += 6` only happens on a matched signature. The contrived "Exif\0\0 at extent tail" case yields `tiffStart > tiffEnd`, which `stripGpsFromTiffRegion` rejects at line 104 (`tiffEnd - tiffStart < 8 → null`), so the caller returns null and falls back to re-encode. No OOB, no corruption.

5. **`gps-exif-strip.ts:524` `baseOffset + extentOffset` — claimed MAX_SAFE_INTEGER precision loss enabling OOB.** REFUTED. `readSized` caps each operand at MAX_SAFE_INTEGER; the only contrived overflow yields `start ≈ 9e15`, which line 531's `start + length > buf.length` (buf.length ≤ ~1e8 for a real file) rejects regardless of low-bit precision loss. Unreachable.

6. **`image-queue.ts:502` permanently-failed eviction `>` vs `>=`; `bounded-map.ts:141` window `>` vs `>=`.** REFUTED as non-issues. The set tops out at MAX+1 transiently then evicts exactly one per overflowing `add` — hard-bounded, intentional soft-cap (documented C1F-DB-02 / C7-MED-05). The 1ms window-boundary semantic on a 15-min adversarial window is immaterial (and `>` = "expired strictly after window elapsed" is defensible).

## Re-verification of prior adjudicated items (no new evidence → not re-filed)

- MED-R7C2-01 (histogram clip %): re-confirmed REFUTED — per-pixel single increment means sum(r)=sum(g)=sum(b)=N; not re-filed.
- REJ-R7C3-01 (gps `indexSize`): re-confirmed DISPROVED — `indexSize` is never passed to `readSized`; every downstream read independently bounds-checked (lines 514, 520, 531); not re-filed.
- Carried LOW deferrals (R7C1-CR-01..04): no exit criterion met, no new evidence; not re-raised.
- `use-display-capability.ts` snapshot invariant (React #185): re-verified HOLDS — `detect()` returns the value-memoized `_cachedSnapshot` reference (lines 76-84) so `useSyncExternalStore`'s `Object.is` is stable.

## Positive observations

- Payment path is defense-in-depth correct: mandatory signature verify, sessionId-UNIQUE idempotency + SELECT-before-INSERT + ON DUPLICATE KEY, `insertId>0` fresh-vs-dup distinction, FK-failure → 200 to stop Stripe retries, card-only interim guard.
- Rate-limit rollback (`checkout` Pattern-2) and bounded-map cleanup (retry-map co-eviction) are consistent and leak-free.
- Compile-time guards (`_ColorKeysAreSettingKeys`, `_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`) and the ISOBMFF walker bounds (depth 5, 1 MB scan, per-read validation) are exemplary.

## Recommendation

**APPROVE.** No CRITICAL/HIGH/MEDIUM/LOW correctness issues at any usable confidence. Zero new actionable findings is the truthful result for this delta and this maturity level — no cosmetic churn manufactured.

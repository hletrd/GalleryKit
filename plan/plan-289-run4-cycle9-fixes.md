# Plan 289 — Run-4 Cycle 9 fixes

**Source review:** `.context/reviews/run4-cycle9/_aggregate.md` (6
findings → 4 fix tasks; TEST-R4C9-05 folds into Task 1, DOC-R4C9-05
folds into Task 2; 2 LOW observations recorded in plan-290, no other
deferrals). Per-angle provenance in the same directory. Repo policy:
GPG-signed commits, Conventional Commits + gitmoji, per-iteration
push, per-cycle deploy, no suppressions. HARD-SCOPE: no
edit/culling/scoring features.

## Task 1 — SEC-R4C9-01 (+TEST-R4C9-05): close the ExtendedXMP GPS gap in the JPEG scrubber
**Files:** `apps/web/src/lib/gps-exif-strip.ts`,
`apps/web/src/__tests__/strip-gps-from-original.test.ts`

Empirically proven this cycle: a JPEG whose standard XMP packet
carries only `xmpNote:HasExtendedXMP` while the GPS properties live in
`http://ns.adobe.com/xmp/extension/` APP1 segments returns
`{ stripped: false }` — the stored original (paid-download bytes)
keeps the coordinates.

- [ ] In the APP1 scan loop, also recognize
      `XMP_EXT_APP1_SIGNATURE` segments and token-test their payloads
      (skipping the 40-byte per-chunk GUID(32)+full-length(4)+
      offset(4) header) against `XMP_GPS_TOKEN`; any match sets
      `dropXmp`.
- [ ] Boundary robustness: ALSO reconstruct the full extended packet
      by concatenating the data runs of all ext-XMP chunks (in file
      order) and token-test the joined string, so a GPS token split
      across a 64 KB chunk boundary cannot slip through.
- [ ] Keep the no-GPS fast path byte-identical (`stripped:false`,
      same input reference) for ext-XMP files without GPS markers.
- [ ] Update the module header line 19 so "GPS-bearing XMP APP1
      segments dropped" is true for standard AND extended packets.
- [ ] Tests: (1) ext-only-GPS JPEG → `stripped:true`, output free of
      `GPSLatitude` AND of both XMP signatures; (2) std-GPS case
      unchanged; (3) GPS-free ext-XMP JPEG → `stripped:false`,
      same-reference; (4) split-token-across-chunks case → stripped.

## Task 2 — PERF-R4C9-02 (+DOC-R4C9-05): lazy SW revalidate; make the documented 304 economy real
**Files:** `apps/web/public/sw.template.js` (then `npm run build`
refreshes the committed `public/sw.js` via the prebuild stamp,
following the repo's SW_VERSION refresh-commit convention)

- [ ] Replace the eager `const revalidate = fetch(…)` with a
      `startRevalidate()` closure (single-flight per invocation) so
      the GET is dispatched only when actually needed.
- [ ] Cache-hit + ETag + HEAD 304 → serve cached WITHOUT any GET;
      update only the LRU recency metadata (reuse the existing meta
      machinery with the cached entry's known size — no body read,
      no cache.put).
- [ ] Cache-hit + ETag mismatch (200 + different ETag) → await
      `startRevalidate()` and serve the fresh response (current
      behavior preserved).
- [ ] Cache-hit + no ETag or HEAD probe failure → serve cached and
      fire `startRevalidate()` in the background (true SWR,
      current behavior preserved).
- [ ] Cache-miss → await `startRevalidate()` (current behavior
      preserved, including the 503 fallback).
- [ ] Fix the R11-M1 comment so it describes the now-true behavior.
- [ ] `isSensitiveResponse` / `.ok` gating unchanged on the network
      path.

## Task 3 — PERF-R4C9-03: stop shipping multi-MB base JPEGs for 48-px OnThisDay thumbnails
**Files:** `apps/web/src/components/on-this-day-widget.tsx`
(+ a thin use of the existing `components/optimistic-image.tsx`)

- [ ] Replace the bare `<img src=/uploads/jpeg/{base}.jpg>` with the
      existing `OptimisticImage` client component:
      `src=/uploads/jpeg/{base}_{minSize}.jpg` (smallest configured
      size from `getGalleryConfig().imageSizes`),
      `fallbackSrc=/uploads/jpeg/{base}.jpg`, `width/height=48`,
      `loading=lazy`, `unoptimized` (repo convention for /uploads).
- [ ] Update the R20-M2 comment: the correctness contract (base file
      always exists) now lives in `fallbackSrc`, not in the primary
      URL.
- [ ] Verify the widget still renders zero client JS beyond the six
      small islands (server component shell unchanged).

## Task 4 — TEST-R4C9-04: enforce the timeline privacy mirror
**Files:** `apps/web/src/lib/data-timeline.ts`,
`apps/web/src/__tests__/privacy-fields.test.ts` (or sibling fixture)

- [ ] Add the data.ts-pattern compile-time guard to data-timeline.ts:
      `type _TimelineSensitive = Extract<keyof typeof
      timelineSelectFields, _PrivacySensitiveKeys>` asserted `never`
      (duplicate the sensitive-keys union locally or export it from
      data.ts — prefer exporting the existing type to avoid drift).
- [ ] Extend the privacy fixture suite to pin
      `timelineSelectFields` ∩ SENSITIVE_KEYS = ∅ at runtime
      (import the module, intersect key arrays), so the type guard
      and the fixture list cannot drift apart.

## Task 5 — Housekeeping + gates + deploy
- [ ] Archive plan-287 (cycle-8 fixes, fully landed + deployed) to
      `plan/done/`.
- [ ] Run ALL gates repo-wide: eslint, typecheck, vitest,
      lint:api-auth, lint:action-origin,
      lint:public-route-rate-limit, production build, Playwright e2e.
      Errors block; warnings fixed or recorded in plan-290.
- [ ] DEPLOY_MODE=per-cycle: after gates green and pushes done, run
      `npm run deploy` once; record result.

## Progress
- (updated during PROMPT 3)

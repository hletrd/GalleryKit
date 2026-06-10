# Plan 287 — Run-4 Cycle 8 fixes

**Source review:** `.context/reviews/run4-cycle8/_aggregate.md` (10
findings → 6 fix tasks; DOC-R4C8-09 and TEST-R4C8-10 fold into their
parent tasks plus one docs commit; 4 designer LOW observations recorded
in plan-288, no other deferrals). Per-angle provenance in the same
directory. Repo policy: GPG-signed commits, Conventional Commits +
gitmoji, per-iteration push, per-cycle deploy, no suppressions.
HARD-SCOPE: no edit/culling/scoring features.

## Task 1 — COR-R4C8-01 (+TEST, +DOC): make `strip_gps_on_upload` actually strip GPS, without degrading the original
**Files:** new `apps/web/src/lib/jpeg-gps-strip.ts`,
`apps/web/src/lib/process-image.ts` (`stripGpsFromOriginal`),
new `apps/web/src/__tests__/strip-gps-from-original.test.ts`

Root cause (empirically proven): Sharp 0.33+ `withMetadata()` KEEPS
input EXIF — the current "strip" retains the full GPS IFD byte-for-byte
AND re-encodes the original at default quality (jpeg q80 / heif q50).

- [ ] `lib/jpeg-gps-strip.ts`: pure `stripGpsFromJpegBuffer(buf):
      { buffer: Buffer; stripped: boolean } | null`. Walk JPEG segments
      from SOI; find APP1 with `Exif\0\0` signature (skip XMP APP1);
      parse TIFF header (II/MM, bounds-checked); walk IFD0 entries for
      tag 0x8825 (GPSInfo pointer); follow to the GPS IFD (must lie
      inside the APP1 segment); zero every GPS entry's value bytes
      (inline values AND offset-referenced ranges, bounds-checked),
      zero the 12-byte entries, then write GPS entry count = 0.
      Return `null` on any structural anomaly (caller falls back to
      re-encode). No GPS tag found → `{ stripped: false }` (caller
      skips the rewrite entirely).
- [ ] Rewrite `stripGpsFromOriginal`: read the file; if extension is
      .jpg/.jpeg AND buffer starts with SOI → lossless scrub path:
      when `stripped`, write tmp with `mode: 0o600` + atomic rename
      (pixels byte-identical, all non-GPS EXIF preserved). If the scrub
      returns null (malformed EXIF) OR the format is non-JPEG →
      re-encode path: `sharp(file, { autoOrient: true })` (+
      `keepIccProfile()`, NO withMetadata so EXIF/GPS are dropped),
      explicit high-quality per-format options (jpeg q95, webp q95,
      avif/heif q90, png default lossless, tiff lzw), tmp + rename,
      chmod 0o600, `console.warn` that a re-encode occurred. Privacy
      always wins; quality is preserved wherever losslessly possible.
- [ ] Rewrite the docblock: state the Sharp withMetadata semantics
      trap, the lossless-JPEG vs re-encode split, and the quality
      trade-off for non-JPEG formats.
- [ ] Tests (behavioral, sharp-generated fixtures at runtime):
      (a) GPS-tagged JPEG → after strip, exif-reader reports no GPS
      lat/long; decoded raw pixel buffer byte-identical; Make/Model/
      orientation EXIF retained; (b) GPS-absent JPEG → file untouched
      (mtime/bytes equal); (c) PNG path → re-encoded, no GPS, ICC
      preserved; (d) malformed-EXIF JPEG → falls back to re-encode,
      still no GPS; (e) unreadable path → best-effort no-throw.
- [ ] Gates green; GPG-signed commit + push.

## Task 2 — COR-R4C8-02 (+TEST): replace the undecodable AVIF probe
**Files:** `apps/web/src/components/histogram.tsx`,
new `apps/web/src/__tests__/avif-probe-data-url.test.ts`
- [ ] Generate a valid minimal 1×1 AVIF via sharp at fix time; replace
      `AVIF_PROBE_DATA_URL`. (Shipped constant has no iloc/av1C/mdat —
      proven undecodable in Chromium; probe resolves false everywhere.)
- [ ] Unit test extracts the literal from the component source,
      base64-decodes, and round-trips through sharp (`metadata()`
      format heif/avif + `.raw().toBuffer()` decode succeeds) so a
      garbage constant can never ship again.
- [ ] Gates green; GPG-signed commit + push.

## Task 3 — PERF-R4C8-03 (+TEST, +DOC): single-fetch neighbor preload contract
**Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`,
`apps/web/src/components/photo-viewer.tsx`,
new `apps/web/src/lib/avif-support.ts`,
new `apps/web/src/__tests__/neighbor-preload-contract.test.ts`
- [ ] Move the probe to `lib/avif-support.ts` (client-safe
      Promise-singleton; histogram imports from it — keeps one
      source of truth with Task 2's valid constant).
- [ ] p/[id]/page.tsx: REMOVE the server-side neighbor preload hints
      and the now-unused `getImageCached(prevId/nextId)` fetches
      (proven triple-fetch: preload `type` gates MIME support only;
      fixed 1536 size mismatches viewports; fetchPriority=high competes
      with the current photo).
- [ ] photo-viewer.tsx preload effect: await `getAvifSupportPromise()`
      (cancel-safe) and emit exactly ONE `<link rel=preload>` per
      neighbor — AVIF when supported && filename_avif, else WebP when
      filename_webp, else JPEG — keeping imagesrcset/imagesizes.
      Correct the R13-H1 comment (preload `type` ≠ picture selection).
- [ ] Source-contract tests: page source contains no `rel="preload"`
      neighbor-hint block; viewer effect contains the single-format
      branch and no unconditional dual-format emission.
- [ ] Gates green; GPG-signed commit + push.

## Task 4 — COR-R4C8-04 + COR-R4C8-05 (+TEST): histogram redraw + working picture fallback
**Files:** `apps/web/src/components/histogram.tsx`,
`apps/web/src/components/lightbox.tsx`,
`apps/web/src/components/photo-viewer.tsx`,
new `apps/web/src/__tests__/picture-fallback-contract.test.ts`,
extend `apps/web/src/__tests__/histogram.test.ts` (or new wiring test)
- [ ] histogram.tsx: add `canvasDims` to the draw effect deps (canvas
      attribute change clears the buffer; nothing redraws today when
      crossing the 768 px breakpoint).
- [ ] lightbox.tsx + photo-viewer.tsx: replace the ineffective
      onError `img.src` swap (proven: `<source>` rows keep winning;
      currentSrc stays the 404 AVIF) with state-driven fallback —
      on error set `usePlainImgFallback` (reset on image change),
      render the `<img>` WITHOUT the `<source>` rows pointing at the
      base JPEG; keep the one-shot guard semantics.
- [ ] Contract tests: draw-effect dep array includes canvasDims;
      both components contain the state-driven fallback shape and no
      longer contain the bare src-swap regression shape.
- [ ] Gates green; GPG-signed commit + push.

## Task 5 — COR-R4C8-06 + COR-R4C8-07 + QUAL-R4C8-08: encoder + cleanup batch
**Files:** `apps/web/src/lib/process-image.ts`,
`apps/web/src/components/home-client.tsx`,
extend `apps/web/src/__tests__/process-image-icc-options-lockin.test.ts`
(or a small source-contract addition)
- [ ] process-image.ts AVIF retry: pass `bitdepth: 8` explicitly
      (sharp option setters merge; the clone inherits heifBitdepth 10,
      making the documented per-image 8-bit fallback unsatisfiable).
- [ ] process-image.ts WI-15 gate: read `inputMeta` with
      `autoOrient: true` so basePixels uses post-orientation height
      (rotated >cap sources currently under-evaluate the cap).
- [ ] home-client.tsx: delete the dead `queryVersionRef` + misleading
      comment (LoadMore owns the real staleness guard).
- [ ] Contract pin for the `bitdepth: 8` retry option.
- [ ] Gates green; GPG-signed commit + push.

## Task 6 — DOC-R4C8-09: CLAUDE.md corrections
**Files:** `CLAUDE.md`
- [ ] Fix default image-sizes claim (640, 1536, 2048, 4096, 5120,
      7680 — 6 sizes). Confirm the 10-bit fallback sentence is true
      after Task 5. (Docblock/comment rewrites land inside Tasks 1-4.)
- [ ] GPG-signed commit + push.

## Task 7 — Cycle hygiene
- [ ] Archive `plan/plan-285-run4-cycle7-fixes.md` → `plan/done/`
      (all 4 tasks landed + live smoke recorded; gates were green at
      cycle close).
- [ ] Run ALL gates repo-wide (eslint, typecheck, vitest, api-auth,
      action-origin, public-route-rate-limit, build, e2e); fix anything
      that surfaces; refresh SW_VERSION via the established build step
      if the build mutates `public/sw.js`.
- [ ] Deploy per cycle policy (`npm run deploy`) after all green.

## Progress log
- Task 1 ✅ `6117168a` — lib/gps-exif-strip.ts (JPEG APP1 / TIFF /
  ISOBMFF iinf+iloc / WebP RIFF scrubbers + GPS-XMP neutralization) +
  stripGpsFromOriginal rewrite (lossless tier → metadata-free
  re-encode tier, mode 0600 + atomic rename, HEIC anomaly surfaced
  loudly). 14 behavioral tests incl. pixel byte-identity and
  forensic-residue assertions. GPS now PROVABLY gone (exif-reader)
  where it previously survived byte-for-byte.
- Task 2 ✅ `848bc593` — valid sharp-generated 1×1 probe in client-safe
  lib/avif-support.ts (verified LOADS in Chromium); histogram re-export
  for back-compat; literal-decoding unit test (metadata + full raw
  decode + size cap).
- Task 3 ✅ `e94346a0` — server neighbor-preload hints removed from
  p/[id]/page.tsx (with the two neighbor getImageCached fetches);
  viewer effect now emits ONE probe-gated responsive preload per
  neighbor; R13-H1 comment corrected; source-contract suite (3).
- Task 4 ✅ `7afd8522` — sizedSourcesFailed state-driven fallback in
  lightbox + photo-viewer (recovery verified live in Chromium:
  currentSrc lands on the base JPEG, decoded); histogram draw effect
  gains canvasDims dep; contract pins (7).
- Task 5 ✅ `01a58f00` — explicit `bitdepth: 8` retry (+ lockin pin),
  autoOrient on the WI-15 inputMeta read, dead queryVersionRef +
  unused suppressions removed from home-client.
- Task 6 ✅ `00fcd542` — CLAUDE.md: 6 default sizes; Privacy section
  documents the GPS-strip contract + the withMetadata trap.
- Task 7 ✅ — plan-285 archived to done/ (`43423262`); ALL gates green
  repo-wide: eslint **0 errors / 0 warnings** · typecheck PASS ·
  vitest **1729/1729** (181 files; +28 tests / +4 files this cycle) ·
  lint:api-auth PASS · lint:action-origin PASS ·
  lint:public-route-rate-limit PASS · production build PASS
  (`BUILD-EXIT:0`, SW_VERSION refreshed in `089add4d`) · Playwright
  e2e **20 passed / 2 skipped** (the standing conditional skips), exit 0.
- Deploy: recorded below after `npm run deploy`.

# Test-Engineer Deep Review — GalleryKit — Cycle 6

**Date:** 2026-06-13
**HEAD:** `4c3d5924` (working tree CLEAN at start)
**Suite baseline (measured live this cycle):** `npx vitest run` → **218 files / 2080 tests, all passing** (exit 0, ~268 s cold). The documented libheif cold-flake did NOT reproduce.
**Specialist angle:** test coverage gaps (esp. on the freshly-found WebP GPS-strip bug + recently-landed fixes), vacuous/tautological tests, flaky tests, tests that pass for the wrong reason.

> **AUTHORSHIP NOTE:** The test-engineer subagent ran twice this cycle (initial fan-out + one retry per PROMPT-1's retry rule) and performed the investigation below, but its final `Write` to this file did not land in either attempt (the prior content of this file was the STALE cycle-5 review at HEAD `1dde9b1e` reporting the now-CLOSED TE-1/TE-5). The orchestrator captured the agent's investigation from its returned messages + independently re-verified every claim against current source, then persisted this file. Recorded under AGENT FAILURES in `_aggregate.md`.

---

## Cycle-5 gaps — CONFIRMED CLOSED (do not re-report)

- **AGG-C5-01** sidecar `flushBatch` orphan-cleanup — CLOSED (`fad9c279`). New file `backfill-color-pipeline-deleted-mid-reencode.test.ts` (149 LOC) drives the `affectedRows===0` branch via the extracted `cleanupDeletedMidReencodeVariants`/`collectDeletedMidReencodeFiles` seams; the critic independently proved it RED on guard-removal then restored.
- **AGG-C5-T1** en/ko leaf-key parity — CLOSED (`a062e81b`). New `i18n-key-parity.test.ts` flattens both message objects to leaf-key sets and asserts SET equality (KEYS only, per DOC-R5C3-07 — values legitimately differ en-ICU/ko-fixed). Verified would-catch a dropped ko key.
- **AGG-C5-T2** queue `[]`-dir-scan cleanup pin — CLOSED (`56bddff5`). New `image-queue-delete-race-cleanup-wiring.test.ts` source-shape-pins that `image-queue.ts:384-386` passes `[]` (3-arg form present, 2-arg form absent).
- **AGG-C4-09** image-manager touch-target budget 6→1 — CLOSED (`2637e5f2`). Real scanner count re-measured = 1 at HEAD.

---

## FINDINGS

### TE-C6-1 (MED · High confidence · CONFIRMED) — The WebP GPS-strip test is VACUOUS for the lossless contract; it passes through the re-encode fallback whether or not the lossless path works. This is what let DBG-C6-01 (the RIFF field-order bug) land undetected.

**Source under test:** `apps/web/src/lib/gps-exif-strip.ts:554-591` (`stripGpsFromWebpBuffer`). DBG-C6-01 found a real bug here: lines 564-565 read `chunkSize = readUInt32LE(offset)` and `chunkTag = toString(offset+4, offset+8)`, but the WebP RIFF spec (verified against developers.google.com/speed/webp/docs/riff_container) puts the FourCC tag at bytes 0-3 and the size at bytes 4-7 — they are **swapped**. The function returns `null` on the first chunk of EVERY real WebP (the FourCC `VP8X`=0x58385056 ≈1.48 GB is misread as `chunkSize`, so `dataEnd > buf.length` is immediately true). The lossless WebP scrub path is dead code; every `.webp` original with `strip_gps_on_upload=true` falls through to the Tier-2 lossy Sharp re-encode (`process-image.ts:1564-1567`).

**The test that should have caught it:** `apps/web/src/__tests__/strip-gps-from-original.test.ts:116-126` — `it('removes GPS from a WebP original via the RIFF scrub (pixels byte-identical)')`. WHY IT'S VACUOUS:
1. It calls the top-level dispatcher `stripGpsFromOriginal(file)`, never `stripGpsFromWebpBuffer` directly.
2. The fixture is made lossy: `makeFixture(..., 'webp')` → `pipeline.webp({ quality: 95 })` (line 71). A lossy VP8 file has no `VP8L` marker, so the Tier-2 fallback re-encodes at `{ quality: 95 }` (lossy again, `process-image.ts:1566-1567`).
3. The assertion compares **decoded raw pixels** (`sharp(file).raw().toBuffer()`), NOT file bytes. A q95→q95 WebP re-encode of an already-q95 decode typically yields the identical decode, so `pixelsAfter.equals(pixelsBefore)` PASSES through the fallback.
4. `gpsInFile()` returns null after the fallback too (the re-encode drops all metadata).

So the test passes whether the lossless path ran OR the re-encode fallback ran. Its name ("via the RIFF scrub") asserts a path it does not actually exercise; "byte-identical" refers to decoded pixels, not the file bytes the lossless contract is about (file bytes definitely change under re-encode). There is a dedicated `describe('gps-exif-strip pure scrubbers')` block (line 175) that tests `stripGpsFromJpegBuffer` directly — but it has NO `stripGpsFromWebpBuffer` entry, so the bug has no direct unit coverage either.

**Regression that slips through:** exactly DBG-C6-01 — the lossless WebP path is fully broken and the suite is green. More generally, any future regression to the WebP lossless path is invisible.

**Test to add (closes the gap + would have caught DBG-C6-01):** add to the `'gps-exif-strip pure scrubbers'` block a direct test:
```ts
it('stripGpsFromWebpBuffer losslessly removes GPS (pixel chunk byte-identical)', async () => {
  // build a real WebP carrying GPS EXIF, call stripGpsFromWebpBuffer(input)
  const result = stripGpsFromWebpBuffer(inputWithGps);
  expect(result).not.toBeNull();
  expect(result!.stripped).toBe(true);
  // assert the VP8/VP8L pixel chunk bytes are byte-identical (lossless) — only the EXIF/XMP chunk changed
  // and assert a GPS-free WebP returns { stripped: false } with the input reference
});
```
Plus a `stripGpsFromWebpBuffer` non-WebP-bytes → `null` case, mirroring the JPEG pure-scrubber tests at lines 176-189. Prove non-vacuous by confirming it goes RED against the current buggy source and GREEN after the field-order fix.

### TE-C6-2 (LOW · Medium confidence · likely) — The AVIF/ISOBMFF GPS-strip test shares the same dispatcher-level shape, but is LESS vacuous than WebP.

`strip-gps-from-original.test.ts:104-114` (AVIF) has the same structure (calls `stripGpsFromOriginal`, compares decoded pixels). It is less vacuous than the WebP case because the AVIF Tier-2 fallback re-encodes at q90 (`process-image.ts:1573`), which IS lossy and WOULD perturb decoded pixels — so if the ISOBMFF lossless path silently broke, the pixel-equality assertion would more plausibly fail. Still, a direct `stripGpsFromIsobmffBuffer` lossless-contract test (asserting file-byte identity outside the EXIF/XMP item, like the JPEG pure-scrubber tests) would be stronger than relying on the decoded-pixel proxy. Recommendation: when fixing TE-C6-1, add a parallel direct `stripGpsFromIsobmffBuffer` pure-scrubber test for symmetry. LOW because the AVIF path is not currently known-broken and the proxy assertion has more teeth than WebP's.

---

## Re-verified non-vacuous (spot-checked this cycle)

- `i18n-key-parity.test.ts` — imports the real `messages/{en,ko}.json`, `flattenKeys()` recurses to leaf scalars with dot-joined paths, asserts `missingInKo`/`missingInEn` both `[]`. KEYS-only (honors DOC-R5C3-07). Would catch a real dropped key. NON-VACUOUS.
- `image-queue-delete-race-cleanup-wiring.test.ts` — source-shape pin: matches the 3-arg `deleteImageVariants(dir, fn, [])` form and `not.toMatch` the 2-arg form. Consistent with the established blur-wiring call-site pin pattern. NON-VACUOUS for its (intentionally narrow) source-shape scope.
- `backfill-color-pipeline-deleted-mid-reencode.test.ts` — drives `affectedRows:0`, asserts cleanup for all 3 formats with `[]` sizes + the `deletedMidReencode` tally. Critic proved RED-on-guard-removal. NON-VACUOUS.

## Flaky-test posture (re-confirmed, no NEW flake)

The four real-encode AVIF/WebP tests in `strip-gps-from-original.test.ts` + the documented `backfill-color-pipeline` / `process-image-color-roundtrip` libheif cold-flake remain the only real-Sharp/real-libheif surface. None reproduced this cycle. The cold-flake isolation (separate `public/uploads` per test) remains prior-deferred (AGG-C4-T2 / AGG-R8c3-09) — UNCHANGED, not re-escalated.

---

## NET-NEW TEST FINDINGS THIS CYCLE: 2 (TE-C6-1 MED, TE-C6-2 LOW)

TE-C6-1 is the highest-value item: it is the missing test that would have caught DBG-C6-01 and is the reason a real lossless-contract bug shipped green. Schedule alongside the DBG-C6-01 source fix (the bug fix and its proven-RED test should land together).

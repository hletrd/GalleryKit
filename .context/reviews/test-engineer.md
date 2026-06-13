# Test-Engineer Review — Cycle 7 (run-9 follow-on)

HEAD `d0920957` (clean tree). Angle: test coverage gaps, vacuous/tautological tests, flaky tests, missing negative tests, test-isolation problems, security-invariant pins. Focus on RECENTLY-CHANGED production code.

## Verdict

**Coverage on the recently-changed surfaces is strong and the new tests are genuinely non-vacuous.** I verified the two new GPS pure-scrubber tests would go RED on a regression (proof below), confirmed the touch-target and OG-query pins are real, and ran the GPS suite green (26/26). I found **one real, valuable coverage gap** (WebP XMP-chunk branch on just-fixed privacy-critical code) plus one record-only isolation item that has NOT regressed. No vacuous or flaky tests introduced this cycle.

---

## Confirmations (prior-cycle items — verified CLOSED / non-vacuous)

### CONFIRM-1 — New WebP pure-scrubber test is NON-VACUOUS (TE-C6-1 / AGG-C6-02 stays FIXED). Confidence: High.
`strip-gps-from-original.test.ts:211-239` (`stripGpsFromWebpBuffer losslessly removes GPS … VP8 pixel chunk byte-identical`) asserts:
- `result!.stripped === true` (line 221) — RED on the field-order regression (scrubber returned `null` before reaching any EXIF compare, see commit `b6c4f915`).
- VP8 compressed-pixel-chunk byte-identity via the local `webpPixelChunk()` walker (lines 228-230) — this is the LOSSLESS-contract assertion the old dispatcher test could not make (it compared decoded pixels, which a q95→q95 re-encode of an already-q95 decode leaves identical). Mechanism verified: a re-encode fallback would change the compressed VP8 bytes; an in-place RIFF scrub does not.
- GPS entries → 0 via exif-reader on the scrubbed buffer (lines 233-238).
Reverting the tag/size field-order fix in `gps-exif-strip.ts:566-567` flips this test RED (commit `b6c4f915` documents 2 failed | 22 passed). **Genuinely non-vacuous.**

### CONFIRM-2 — New ISOBMFF pure-scrubber test is NON-VACUOUS (TE-C6-2 stays FIXED). Confidence: High.
`strip-gps-from-original.test.ts:262-276` (`stripGpsFromIsobmffBuffer losslessly removes GPS … file length unchanged`) asserts:
- `result!.stripped === true` (line 269) — RED if the walker regresses to `null`.
- `result!.buffer.length === input.length` (line 271) — the in-place `buf.fill(0, …)` scrub (`gps-exif-strip.ts:539`, 533) preserves length, whereas the tier-2 AVIF fallback (`process-image.ts:1573`, q90 re-encode) would change it. This proves the byte-zeroing path ran, not a re-encode — strictly stronger than the dispatcher-level pixel check.
- GPS gone via exif-reader on the round-tripped file (line 275). **Genuinely non-vacuous.**

### CONFIRM-3 — Touch-target back-nav pins are real and scoped. Confidence: High.
- `touch-target-audit.test.ts:1102-1126` (AGG-C6-03) anchor-scans `s/[key]/page.tsx` for `viewGallery` and `year/[year]/page.tsx` for `backToTimeline`, requiring `min-h-11` on the enclosing `<Link>`. Production matches: `s/[key]/page.tsx:105` and `year/[year]/page.tsx:109` both carry `min-h-11`. Commit `1a483f9b` documents proven RED-on-revert (14/14).
- AGG-C5-03 (commit `e7d19f4b`) pins `home-client.tsx`, `topic-empty-state.tsx`, `timeline/page.tsx` inline recovery `<Link>`s — all three production files carry `inline-flex items-center min-h-11 px-2`. Pinned.
- The `(?<!max-)` lookbehind fix (`touch-target-audit.test.ts:440,444,458,462`, commit `26f68430`) for `<Link>`/`<a>` has 4 negative self-check fixtures (max-h-10 / max-h-9 must NOT flag). Non-vacuous.

### CONFIRM-4 — OG-query perf change is pinned. Confidence: High.
`getLatestImageForOg` (added commit `e9040d17`) is pinned by `data-tag-names-sql.test.ts:130` (`getLatestImageForOg is a minimal id+title query with NO tag JOIN / GROUP_CONCAT`). The `tagNamesAgg` masonry-listing contract remains separately pinned by the same file. Good.

### CONFIRM-5 — NCLX code-2 isHdr side-effect is pinned. Confidence: High.
`color-detection.test.ts` (`nclx code-2 transfer + PQ-named ICC → isHdr true`, added commit `22387f32`) asserts `transferFunction==='pq'` and `isHdr===true` — pins that an Unspecified (code 2) NCLX transfer does not erase the ICC-name-derived PQ→HDR. The broader code-2 → 'unknown' mapping has dense coverage (`color-detection.test.ts:40-55`). color-detection coverage is thorough.

---

## Findings

### TE-C7-1 — WebP XMP-chunk (JUNK-retag) GPS branch has ZERO test coverage. Severity: Medium. Confidence: High.

**Production (untested branch):** `apps/web/src/lib/gps-exif-strip.ts:579-588` — the `chunkTag === 'XMP '` branch of `stripGpsFromWebpBuffer`, which retags a GPS-bearing XMP RIFF chunk's FourCC to `JUNK` (`buf.write('JUNK', offset, 4, 'ascii')`) and zeroes its payload (`buf.fill(0, dataStart, dataEnd)`).

**Test (absent):** `apps/web/src/__tests__/strip-gps-from-original.test.ts` — all 9 `stripGpsFromWebpBuffer` references (lines 211, 219, 241, 244, 250, 253, 483) exercise ONLY the `EXIF` chunk path (TIFF GPS IFD) or non-WebP/garbage rejection. The thorough XMP coverage in this file (standard XMP APP1, ExtendedXMP, split-token reconstruction) is **JPEG-only** (`stripGpsFromJpegBuffer`). No test ever feeds a WebP carrying GPS in an `XMP ` RIFF chunk.

**Why this is a real (not theoretical) gap:** WebP files carrying GPS in an XMP chunk rather than (or in addition to) EXIF are a real upload shape — iOS / Lightroom / Photoshop WebP exports routinely place XMP location data, and some pipelines write XMP-only. I verified the branch is reachable and currently CORRECT via a throwaway vitest probe (now deleted): hand-assembling a WebP with a GPS-bearing `XMP ` chunk and calling `stripGpsFromWebpBuffer` returned `{stripped:true}`, retagged the FourCC to `JUNK`, and removed the `GPSLatitude` token. So the branch works today — it is simply unpinned.

**The regression that would slip through:** this branch is the *exact same class of code* that was just found broken in the EXIF path — AGG-C6-01 (commit `b6c4f915`) was a RIFF tag/size field-order inversion (`offset` vs `offset+4`). The JUNK retag writes to `offset` (the tag field) and the payload zero spans `dataStart..dataEnd`. If a future edit mis-targets the write offset (e.g. writes `JUNK` at the size field — mirroring the original EXIF-path bug) or zeroes the wrong span, GPS-bearing XMP would survive in the ORIGINAL streamed by the paid-download route while the function still reports `stripped:true` — a silent privacy leak with no test to catch it. The EXIF path now carries a byte-identity guard precisely because this failure mode was demonstrated; the symmetric XMP path is unguarded.

**Proposed test (non-vacuous) — add to the `gps-exif-strip pure scrubbers` describe (reuses the existing local `webpPixelChunk()` helper at line 198):**
```ts
it('stripGpsFromWebpBuffer drops a GPS-bearing XMP RIFF chunk (JUNK retag, VP8 pixels byte-identical)', async () => {
    const file = await makeFixture('xmp-gps.webp', 'webp', false); // GPS-free base
    const webp = await fs.readFile(file);
    const xml = Buffer.from('<x:xmpmeta><rdf:Description exif:GPSLatitude="37,33N"/></x:xmpmeta>\0', 'latin1');
    const chunk = Buffer.alloc(8 + xml.length + (xml.length % 2));
    chunk.write('XMP ', 0, 4, 'ascii');
    chunk.writeUInt32LE(xml.length, 4);
    xml.copy(chunk, 8);
    const withXmp = Buffer.concat([webp.subarray(0, 12), chunk, webp.subarray(12)]);
    withXmp.writeUInt32LE(withXmp.length - 8, 4); // fix RIFF size

    const pixelsBefore = webpPixelChunk(withXmp);
    const result = stripGpsFromWebpBuffer(withXmp);
    expect(result).not.toBeNull();
    expect(result!.stripped).toBe(true);                                                  // RED if branch no-ops
    expect(result!.buffer.includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false);    // GPS actually gone
    expect(result!.buffer.includes(Buffer.from('XMP ', 'ascii'))).toBe(false);            // FourCC retagged away
    const pixelsAfter = webpPixelChunk(result!.buffer);
    expect(pixelsAfter!.equals(pixelsBefore!)).toBe(true);                                 // lossless: VP8 untouched
});

it('stripGpsFromWebpBuffer leaves a GPS-free XMP WebP chunk byte-identical (stripped=false)', async () => {
    const file = await makeFixture('xmp-clean.webp', 'webp', false);
    const webp = await fs.readFile(file);
    const xml = Buffer.from('<x:xmpmeta><rdf:Description xmp:Rating="5"/></x:xmpmeta>\0', 'latin1');
    const chunk = Buffer.alloc(8 + xml.length + (xml.length % 2));
    chunk.write('XMP ', 0, 4, 'ascii'); chunk.writeUInt32LE(xml.length, 4); xml.copy(chunk, 8);
    const withXmp = Buffer.concat([webp.subarray(0, 12), chunk, webp.subarray(12)]);
    withXmp.writeUInt32LE(withXmp.length - 8, 4);
    const result = stripGpsFromWebpBuffer(withXmp);
    expect(result).not.toBeNull();
    expect(result!.stripped).toBe(false);                                                 // no GPS marker → no rewrite
    expect(result!.buffer.includes(Buffer.from('XMP ', 'ascii'))).toBe(true);             // clean XMP preserved
});
```
The first asserts the LOSSLESS contract (VP8 byte-identity — RED on a wrong-offset zero that clobbers pixels) AND that GPS is removed. The second pins the negative branch (clean XMP not destroyed). The JPEG path already has both polarities (`:287`, `:382`); WebP has neither. Note: `makeFixture('…','webp', false)` uses Sharp, which does not emit an XMP chunk, so the GPS-bearing XMP chunk is hand-assembled — the fixture is deterministic and offline.

---

## Record-only (verified, NOT re-escalated)

### REC-1 — Real-encode tests share `public/uploads` output, no per-test mkdtemp output isolation (AGG-C4-T2). Status: NOT regressed, NOT reproduced as a new failure.
`process-image-color-roundtrip.test.ts:31-44` mkdtemps the *input* dir but writes derivatives into the shared `UPLOAD_DIR_AVIF`/`WEBP`/`JPEG` (= `public/uploads/`) keyed by per-test `id`, with `afterEach` `fs.unlink` cleanup. The other real-encode suites (`force-srgb-derivatives`, `image-queue*`, `process-image-orientation`, the 6 `admin-backfill-runner-*`, the 3 `backfill-*`) follow the same shared-output / unique-id pattern. Collision-safety rests on `id` uniqueness across files rather than output-dir isolation, and the libheif cold-probe flake on the AVIF tests is unchanged. This is the documented record-only item from cycle 4; **it has not regressed** (GPS suite + spot checks ran clean). No action proposed this cycle.

---

## Items checked and found SOLID (no gap)

- **gps-exif-strip.ts JPEG path** — exhaustive: APP1 EXIF GPS IFD, standard XMP, ExtendedXMP overflow, split-token reconstruction, post-EOI trailer (MPF/Motion Photo) re-encode bail, padding tolerance, forensic byte-residue. `strip-gps-from-original.test.ts:287-502`. No gap.
- **gps-exif-strip.ts TIFF path** — `stripGpsFromTiffBuffer` covered with a real EXIF TIFF block (`:461-477`) + garbage rejection (`:479-484`). No gap.
- **stripGpsFromOriginal dispatcher** — JPEG / AVIF / WebP / TIFF / PNG tiers + Tier-2 fallback + best-effort no-throw all covered (`:78-172`). No gap.
- **Privacy field omission guard** — `privacy-fields.test.ts:83` (`admin-only keys form exactly the SENSITIVE_KEYS contract (symmetric privacy guard)`) is bidirectional: a new admin-only column drifting into `publicSelectFields` fails. `SENSITIVE_KEYS` includes all 11 documented admin-only color/HDR/PII columns. Strong.
- **color-detection NCLX** — dense per-code coverage (codes 2/4/5/7/8/14/15/16/17/18, isHdr polarity, ICC-name interaction). No gap on the recent fixes.
- **data.ts tagNamesAgg + getLatestImageForOg** — both SQL shapes pinned by `data-tag-names-sql.test.ts`. No gap.
- **Touch-target audit** — `(?<!max-)` lookbehind now consistent across Button/button/select/Link/a with negative self-checks; recent bare-link additions positively pinned. No gap.

---

## Summary table

| id | severity | confidence | one-line | production:line | test:line |
|----|----------|-----------|----------|-----------------|-----------|
| TE-C7-1 | Medium | High | WebP XMP-chunk JUNK-retag GPS branch has no test (symmetric to the just-fixed EXIF-path field-order bug class) | gps-exif-strip.ts:579-588 | strip-gps-from-original.test.ts (absent; WebP XMP coverage is JPEG-only) |
| REC-1 (record-only) | Low | High | real-encode suites share public/uploads, no mkdtemp output isolation — unchanged, not regressed | process-image-color-roundtrip.test.ts:31-44 | (n/a) |

One actionable Medium gap on recently-fixed privacy-critical code. Everything else on the changed surface is well-pinned and the new tests are provably non-vacuous.

# Run-4 Cycle 8 — test-engineer angle

Baseline on the clean tree: vitest **1701/1701 PASS** (177 files),
typecheck PASS. Inventory: test inventory diff against the cycle's
findings; reads of process-image-exif-strip.test.ts,
histogram.test.ts coverage shape, the c7 method-contract /
interstitial suites, e2e specs list.

## TEST-R4C8-10 — coverage gaps behind this cycle's findings (gap / High)

1. **`stripGpsFromOriginal` has zero behavioral coverage.**
   `src/__tests__/process-image-exif-strip.test.ts` asserts EXIF
   stripping on AVIF/WebP/JPEG **derivatives** (CM-HIGH-2) — never on
   the ORIGINAL file the function rewrites. That is exactly why
   COR-R4C8-01 (GPS retained by `withMetadata`) survived 28 review
   rounds: the only "strip" tests pass for an unrelated reason
   (derivative encoders strip by default). Required: fixture-based
   tests that write a GPS-tagged JPEG/PNG via sharp `withExif`, run the
   real `stripGpsFromOriginal`, and assert (a) exif-reader finds no GPS
   IFD values, (b) for the JPEG lossless path the decoded pixel buffer
   is byte-identical, (c) ICC survives, (d) failure path leaves the
   original untouched.
2. **AVIF probe constant validity is untested.** Nothing decodes
   `AVIF_PROBE_DATA_URL`; a garbage constant shipped silently
   (COR-R4C8-02). Required: a unit test that extracts the literal from
   histogram.tsx (fixture-style, matching the repo's source-contract
   convention) and round-trips the base64 through `sharp(...)
   .metadata()` asserting `format === 'heif'/'avif'` + decode succeeds
   (`.raw().toBuffer()`).
3. **Preload single-fetch contract untested.** No test pins "no
   neighbor preload links from the page" / "client effect emits at most
   one format per neighbor" (PERF-R4C8-03). Source-contract tests are
   sufficient (the live multi-fetch behavior is browser-dependent).
4. **Picture-fallback contract untested.** R21-M1/R22-M1 fallback was
   asserted only by comments. After the COR-R4C8-05 fix, add a
   source-contract test pinning the state-driven source-removal shape
   in lightbox.tsx + photo-viewer.tsx.
5. **Histogram draw-effect deps.** Add a fixture-style test asserting
   the draw effect's dependency array includes `canvasDims`
   (COR-R4C8-04) — cheap regression pin matching the repo's
   wiring-test convention.
6. **AVIF 8-bit retry options.** After COR-R4C8-06, pin
   `bitdepth: 8` in the retry's `.avif(...)` options via source
   contract (the probe-true-encode-fail path is not reachable on
   prebuilt sharp, so behavioral coverage is impractical).

## Test-quality observations (no action required)
- The c7 suites (download-route-method-contract, download-interstitial,
  smart-collections agreement property, upload-dropzone-topic-wiring)
  are well-shaped: contract pins on exactly the load-bearing structure.
- e2e specs remain role/name-selector based; no sleeps; no flake
  pattern reappeared since the c7 sweep.
- Reminder from repo convention: new tests must run under
  `npm test --workspace=apps/web` (vitest) without network access;
  sharp is available in the unit-test environment (existing
  process-image tests already encode fixtures at runtime).

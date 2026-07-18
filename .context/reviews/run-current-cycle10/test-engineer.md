# Cycle 10 Test Engineer Review

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e3`  
Lane: test-engineer

## Test inventory

Inventoried 363 Vitest files and the Playwright surface, then traced the Cycle 9 additions into their fixtures and production implementations. Ran the three directly affected unit suites: 28/28 passed. The prior Cycle 9 ledger records the full suite at 3,444 passed / 4 expected skips and Playwright at 63 passed / 2 expected configuration skips; those historical logs were not treated as new execution evidence.

## TEST-C10-01 — New high-DPR regression asserts a misleading filename, not image resolution

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test-design defect exposing a confirmed product defect**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:102-138`; `apps/web/scripts/seed-e2e.ts:79-87`; `apps/web/src/lib/process-image.ts:1214-1234`; `apps/web/src/__tests__/image-url.test.ts:110-136`; `apps/web/src/__tests__/public-grid-srcset-contract.test.ts:11-28`.

The E2E test passes when `currentSrc` matches `_4096`, while the fixture is only 1200 px wide. Unit tests lock string suffixes, and the source-contract test locks three helper call sites, but none checks the generated asset's real width. Metadata inspection of all 18 square derivatives showed:

- `_640`: actual 640×640;
- `_1536`, `_2048`, `_4096`, `_5120`, `_7680`: actual 1200×1200 in AVIF, WebP, and JPEG.

Concrete failure: a mutation that keeps false width descriptors but produces no pixel above 1200 leaves every new Cycle 9 test green. The browser chooses a supposedly adequate 4096w resource and upscales it.

Fix: add a behavior test for a helper that receives actual/source width and returns unique `(filename, actualWidth)` candidates. In Playwright, fetch `currentSrc`, decode with `createImageBitmap`, and assert its actual width; also assert that the `srcset` contains no duplicate descriptors and none exceeds the actual asset width. Include originals smaller than the first configured size, between two sizes (the 1200 fixture), larger than all sizes, and a processing-cap-downscaled wide-gamut case.

## Additional observations

The config-cache test is deterministic and correctly owns deferred promises; no flakiness or missing rejection-path issue was confirmed. Source-string contracts remain useful wiring guards but should not be the only proof of browser behavior. Final absence sweep covered timers, fixed ports, fixture order, external network reliance, false-positive scanners, and custom size edge cases; no additional fresh failure survived.

# Plan 245 — Cycle 1 Fresh Review Implementation Fixes
Status: in-progress

## Source Reviews
- Aggregate: `.context/reviews/_aggregate.md` (Cycle 1 Fresh Review, 2026-04-27)
- Per-agent provenance: `.context/reviews/{code-reviewer,perf-reviewer,security-reviewer,critic,verifier,test-engineer,tracer,architect,debugger,document-specialist,designer}.md`

## Repo Rules Read Before Planning
- `CLAUDE.md` — Next.js 16 / React 19 / TypeScript 6 baseline, local-only storage, single web-instance/single-writer topology, security lint gates.
- `AGENTS.md` — always commit/push changes, use gitmoji, keep diffs small/reviewable/reversible, no new dependencies without explicit request.
- Existing `plan/plan-242-cycle8-rpf-deferred.md` — prior deferrals reviewed to avoid duplication.

## Disposition Map

| Finding | Severity / Confidence | Disposition |
|---|---:|---|
| C1-F01 | MEDIUM / MEDIUM | Scheduled P245-01 |
| C1-F05 | LOW / HIGH | Scheduled P245-02 |
| C1-F06 | LOW / HIGH | Scheduled P245-03 |
| C1-F08 | LOW / HIGH | Scheduled P245-04 |
| C1-F10 | LOW / MEDIUM | Scheduled P245-05 |
| C1-F11 | LOW / MEDIUM | Scheduled P245-06 |
| C1-F12 | LOW / HIGH | Scheduled P245-07 |
| C1-TG01 | MEDIUM / HIGH | Scheduled P245-08 |
| C1-F22 | INFO / HIGH | Scheduled P245-09 |
| C1-F02 | MEDIUM / HIGH | Deferred — accepted Tailwind/Radix trade-off |
| C1-F03 | MEDIUM / HIGH | Deferred — architectural refactoring, too broad |
| C1-F04 | MEDIUM / HIGH | Deferred — operational config, code already warns |
| C1-F07 | LOW / MEDIUM | Already deferred as D-C8RPF-07 |
| C1-F09 | LOW / MEDIUM | Deferred — admin-only, low priority |
| C1-F13 | LOW / LOW | Deferred — theoretical timezone concern |
| C1-F14 | LOW / HIGH | Deferred — compile-time guard is sufficient |
| C1-F15 | LOW / MEDIUM | Deferred — code style, low priority |
| C1-F16 | LOW / MEDIUM | Deferred — architectural, needs design |
| C1-F17 | LOW / MEDIUM | Deferred — cosmetic UX improvement |
| C1-F18 | LOW / HIGH | Already deferred as D-C8RPF-10 |
| C1-F19 | LOW / MEDIUM | Deferred — performance, not a bug |
| C1-F20 | INFO / HIGH | Deferred — doc improvement |
| C1-F21 | INFO / MEDIUM | Deferred — doc verification |
| C1-TG02 | LOW / MEDIUM | Deferred — test gap, low priority |
| C1-TG03 | LOW / MEDIUM | Deferred — test gap, low priority |
| C1-TG04 | LOW / MEDIUM | Deferred — test gap, low priority |

---

## P245-01: Replace 2048x2048 dimension fallback with error in `saveOriginalAndGetMetadata`
**Finding:** C1-F01 (CR, TE)
**File:** `apps/web/src/lib/process-image.ts:276-277`

When Sharp cannot determine image dimensions, the function falls back to 2048x2048. This stores misleading dimensions that produce incorrect aspect ratios in the masonry grid and photo viewer.

**Implementation:**
- Remove the fallback values and throw an error when `metadata.width` or `metadata.height` is missing/invalid
- Add a descriptive error message: "Image dimensions could not be determined — the file may be corrupt or in an unsupported format"
- The caller (`uploadImages`) already handles this error via its per-file try/catch, which logs and adds the file to `failedFiles`

**Verification:**
- Test that a corrupt image (no dimensions) is rejected during upload
- Test that valid images still pass through correctly

---

## P245-02: Fix indentation in `uploadImages` try/finally block
**Finding:** C1-F05 (CR)
**File:** `apps/web/src/app/actions/images.ts:178-431`

The try body inside `uploadImages` is indented one extra level. Re-indent to match the function's indentation.

**Implementation:**
- Re-indent the try block body from 8-space to 4-space relative indentation
- No logic changes

---

## P245-03: Pass `undefined` instead of `[]` to `deleteImageVariants` for "scan all" intent
**Finding:** C1-F06 (CR)
**File:** `apps/web/src/app/actions/images.ts:503-505,614-617`

Replace `deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp, [])` with `deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp)` (using default parameter `undefined`) to make the "scan all variants" intent explicit.

**Implementation:**
- Change 4 calls in `deleteImage()` and `deleteImages()` from passing `[]` to omitting the argument
- The default value in `deleteImageVariants` is already `DEFAULT_OUTPUT_SIZES`, but the `if (!sizes || sizes.length === 0)` check correctly handles `undefined`

Wait — on re-reading, the default is `sizes: number[] = DEFAULT_OUTPUT_SIZES`, so omitting the argument would pass the current configured sizes. The `[]` is specifically used to trigger the directory scan path. The intent is to scan for ALL variants (including those from prior size configs), not to delete only current-size variants. So passing `undefined` won't work because the default would kick in.

**Revised implementation:**
- Add a named constant `SCAN_ALL_VARIANTS: number[] = [] as unknown as number[]` in `process-image.ts` (or just document the `[]` convention with a comment)
- Actually, the simplest fix is to add an inline comment explaining the `[]` convention at each call site

---

## P245-04: Make GA domains conditional in CSP
**Finding:** C1-F08 (CR)
**File:** `apps/web/src/lib/content-security-policy.ts:58-59`

Make Google Analytics CSP domains conditional on `NEXT_PUBLIC_GA_ID` environment variable.

**Implementation:**
- In `buildContentSecurityPolicy`, check for `process.env.NEXT_PUBLIC_GA_ID`
- Only include `https://www.googletagmanager.com` in `script-src` when GA is configured
- Only include `https://www.google-analytics.com` in `connect-src` when GA is configured
- This also reduces the CSP attack surface for deployments that don't use GA

---

## P245-05: Document atomic rename fallback chain in `processImageFormats`
**Finding:** C1-F10 (CT, DB)
**File:** `apps/web/src/lib/process-image.ts:437-452`

Add a comment documenting the 3-level fallback chain and the trade-off of the final `copyFile` fallback (which re-introduces the non-atomic window the rename was designed to avoid).

**Implementation:**
- Add a doc comment above the fallback chain explaining each level and the trade-off

---

## P245-06: Document FIFO vs LRU eviction in `pruneRetryMaps`
**Finding:** C1-F11 (CT)
**File:** `apps/web/src/lib/image-queue.ts:74-85`

Add a comment explaining that the eviction is FIFO (insertion-order), not LRU, and why this is acceptable for a single-writer topology with bounded maps.

**Implementation:**
- Add a comment above `pruneRetryMaps` explaining the eviction strategy

---

## P245-07: Harmonize listing query limit caps
**Finding:** C1-F12 (VR)
**File:** `apps/web/src/lib/data.ts:376-377,462,486`

`getImagesLite` caps at 101, `getImages` caps at 100, `getAdminImagesLite` caps at 100. Extract a shared constant for the listing query limit cap.

**Implementation:**
- Add `const LISTING_QUERY_LIMIT = 100;` and `const LISTING_QUERY_LIMIT_PLUS_ONE = 101;` (for has-more detection)
- Use these constants in `getImagesLite`, `getImages`, and `getAdminImagesLite`
- `getImagesLite` uses 101 for has-more detection (fetch limit+1, slice to limit), so use the appropriate constant

---

## P245-08: Add test for dimension fallback behavior
**Finding:** C1-TG01 (TE)
**File:** `apps/web/src/__tests__/process-image.test.ts` (new or existing)

Add a test that verifies `saveOriginalAndGetMetadata` rejects images with invalid/missing dimensions.

**Implementation:**
- Mock Sharp to return metadata with width=0 or width=undefined
- Verify the function throws an error
- Verify valid images still pass through

Note: This depends on P245-01 (replacing fallback with error). If P245-01 is implemented, this test validates the new behavior. If P245-01 is deferred, this test documents the current fallback behavior.

---

## P245-09: Commit uncommitted i18n changes
**Finding:** C1-F22 (CT)
**File:** `apps/web/messages/en.json`, `apps/web/messages/ko.json`

The uncommitted changes in `en.json` and `ko.json` are cosmetic phrasing simplifications. Commit them.

**Implementation:**
- Stage both files
- Commit with semantic message: `docs(i18n): simplify admin/upload/settings phrasing`

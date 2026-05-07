# Aggregate Review — Cycle 5 (2026-04-19)

**Source reviews:** cycle5-comprehensive-review (fresh multi-angle deep review)

## Summary

Cycle 5 deep review of the full codebase found **3 new findings** (1 MEDIUM, 2 LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase remains in strong shape after 37 prior cycles of fixes.

All previously reported findings from cycles 1-4 were verified as already resolved or properly deferred.

## Findings

| ID | Description | Severity | Confidence | File |
|----|------------|----------|------------|------|
| C5-F01 | `getImageByShareKey` uses `selectFields` without explicit GPS privacy guard | MEDIUM | HIGH | `apps/web/src/lib/data.ts:383-384` |
| C5-F02 | `home-client.tsx` uses file-level `eslint-disable` when only specific `<img>` tags need it | LOW | HIGH | `apps/web/src/components/home-client.tsx:1` |
| C5-F03 | `processImageFormats` verifies only WebP output — AVIF/JPEG not verified | LOW | MEDIUM | `apps/web/src/lib/process-image.ts:400-407` |

### C5-F01: GPS privacy enforcement gap in public shared-photo query (MEDIUM)

`getImageByShareKey()` uses `{...selectFields}` for its query. `selectFields` intentionally omits `latitude` and `longitude`. However, this is an implicit omission with no comment, guard, or separate field set. If someone adds those fields to `selectFields`, the public `/s/[key]` route would leak GPS data.

**Fix:** Add an explicit comment or create a `publicSelectFields` that documents the privacy constraint.

### C5-F02: Overly broad eslint-disable in home-client.tsx (LOW)

File-level `/* eslint-disable @next/next/no-img-element */` when only specific `<img>` tags inside `<picture>` need the exemption. Should use `eslint-disable-next-line` like `upload-dropzone.tsx` does.

**Fix:** Replace file-level disable with per-element `eslint-disable-next-line`.

### C5-F03: processImageFormats verification gap (LOW)

Only WebP output is verified after generation. The queue separately verifies all three formats, but if `processImageFormats` is called outside the queue, AVIF/JPEG failures go undetected.

**Fix:** Verify all three format base files, or add comment noting queue handles verification.

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02: Admin checkboxes use native `<input>` (no Checkbox component)
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)

## AGENT FAILURES

None — single reviewer completed successfully.

## TOTALS

- **1 MEDIUM** finding requiring implementation
- **2 LOW** findings recommended for implementation
- **0 CRITICAL/HIGH** findings
- **3 total** unique findings

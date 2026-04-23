# Aggregate Review — Cycle 6 (2026-04-19)

**Source reviews:** cycle6-code-quality-review, cycle6-security-review, cycle6-performance-review, cycle6-architect-review, cycle6-ui-ux-review, cycle6-test-engineer-review, cycle6-debugger-review, cycle6-critic-review, cycle6-verifier-review, cycle6-document-review, cycle6-tracer-review

## Summary

Cycle 6 deep multi-agent review of the full codebase found **4 new findings** (1 MEDIUM, 3 LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase remains in strong shape after 37 prior cycles of fixes.

All previously reported MEDIUM findings from the earlier cycle 6 run (C6-03 upload TOCTOU, C6-07 session transaction, C6-09 CSV streaming) are verified as already resolved in the current codebase.

## Findings

| ID | Description | Severity | Confidence | File | Reviewers |
|----|------------|----------|------------|------|-----------|
| C6-F01 | `selectFields` privacy guard is implicit — no type constraint prevents adding GPS fields | MEDIUM | HIGH | `apps/web/src/lib/data.ts:67-101` | code-quality, security |
| C6-F02 | `home-client.tsx` file-level eslint-disable when per-element disable exists (carry-forward from C5-F02) | LOW | HIGH | `apps/web/src/components/home-client.tsx:1` | code-quality |
| C6-F03 | No integration/E2E tests for the upload-to-processing pipeline | LOW | HIGH | `apps/web/src/__tests__/`, `apps/web/e2e/` | test-engineer |
| C6-F04 | `image-manager.tsx` native checkboxes instead of Checkbox component (carry-forward from C4-F02) | LOW | HIGH | `apps/web/src/components/image-manager.tsx:282-288, 303-309` | ui-ux |

### C6-F01: Implicit privacy guard on selectFields (MEDIUM)

`selectFields` omits `latitude`, `longitude`, `filename_original`, and `user_filename` but this is purely an implicit omission. If someone adds those fields to `selectFields` for an admin feature, the public `/s/[key]` and `/g/[key]` routes would leak PII. PRIVACY comments exist (added in prior cycles) but they are documentation-only — no type system or runtime enforcement.

**Fix:** Create a `publicSelectFields` derived from `selectFields` using TypeScript `Omit<...>` or a separate constant, and use it in public-facing queries. Alternatively, add a compile-time assertion that `selectFields` never includes sensitive fields.

### C6-F02: File-level eslint-disable in home-client.tsx (LOW)

Carry-forward from C5-F02. The file-level `/* eslint-disable @next/next/no-img-element */` should be removed since line 260 already has `eslint-disable-next-line` for the actual `<img>` inside `<picture>`.

**Fix:** Remove the file-level disable.

### C6-F03: Missing E2E test coverage for critical upload pipeline (LOW)

The codebase has good unit test coverage but no integration/E2E tests for the image upload -> processing -> verification pipeline. This is the most critical user flow in the application.

**Fix:** Add E2E smoke tests for upload and basic admin CRUD. Large effort — recommend incremental addition.

### C6-F04: Native checkboxes in image-manager.tsx (LOW)

Carry-forward from C4-F02. Native `<input type="checkbox">` used instead of shadcn/ui `Checkbox` component, causing visual inconsistency with the design system.

**Fix:** Replace with `Checkbox` component from `@/components/ui/checkbox`. Remains deferred as per C4-F02.

## Cross-Agent Agreement

- **C6-F01** flagged by both code-quality and security reviewers — higher signal
- **C6-F02** same finding as C5-F02 — consistently flagged, should be implemented
- **C6-F03** flagged only by test-engineer — but the gap is real
- **C6-F04** same finding as C4-F02 — properly deferred per existing policy

## Previously Fixed — Confirmed Resolved

All findings from cycles 1-5 and the earlier cycle 6 run are verified as resolved in the current codebase:
- C6-03 (upload tracker TOCTOU): Pre-increment pattern now at images.ts:112-119
- C6-07 (session transaction): Now wrapped in db.transaction at auth.ts:157-169
- C6-09 (CSV streaming): Now uses incremental building with GC release at db-actions.ts:56-86
- C5-F01 (GPS privacy comments): PRIVACY comments now at data.ts:225-227, 380-383, 422-425
- C5-F03 (processImageFormats verification): Now verifies all three formats at process-image.ts:400-413

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
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)

## AGENT FAILURES

None — all 11 review agents completed successfully.

## TOTALS

- **1 MEDIUM** finding requiring implementation
- **3 LOW** findings recommended for implementation
- **0 CRITICAL/HIGH** findings
- **4 total** unique findings

# Plan 312 -- Cycle 3/100 Fresh Review Fixes

**Cycle:** 3/100
**HEAD at plan creation:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`
**Status:** Pending implementation

## Findings to schedule

### MEDIUM Severity

| ID | Finding | Action | File |
|---|---|---|---|
| C3-F01 | `exportImagesCsv` materializes entire CSV in memory (up to 50K rows, ~15-25MB peak heap) | Fix: add memory-safety comment documenting the current memory profile, and add a row-count warning at a lower threshold. Streaming response would require API route refactor which is out of scope for this cycle. | `app/[locale]/admin/db-actions.ts:51-99` |

### LOW Severity

| ID | Finding | Action | File |
|---|---|---|---|
| C3-F02 | `deleteImageVariants` with `sizes=[]` triggers full directory scan on every delete | Fix: add a comment documenting the intent of `sizes=[]` (scan for leftover variants from prior configs). A per-directory cleanup flag would be a larger refactor -- defer. | `lib/process-image.ts:186-203` |
| C3-F03 | `getImage` next-image query `sql\`FALSE\`` literal lacks prominent comment | Fix: add a prominent comment explaining the FALSE literal and the NULLs-sort-last-in-DESC invariant | `lib/data.ts:574-600` |
| C3-F04 | Rate-limit eviction boilerplate duplicated across 7 Maps | Defer: refactoring 7 rate-limit Maps into a shared `BoundedMap` abstraction is a significant refactor that touches multiple action files. The current code is correct and the duplication is a maintenance risk, not a bug. | Multiple files |
| C3-F05 | `getImages` and `getImagesLite` near-identical query shapes | Defer: merging into a shared base query builder is a refactor that risks introducing regressions. The current `tagNamesAgg` shared constant and `buildImageConditions` helper already prevent the most dangerous form of drift. | `lib/data.ts:375-505` |
| C3-F06 | `UNICODE_FORMAT_CHARS` regex literal duplicated between `validation.ts` and `csv-escape.ts` | Fix: `csv-escape.ts` should import `UNICODE_FORMAT_CHARS` from `validation.ts` instead of duplicating the regex literal. Add U+XXXX notation comment to the regex definition. | `lib/validation.ts:35`, `lib/csv-escape.ts:43` |
| C3-F07 | `NEXT_LOCALE` cookie set via `document.cookie` is visible to page JS | Defer: acceptable for a non-security-sensitive locale preference. The cookie is not used for auth or authorization. | `components/nav-client.tsx:66` |

### Test Gaps to address

| ID | Finding | Action | File |
|---|---|---|---|
| C3-TG01 | No test for `deleteImageVariants` with `sizes=[]` (directory scan fallback) | Add test: create temp directory with known variant filenames, verify scan correctly identifies and deletes all matching variants | `__tests__/process-image.test.ts` (new or existing) |
| C3-TG02 | No test for `exportImagesCsv` at moderate scale | Defer: requires DB mocking or integration test setup. The function's logic is straightforward (select + escape + join) and is covered by the `escapeCsvField` unit tests. | `app/[locale]/admin/db-actions.ts:51-99` |
| C3-TG03 | No test for `loadMoreRateLimit` | Add test: verify pre-increment + rollback pattern for load-more rate limit, matching parity with existing `searchRateLimit` and `ogRateLimit` tests | `__tests__/load-more-rate-limit.test.ts` (new) |

### INFO findings (document only, no code changes)

| ID | Finding | Action |
|---|---|---|
| C3-F08 | `--one-database` flag limitation | Document only -- defense-in-depth chain is sufficient |
| C3-F09 | `process.exit(0)` after partial view-count flush | Document only -- best-effort per CLAUDE.md |
| C3-F10 | `createGroupShareLink` affectedRows check is defense-in-depth | No action needed |
| C3-F11 | `escapeCsvField` C0 control character class lacks comment | Fix: add comment listing excluded codepoints (LF=0x0A, CR=0x0D) |
| C3-F12 | Advisory-lock naming no instance identifier | Document only -- already documented in CLAUDE.md |

## Implementation plan

### Step 1: Fix C3-F06 -- deduplicate UNICODE_FORMAT_CHARS regex

In `csv-escape.ts`, replace the inline regex with an import from `validation.ts`:
```ts
// Before (csv-escape.ts line 43):
value = value.replace(/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/g, '');

// After:
import { UNICODE_FORMAT_CHARS } from '@/lib/validation';
value = value.replace(UNICODE_FORMAT_CHARS, '');
```

In `validation.ts`, add U+XXXX notation comment to the regex:
```ts
// U+180E MVS, U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM, U+202A-202E LRE/RLE/PDF/LRO/RLO,
// U+2060 WJ, U+2066-2069 LRI/RLI/FSI/PDI, U+FEFF BOM, U+FFF9-FFFB interlinear anchors
export const UNICODE_FORMAT_CHARS = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/;
```

### Step 2: Fix C3-F01 -- document exportImagesCsv memory profile

Add a comment above `exportImagesCsv` documenting the memory characteristics:
```ts
/**
 * Memory profile: materializes up to 50K rows as a CSV string (~15-25MB peak heap).
 * The DB results array is released before the final join, but the csvLines array
 * and joined string coexist briefly. For galleries approaching the 50K row cap,
 * consider a streaming API route instead.
 */
```

### Step 3: Fix C3-F02 -- document deleteImageVariants sizes=[] intent

Add a comment in `deleteImageVariants` explaining the `sizes=[]` pattern:
```ts
// When sizes are empty, scan the directory to catch leftover variants from
// prior image-size configs. After the first cleanup pass in a running process,
// subsequent scans are redundant but low-cost for personal-gallery scale.
```

And in `images.ts` where `sizes=[]` is passed:
```ts
// Pass empty sizes [] to scan directory and remove ALL size variants,
// including those from prior image-size configs. This is intentionally
// different from passing the current config sizes, which would only
// delete known variants and leave orphans from older configs.
```
(Wait -- this comment already exists at `images.ts:503-505`. The intent is documented there. The missing documentation is in `process-image.ts` itself where the `sizes=[]` branch is defined.)

### Step 4: Fix C3-F03 -- add prominent comment for sql`FALSE` literal

In `getImage` in `data.ts`, add a prominent comment above the `sql\`FALSE\`` literal:
```ts
// IMPORTANT: sql`FALSE` is correct here because NULLs sort last in DESC order,
// so there are no "older" undated images by capture_date. Only created_at and id
// tiebreakers apply for undated images. Do NOT replace with a NULL-safe comparison
// like `lt(images.capture_date, null)` — that would incorrectly return all undated
// images as "next" images.
```

### Step 5: Fix C3-F11 -- add comment to escapeCsvField C0 char class

In `csv-escape.ts`, add a comment to the C0 control character strip:
```ts
// Strip C0/C1 control characters, preserving LF (0x0A) and CR (0x0D)
// which are collapsed to spaces in the [\r\n]+ pass below.
value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
```

### Step 6: Add test C3-TG01 -- deleteImageVariants with sizes=[] directory scan

Create a test that:
1. Creates a temp directory with variant files matching the `{name}_{size}{ext}` pattern
2. Calls `deleteImageVariants(dir, baseFilename, [])` 
3. Verifies all matching variants are deleted
4. Verifies non-matching files are not deleted

### Step 7: Add test C3-TG03 -- loadMoreRateLimit

Create a test that:
1. Verifies `preIncrementLoadMoreAttempt` increments correctly
2. Verifies rate limit triggers at 120 requests per window
3. Verifies `rollbackLoadMoreAttempt` decrements correctly
4. Verifies prune/eviction behavior

## Findings to defer

| ID | Severity | Reason for deferral | Exit criterion |
|---|---|---|---|
| C3-F04 | LOW | Refactoring 7 rate-limit Maps into a shared BoundedMap abstraction is a significant refactor that touches multiple action files and risks regressions. The current code is correct; the duplication is a maintenance risk, not a bug. | When a new rate-limited endpoint is added, refactor all Maps together |
| C3-F05 | LOW | Merging `getImages`/`getImagesLite` into a shared base query builder risks regressions. The `tagNamesAgg` shared constant already prevents the most dangerous drift. | If the query shapes drift or a new listing variant is added |
| C3-F07 | LOW | `NEXT_LOCALE` cookie is non-security-sensitive (locale preference only). The `document.cookie` approach is standard for client-side locale switching. | If locale becomes security-sensitive or if server-action-based locale switching is implemented |
| C3-F08 | INFO | `--one-database` flag is one layer in a defense-in-depth chain. The SQL scanner provides the primary protection. | If the SQL scanner is removed or weakened |
| C3-F09 | INFO | `process.exit(0)` after partial flush is documented as best-effort. The view-count buffer swap (C2-F01) already minimizes data loss. | If shutdown data loss becomes a concern |
| C3-F10 | INFO | Defense-in-depth check that cannot trigger under normal operation. No action needed. | No action needed |
| C3-F12 | INFO | Already documented in CLAUDE.md advisory-lock scope note. | If multi-tenant co-location is implemented |
| C3-TG02 | Test Gap | Requires DB mocking or integration test infrastructure. The `escapeCsvField` unit tests cover the escaping logic. | If integration test infrastructure is added |

## Repo-rule check

- CLAUDE.md "Git Commit Rules" require GPG-signed conventional + gitmoji commits. Will honor.
- CLAUDE.md "Always commit and push immediately after every iteration": will honor.
- `.context/plans/README.md` deferred rules: all findings either scheduled or deferred with exit criteria.

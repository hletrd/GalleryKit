# Cycle 15 Comprehensive Code Review

**Reviewer:** General-purpose agent (multi-perspective review)
**Date:** 2026-04-30
**Scope:** Full codebase review after 14 prior cycles (~50 commits)

---

## Methodology

Reviewed all TypeScript/TSX source files under `apps/web/src/`, covering:
- Security surface (auth, sessions, rate limits, input validation)
- Data layer (SQL queries, cursor pagination, privacy guards)
- Image processing pipeline (queue, Sharp, file I/O)
- Admin actions (CRUD, sharing, DB backup/restore)
- UI components (lightbox, photo viewer, accessibility)
- Cross-cutting concerns (sanitization, Unicode handling, CSP)

Prior deferred items from plans 336, 374, and earlier were cross-referenced to avoid re-reporting known deferred items.

---

## C15-MED-01: `requireCleanInput` does not reject Unicode formatting characters

- **File+line**: `apps/web/src/lib/sanitize.ts:82-86`
- **Severity**: MEDIUM | **Confidence**: HIGH
- **2 perspectives agree** (security + code quality)

### Problem

`requireCleanInput` calls `stripControlChars` which now removes Unicode bidi/invisible formatting characters (since C7-AGG7R-03 extended `stripControlChars` to include `UNICODE_FORMAT_CHARS_RE`). However, unlike `sanitizeAdminString` which returns `rejected: true` when Unicode formatting is detected (forcing callers to reject), `requireCleanInput` silently strips these characters and returns `rejected: true` only when the stripped output differs from the input.

This means if the only difference between input and output is Unicode formatting characters, `requireCleanInput` correctly sets `rejected: true`. BUT the caller in `tags.ts` (line 63, 153, 218, etc.) and `admin-users.ts` (line 90) and `topics.ts` (lines 88, 178, 190, 326, 388, 398, 454, 463) all check `rejected` and return an error. So the rejection does happen.

However, there is a subtlety: `requireCleanInput` strips C0 controls AND Unicode formatting in one pass via `stripControlChars`. If the input contains ONLY Unicode formatting chars (no C0 controls), the `rejected` flag is `true` because the stripped result differs. This is correct behavior. But `sanitizeAdminString` has a separate early-rejection check for Unicode formatting that returns `null` immediately, while `requireCleanInput` lacks this two-phase check. The practical difference: `sanitizeAdminString` returns `value: null` on rejection (safe), while `requireCleanInput` returns the stripped `value` (non-null) alongside `rejected: true`. A caller that uses `value` without checking `rejected` would persist a visually-identical stripped string.

### Risk

The `tags.ts` and `topics.ts` callers all check `rejected` and return errors, so no current data corruption path exists. However, the contract inconsistency between `requireCleanInput` (returns stripped value + rejected) and `sanitizeAdminString` (returns null + rejected) could lead to a future caller using `value` without checking `rejected`.

### Fix

Add a `rejected: true` early-return for Unicode formatting in `requireCleanInput`, matching `sanitizeAdminString`'s two-phase approach, or add a code comment documenting the contract difference and the reason it's safe (all callers check `rejected`).

---

## C15-MED-02: `getImageByShareKey` tag_slugs GROUP_CONCAT can be misaligned with tag_names

- **File+line**: `apps/web/src/lib/data.ts:887-912`
- **Severity**: MEDIUM | **Confidence**: Medium

### Problem

The `getImageByShareKey` function uses two separate `GROUP_CONCAT` expressions: one for `tag_names` and one for `tag_slugs`. When parsed, `parsedTagNames` and `parsedTagSlugs` are zipped by index position (line 910-912). However, `GROUP_CONCAT(DISTINCT ... ORDER BY ...)` for names and slugs use different ORDER BY clauses (`ORDER BY tags.name` vs `ORDER BY tags.slug`), which means the i-th element of `tag_names` may not correspond to the i-th element of `tag_slugs`.

For example, if a tag has name "Music Festival" and slug "music-festival", and another has name "Concert" and slug "concert":
- `tag_names` ordered by name: "Concert,Music Festival"
- `tag_slugs` ordered by slug: "concert,music-festival"

In this case the alignment happens to work because alphabetical ordering of name and slug often coincide for simple ASCII. But consider a tag with name "Art" and slug "visual-art": name ordering puts "Art" first, but slug ordering puts "visual-art" after most other slugs. This creates a name-slug mismatch.

### Concrete failure scenario

Tag A: name="Zebra", slug="alpha-tag" / Tag B: name="Apple", slug="zeta-tag"
- `tag_names` (ORDER BY name): "Apple,Zebra"
- `tag_slugs` (ORDER BY slug): "alpha-tag,zeta-tag"
- Zip result: [{slug:"alpha-tag", name:"Apple"}, {slug:"zeta-tag", name:"Zebra"}] -- WRONG
  The actual mapping is: name="Zebra" has slug="alpha-tag", name="Apple" has slug="zeta-tag"
  The zip produces: [{slug:"alpha-tag", name:"Apple"}, {slug:"zeta-tag", name:"Zebra"}] -- mismatched

### Fix

Either:
1. Use a single `GROUP_CONCAT` with combined values like `GROUP_CONCAT(DISTINCT CONCAT(tags.slug, '=', tags.name) ORDER BY tags.slug)` and split by delimiter
2. Order both GROUP_CONCATs by the same column (e.g., both ORDER BY `tags.slug`)
3. Fall back to the batched tag query pattern used in `getSharedGroup` (separate query, no GROUP_CONCAT alignment risk)

Option 2 is the simplest fix.

---

## C15-LOW-01: `searchImages` first query lacks GROUP BY but uses LEFT JOIN

- **File+line**: `apps/web/src/lib/data.ts:1114-1131`
- **Severity**: LOW | **Confidence**: High

### Problem

The first `searchImages` query (lines 1114-1131) uses `leftJoin(topics, ...)` but does NOT have a `.groupBy()`. The tag and alias queries (lines 1172-1188) DO use `.groupBy(...searchGroupByColumns)`. With MySQL's `ONLY_FULL_GROUP_BY` mode, the first query works because it doesn't use GROUP_CONCAT or aggregate functions. However, if a topic has multiple matching images via the LEFT JOIN, the query returns the expected rows (one per image). The lack of GROUP BY is correct here since there's no aggregation.

This is an informational finding, not a bug. The query is correct as-is.

---

## C15-LOW-02: `seo.ts` checks Unicode formatting before `normalizeStringRecord` which also checks

- **File+line**: `apps/web/src/app/actions/seo.ts:71-81` and `apps/web/src/lib/sanitize.ts:55-62`
- **Severity**: LOW | **Confidence**: High

### Problem

In `updateSeoSettings`, lines 71-81 call `sanitizeAdminString(settings.seo_title).rejected` etc. BEFORE `normalizeStringRecord` (line 88). But `normalizeStringRecord` at line 60 also checks `UNICODE_FORMAT_CHARS.test(value)` and returns `error: 'invalidInput'` if formatting characters are found. This means the Unicode formatting check is applied twice: once by `sanitizeAdminString` (which returns `rejected: true`) and once inside `normalizeStringRecord` (which returns `ok: false`).

The double-check is defense-in-depth, not a bug. However, if `sanitizeAdminString` ever changes its rejection policy, the two checks could diverge. The current behavior is safe because both reject Unicode formatting.

### Fix (optional)

Document the overlap with a comment in `seo.ts` explaining that `normalizeStringRecord` provides the same defense-in-depth check, and the explicit `sanitizeAdminString` calls are a belt-and-suspenders guard for the raw values before normalization.

---

## C15-LOW-03: `getSharedGroup` fetches tags in a separate query but `getImageByShareKey` uses GROUP_CONCAT

- **File+line**: `apps/web/src/lib/data.ts:972-998` vs `868-924`
- **Severity**: LOW | **Confidence**: High (informational)

### Problem

Two different patterns exist for fetching tags alongside shared data:
- `getImageByShareKey` (refactored in C14-MED-01): uses GROUP_CONCAT in a single query
- `getSharedGroup`: uses a separate batched query with `inArray` for tags

Both patterns are correct. The batched query approach in `getSharedGroup` is actually more robust against the GROUP_CONCAT alignment issue (C15-MED-02) because it doesn't rely on parallel GROUP_CONCAT ordering. However, it costs an extra DB round-trip.

This is an informational finding about inconsistency, not a bug. The approaches have different tradeoffs and both are acceptable.

---

## C15-LOW-04: `flushGroupViewCounts` re-buffers failed increments using the NEW buffer reference

- **File+line**: `apps/web/src/lib/data.ts:71-72, 99-106`
- **Severity**: LOW | **Confidence**: Medium

### Problem

In `flushGroupViewCounts`, the old buffer is swapped to `batch` (line 71-72) and `viewCountBuffer` is set to a fresh `new Map()`. Failed increments are re-buffered into `viewCountBuffer` (the NEW map, line 105). This is correct -- new increments during the flush go to the fresh map, and re-buffered failures also go there so they'll be retried on the next flush.

However, the capacity check at line 101 uses `viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE`. Since the new buffer starts empty and only accumulates re-buffered failures, this check would only trigger if more than 1000 groups fail in a single flush chunk. At personal-gallery scale this is effectively impossible. But it means the capacity check is checking the wrong map for the first chunk -- it should arguably check against the NEW buffer's size minus what was already re-buffered in prior chunks of the same flush.

In practice this is safe because: (a) re-buffered failures add to the fresh map, (b) the post-flush enforcement at lines 119-126 evicts overflow, and (c) personal-gallery scale means this will never trigger.

---

## C15-LOW-05: `exportImagesCsv` column headers hardcoded in English

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:76`
- **Severity**: LOW | **Confidence**: High

### Problem

The CSV export uses hardcoded English headers: `["ID", "Filename", "Title", "Width", "Height", "Capture Date", "Topic", "Tags"]`. This was previously deferred as C13-03 in plan 374. Re-iterating for completeness -- no change in status.

---

## C15-LOW-06: `settings.ts` `updateGallerySettings` missing `uploadContractLock?.release()` on early returns

- **File+line**: `apps/web/src/app/actions/settings.ts:71-79, 88-89`
- **Severity**: LOW | **Confidence**: Medium

### Problem

In `updateGallerySettings`, the `uploadContractLock` is acquired at line 74-76. If the code returns early at lines 71 or 78 (due to `hasActiveUploadClaims()` or failed lock acquisition), the `uploadContractLock` is `null` and the `finally` block at line 165 correctly handles `null?.release()`. But if the code returns early at line 88-89 (invalid `image_sizes` value after lock acquisition), the `finally` block at line 165 WILL release the lock. So this is actually handled correctly by the `finally` block.

However, there's a subtle issue: the `return` at line 88 is inside the `try` block (line 81), so the `finally` at line 164-166 DOES execute, releasing the lock. This is correct behavior.

On closer inspection, this finding is NOT an issue. The `finally` block handles all paths.

---

## C15-LOW-07: `adminListSelectFields` unused variable suppression count is high

- **File+line**: `apps/web/src/lib/data.ts:233-277`
- **Severity**: LOW | **Confidence**: Low (style/maintainability)

### Problem

The `adminListSelectFields` derivation uses 18 eslint-disable-next-line comments for unused variables (one per omitted EXIF/PII field). While functional, this pattern is verbose and fragile: adding a new field to `adminSelectFields` requires adding another suppression. A helper function or utility type could reduce this boilerplate.

This is a maintainability concern, not a bug. The current approach is explicit and auditable.

---

## Summary of Actionable Findings

| ID | Severity | Confidence | File | Description |
|----|----------|------------|------|-------------|
| C15-MED-01 | MEDIUM | HIGH | sanitize.ts | `requireCleanInput` contract inconsistency with `sanitizeAdminString` (returns non-null value on rejected) |
| C15-MED-02 | MEDIUM | MEDIUM | data.ts | `getImageByShareKey` tag_names/tag_slugs GROUP_CONCAT ordering misalignment |
| C15-LOW-01 | LOW | HIGH | data.ts | searchImages first query lacks GROUP BY (informational, correct as-is) |
| C15-LOW-02 | LOW | HIGH | seo.ts | Double Unicode formatting check in seo.ts (defense-in-depth, not a bug) |
| C15-LOW-03 | LOW | HIGH | data.ts | Inconsistent tag-fetch pattern between getSharedGroup and getImageByShareKey |
| C15-LOW-04 | LOW | MEDIUM | data.ts | flushGroupViewCounts capacity check targets new buffer during flush |
| C15-LOW-05 | LOW | HIGH | db-actions.ts | CSV headers hardcoded in English (previously deferred C13-03) |
| C15-LOW-07 | LOW | LOW | data.ts | adminListSelectFields verbose suppression pattern |

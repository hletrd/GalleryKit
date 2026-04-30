# Code Reviewer — Cycle 22

**Reviewed:** 242 TypeScript source files across `apps/web/src/`
**Focus:** Code quality, logic, SOLID, maintainability, correctness

## Review method

Direct deep review of all key source files: data.ts, image-queue.ts, session.ts,
validation.ts, sanitize.ts, api-auth.ts, proxy.ts, request-origin.ts, bounded-map.ts,
rate-limit.ts, auth-rate-limit.ts, content-security-policy.ts, csv-escape.ts,
db-actions.ts, schema.ts, upload-tracker-state.ts, public.ts, auth.ts, advisory-locks.ts,
safe-json-ld.ts, action-guards.ts, process-image.ts, images.ts, sharing.ts, topics.ts,
tags.ts, settings.ts, admin-users.ts, seo.ts. Verified all `.length` vs `countCodePoints`
patterns across validation and action files. Confirmed all C21 fixes are still in place.

## GATE STATUS (carried forward, verified)

- eslint: clean
- tsc --noEmit: clean
- build: success
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK

## New Findings

### C22-CR-01 (Low / Medium): `isValidTagSlug` uses `slug.length <= 100` with `\p{Letter}` regex that allows supplementary characters — inconsistency with C21 fixes

- **Source**: `apps/web/src/lib/validation.ts:116`
- **Issue**: The regex `/^[\p{Letter}\p{Number}-]+$/u` allows supplementary Unicode characters (rare CJK ideographs in planes 2+, certain letter-like symbols). The `.length <= 100` check uses UTF-16 code units. The existing comment (AGG10-03) acknowledges this and states supplementary characters in tag slugs are "extremely rare" and defers `countCodePoints()` migration. However, this is the same class of issue as C21-AGG-02 and C21-AGG-03 (both fixed this cycle). The inconsistency is that `isValidTopicAlias` and `isValidTagName` were migrated to `countCodePoints()` but `isValidTagSlug` was explicitly left on `.length`.
- **Practical impact**: A tag slug composed of 51 supplementary characters (102 UTF-16 code units) would fail the `.length <= 100` check despite being only 51 actual characters — well under MySQL's varchar(100) character limit. The `getTagSlug()` function normalizes most supplementary characters away, but `\p{Letter}` explicitly includes rare CJK ideographs in the supplementary planes.
- **Fix**: Either migrate to `countCodePoints(slug) <= 100` for consistency with `isValidTopicAlias` and `isValidTagName`, or add a stronger comment explaining that `getTagSlug()` is guaranteed to produce only BMP output (making `.length` safe). The current AGG10-03 comment is ambiguous — it says "migrate to `countCodePoints()`" if supplementary characters are allowed, but the regex already allows them.
- **Confidence**: Medium

### C22-CR-02 (Informational / High): `original_format` uses `.slice(0, 10)` — safe but undocumented

- **Source**: `apps/web/src/app/actions/images.ts:326`
- **Issue**: `(data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null` — the `.slice(0, 10)` truncates by UTF-16 code units. For ASCII file extensions (JPEG, HEIC, etc.) this is always safe. The `getSafeExtension()` function in `process-image.ts` already validates that the extension only contains `[a-z0-9.]` characters, so the value reaching the DB is always ASCII-safe. The `original_format` column is `varchar(10)` in the schema, so truncation to 10 code units is correct.
- **Recommendation**: No fix needed — the value is guaranteed ASCII by the upstream validator. Adding a comment at the `slice(0, 10)` call noting this invariant would aid future reviewers.
- **Confidence**: High

## Previously Fixed Findings (confirmed still fixed)

- C21-AGG-01: `searchImages` countCodePoints — FIXED
- C21-AGG-02: `isValidTopicAlias` countCodePoints — FIXED
- C21-AGG-03: `isValidTagName` countCodePoints — FIXED
- C20-AGG-01: password length countCodePoints — FIXED
- C20-AGG-02: `getTopicBySlug` uses `isValidSlug` — FIXED
- C20-AGG-03: `updateImageMetadata` redundant `updated_at` — FIXED
- C20-AGG-04/05: tags.ts catch blocks include error — FIXED
- C19-AGG-01: `getImageByShareKeyCached` cache caveat — DOCUMENTED
- C19-AGG-02: duplicated topic-slug regex — FIXED
- C18-MED-01: searchImagesAction re-throw — FIXED
- C16-MED-01: loadMoreImages DB counter sync — FIXED
- C16-MED-02: getImageByShareKey GROUP_CONCAT — FIXED
- C9-CR-01/C9-CR-02: view-count iteration-during-deletion — FIXED

## Carry-forward (unchanged — existing deferred backlog)

- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred

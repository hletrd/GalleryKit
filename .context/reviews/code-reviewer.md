# Code Reviewer — Cycle 21

## Review method
Direct deep review of all key source files: data.ts, image-queue.ts, session.ts,
validation.ts, sanitize.ts, api-auth.ts, proxy.ts, request-origin.ts, bounded-map.ts,
rate-limit.ts, auth-rate-limit.ts, content-security-policy.ts, csv-escape.ts,
db-actions.ts, schema.ts, upload-tracker-state.ts, public.ts, auth.ts, advisory-locks.ts,
safe-json-ld.ts, action-guards.ts, process-image.ts, images.ts, sharing.ts, topics.ts,
tags.ts, settings.ts, admin-users.ts, seo.ts.

## GATE STATUS (carried forward, verified)
- eslint: clean
- tsc --noEmit: clean
- build: success
- vitest: 579 tests passing (84 test files)
- lint:api-auth: OK
- lint:action-origin: OK

## Previously fixed findings (confirmed still fixed)
- C9-CR-01: viewCountRetryCount iteration-during-deletion — FIXED
- C9-CR-02: pruneRetryMaps iteration-during-deletion — FIXED
- C16-CT-01: image-queue.ts contradictory comment — FIXED
- C16-CT-02: instrumentation.ts console.log — FIXED
- C18-MED-01: searchImagesAction re-throws — FIXED
- C19-AGG-01: getImageByShareKeyCached cache caveat — DOCUMENTED
- C19-AGG-02: duplicated topic-slug regex — FIXED (replaced with isValidSlug)
- C20-AGG-01: password length uses countCodePoints — FIXED
- C20-AGG-02: getTopicBySlug inline regex — FIXED (uses isValidSlug)
- C20-AGG-04/05: tags.ts catch blocks — FIXED

## New Findings

### C21-CR-01 (Medium / High): `searchImages` in data.ts uses `query.length > 200` while caller `searchImagesAction` uses `countCodePoints() > 200` — inconsistent for supplementary Unicode characters

- **Source**: `apps/web/src/lib/data.ts:1082`
- **Cross-reference**: `apps/web/src/app/actions/public.ts:158`
- **Issue**: The `searchImages` function in data.ts checks `if (query.length > 200) return [];` using JavaScript `.length` (UTF-16 code units). The caller `searchImagesAction` in public.ts checks `if (countCodePoints(sanitizedQuery) > 200 ...)` using actual character count. For supplementary Unicode characters (emoji, rare CJK), `.length` counts 2 code units per character. This means:
  - A 101-emoji query (101 code points, 202 UTF-16 code units) passes the `countCodePoints > 200` check in public.ts (101 < 200) but would be silently rejected by `searchImages` (202 > 200).
  - Additionally, `sanitizedQuery.slice(0, 200)` at public.ts:205 can split a surrogate pair when the 200th code unit falls in the middle of a supplementary character, producing an invalid UTF-16 string (lone high surrogate).
- **Practical impact**: A user searching with many emoji would get zero results without any error message. The data layer silently returns empty instead of searching.
- **Fix**: (1) Replace `query.length > 200` with `countCodePoints(query) > 200` in data.ts `searchImages`. (2) Use a code-point-aware slice instead of `sanitizedQuery.slice(0, 200)` in public.ts, or simply rely on the data layer's length guard and remove the redundant slice.
- **Confidence**: High

### C21-CR-02 (Low / Medium): `isValidTopicAlias` uses `alias.length <= 255` for a field that explicitly allows CJK/emoji characters

- **Source**: `apps/web/src/lib/validation.ts:85`
- **Issue**: The function uses `.length` for the max-length check, but the regex `/^[^./\\\s?\x00#<>"'&]+$/` explicitly allows CJK and emoji characters. The codebase documentation in data.ts:1025 states "Direct topic slugs are always ASCII-safe; aliases may contain CJK/emoji". For a 128-emoji alias (256 UTF-16 code units, 128 actual characters), the `.length <= 255` check would reject it despite having only 128 actual characters — well under MySQL's varchar(255) character limit. This is the same class of issue as C20-AGG-01 (password length), but for topic aliases.
- **Fix**: Replace `alias.length <= 255` with `countCodePoints(alias) <= 255` for consistency with the countCodePoints pattern used for title, description, label, SEO, and password fields. Import `countCodePoints` from `@/lib/utils`.
- **Confidence**: Medium

### C21-CR-03 (Low / Medium): `isValidTagName` uses `trimmed.length <= 100` for a field that allows CJK/emoji characters

- **Source**: `apps/web/src/lib/validation.ts:96`
- **Issue**: Tag names allow CJK and emoji (the regex only rejects specific characters), but `trimmed.length <= 100` uses UTF-16 code units. A 51-emoji tag name (102 UTF-16 code units) would fail despite having only 51 actual characters. MySQL's varchar(100) counts characters in utf8mb4, so `countCodePoints` would be the correct check.
- **Fix**: Replace `trimmed.length <= 100` with `countCodePoints(trimmed) <= 100`. Import `countCodePoints` from `@/lib/utils`.
- **Confidence**: Medium

## Carry-forward (unchanged — existing deferred backlog)
- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred
- A17-LOW-08: Lightbox auto-hide UX — previously deferred
- A17-LOW-09: Photo viewer sidebar layout shift — previously deferred

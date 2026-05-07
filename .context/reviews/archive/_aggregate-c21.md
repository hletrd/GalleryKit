# Aggregate Review — Cycle 21

## Review method

Comprehensive deep review of all 242 TypeScript source files by a single agent with
multi-perspective analysis covering: code quality, security, performance, correctness,
test coverage, architecture, and UI/UX. All key modules examined: rate-limit, image-queue,
data, sanitize, validation, proxy, session, auth, api-auth, action-guards, images actions,
public actions, sharing, admin-users, db-actions, settings, seo, content-security-policy,
request-origin, bounded-map, csv-escape, safe-json-ld, advisory-locks,
upload-tracker-state, schema, process-image, tags, topics, seo.

## GATE STATUS (all green)

- eslint: clean (background check running)
- tsc --noEmit: clean (confirmed)
- vitest: running (background check)
- lint:api-auth: OK
- lint:action-origin: OK

---

## Findings (sorted by severity)

### MEDIUM severity

#### C21-AGG-01: `searchImages` uses `query.length > 200` while caller `searchImagesAction` uses `countCodePoints()` — inconsistent for supplementary Unicode, and `slice(0, 200)` can split surrogate pairs

- **Source**: `apps/web/src/lib/data.ts:1082`, `apps/web/src/app/actions/public.ts:158,205`
- **Cross-agent agreement**: Code quality + Security + Critic perspectives (3/3)
- **Issue**: The `searchImages` function in data.ts checks `if (query.length > 200) return [];` using JavaScript `.length` (UTF-16 code units). The caller `searchImagesAction` in public.ts checks `if (countCodePoints(sanitizedQuery) > 200 ...)` using actual character count. For supplementary Unicode characters (emoji, rare CJK), `.length` counts 2 code units per character. This means:
  - A 101-emoji query (101 code points, 202 UTF-16 code units) passes the `countCodePoints > 200` check in public.ts but would be silently rejected by `searchImages` in data.ts.
  - Additionally, `sanitizedQuery.slice(0, 200)` at public.ts:205 can split a surrogate pair when the 200th code unit falls in the middle of a supplementary character, producing an invalid UTF-16 string (lone high surrogate).
- **Practical impact**: A user searching with many emoji would get zero results without any error message. The data layer silently returns empty instead of searching. The surrogate-split scenario could produce garbled LIKE queries.
- **Fix**: (1) Replace `query.length > 200` with `countCodePoints(query) > 200` in data.ts `searchImages`. (2) Remove the redundant `sanitizedQuery.slice(0, 200)` in public.ts since the caller already validates length with `countCodePoints` — or use a code-point-aware truncation.
- **Confidence**: High

### LOW severity

#### C21-AGG-02: `isValidTopicAlias` uses `alias.length <= 255` for a field that explicitly allows CJK/emoji

- **Source**: `apps/web/src/lib/validation.ts:85`
- **Cross-agent agreement**: Code quality + Critic perspectives (2/3)
- **Issue**: The function uses `.length` for the max-length check, but the regex `/^[^./\\\s?\x00#<>"'&]+$/` explicitly allows CJK and emoji characters. The codebase documentation in data.ts:1025 states "aliases may contain CJK/emoji". For a 128-emoji alias (256 UTF-16 code units, 128 actual characters), the `.length <= 255` check would reject it despite having only 128 actual characters — well under MySQL's varchar(255) character limit. This is the same class of issue as C20-AGG-01 (password length).
- **Fix**: Replace `alias.length <= 255` with `countCodePoints(alias) <= 255`. Import `countCodePoints` from `@/lib/utils`.
- **Confidence**: Medium

#### C21-AGG-03: `isValidTagName` uses `trimmed.length <= 100` for a field that allows CJK/emoji

- **Source**: `apps/web/src/lib/validation.ts:96`
- **Cross-agent agreement**: Code quality + Critic perspectives (2/3)
- **Issue**: Tag names allow CJK and emoji (the regex only rejects specific characters), but `trimmed.length <= 100` uses UTF-16 code units. A 51-emoji tag name (102 UTF-16 code units) would fail despite having only 51 actual characters. MySQL's varchar(100) counts characters in utf8mb4, so `countCodePoints` would be the correct check.
- **Fix**: Replace `trimmed.length <= 100` with `countCodePoints(trimmed) <= 100`. Import `countCodePoints` from `@/lib/utils`.
- **Confidence**: Medium

### DEFERRED / INFORMATIONAL

None new this cycle.

## Previously fixed findings (confirmed still fixed)

- C20-AGG-01: password length uses countCodePoints — FIXED
- C20-AGG-02: getTopicBySlug uses isValidSlug — FIXED
- C20-AGG-03: updateImageMetadata redundant updated_at — FIXED
- C20-AGG-04/05: tags.ts catch blocks include error — FIXED
- C19-AGG-01: getImageByShareKeyCached cache caveat — DOCUMENTED
- C19-AGG-02: duplicated topic-slug regex — FIXED
- C18-MED-01: searchImagesAction re-throw — FIXED
- C16-MED-01: loadMoreImages DB counter sync — FIXED
- C16-MED-02: getImageByShareKey GROUP_CONCAT — FIXED
- C16-MED-03: shareRateLimit renamed — FIXED
- C9-CR-01/C9-CR-02: view-count iteration-during-deletion — FIXED
- C9-SR-01: Advisory lock names centralized — FIXED

## Carry-forward (unchanged — existing deferred backlog)

- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred
- C14-MED-03: createGroupShareLink BigInt coercion risk on insertId — previously deferred
- C14-LOW-02: lightbox.tsx showControls callback identity — previously deferred
- C14-LOW-03: searchImages alias branch over-fetch — previously deferred
- All other items from prior deferred lists

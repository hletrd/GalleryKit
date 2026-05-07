# Aggregate Review — Cycle 22

## Review method

Comprehensive deep review of all 242 TypeScript source files by a single agent with
multi-perspective analysis covering: code quality, security, performance, correctness,
and verification. All key modules examined: validation, data, image-queue, session,
auth, api-auth, proxy, rate-limit, bounded-map, sanitize, request-origin,
content-security-policy, csv-escape, safe-json-ld, advisory-locks, upload-tracker-state,
schema, process-image, tags, topics, seo, settings, admin-users, sharing, images, public.

## GATE STATUS (all green — carried forward from C21)

- eslint: clean
- tsc --noEmit: clean
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK

---

## Findings (sorted by severity)

### LOW severity

#### C22-AGG-01: `isValidTagSlug` uses `slug.length <= 100` with `\p{Letter}` regex that allows supplementary characters — consistency gap with C21 fixes

- **Source**: `apps/web/src/lib/validation.ts:116`
- **Cross-agent agreement**: Code quality + Critic perspectives (2/2)
- **Issue**: The regex `/^[\p{Letter}\p{Number}-]+$/u` allows supplementary Unicode characters (rare CJK ideographs in planes 2+). The `.length <= 100` check uses UTF-16 code units. The existing comment (AGG10-03) defers `countCodePoints()` migration, but this creates a consistency gap: `isValidTopicAlias` and `isValidTagName` were both migrated to `countCodePoints()` in C21, while `isValidTagSlug` was explicitly left on `.length`. The AGG10-03 comment states "if `isValidTagSlug` is changed to allow supplementary characters, migrate to `countCodePoints()`" but the regex already allows them. A 51-supplementary-character tag slug (102 UTF-16 code units) would fail the `.length <= 100` check despite having only 51 actual characters — well under MySQL's varchar(100) character limit.
- **Practical impact**: Low. The `getTagSlug()` function normalizes most supplementary characters away in practice. However, the code-comment inconsistency could mislead future contributors.
- **Fix**: Either (a) migrate to `countCodePoints(slug) <= 100` for consistency with `isValidTopicAlias` and `isValidTagName`, or (b) tighten the regex to BMP-only and update the comment to accurately reflect why `.length` is safe.
- **Confidence**: Medium

### INFORMATIONAL

#### C22-AGG-02: `original_format` uses `.slice(0, 10)` on file extension — safe but undocumented

- **Source**: `apps/web/src/app/actions/images.ts:326`
- **Cross-agent agreement**: Code quality perspective (1/1)
- **Issue**: `(data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null` — the `.slice(0, 10)` truncates by UTF-16 code units. The value is guaranteed ASCII by the upstream `getSafeExtension()` validator in `process-image.ts`, which only allows `[a-z0-9.]` characters. The `original_format` column is `varchar(10)` in the schema. No bug — just a missing invariant documentation.
- **Fix**: No code change needed. Adding a comment at the `slice(0, 10)` call noting the ASCII guarantee would aid future reviewers.
- **Confidence**: High

### DEFERRED / INFORMATIONAL

None new this cycle.

## Previously fixed findings (confirmed still fixed)

- C21-AGG-01: `searchImages` countCodePoints — FIXED
- C21-AGG-02: `isValidTopicAlias` countCodePoints — FIXED
- C21-AGG-03: `isValidTagName` countCodePoints — FIXED
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

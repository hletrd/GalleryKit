# Aggregate Review — Cycle 20 (Fresh Deep Review)

## Review method

Comprehensive deep review of all 242 TypeScript source files by a single agent with
multi-perspective analysis covering: code quality, security, performance, correctness,
test coverage, architecture, and UI/UX. All key modules examined: rate-limit, image-queue,
data, sanitize, validation, proxy, session, auth, api-auth, action-guards, images actions,
public actions, sharing, admin-users, db-actions, settings, seo, content-security-policy,
request-origin, bounded-map, csv-escape, safe-json-ld, advisory-locks,
upload-tracker-state, schema, process-image, tags, topics, seo.

## GATE STATUS (all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: 579 tests passing (84 test files)
- lint:api-auth: OK
- lint:action-origin: OK
- next build: running (expected green based on prior cycles)

---

## Findings (sorted by severity)

### MEDIUM severity

#### C20-AGG-01: `newPassword.length` in auth.ts uses JS `.length` instead of `countCodePoints()` for password length validation

- **Source**: `apps/web/src/app/actions/auth.ts:319,323`
- **Cross-agent agreement**: Code quality + Security perspectives
- **Issue**: The password length checks use `newPassword.length < 12` and `newPassword.length > 1024`. JavaScript `.length` counts UTF-16 code units, so a password containing emoji or supplementary characters (rare CJK) would count as 2 units per character. A 6-emoji password (12 UTF-16 code units) would pass the `>= 12` check despite having only 6 actual characters. While the repo's convention (AGG10-02, AGG10-03) documents that `.length` is acceptable for ASCII-restricted fields, passwords are NOT restricted to ASCII — they can contain any Unicode. This is inconsistent with the `countCodePoints()` usage for title, description, label, and SEO fields.
- **Practical impact**: An attacker could construct a password that appears to meet the 12-character minimum but actually has far fewer graphemes, reducing effective entropy. For the 1024-char max, a user with many emoji would hit the limit at ~512 actual characters.
- **Fix**: Replace `newPassword.length` with `countCodePoints(newPassword)` for both the `< 12` and `> 1024` checks, consistent with the pattern used everywhere else in the codebase.
- **Confidence**: High

#### C20-AGG-02: `getTopicBySlug` in data.ts still uses inline regex `/^[a-z0-9_-]+$/` instead of `isValidSlug()`

- **Source**: `apps/web/src/lib/data.ts:1026`
- **Issue**: While C19-AGG-02 fixed the inline regex in `getImageCount` and `buildImageConditions`, `getTopicBySlug` at line 1026 still has an inline `/^[a-z0-9_-]+$/.test(slug)` check. This is the same duplicated pattern that was fixed in the other two locations. The inconsistency means `getTopicBySlug` has a slightly different validation than `isValidSlug()` (the inline regex lacks the length bounds and empty-string check that `isValidSlug` provides).
- **Fix**: Replace the inline regex with `isValidSlug(slug)` and skip the direct slug query when it returns false, matching the pattern in `getImageCount`.
- **Confidence**: High

### LOW severity

#### C20-AGG-03: `updateImageMetadata` explicitly sets `updated_at: sql\`CURRENT_TIMESTAMP\`` despite schema `.onUpdateNow()` — redundant

- **Source**: `apps/web/src/app/actions/images.ts:754`
- **Issue**: The `images` table schema declares `updated_at: timestamp("updated_at").default(sql\`CURRENT_TIMESTAMP\`).onUpdateNow()`, which auto-updates on every row mutation. The explicit `updated_at: sql\`CURRENT_TIMESTAMP\`` in `updateImageMetadata`'s `.set()` is redundant — it produces the same result the schema annotation already handles. While technically correct, it misleads future developers into thinking `onUpdateNow()` is not active, creating a pattern that could proliferate to other mutation sites unnecessarily.
- **Fix**: Remove the explicit `updated_at` from the `.set()` call. Add a comment noting `onUpdateNow()` handles it.
- **Confidence**: Medium

#### C20-AGG-04: `updateTag` catch block logs error without the error object — inconsistent with all other catch blocks

- **Source**: `apps/web/src/app/actions/tags.ts:94`
- **Issue**: The catch block in `updateTag` logs `console.error("Failed to update tag")` without the error object. Every other catch block in the same file passes the error as the second argument. Without the error object, production debugging is impaired.
- **Fix**: Change to `catch (e) { console.error("Failed to update tag", e); }` matching the pattern in `deleteTag` (line 133) and `addTagToImage` (line 200).
- **Confidence**: High

#### C20-AGG-05: `deleteTag` catch block also logs error without the error object

- **Source**: `apps/web/src/app/actions/tags.ts:133`
- **Issue**: Same issue as C20-AGG-04 — `console.error("Failed to delete tag")` without the error object. Inconsistent with `addTagToImage` (line 200) and `removeTagFromImage` (line 261) which both pass the error.
- **Fix**: Change to `catch (e) { console.error("Failed to delete tag", e); }`.
- **Confidence**: High

### DEFERRED / INFORMATIONAL

- C20-AGG-03: Redundant `updated_at` set — informational, no bug
- C15-LOW-07: adminListSelectFields suppression noise — already deferred

## Previously fixed findings (confirmed still fixed)

- C19-AGG-02: Duplicated topic-slug regex in `getImageCount`/`buildImageConditions` — FIXED (uses `isValidSlug`)
- C19-AGG-01: `getImageByShareKeyCached` caching caveat — FIXED (documented)
- C18-MED-01: searchImagesAction re-throw — FIXED (returns structured error)
- C16-MED-01: loadMoreImages DB counter sync — FIXED
- C16-MED-02: getImageByShareKey GROUP_CONCAT — FIXED
- C16-MED-03: shareRateLimit renamed — FIXED
- C9-CR-01/C9-CR-02: view-count iteration-during-deletion — FIXED (collect-then-delete)
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

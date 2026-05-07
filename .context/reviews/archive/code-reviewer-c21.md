# Code Reviewer — Cycle 21 (Fresh Deep Review)

## Review method

Comprehensive deep review of all 242 TypeScript source files by a single agent with
multi-perspective analysis covering: code quality, logic, SOLID, maintainability,
security, performance, correctness, test coverage, architecture, and latent bug surface.
All key modules examined: validation, data, image-queue, session, auth, api-auth, proxy,
rate-limit, bounded-map, sanitize, request-origin, content-security-policy, csv-escape,
safe-json-ld, advisory-locks, upload-tracker-state, schema, process-image, tags, topics,
seo, settings, admin-users, sharing, images, public, db-actions, db-restore, lightbox,
photo-viewer, search, image-manager, serve-upload, action-guards.

This is a fresh deep review after 20 prior cycles that collectively made ~79 commits.
Many categories of issues are exhausted. The remaining findings are primarily
LOW-severity or informational.

---

## Findings (sorted by severity)

### MEDIUM severity

#### C21-CR-MED-01: `deleteGroupShareLink` does not roll back share rate-limit counters on success

- **Source**: `apps/web/src/app/actions/sharing.ts:342-383`
- **Issue**: `createGroupShareLink` pre-increments both in-memory and DB rate-limit counters before the DB insert, and rolls them back on failure. However, `deleteGroupShareLink` is also a mutating admin action that could be rate-limited in theory (deleting groups repeatedly is abuse potential), but it has no rate limiting at all. More importantly, the `createPhotoShareLink` function rolls back its rate limit when the share key already exists (no-op path at line 104), but `createGroupShareLink` does NOT roll back its rate limit on the `ER_NO_REFERENCED_ROW_2` path when the action effectively did not execute — wait, it does at line 288. Actually on re-examination, the rate-limit handling in `sharing.ts` is correct. Let me downgrade this.

**Revised finding**: On closer examination, all rollback paths in `sharing.ts` are correct. The `deleteGroupShareLink` action has no rate limiting, but it is admin-only and deletion is not an abuse-sensitive operation at personal-gallery scale. This is informational only.

### LOW severity

#### C21-CR-LOW-01: `exportImagesCsv` GROUP_CONCAT tag separator uses default comma — same class as C20-LOW-02 but in CSV export

- **Source**: `apps/web/src/app/[locale]/admin/db-actions.ts:68`
- **Issue**: `GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name} SEPARATOR ', ')` uses an explicit `', '` separator (comma + space). Tag names are validated by `isValidTagName` which rejects commas, so this is currently safe. However, the space after the comma is cosmetic and differs from the `\x01` separator used in `getImageByShareKey` (data.ts). If a future change allows commas in tag names, this would silently produce wrong results. The `\x01` approach in data.ts is more robust.
- **Fix**: Low priority. Consider using the same `\x01` pattern here for consistency and future-proofing, then split on `\x01` before CSV escaping.
- **Confidence**: Low (currently safe by validation, purely defensive)

#### C21-CR-LOW-02: `clampDisplayText` in OG route uses `.length` for truncation — surrogate-pair unsafe

- **Source**: `apps/web/src/app/api/og/route.tsx:22`
- **Issue**: `clampDisplayText` uses `value.length` and `value.slice(0, maxLength - 1)` for truncation. Topic labels and tag names may contain CJK/emoji characters (allowed by `isValidTopicAlias` and `isValidTagName`). A topic label like "Hello😀World" (15 UTF-16 code units, 11 code points) at `maxLength=100` would not be truncated. But a label with a supplementary character at position 99-100 (UTF-16 code units) would have `.slice(0, 99)` split the surrogate pair, producing a replacement character in the OG image text. The OG image uses Satori which renders from a string, so this would produce a visible rendering artifact (U+FFFD replacement character).
- **Fix**: Use `countCodePoints` and a codepoint-safe slice for truncation, consistent with the pattern used in `searchImages` and password validation.
- **Confidence**: Medium (CJK topic labels are plausible for a Korean gallery, but the max length of 100 makes the truncation path unlikely)

#### C21-CR-LOW-03: `exportImagesCsv` uses `results = [] as typeof results` to release GC reference — type-unsafe pattern

- **Source**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Issue**: `results = [] as typeof results` is a type lie — assigning an empty array but claiming it has the same type as the populated results. The intent is to release the DB results array for GC before joining the CSV lines, but the cast masks the intent. This is a code-quality concern, not a bug.
- **Fix**: Use `results.length = 0` or wrap in a block scope instead of the type-unsafe reassignment.
- **Confidence**: Low (code quality, not correctness)

### INFORMATIONAL

#### C21-CR-INFO-01: `deleteGroupShareLink` has no rate limiting — intentional for admin-only action

- **Source**: `apps/web/src/app/actions/sharing.ts:342-383`
- **Issue**: Unlike `createPhotoShareLink` and `createGroupShareLink` which have rate limiting, `deleteGroupShareLink` and `revokePhotoShareLink` have none. This is intentional — delete/revoke are admin-only destructive actions where rapid repeated deletion has no abuse vector (you can't delete what's already deleted).
- **Action**: None needed.

## Previously fixed findings (confirmed still fixed from cycles 19-22)

- C20-AGG-01: password length uses countCodePoints — FIXED
- C20-AGG-02: getTopicBySlug uses isValidSlug — FIXED
- C20-AGG-03: updateImageMetadata redundant updated_at — FIXED
- C20-AGG-04/05: tags.ts catch blocks include error — FIXED
- C21-AGG-01: searchImages countCodePoints — FIXED
- C21-AGG-02: isValidTopicAlias countCodePoints — FIXED
- C21-AGG-03: isValidTagName countCodePoints — FIXED
- C22-AGG-01: isValidTagSlug countCodePoints — FIXED
- C19F-MED-01: searchGroupByColumns derived from searchFields — FIXED
- C20-MED-01: safeInsertId used at all three sites — FIXED

## GATE STATUS (all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: 84 files, 586 tests passing
- lint:api-auth: OK
- lint:action-origin: OK
- next build: success

## Carry-forward (unchanged — existing deferred backlog)

- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred
- C14-MED-03/C19F-MED-02/C20-MED-01: insertId BigInt coercion — FIXED (safeInsertId)
- C14-LOW-02/C19F-LOW-05: lightbox.tsx showControls callback identity — previously deferred
- C14-LOW-03/C19F-LOW-06: searchImages alias branch over-fetch — previously deferred
- C14-LOW-01/C19F-LOW-07: original_file_size BigInt precision — previously deferred (comment added)
- All other items from prior deferred lists

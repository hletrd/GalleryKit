# Aggregate Review — Cycle 21 (Deep Review)

## Review method

Comprehensive deep review of all 242 TypeScript source files by a single agent with
multi-perspective analysis covering: code quality, logic, SOLID, maintainability,
performance, concurrency, CPU/memory/UI responsiveness, OWASP top 10, secrets,
unsafe patterns, auth/authz, correctness, test coverage, architecture, UI/UX,
documentation, and latent bug surface. All key modules examined: validation, data,
image-queue, session, auth, api-auth, proxy, rate-limit, bounded-map, sanitize,
request-origin, content-security-policy, csv-escape, safe-json-ld, advisory-locks,
upload-tracker-state, schema, process-image, tags, topics, seo, settings, admin-users,
sharing, images, public, db-actions, db-restore, lightbox, photo-viewer, search,
image-manager, serve-upload, action-guards.

This is a fresh deep review after 20 prior cycles that collectively made ~79 commits.
Many categories of issues are now exhausted. The remaining findings are
primarily LOW-severity or test-coverage improvements.

---

## Findings (sorted by severity)

### LOW severity

#### C21-AGG-01: `clampDisplayText` in OG route uses `.length`/`.slice()` for truncation — surrogate-pair unsafe

- **Source**: `apps/web/src/app/api/og/route.tsx:20-24`
- **Issue**: `clampDisplayText` uses `value.length` and `value.slice(0, maxLength - 1)` for truncation. Topic labels and tag names may contain CJK/emoji characters (allowed by `isValidTopicAlias` and `isValidTagName`). A supplementary character at the truncation boundary would be split by `.slice()`, producing a U+FFFD replacement character in the OG image text. The OG image uses Satori which renders from a string — the replacement character would appear as a visible rendering artifact.
- **Fix**: Use `countCodePoints` for length comparison and a codepoint-safe slice for truncation, consistent with the pattern used in `searchImages`, `isValidTopicAlias`, `isValidTagName`, and password validation.
- **Confidence**: Medium (CJK topic labels are plausible for a Korean gallery, but the maxLength of 100 for topics and 30 for tags makes the truncation path unlikely in practice)

#### C21-AGG-02: `exportImagesCsv` GROUP_CONCAT tag separator uses `', '` — less robust than `\x01` pattern in data.ts

- **Source**: `apps/web/src/app/[locale]/admin/db-actions.ts:68`
- **Issue**: `GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name} SEPARATOR ', ')` uses an explicit `', '` separator (comma + space). Tag names are validated by `isValidTagName` which rejects commas, so this is currently safe. However, the space-after-comma is cosmetic and the approach differs from the more robust `\x01` separator used in `getImageByShareKey` (data.ts). If a future change allows commas in tag names, this would silently produce wrong results.
- **Fix**: Low priority. Consider using the same `\x01` pattern for consistency and future-proofing, then split on `\x01` before CSV escaping.
- **Confidence**: Low (currently safe by validation, purely defensive)

### INFORMATIONAL

#### C21-AGG-03: `exportImagesCsv` uses type-unsafe `results = [] as typeof results` for GC hint

- **Source**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Issue**: The pattern `results = [] as typeof results` is a type lie to release the DB results for GC. This is a code-quality concern but not a bug.
- **Fix**: Use `results.length = 0` or a block scope instead.
- **Confidence**: Low (code quality only)

## Previously fixed findings (confirmed still fixed from cycles 19-22)

- C20-AGG-01: password length uses countCodePoints — FIXED
- C20-AGG-02: getTopicBySlug uses isValidSlug — FIXED
- C20-AGG-03: updateImageMetadata redundant updated_at — FIXED
- C20-AGG-04/05: tags.ts catch blocks include error — FIXED
- C21-AGG-01/02/03: countCodePoints for search/topicAlias/tagName — FIXED
- C22-AGG-01: isValidTagSlug countCodePoints — FIXED
- C19F-MED-01: searchGroupByColumns derived from searchFields — FIXED
- C20-MED-01: safeInsertId used at all three insertId sites — FIXED

## Re-verified (confirmed correct this cycle)

1. **Auth flow**: Login rate limiting with dual IP+account buckets, Argon2 timing-safe
   verification, session fixation prevention via transaction, `unstable_rethrow` only
   in auth.ts — all correct.

2. **Upload flow**: TOCTOU prevention with pre-increment tracker, upload-processing
   contract lock, disk space pre-check, topic existence check — all correct.

3. **Sanitization**: `requireCleanInput`, `sanitizeAdminString`, `stripControlChars`,
   `UNICODE_FORMAT_CHARS` derivation from validation.ts — all correct.

4. **Privacy guards**: `publicSelectFields` derived from `adminSelectFields` with
   compile-time guard, GPS coordinates excluded — all correct.

5. **Rate-limit patterns**: Three documented rollback patterns consistently applied,
   DB-backed counters for cross-restart accuracy — all correct.

6. **Action guards**: Every mutating server action calls `requireSameOriginAdmin()` and
   returns early on error. Read-only exports carry `@action-origin-exempt` comments.

7. **API auth**: `withAdminAuth` wrapper enforces origin + admin check — all correct.

8. **File serving**: Symlink rejection, path traversal prevention, directory whitelist,
   realpath containment — all correct.

9. **Image queue**: Advisory lock per job, claim check, conditional UPDATE, orphaned
   file cleanup — all correct.

10. **DB restore**: Advisory lock, upload-processing contract lock, restore maintenance
    flag, SQL scan, header validation — all correct.

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
- C14-LOW-02/C19F-LOW-05: lightbox.tsx showControls callback identity — previously deferred
- C14-LOW-03/C19F-LOW-06: searchImages alias branch over-fetch — previously deferred
- C14-LOW-01/C19F-LOW-07: original_file_size BigInt precision — previously deferred (comment added)
- All other items from prior deferred lists

## NEW findings this cycle (not previously reported)

- C21-AGG-01: `clampDisplayText` surrogate-pair-unsafe truncation in OG route
- C21-AGG-02: `exportImagesCsv` GROUP_CONCAT separator less robust than data.ts pattern
- C21-AGG-03: `exportImagesCsv` type-unsafe GC hint (informational)

## Convergence assessment

The codebase is in a highly hardened state after 20+ review cycles. Finding counts have
been in clear decline (24->12->6->4->3->7->10->7->4->5->9->6->7->14->5->9->5->5->2->4).
This cycle produced only 3 findings (1 actionable, 2 informational/defensive). All HIGH
and MED severity categories are exhausted. The remaining actionable finding (C21-AGG-01)
is LOW severity with low practical impact. The codebase is approaching full convergence.

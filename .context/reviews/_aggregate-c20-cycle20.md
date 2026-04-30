# Aggregate Review -- Cycle 20 (Deep Review)

## Review method

Comprehensive deep review of all 242 TypeScript source files by a single agent with
multi-perspective analysis covering: code quality, logic, SOLID, maintainability,
performance, concurrency, CPU/memory/UI responsiveness, OWASP top 10, secrets,
unsafe patterns, auth/authz, correctness, test coverage, architecture, UI/UX,
documentation, and latent bug surface. All key modules examined: auth, session,
rate-limit, image-queue, data, sanitize, validation, proxy, api-auth, action-guards,
serve-upload, images actions, public actions, sharing, admin-users, tags, topics,
settings, seo, db-actions, content-security-policy, request-origin, bounded-map,
csv-escape, blur-data-url, advisory-locks, upload-tracker, process-image, schema,
lightbox, photo-viewer, search, image-manager, revalidation.

This is a fresh deep review after 19 prior cycles that collectively made ~77 commits.
Many categories of issues are now exhausted. The remaining findings are
primarily LOW-severity or test-coverage improvements.

---

## Findings (sorted by severity)

### MEDIUM severity

#### C20-MED-01: `admin-users.ts` `createAdminUser` uses `Number(result.insertId)` -- same BigInt coercion risk as sharing.ts C19F-MED-02

- **Source**: `apps/web/src/app/actions/admin-users.ts:145`
- **Issue**: `result.insertId` from `mysql2` can be a `BigInt` when the auto-increment
  value exceeds `Number.MAX_SAFE_INTEGER`. The `Number()` coercion would silently lose
  precision. This is the exact same class of bug as C19F-MED-02 in sharing.ts (which
  has been deferred). The `images.ts:336` site also uses `Number(result.insertId)` but
  has a `Number.isFinite(insertedId)` guard that catches `Infinity` but NOT silent
  precision loss. All three sites share the same pattern and risk class.
- **Fix**: Use `BigInt` comparison or validate with
  `result.insertId <= BigInt(Number.MAX_SAFE_INTEGER)` before coercion, consistent
  across all three sites (sharing.ts, admin-users.ts, images.ts).
- **Confidence**: Medium (extremely unlikely at personal-gallery scale, but the silent
  precision loss is a correctness defect)

### LOW severity

#### C20-LOW-01: `images.ts:336` uses `Number(result.insertId)` -- same BigInt coercion risk as C20-MED-01

- **Source**: `apps/web/src/app/actions/images.ts:336`
- **Issue**: Same class as C20-MED-01. Has a `Number.isFinite(insertedId)` guard but
  that does not protect against silent precision loss. Lower severity than the
  admin-users/sharing sites because the insertId is only used for queue enqueueing
  and not as a foreign key in subsequent inserts within a transaction.
- **Fix**: Same as C20-MED-01.
- **Confidence**: Medium

#### C20-LOW-02: `tag_concat` parsing in `getImageByShareKey` uses comma as record delimiter -- fragile if tag slugs contain commas

- **Source**: `apps/web/src/lib/data.ts:913-918`
- **Issue**: The `tag_concat` field uses `GROUP_CONCAT(DISTINCT CONCAT(slug, CHAR(0), name) ORDER BY slug)`
  with a comma as the GROUP_CONCAT separator (default). Tag slugs are validated by
  `isValidTagSlug` which uses `[\p{Letter}\p{Number}-]+` -- no commas. So this is
  currently safe. However, the separator is MySQL's default GROUP_CONCAT separator
  which can be changed at the session level. If a future change sets a non-comma
  separator or if commas somehow enter the slug, the parsing would silently produce
  wrong results. The null-byte inner delimiter is robust; the outer comma delimiter
  is an implicit assumption. This is a defensive improvement, not a current bug.
- **Fix**: Use an explicit `SEPARATOR` clause with a character that cannot appear in
  tag slugs (e.g., `SEPARATOR '\x01'`) and split on that character instead of comma.
- **Confidence**: Low (currently safe by validation, purely defensive)

#### C20-LOW-03: `rateLimitBuckets` primary key uses `bigint` bucket_start column with `mode: 'number'` -- same BigInt coercion class

- **Source**: `apps/web/src/db/schema.ts:141`
- **Issue**: The `rate_limit_buckets` table has `bucket_start` as
  `bigint("bucket_start", { mode: 'number' })`. Bucket starts are `Date.now()` values
  (~1.7 trillion), well within `Number.MAX_SAFE_INTEGER` (~9 quadrillion). However,
  if the table were ever to store microsecond-precision timestamps or if Date.now()
  values grow significantly over the coming decades, this could theoretically lose
  precision. This is purely informational -- the current usage is safe.
- **Fix**: No action needed. Document that `mode: 'number'` is safe for millisecond
  epoch timestamps in the current era.
- **Confidence**: Low (informational)

### DEFERRED / INFORMATIONAL

- All items from C19F-LOW-01 through C19F-LOW-07 are carry-forward deferred items from
  prior cycles with no change in status.
- C20-MED-01 (insertId BigInt in admin-users.ts) is the same class as C19F-MED-02
  (insertId BigInt in sharing.ts) -- previously deferred.
- C20-LOW-01 (insertId BigInt in images.ts) is the same class at lower severity.

## Previously fixed findings (confirmed still fixed from cycles 20-21)

- C20-AGG-01: `countCodePoints` for password length validation -- FIXED
- C20-AGG-02: `isValidSlug()` in `getTopicBySlug` -- FIXED
- C20-AGG-03: Redundant `updated_at` in `updateImageMetadata` -- FIXED
- C20-AGG-04: `updateTag` catch block includes error object -- FIXED
- C20-AGG-05: `deleteTag` catch block includes error object -- FIXED
- C21-AGG-01: `searchImages` uses `countCodePoints` and removed unsafe `slice(0,200)` -- FIXED
- C21-AGG-02: `isValidTopicAlias` uses `countCodePoints` -- FIXED
- C21-AGG-03: `isValidTagName` uses `countCodePoints` -- FIXED

## NEW findings this cycle (not previously reported)

- C20-MED-01: `admin-users.ts` `Number(result.insertId)` BigInt coercion -- same class as previously deferred C19F-MED-02 but noted for the third site
- C20-LOW-01: `images.ts` `Number(result.insertId)` BigInt coercion -- lower severity variant
- C20-LOW-02: `tag_concat` comma separator assumption -- defensive improvement
- C20-LOW-03: `rateLimitBuckets` bigint mode: 'number' -- informational

The following aspects were specifically re-verified and found to be correct:

1. **Auth flow**: Login rate limiting with dual IP+account buckets, Argon2 timing-safe
   verification, session fixation prevention via transaction, `unstable_rethrow` for
   Next.js control flow -- all correct. Only `auth.ts` uses `unstable_rethrow` in its
   catch blocks, which is correct since it's the only action that calls `redirect()`.

2. **Upload flow**: TOCTOU prevention with pre-increment tracker, upload-processing
   contract lock, disk space pre-check, topic existence check, advisory lock for
   contract changes -- all correct.

3. **Sanitization**: `requireCleanInput`, `sanitizeAdminString`, `stripControlChars`,
   `UNICODE_FORMAT_CHARS` derivation from validation.ts import, null on rejection -- all
   correct and consistent.

4. **Privacy guards**: `publicSelectFields` derived from `adminSelectFields` with
   compile-time guard, GPS coordinates excluded, `filename_original` and
   `user_filename` excluded -- all correct.

5. **Rate-limit patterns**: Three documented rollback patterns consistently applied,
   DB-backed counters for cross-restart accuracy, symmetric rollback on over-limit --
   all correct.

6. **Action guards**: Every mutating server action calls `requireSameOriginAdmin()` and
   returns early on error. Read-only exports carry `@action-origin-exempt` comments.

7. **API auth**: `withAdminAuth` wrapper enforces origin + admin check, adds nosniff
   to successful responses -- all correct.

8. **File serving**: Symlink rejection, path traversal prevention, directory whitelist,
   realpath containment check, extension-to-directory mapping -- all correct.

9. **Image queue**: Advisory lock per job, claim check, conditional UPDATE, orphaned
   file cleanup, capped retry/claim-retry maps -- all correct.

10. **DB restore**: Advisory lock, upload-processing contract lock, restore maintenance
    flag, SQL scan, header validation, temp file cleanup -- all correct.

11. **Topic mutations**: Advisory lock for route segment changes, typed error classes,
    transaction-based slug rename, TOCTOU-safe alias creation -- all correct.

12. **Search**: `countCodePoints` used for query length validation, `stripControlChars`
   before validation, rate limiting with symmetric rollback -- all correct.

13. **Tag operations**: `requireCleanInput` before validation, slug collision detection,
   audit logging only on actual changes (affectedRows > 0) -- all correct.

## Carry-forward (unchanged -- existing deferred backlog)

- A17-MED-01: data.ts god module -- previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' -- previously deferred
- A17-MED-03: getImage parallel DB queries -- previously deferred
- A17-LOW-04: permanentlyFailedIds process-local -- previously deferred
- C14-MED-02/C19F-MED-01: search GROUP BY alignment -- FIXED (derived from searchFields)
- C14-MED-03/C19F-MED-02/C20-MED-01: insertId BigInt coercion -- previously deferred (now noted at all 3 sites)
- C14-LOW-02/C19F-LOW-05: lightbox.tsx showControls callback identity -- previously deferred
- C14-LOW-03/C19F-LOW-06: searchImages alias branch over-fetch -- previously deferred
- C14-LOW-01/C19F-LOW-07: original_file_size BigInt precision -- previously deferred (comment added in cycle 21)
- All other items from prior deferred lists

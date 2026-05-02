# Aggregate Review -- Cycle 19 Fresh Deep Review

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
lightbox, photo-viewer, search, image-manager.

This is the first fresh deep review after 18 prior cycles that collectively made ~73
commits. Many categories of issues are now exhausted. The remaining findings are
primarily LOW-severity or test-coverage improvements.

---

## Findings (sorted by severity)

### MEDIUM severity

#### C19F-MED-01: `searchGroupByColumns` array in data.ts is not verified against `searchFields` keys at compile time or runtime

- **Source**: `apps/web/src/lib/data.ts:1100-1119`
- **Issue**: The `searchFields` object and `searchGroupByColumns` array must contain
  the same columns (as noted in the MAINTENANCE NOTE comment at lines 1093-1096). While
  the columns are currently aligned, there is no compile-time or runtime enforcement.
  A developer adding a field to `searchFields` without updating `searchGroupByColumns`
  will get a silent ONLY_FULL_GROUP_BY error in production MySQL. This was previously
  flagged as C14-MED-02 and acknowledged but not fixed. The `tagNamesAgg` pattern for
  listing queries has a fixture test (`data-tag-names-sql.test.ts`); the search GROUP BY
  columns have no equivalent guard. Re-confirming as still present.
- **Fix**: Extract GROUP BY column list into a shared array derived from searchFields
  keys (or add a fixture test verifying alignment). This was the recommended fix in
  C14-MED-02 and remains unimplemented.
- **Confidence**: High

#### C19F-MED-02: `createGroupShareLink` uses `Number(result.insertId)` -- BigInt coercion risk on insertId

- **Source**: `apps/web/src/app/actions/sharing.ts:247`
- **Issue**: `result.insertId` from `mysql2` can be a `BigInt` when the auto-increment
  value exceeds `Number.MAX_SAFE_INTEGER`. The `Number()` coercion would silently lose
  precision. The code already has a `Number.isFinite(groupId)` guard that would catch
  `Infinity`, but silent precision loss would pass the guard with a wrong value. This was
  previously flagged as C14-MED-03 / C30-04 / C36-02 / C8-01 and deferred. Re-confirming
  as still present at the same location.
- **Fix**: Use `BigInt` comparison or validate with
  `result.insertId <= BigInt(Number.MAX_SAFE_INTEGER)` before coercion.
- **Confidence**: Medium (extremely unlikely at personal-gallery scale, but the silent
  precision loss is a correctness defect)

### LOW severity

#### C19F-LOW-01: `data.ts` is 1282 lines with mixed concerns -- repeated finding

- **Source**: `apps/web/src/lib/data.ts`
- **Issue**: Single file contains view-count buffering, privacy guards, queries, cursors,
  search, and SEO. 6 pieces of mutable state at module level. Previously flagged as
  A1-MED-07, A17-MED-01, C14-LOW-05. Still present. Known deferred item.
- **Fix**: Extract `data-view-count.ts`, `data-search.ts`, `data-seo.ts`.
- **Confidence**: High (confirmed still present)

#### C19F-LOW-02: CSP `style-src 'unsafe-inline'` in production -- repeated finding

- **Source**: `apps/web/src/lib/content-security-policy.ts:81`
- **Issue**: Production CSP includes `style-src 'self' 'unsafe-inline'`. Previously
  flagged as A1-MED-08, A17-MED-02, C14-LOW-04. Still present. Next.js + Tailwind +
  shadcn/ui require `'unsafe-inline'` unless nonce-based or hash-based style injection
  is implemented.
- **Fix**: Migrate to nonce-based `style-src` or document the tradeoff explicitly.
- **Confidence**: High (confirmed still present)

#### C19F-LOW-03: `getImage` runs 3-4 parallel DB queries -- pool exhaustion risk

- **Source**: `apps/web/src/lib/data.ts:819-851`
- **Issue**: Each photo view consumes 3-4 of the 10 pool connections. Under concurrent
  views, pool saturates. Previously flagged as A1-MED-01, A17-MED-03, C14-LOW-06.
  Still present. The UNION query optimization is tracked as plan 336.
- **Fix**: Combine prev/next into a single UNION query, or increase pool size.
- **Confidence**: High (confirmed still present)

#### C19F-LOW-04: `permanentlyFailedIds` are process-local -- lost on restart

- **Source**: `apps/web/src/lib/image-queue.ts:122-123`
- **Issue**: After restart, all permanently-failed images are re-enqueued, causing a
  burst of 3 retry attempts per image. Previously flagged as A17-LOW-04, C14-LOW-07.
  Still present.
- **Fix**: Add `processing_failed` column to `images` table, or a separate DB table.
- **Confidence**: High (confirmed still present)

#### C19F-LOW-05: `lightbox.tsx` `showControls` callback identity -- stale dependency

- **Source**: `apps/web/src/components/lightbox.tsx:95-119`
- **Issue**: The `showControls` callback includes `controlsVisible` in its dependency
  array, meaning the callback is recreated on every visibility change. Using a ref for
  `controlsVisible` would stabilize the callback identity and prevent re-subscribing
  event listeners. Previously flagged as C14-LOW-02. Still present. Low priority since
  the re-subscription is cheap.
- **Fix**: Consider using a ref for `controlsVisible` tracking alongside the state for
  rendering.
- **Confidence**: Low (minor performance concern, behavior is correct)

#### C19F-LOW-06: `searchImages` alias branch over-fetches -- repeated finding

- **Source**: `apps/web/src/lib/data.ts:1137-1138`
- **Issue**: `aliasRemainingLimit` is set to `remainingLimit`, but the tag and alias
  queries run in parallel. If the tag query returns `remainingLimit` results, the alias
  results are all duplicates discarded by the dedup Set. Previously flagged as
  C14-LOW-03. Still present. The tradeoff is documented and accepted at personal-gallery
  scale.
- **Fix**: No action needed -- documented tradeoff.
- **Confidence**: Low (informational only)

#### C19F-LOW-07: `original_file_size` BigInt precision -- safe under current limits

- **Source**: `apps/web/src/app/actions/images.ts:327`
- **Issue**: `file.size` is a `number` (JS), and the Drizzle schema column
  `original_file_size` uses `mode: 'number'`. Files over 2 GB exceed
  `Number.MAX_SAFE_INTEGER` in bytes. The current 200 MB per-file cap prevents this in
  practice. Previously deferred as C9-F01, C14-LOW-01.
- **Fix**: Add a code comment noting that `mode: 'number'` is safe because
  `UPLOAD_MAX_FILE_BYTES` (200 MB) is well within `Number.MAX_SAFE_INTEGER`.
- **Confidence**: Low (informational, already safe under current limits)

### DEFERRED / INFORMATIONAL

- All items from C19F-LOW-01 through C19F-LOW-07 are carry-forward deferred items from
  prior cycles with no change in status.
- C19F-MED-01 (search GROUP BY alignment) was previously C14-MED-02, still unfixed.
- C19F-MED-02 (insertId BigInt) was previously C14-MED-03 / C30-04 / C36-02, still deferred.

## Previously fixed findings (confirmed still fixed from cycle 20)

- C20-AGG-01: `countCodePoints` for password length validation -- FIXED
- C20-AGG-02: `isValidSlug()` in `getTopicBySlug` -- FIXED
- C20-AGG-03: Redundant `updated_at` in `updateImageMetadata` -- FIXED
- C20-AGG-04: `updateTag` catch block includes error object -- FIXED
- C20-AGG-05: `deleteTag` catch block includes error object -- FIXED

## NEW findings this cycle (not previously reported)

No new MEDIUM or higher findings were discovered. The codebase has been thoroughly
reviewed across 18 prior cycles. The two MEDIUM findings are re-confirmations of
previously known deferred items.

The following aspects were specifically re-verified and found to be correct:

1. **Auth flow**: Login rate limiting with dual IP+account buckets, Argon2 timing-safe
   verification, session fixation prevention via transaction, `unstable_rethrow` for
   Next.js control flow -- all correct.

2. **Upload flow**: TOCTOU prevention with pre-increment tracker, upload-processing
   contract lock, disk space pre-check, topic existence check before accepting uploads,
   advisory lock for contract changes -- all correct.

3. **Sanitization**: `requireCleanInput`, `sanitizeAdminString`, `stripControlChars`,
   `UNICODE_FORMAT_CHARS` derivation from validation.ts import, null on rejection -- all
   correct and consistent.

4. **Privacy guards**: `publicSelectFields` derived from `adminSelectFields` with
   compile-time `_SensitiveKeysInPublic` guard, GPS coordinates excluded from public
   responses, `filename_original` and `user_filename` excluded -- all correct.

5. **Rate-limit patterns**: Three documented rollback patterns (no-rollback-on-infra,
   rollback-on-infra, rollback-on-over-limit) consistently applied -- all correct.

6. **Action guards**: Every mutating server action calls `requireSameOriginAdmin()` and
   returns early on error. Read-only exports carry `@action-origin-exempt` comments.

7. **API auth**: `withAdminAuth` wrapper enforces origin + admin check for all API
   routes.

8. **File serving**: Symlink rejection, path traversal prevention via `SAFE_SEGMENT`,
   directory whitelist, `realpath` containment check -- all correct.

9. **Image queue**: Advisory lock per job, claim check before processing, conditional
   UPDATE after processing, orphaned file cleanup -- all correct.

10. **DB restore**: Advisory lock, upload-processing contract lock, restore maintenance
    flag, SQL scan for dangerous statements, header validation -- all correct.

## Carry-forward (unchanged -- existing deferred backlog)

- A17-MED-01: data.ts god module -- previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' -- previously deferred
- A17-MED-03: getImage parallel DB queries -- previously deferred
- A17-LOW-04: permanentlyFailedIds process-local -- previously deferred
- C14-MED-02/C19F-MED-01: search GROUP BY alignment -- previously deferred
- C14-MED-03/C19F-MED-02: createGroupShareLink BigInt coercion -- previously deferred
- C14-LOW-02/C19F-LOW-05: lightbox.tsx showControls callback identity -- previously deferred
- C14-LOW-03/C19F-LOW-06: searchImages alias branch over-fetch -- previously deferred
- C14-LOW-01/C19F-LOW-07: original_file_size BigInt precision -- previously deferred
- All other items from prior deferred lists (C22-04, C23-04, C25-06 through C25-14, C26-05)

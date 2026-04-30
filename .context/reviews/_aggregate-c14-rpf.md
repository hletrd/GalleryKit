# Aggregate Review — Cycle 14 RPF

## Review method

Deep review of all source files by a single agent across multiple perspectives
(code quality, performance, security, correctness, testing, architecture, UI/UX,
documentation). All key modules examined: rate-limit, image-queue, data,
sanitize, validation, proxy, session, auth, api-auth, action-guards, images
actions, public actions, sharing, admin-users, db-actions, topics, settings,
lightbox, photo-viewer, content-security-policy, request-origin, bounded-map,
csv-escape, blur-data-url, advisory-locks.

---

## Findings (sorted by severity)

### MEDIUM severity

#### C14-MED-01: `getImageByShareKey` fetches tags sequentially instead of in parallel with image
- **Location**: `apps/web/src/lib/data.ts:868-908`
- **Issue**: `getImageByShareKey` first fetches the image row (line 878-892), then
  fetches tags in a separate sequential query (line 895-901). The tags query
  could run in parallel with the image query since it only needs `image.id` which
  isn't available until the image query completes — but it COULD be fetched in the
  same round-trip using a LEFT JOIN like `getSharedGroup` does. The current
  pattern means `/s/[key]` page loads take 2 sequential DB round-trips instead of
  1. `getImage` uses `Promise.all` for its 3 parallel queries; this function
  doesn't benefit from that pattern since the tag query depends on the image ID.
  However, it could use a LEFT JOIN + GROUP_CONCAT approach like `getImagesLite`
  to collapse both into a single query.
- **Fix**: Rewrite `getImageByShareKey` to fetch image + tags in a single query
  using LEFT JOIN + GROUP_CONCAT, matching the pattern in `getImagesLite`. This
  eliminates one DB round-trip per shared-photo page load.
- **Confidence**: Medium

#### C14-MED-02: `searchImages` GROUP BY maintenance hazard — 11 columns must stay in sync
- **Location**: `apps/web/src/lib/data.ts:1076-1180`
- **Issue**: The `searchFields` object and two GROUP BY clauses (tag search at
  lines 1148-1160, alias search at lines 1168-1180) must list exactly the same
  columns. The code has a MAINTENANCE NOTE comment (line 1070-1075) but no
  compile-time or runtime enforcement. A developer adding a field to
  `searchFields` without updating BOTH GROUP BY clauses will get a silent
  ONLY_FULL_GROUP_BY error in production MySQL. The comment says "MUST also be
  added to BOTH GROUP BY clauses" but this is a human-only safeguard. The
  `tagNamesAgg` pattern for listing queries has a fixture test
  (`data-tag-names-sql.test.ts`); search queries have no equivalent guard.
- **Fix**: Extract the GROUP BY column list into a shared array (e.g.,
  `const searchGroupByColumns = [images.id, images.title, ...]`) and spread it in
  both `.groupBy()` calls. Add a fixture test that verifies the GROUP BY columns
  match `searchFields` keys.
- **Confidence**: High

#### C14-MED-03: `createGroupShareLink` uses `Number(result.insertId)` — BigInt coercion risk
- **Location**: `apps/web/src/app/actions/sharing.ts:243`
- **Issue**: `result.insertId` from `mysql2` can be a `BigInt` when the auto-increment
  value exceeds `Number.MAX_SAFE_INTEGER`. While this is extremely unlikely for a
  personal gallery, the `Number()` coercion would silently lose precision. The
  code already has a `Number.isFinite(groupId)` guard that would catch `Infinity`,
  but silent precision loss (e.g., `Number(9007199254740993n)` → `9007199254740992`)
  would pass the guard with a wrong value. This was previously flagged as
  C30-04 / C36-02 / C8-01 and deferred.
- **Fix**: Use `BigInt` comparison or validate with
  `result.insertId <= BigInt(Number.MAX_SAFE_INTEGER)` before coercion. At minimum,
  add a comment acknowledging the deferral and the exit criterion (gallery
  exceeds 2^53 shared groups).
- **Confidence**: Medium (previously deferred, re-confirming still present)

### LOW severity

#### C14-LOW-01: `uploadImages` `original_file_size` stored as `file.size` — BigInt precision risk
- **Location**: `apps/web/src/app/actions/images.ts:328`
- **Issue**: `file.size` is a `number` (JS), and the Drizzle schema column
  `original_file_size` uses `mode: 'number'`. Files over 2 GB exceed
  `Number.MAX_SAFE_INTEGER` in bytes (though the 200 MB per-file cap prevents
  this in practice). If the per-file cap is ever raised above ~9 PB, the value
  would silently lose precision. The current 200 MB cap makes this impossible,
  but the schema's `mode: 'number'` is worth documenting as intentionally safe
  given the upload limits.
- **Fix**: Add a code comment noting that `mode: 'number'` is safe because
  `UPLOAD_MAX_FILE_BYTES` (200 MB) is well within `Number.MAX_SAFE_INTEGER`.
  Previously deferred as C9-F01.
- **Confidence**: Low (informational, already safe under current limits)

#### C14-LOW-02: `lightbox.tsx` `showControls` callback has stale `controlsVisible` in dependency array
- **Location**: `apps/web/src/components/lightbox.tsx:95-119`
- **Issue**: The `showControls` callback includes `controlsVisible` in its
  dependency array. When `controlsVisible` is `true` and the user moves the mouse,
  the early return `if (!forceReset && controlsVisible && now - lastControlRevealRef.current < 500)`
  prevents excessive state updates. However, the dependency on `controlsVisible`
  means the callback is recreated on every visibility change. This is a minor
  performance concern — using a ref for `controlsVisible` (like
  `lastControlRevealRef`) would stabilize the callback identity and prevent
  re-subscribing event listeners on each visibility toggle. The current behavior
  is correct but slightly wasteful.
- **Fix**: Consider using a ref for `controlsVisible` tracking alongside the
  state for rendering, so the callback doesn't change on every toggle. Low
  priority since the re-subscription is cheap.
- **Confidence**: Low

#### C14-LOW-03: `data.ts` `searchImages` over-fetches on the alias branch when tag results are non-empty
- **Location**: `apps/web/src/lib/data.ts:1137-1138`
- **Issue**: `aliasRemainingLimit` is set to `remainingLimit` (the gap between
  the main query and the effective limit), but the tag and alias queries run in
  parallel. If the tag query returns `remainingLimit` results, the alias results
  are all duplicates and are discarded by the dedup Set. The alias query
  fetches `remainingLimit` rows unnecessarily. This is documented in the code
  (lines 1116-1124) as an acceptable tradeoff. Re-confirming as LOW.
- **Fix**: No action needed — the tradeoff is documented and accepted at
  personal-gallery scale.
- **Confidence**: Low (informational only)

#### C14-LOW-04: `CSP style-src 'unsafe-inline'` in production — repeated finding
- **Location**: `apps/web/src/lib/content-security-policy.ts:82`
- **Issue**: Production CSP includes `style-src 'self' 'unsafe-inline'`. This
  enables CSS-based data exfiltration vectors (e.g., attribute selectors sending
  data via `background-image: url()`). Previously flagged as A1-MED-08,
  A17-MED-02. Still present. Next.js + Tailwind + shadcn/ui require
  `'unsafe-inline'` for dynamic class application unless nonce-based or
  hash-based style injection is implemented.
- **Fix**: Migrate to nonce-based `style-src` or document the tradeoff
  explicitly in the CSP file. This is a known deferred item.
- **Confidence**: High (confirmed still present)

#### C14-LOW-05: `data.ts` is 1258 lines with mixed concerns — repeated finding
- **Location**: `apps/web/src/lib/data.ts`
- **Issue**: Single file contains view-count buffering, privacy guards, queries,
  cursors, search, and SEO. 6 pieces of mutable state at module level.
  Previously flagged as A1-MED-07, A17-MED-01. Still present.
- **Fix**: Extract `data-view-count.ts`, `data-search.ts`, `data-seo.ts`.
  Known deferred item.
- **Confidence**: High (confirmed still present)

#### C14-LOW-06: `getImage` runs 3-4 parallel DB queries — pool exhaustion risk
- **Location**: `apps/web/src/lib/data.ts:819-851`
- **Issue**: Each photo view consumes 3-4 of the 10 pool connections. Under
  concurrent views, pool saturates. Previously flagged as A1-MED-01, A17-MED-03.
  Still present. The UNION query optimization is tracked as plan 336.
- **Fix**: Combine prev/next into a single UNION query, or increase pool size.
  Known deferred item.
- **Confidence**: High (confirmed still present)

#### C14-LOW-07: `permanentlyFailedIds` are process-local — lost on restart
- **Location**: `apps/web/src/lib/image-queue.ts:122-123`
- **Issue**: After restart, all permanently-failed images are re-enqueued,
  causing a burst of 3 retry attempts per image. Previously flagged as
  A17-LOW-04. Still present.
- **Fix**: Add `processing_failed` column to `images` table, or a separate DB
  table. Known deferred item.
- **Confidence**: High (confirmed still present)

### DEFERRED / INFORMATIONAL

- C14-LOW-03: search alias over-fetch — documented tradeoff, no action needed.
- C14-LOW-04: CSP unsafe-inline — previously deferred, no change.
- C14-LOW-05: data.ts god module — previously deferred, no change.
- C14-LOW-06: getImage parallel queries — previously deferred, no change.
- C14-LOW-07: permanentlyFailedIds process-local — previously deferred, no change.
- C14-LOW-01: original_file_size BigInt — previously deferred (C9-F01), safe under current limits.
- C14-MED-03: insertId BigInt coercion — previously deferred (C30-04/C36-02/C8-01), extremely unlikely at gallery scale.

## Previously fixed findings (confirmed still fixed)

- A1-HIGH-01: Login rate-limit rollback on infrastructure errors — FIXED
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED
- A1-MED-06: View-count buffer cap enforcement — FIXED
- A1-MED-04: sanitizeAdminString returns null on rejection — FIXED
- A17-LOW-01: image-manager.tsx catch blocks — FIXED (all have console.warn)
- A17-LOW-02: storage console.log — FIXED (changed to console.debug)
- A17-LOW-03: Claim retry timer unref — FIXED (already had .unref())
- A17-LOW-05: UNICODE_FORMAT_CHARS regex sync — FIXED (derived from import)
- A17-LOW-06: CLAUDE.md "single-user admin" — FIXED (updated to "multiple root admins")
- A17-LOW-07: CLAUDE.md missing auth-rate-limit.ts — FIXED (added to table)
- C18-MED-01: searchImagesAction re-throws on DB error — FIXED (returns structured error)

# Architect — Cycle 2 Deep Review

## C2-AR-01 (Medium/Medium): `normalizeStringRecord` bypasses the `sanitizeAdminString` defense-in-depth pipeline

- **File**: `apps/web/src/lib/sanitize.ts:35-55`
- **Issue**: There are now two parallel sanitization paths for admin-controlled strings: `sanitizeAdminString` (which rejects Unicode formatting) and `normalizeStringRecord` (which silently strips them). Both are used for admin-controlled persistent data, but only `sanitizeAdminString` enforces the rejection policy. This creates an architectural inconsistency where the defense-in-depth posture depends on which function the developer chooses. A new admin string entry point using `normalizeStringRecord` would silently accept and strip formatting characters without rejecting them, undermining the C7R-RPL-11 / C3L-SEC-01 policy.
- **Fix**: Unify the two paths: either add a `rejected` flag to `normalizeStringRecord` (matching `sanitizeAdminString`'s API) or have `normalizeStringRecord` call `sanitizeAdminString` internally for each value.
- **Confidence**: High

## C2-AR-02 (Medium/Medium): `data.ts` still growing — 1137 lines with view count buffer, privacy guards, queries, cursors, search, and SEO

- **File**: `apps/web/src/lib/data.ts`
- **Issue**: This was flagged in cycle 1 (A1-MED-07) and deferred. The file has grown from 1123 to 1137 lines since then. The concern remains: this is a merge-conflict hotspot and a cognitive burden for contributors. The view count buffer logic (lines 1-175) is particularly self-contained and could be extracted.
- **Fix**: Extract the view count buffer logic into `lib/view-count-buffer.ts`. This is a clean extraction that doesn't risk breaking cached query wrappers.
- **Confidence**: Medium

## C2-AR-03 (Low/Medium): Rate limit architecture has three distinct patterns (rollback-on-error, no-rollback-on-error, rollback-on-limit)

- **File**: Multiple files (`auth.ts`, `public.ts`, `sharing.ts`, `admin-users.ts`)
- **Issue**: The codebase now has three distinct rate-limit patterns:
  1. No rollback on infrastructure error (auth.ts — C1F-CR-04 fix)
  2. Rollback on infrastructure error (public.ts loadMore/search — intentional for read paths)
  3. Rollback on over-limit only (sharing.ts — C6R-RPL-03 pattern)
  Each pattern has different security/reliability tradeoffs, but there's no centralized documentation of which pattern to use when. A developer adding a new rate-limited action must study all three patterns to choose the right one.
- **Fix**: Add a doc comment block in `lib/rate-limit.ts` explaining the three patterns and when to use each.
- **Confidence**: Medium

## C2-AR-04 (Medium/Medium): `getAdminImagesLite` selects all admin fields including EXIF for listing — wasteful for grid display

- **File**: `apps/web/src/lib/data.ts:639-661`
- **Issue**: The admin listing query fetches all `adminSelectFields` including 12+ EXIF columns, but the admin dashboard grid only displays a small subset (id, filenames, topic, processed, date). This wastes DB bandwidth and InnoDB buffer pool. The pattern of using the full admin select for listing queries is architecturally inconsistent with the public listing queries, which use the lean `publicSelectFields`.
- **Fix**: Create an `adminListSelectFields` that omits EXIF and other non-display columns, similar to how `publicSelectFields` omits PII fields for listing queries.
- **Confidence**: High

## C2-AR-05 (Low/Low): Process-local `permanentlyFailedIds` set is lost on restart

- **File**: `apps/web/src/lib/image-queue.ts:116`
- **Issue**: The `permanentlyFailedIds` set is in-memory only and is lost on process restart. After a restart, previously permanently-failed images will be re-discovered by bootstrap and re-enqueued, causing another 3 failed attempts before being added to the set again. This is a bounded loop (3 retries per restart) but could cause unnecessary CPU/Disk I/O on restart if many images are permanently failing.
- **Fix**: Consider persisting permanently-failed IDs in a DB table or file. Low priority given the bounded nature.
- **Confidence**: Low

## Summary

- Total findings: 5
- Medium: 3
- Low: 2

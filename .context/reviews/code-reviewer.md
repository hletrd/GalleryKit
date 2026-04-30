# Code Reviewer — Cycle 19

## Review method
Direct deep review of all key source files: data.ts, image-queue.ts, session.ts,
validation.ts, sanitize.ts, api-auth.ts, proxy.ts, request-origin.ts, bounded-map.ts,
rate-limit.ts, auth-rate-limit.ts, content-security-policy.ts, csv-escape.ts,
db-actions.ts, schema.ts, upload-tracker-state.ts, public.ts, auth.ts, advisory-locks.ts,
safe-json-ld.ts.

## GATE STATUS (carried forward, verified still green)
- eslint: clean
- tsc --noEmit: clean
- build: success
- vitest: 574 tests passing
- lint:api-auth: OK
- lint:action-origin: OK

## Previously fixed findings (confirmed still fixed)
- C9-CR-01: viewCountRetryCount iteration-during-deletion — FIXED (collect-then-delete applied)
- C9-CR-02: pruneRetryMaps iteration-during-deletion — FIXED (collect-then-delete applied)
- C16-CT-01: image-queue.ts contradictory comment — FIXED (comment updated)
- C16-CT-02: instrumentation.ts console.log — FIXED (changed to console.debug)
- C18-MED-01: searchImagesAction re-throws on DB error — FIXED (returns structured error)

## New Findings

### C19-CR-01 (Medium / Medium): `getImageByShareKeyCached` wraps `getImageByShareKey` with `cache()` but `getImageByShareKey` accepts `incrementViewCount` — cached calls silently skip view-count increments

- **Source**: Direct code review of `apps/web/src/lib/data.ts:1231`
- **Location**: `getImageByShareKeyCached = cache(getImageByShareKey)`
- **Issue**: `getImageByShareKey` accepts an `options?.incrementViewCount` parameter that controls whether `bufferGroupViewCount` is called. When `cache()` wraps this function, React deduplicates calls with the same arguments within a single server render. If two different call sites in the same request pass different `incrementViewCount` values, only the first call's behavior wins. More importantly, if a future call site uses the cached version and relies on the view count being incremented, it may not be — the cached result returns the data without re-executing the function body. Currently the only consumer is the shared-photo page which passes `incrementViewCount: true` explicitly, so this is a latent risk rather than an active bug.
- **Fix**: Either remove the `cache()` wrapper from `getImageByShareKey` (since shared-photo pages are not deduplicated within the same request in practice), or document the caching caveat prominently at the `getImageByShareKeyCached` definition site.
- **Confidence**: Medium (latent risk, not an active bug)

### C19-CR-02 (Low / Medium): `adminUsers.updated_at` column added but not selected in `getCurrentUser` or `getAdminUserWithHash`

- **Source**: Direct code review of `apps/web/src/app/actions/auth.ts:35-39,44-49`
- **Location**: `getCurrentUser()` and `getAdminUserWithHash()` select statements
- **Issue**: The `updated_at` column was added to `adminUsers` in the current uncommitted changes (C16-LOW-14). However, neither `getCurrentUser()` nor `getAdminUserWithHash()` selects it. This is consistent because the column is `onUpdateNow()` and is not used in auth logic, but if a future feature needs to check "last password change" time, it will need this column. Currently no code references it — it's a schema-only addition that auto-updates.
- **Fix**: No fix needed now — the column auto-updates on row changes. When a "last password change" feature is built, add the column to the relevant select. This finding is informational only.
- **Confidence**: Low (informational)

### C19-CR-03 (Low / Low): `buildImageConditions` validates topic slug with regex but `getImageCount` has its own separate regex — duplication

- **Source**: Direct code review of `apps/web/src/lib/data.ts:404,441`
- **Location**: `getImageCount` line 404 and `buildImageConditions` line 441
- **Issue**: Both `getImageCount` and `buildImageConditions` validate the topic parameter with `/^[a-z0-9_-]+$/.test(topic) || topic.length > 100`. This duplicated regex is fragile — if one is updated, the other might not be. The existing `isValidSlug` function in validation.ts provides the same check with `slug.length > 0 && slug.length <= 100`.
- **Fix**: Replace both inline regex checks with `!isValidSlug(topic)` from `@/lib/validation` for consistency.
- **Confidence**: Low

## Carry-forward (unchanged — existing deferred backlog)
- A17-MED-01: data.ts god module — previously deferred
- A17-MED-02: CSP style-src 'unsafe-inline' — previously deferred
- A17-MED-03: getImage parallel DB queries — previously deferred
- A17-LOW-04: permanentlyFailedIds process-local — previously deferred
- A17-LOW-08: Lightbox auto-hide UX — previously deferred
- A17-LOW-09: Photo viewer sidebar layout shift — previously deferred

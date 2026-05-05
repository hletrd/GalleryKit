# Test Engineer — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: Test coverage gaps, flaky tests, TDD opportunities.

---

## FINDINGS

### GAP-01: No test coverage for check-public-route-rate-limit.ts (Medium)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`

The lint gate is exported as `checkPublicRouteSource(content, relative)` for testing, but there is no corresponding test file. The gate currently passes on all existing routes, but edge cases (export specifiers, non-function exports, string-literal exempt bypass) are untested.

**Fix**: Add `__tests__/check-public-route-rate-limit.test.ts` with fixture cases covering:
- Function declaration export with rate-limit helper (pass)
- Variable export with rate-limit helper (pass)
- Export specifier form `export { handler as POST }` (currently false-negative — should be caught)
- Non-function export named POST (currently false-positive — should not fail)
- Exempt tag in comment (pass)
- Exempt tag in string literal (currently false-positive — should fail)
- No mutating handlers (pass)

---

### GAP-02: Service Worker HTML cache expiry is untested (Medium)
**File**: `apps/web/public/sw.template.js`

The service worker logic for HTML caching is not covered by automated tests. The `sw-cached-at` bug (dead code) would have been caught by a test that verifies:
1. Cached HTML responses include the `sw-cached-at` header.
2. Responses older than 24 hours return 503.

**Fix**: Add Playwright or unit tests for service worker cache behavior, or at minimum verify the header is present in cached responses.

---

### GAP-03: No test for OG photo fetch timeout (Low)
**File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`

The internal `fetch(photoUrl)` call has no timeout. There is no test verifying graceful degradation when the photo derivative is slow or unavailable.

---

## CURRENT TEST STATUS

- Vitest: 118 files, 1012 tests — ALL PASSING
- ESLint: PASSING
- lint:api-auth: PASSING
- lint:action-origin: PASSING
- lint:public-route-rate-limit: PASSING
- typecheck:app: PASSING
- typecheck:scripts: PASSING
- Playwright e2e: FAILS due to missing MySQL (infrastructure, not code)

## VERDICT

Test coverage is excellent for the data layer, auth, and action surfaces. Three gaps identified around new/under-tested components (SW cache, public-route lint gate, OG timeout). The existing test suite is comprehensive and green.

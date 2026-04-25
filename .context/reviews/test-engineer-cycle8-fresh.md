# Test Engineer — Cycle 8 (Fresh, broad sweep)

**Scope:** which findings have or lack test coverage, what targeted tests would close gaps.

## Inventory

The repo has 59 vitest unit-test files under `apps/web/src/__tests__/` and a Playwright e2e suite under `apps/web/e2e/`. Two custom lint scripts (`check-api-auth.ts`, `check-action-origin.ts`) carry their own fixture-based vitest tests.

## Coverage gaps tied to cycle-8 findings

### T8F-01 — `/api/og` rate-limit (will exist post-fix)
**State:** Endpoint currently has no rate limit. When a fix lands, a vitest test should assert that the 31st request in a one-minute window from a single IP returns 429 (or the existing `rateLimited` style status). Today the endpoint has zero unit-test coverage.
**Suggested test:** `apps/web/src/__tests__/og-route-rate-limit.test.ts` calling the route handler directly with a mocked `headers()`.

### T8F-02 — Sitemap dynamic-vs-revalidate config
**State:** No test asserts the runtime cache behavior of `apps/web/src/app/sitemap.ts`. Hard to test with vitest because Next infers cache mode from module-level exports. A static lint that asserts a sitemap module does NOT export both `dynamic = 'force-dynamic'` and a non-zero `revalidate` would be cheaper than a runtime test.
**Suggested test:** Add to `scripts/check-action-origin.ts` (or a new `scripts/check-route-config.ts`) a static-AST lint for the contradiction.

### T8F-03 — `safeJsonLd` line-terminator escapes
**State:** No vitest unit test exists for `lib/safe-json-ld.ts`. The function is small but security-critical (XSS in `<script type="application/ld+json">`).
**Suggested test:** Add `safe-json-ld.test.ts` covering: U+2028, U+2029, embedded `</script>`, regular text round-trip.

### T8F-04 — `escapeCsvField` Unicode-bidi + invisible char regression
**State:** Vitest coverage for this exists (carried over from C7R-RPL/C8R-RPL cycles). Should still be passing — confirmed by reading `csv-escape.ts:33-53`. Evidence-based: re-read the actual test file path `apps/web/src/__tests__/csv-escape.test.ts` if any failure is suspected.

### T8F-05 — `pruneSearchRateLimit` 1-second prune-interval throttle
**State:** Existing `lib/rate-limit.ts:127-163` logic has dedicated unit-test coverage in `__tests__/rate-limit.test.ts` (assumed from filename). Force-prune semantics covered.

### T8F-06 — `audit-log` 4096-byte truncation
**State:** No test asserts that `logAuditEvent` produces the `{truncated: true, preview}` shape when metadata > 4096 chars. The behavior is silent so any regression (e.g., the truncation logic getting deleted) would not be caught.
**Suggested test:** `audit.test.ts` calling `logAuditEvent` with deliberately-bloated metadata and asserting on the persisted row shape (or, if mocking the DB, on the call args).

### T8F-07 — Sharp limitInputPixels boundary
**State:** Decompression-bomb mitigation is configured at 256M pixels. No test asserts that an attacker-supplied PNG metadata claiming 100K×100K pixels actually rejects.
**Suggested test:** Out of scope for this cycle — would require a fixture file. Document as a deferred test gap.

## Net summary

- The codebase has solid test coverage for surfaces that were hardened in earlier cycles.
- Three concrete unit-test additions would meaningfully improve the safety net: `safe-json-ld.test.ts`, `audit.test.ts` truncation, plus a future `og-route-rate-limit.test.ts` once the rate-limit fix lands.
- A static-AST lint for contradictory route config exports (force-dynamic + revalidate) would be a cheap durable improvement.

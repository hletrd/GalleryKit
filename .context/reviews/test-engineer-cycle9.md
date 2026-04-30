# Test Engineer — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5`

## Findings

**Status: zero new MEDIUM/HIGH findings.**

### T9-01 — Plan 237 (`safe-json-ld.ts` vitest) is scheduled but unlanded (LOW / High)
- **Citation:** `.context/plans/plan-237-cycle8-fresh-safe-json-ld-test.md`
- **Issue:** AGG8F-26 scheduled a vitest unit test for the security-critical
  `safe-json-ld.ts` helper. No `safe-json-ld.test.ts` file exists.
- **Action this cycle:** **IMPLEMENT**. Tiny scope (4 assertion cases).

### T9-02 — OG route HTTP behaviour has unit coverage only on the rate-limit helper (LOW / Medium)
- **Citation:** `apps/web/src/__tests__/og-rate-limit.test.ts`
- **Issue:** `preIncrementOgAttempt` and `pruneOgRateLimit` are well-covered.
  The route's HTTP-level behaviour (200 + ETag, 304 on If-None-Match,
  400 on bad slug, 404 on missing topic, 429 on over-budget) has no
  integration test. Existing repo convention rarely tests route handlers
  at the integration level (Next App Router routes are exercised by
  Playwright in e2e).
- **Action:** **DEFER**. Conforms to repo testing convention. Exit
  criterion: a regression in OG cache headers escapes review.

## Existing test inventory (snapshot)

- `__tests__/`: 60 files, 393 assertions passing.
- `e2e/`: Playwright suites cover login, upload, gallery, photo, share.
- Cycle 8 added `og-rate-limit.test.ts`. Cycle 9 should add
  `safe-json-ld.test.ts` per plan 237.

## Summary

One small actionable finding (T9-01 → implement plan 237). Everything else
holds.

# Test Engineer — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: test coverage gaps, flaky tests, TDD opportunities.

## Current test surface

- Vitest unit tests: 45 files in `apps/web/src/__tests__/**`.
- Playwright E2E: 5 files in `apps/web/e2e/**`.
- Lint scripts: `lint:api-auth`, `lint:action-origin` as custom static checks.

## Findings

### C4R-RPL2-TE-01 — No explicit test that `db/index.ts` handles `SET group_concat_max_len` failure [LOW] [MEDIUM]

**File:** `apps/web/src/db/index.ts:28-30`

If the `SET` query fails, there's no error handler. A unit test would be hard (mysql2 pool event injection), but at a minimum a test that validates the listener exists with a `.catch` handler (string-level assertion à la auth-rethrow.test.ts) is feasible.

**Proposed test:** add `apps/web/src/__tests__/db-pool-connection-handler.test.ts` that reads `db/index.ts` source and asserts the connection-listener callback includes a `.catch(`.

### C4R-RPL2-TE-02 — No test that `safeJsonLd` escapes U+2028/U+2029 [LOW] [LOW]

Since `safeJsonLd` currently does not escape these characters, any test written today would codify the bug. After the CQ-03/SEC-01 fix, add a test confirming:
```ts
expect(safeJsonLd({ x: ' ' })).toMatch(/\\u2028/);
expect(safeJsonLd({ x: ' ' })).toMatch(/\\u2029/);
expect(safeJsonLd({ x: '<script>' })).toMatch(/\\u003c/);
```

### C4R-RPL2-TE-03 — settings.ts barrel-export inconsistency not covered by lint [LOW] [LOW]

No test asserts that `@/app/actions` barrel includes the server actions consumers should use. A `scripts/check-actions-barrel.ts` lint-style script could check that every function in `app/actions/*.ts` is re-exported OR explicitly marked as "internal only" in a comment.

### C4R-RPL2-TE-04 — Playwright tests do not exercise the JSON-LD script output [LOW] [LOW]

Current `public.spec.ts` doesn't assert the `<script type="application/ld+json">` block exists and contains the expected data. Adding a coverage assertion would guard against accidental regression of the SEO surface (which is critical for discoverability).

### C4R-RPL2-TE-05 — No test exercises the view-count flush backoff path [LOW] [LOW]
**File:** `apps/web/src/lib/data.ts:20-95`

The backoff branch (`consecutiveFlushFailures >= 3`) changes the flush interval. Unit test would mock `db.update` to always throw and assert `getNextFlushInterval()` escalates. Small, valuable coverage addition.

## Positives

- `auth-rethrow.test.ts` is an exemplary pattern: reads source and asserts structural invariant via regex. More tests should follow this pattern.
- Privacy-fields test at `__tests__/privacy-fields.test.ts` exists and guards the compile-time guard at runtime too.
- Rate-limit tests cover pruning, rollback, and the pre-increment TOCTOU fix.

## Confidence Summary

- 5 LOW coverage gaps; 0 flaky tests observed.

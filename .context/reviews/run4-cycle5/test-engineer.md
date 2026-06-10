# Test-engineer + gates verifier — Run-4 Cycle 5

## Gate baseline (clean tree, captured this cycle)

| Gate | Result |
|---|---|
| `npm test` (vitest) | **1616/1616 PASS** (165 files, 158 s) |
| `npm run typecheck` | PASS |
| `npm run lint` (eslint) | PASS (0 errors, 0 warnings) |
| `npm run lint:api-auth` | PASS |
| `npm run lint:action-origin` | PASS |
| `npm run lint:public-route-rate-limit` | PASS |
| build / e2e | run during PROMPT 3 after fixes (per loop convention) |

## Flakiness audit of cycle-4's new suites

- `serve-upload-settings-debounce.test.ts` (5 cases): per-test
  `mkdtemp` + `vi.resetModules` isolation, `vi.useRealTimers()` restored
  in `afterEach`, module-transform warm-up in `beforeAll` with a 120 s
  budget (the R4C1 TEST-R4C1-07 lesson applied). The hung-refresh case
  parks an unresolved promise inside the mocked config module and never
  awaits it on the assertion path — no timer races. **No flake risk
  found.**
- `sales-refund-convergence.test.ts` (4 cases) + typed mock fix
  (`c66fed47`): plain async-fn mocks, no timers, no fs. Clean.
- `lr-upload-hdr-gate.test.ts` containment additions +
  `client-source-contracts.test.ts` Enter-guard pin +
  `smart-collections.test.ts` scalar cases + `analytics.test.ts`
  trailing-dot cases: source-contract / pure-function styles, no shared
  state. Clean.
- Full run is green at 1616 — no intermittent signal observed this cycle.

## Coverage-gap findings

### TEST-R4C5-06 — ZERO coverage on smart-collection pagination (enabled COR-R4C5-01) — MED-gap / Confidence: High
- grep over `__tests__/` finds no reference to
  `loadMoreSmartCollectionImages` OR `getImagesForSmartCollection`; the
  e2e suite has no smart-collection fixture either. Both halves of
  COR-R4C5-01 (cursor-object coerced to offset 0; +1 double-lookahead at
  the boundary) were silently unreachable by the gate.
- Required with the fix (fold into the fix task):
  1. Action-level behavioral cases with a mocked data layer + mocked
     `next/headers`: cursor object → passes a NORMALIZED cursor to the
     helper (not offset 0); unparseable object cursor → `status:
     'invalid'` (mirrors `loadMoreImages`); numeric offset path
     preserved; private/unknown slug rollback path intact.
  2. Helper-level case pinning the single-lookahead contract: exactly
     `limit + 1` remaining rows → `hasMore` true and no dropped row at
     the boundary (kills the size ≡ 1 mod 30 data-loss shape).
  3. A source-contract guard that `loadMoreSmartCollectionImages` passes
     `safeLimit` (not `safeLimit + 1`) — cheap drift lock, same style as
     the cycle6/8 contract suites.

### TEST-R4C5-07 — download-route FileHandle leak contract missing the stat-throw path — LOW-gap / Confidence: High
- `refund-clears-download-token.test.ts` (R4C4-06) pins close-on-claim-
  failure / close-on-410 / close-on-stream-setup-failure but not
  close-on-`stat()`-throw (the COR-R4C5-04 window). Add one case with the
  fix (folds into that task).

### Folded test additions for the small fixes
- `analytics.test.ts`: `github.com..` (and `github.com...`) →
  `github.com` once LOW-R4C5-05 lands.
- A regression-lock that `actions/collections.ts` no longer exports
  `getSmartCollections` (SEC-R4C5-02) — a one-line import-shape assertion
  in the existing smart-collections suite keeps the dead endpoint from
  resurrecting.

## Notes
- The live-MySQL verification this cycle (mysql2 default `FOUND_ROWS` →
  no-op UPDATE reports `affectedRows = 1`) is exactly the class of fact a
  unit test CANNOT pin (driver+server integration). No test scheduled;
  the knowledge is recorded in the code-reviewer file and the
  document-specialist correction note instead.

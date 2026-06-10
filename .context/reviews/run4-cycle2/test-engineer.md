# Run-4 Cycle 2 — test-engineer angle (+ verifier on gates)

## Gate baseline (clean tree, HEAD = 4f27b98d)
- vitest: **PASS — 160 files / 1564 tests** (171 s; no flakes on this run; last cycle's
  TEST-R4C1-06 vi.waitFor fix holding).
- eslint: PASS with **1 warning** — `@next/next/no-img-element` at
  `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:79` (see UX-R4C2-03 in
  the designer file; the fix planned there removes the warning at the root rather than
  suppressing).
- typecheck (app + scripts): PASS.
- lint:api-auth / lint:action-origin / lint:public-route-rate-limit: PASS.
- build / e2e: deferred to PROMPT 3 (build embeds typecheck; e2e needs the seeded
  container) — both were green at the end of last cycle on this tree.

## Test-gap findings

### TEST-R4C2-09 — failure-path persistence has no value-format contract (HIGH-gap / High)
- `image-queue-permanent-failure.test.ts` mocks `db.update` and asserts the update was
  *called*, but never asserts the SHAPE of `failed_at`. That is exactly why COR-R4C2-01
  (ISO-`Z` string rejected by MySQL strict mode — verified live this cycle) survived ~18
  review cycles: the only consumer that would have caught it is a real strict-mode MySQL.
- Required: when fixing COR-R4C2-01, add an assertion that the written `failed_at`
  matches `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` (MySQL DATETIME literal), plus a unit
  test for the new formatting helper (component round-trip, zero-padding, no `T`/`Z`).
- Generalization: greped the repo for other `toISOString()` values flowing into
  `datetime(mode:'string')` columns — `image-queue.ts:477` is the only offender; the
  other ISO usages are feeds/CSV filenames/JSON-LD (string surfaces, fine) and
  `timestamp()` columns receive `Date` objects which mysql2 serializes natively.

### TEST-R4C2-10 — scanner fixture suite lacks the "exempt comment on mutating body" case (MED-gap / High)
- `check-action-origin.test.ts` covers guard-present/guard-missing/aliased-export/arrow
  forms, but has NO case where an exempt comment sits on a body containing
  `db.insert`/`logAuditEvent`. After SEC-R4C2-02's scanner hardening, add fixtures:
  (a) exempt + mutating body → FAILED with the new message; (b) exempt + select-only
  body → SKIP (unchanged); (c) no-comment + guard → OK (regression).

### Observations (no action this cycle)
- `stripe-webhook-source.test.ts` is a source-contract suite — extend it for the
  `resolvedEmail` log fix (SEC-R4C2-05) with a one-line regex assertion.
- `lr-tokens-action.test.ts` (added last cycle) mocks `createToken` — the label
  code-point validation (COR-R4C2-04) needs a new case: 129-code-point emoji label →
  error; 128 → accepted and passed through unsliced.
- e2e admin auto-enable logic in `e2e/helpers.ts` re-verified: local plaintext
  credentials auto-enable; remote stays opt-in. Sound.
- Vitest import cost remains dominated by sharp-adjacent suites (import 626 s aggregate
  across workers) but the wall-clock 171 s is acceptable; no test exceeds its timeout
  after last cycle's serve-upload import fix. No action.

# Run-4 Cycle 3 — test-engineer angle

Scope: gate baseline on the clean tree, coverage-gap analysis for every finding
raised this cycle, flake sweep of the suites touching the affected surfaces,
review of the repo's established source-contract test pattern.

## Gate baseline (clean tree, before any cycle-3 change)
- vitest: PASS — 161 files, 1576/1576 tests
- typecheck (app + scripts): PASS
- eslint: PASS — 0 errors, 0 warnings
- lint:api-auth / lint:action-origin / lint:public-route-rate-limit: PASS
  (validated on baseline run; re-run with build + e2e during PROMPT 3)

## Coverage-gap findings

### TEST-R4C3-07 — no wiring contract on the uploads GET/HEAD method pass-through
- **Severity/Confidence:** MED-gap / High
- **Evidence:** `serve-upload.test.ts` exercises `serveUploadFile` directly
  (unit level) — nothing locks the two ROUTE FILES' pass-through of the
  `method` argument, which is exactly where COR-R4C3-01 drifted (one twin
  updated for R20-L1, the other not; no gate noticed for 8+ cycles).
- **Fix:** add a source-contract test (repo-established pattern — cf.
  `stripe-webhook-source.test.ts`, `refund-clears-download-token.test.ts`,
  `process-image-blur-wiring.test.ts`) asserting BOTH
  `app/uploads/[...path]/route.ts` and
  `app/[locale]/(public)/uploads/[...path]/route.ts` HEAD exports invoke
  `serveUploadFile(..., 'HEAD')` and GET exports do not pass `'HEAD'`.

### TEST-R4C3-08 — webhook logging not gated on insert outcome (no test)
- **Severity/Confidence:** LOW-MED-gap / High
- **Evidence:** `stripe-webhook-source.test.ts` locks tier allowlist, email
  shape, env-gated token logging, resolvedEmail — but nothing asserts the
  `Entitlement created` / `[manual-distribution]` lines only fire on a TRUE
  insert (`affectedRows === 1`). This is the contract COR-R4C3-02's fix
  introduces; without a test the dup-key-loser log can silently come back.
- **Fix:** extend the source-contract suite with the affectedRows-gate
  assertions alongside the fix.

### TEST-R4C3-09 — `withAdminAuth` token-path response-header defaults untested
- **Severity/Confidence:** LOW-gap / Medium
- **Evidence:** no existing test asserts the wrapper's defense-in-depth headers
  on the token-auth branch (SEC-R4C3-04). The cookie branch's defaults are
  similarly untested but currently correct; one behavioral test covering both
  branches locks the symmetric contract.
- **Fix:** unit test with a mocked `verifyToken` + handler that returns a bare
  200: assert Cache-Control/Pragma/nosniff present on both auth paths.

### TEST-R4C3-10 — download usedRow heuristic condition untested
- **Severity/Confidence:** LOW-gap / Medium
- **Evidence:** `refund-clears-download-token.test.ts` locks `refundEntitlement`
  clearing the hash and the route checking `refunded` — but nothing locks the
  usedRow disambiguation query shape (COR-R4C3-03). A source-contract assertion
  that the usedRow SELECT carries `isNull(downloadTokenHash)` AND
  `isNotNull(downloadedAt)` closes it.
- **Fix:** extend that suite with the fix.

## Flake sweep
- Re-ran the suites covering this cycle's surfaces (serve-upload,
  stripe-webhook-source, refund-clears-download-token, failed-image-retry,
  image-queue-permanent-failure, mysql-datetime) — deterministic, no timer or
  network coupling. The full-run import cost (≈900 s cumulative transform across
  workers) is the dominant wall-time factor but parallelizes; no action.

## Notes
- The repo's source-contract style (regex over committed route source) is the
  right tool for all four gaps: behavior-adjacent, zero infra, locks exactly the
  line that drifted. New tests this cycle should follow it.

# Test-engineer — Run-4 Cycle 17

Single-subagent in-context pass (documented run-wide constraint).

## Baseline

Cycle-16 close: 8/8 gates green (vitest 186 files / 1802 tests at the
c16 close per plan-303), deploy verified live (SW `3aa3c4ff-p7`).

## Findings

### TEST-R4C17-01 — `og-photo-fallback.test.ts` locks the WRONG rollback contract (mirror of SEC-R4C17-01)
- **File:** `apps/web/src/__tests__/og-photo-fallback.test.ts:53-57`.
- **Severity/Confidence:** gap / High.
- **Problem:** the fixture asserts `rollbackOgAttempt(ip)` appears
  ≥ 4 times and specifically that the `!fetched` branch refunds — i.e.
  it actively prevents fixing the policy divergence found by the
  security angle. Tests encoding a bug as a contract is the
  highest-priority test-debt class (preceded by the c16 CSP test that
  encoded the GA4 block).
- **Fix (folds into the SEC-R4C17-01 commit):** flip the assertion to
  the new contract — exactly TWO `rollbackOgAttempt(ip)` occurrences,
  both in the pre-DB validation block (assert by slicing the source
  above the `getImageCached` call), plus negative assertions that the
  `!image` / `!fetched` / catch branches do NOT refund. Add a
  cross-route parity case mirroring
  `og-route-source-contracts.test.ts` so BOTH routes' charged-post-DB
  policy is locked in the same style. Prove failing pre-fix, green
  post-fix.

### TEST-R4C17-02 — no regression lock on the dashboard pagination accessible-name fix (DES-R4C17-03)
- **Severity/Confidence:** gap / Medium.
- **Disposition:** the repo's enforcement layer for this class is
  eslint-plugin-jsx-a11y + review; a one-off jsdom render test for two
  aria-labels is disproportionate (same reasoning as accepted for
  DES-R4C16-05). Covered instead by fixing the instances; no new
  fixture. Recorded so the decision is explicit, mirroring c16's
  precedent.

### TEST-R4C17-03 — `batchUpdateImageTags` rejected-name warning path untested (mirror of COR-R4C17-05)
- **Severity/Confidence:** gap / Medium.
- **Fix:** the existing action-level tests for tags (if any cover the
  warning array) should gain a case asserting a control-char tag name
  produces a warning AND no link mutation. If no harness exists for
  the action (DB-coupled), lock at the source level is NOT warranted —
  prefer a minimal unit on the warning-construction behavior if the
  loop is extractable; otherwise accept manual verification in the fix
  commit body (document which path was exercised).

## Verified test-surface health (clean)

- `alert-dialog-action-settle.test.ts` (c16): normalizer + marker
  budget semantics correct; canary on tag-manager present.
- `touch-target-audit.test.ts` (c16 extension): native `<select>`
  patterns carry the ≥ 44 override lookahead; upload-dropzone ghost
  budget re-tightened to 0 — the ≤-budget absorption hole is closed
  for that file.
- `image-zoom-math.test.ts`: 32 cases including verbatim-extraction
  equivalence against the pre-extraction wheel arithmetic — the right
  shape for a refactor lock.
- `image-url.test.ts`: dataset/trailing-slash/absent/server-env
  branches + layout-stamp source fixture — full branch coverage of
  the c16 resolver.
- `content-security-policy.test.ts`: updated GA4 contract + negative
  advertising-host assertions + GA-absent byte-identity lock.
- `og-rate-limit.test.ts`, `rate-limit.test.ts`,
  `auth-rate-limit*.test.ts`: pre-increment/rollback/prune behavior
  covered at the lib level (the lib is correct; the route POLICY is
  what diverged — fixture-level, see TEST-R4C17-01).
- `og-photo-fallback.test.ts` runtime cases (ascending order, byte
  caps, timeout-as-miss) remain valid and are untouched by the policy
  flip.

## Flaky-test sweep

No timer-coupled or network-coupled assertions added by c16; the new
fixtures are source-grep style (deterministic). No flake surface
identified this cycle.

# Cycle 4 RPF (end-only) — Test Engineer

## Method
Reviewed test surface for cycle 1-3 RPF coverage; identified gaps for cycle 4
in-cycle fix candidates.

## Coverage status

- `cycle3-rpf-source-contracts.test.ts` covers P262-01..14 (8 of 14 covered by
  source-text assertions; remainder covered by behavior in webhook/download).
- `stripe-webhook-source.test.ts` covers tier allowlist + email shape + opt-in
  log gate.
- `stripe-download-tokens.test.ts` covers token shape, hashing, single-use claim.
- `refund-clears-download-token.test.ts` covers refund path token clearing.
- `backup-download-route.test.ts` covers backup endpoint.

Gates: 950 tests passing across 108 files.

## Findings (gaps for cycle 4 candidate fixes)

### LOW

#### C4-RPF-TE-01 — No source-contract test for cycle 4 candidate: column-width truncation

- Files: `apps/web/src/app/api/stripe/webhook/route.ts:90`, schema:255
- If C4-RPF-SEC-01 lands (slice 320 → slice 255), need a source-contract test
  asserting the slice limit matches the column width.
- **In-cycle:** add test if SEC-01 lands.

#### C4-RPF-TE-02 — No source-contract test for `'unpaid'` console.warn distinction

- File: webhook payment_status branch
- If C4-RPF-CRIT-01 lands (warn vs error for unpaid), source-contract should
  pin the log severity.
- **In-cycle:** add test if CRIT-01 lands.

#### C4-RPF-TE-03 — No source-contract test for parallel realpath calls

- File: `apps/web/src/app/api/download/[imageId]/route.ts:133-134`
- If C4-RPF-PERF-03 lands (Promise.all on realpath), source-contract should
  pin the parallelization shape so a future revert is caught.
- **In-cycle:** optional; behavior unchanged so source-text test is the only guard.

#### C4-RPF-TE-04 — No source-contract test for refund-error mapping coverage

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:97-108`
- If C4-RPF-CRIT-05 lands (4 more error codes), should add test that
  `mapErrorCode` switch handles every value of `RefundErrorCode`.
- **In-cycle:** add test if CRIT-05 lands.

### Carry-forward verification

- All cycle 1-3 RPF source-contract tests still pass.
- 950/950 tests pass.
- Test files: 108 (108 files run; 950 tests).

## Aggregate

- HIGH: 0
- MEDIUM: 0
- LOW: 4 test-coverage gaps tied to cycle 4 in-cycle fixes (only land if the fixes land)
- INFO: 0

## In-cycle scheduling proposal

- Add tests in lockstep with each cycle 4 in-cycle fix that lands.

# Cycle 2 Deep Review — Security Reviewer

Date: 2026-06-24
HEAD: 95de4d11

## Summary

All security lint gates pass. No new security vulnerabilities found in cycle 2. The cycle 1 fixes properly addressed AGG-01 (action origin), AGG-03 (public route rate limit), AGG-08 (restore maintenance), AGG-12 (rate limit refund), AGG-28 (nginx token throttle).

## New Findings (Cycle 2)

### SEC2-01 — `check-action-origin.ts` scanner uses `ts` import without version pinning

- Severity: Low
- Confidence: Medium
- Type: Supply-chain risk

Evidence: `apps/web/scripts/check-action-origin.ts:39` imports `typescript` directly. If the TypeScript compiler API changes between versions, the scanner could silently fail or produce false negatives.

Failure scenario: A TypeScript upgrade breaks the scanner's AST traversal without failing the build.

Suggested fix: Pin the scanner's TypeScript version or add a self-test that validates the scanner can detect known violations.

## Verified Fixed (from Cycle 1)

- AGG-01: Action origin scanner hardened — verified
- AGG-03: Public route rate limit scanner hardened — verified
- AGG-12: Semantic search rate limit no longer refunds after expensive work — verified
- AGG-24/25: Dependency vulnerabilities resolved via upgrade — verified (npm audit clean)
- AGG-28: Token management now under nginx throttle — verified in nginx/default.conf

## Remaining Open (from Cycle 1)

- AGG-06: DB restore incomplete dump validation — still present
- AGG-07: Post-restore async hooks — still present
- AGG-26: CSP inline styles — still present
- AGG-27: Search LIKE SQL mode dependency — still present
- AGG-30: Legacy symlink cleanup — still present
- AGG-31: Storage abstraction public path risk — still present

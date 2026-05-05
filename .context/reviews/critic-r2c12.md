# Critic — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Multi-perspective critique of the whole change surface and review depth
**Method**: Synthesized security, correctness, test, architecture, and UX angles

## Cross-Cutting Observation: Lint Gate False-Positive Bypass (C12-LOW-01 / C12-SEC-01)

This is the highest-signal finding of the cycle. It was flagged by both code-reviewer and security-reviewer. The `check-public-route-rate-limit.ts` gate is a security-critical lint script, yet a trivial bypass (commented-out helper call) exists. The fact that the import check was hardened (C8-F03) but the prefix check was not suggests an incomplete fix during a previous cycle. This is a classic "fixed the symptom, missed the sibling" pattern.

**Impact**: Medium — not exploitable by external attackers directly, but allows developer error to ship an unmetered public mutation surface.
**Confidence**: High — the bypass is trivial to demonstrate.

## Cross-Cutting Observation: Semantic Search Body Guard (C12-LOW-02 / C12-SEC-02)

The `Number.parseInt` body-size guard is a small but real correctness issue. It shares DNA with C12-LOW-01: a validation layer that uses a weak parsing primitive (`parseInt` instead of strict numeric validation) and can be bypassed by malformed input. The fix pattern (`Number.isFinite`) should be applied consistently across all numeric header validations in the codebase.

**Audit recommendation**: Search for all `parseInt` usages on HTTP header values and verify they use strict validation.

## Cross-Cutting Observation: Test Coverage Gaps in Recently Changed Code (C12-TE-01)

The semantic search endpoint has been modified in three consecutive cycles (R2C10, R2C11, and now C12). Each cycle added new behavior (rate-limit helpers, body guard, parameter clamping, enrichment). Yet there are still no integration tests for the POST handler itself. The unit tests for helper functions are valuable but do not protect the composition. This is a recurring pattern: the project has excellent unit-test coverage but thin integration-test coverage for API routes.

## No Deferred Findings from Previous Cycles Regressed

- All R2C11 fixes are correctly implemented.
- All R2C10 fixes remain intact.
- Gates are green.

## Summary

Cycle 12 is a light cycle — 4 Low-severity findings, no Medium or High. The codebase is mature and well-hardened. The most important work is closing the lint-gate bypass (C12-LOW-01) and adding integration tests (C12-TE-01).

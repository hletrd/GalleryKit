# Debugger Review — debugger (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high findings.
- One medium finding (stateful regex in sanitizeAdminString).

## Verified fixes from prior cycles

1. C7-DBG-01 / AGG7R-01: Redundant `IS NULL` conditions — FIXED.
2. C7-DBG-02 / AGG7R-02: `.length` vs code points — FIXED for images.ts.

## New Findings

### C8-DBG-01 (Medium / Medium). `sanitizeAdminString` stateful regex — bidi override rejection is non-deterministic across requests

- Location: `apps/web/src/lib/sanitize.ts:13,136`
- Same finding as C8-SEC-01 / C8-CR-01 / C8-V-01 / C8-TR-01 / C8-ARCH-01. The `/g` flag on `UNICODE_FORMAT_CHARS_RE` causes `.test()` to be stateful, alternating between `true` and `false` for the same input string.
- **Failure mode**: Non-deterministic — depends on request ordering. This makes it particularly hard to debug in production: the same input is sometimes rejected and sometimes accepted silently, depending on what other requests ran before it.
- **Latent bug surface**: Any future code that calls `UNICODE_FORMAT_CHARS_RE.test()` on the shared module-level regex will inherit the same stateful behavior.
- Suggested fix: Replace the `.test()` call with a non-`/g` regex. The existing `UNICODE_FORMAT_CHARS` in `validation.ts` is correct for `.test()` use.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-10: Log noise from orphaned tmp cleanup — appropriate.

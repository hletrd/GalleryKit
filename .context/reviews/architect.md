# Architect Review — architect (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high architectural findings.
- One medium finding (shared mutable regex state).

## Verified fixes from prior cycles

1. C7-ARCH-01 / AGG7R-03: `sanitizeAdminString` combined helper — FIXED (but with a stateful regex bug, see C8-ARCH-01).
2. C7-ARCH-02 / AGG7R-02: `.length` vs code points — FIXED for images.ts.

## New Findings

### C8-ARCH-01 (Medium / Medium). Module-level shared mutable regex state in `sanitize.ts` — `/g` flag causes cross-request interference

- Location: `apps/web/src/lib/sanitize.ts:13`
- `UNICODE_FORMAT_CHARS_RE` is a module-level `const` with the `/g` flag. It is used by both `stripControlChars` (via `.replace()`) and `sanitizeAdminString` (via `.test()`). While `.replace()` does not update `lastIndex`, `.test()` does. In a Node.js server handling concurrent requests, the same regex instance is shared across all requests. A `.test()` call in one request sets `lastIndex`, which affects the next `.test()` call in a different request.
- This violates the principle of request isolation: server-side code should not share mutable state across requests without synchronization.
- Concrete scenario: Two concurrent HTTP requests both call `sanitizeAdminString` with strings containing bidi overrides. Depending on request timing, one of them may get `rejected: false` even though the input contains formatting characters.
- Suggested fix: Separate the regex into two instances: one with `/g` for `.replace()` use, and one without `/g` for `.test()` use. Alternatively, reset `lastIndex = 0` before each `.test()` call, but this is fragile if someone adds a new call site without the reset.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-08: `lib/data.ts` approaching 1200 lines — extraction could improve maintainability.
- AGG6R-15: `getImage` 2-round-trip query pattern is already optimal — no action needed.

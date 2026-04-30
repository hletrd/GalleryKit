# Security Review — security-reviewer (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- One medium security finding (stateful regex bypass in `sanitizeAdminString`).
- No new critical or high security findings.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:
1. C7-SEC-01 / AGG7R-03: `sanitizeAdminString` combined helper — FIXED.
2. C6-SEC-01 / AGG6R-04: HANDLER pattern added to SQL restore scanner — FIXED.
3. C5-SEC-01: Shared group page double-increment — FIXED.
4. C5-AGG-02: viewCountRetryCount cap — FIXED.

## New Findings

### C8-SEC-01 (Medium / High). Stateful `/g` regex in `sanitizeAdminString` can bypass Unicode formatting rejection on second invocation

- Location: `apps/web/src/lib/sanitize.ts:13,136`
- The module-level `UNICODE_FORMAT_CHARS_RE` is defined with the `/g` flag for use with `.replace()` in `stripControlChars`. However, `sanitizeAdminString` line 136 calls `UNICODE_FORMAT_CHARS_RE.test(input)` on the same regex instance. With `/g`, `.test()` is stateful — it advances `lastIndex` on each call, causing it to alternate between `true` and `false` for the same input.
- Verified with a minimal Node.js reproduction:
  ```
  const re = /[…]/g;  // same characters as UNICODE_FORMAT_CHARS_RE
  re.test('hello‪world') → true   (lastIndex moves to 6)
  re.test('hello‪world') → false  (lastIndex is past the match)
  re.test('hello‪world') → true   (lastIndex wraps)
  ```
- This means if `stripControlChars` is called first (which uses `.replace()` with the same regex, advancing `lastIndex`), and then `sanitizeAdminString` calls `.test()`, the test can return `false` for a string that contains bidi overrides.
- **Concrete attack scenario**: An admin submits a topic label or image title containing U+202A (LRE). If `stripControlChars` is called on a different string first (or on the same string in the `.replace()` call at line 138), the subsequent `.test()` at line 136 can return `false`, causing `sanitizeAdminString` to return `{ rejected: false }` and the bidi character persists in the database.
- **Severity rationale**: This directly undermines the Trojan-Source defense (C3L-SEC-01 through C6L-SEC-01) that was the entire purpose of `sanitizeAdminString`. A bidi override could be stored and rendered, enabling visual spoofing on admin and public pages.
- Suggested fix: Use a separate non-`/g` regex for the `.test()` check in `sanitizeAdminString`. The existing `UNICODE_FORMAT_CHARS` in `validation.ts` (which is `/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/` without `/g`) is already correct for `.test()` use. Import and use it, or define a local non-`/g` variant.

## Carry-forward (unchanged — existing deferred backlog)

All prior security-related deferred items remain valid and deferred:
- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history

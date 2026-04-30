# Critic Review — critic (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- One medium finding (stateful regex bypass).
- One low finding (inconsistent `.length` fix).

## Verified fixes from prior cycles

All Cycle 7 critic findings confirmed addressed:
1. C7-CRIT-01 (separate stripControlChars + containsUnicodeFormatting): FIXED — `sanitizeAdminString` helper.
2. C7-CRIT-02 (`as const` inconsistency): Acknowledged LOW — cosmetic.

## New Findings

### C8-CRIT-01 (Medium / High). `sanitizeAdminString` reuses the `/g`-flagged `UNICODE_FORMAT_CHARS_RE` with `.test()` — the stateful regex makes Unicode formatting rejection unreliable

- Location: `apps/web/src/lib/sanitize.ts:13,136`
- The `sanitizeAdminString` function was the key deliverable of the C7-AGG7R-03 fix — it was supposed to close the gap where developers might forget to call `containsUnicodeFormatting` alongside `stripControlChars`. However, the implementation uses `UNICODE_FORMAT_CHARS_RE.test(input)` on a regex that also has the `/g` flag (needed for `.replace()` in `stripControlChars`). This makes `.test()` stateful, alternating between `true` and `false` on the same input.
- This undermines the entire defense-in-depth purpose of the helper. The irony is that the old two-function pattern (`stripControlChars` + `containsUnicodeFormatting`) was actually more correct because `UNICODE_FORMAT_CHARS` in `validation.ts` is non-`/g`.
- Concrete scenario: An admin inputs a topic label containing U+202A (LRE). If `stripControlChars` runs first on the same regex instance (which it does, at line 138), `lastIndex` is advanced, and the `.test()` at line 136 returns `false` — the bidi override is accepted.
- Suggested fix: Use `UNICODE_FORMAT_CHARS` from `validation.ts` for the `.test()` check, or define a local non-`/g` regex variant for `.test()` use.

### C8-CRIT-02 (Low / Low). `countCodePoints()` fix was applied to `images.ts` but not to `topics.ts` or `seo.ts` — inconsistent

- Location: `apps/web/src/app/actions/topics.ts:103,202` and `apps/web/src/app/actions/seo.ts:94-112`
- The C7-AGG7R-02 fix added `countCodePoints()` for image title/description length checks but did not propagate the fix to topic labels or SEO field validations. This inconsistency creates a maintenance hazard: future developers may assume the `.length` pattern is correct because it appears in multiple action files.
- Suggested fix: Apply `countCodePoints()` consistently to all admin string length validations that compare against MySQL varchar limits.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity is correct but hard to simplify.
- AGG6R-07: OG tag clamping is cosmetic.
- AGG6R-09: Preamble repetition is intentional defense-in-depth.

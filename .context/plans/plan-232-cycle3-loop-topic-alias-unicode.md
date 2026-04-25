# Plan 232 — Cycle 3 (review-plan-fix loop): Topic alias Unicode hardening

**Source review:** `.context/reviews/_aggregate.md` (C3L-SEC-01)

## Background

`isValidTopicAlias` in `apps/web/src/lib/validation.ts` rejects path separators, dots, NUL, whitespace, and the HTML-special set, but does NOT reject the Unicode formatting characters that the project has explicitly hardened against in CSV export (C7R-RPL-11, C8R-RPL-01):

- U+200B–U+200D (ZWSP, ZWNJ, ZWJ)
- U+2060 (Word Joiner)
- U+FEFF (Byte Order Mark)
- U+180E (Mongolian Vowel Separator)
- U+202A–U+202E (LRE/RLE/PDF/LRO/RLO)
- U+2066–U+2069 (LRI/RLI/FSI/PDI)
- U+FFF9–U+FFFB (interlinear annotation anchors)

Topic aliases become URL path segments and are displayed in admin/SEO UI. They should match the project's documented hardening posture for admin-controlled values.

## Implementation

1. Edit `apps/web/src/lib/validation.ts`:
   - Extend `isValidTopicAlias` to reject the Unicode-formatting set above.
   - Use the same character list as `csv-escape.ts` for consistency.

2. Edit `apps/web/src/__tests__/validation.test.ts`:
   - Add a test case: `expect(isValidTopicAlias('a​b')).toBe(false)` and similar for U+202E, U+2066, U+FEFF, U+180E.

3. Verify all gates pass: lint, typecheck, lint:api-auth, lint:action-origin, vitest, build.

4. Run `npm run deploy` per cycle protocol.

## Acceptance criteria

- `isValidTopicAlias` returns `false` for any input containing any character in the documented set.
- New tests pass.
- All other gates remain green.

## Status

- 2026-04-25: planned (cycle 3 loop)
- 2026-04-25: implemented and committed (see commit history)

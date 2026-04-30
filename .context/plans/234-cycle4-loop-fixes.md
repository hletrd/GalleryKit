# Cycle 4 (review-plan-fix loop, 2026-04-25) — Implementation Plan

## C4L-SEC-01 — Reject Unicode bidi/invisible formatting characters in `isValidTagName` [LOW] [Medium confidence]

### Problem

`isValidTagName` (`apps/web/src/lib/validation.ts:43-46`) blocks `<>"'&\x00` and commas but accepts the same high-codepoint formatting characters (U+200B–U+200D, U+2060, U+FEFF, U+180E, U+FFF9–U+FFFB, U+202A–U+202E, U+2066–U+2069) that the project explicitly rejects in `isValidTopicAlias` (C3L-SEC-01) and CSV export (C7R-RPL-11 / C8R-RPL-01). Tag names render in admin UI / image cards and inherit the same defense-in-depth gap.

### Steps

1. **Refactor `validation.ts`:**
   - Promote the `UNICODE_FORMAT_CHARS` regex from a file-local constant to an exported one. Keep the same characters in scope so existing topic-alias behavior is untouched.
2. **Apply parity in `isValidTagName`:**
   - Add `if (UNICODE_FORMAT_CHARS.test(trimmed)) return false;` near the top so length checks operate on a pre-rejected value path.
   - Update the inline comment block to reference C4L-SEC-01 plus the C3L-SEC-01 / C7R-RPL-11 / C8R-RPL-01 lineage.
3. **Test parity in `validation.test.ts`:**
   - Mirror the existing topic-alias bidi/invisible coverage (lines 101-119) inside the `isValidTagName` describe block. Test the same characters with the same naming convention so regressions surface symmetrically.
4. **Verify gates:**
   - `npm run lint --workspace=apps/web` (must remain clean).
   - `npm run typecheck --workspace=apps/web` (must remain clean).
   - `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web` (must remain clean — neither is touched by the change).
   - `npm test --workspace=apps/web` (new tests pass; existing 372 stay green).
   - `npm run build --workspace=apps/web` (sanity check before deploy).

### Risk

- LOW. The change tightens a validator only on previously-untested high-codepoint characters. Existing tag names will already be free of them in any practical deployment (no admin willingly types ZWSP into a tag name). Migration / data-shape impact: none.

### Acceptance criteria

- `isValidTagName` returns `false` for inputs containing any of: U+200B, U+200C, U+200D, U+200E, U+200F, U+2060, U+FEFF, U+180E, U+FFF9, U+202A-202E, U+2066-2069.
- `validation.test.ts` exercises the rejection symmetrically with the topic-alias block.
- All gates pass; build clean.

### Status

- [x] Implementation — `apps/web/src/lib/validation.ts`: `UNICODE_FORMAT_CHARS` exported and applied in `isValidTagName`; comment lineage updated.
- [x] Tests — `apps/web/src/__tests__/validation.test.ts`: parallel bidi-override + zero-width / invisible coverage added under the `isValidTagName` describe block (vitest now 376/376).
- [x] Gate verification — lint / typecheck / lint:api-auth / lint:action-origin / vitest (376/376) / build all exit 0.
- [ ] Deploy — pending commit + push + per-cycle deploy.

# Test-engineer review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc test(consolidation): lock humanizeTagLabel and hreflang single-source-of-truth`
- Total tests: 61 files / 411 tests; cycle-2 baseline was 60 files / 402 tests.

## What was added (test-side)

### `apps/web/src/__tests__/tag-label-consolidation.test.ts` — fixture seatbelt
- Mirrors the existing `check-action-origin.test.ts` and `check-api-auth.test.ts` source-scanner convention.
- 6 new test cases:
  - 2 × `it.each(CHIP_RENDER_FILES)` over `photo-viewer.tsx` and `info-bottom-sheet.tsx`.
  - 1 × `home-client.tsx` uses `humanizeTagLabel`.
  - 1 × `tag-filter.tsx` uses `humanizeTagLabel`.
  - 4 × `it.each(HREFLANG_EMITTER_FILES)` over the 4 metadata emitters.
  - 1 × all hreflang emitters import `buildHreflangAlternates`.
- Total: ≈ 9 cases (after `it.each` expansion), matching the +9 vs cycle 2 baseline.

## Test surface evaluation

### Coverage assessment
| Surface | Coverage |
|---|---|
| `humanizeTagLabel` unit-level behavior | covered in `photo-title.test.ts` (3 cases: underscored, plain, empty) |
| `buildHreflangAlternates` unit-level behavior | covered in `locale-path.test.ts` (3 cases: root, photo, topic) |
| Chip-render consumers stay routed through helper | covered in new `tag-label-consolidation.test.ts` |
| Metadata emitters stay routed through helper | covered in new `tag-label-consolidation.test.ts` |
| Visible-display behavior across surfaces | covered indirectly via `photo-title.test.ts` for `getPhotoDisplayTitleFromTagNames` and `getConcisePhotoAltText` |

### Gap check
- The fixture's `inlineLanguagesMap` regex caps lookahead at 400 chars. A pathological metadata block with > 400 chars between `languages: {` and the literal would bypass — but no current emitter is that large, and it's a tracking-only concern.
- The fixture does not assert *runtime* behavior (i.e. an actual rendered chip in jsdom or playwright). However:
  - `humanizeTagLabel` is a pure function with full unit-test coverage.
  - The chip-render path is `Badge>#{humanizeTagLabel(tag.name)}</Badge>` — fully transparent; if the helper is correct, the chip is correct.
  - A jsdom/playwright render test for chip humanization is feasible but adds CI cost without proportional risk reduction. Not recommended.

### Behavioral test assessment
The added fixture is a **structural / source-text** test, not a behavioral test. That's appropriate for the regression class it targets:
- The actual humanization is tested behaviorally in `photo-title.test.ts` (input → output).
- The "every consumer routes through the helper" invariant is naturally a structural property; behavioral tests can't easily guarantee it without mounting every consumer surface.

This is a textbook fixture-test pattern, well-aligned with the existing `check-action-origin.test.ts` / `check-api-auth.test.ts` convention.

## Findings

**No new MEDIUM or HIGH test-engineer findings.**

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **TE3L-INFO-01** | The fixture asserts `#{tag.name}` only; a future contributor pasting `#{tag.slug}` would slip past. Slugs canonically use `-`, not `_`, so the visible drift is structurally different — but if a contributor wrote a slug-shaped tag like `music_festival` and then rendered `#{tag.slug}` raw, the fixture would not catch it. Tracking-only; no current bug. | LOW (tracking) | Low |
| **TE3L-INFO-02** | The fixture's hard-coded `HREFLANG_EMITTER_FILES` list will go out of date if a fifth metadata emitter is added (e.g. a future blog/about page). Add a comment in the fixture pointing reviewers to update the list. Optional polish. | LOW (tracking) | Medium |

## Verdict

Cycle 3 fresh test-engineer review: zero MEDIUM/HIGH, two informational LOW notes (both tracking-only). Test coverage is appropriate for the regression class. Convergence indicated.

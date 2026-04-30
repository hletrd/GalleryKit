# test-engineer — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Identify regression test gaps for designer-v2 findings.

## Findings

### TE-1 (High, High confidence) — No fixture-style touch-target test

Cycle 2/3 added `tag-label-consolidation.test.ts` as a fixture-style
guard. Touch-target audit lacks the equivalent. Five designer-v2
findings (NF-1, NF-2, NF-4, NF-5, NF-6) plus CR-7 all match the same
shapes that a fixture test could detect:
- `className=".*\bh-8\b"` on Button
- `className=".*\bh-9\b"` on Button (when not deliberate)
- `size="sm"` (32 px in shadcn)
- `size="icon"` without `h-11 w-11` override

**Suggested test:** new file `apps/web/src/__tests__/touch-target-
audit.test.ts` that walks `apps/web/src/components/**/*.tsx` and asserts
that interactive elements (`<Button>`, `<button>`, `<Link>`) are 44 px
tall by class evidence (or are exempt-listed for a documented reason).

### TE-2 (High, High confidence) — No regression test for `tag_names` non-null in `getImagesLite`

NF-3 root cause is data-layer null. Existing
`apps/web/src/__tests__/data-pagination.test.ts` covers pagination
arithmetic but does not assert tag_names. `photo-title.test.ts` covers
the *transform* layer with synthetic input but no test exercises
`getImagesLite -> getConcisePhotoAltText` end-to-end with a real DB row.

**Suggested test:** Vitest unit test using the test DB to seed an image
+ 2 tags, call `getImagesLite`, assert `tag_names` is a non-null
GROUP_CONCAT'd string. Pairs naturally with `apps/web/scripts/
seed-e2e.ts`.

### TE-3 (Medium, Medium confidence) — Playwright e2e for accessible labels on masonry cards

`apps/web/e2e/` exists but doesn't assert masonry-grid card aria-labels
are non-trivial. Useful future addition; not blocking this cycle.

### TE-4 (Low, Medium confidence) — No test for blur placeholder wiring in photo-viewer

Photo-viewer doesn't consume `blur_data_url`. Test could assert:
when image has `blur_data_url`, photo-viewer container has a
backgroundImage style.

## Recommended additions to this cycle's plan

- TE-1 fixture test file (touch-target audit)
- TE-2 unit test (`getImagesLite` returns non-null `tag_names` when image
  has tags)

## Verdict

2 High-confidence test additions to schedule this cycle.

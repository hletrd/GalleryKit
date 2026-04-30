# Code review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc test(consolidation): lock humanizeTagLabel and hreflang single-source-of-truth`
- Diff vs. cycle 2 baseline (`707ea70`): 5 commits — refactor (humanize tag chips in viewer surfaces), refactor (root-layout hreflang via builder), test (consolidation seatbelt), and incidental docs.
- Net diff to staged areas: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/__tests__/tag-label-consolidation.test.ts`.

## Inventory examined
- `apps/web/src/lib/photo-title.ts` — single-source-of-truth helper (humanizeTagLabel + display-title family).
- `apps/web/src/lib/locale-path.ts` — buildHreflangAlternates helper + OG-locale family.
- `apps/web/src/components/photo-viewer.tsx` — desktop info-sidebar tag-chip render (line 407 `humanizeTagLabel(tag.name)`).
- `apps/web/src/components/info-bottom-sheet.tsx` — mobile bottom-sheet tag-chip render (line 248 `humanizeTagLabel(tag.name)`).
- `apps/web/src/components/home-client.tsx` — masonry card title humanization plus filter-chip humanization.
- `apps/web/src/components/tag-filter.tsx` — interactive pill humanization.
- `apps/web/src/app/[locale]/layout.tsx` — root layout hreflang map now derives from `buildHreflangAlternates(seo.url, '/')`.
- `apps/web/src/app/[locale]/(public)/page.tsx`, `/[topic]/page.tsx`, `/p/[id]/page.tsx` — public emitters, all use `buildHreflangAlternates`.
- `apps/web/src/__tests__/tag-label-consolidation.test.ts` — fixture-style scanner asserting both consolidations are still in place.
- `apps/web/src/__tests__/locale-path.test.ts`, `.../photo-title.test.ts` — unit tests cover both helpers including underscore branches.
- `apps/web/src/components/tag-input.tsx`, `.../tag-manager.tsx` — admin slug-form input + admin tag table; intentionally render raw `tag.name` because they are admin-only authoring/management surfaces, not user-facing chips.

## Findings

**No MEDIUM or HIGH findings.**

The cycle-2 fixes (AGG2L-LOW-01 humanize chip labels, AGG2L-LOW-02 hreflang via helper) are in HEAD and the new fixture test (`tag-label-consolidation.test.ts`) locks both in place at the source-text level. The fixture mirrors the existing `check-action-origin.test.ts` / `check-api-auth.test.ts` convention and runs as part of the standard vitest suite (411 tests passing).

### Cross-cutting verifications

- **AGG2L-LOW-01 closed.** `photo-viewer.tsx:407` and `info-bottom-sheet.tsx:248` route through `humanizeTagLabel(tag.name)`. The fixture in `tag-label-consolidation.test.ts:43` rejects raw `#{tag.name}` JSX text in either file. Confidence: High.
- **AGG2L-LOW-02 closed.** `[locale]/layout.tsx:39` reads `languages: buildHreflangAlternates(seo.url, '/')`. The fixture rejects inline `'en':` / `'ko':` / `'x-default':` literals inside any `languages: { ... }` block at all four metadata emitters. Confidence: High.
- **AGG2L-LOW-03 (group-page masonry density `xl:columns-4` vs home `2xl:columns-5`) is tracking-only**, deferred from cycle 2 with explicit re-open criterion (`148-deferred-cycle45.md` lineage). No fresh evidence to change that decision; group surfaces have lower image counts and benefit from the denser tile size.

### LOW / informational notes (no action recommended)

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **CR3L-INFO-01** | `tag-input.tsx` (admin tag autocomplete) and `tag-manager.tsx` (admin tag table) render raw `tag.name` for the slug form. This is intentional — admins type/edit canonical underscored slugs, not humanized labels. The fixture-test scope covers `photo-viewer.tsx` and `info-bottom-sheet.tsx` only, which matches that semantic split. No change recommended. | LOW (tracking) | High |
| **CR3L-INFO-02** | The fixture-test `inlineLanguagesMap` regex caps lookahead at 400 chars; if a future emitter inlines a `languages: {` block with > 400 chars of intervening whitespace before the locale literal, it would slip past the seatbelt. Not a current issue (every existing block is < 400 chars and the test still asserts the import-presence side). Note for future-edit awareness. | LOW (tracking) | Low |
| **CR3L-INFO-03** | `tag-label-consolidation.test.ts` reads source files via `fs.readFileSync` without checking for path-traversal or symlinks. This is a unit-test fixture, not a runtime path; the file list is hard-coded. No security exposure. | LOW (tracking) | High |

## Quality-gate evidence (HEAD)

| Gate | Result |
|---|---|
| `npm run lint --workspace=apps/web` | exit 0 |
| `npm run lint:api-auth --workspace=apps/web` | exit 0 |
| `npm run lint:action-origin --workspace=apps/web` | exit 0 |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | exit 0 |
| `npm test --workspace=apps/web` | 61 files / 411 tests passed |

## Verdict

Cycle 3 fresh review: zero MEDIUM/HIGH, three tracking-only LOW notes. The previous cycle's consolidation work is closed and seatbelted. Convergence indicated.

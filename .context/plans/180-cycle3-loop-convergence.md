# Plan 180 — Cycle 3 review-plan-fix loop convergence

## Run context
- HEAD: `67655cc test(consolidation): lock humanizeTagLabel and hreflang single-source-of-truth`
- Cycle: 3/100
- Aggregate review: `.context/reviews/_aggregate-cycle3-loop.md`

## Status: CONVERGED — no implementation work this cycle

Cycle 3 fresh review surfaces **0 MEDIUM, 0 HIGH, 9 LOW (all tracking-only)** across eleven reviewer lenses.

Per orchestrator convergence guidance:
> If reviewers find zero MEDIUM/HIGH findings AND no scheduled in-scope fixes, do NOT commit cosmetic docs/`.context/` files just to keep the loop alive. Report `NEW_FINDINGS: 0`, `COMMITS: 0`, `DEPLOY: none-no-commits` so convergence fires.

The cycle 2 fix wave (plan-303-A humanize chip labels, plan-303-B hreflang via builder, plan-303-C fixture seatbelt) is fully landed in HEAD and locked by the new `tag-label-consolidation.test.ts` fixture (411 tests passing). All gates are green.

## Deferred LOW notes — tracking-only

Each of the following nine LOW notes from cycle 3's aggregate is recorded with file/line citations, original severity/confidence (no downgrade), reason for deferral, and exit criterion. None are security/correctness/data-loss findings — repo guidance allows deferring tracking-only edge cases.

### AGG3L-INFO-01 — Fixture-test scope is hard-coded (4 reviewers)

- **Citation**: `apps/web/src/__tests__/tag-label-consolidation.test.ts:32-36` (`CHIP_RENDER_FILES`), `:96-101` (`HREFLANG_EMITTER_FILES`).
- **Severity / confidence**: LOW / High.
- **Reason for defer**: There is no fifth chip-render surface or fifth metadata emitter currently planned. The codebase's public-route surface is feature-complete (home, topic, photo, root layout for hreflang; masonry, photo-viewer, info-bottom-sheet, tag-filter, home-client filter chips for tag display).
- **Exit criterion**: re-open if a new public route or chip-render surface is added; update the fixture's hard-coded list.

### AGG3L-INFO-02 — Photo-page `keywords` meta-tag and JSON-LD `keywords` use raw underscored tag names (2 reviewers)

- **Citation**: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:65, :150, :182`.
- **Severity / confidence**: LOW / Medium.
- **Reason for defer**: SEO `keywords` meta-tag is not a UI surface. Major search engines tokenize keywords, treating `_` and ` ` similarly. No visible drift.
- **Exit criterion**: re-open if SEO audit reports indicate underscore-induced ranking impact, or if a future feature surfaces `keywords` as user-visible UI.

### AGG3L-INFO-03 — `humanizeTagLabel` does not collapse adjacent whitespace or trim (1 reviewer)

- **Citation**: `apps/web/src/lib/photo-title.ts:28-30`.
- **Severity / confidence**: LOW / Medium.
- **Reason for defer**: Tag names canonically come from admin-authored slugs that don't contain leading/trailing or doubled underscores. CSS `white-space: normal` collapses adjacent whitespace at render. No reported user-visible defect.
- **Exit criterion**: re-open if a real user reports a chip rendering with leading/trailing/multiple spaces.

### AGG3L-INFO-04 — Photo-viewer toolbar Share/Lightbox-trigger button height inconsistency (1 reviewer)

- **Citation**: `apps/web/src/components/photo-viewer.tsx:267` (LightboxTrigger), `:282-309` (Share button).
- **Severity / confidence**: LOW / Medium.
- **Reason for defer**: Cycle-1 AGG1L-LOW-07 tracking-only; not a current accessibility violation (44×44 px is AAA target). Default button size is 36 px which still meets AA touch-target floor.
- **Exit criterion**: re-open if accessibility audit upgrades to AAA WCAG 2.5.5.

### AGG3L-INFO-05 — Group/share masonry density `xl:columns-4` vs home/topic `2xl:columns-5` (1 reviewer)

- **Citation**: `apps/web/src/components/home-client.tsx:165` (`xl:columns-4 2xl:columns-5`); group/share pages use `home-client.tsx` but with smaller image counts.
- **Severity / confidence**: LOW / Medium.
- **Reason for defer**: Re-affirms cycle-2 AGG2L-LOW-03 deferral. Small-image-count surfaces (typically < 50 photos in a shared group) benefit from 4-column density.
- **Exit criterion**: re-open if shared-group views regularly contain > 100 photos and large-screen UX feedback flags excess gutter.

### AGG3L-INFO-06 — Wildcard-import refactor would false-positive against fixture (1 reviewer)

- **Citation**: `apps/web/src/__tests__/tag-label-consolidation.test.ts:54` (named-import regex).
- **Severity / confidence**: LOW / Low.
- **Reason for defer**: Wildcard-import (`import * as foo`) is not used anywhere in this codebase; named imports are the convention.
- **Exit criterion**: re-open if a wildcard-import refactor is proposed and the fixture blocks it.

### AGG3L-INFO-07 — `OPEN_GRAPH_LOCALE_BY_LOCALE` and `LOCALES` live in separate modules (1 reviewer)

- **Citation**: `apps/web/src/lib/constants.ts:2` (`LOCALES`), `apps/web/src/lib/locale-path.ts:45-48` (`OPEN_GRAPH_LOCALE_BY_LOCALE`).
- **Severity / confidence**: LOW / Medium.
- **Reason for defer**: Adding a new locale is a planned, not ad-hoc, task. Unification would create indirection without proportional benefit. The two-source-of-truth tension is acceptable for a 2-locale codebase.
- **Exit criterion**: re-open if a third locale is added and the friction of synchronizing both modules becomes a recurring concern.

### AGG3L-INFO-08 — Helper-consolidation pattern could be codified into `.context/development/` doc (1 reviewer)

- **Citation**: pattern appears at `apps/web/src/lib/photo-title.ts:humanizeTagLabel` and `apps/web/src/lib/locale-path.ts:buildHreflangAlternates`, with matching fixture seatbelts in `tag-label-consolidation.test.ts`.
- **Severity / confidence**: LOW / Medium.
- **Reason for defer**: Pattern only appears 2× so far; codifying it now risks premature abstraction. The CLAUDE.md "Lint Gates" section already mentions structural test conventions (`check-action-origin.test.ts`, `check-api-auth.test.ts`).
- **Exit criterion**: re-open if a third instance of the same pattern (single-source-of-truth helper + fixture-test seatbelt) is introduced.

### AGG3L-INFO-09 — `humanizeTagLabel` allocates per chip render (1 reviewer)

- **Citation**: `apps/web/src/lib/photo-title.ts:28-30`.
- **Severity / confidence**: LOW / High.
- **Reason for defer**: Sub-µs cost per call; ≤ 5 calls per typical photo card render. Not a hot path.
- **Exit criterion**: re-open if a profiling pass shows `humanizeTagLabel` consuming > 1 % of render time on any surface.

## No deferred MEDIUM/HIGH findings

Per CLAUDE.md / repo guidance, security / correctness / data-loss findings are not deferrable. Cycle 3 surfaces zero such findings; this section is empty by design.

## Outcome

- **NEW_FINDINGS**: 0 (all 9 reviewer notes are tracking-only LOWs, no MEDIUM/HIGH)
- **NEW_PLANS**: 1 (this convergence record itself)
- **COMMITS**: 0 (no implementation work)
- **DEPLOY**: none-no-commits

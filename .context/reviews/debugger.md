# Debugger — Cycle 5 Provenance

Review target: `4926a3e4`. Causal debugging covered recent nav/masonry changes,
SSR/image selection, UI state, routes/actions, queues, restore/migration paths,
and deployment/recovery state. Competing hypotheses were tested in fresh browser
sessions where possible.

## New findings

### DBG-C5-01 — One CSS pixel flips the selected image from 1536w to 640w without changing layout

- Severity / confidence: **Medium / High**
- Status: **Confirmed live**
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109`; same literal in `timeline/page.tsx:264-274` and `year/[year]/page.tsx:223-233`; related shared rule at `g/[key]/page.tsx:223-233`
- Causal chain: Tailwind `md` activates at 768px → grid becomes three columns → `sizes` tests inclusive `max-width:768px` first → advertises 50vw instead of 33vw → DPR-2 target exceeds 640 → browser selects 1536w. At 769px the grid/card geometry is effectively unchanged, but the 33vw branch selects 640w.
- Fix: use min-width ranges aligned with the CSS breakpoints and test exact boundaries in clean contexts.

### DBG-C5-02 — Partial attribute regressions cannot trip the new priority E2E

- Severity / confidence: **Medium / High**
- Status: **Confirmed latent-regression surface; production state correct**
- Region: `apps/web/e2e/masonry-priority.spec.ts:22-49`
- Causal chain: test combines eager and high with AND → a one-attribute regression becomes false/non-priority → filtered index set remains `[0]` → test passes despite changed browser scheduling.
- Fix: assert the two attributes independently and assert the negative state of every non-first card.

## Competing hypotheses and final sweep

Fresh sessions ruled out cache reuse as the 768/769 explanation. Live production
reported index 0 eager/high and all other home cards lazy/auto, so the priority
finding is test-only today. Nav keyboard expansion, Escape restoration, 320px
overflow, tag disclosure, search focus restoration, errors, async cleanup, locks,
and current failure fallbacks were swept; no other new runtime bug was confirmed.

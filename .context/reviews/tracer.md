# Tracer — Cycle 8 Provenance

Review target: `ff8c5f48`; review only.

## Inventory and causal traces

I inventoried all 671 maintained TS/JS files, 31 migrations plus journal/reconcile, route/action surfaces, tests, runtime/build/deploy assets, and the governing docs before tracing request admission, DB/file ownership, queue/restore interactions, responsive rendering, image selection, cache/PWA behavior, and release promotion. Historical findings were checked at HEAD and omitted when fixed or already represented in the carry-forward register. Focused responsive tests passed 34/34; standalone Chromium at 2,560 px/DPR 1 selected 1536w for `33vw` and 640w for `491px` against the same candidate pair.

### TRC-C8-01 — Container geometry and source selection split after the Cycle 7 fix

- Severity / confidence: **Medium / High**
- Status: **Confirmed end-to-end selection trace; byte delta manual-validation**
- Regions: `lib/responsive-masonry.ts:1-7,37-54` -> `components/home-client.tsx:257-273,349-359` -> `components/masonry-card.tsx:91-110` -> `app/[locale]/(public)/layout.tsx:17-20`; coverage at `e2e/responsive-masonry.spec.ts:8-55`
- Trace: 2,560 px viewport, DPR 1 -> Tailwind parent caps at 1,536 px -> `px-4` leaves about 1,504 px -> three item-capped columns and two 16 px gaps render about 491 px per card -> the new observer correctly feeds about 491 px into intrinsic geometry -> `getMainMasonrySizes(3)` separately emits `33vw` -> browser evaluates about 845 px -> the card's 640w/1536w `srcset` advances to 1536w instead of sufficient 640w.
- Concrete failure: an ultrawide desktop visitor opening a three-photo topic/filter result downloads the large thumbnail candidate for every card even though the rendered slots fit the small candidate.
- Fix: derive the `2xl` `sizes` branch from the capped container geometry, and cover three items at 2,560 px/DPR 1. Keep the current two-photo/DPR-2 test for its distinct geometry invariant.

This is not the fixed Cycle 5 missing-five-column issue: five-column declarations now exist. It is the remaining max-container boundary revealed by Cycle 7's measured-width ownership.

### TRC-C8-02 — Cycle 7's trace terminates at implementation while Git continues through publication

- Severity / confidence: **Low / High**
- Status: **Confirmed signed-push mismatch; deploy identity manual-validation**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:3-5,48-50,73-82`; `.context/plans/README.md:34-40`; signed commits `498e5122`, `90a3bc07`, `ff8c5f48`
- Trace: source fix committed with a good signature -> tests committed with a good signature -> review/plan committed with a good signature -> local and remote refs both equal `ff8c5f48` -> active ledger still says signed release pending and leaves publication unchecked.
- Concrete failure: recovery replays a completed push/deploy step or treats `ec7fc46f` as the current boundary.
- Fix: reconcile remote/signature evidence, qualify deploy evidence honestly, archive Cycle 7, and move the active frontier.

## Final missed-issue sweep

I retraced alternative explanations for the image candidate (DPR, gap rounding, width bucketing, image-size configuration, and browser fallback). The 640w-to-1536w transition remains deterministic for the default ladder at DPR 1. Auth, restore, queue, migration, cache, and cleanup traces produced no additional non-duplicate finding.

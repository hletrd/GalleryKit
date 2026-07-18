# Architect — Cycle 8 Provenance

Review target: `ff8c5f48`. Review only.

## Inventory and architecture sweep

I inventoried the full 671-file maintained TS/JS surface, 364 Vitest files plus one test stub, 14 Playwright files, 31 migrations with journal/reconcile, and the package/build/PWA/Docker/deploy boundaries, then reviewed configuration lifetime, persistence, concurrency, privacy, cache, and responsive-layout ownership across the relevant files. `AGENTS.md`, all of `CLAUDE.md`, the Cycle 7 plan, aggregate, role reports, and the carry-forward register were read to separate current breaks from accepted/deferred architecture.

## Current findings

### ARCH-C8-01 — Responsive geometry now has two authorities at the container cap

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed architectural invariant split; bandwidth symptom manual-validation**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-7,24-54`; `apps/web/src/components/home-client.tsx:257-273,349-359`; `apps/web/src/components/masonry-card.tsx:91-110`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`

Cycle 7 established the masonry element as the measurement boundary for intrinsic layout, but responsive resource selection remains owned by viewport percentages in `SLOT_SIZE_BY_COLUMNS`. Thus a single card has container-domain geometry and viewport-domain loading policy. Above the container cap they cannot both describe the rendered slot.

Concrete failure: for three items at 2,560 px/DPR 1, the container authority says about 491 px while the source authority says about 845 px. With the deliberately coarse 640w/1536w thumbnail ladder, those values land on different candidates, so the split creates a real large-file fetch rather than harmless rounding.

Fix: expose one responsive geometry policy that covers effective columns, capped slot width, and `sizes`; keep live observation for `contain-intrinsic-size`, while making the server-rendered source hint encode the same public-container cap. Prove the shared policy at a three-item ultrawide DPR-1 boundary.

The old review about a missing `2xl` column was closed by adding five-column policy. This finding concerns the still-duplicated measurement domain after the new observer landed.

### ARCH-C8-02 — Release state still requires the next cycle to repair the previous cycle

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed workflow-state drift; production identity manual-validation**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:3-5,48-50,73-82`; `.context/plans/README.md:34-40`

The active plan is necessarily committed before its own final publication, but no terminal state artifact follows the push. Consequently the repo again records a published signed cycle as pending, now through `ff8c5f48`; Cycle 7 had to repair the identical Cycle 6 state.

Concrete failure: repository recovery chooses a stale frontier and may repeat terminal work.

Fix: reconcile/archive Cycle 7 now and introduce a post-push/deploy terminal record or a clearly documented next-cycle reconciliation invariant so the authoritative state does not claim that remote work is pending after remote equality is observable.

## Final missed-issue sweep

I rechecked module ownership, DB/file dual writes, restore fences, advisory-lock discipline, process-local coordination, pool overlap, migrations, storage quarantine, PWA/runtime boundaries, and source/test symmetry. Existing broad risks remain in the carry-forward register; no third fresh architecture break survived.

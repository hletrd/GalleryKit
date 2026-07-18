# Document Specialist — Cycle 8 Provenance

Review target: `ff8c5f48`, 2026-07-18 KST. Review only.

## Inventory and cross-check

I read `AGENTS.md`, all 770 lines of `CLAUDE.md`, the root and app READMEs, the plan index, active Cycle 7 plan and aggregate, the consolidated carry-forward register, all current role reports, responsive source/comments/tests, package/build/deploy documentation, and the relevant main/archive/shared route implementations. Claims were cross-checked against Git signatures/refs and independent Chromium candidate-selection proofs. Historical documentation findings were used only to reject closed duplicates.

## Current findings

### DOC-C8-01 — The local `MasonryCard` contract still describes the removed viewport-width state

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed source-documentation mismatch; no current runtime failure**
- Regions: `apps/web/src/components/masonry-card.tsx:16-25,176-185`; replacement implementation at `apps/web/src/components/home-client.tsx:69-105,257-273`

The prop comment says the estimate changes with a "viewport/column-count bucket," and the memoization comment claims a "viewport-bucket change that doesn't affect this card" can bail out. Cycle 7 deleted the viewport-width bucket. Width now comes from a shared `ResizeObserver` on the masonry container, and a changed numeric `estimatedCardWidth` prop correctly forces every existing card to render; only unchanged container buckets or unrelated parent state bail out.

Concrete failure: a maintainer using the component's nearest contract can implement or approve `window.resize`-only invalidation for a container-layout change, missing the CSS/container-only resize case the observer was introduced to handle, or expect a shallow-comparison bailout when the numeric width prop actually changed.

Fix: rename both comments to the observed container-width bucket and document the real memo invariant: unchanged bucket observations and unrelated parent state bail out; a new `estimatedCardWidth` intentionally re-renders cards.

### DOC-C8-02 — Cycle 7 claims source-size hints match geometry although its ultrawide branch was never matched

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed plan/code/evidence contradiction; underlying bandwidth defect confirmed separately**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:35-40,58-66,86-93`; `apps/web/src/lib/responsive-masonry.ts:1-7,37-65`; `apps/web/e2e/responsive-masonry.spec.ts:8-55,57-133`; public cap at `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`

The acceptance criteria say sparse one-to-four-photo galleries retain "matching source-size hints," and the validation evidence presents the 2,560 px case as proof. In fact that case uses two items at DPR 2, where both the inflated viewport hint and the correct container slot select the same maximum 1536w candidate. Three items at 2,560 px/DPR 1 expose the contradiction: the real approximately 491 px slot selects 640w, while the documented `33vw` hint selects 1536w. Archive/shared top branches have analogous uncovered DPR boundaries.

Concrete failure: the next recovery/review treats resource selection as verified and closed because the authoritative plan says the hints match, so the ultrawide overfetch survives despite a green named browser regression.

Fix: qualify the Cycle 7 record as intrinsic-geometry coverage only, then update the current plan/evidence after container-capped source hints and exact candidate tests land. Preserve the historical test result; do not rewrite it as though the missing DPR/item-count cases ran.

### DOC-C8-03 — Cycle 7 remains active and pending after signed remote publication

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed repository-state mismatch; exact production SHA remains manual-validation**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:3-5,48-50,73-82`; `.context/plans/README.md:34-40`; signed commits `498e5122`, `90a3bc07`, `ff8c5f48`

All Cycle 7 commits have good GPG signatures and `master == origin/master == ff8c5f48`, yet the authoritative plan says "signed release pending," keeps publication/deploy unchecked, and remains the active frontier. This is the current Cycle 7 instance, not the Cycle 6 mismatch that the plan already repaired.

Concrete failure: a resumed agent repeats publication/deployment or starts from `ec7fc46f` instead of the signed remote HEAD.

Fix: record the observable signature/remote evidence, qualify deploy state without inventing an exact production SHA, archive Cycle 7, and advance the index. Add a terminal post-push reconciliation convention so this state is not reconstructed one cycle late indefinitely.

## Final missed-issue sweep

I cross-checked environment-variable defaults, migration instructions, privacy/color/HDR/CLIP claims, persistence and deploy topology, responsive helper comments, test descriptions, and deferred-policy references against current source. No fourth actionable mismatch survived validation and historical deduplication.

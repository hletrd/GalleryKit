# Code Reviewer — Cycle 8 Provenance

Review target: `ff8c5f48` (`master == origin/master`), 2026-07-18 KST. Review only; no source or plan edits.

## Inventory and validation

I inventoried the full maintained TypeScript/JavaScript surface before reviewing: 671 files across `apps/web/src`, `apps/web/scripts`, and `apps/web/e2e` (629 under `src`, including 364 Vitest files plus one test stub; 28 scripts; and 14 Playwright files), plus 12 route handlers, 13 server-action modules, 31 migrations with journal/reconcile, package/build/PWA/Docker/deploy assets, `AGENTS.md`, and all 770 lines of `CLAUDE.md`. I traced the recent responsive changes as an entry point, then swept route/action guards, privacy projections, schema promotion, DB/file lifecycles, restore/queue ordering, cache/runtime boundaries, and the current release ledger. Historical reviews were used to reject fixed or already-carried findings.

Focused Vitest for `responsive-masonry` and `masonry-card-memo` passed 2 files / 34 tests. A standalone Chromium selection proof at 2,560 px/DPR 1 requested 1536w for `sizes="33vw"` and 640w for the real 491 px slot against the same two-candidate `srcset`. `git diff --check` was clean before these provenance files were replaced. The Cycle 7 plan records the same-HEAD full lint, security-lint, typecheck, audit, build, Vitest, and Playwright gates as green.

## Current findings

### CR-C8-01 — The measured masonry boundary does not constrain responsive image source hints

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed code-path/candidate-selection defect; transfer-size impact manual-validation**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-7,37-54`; `apps/web/src/components/home-client.tsx:257-273,349-359`; `apps/web/src/components/masonry-card.tsx:91-110`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`; `apps/web/e2e/responsive-masonry.spec.ts:8-55`; `apps/web/src/__tests__/responsive-masonry.test.ts:26-39`

Cycle 7 correctly moved `contain-intrinsic-size` onto the observed, max-width masonry container, but `getMainMasonrySizes()` still describes every slot exclusively in viewport units. Those coordinate systems diverge above Tailwind's 1,536 px container cap. This is not merely a conservative hint: the masonry card exposes only the first two configured candidates (normally 640w and 1536w), so crossing the 640w selection boundary changes the fetched file.

Concrete failure: on a 2,560 px, DPR-1 display with a three-photo result set, the public container has about 1,504 px of content and the real three-column card is `(1504 - 32) / 3 ~= 491` px. A 640w candidate is sufficient. The committed hint is `33vw`, or about 845 px, so the browser selects the 1536w candidate instead. A sparse filtered gallery therefore downloads 1536w thumbnails where its measured geometry only needs 640w. The new Playwright proof cannot catch this branch: it seeds two photos and forces DPR 2, where both the correct and inflated hints saturate at the 1536w candidate.

Fix: make the `sizes` policy share the container cap and padding/gap geometry already established by the measured-width fix. A server-stable option is to emit capped pixel/calc slots at the `2xl` branch for each effective column count; an observed-width-derived hint is also viable if candidate upgrades during hydration are proved. Add a three-item, ultrawide, DPR-1 browser case that asserts both rendered width and the selected 640w candidate. This is a sibling left by the just-landed measurement fix, not the historical missing-`2xl:columns-5` defect.

### CR-C8-02 — `MasonryCard`'s memo contract still documents the removed viewport bucket

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed source-documentation drift; no current runtime failure**
- Regions: `apps/web/src/components/masonry-card.tsx:16-25,176-185`; replacement ownership at `apps/web/src/components/home-client.tsx:69-105,257-273`

The component comments still say `estimatedCardWidth` changes with a "viewport/column-count bucket" and that a "viewport-bucket change that doesn't affect this card" can bail out. Cycle 7 removed the viewport-width state entirely: the prop now changes with the shared masonry container's 48 px bucket, and any changed numeric prop intentionally defeats the default shallow comparator for every existing card.

Concrete failure: a maintainer following this local contract can preserve or add `window.resize`-only invalidation while changing the container layout, missing CSS/container-only resizes that the new `ResizeObserver` exists to handle; the memo comment can also lead a reviewer to expect a bailout on a width-prop change that React correctly cannot perform.

Fix: rewrite the prop and memoization comments to name the observed container-width bucket and state that cards re-render when `estimatedCardWidth` changes, while unrelated parent state and unchanged bucket observations bail out. No behavior or suppression change is needed.

### CR-C8-03 — Cycle 7's authoritative release ledger stops before the signed remote HEAD

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed repository-state mismatch; exact deployed SHA remains manual-validation**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:3-5,48-50,73-82`; `.context/plans/README.md:34-40`; commits `498e5122`, `90a3bc07`, `ff8c5f48`

All three Cycle 7 commits have good GPG signatures and `master == origin/master == ff8c5f48`, but the active plan still says "signed release pending" and leaves commit/push/deploy unchecked. This is the current Cycle 7 instance, not the Cycle 6 ledger defect that Cycle 7 closed.

Concrete failure: a recovery agent follows the authoritative active plan and repeats publication/deploy work or starts the next cycle from `ec7fc46f`, even though Git proves the signed work is already remote through `ff8c5f48`.

Fix: reconcile the proven signatures and remote equality, record deploy status only from available evidence, archive Cycle 7, and advance the index. The recurring pattern warrants a post-push terminal-reconciliation step that does not require pretending a pre-push commit could record its own final SHA.

## Final missed-issue sweep

The closing sweep rechecked all recent responsive siblings, ref/listener cleanup, memo invalidation, source fallback, route/action admission, migrations, upload/delete/restore races, background consumers, PWA/cache behavior, and operator configuration. No fourth actionable current finding survived reproduction and historical deduplication.

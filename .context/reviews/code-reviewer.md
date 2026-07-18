# Code Reviewer — Cycle 6 Provenance

Review target: `6e4c25c8` (`master == origin/master`), 2026-07-18 KST. Review only; no source, plan, aggregate, or Git-state edits.

## Inventory and validation

I inventoried the maintained application before reviewing the Cycle 5 change surface: 629 TypeScript/JavaScript files under `apps/web/src`, 370 unit-test files, 14 Playwright files, 12 public route handlers, 12 server-action modules, 31 migration SQL files plus the journal/reconcile path, scripts, package/build/PWA/deploy assets, and the governing `AGENTS.md`, `CLAUDE.md`, READMEs, active plan, prior provenance, and deferred register. The `4926a3e4..6e4c25c8` diff was only an entry point; I traced responsive sizing through the home, timeline, year, and shared-group layouts, the picture fallback, memoization contract, browser scheduling, CSS containment, and release ledger.

Independent checks passed: ESLint; API-auth, action-origin/mutation-barrier, and public-route-rate-limit lints; typecheck; production audit; focused responsive/memo Vitest (16/16); full Vitest (362 passed, 2 skipped; 3,415 passed, 4 expected skips); `git diff --check`. Production browser checks at 393/768/1024/1536 CSS px confirmed current responsive source selection and the defect below.

## NEW Cycle 6 findings

### CR-C6-01 — Sparse-gallery intrinsic sizing still uses the uncapped viewport column count

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed live geometry mismatch; visible relayout is likely/manual-validation**
- Regions: `apps/web/src/components/home-client.tsx:27-79,231-274`; `apps/web/src/components/masonry-card.tsx:52-77`; `apps/web/src/app/[locale]/globals.css:231-235`

`responsiveSizes` and the CSS class policy now cap columns by `itemCount`, but `estimatedCardWidth` still divides the viewport by the raw `useColumnCount()` count. On the live two-photo filter at 1,536 px, the grid rendered two 744×496 cards and correctly advertised `50vw`; computed `contain-intrinsic-size` was only `auto 196px`, the height derived from a roughly 294 px five-column width. Thus the new source-size fix exposes a sibling geometry owner that is still unsynchronized.

Concrete failure: when a sparse grid is outside the browser's content-visibility relevance region (for example a short-height desktop viewport with the filter/header above it), the document initially reserves about 196 px for a 496 px card. Approaching the grid can add roughly 300 px per card to the multicolumn layout and move scroll geometry. The common tall-viewport two-photo case renders immediately, so the user-visible shift itself needs a short-viewport/browser-matrix proof.

Fix: calculate an effective column count from `itemCount` and the responsive maximum, and use it for both `estimatedCardWidth` and the class/size policy. Prefer one shared policy helper returning effective columns and sizes; derive width from the actual container via `ResizeObserver` if container sizing can diverge from the viewport.

### CR-C6-02 — Browser coverage skips the changed main-gallery sizing path

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test-design gap; current production sizing is correct**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:4-85`; `apps/web/src/__tests__/responsive-masonry.test.ts:8-42`; `apps/web/src/__tests__/masonry-card-memo.test.ts:99-177`

The new E2E visits timeline and shared-group routes only. Pure helper tests validate returned strings, while the memo test source-pins only `responsiveSizes={responsiveSizes}` and reimplements prop construction. No behavior test mounts or visits `HomeClient` with one-to-four items.

Concrete failure: changing the home initializer to `getMainMasonrySizes(5)` would break sparse galleries while the helper tests, archive/shared E2E, and current prop-presence source assertion all continue to pass.

Fix: seed or expose deterministic one-, two-, four-, and five-photo home fixtures and assert computed column count, emitted `sizes`, current candidate, and computed intrinsic-size hint at representative boundaries. This specific gap also satisfies the spirit of the existing broad source-contract test-hardening carry-forward; it is reported as a new concrete instance, not a renamed generic backlog item.

## Revalidated, not new

Cycle 5's breakpoint and independent-priority defects are fixed. The prior architecture concern is only partially retired: sizes are centralized, but class breakpoints/effective columns remain separately encoded in `home-client.tsx`, archive/shared JSX, and `responsive-masonry.ts`. Existing pool-budget, single-writer, restore-generation, map/vector-scale, and rollback risks remain in `deferred-carry-forward.md`; no exit criterion was silently reclassified here.

## Final missed-issue sweep

The closing sweep covered route/action exports and guard order, privacy projections, migrations/journal/reconcile, raw SQL/child processes, upload/delete/restore races, queue/cache/listener cleanup, image/color delivery, responsive siblings, PWA/build/runtime config, deploy scripts, tests, and ledgers. No additional new code defect survived validation.

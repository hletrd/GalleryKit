# Code Reviewer — Cycle 7 Provenance

Review target: `ec7fc46f` (`master == origin/master`), 2026-07-18 KST. Review only; no source or plan edits.

## Inventory and validation

I inventoried all 671 maintained TypeScript/JavaScript files under `apps/web/src`, `apps/web/scripts`, and `apps/web/e2e` before reviewing: 629 application files, 364 unit-test files, 13 Playwright specs, 12 route handlers, 14 server-action modules, 31 migrations plus journal/reconcile, and the package/build/PWA/Docker/deploy surfaces. I also read `AGENTS.md`, `CLAUDE.md`, the current Cycle 6 plan, the consolidated carry-forward register, and the latest role reviews. The `6e4c25c8..ec7fc46f` diff was an entry point, not a scope boundary.

Fresh checks passed: ESLint; API-auth, action-origin/mutation-barrier, and public-route-rate-limit lints; typecheck; production dependency audit; full Vitest (362 files passed, 2 skipped; 3,421 tests passed, 4 expected skips); and `git diff --check` before the review files were replaced.

## New Cycle 7 findings

### CR-C7-01 — The sparse intrinsic-size fix mixes viewport width with a max-width container

- Severity: **Medium**
- Confidence: **High**
- Classification: **Confirmed code-path geometry mismatch; visible layout shift needs manual/browser validation**
- Regions: `apps/web/src/components/home-client.tsx:21-79,231-249`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-19`; `apps/web/tailwind.config.ts:21-22`; `apps/web/src/components/masonry-card.tsx:58-77`; `apps/web/src/app/[locale]/globals.css:231-235`; `apps/web/e2e/responsive-masonry.spec.ts:11-49`

Cycle 6 correctly changed the divisor from the raw breakpoint count to the item-capped count, but the numerator remains quantized `window.innerWidth`. The masonry lives inside Tailwind's `.container`, and this repository does not override the default 2xl container cap (1,536 px), with another 32 px removed by `px-4`. Above 1,536 px the estimator therefore grows with the screen while the rendered grid does not.

Concrete failure: at a 2,560 px viewport, the stored width is 2,544 px. A two-photo grid estimates `(2544 - 16) / 2 = 1264` px per card, while the capped/padded grid renders `(1504 - 16) / 2 = 744` px cards. Every valid aspect ratio therefore receives a `contain-intrinsic-size` height about 1.70x its rendered height. For the 3:2 production case used in Cycle 6, the hint is about 843 px for a 496 px card. If `content-visibility:auto` defers the card, activation collapses that excess reservation and changes scroll/layout geometry. The new E2E passes precisely at 1,536 px, where viewport and container widths nearly coincide, so it masks the wide-screen branch.

Suggested fix: observe the actual masonry grid width (prefer a shared `ResizeObserver` hook), bucket that observed width if rerender control is still needed, and divide it by the effective column count. Extend the sparse browser case to at least one viewport above the container cap (for example 2,560 px) and compare the computed hint with the rendered card.

This is not a renamed historical item. Cycle 6 mentioned container observation only as an optional follow-up and explicitly scoped it out; the current item-count change makes the ultrawide over-reservation concrete and materially larger.

### CR-C7-02 — The Cycle 6 release ledger still describes already-pushed signed work as pending

- Severity: **Low**
- Confidence: **High**
- Classification: **Confirmed signed-push/index mismatch; deployment identity remains manual-validation**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:3-5,43-45,65-73`; `.context/plans/README.md:34-41`; Git commits `fcbce386`, `03a96a3d`, `ec7fc46f`

All three current-cycle commits have good GPG signatures and `master == origin/master == ec7fc46f`, but the authoritative plan says "signed release pending", leaves commit/push unchecked, and remains the active frontier. A recovery agent can therefore repeat publication work or reason from the wrong release boundary.

Suggested fix: reconcile the observable signatures and remote equality, record deploy evidence separately without inventing an exact deployed SHA, archive Cycle 6, and advance the plan index.

This is new state for the newly published Cycle 6 plan; the analogous Cycle 5 ledger defect is already fixed and historical.

## Final missed-issue sweep

The closing sweep rechecked route/action exports and guard order, privacy projections, migration/journal/reconcile parity, raw SQL and child-process boundaries, upload/delete/restore races, queues and caches, image/color delivery, responsive siblings, timers/listeners, PWA/build/runtime configuration, tests, and release ledgers. No third fresh code finding survived validation; older topology, pool-budget, map/vector-scale, restore-generation, and operator items remain in the carry-forward register.

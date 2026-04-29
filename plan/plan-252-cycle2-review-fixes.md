# Plan 252 — Cycle 2 review fixes and cycle-1 reconciliation

## Context
Cycle 2 Prompt 1 produced 12 current-cycle raw findings (9 merged groups) in `.context/reviews/_aggregate.md`. This plan schedules every merged finding for implementation. It also reconciles the uncommitted Cycle 1 work from `plan/plan-249-cycle2-fresh-gate-fix.md` and `plan/plan-250-cycle1-implementation.md`: keep the partial implementation, fix newly identified regressions, finish critical/security/correctness items, and leave only explicitly recorded deferred work.

## Repo rules read
- `CLAUDE.md`: Node 24+/TS 6; Docker standalone; single web-instance/single-writer topology documented; uploads are 200 MB per file with separate 2 GiB batch cap; restore cap is 250 MB; security/auth/origin/upload/restore guards are blocking; live secrets must not be reused or exposed.
- `AGENTS.md`: always commit and push; use gitmoji; run lint, typecheck, tests, build, and static/security lint gates after changes.
- `.context/**`: current aggregate and prior plan/review artifacts require no silent deferrals and preserved severity/confidence.
- `.cursorrules`: absent.
- `CONTRIBUTING.md`: absent.
- `docs/`: no repository docs directory present.

## Scheduled implementation items

### Current-cycle findings
- [x] C2-AGG-01 / CR2-CQ-01 (High / High): Fix load-more cursor reset/duplicate-page bug by making the initial cursor identity stable and/or resetting only on query changes. Add a regression covering two consecutive page loads without duplicate IDs.
- [x] C2-AGG-02 / CR2-CQ-02 (High / High): Repair the `GalleryImage` cursor field type contract (`capture_date`, `created_at`, `id`) so the app typecheck passes without casts and future cursor fields remain guarded.
- [x] C2-AGG-03 / CR2-CQ-03 / SEC2-01 (High / Medium-High): Align large-body limits across upload and DB restore and avoid misleading 216 MiB vs 250 MiB behavior. At minimum, add shared constants/tests so the framework cap is intentionally derived from the largest Server Action body surface plus overhead; record any remaining route-split hardening if not finished.
- [x] C2-AGG-04 / CR2-CQ-04 / SEC2-03 (Medium / High): Stop shell-sourcing dotenv files in Playwright `webServer.command`; load dotenv as data and execute a repo-controlled Node wrapper with explicit environment.
- [x] C2-AGG-05 / CR2-CQ-05 (Medium / High): Add a JS/MJS syntax gate for critical scripts (`prepare-next-typegen.mjs`, deploy/migration helpers) or convert them to checked TypeScript.
- [x] C2-AGG-06 / CR2-CQ-06 / SEC2-05 (Low / High): Centralize local storage key validation so `getUrl()` rejects empty, traversal, absolute, and private-original keys consistently; add tests.
- [x] C2-AGG-07 / SEC2-02 (High / High): Finish restore/upload writer coordination by making restore acquire the upload-processing contract lock (or equivalent shared DB lock) before the maintenance/import window; add a targeted regression or source invariant.
- [x] C2-AGG-08 / SEC2-04 (Medium / High): Support deploy env files outside the repo checkout and move the current ignored `.env.deploy` to a non-repo secrets path without printing values. Add docs/example comments so future agents use `DEPLOY_ENV_FILE`.
- [x] C2-AGG-09 / SEC2-06 (Medium / High): Resolve PostCSS lock/install drift so audit no longer reports the nested vulnerable PostCSS copy, or record an explicit time-bound upstream deferral only if impossible.
- [x] C2-AGG-10 / PERF2-01 (Medium / High): Bound and canonicalize public cursor date strings before they reach DB predicates; share validation between action and data layers where practical.

### Cycle-1 uncommitted work to keep and verify
- [x] Keep the existing typecheck/build wrapper work (`apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/scripts/prepare-next-typegen.mjs`, `tsconfig.*.json`) but repair the gaps above.
- [x] Keep the existing SQL restore scanner, reserved-route validation, UI/accessibility, public pagination, storage, and docs/message changes unless a gate proves them wrong.
- [x] Update progress in Plan 249/250/251 after implementation and before commit.

## Required gates
Run the full configured gate set from the orchestrator against the whole repo and fix all errors before committing/pushing:
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test`
- [x] `npm run test:e2e`
- [x] `npm run lint:api-auth`
- [x] `npm run lint:action-origin`

## Progress log
- [x] Prompt 2 plan authored; implementation intentionally not started in Prompt 2.
- [x] Prompt 3 implementation started.
- [x] Implemented scheduled C2 security/correctness/gate items; performance-only C2 items are recorded in Plan 253.
- [x] Full gates green: lint, typecheck, build, test, e2e, lint:api-auth, lint:action-origin.
- [ ] Fine-grained signed gitmoji commits pushed.

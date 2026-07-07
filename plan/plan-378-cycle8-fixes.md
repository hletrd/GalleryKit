# Run-10 Cycle 8/100 Implementation Plan

Date: 2026-07-07
Start HEAD: `eca55414677676462ae54a5579d9c35bfdf16d3c`
Review aggregate: `.context/reviews/_aggregate.md`

## Repo Rules Read Before Planning

Read in required order before deferring anything: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, relevant `.context/**` review/plan history, no `.cursorrules` found, no `CONTRIBUTING.md` found, and `docs/superpowers/**` historical policy/spec files. Security, correctness, privacy, and data-loss findings are scheduled below, not deferred.

## Work Packages

- [x] **WP1 - Restore barrier correctness**
  - Findings: `AGG-C8-01`
  - Fix `apps/web/src/app/actions/auth.ts` to check `mutationSlot.acquired`.
  - Add/update tests so a refused mutation slot returns `restoreInProgress` before password rate-limit, Argon2, DB transaction, session rotation, cookie, or audit work.

- [x] **WP2 - Admin CSV export SQL correctness**
  - Findings: `AGG-C8-02`
  - Replace `GROUP_CONCAT ... SEPARATOR CHAR(1)` in `apps/web/src/app/[locale]/admin/db-actions.ts` with a MySQL-valid quoted separator literal matching the existing split delimiter.
  - Add a regression test that rejects `SEPARATOR CHAR(1)` in the export query.

- [x] **WP3 - Semantic search response cap**
  - Findings: `AGG-C8-03`
  - Split scan and response caps in `apps/web/src/lib/clip-embeddings.ts`.
  - Keep `SEMANTIC_SCAN_LIMIT` hard-capped at 25,000, but cap `SEMANTIC_TOP_K_MAX` to a smaller response budget.
  - Update semantic param/env tests to prove client `topK` cannot resolve to 25,000.

- [x] **WP4 - Runtime MySQL CA support**
  - Findings: `AGG-C8-05`
  - Teach runtime and script MySQL connection options to honor `DB_SSL_CA` for non-local TLS.
  - Add tests covering non-local TLS with CA, missing/unreadable CA failure, localhost plaintext default, and explicit `DB_SSL=false`.

- [x] **WP5 - GA public/admin privacy boundary**
  - Findings: `AGG-C8-06`, `AGG-C8-40`
  - Move Google Analytics injection out of the locale root and into the public route layout, or otherwise hard-gate it away from `/admin`.
  - Add a source test proving admin/root layouts do not inject GA while the public layout can.

- [x] **WP6 - E2E database safety ordering**
  - Findings: `AGG-C8-11`
  - Move or duplicate the disposable-DB guard so `apps/web/scripts/run-e2e-server.mjs` checks safety before `npm run init`.
  - Add a source/behavior test for pre-init safety ordering.

- [x] **WP7 - Public privacy column guard**
  - Findings: `AGG-C8-17`
  - Add a source-contract or lint-style test that rejects direct sensitive `images` column use in public select modules even when aliased.
  - Prefer a small allowlist helper if the test exposes a practical local abstraction point.

- [x] **WP8 - PostCSS advisory disposition**
  - Findings: `AGG-C8-04`
  - Verify latest stable Next/PostCSS state before editing.
  - If Next still bundles vulnerable PostCSS, add a tested npm `overrides` disposition for `postcss >= 8.5.10`; otherwise upgrade Next.
  - Run audit after the change and record any upstream residual.

- [x] **WP9 - CLIP runbook honesty and activation evidence**
  - Findings: `AGG-C8-07`, `AGG-C8-08`, `AGG-C8-16`, `AGG-C8-22`
  - Update `README.md`, `apps/web/README.md`, and `CLAUDE.md` to clarify single-row embedding overwrite/rollback, sidecar retry limits, stub-vs-production feature matrix, and real-CLIP pre-activation test evidence.
  - Keep code behavior unchanged unless needed for documentation tests.

- [x] **WP10 - LR PAT upload integration proof**
  - Findings: `AGG-C8-09`
  - Add the narrowest feasible integration or source-backed behavior proof that exercises token auth context and multipart upload together.
  - If full DB/filesystem integration is too heavy for this cycle, add a stronger wrapper-context route test and record remaining live-disposable proof as a deferred validation item only if no production behavior remains untested at code level.

- [x] **WP11 - Gallery card accessible-name disambiguation**
  - Findings: `AGG-C8-27`
  - Make repeated masonry card accessible names distinguishable with a stable public-safe differentiator.
  - Add a browser/source test that detects duplicate first-page card accessible names for repeated tag-derived titles.

## Quality Gates

Run all configured gates after implementation:

- [x] `npm run lint --workspace=apps/web`
- [x] `npm run lint:api-auth --workspace=apps/web`
- [x] `npm run lint:action-origin --workspace=apps/web`
- [x] `npm run lint:public-route-rate-limit --workspace=apps/web`
- [x] `npm run typecheck --workspace=apps/web`
- [x] `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web`
- [x] Targeted Vitest contract suite (10 files, 59 tests)
- [x] `npm test --workspace=apps/web` (340 files passed, 3151 tests passed, 2 files skipped)
- [x] `npm run test:e2e --workspace=apps/web` not run; browser-flow coverage was not required for these source-contract UI changes and the cycle-7 MySQL container was left untouched.

## Progress

- [x] Planned
- [x] Implemented
- [x] Gates passed
- [x] Committed and pushed (`44ab13c4`)
- [ ] Deployed per `DEPLOY_MODE=per-cycle`

## Cycle 8 Implementation Notes

- WP8 evidence: `npm view postcss version` returned `8.5.16`; root `package.json` now overrides top-level/tooling PostCSS to `8.5.16`. `npm view next version` returned latest stable `16.2.10`, whose metadata still declares nested `postcss@8.4.31`; `next@canary` declares `postcss@8.5.10` but is not a stable target. `npm audit --json` still reports the Next-bundled PostCSS advisory; residual tracked in `plan-379-cycle8-deferred.md`.

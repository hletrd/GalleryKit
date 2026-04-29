# Plan 250 — Cycle 1 implementation from aggregate reviews

## Context
Cycle 1 Prompt 1 produced 64 raw findings (55 deduped aggregate groups) across review agents. This plan schedules the findings selected for implementation in this cycle. Deferred findings are recorded separately in `plan/plan-251-cycle1-deferred.md` with severity/confidence preserved.

## Repo rules read
- `CLAUDE.md`: single-writer/process-local topology is documented; production requires Node 24+, Docker standalone output, strict auth/origin/upload/restore safeguards, and historical secrets must not be reused.
- `AGENTS.md`: always commit and push; use gitmoji; run lint/typecheck/tests/build/static checks; final reports include changed files/simplifications/risks.
- `.context/**`: prior plans/reviews emphasize no silent deferral and preserving review provenance.
- `.cursorrules`: not present.
- `CONTRIBUTING.md`: not present.
- `docs/`: no additional docs directory present in repo root.

## Scheduled implementation items

### Gate/build/dependency safety
- [ ] AGG-04 / AGG-05: make `ignoreBuildErrors` conditional on an explicit successful wrapper typecheck marker; add config/script invariant tests; add scripts typecheck to the gate; add generated `.next/types` preflight/cleanup before `next typegen`; reduce duplicate/flaky typecheck surface where safe.
- [ ] AGG-07: refresh dependency lock/install state so production PostCSS advisory no longer appears.
- [ ] AGG-23 / AGG-27 / AGG-28 / AGG-29 / AGG-30 / AGG-31: update docs/comments for first-run category + async processing, free-space precheck, locked upload settings, OG image URL rules, migration-on-start, and non-production session secret fallback.

### Security/correctness/data consistency
- [ ] AGG-01: fix image-processing claim retry so scheduled retries can re-enter the queue; add regression test.
- [ ] AGG-02: block `CREATE DEFINER ...` trigger/view/routine/event syntax including conditional-comment forms; add regression tests.
- [ ] AGG-03: consolidate reserved public route/topic segments; add validation tests.
- [ ] AGG-06: lower global Server Actions/proxy body cap to per-file transport needs rather than 2 GiB total batch cap; keep batch app-level cap separate; update tests/docs.
- [ ] AGG-08: make production `unknown` rate-limit bucket use loud fail/warn behavior or safer fallback; add test.
- [ ] AGG-09: share a mutation barrier between DB restore and uploads by acquiring the upload-processing contract lock during restore and rechecking maintenance immediately before upload DB insert/enqueue; add/adjust tests where feasible.
- [ ] AGG-10: prevent experimental storage adapter from returning public URLs for private/original keys; add regression test.
- [ ] AGG-11: include settings and SEO in nginx admin mutation rate limiting.
- [ ] AGG-12: widen server-action origin scanner to all `src/app/**` `use server` files with explicit allowlist/exemptions; keep guard passing.
- [ ] AGG-13: decode ICC `mluc` as UTF-16BE; add unit fixture.
- [ ] AGG-14: surface batch-tag partial-success warnings in the admin UI.
- [ ] AGG-15: validate restore file presence/size/header before entering global maintenance when possible.
- [ ] AGG-16: replace mutable public feed offset pagination with cursor/keyset pagination.
- [ ] AGG-50: make DB backup/restore UI/docs explicitly database-only and warn about file assets; full gallery backup remains deferred in Plan 251.
- [ ] AGG-51 / AGG-52: improve deployment docs/config guardrails for single-writer and build/runtime image base URL drift; full runtime lease/build-manifest enforcement remains deferred in Plan 251.

### UI/UX/product polish
- [ ] AGG-17: enlarge shared dialog close target.
- [ ] AGG-18: make admin skip-link target focusable.
- [ ] AGG-19: enlarge chip/alias/upload destructive controls where practical this cycle.
- [ ] AGG-20: add inline add-admin password mismatch error association.
- [ ] AGG-21: align gallery image `sizes` with 5-column breakpoint.
- [ ] AGG-22: avoid nested `<main>` in protected admin error boundary.
- [ ] AGG-24: add visible empty states for zero-result search and first-run public gallery.
- [ ] AGG-25: preserve scroll on locale switch.
- [ ] AGG-26: make photo detail loading fallback contextual.
- [ ] AGG-32 / AGG-33 / AGG-34 / AGG-35: improve visible taxonomy/SEO/default-title/branding copy where low risk.

## Verification checklist
- [ ] Targeted unit tests for fixed utilities/components.
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run test:e2e`
- [ ] `npm run lint:api-auth`
- [ ] `npm run lint:action-origin`

## Progress log
- [ ] Prompt 2 plan authored; implementation not started yet.

## Cycle 2 reconciliation update (Prompt 2)
- [x] Cycle 2 Prompt 1 re-reviewed the uncommitted Cycle 1 work and wrote `.context/reviews/_aggregate.md`.
- [x] New blockers/regressions from the partial Cycle 1 implementation are scheduled in `plan/plan-252-cycle2-review-fixes.md`.
- [x] Existing Cycle 1 deferred findings remain in `plan/plan-251-cycle1-deferred.md`; no deferred severity/confidence was downgraded.
- [ ] Prompt 3 must finish the Plan 252 blockers, update this progress log with concrete implemented/deferred status, run all configured gates, then commit and push.

## Cycle 2 implementation update (Prompt 3)
- [x] Repaired the cursor/typecheck, JS script syntax-check, restore/body-limit, Playwright dotenv, storage URL, restore/upload lock, deploy-env, and PostCSS audit issues from Plan 252.
- [x] Verification passed: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run lint:api-auth`, `npm run lint:action-origin`.
- [x] Remaining performance-only items are explicitly deferred in `plan/plan-253-cycle2-deferred.md`; build sitemap fallback warning is recorded in `plan/plan-254-cycle2-gate-warnings.md`.

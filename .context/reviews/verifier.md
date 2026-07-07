# Verifier Review - Cycle 11

Date: 2026-07-07
Reviewer: verifier
HEAD reviewed: `b965e3bf` (`docs(review): preserve cycle 6 review artifacts`)
Mode: evidence-based correctness review against stated behavior in docs, tests, plans, scripts, and code.

Application source and plans were not edited. Only this assigned review file was written.

## Inventory

Read/inspected:

- `AGENTS.md` instructions supplied in prompt, `CLAUDE.md`, and `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Current review/plan evidence: `.context/reviews/_aggregate.md`, `.context/reviews/cycle-6-2026-07-07/*`, `.context/plans/cycle-10-2026-07-07-plan.md`, `.context/plans/cycle-10-2026-07-07-deferred.md`, `.context/plans/run10-cycle7/implementation-plan.md`.
- Recent implementation scope from `git show --stat --name-only HEAD~10..HEAD`: Docker native pins, timeline ranges, embedding storage, maintenance shutdown, public analytics actions, topic deletion, search/archive labels, tracked secret scan, and review artifact commits.
- Cross-file source surfaces: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/0029_feed_updated_indexes.sql`, package manifests/lockfile, and focused tests.

Fresh validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: pass; 2 admin API routes OK.
- `npm run lint:action-origin --workspace=apps/web`: pass; public analytics actions classified as rate-limited, admin mutations guarded.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; 10 public route files OK.
- `npm test --workspace=apps/web -- --run src/__tests__/data-timeline.test.ts src/__tests__/public-actions.test.ts src/__tests__/topics-actions.test.ts src/__tests__/semantic-embedding-storage-contract.test.ts src/__tests__/maintenance-scheduler-source.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/cycle-10-source-contracts.test.ts`: pass; 7 files / 93 tests.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: fail on nested `next/node_modules/postcss@8.4.31`.
- Focus-marker sweep: no `.only(` found under `apps/web/src/__tests__`, `apps/web/e2e`, or test configs.

Not run:

- Full lint/typecheck/build/unit/e2e, because this was a review-only pass and focused checks already covered the changed contracts. Build/typegen/e2e can write generated artifacts or disposable DB state.

## Findings

### VER-C11-01 - Restore can hang indefinitely while draining background DB writes

Severity: Medium
Confidence: High
Validation: Confirmed by static cross-file inspection; focused tests do not cover a never-settling background write.
File/line: `apps/web/src/lib/background-db-writes.ts:77`, `apps/web/src/app/[locale]/admin/db-actions.ts:545`

Failure scenario: `restoreDatabase()` enters the maintenance window, holds restore-related locks/markers, then awaits `drainBackgroundDbWritesForRestore()`. That alias loops until tracked background/analytics promises settle and has no timeout. A stalled analytics DB promise can wedge restore preparation indefinitely before import starts, leaving maintenance active and uploads/admin mutations blocked without reaching the existing bounded maintenance/admin-mutation drains.

Concrete fix: give the restore caller a bounded drain, e.g. `drainBackgroundDbWritesForRestore({ timeoutMs })` returning `false` on timeout, mirror the `drainMaintenanceSweepsForRestore()` / `drainAdminMutationsForRestore()` abort behavior, and add a regression test with a deliberately never-resolving tracked write.

### VER-C11-02 - Settings-hash tests/comments overstate invalid-value normalization and leave a mapper drift gap

Severity: Medium
Confidence: High
Validation: Confirmed by source/test inspection.
File/line: `apps/web/src/lib/settings-hash.ts:79`, `apps/web/src/lib/settings-hash.ts:82`, `apps/web/src/lib/settings-hash.ts:103`, `apps/web/src/__tests__/settings-hash.test.ts:162`, `CLAUDE.md:317`

Failure scenario: the R8-H1 comment says the hash is built from resolved config values so invalid DB values such as `image_quality_avif=150` do not misalign with encoder defaults, but the no-arg DB path hashes raw strings and only normalizes `image_sizes`. The test title says invalid DB value produces the same hash as the validated default, while the assertion correctly expects the raw invalid hash to differ. Separately, `buildHashFromConfig()` hand-maps the same 9 keys that `COLOR_IMPACTING_KEYS` iterates, so a future byte-impacting key can be added to the authoritative list and still be missed by the config-arg hot path used by serving.

Concrete fix: normalize the no-arg DB path through the same settings validator/config resolver, make the config mapper exhaustive over `COLOR_IMPACTING_KEYS`, and update the test to exercise both the DB/no-arg normalization and per-key config hash flips.

### VER-C11-03 - Canonical index documentation omits the feed/sitemap updated_at indexes

Severity: Low
Confidence: High
Validation: Confirmed static docs/schema/migration mismatch.
File/line: `CLAUDE.md:242`, `CLAUDE.md:244`, `apps/web/src/db/schema.ts:126`, `apps/web/src/db/schema.ts:128`, `apps/web/drizzle/0029_feed_updated_indexes.sql:1`

Failure scenario: `CLAUDE.md` is the canonical short-form operational reference for schema/query reasoning, but its `images` index list does not mention `idx_images_processed_updated_at` or `idx_images_topic_updated_at`, both present in schema, reconcile, and migration 0029. A future reviewer or migration author can reason from the docs and miss the feed/sitemap access paths, duplicating indexes or failing to preserve them during schema work.

Concrete fix: add the two `updated_at` composite indexes to the `Database Indexes` section and note their feed/sitemap use.

### VER-C11-04 - Production dependency audit remains red on Next's nested PostCSS

Severity: Medium
Confidence: High
Validation: Confirmed by `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`.
File/line: `package.json:7`, `apps/web/package.json:82`, `package-lock.json:9204`, `package-lock.json:9334`, `package-lock.json:9850`

Failure scenario: the root override and top-level workspace dependency resolve `postcss@8.5.16`, but `next@16.2.10` still brings `next/node_modules/postcss@8.4.31`, so the production audit fails for GHSA-qx2v-qp2m-jg93. The current deferred register records the upstream/tooling blocker, but the repository still has a red production dependency audit.

Concrete fix: upgrade to a stable Next release that removes the vulnerable nested dependency, or prove a non-destructive npm override/lockfile regeneration path that replaces the nested copy without downgrading Next. Keep `npm audit --omit=dev --audit-level=moderate` as the verification.

## Verified Non-Findings

- The run-10 scheduled fixes for timeline/year archive sargable ranges, mediumblob embedding typing, maintenance scheduler shutdown wiring, topic deletion fail-closed behavior, public analytics request-context capture, Docker native SWC pin alignment, and search/archive label improvements are present in current source and their focused tests passed.
- Public analytics queued callbacks no longer call `headers()` or rate-limit helpers inside the queued body; rate-limit admission occurs before queueing, matching the newer cycle-10 plan.
- No focused `.only(` test marker was found. Intentional skips remain limited to admin e2e credential gating and CLIP model-weight suites.

## Final Sweep Notes

Existing unowned worktree state before this verifier write: `.context/plans/deferred-carry-forward.md` modified, plus untracked `.context/reviews/cycle-6-2026-07-07/_aggregate.md` and `code-reviewer.md`. I did not edit those files.

Commonly missed areas checked: docs vs schema indexes, settings-hash comments/tests vs code, restore drain symmetry, recent run-10 plan claims vs implementation, dependency audit, action/rate-limit scanners, focused regression tests, test focus markers, and skipped test surfaces.

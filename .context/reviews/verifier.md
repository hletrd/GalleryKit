# Verifier Review - Cycle 10 Prompt 1

Date: 2026-06-29
Role: cycle 10 verifier
Scope: current `HEAD` `ee8e08af` (`fix(cycle9): harden review findings`) on `master`.
Constraint: evidence-based correctness review only. Source was not edited except this report.

## Inventory Summary

Built the inventory before judging findings:

- Project contracts: `AGENTS.md` from the prompt, `CLAUDE.md`, `plan/plan-370-cycle9-fixes.md`, `plan/plan-371-cycle9-deferred.md`, `.context/reviews/_aggregate.md`, previous `.context/reviews/verifier.md`, and run-9 cycle-8 aggregate context.
- Current HEAD change surface: `.env.deploy.example`, `CLAUDE.md`, `apps/web/Dockerfile`, `apps/web/drizzle/0027_analytics_retention_indexes.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/public/sw.js`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/build-sw.ts`, `apps/web/scripts/migrate.js`, changed tests, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/rate-limit.ts`, and `apps/web/src/lib/view-retention.ts`.
- Cross-file surfaces examined: semantic embedding write/read/retry paths, public and shared analytics counters, failed-image retry, bulk image update accounting, restore temp cleanup, retention indexes/migrations/reconcile, Lightroom token scopes/copy, Docker native package arch normalization, service-worker generation, semantic scan caps, tracked-secret scan, and the tests locking those contracts.
- Test inventory read or sampled where relevant: `image-queue-embed-wiring.test.ts`, `public-actions.test.ts`, `failed-image-retry.test.ts`, `bulk-update-images.test.ts`, `db-restore.test.ts`, `semantic-search-route.test.ts`, `cycle-7-source-contracts.test.ts`, migration/reconcile tests, `clip-semantic-limits-env.test.ts`, `sw-template-contract.test.ts`, `topics-actions.test.ts`, and `tracked-secrets.test.ts`.

## Confirmed Findings

### F-001 - Semantic bootstrap retries only one 50-row missing-embedding batch, then marks bootstrap complete

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `plan/plan-370-cycle9-fixes.md:128-133` requires a durable retry path for `processed=true` rows missing the active semantic embedding after restart/bootstrap.
- `apps/web/src/lib/image-queue.ts:370-397` selects processed rows missing the active model embedding but hard-limits the scan to `BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE` (`50`).
- `apps/web/src/lib/image-queue.ts:399-410` starts side effects for only those selected rows and has no cursor, loop, continuation, or reschedule based on whether the batch was full.
- `apps/web/src/lib/image-queue.ts:935-940` calls `bootstrapMissingActiveEmbeddings(state)` during image queue bootstrap, but it does not await a drained result or feed back whether more missing rows remain.
- `apps/web/src/lib/image-queue.ts:951-954` marks `state.bootstrapped = true` when the normal pending-image scan is empty on the first pass; after that, `apps/web/src/lib/image-queue.ts:861-864` returns early on future bootstrap calls while `state.bootstrapped` is true.
- `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:45-53` only source-checks that a bounded retry query exists. It does not cover the case where more than 50 processed rows are missing the active embedding.

Concrete failure scenario:

Production semantic mode is enabled and the process restarts after an encoder outage, DB outage, model-path outage, or restored DB state leaves 75 processed photos without `PRODUCTION_MODEL_VERSION` rows. On bootstrap, the code retries only the first 50 by ascending image id. If there are no pending `processed=false` images, the normal bootstrap path sets `state.bootstrapped = true`. The remaining 25 photos are still visible in the gallery but absent from semantic and similar-image search until another process restart or a manual backfill.

Concrete fix:

Make missing-embedding bootstrap drain in bounded passes. For example, have `bootstrapMissingActiveEmbeddings` return the number of selected rows and schedule another bootstrap/embedding continuation when it equals `BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE`, or add a cursor loop that keeps issuing bounded batches until no missing rows remain. Lock it with a behavioral test or a stronger source contract proving a full batch cannot be the terminal state.

### F-002 - CLAUDE.md still documents the old git-SHA service-worker stamp contract

Severity: Low
Confidence: High
Status: Confirmed

Evidence:

- `CLAUDE.md:407` says `scripts/build-sw.ts` stamps `__SW_VERSION__` as `git short-SHA + -p{IMAGE_PIPELINE_VERSION}`.
- `apps/web/scripts/build-sw.ts:4-12` now documents a deterministic `<template hash>-p<IMAGE_PIPELINE_VERSION>` stamp to avoid the committed-artifact freshness loop.
- `apps/web/scripts/build-sw.ts:27-34` implements the template-hash version, not a git-SHA version.
- Current `HEAD` is `ee8e08af`, while `apps/web/public/sw.js:21-26` contains `858bc13e-p7`, matching the template-hash scheme rather than the git short SHA.
- `apps/web/src/__tests__/sw-template-contract.test.ts:172-176` checks generated SW logic parity but not the version contract described in `CLAUDE.md`.

Concrete failure scenario:

A future verifier follows `CLAUDE.md` and treats any `sw.js` stamp that does not equal the current git short SHA as stale, re-opening the already-solved impossible freshness loop. Conversely, a maintainer may "fix" `build-sw.ts` back to commit-SHA stamping and reintroduce the generated-artifact drift that cycle 9 intentionally removed.

Concrete fix:

Update `CLAUDE.md:407` to say `build-sw.ts` stamps a deterministic template hash plus `-p{IMAGE_PIPELINE_VERSION}`. Optionally extend `sw-template-contract.test.ts` to assert the generated `SW_VERSION` shape/derivation so docs, script, and artifact remain aligned.

## Likely Findings

None.

## Risks / Manual Validation

- Deferred C9-01, C9-11, and C9-13 remain as recorded in `plan/plan-371-cycle9-deferred.md`; this pass did not find new evidence that upgrades them beyond their existing deferred/risk status.
- Production semantic-search health still needs operational smoke validation after deploy because it depends on DB mode, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, model weights under `CLIP_MODELS_ROOT`, and populated active-model embeddings. F-001 is a code-level retry gap inside that broader operational surface.

## Non-Findings / Verified Correct

- Analytics retention indexes are aligned across migration, journal, schema, and legacy reconcile: `apps/web/drizzle/0027_analytics_retention_indexes.sql:1-3`, `apps/web/drizzle/meta/_journal.json:194-199`, `apps/web/src/db/schema.ts:231-262`, and `apps/web/scripts/migrate.js:581-618`.
- Failed-image retry now checks `enqueueImageProcessing` and restores visible failure state on rejection: `apps/web/src/app/actions/images.ts:1208-1263`.
- Bulk image updates canonicalize to existing IDs inside the transaction and use that set for writes/audit/counts: `apps/web/src/app/actions/images.ts:1025-1146`.
- Public analytics actions validate targets before reading headers or inserting durable rows: `apps/web/src/app/actions/public.ts:364-438`; shared-group page now uses the same selected-photo decision as `getSharedGroup`: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:117-130` and `apps/web/src/lib/data.ts:1316-1327`.
- DB restore temp cleanup has one finalizer until ownership is transferred to the mysql child process: `apps/web/src/app/[locale]/admin/db-actions.ts:434-595`.
- Docker native package install normalizes `TARGETARCH` to npm arch names and fails unsupported architectures: `apps/web/Dockerfile:44-56`.
- Lightroom token UI now mints upload-only tokens and shows non-expiring copy: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61` and `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:130-133`.
- Semantic scan caps now clamp to `25_000`: `apps/web/src/lib/clip-embeddings.ts:31-44`, and both semantic routes apply `SEMANTIC_SCAN_LIMIT`.

## Validation Evidence

Commands run:

- `npm test --workspace=apps/web -- image-queue-embed-wiring.test.ts public-actions.test.ts failed-image-retry.test.ts bulk-update-images.test.ts db-restore.test.ts semantic-search-route.test.ts cycle-7-source-contracts.test.ts migration-journal.test.ts migrate-reconcile-coverage.test.ts` -> 9 files passed, 170 tests passed.
- `npm run lint:api-auth --workspace=apps/web` -> passed; 2 admin routes OK.
- `npm run lint:action-origin --workspace=apps/web` -> passed; all mutating server actions enforce same-origin provenance, public analytics actions recognized as rate-limited public actions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- `npm run typecheck --workspace=apps/web` -> passed (`typecheck:app`, `check:js-scripts`, `typecheck:scripts`).
- `npm run lint --workspace=apps/web` -> passed.

## Final Missed-Issues Sweep

Final sweeps covered:

- All files changed by `HEAD` and the cycle-9 scheduled work items.
- Semantic embedding producer, bootstrap retry, public semantic search, and similar-image search cross-file flow.
- Public analytics inserts against route-level photo/topic/shared-group behavior.
- Migration journal monotonicity, schema/reconcile/index coverage, and retention comments.
- Admin/action security scanners, same-origin/rate-limit guards, restore maintenance, temp-file cleanup, Lightroom token scope enforcement, Docker native packages, service worker docs/script/artifact/test, i18n key/copy changes, and tracked-secret scanning.

No other confirmed or likely correctness issues were found.

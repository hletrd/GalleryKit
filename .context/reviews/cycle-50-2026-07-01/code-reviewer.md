# Cycle 50 Code-Quality / Correctness Review

Review date: 2026-07-01
Lane: code-reviewer
Scope: correctness, logic bugs, SOLID/maintainability, cross-file interactions, edge cases, and failure modes.
Write scope: this artifact only.

## Repository State

- Current HEAD while writing: `646d98c9` (`docs(review): 📝 record Cycle 50 perf review`).
- Application source reviewed is unchanged from the Cycle 49 fix commit `3a02f7ee`; the newer HEAD only commits `.context/reviews/cycle-50-2026-07-01/perf-reviewer.md`.
- Shared worktree note: other Cycle 50 review artifacts were present in `.context/reviews/cycle-50-2026-07-01/`; I did not edit them.

## Inventory

Guidance and baseline reviewed:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- `.context/reviews/cycle-49-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-49-2026-07-01/code-security-performance.md`
- `.context/reviews/cycle-49-2026-07-01/verifier-test-debugger.md`
- `.context/plans/cycle-49-2026-07-01-deferred.md`
- Existing Cycle 50 artifacts: `perf-reviewer.md`, `verifier-test-debugger.md`, `document-specialist.md`

Source and patterns inspected:
- Topic route mutations and route advisory locking: `apps/web/src/app/actions/topics.ts`, `apps/web/src/__tests__/topics-actions.test.ts`.
- Service-worker HTML routing and generated-worker parity: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/__tests__/sw-template-contract.test.ts`.
- Admin and public mutation guards: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/**/route.ts`.
- Upload, Lightroom upload, quota settlement, retry, and queue interactions: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`.
- Restore/import coordination and lock lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/__tests__/restore-upload-lock.test.ts`, `apps/web/src/__tests__/db-restore.test.ts`.
- Public data projection and privacy-sensitive field guards: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`.
- Semantic/similar search route guards and failure modes: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Migration journal/reconcile correctness: `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.

## Findings

No actionable new code-quality or source-correctness findings.

## Evidence

- The Cycle 49 topic-route race fix is present in live code: route-changing topic mutations share `withTopicRouteMutationLock` at `apps/web/src/app/actions/topics.ts:62`, and `deleteTopic` enters that lock before checking image use and deleting at `apps/web/src/app/actions/topics.ts:433`. The regression test asserts advisory-lock ordering around deletion in `apps/web/src/__tests__/topics-actions.test.ts:552`.
- The Cycle 49 service-worker behavior fix is present in both template and generated worker: `isRevocableShareHtmlRoute` is defined at `apps/web/public/sw.template.js:59` and `apps/web/public/sw.js:59`, and the fetch handler bypasses only those revocable/share HTML routes at `apps/web/public/sw.template.js:458` / `apps/web/public/sw.js:458`. Normal photo pages are not in that classifier. The verifier lane separately recorded a test-strength gap for this area, so I did not duplicate it as a live source-correctness finding.
- Normal upload quota settlement is centralized through `settleClaim` in `apps/web/src/app/actions/images.ts:258`, with rejection/early-return settlement paths around validation and disk checks, late restore cleanup via `cleanupOriginalIfRestoreMaintenanceBegan` at `apps/web/src/app/actions/images.ts:418`, and final settlement after processing at `apps/web/src/app/actions/images.ts:591` and `apps/web/src/app/actions/images.ts:616`.
- Failed-image retry keeps failure state recoverable if enqueue rejects: `retryFailedImage` starts at `apps/web/src/app/actions/images.ts:1207` and restores visible failed state after a failed enqueue path at `apps/web/src/app/actions/images.ts:1314`.
- Lightroom upload bounds parser concurrency before `formData()` through `tryAcquireLrMultipartParseSlot` at `apps/web/src/app/api/admin/lr/upload/route.ts:63` and holds the upload-processing contract lock from `apps/web/src/app/api/admin/lr/upload/route.ts:279`; late restore cleanup before insert is checked at `apps/web/src/app/api/admin/lr/upload/route.ts:422`.
- Restore/import coordination holds the DB restore lock, upload-processing contract lock, color backfill lock, and semantic backfill lock before durable maintenance begins, with explicit early-return and finally releases around `apps/web/src/app/[locale]/admin/db-actions.ts:420`, `:429`, `:452`, and `:523`. Post-import migration is required before success at `apps/web/src/app/[locale]/admin/db-actions.ts:726`, and migration failure keeps maintenance active at `apps/web/src/app/[locale]/admin/db-actions.ts:732`.
- Public data projections still exclude privacy-sensitive/admin-only fields. `publicSelectFields` is the canonical unauthenticated projection at `apps/web/src/lib/data.ts:368`, `PrivacySensitiveKeys` is enumerated at `apps/web/src/lib/data.ts:473`, compile-time guards reject sensitive fields at `apps/web/src/lib/data.ts:475` and map-specific leaks at `apps/web/src/lib/data.ts:487`, and the symmetric privacy fixture covers the same keys in `apps/web/src/__tests__/privacy-fields.test.ts:7`.
- Migration bookkeeping remains protected: the latest journal entry `0028_rate_limit_bucket_start_idx` is present in `apps/web/drizzle/meta/_journal.json:205`, its fresh-DB reconcile index is mirrored in `apps/web/scripts/migrate.js:682`, and migration hash postconditions read `__drizzle_migrations` at `apps/web/scripts/migrate.js:721`.
- Focused guard checks passed during this review:
  - `npm run lint:api-auth --workspace=apps/web`
  - `npm run lint:action-origin --workspace=apps/web`
  - `npm run lint:public-route-rate-limit --workspace=apps/web`

## Not Re-raised

The Cycle 49 carry-forward deferred set remains unchanged and was not re-filed: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`. I found no new evidence changing severity or making those items scheduled now.

## Validation Limits

This was a read-only review lane. I ran the three focused auth/origin/rate-limit lint gates listed above, but did not run the full lint, typecheck, build, unit, or e2e suites. I made no source changes and did not run git commit, pull, push, deploy, or revert commands.

## Finding Count

0

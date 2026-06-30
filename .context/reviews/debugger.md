# Cycle 30 Debugger Review

Role: debugger  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `666b74f8` (`fix(cycle-29): harden review findings`)  
Date: 2026-06-30  
Scope: Prompt 1 of cycle 30/100. Latent failure-mode review only; no fixes implemented.

## Inventory

Reviewed current HEAD across:

- Restore/DB maintenance: `db-actions.ts`, durable/process restore maintenance, image queue quiesce/resume, background DB write drain.
- Public APIs and guards: health/live routes, OG routes, semantic/similar search, public route rate-limit lint.
- CLIP/semantic paths: route mode gates, sidecar backfill, unwired server action backfill.
- Recent client changes: similar photos retry handling, nav hydration theme, topic map visibility confirmation.
- Tests/source contracts: restore-upload lock tests, health tests, map privacy tests, semantic route tests, public-route lint tests.

Validation commands:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Targeted Vitest slice passed: `health-route`, `map-privacy`, `check-public-route-rate-limit`, `semantic-search-route` (79 tests).

## Confirmed Issues

### DBG30-01: Restore prep can leave the image-processing queue paused after a partial setup failure

- Severity: High
- Confidence: High
- Classification: Confirmed latent bug
- File/region: `apps/web/src/app/[locale]/admin/db-actions.ts:492-518`; queue pause in `apps/web/src/lib/image-queue.ts:1060-1087`.
- Evidence: `restoreDatabase()` begins durable maintenance, then runs `flushBufferedSharedGroupViewCounts()`, `quiesceImageProcessingQueueForRestore()`, and `drainBackgroundDbWritesForRestore()` in one `try`. The `imageQueueQuiesced = true` flag is set only after all three finish. If `quiesceImageProcessingQueueForRestore()` succeeds and `drainBackgroundDbWritesForRestore()` throws, the catch returns `{ success:false }`. The finally clears maintenance, but the resume branch only runs when `restoreLifecycleVerified || imageQueueQuiesced`, so it skips `resumeImageProcessingQueueAfterRestore()` even though the queue was already paused/cleared.
- Concrete failure scenario: An admin starts restore while a public analytics write is hung or the DB pool errors during `drainBackgroundDbWritesForRestore()`. Restore reports failure and exits maintenance, uploads become allowed again, but the in-process PQueue remains paused. New uploads can insert rows/enqueue work, but processing does not resume until a process restart/redeploy or another code path happens to start the queue.
- Suggested fix: Set a separate `queueQuiesced`/`queuePaused` flag immediately after `quiesceImageProcessingQueueForRestore()` succeeds, before draining background writes, and resume whenever that flag is true on any exit that clears maintenance. Add a regression test where drain throws after quiesce resolves and assert resume is called.

## Likely Issues

### DBG30-02: Unwired CLIP backfill server action still reports row-level failures as successful skips

- Severity: Low while unwired; Medium if surfaced in admin UI
- Confidence: Medium
- Classification: Likely latent bug
- File/region: `apps/web/src/app/actions/embeddings.ts:53-55`, `apps/web/src/app/actions/embeddings.ts:145-188`; no call sites found by `rg "backfillClipEmbeddings\\("`.
- Evidence: The action catches all per-row embedding/upsert failures at `:181-183`, increments `skipped`, and still returns `{ status: 'ok', processed, skipped }` at `:188`. The sidecar script has stricter failure semantics and exits non-zero when rows fail.
- Concrete failure scenario: A future settings button wires this action. Missing originals, CLIP model load errors, corrupt images, or DB upsert failures are presented as an OK backfill with skipped rows. An operator can enable production semantic search with partial/missing embeddings and no failed-id list.
- Suggested fix: Keep the sidecar as the only supported entry by deleting/deprecating the action, or mirror sidecar behavior: collect failed IDs, log error causes server-side, return non-OK when failures occur, and distinguish expected missing-original skips from unexpected encoder/DB failures.

### DBG30-03: `/api/health` restore-maintenance behavior can confuse liveness integrations

- Severity: Medium
- Confidence: High
- Classification: Likely operational bug outside checked-in Docker path
- File/region: `apps/web/src/app/api/health/route.ts:7-20`; Docker uses `/api/live` at `apps/web/Dockerfile:140-143` and `apps/web/deploy.sh:34-47`.
- Evidence: The checked-in container and deploy script correctly use `/api/live`, but `/api/health` now returns `503` during restore even with `HEALTH_CHECK_DB` unset. Docs still describe `/api/health` as default liveness-only.
- Concrete failure scenario: A custom reverse proxy, uptime checker, or orchestrator follows the README and uses `/api/health` for liveness. During a planned restore, it treats the app as failed and can alert or restart/evict the process while the restore marker is active.
- Suggested fix: Align code/docs: either make `/api/health` readiness-only and update docs, or keep restore-maintenance 503 behind `HEALTH_CHECK_DB=true` while `/api/live` remains pure process liveness.

## Risks Needing Manual Validation

- Production semantic search still needs seeded model validation outside default CI. The gated tests prove the intended path only when `CLIP_OFFLINE_LOAD=1` / `CLIP_INTEGRATION=1` and model weights exist.
- E2E admin specs skip locally unless `E2E_ADMIN_ENABLED=true`; CI covers the normal path, but manual remote admin E2E remains opt-in.
- The public GET rate-limit gate now detects expensive GET routes, but it should be manually reviewed until it also proves rate-limit dominance before expensive work.

## Final Sweep

Rechecked previous debugger candidates against HEAD: similar-photos transient fetch retry was fixed, CLIP sidecar production mode now requires `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, share metadata avoids unthrottled key lookups, and public restore metadata guards were added.

Skipped areas: full build/typecheck/e2e and live restore simulation were not run. No destructive, deploy, database, or production actions were performed. Only the two requested review artifacts were changed.

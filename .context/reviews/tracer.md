# Cycle 18 Tracer Review

Role: tracer
Cycle: review-plan-fix 18/100
Scope: repository-wide causal tracing of upload, processing, delete, retry, backfill, restore, session, rate-limit, analytics, and service-worker flows. No source code changes were made.

## Review Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-17-2026-07-08-plan.md`, `.context/plans/cycle-17-2026-07-08-deferred.md`.

Inventory basis: `rg --files` over `apps/web/src`, `apps/web/scripts`, `apps/web/public`, `apps/web/e2e`, and `apps/web/drizzle` found 873 files. I traced the entry points and shared state owners rather than relying on comments or tests alone:

- Upload/delete/retry: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`.
- Queue/backfill/processing: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, CLIP helpers under `apps/web/src/lib/clip-*`.
- Restore/session/rate-limit/analytics: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`.
- API/service-worker/public delivery: API routes under `apps/web/src/app/api/**`, upload-serving routes, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/proxy.ts`, `apps/web/src/components/register-service-worker.tsx`.

## Confirmed Issues

### TRC18-01: PAT usage is marked before the Lightroom upload route's restore-maintenance gate

Severity: Low-Medium
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/src/lib/api-auth.ts:72-85` verifies an `X-GalleryKit-Token` and calls `await markTokenUsed(verified.id)` before invoking the wrapped route handler.
- `apps/web/src/lib/admin-tokens.ts:171-175` updates `admin_tokens.last_used_at = NOW()` when it can acquire a shared admin mutation slot.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-99` performs the Lightroom upload restore-maintenance rejection only after the wrapper has already touched the token.
- `apps/web/src/app/[locale]/admin/db-actions.ts:511-580` sets durable restore maintenance and then drains mutation slots; `apps/web/src/app/[locale]/admin/db-actions.ts:824-884` keeps maintenance active after import/spawn/migration failures.

Why this is a real problem:
`last_used_at` is documented as touched on token use, and the Lightroom route is the shipped PAT consumer. The wrapper records use before the route knows whether the request is admissible. During restore windows, a request that will be rejected with `503 Restore in progress` can still mutate `admin_tokens.last_used_at`. If the write happens before the restore import, it may be overwritten by the SQL dump; if it happens after a failed restore that leaves maintenance active, it survives even though no upload was accepted. Either way, the causal trace of token usage no longer distinguishes "accepted by route" from "authenticated but blocked by maintenance".

Concrete failure scenario:
1. A restore starts and sets durable maintenance.
2. An external Lightroom publisher retries with a valid PAT.
3. `withAdminAuth` verifies the token and calls `markTokenUsed()` before the upload handler reaches `isRestoreMaintenanceActive()`.
4. The handler returns 503 without parsing or accepting the upload.
5. The token page now shows a fresh `last_used_at` for a blocked attempt, or the update is erased by the import, giving operators inconsistent token-use evidence during an incident.

Suggested fix:
Split token authentication from route-specific usage telemetry. For `allowTokenScope` routes, expose the verified token to the handler and mark usage only after the handler passes its maintenance/admission gates, or make `withAdminAuth` accept a pre-use guard/result policy so 503 maintenance rejections do not update `last_used_at`. If failed authenticated attempts are useful, record them in a distinct audit/attempt field instead of overloading `last_used_at`.

## Likely Issues

None confirmed beyond the item above.

## Manual-Validation Risks

- Existing deferred topology risks remain valid but are already recorded in `.context/plans/cycle-17-2026-07-08-deferred.md`: single-writer warning-only enforcement, independent background DB budgets, SQL-only backup/file consistency, proxy topology/client-IP validation, and manual restore writer registry.
- I verified the current service-worker stamp is fresh: `IMAGE_PIPELINE_VERSION = 7`, expected SW version `c3d20237-p7`, actual `public/sw.js` `c3d20237-p7`.

## Traced Without New Findings

Browser uploads hold `acquireAdminMutationSlot()` for the full action body and the restore path drains that barrier before import. Image processing uses per-image advisory locks, processed-row rechecks, missing-original failure handling, delete-mid-processing cleanup, and bootstrap retry. Delete paths remove DB rows before strict file cleanup and clear queue maps. Public search/load-more/view analytics rate limits pre-increment before expensive or mutating work and roll back only on the intended branches. Restore holds restore/upload/backfill locks, durable maintenance, queue/background/sweep/admin drains, and keeps maintenance active after unsafe import failures.

Final sweep: no trace-relevant source/config file in the inventory was intentionally skipped. No tests were run because this prompt required review artifacts only.

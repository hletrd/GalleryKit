# Cycle 11 Tracer Lane Review

Role: `tracer`
Scope: read-only causal tracing of suspicious flows and competing hypotheses across request/action lifecycles, background work, deploy/migration, upload/processing, auth/session, restore maintenance, and cache/revalidation.
Allowed write: this report file only.
Source / plan edits: none.
Validation evidence: static causal tracing with exact source reads; `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, and `npm run lint:public-route-rate-limit --workspace=apps/web` all passed.

## Inventory

- Required instructions/context: `AGENTS.md` from prompt, `CLAUDE.md`, and `code-review` skill instructions.
- Upload and processing lifecycle: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker*.ts`, upload route handlers, and upload/queue tests.
- Restore and maintenance lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/scripts/restore-maintenance-recovery.*`, and related restore tests.
- Auth/session lifecycle: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/action-guards.ts`, admin-user/session rotation flows, token upload auth, and auth tests.
- Background work: shared-group view count buffer, public analytics actions, audit logging, image queue side effects, admin color backfill runner, semantic embedding sidecar/in-app paths, shutdown drains.
- Deploy/migration: `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, Docker/nginx templates, migration/reconcile tests.
- Cache/revalidation/serving: `apps/web/src/lib/revalidation.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/next.config.ts`, public pages with `revalidate = 0`, OG/feed routes, service-worker cache helpers.
- Final missed-issue sweep: searched action/API exemptions, rate-limit exemptions, raw SQL, child processes, destructive filesystem calls, `dangerouslySetInnerHTML`, cache/revalidation calls, restore-maintenance references, embedding storage contracts, and previous review carry-forward.

## Findings

### TRC11-01 - `logout` can delete restored session rows after a DB restore starts

- Severity: Medium
- Confidence: High
- Validation label: Confirmed (static causal trace)
- Location: `apps/web/src/app/actions/auth.ts:268-288`, `apps/web/src/app/[locale]/admin/db-actions.ts:540-590`, `apps/web/src/lib/admin-mutation-barrier.ts:76-129`

Competing hypotheses:
- Safe: every already-started foreground action that can write application state holds an admin mutation slot, so restore waits for it or rejects it before import.
- Unsafe: `logout` only checks same-origin, then verifies and deletes a session without restore-maintenance entry check or mutation-slot participation.

Evidence:
- Restore begins durable maintenance, drains queues/background writes/maintenance sweeps, then calls `drainAdminMutationsForRestore()` before `runRestore()` imports the dump (`db-actions.ts:540-590`).
- The drain only observes actions that called `acquireAdminMutationSlot()`; the barrier blocks new slots once exclusive restore drain starts and waits for existing slot holders (`admin-mutation-barrier.ts:76-129`).
- `updatePassword` participates in that barrier (`auth.ts:291-459`), but `logout` does not. It performs `verifySessionToken(token)` and then `db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)))` without checking restore maintenance or acquiring a mutation slot (`auth.ts:268-288`).
- The action-origin lint gate reports `logout` as OK because it enforces same-origin; that lint does not prove restore-drain participation.

Causal chain / failure scenario:
1. Admin submits logout just before a restore begins.
2. `logout` passes same-origin and starts session verification against the pre-restore DB.
3. Restore sets the durable maintenance marker and drains known slot holders; `logout` is invisible to that drain because it never acquired a slot.
4. Restore imports the backup and successfully recreates the `sessions` table contents.
5. The still-running `logout` resumes and deletes `hashSessionToken(token)` from the freshly restored `sessions` table.

Impact:
The point-in-time restore is no longer exact for auth/session state. In the common case this just logs out the current admin from the restored snapshot; in a forensic or operational restore, it is still a post-restore mutation that the restore-maintenance design is supposed to exclude.

Concrete fix:
Make `logout` join the same restore fence as `updatePassword`: after same-origin passes and before `verifySessionToken()` / `db.delete()`, check restore maintenance and acquire `using mutationSlot = acquireAdminMutationSlot();`. If maintenance is active or the slot is refused, skip session deletion and redirect. Add a source/behavior test proving `logout` imports `acquireAdminMutationSlot`, acquires it before `verifySessionToken`, and performs no DB delete when the slot is refused.

## Traced Non-Findings

- Upload -> processing -> restore: browser uploads hold the admin mutation slot plus upload-processing contract lock, and Lightroom uploads are fenced by the upload-processing contract lock before topic DB work/save/insert/enqueue. Restore acquires that same contract lock before setting maintenance, so an upload either finishes before restore can proceed or blocks the restore with `restoreBlockedByUpload`.
- Backup/restore: `dumpDatabase` and `restoreDatabase` share `LOCK_DB_RESTORE`; an in-flight backup blocks restore instead of racing the import. Backup publication uses `.tmp` plus `rename()` after header/trailer checks.
- Background analytics/audit: public view writes and audit writes are tracked through bounded background write sets/queues; restore drains them after setting maintenance, and queued analytics closures re-check maintenance before DB writes.
- Semantic embedding storage: the prior root `tracer.md` finding about `image_embeddings` needing `(image_id, model_version)` is stale for this checkout. Current docs and tests intentionally define one active row per `image_id`, with `model_version` labelling the current vector and different modes destructively replacing that row (`CLAUDE.md:160`, `apps/web/README.md:73-75`, `apps/web/src/__tests__/semantic-embedding-storage-contract.test.ts:11-23`).
- Cache/revalidation: derivative serving keeps a one-hour `must-revalidate` policy across Next static headers and route-handler fallback; route fallback ETags include pipeline/mtime/size/settings hash. The documented static-derivative settings-change limitation still requires re-encode and is not a new code defect.
- Migration/deploy: migration startup retains per-entry baseline guards, DML-baseline refusal, pending-tail handling, and post-condition hash verification. Deploy pruning remains after successful health check and only prunes Docker-managed unused artifacts, not bind-mounted GalleryKit data.

## Final Sweep

The final sweep did not surface another high-confidence causal failure. The main residual risk is test coverage shape: auth restore-barrier tests cover `updatePassword`, hostile-origin logout, and the barrier primitive, but not `logout` as a session-mutating action that must be drained before restore import.

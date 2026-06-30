# Tracer Review - Cycle 21

Review lane: `tracer`
Scope: current `HEAD` (`1ed96484`)
Mode: review-only. Implementation files were not modified. No commit or push was performed.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the repository with targeted `rg` and source reads before tracing. This pass focused on causal handoffs and competing hypotheses across uploads, image processing, semantic search, OG routes, analytics, auth/session, sharing, backup/restore, and deploy/runtime.

Primary files and regions inspected:

- Upload admission and LR ingress: `apps/web/src/app/actions/images.ts:114-624`, `apps/web/src/app/api/admin/lr/upload/route.ts:60-552`, `apps/web/src/lib/upload-tracker-state.ts:15-79`, `apps/web/src/lib/upload-processing-contract-lock.ts:9-74`.
- Queue, processing, and embedding side effects: `apps/web/src/lib/image-queue.ts:76-178`, `apps/web/src/lib/image-queue.ts:334-368`, `apps/web/src/lib/image-queue.ts:489-920`, `apps/web/src/instrumentation.ts:1-90`.
- Semantic search and CLIP backfill: `apps/web/src/app/api/search/semantic/route.ts:1-360`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-270`, `apps/web/src/lib/clip-model.ts:53-312`, `apps/web/src/lib/clip-embeddings.ts:22-191`, `apps/web/src/app/actions/embeddings.ts:55-181`, `apps/web/scripts/backfill-clip-embeddings.ts:80-207`.
- OG routes and public image fetch: `apps/web/src/app/api/og/route.tsx:61-240`, `apps/web/src/app/api/og/photo/[id]/route.tsx:39-295`, `apps/web/src/lib/og-photo-fetch.ts:30-118`, `apps/web/src/lib/seo-og-url.ts:3-42`.
- Analytics, public data, and sharing: `apps/web/src/app/actions/public.ts:120-460`, `apps/web/src/lib/analytics.ts:23-190`, `apps/web/src/lib/data.ts:13-249`, `apps/web/src/lib/data.ts:1024-1341`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:30-139`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:35-164`, `apps/web/src/app/actions/sharing.ts:91-398`.
- Auth/session/origin gates: `apps/web/src/app/actions/auth.ts:70-445`, `apps/web/src/lib/session.ts:13-151`, `apps/web/src/proxy.ts:52-140`, `apps/web/src/lib/request-origin.ts:45-107`, `apps/web/src/lib/api-auth.ts:58-144`, `apps/web/src/lib/admin-tokens.ts:1-242`.
- Backup, restore, schema safety, and deploy: `apps/web/src/app/[locale]/admin/db-actions.ts:162-767`, `apps/web/src/lib/db-restore.ts:1-34`, `apps/web/src/lib/sql-restore-scan.ts:12-168`, `apps/web/src/app/api/admin/db/download/route.ts:21-100`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/deploy.sh:1-63`, `apps/web/docker-compose.yml:24-28`, `apps/web/Dockerfile:1-152`, `apps/web/scripts/entrypoint.sh:1-42`, `apps/web/nginx/default.conf:1-201`.

No test suite was run; this was a static causal trace. Evidence below is from exact source regions.

## Findings

### TRC-C21-01 - CLIP embedding backfills can write through a database restore window

Severity: Medium
Confidence: High
Status: Confirmed concurrency gap

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:387-424` acquires `LOCK_DB_RESTORE`, the upload-processing contract lock, and `LOCK_COLOR_PIPELINE_BACKFILL` before restore, but does not acquire any semantic/CLIP embedding lock.
- `apps/web/src/app/[locale]/admin/db-actions.ts:454-458` flushes shared-group analytics and quiesces the in-process image queue before importing the restore.
- `apps/web/src/lib/restore-maintenance.ts:1-56` stores restore maintenance in process-local `globalThis` state, so a sidecar script or another Node process cannot observe it.
- `apps/web/src/lib/image-queue.ts:350-368` checks `isRestoreMaintenanceActive()` immediately before writing an upload-time embedding, so the queue path has an in-process restore guard.
- `apps/web/src/app/actions/embeddings.ts:55-58` checks restore maintenance only at entry, then selects and upserts embeddings in batches at `apps/web/src/app/actions/embeddings.ts:103-181` without an advisory lock or per-batch restore recheck.
- `apps/web/scripts/backfill-clip-embeddings.ts:94-105` checks only semantic mode/force, then scans and upserts `image_embeddings` at `apps/web/scripts/backfill-clip-embeddings.ts:118-201` without `GET_LOCK` or restore-maintenance coordination.
- `apps/web/src/lib/advisory-locks.ts:19-44` defines restore, upload-processing, per-image processing, and color-pipeline locks, but no semantic embedding backfill lock.

Causal chain: restore serializes backups, uploads, the image queue, and color backfill before dropping/recreating/importing database state. The semantic embedding writers are outside that fence. The documented sidecar backfill is a separate process, so the process-local restore flag is invisible to it; the dormant admin action has only a one-time process-local check and no lock. If a CLIP backfill is running while restore starts, it can select pre-restore `images` rows, derive vectors from current files, and upsert `image_embeddings` while restore is replacing tables and migrations are baselining. Depending on timing, the result is a failed restore/backfill, partial post-restore vectors, or embeddings attached to restored image IDs whose rows no longer represent the same source image.

Competing hypotheses considered: the normal upload queue is guarded by restore maintenance and queue quiescing; that does not cover the sidecar process. `LOCK_DB_RESTORE` correctly serializes restore/backup, but the CLIP backfill never attempts it. The color pipeline proves the intended pattern by holding `LOCK_COLOR_PIPELINE_BACKFILL`; the semantic backfill has no equivalent. Search routes only read active `model_version` rows, which does not prove a row's vector still matches the restored image if an ID was reused or the import raced the upsert.

Concrete failure scenario: an operator runs `apps/web/scripts/backfill-clip-embeddings.ts --production` to seed production vectors, then starts an admin DB restore. Restore obtains its locks because the CLIP script holds none. The script continues embedding rows from the old DB snapshot and writes `image_embeddings` during or after import. After maintenance ends, semantic search scans production rows that may be stale, partially seeded, or inconsistent with the restored gallery.

Suggested fix: add a restore-conflicting advisory lock for semantic embedding work, for example `LOCK_SEMANTIC_EMBEDDING_BACKFILL`. Have restore acquire it non-blocking alongside the color backfill lock and fail with the restore-in-progress message if unavailable. Have both `backfillClipEmbeddings()` and `scripts/backfill-clip-embeddings.ts` acquire it for the whole run, and preferably also check the restore lock or fail fast if `LOCK_DB_RESTORE` is held. Add source-contract tests asserting the restore action and both CLIP backfill entry points participate in the same lock contract. For the admin action, also recheck restore maintenance between batches so an in-process restore that starts after admission can stop cleanly.

### TRC-C21-02 - Residual semantic limiter comment still names disabled mode as refundable

Severity: Low
Confidence: High
Status: Confirmed documentation/contract drift

Files/regions:

- `apps/web/src/app/api/search/semantic/route.ts:173-184` charges the semantic limiter before the DB-backed config lookup.
- `apps/web/src/app/api/search/semantic/route.ts:196-200` returns disabled/not-configured after the charge and without rollback.
- `apps/web/src/app/api/search/similar/[id]/route.ts:98-126` mirrors the charged config posture for similar-photo mode checks.
- `apps/web/src/lib/rate-limit.ts:361-363` correctly says callers refund only branches that return before guarded embedding/vector-scan work is consumed.
- `apps/web/src/lib/rate-limit.ts:375-378` still says rollback is used before guarded resource consumption and gives "disabled mode" as an example, contradicting the current route posture.

Causal chain: the route behavior now treats the config lookup itself as protected shared work. The lower helper comment still preserves an older example where disabled mode was a rollback case. A future maintainer working from the shared helper instead of the route tests can reintroduce disabled-mode refunds and make repeated config probes cheaper than intended.

Competing hypotheses considered: this is not a current runtime limiter bypass. Both semantic routes keep disabled/stub config responses charged. The issue is a misleading shared helper contract in security-sensitive rate-limit code.

Concrete failure scenario: a cleanup changes semantic search to call `rollbackSemanticAttempt(ip)` on disabled-mode responses because `rate-limit.ts` explicitly lists disabled mode as a rollback example. Fresh installs or temporarily disabled deployments then allow repeated public config lookups with lower effective limiter cost.

Suggested fix: update `apps/web/src/lib/rate-limit.ts:375-378` to remove "disabled mode" and describe only truly pre-work rollback cases. If the charged-disabled posture is intentional, add a source-contract assertion that the route comments and helper comments do not list disabled mode as refundable.

## Confirmed Negative Traces

- Upload admission paths maintain browser/LR parity: admin or scoped-token gate, origin/maintenance checks, upload tracker claim, upload-processing contract lock, disk/topic/settings checks, file save, metadata/HDR/GPS handling, restore cleanup check, DB insert, queue snapshot, and lock/tracker settlement.
- Queue/delete tracing did not show a promoted data-loss race: per-image advisory locks fence processing, deleted-mid-processing variants are cleaned, queue state is released in `finally`, and upload-time embedding writes are skipped if in-process restore maintenance begins.
- Semantic text search and similar-photo routes now share charged config posture, request-abort checks, active `model_version` filtering, corrupt-vector filtering, bounded scans, and no-store responses. The promoted semantic issue is limited to backfill/restore coordination plus one stale helper comment.
- OG route tracing did not show an SSRF or cache leak: IDs and extensions are validated, public origins are allowlisted through `getSafeOgImageBaseUrl`, local fallback URLs are path-constrained, fetches have byte/time budgets, and invalid fallback redirects are rejected.
- Analytics and sharing paths are now aligned for the older single-photo share concern: `/s/[key]` resolves the share key and calls `recordPhotoView(image.id)`, while shared groups record group-view counts and flush before restore.
- Auth/session tracing did not show a same-origin bypass: mutating admin actions require same-origin admin context, admin APIs wrap with `withAdminAuth`, token auth is scoped and audited, password/login flows use DB-backed limiters, and proxy enforcement only treats the admin cookie as a coarse prefilter.
- Backup/restore download tracing did not show a traversal issue: backup filenames are basename-filtered, realpath-contained under the backup directory, opened before streaming, and typed as SQL downloads.
- Deploy/runtime tracing remains consistent with the documented single-instance topology: deploy builds and starts before pruning, bind-mounted data/uploads/resources survive image replacement, and the auto volume prune does not use `-a`.

## Missed-Issue Sweep

Final sweep rechecked the competing hypotheses that most often hide latent failures: upload/restore writer races, sidecar writers outside process-local maintenance, queue/delete orphan variants, mutable settings during in-flight uploads, unmetered public mutating routes, auth/session origin bypasses, backup traversal, SQL restore scanner blind spots, OG fetch SSRF, semantic model-version mismatches, CLIP queue capacity/abort behavior, analytics undercount paths, service-worker cache leakage, deployment prune safety, and stale UI responses. No high or critical finding was promoted.

Finding count: 2 findings, 0 high/critical.

# Tracer Review - Cycle 6/100

HEAD reviewed: `5443009e411113bf97fe2d8fcb166b2ac78625fb`

Scope: PROMPT 1 causal tracing of restore/upload/backfill locks, image processing queue, semantic search, topic rename/cover, public route caching/CSP, data privacy, and deploy/runtime interactions. This is a read-only review of current HEAD. No fixes, commits, pushes, or deploys were performed.

## Inventory Built Before Findings

Read first:
- `AGENTS.md`
- `CLAUDE.md`

Review-relevant code/docs/config/tests inventoried from HEAD before findings:
- Deploy/runtime/config: `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/migrate.js`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/public/sw.js`, `apps/web/public/sw.template.js`, `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`
- Migrations/schema: `apps/web/drizzle/0001_sync_current_schema.sql`, `apps/web/drizzle/0005_topics_map_visible.sql`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`
- Restore/upload/backfill/queue: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-cicp-recheck.ts`
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/clip-model-manifest.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-model-id.ts`, `apps/web/src/lib/clip-paths.ts`, `apps/web/src/lib/search-enrichment-fields.ts`
- Topic flows: `apps/web/src/app/actions/topics.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- Public routes/caching/CSP/uploads: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`
- Privacy/data: `apps/web/src/lib/data.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`
- Relevant tests inventoried/searched, with representative files opened where they pinned causal contracts: `apps/web/src/__tests__/restore-maintenance.test.ts`, `restore-upload-lock.test.ts`, `upload-processing-contract-lock.test.ts`, `advisory-locks.test.ts`, `image-queue*.test.ts`, `process-image*.test.ts`, `queue-shutdown.test.ts`, `admin-backfill-runner-*.test.ts`, `backfill-color-pipeline*.test.ts`, `backfill-clip-embeddings-reembed.test.ts`, `semantic-*.test.ts`, `similar-route.test.ts`, `clip-*.test.ts`, `topics-actions.test.ts`, `topic-slug-fk-registry.test.ts`, `privacy-fields.test.ts`, `content-security-policy.test.ts`, `serve-upload*.test.ts`, `check-public-route-rate-limit.test.ts`, `deploy-script-contract.test.ts`, `nginx-config.test.ts`, `next-config*.test.ts`, `instrumentation-sigterm.test.ts`, `sql-restore-scan.test.ts`

## Causal Trace Summary

Restore/upload/backfill locks:
- Competing hypothesis A: restore can race upload or queue work because restore maintenance is process-local. Evidence in `apps/web/src/app/[locale]/admin/db-actions.ts:291-324` shows restore takes `LOCK_DB_RESTORE`, the upload-processing contract lock, and `LOCK_COLOR_PIPELINE_BACKFILL` before `beginRestoreMaintenance()`. Upload flows in `apps/web/src/app/actions/images.ts` and `apps/web/src/app/api/admin/lr/upload/route.ts` reject maintenance and hold the same upload-processing contract lock while saving originals, inserting DB rows, and enqueueing processing. `apps/web/src/lib/image-queue.ts:847-899` clears queued jobs, drains in-flight work, resets state, and reboots after restore. No new confirmed source issue found in the single-container topology.
- Competing hypothesis B: in-app and sidecar color backfills race each other or queue work. Evidence in `apps/web/src/lib/admin-backfill-runner.ts:304-327` and `apps/web/scripts/backfill-color-pipeline.ts:299-323` shows both serialize on the global color-pipeline lock; the in-app runner additionally takes per-image processing locks around re-encode/update (`apps/web/src/lib/admin-backfill-runner.ts:473-614`). The sidecar explicitly documents its narrower per-image gap; that remains an operational risk, not a new source finding.

Image processing queue:
- Competing hypothesis A: duplicate processing can commit stale files. Evidence in `apps/web/src/lib/image-queue.ts:238-265` uses per-image `GET_LOCK`; `apps/web/src/lib/image-queue.ts:445-467` only marks `processed=true` if the row is still pending and deletes newly written variants on delete-mid-processing. No new confirmed issue.
- Competing hypothesis B: restore quiesce can deadlock. Evidence in `apps/web/src/lib/image-queue.ts:847-873` uses pause, clear, then `onIdle()`, matching the documented p-queue semantics and avoiding the known queued-job deadlock.

Semantic search:
- Competing hypothesis A: public semantic/similar routes leak private image metadata. Evidence in `apps/web/src/lib/search-enrichment-fields.ts:29-46` centralizes the select and compile-guards against `PrivacySensitiveKeys`; route enrichment in `apps/web/src/app/api/search/semantic/route.ts:294-300` and `apps/web/src/app/api/search/similar/[id]/route.ts:198-205` also requires `images.processed=true`. No privacy finding there.
- Competing hypothesis B: semantic backfill can fail to make forward progress under an allowed runtime cap. Confirmed issue TRC-C6-01 below.

Topic rename/cover:
- Competing hypothesis A: slug/alias route collisions escape serialization. Evidence in `apps/web/src/app/actions/topics.ts:62-83` serializes create/update/alias mutations via `LOCK_TOPIC_ROUTE_SEGMENTS`, and update remaps image/topic-view/alias/smart-collection references inside the rename transaction (`apps/web/src/app/actions/topics.ts:255-337`). No route-collision finding.
- Competing hypothesis B: cover-image cleanup uses stale state across concurrent admin saves. Confirmed issue TRC-C6-02 below.

Public route caching/CSP:
- Public pages under `apps/web/src/app/[locale]/(public)/**` use `revalidate = 0`; semantic/search/admin APIs set `no-store`; uploaded derivative handlers set ETag plus `public, max-age=3600, must-revalidate` in `apps/web/src/lib/serve-upload.ts:219-252`. Nginx mirrors derivative caching at `apps/web/nginx/default.conf:172-183`. Production CSP is request/response nonce-based in `apps/web/src/proxy.ts:36-49` and source-built in `apps/web/src/lib/content-security-policy.ts`. No confirmed caching/CSP issue found.

Data privacy:
- Public select shapes omit sensitive columns in `apps/web/src/lib/data.ts:364-483`; map GPS exposure is isolated behind `topics.map_visible=true` with a runtime assertion in `apps/web/src/lib/data.ts:1647-1693`. No confirmed privacy leak found.

Deploy/runtime:
- Current deploy source is one `gallerykit-web` container (`apps/web/docker-compose.yml:3-27`) with bind-mounted persistent data and rootless runtime after `apps/web/scripts/entrypoint.sh:41-42`. Startup runs migrations before `exec node` (`apps/web/Dockerfile:138-145`) and shutdown drains the queue/view-count buffer with a bounded timeout (`apps/web/src/instrumentation.ts:18-65`). No new source issue found; see manual-validation risks.

## Confirmed Issues

### TRC-C6-01 - CLIP sidecar backfill can no-op forever when `SEMANTIC_SCAN_LIMIT < 50`

Severity: Medium
Confidence: High
Status: Confirmed, configuration-dependent

Code region:
- `apps/web/src/lib/clip-embeddings.ts:37-44`
- `apps/web/scripts/backfill-clip-embeddings.ts:72-79`
- `apps/web/scripts/backfill-clip-embeddings.ts:120-147`
- `apps/web/scripts/backfill-clip-embeddings.ts:195-196`

Why it is a problem:
`SEMANTIC_SCAN_LIMIT` is an env-tunable positive integer with no lower bound above 1 (`apps/web/src/lib/clip-embeddings.ts:37-44`). The operator backfill script hardcodes `BATCH_SIZE = 50` (`apps/web/scripts/backfill-clip-embeddings.ts:72`) and always selects up to 50 rows before checking the cap (`apps/web/scripts/backfill-clip-embeddings.ts:120-147`). If an operator sets `SEMANTIC_SCAN_LIMIT=1..49`, the first non-empty query returns 50 rows, `processed + failed + rows.length > SEMANTIC_SCAN_LIMIT` is true, and the script breaks before processing any image. It then prints `Done ... processed=0 failed=0` and exits success (`apps/web/scripts/backfill-clip-embeddings.ts:195-196`).

Concrete failure scenario:
An operator lowers `SEMANTIC_SCAN_LIMIT` to reduce semantic route CPU/DB cost, then follows the documented production backfill command. With at least 50 processed images lacking production embeddings, the script exits 0 without writing any `image_embeddings` rows. Re-running repeats the same first batch and no-ops again. If the admin flips `semantic_search_mode` to production afterward, `/api/search/semantic` returns “not fully configured” when zero production rows exist (`apps/web/src/app/api/search/semantic/route.ts:253-258`), or searches silently cover only whatever rows happened to be backfilled outside this path.

Suggested fix:
Do not reuse the public query scan cap as the write-backfill batch cap. Introduce a dedicated backfill limit, or process a partial batch up to the remaining allowed count. At minimum, make `const effectiveBatchSize = Math.min(BATCH_SIZE, SEMANTIC_SCAN_LIMIT - processed - failed)`, query that limit, and exit non-zero if the cap prevents any forward progress while rows remain.

### TRC-C6-02 - Concurrent topic cover updates can orphan a newly generated cover image

Severity: Medium
Confidence: High
Status: Confirmed

Code region:
- `apps/web/src/app/actions/topics.ts:232-247`
- `apps/web/src/app/actions/topics.ts:249-358`
- `apps/web/src/app/actions/topics.ts:360-362`
- `apps/web/src/app/actions/topics.ts:370-372`

Why it is a problem:
`updateTopic` reads the current cover filename before acquiring the topic route lock (`apps/web/src/app/actions/topics.ts:232-236`), then processes the uploaded replacement before the lock (`apps/web/src/app/actions/topics.ts:238-247`). The locked section serializes route mutation and writes the new `image_filename` (`apps/web/src/app/actions/topics.ts:249-358`), but successful cleanup deletes only the pre-lock `previousImageFilename` (`apps/web/src/app/actions/topics.ts:360-362`). The failure path deletes the new file only when the action throws (`apps/web/src/app/actions/topics.ts:370-372`), so a successful but overwritten cover is not cleaned.

Concrete failure scenario:
Two admin requests update the same topic cover concurrently. Both read old cover `P` before either holds the lock. Request A processes `A.webp`, enters the lock, and updates the topic to `A.webp`; then request B enters the lock and updates the same topic to `B.webp`. Both requests then try to delete only pre-lock `P`. Final DB state points to `B.webp`; `A.webp` remains in `public/resources` with no topic row referencing it. Repeated concurrent saves leak resource files permanently.

Suggested fix:
Keep the expensive image processing outside the lock if desired, but capture the authoritative prior cover filename inside the locked transaction immediately before changing the row. Store that locked previous value for post-commit cleanup, and delete it if it differs from the new filename. In the same-slug branch, select `image_filename` under the lock, not only `slug`; in the rename branch, use `transactionTopic.image_filename` as the cleanup source.

## Likely Issues

None beyond the confirmed findings above. I did not promote operationally documented constraints, such as single-instance process-local queue state, to source issues because the checked deployment source currently matches those assumptions.

## Risks Needing Manual Validation

- Semantic production readiness: source can prove model-version gating, privacy shape, no-store headers, and the backfill code path, but not that the deploy host has the expected `CLIP_MODELS_ROOT=/app/data/models/clip` weights seeded before `semantic_search_mode=production`. Validate the model volume and a non-zero production `image_embeddings` count during rollout.
- Runtime topology: restore maintenance flags, upload quota reservations, and queue state are process-local. `apps/web/docker-compose.yml:3-27` currently defines one web container, so this is not a current source bug. Any future horizontal scaling needs a separate distributed maintenance/queue/quota design.
- Sidecar color backfill overlap: `apps/web/scripts/backfill-color-pipeline.ts:36-43` documents that the sidecar does not take per-image processing locks. The in-app runner covers that path with per-image locks; sidecar usage should remain an operator-only maintenance action, not concurrent with manual retry/delete workflows unless separately validated.

## Final Missed-Issues Sweep

Final searches covered advisory lock names/acquire-release sites, restore/upload maintenance guards, semantic scan-limit use, public cache/CSP headers, privacy-sensitive select shapes, topic route mutation locks, queue cleanup races, deploy/prune/runtime shutdown, and TODO/FIXME/known-gap/race comments in the specified flow files.

Relevant files intentionally not inspected line-by-line:
- UI presentation components outside the specified causal flows, except topic manager as the admin entry point.
- Unrelated admin/auth/audit/user-management flows, except where shared rate-limit or API-auth behavior intersected public caching/privacy.
- Generated/build artifacts, `node_modules`, and non-HEAD worktree edits.
- Every one of the 2000+ test cases in full; relevant test families were inventoried/searched and representative causal-lock tests were opened.

Validation not run: no tests or build were executed because this was a read-only review and no code was changed.

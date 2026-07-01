# Cycle 91 Tracer Review

Scope: bounded causal-flow trace of deployed `master` at `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

No dedicated registered `tracer` agent was available in this bounded run. This is best-effort causal tracing from the architect/documentation lane.

## Inventory First

- Restore flow: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Foreground mutation flows: `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/admin-backfill.ts`.
- Semantic flow: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Related tests: `apps/web/src/__tests__/restore-maintenance.test.ts`, `apps/web/src/__tests__/restore-upload-lock.test.ts`, `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts`, semantic/similar route tests, source-contract tests for restore/public behavior.

## Confirmed Findings

### C91-TRC-01 - Causal trace: non-upload admin writer can cross the restore-maintenance boundary after its entry check

Severity: High
Confidence: High

Trace:
1. Restore starts by acquiring `LOCK_DB_RESTORE` (`apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:392`, `apps/web/src/app/[locale]/admin/db-actions.ts:398`).
2. Restore then acquires the upload-processing contract because an upload can otherwise pass maintenance checks and later insert/enqueue (`apps/web/src/app/[locale]/admin/db-actions.ts:400`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`).
3. Restore also acquires color and semantic backfill locks (`apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:427`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:447`) before entering durable maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:452`).
4. The maintenance flag itself is process-local unless synced from the durable marker (`apps/web/src/lib/restore-maintenance.ts:21`, `apps/web/src/lib/restore-maintenance.ts:25`; `apps/web/src/lib/restore-maintenance-durable.ts:88`, `apps/web/src/lib/restore-maintenance-durable.ts:90`).
5. `updateTopic` checks maintenance once at entry (`apps/web/src/app/actions/topics.ts:182`, `apps/web/src/app/actions/topics.ts:184`) and then can await topic-image processing before acquiring its route lock and transaction (`apps/web/src/app/actions/topics.ts:240`, `apps/web/src/app/actions/topics.ts:242`, `apps/web/src/app/actions/topics.ts:249`, `apps/web/src/app/actions/topics.ts:256`).
6. The later transaction mutates `topics`, `images`, `topicAliases`, `topicViews`, `smartCollections`, and deletes the old topic row (`apps/web/src/app/actions/topics.ts:285`, `apps/web/src/app/actions/topics.ts:292`, `apps/web/src/app/actions/topics.ts:293`, `apps/web/src/app/actions/topics.ts:301`, `apps/web/src/app/actions/topics.ts:332`, `apps/web/src/app/actions/topics.ts:338`).
7. There is no shared foreground-admin mutation barrier acquired by `updateTopic`, and the restore locks do not cover `LOCK_TOPIC_ROUTE_SEGMENTS`.

Failure scenario:
- A slow `updateTopic` request starts first and passes the entry guard. Restore starts before `updateTopic` reaches its transaction. The topic transaction then writes application tables while restore is flushing/quiescing or importing, so either the restore overwrites the topic mutation or the topic mutation lands against a partially restored state.

Concrete fix:
- Wrap non-upload admin writers in a shared write barrier that conflicts with restore, with a late check immediately before transaction/write boundaries. The barrier should be centrally enforced so future actions cannot satisfy only origin/auth lint while missing restore coordination.

### C91-TRC-02 - Causal trace: semantic model switch replaces prior embeddings, then routes filter them away

Severity: Medium
Confidence: High

Trace:
1. The table stores one row per image because `image_id` is the primary key (`apps/web/src/db/schema.ts:284`, `apps/web/src/db/schema.ts:285`; `apps/web/drizzle/0012_image_embeddings.sql:10`).
2. Queue writes choose a target `modelVersion` from the current semantic mode (`apps/web/src/lib/image-queue.ts:352`, `apps/web/src/lib/image-queue.ts:364`, `apps/web/src/lib/image-queue.ts:366`, `apps/web/src/lib/image-queue.ts:368`, `apps/web/src/lib/image-queue.ts:369`) and then upsert that version into the single row (`apps/web/src/lib/image-queue.ts:379`, `apps/web/src/lib/image-queue.ts:385`).
3. The sidecar backfill selects images without a row at the target version (`apps/web/scripts/backfill-clip-embeddings.ts:167`, `apps/web/scripts/backfill-clip-embeddings.ts:174`, `apps/web/scripts/backfill-clip-embeddings.ts:179`) but then upserts into the single primary-key row (`apps/web/scripts/backfill-clip-embeddings.ts:212`, `apps/web/scripts/backfill-clip-embeddings.ts:218`).
4. Text search filters rows by the active model version before scoring (`apps/web/src/app/api/search/semantic/route.ts:202`, `apps/web/src/app/api/search/semantic/route.ts:203`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/semantic/route.ts:275`).
5. Similar-photo search is production-only and also requires `PRODUCTION_MODEL_VERSION` for the target and scan (`apps/web/src/app/api/search/similar/[id]/route.ts:121`, `apps/web/src/app/api/search/similar/[id]/route.ts:135`, `apps/web/src/app/api/search/similar/[id]/route.ts:141`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`, `apps/web/src/app/api/search/similar/[id]/route.ts:173`).

Failure scenario:
- Running production backfill after stub mode overwrites stub rows. If production mode is disabled for rollback or debug, text search in stub mode filters for stub rows and finds none until the operator re-runs stub backfill. A future production model bump has the same destructive switching behavior.

Concrete fix:
- Store embeddings as `(image_id, model_version, embedding, updated_at)` rows, not one row per image. Keep route filters as-is, but make writers insert/update only the active model row.

## Likely / Manual-Validation Risks

### C91-TRC-RISK-01 - Causal trace for runtime `site-config.json` remains ambiguous without compiled-bundle validation

Severity: Medium
Confidence: Medium

Trace:
1. Build validates and bundles from `src/site-config.json` before Next build (`apps/web/Dockerfile:96`, `apps/web/Dockerfile:97`; `apps/web/scripts/ensure-site-config.mjs:4`, `apps/web/scripts/ensure-site-config.mjs:11`).
2. Runtime Compose mounts a host JSON over the same path (`apps/web/docker-compose.yml:24`, `apps/web/docker-compose.yml:28`).
3. Consumers use static JSON imports, including client nav (`apps/web/src/components/nav-client.tsx:14`, `apps/web/src/components/nav-client.tsx:72`), root layout analytics (`apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/app/[locale]/layout.tsx:147`), and sitemap URL fallback (`apps/web/src/app/sitemap.ts:14`, `apps/web/src/app/sitemap.ts:18`).

Manual validation needed:
- Inspect the generated standalone server/client chunks or run a local Docker smoke where the mounted JSON is changed after build but before container restart. Verify whether every documented `site-config` field follows the mounted file or the built bundle.

Concrete fix:
- Same as architect risk: either declare rebuild-only behavior and remove the misleading runtime mount, or implement a validated runtime loader with explicit server-to-client propagation.

## Missed-Issue Sweep

- Reviewed exported action inventory for mutation paths that write after one-time restore checks.
- Reviewed route/API inventory for restore maintenance and semantic mode gates.
- Reviewed sidecar scripts for durable restore marker checks.
- Reviewed schema/migration/backfill/search causal chain for `model_version`.
- Reviewed docs/source for `site-config` runtime/build-time flow.

No additional confirmed tracer findings were found beyond the two traces above.

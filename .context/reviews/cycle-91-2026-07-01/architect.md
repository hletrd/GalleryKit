# Cycle 91 Architect Review

Scope: bounded review of deployed `master` at `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

Dedicated document-specialist/tracer registered agents were not available in this bounded subagent run; I covered those angles best-effort in the sibling artifacts and kept this file focused on architecture/design risk.

## Inventory First

- Project docs and active review/plan state: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-90-2026-07-01-plan.md`, `.context/plans/cycle-90-2026-07-01-deferred.md`.
- Restore and mutation barrier surfaces: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/*.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/image-queue.ts`, restore/backfill tests.
- Semantic-search architecture: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Runtime/static configuration contract: `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/constants.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/components/nav-client.tsx`, docs mentioning `site-config.json`.

## Confirmed Findings

### C91-ARCH-01 - Restore maintenance still does not fence in-flight non-upload admin mutations

Severity: High
Confidence: High

Evidence:
- Restore acquires the upload-processing contract lock because uploads can otherwise pass maintenance checks and then insert/enqueue during a DB import (`apps/web/src/app/[locale]/admin/db-actions.ts:400`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`). It also fences color and semantic backfills (`apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`) before entering durable maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:452`) and preparing the restore window (`apps/web/src/app/[locale]/admin/db-actions.ts:493`).
- Non-upload foreground admin writers use a one-time process-local maintenance precheck only. Example: `updateTopic` checks `getRestoreMaintenanceMessage()` at entry (`apps/web/src/app/actions/topics.ts:182`, `apps/web/src/app/actions/topics.ts:184`) and then does async work before its DB transaction (`apps/web/src/app/actions/topics.ts:240`, `apps/web/src/app/actions/topics.ts:249`, `apps/web/src/app/actions/topics.ts:256`, `apps/web/src/app/actions/topics.ts:285`, `apps/web/src/app/actions/topics.ts:338`).
- `updateGallerySettings` has the same shape: one-time precheck (`apps/web/src/app/actions/settings.ts:41`, `apps/web/src/app/actions/settings.ts:43`) followed by multiple awaited reads and a later transaction that writes `admin_settings` (`apps/web/src/app/actions/settings.ts:93`, `apps/web/src/app/actions/settings.ts:163`, `apps/web/src/app/actions/settings.ts:168`, `apps/web/src/app/actions/settings.ts:170`).
- The active deferred ledger already records this exact unresolved architecture gap (`.context/plans/cycle-90-2026-07-01-deferred.md:18`), and HEAD still matches the failure shape.

Failure scenario:
1. Admin A starts `updateTopic`; it passes the maintenance check at function entry.
2. Admin B starts DB restore. Restore acquires the DB, upload, color-backfill, and semantic-backfill locks, then calls `beginDurableRestoreMaintenance`.
3. Admin A finishes topic-image processing and enters the topic rename transaction while restore is flushing/quiescing or importing. There is no shared foreground-admin write barrier to block this late write.
4. Restore can import an older dump over the concurrent write, or the foreground action can write into a database/filesystem state being restored. The action may then revalidate/audit as if its change survived.

Concrete fix:
- Introduce a shared foreground admin mutation barrier, not just per-action entry checks. A low-blast-radius shape is `withRestoreWriteBarrier(actionName, async () => ...)` that acquires a dedicated advisory lock or participates in the existing restore lock protocol, rechecks durable/process maintenance immediately before DB writes, and is used by all application-table writers (`topics`, `tags`, `images`, `settings`, `sharing`, `collections`, `admin-users`, `lr-tokens`, `seo`, and in-app backfill trigger).
- Keep upload-specific processing settings on `LOCK_UPLOAD_PROCESSING_CONTRACT`, but do not make that lock the general app writer lock unless the name and tests are broadened.
- Add source/behavior tests that prove representative non-upload actions cannot write after restore enters maintenance between their entry precheck and transaction.

### C91-ARCH-02 - `image_embeddings` cannot retain multiple model versions per image

Severity: Medium
Confidence: High

Evidence:
- The schema still defines `image_embeddings.image_id` as the table primary key and stores `model_version` as a non-key column (`apps/web/src/db/schema.ts:284`, `apps/web/src/db/schema.ts:285`, `apps/web/src/db/schema.ts:290`).
- The migration matches that physical design: `PRIMARY KEY (image_id)` with `model_version` separate (`apps/web/drizzle/0012_image_embeddings.sql:5`, `apps/web/drizzle/0012_image_embeddings.sql:8`, `apps/web/drizzle/0012_image_embeddings.sql:10`).
- Search routes filter by active model version (`apps/web/src/app/api/search/semantic/route.ts:202`, `apps/web/src/app/api/search/semantic/route.ts:203`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/semantic/route.ts:275`; `apps/web/src/app/api/search/similar/[id]/route.ts:135`, `apps/web/src/app/api/search/similar/[id]/route.ts:141`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`, `apps/web/src/app/api/search/similar/[id]/route.ts:173`).
- Both queue and sidecar writers upsert into the single row, replacing any other version for that image (`apps/web/src/lib/image-queue.ts:379`, `apps/web/src/lib/image-queue.ts:385`; `apps/web/scripts/backfill-clip-embeddings.ts:212`, `apps/web/scripts/backfill-clip-embeddings.ts:218`). The sidecar documentation states the upsert replaces stale vector/version in place (`apps/web/scripts/backfill-clip-embeddings.ts:27`, `apps/web/scripts/backfill-clip-embeddings.ts:29`, `apps/web/scripts/backfill-clip-embeddings.ts:37`, `apps/web/scripts/backfill-clip-embeddings.ts:40`).
- The active deferred ledger records the intended exit criterion as one row per `(image_id, model_version)` (`.context/plans/cycle-90-2026-07-01-deferred.md:16`).

Failure scenario:
- An operator enables stub mode for testing, then production backfills. Production upserts replace stub rows. Rolling back to stub for diagnosis returns no stub results until a stub backfill rewrites the same rows back. A future model-version bump has the same property: old and new embeddings cannot coexist, so canary, rollback, and mixed-version validation require destructive re-embedding.

Concrete fix:
- Add a migration changing the table to a composite key or unique key on `(image_id, model_version)`, keeping the current `(model_version, updated_at)` serving index.
- Update Drizzle schema, `reconcileLegacySchema`, queue writer, sidecar backfill, admin backfill action, and search queries to read/write the target model row without replacing other versions.
- Add a regression test that inserts two versions for one image and proves each route/backfill selects only the active version while preserving the inactive one.

## Likely / Manual-Validation Risks

### C91-ARCH-RISK-01 - Runtime `site-config.json` bind mount may be partially inert because consumers use static JSON imports

Severity: Medium
Confidence: Medium

Evidence:
- Compose bind-mounts host `./src/site-config.json` into the running container (`apps/web/docker-compose.yml:24`, `apps/web/docker-compose.yml:28`), and README describes a host-side `src/site-config.json` bind mount (`apps/web/README.md:55`).
- The build validates `src/site-config.json` before `next build` (`apps/web/Dockerfile:96`, `apps/web/Dockerfile:97`; `apps/web/scripts/ensure-site-config.mjs:4`, `apps/web/scripts/ensure-site-config.mjs:11`, `apps/web/scripts/ensure-site-config.mjs:23`).
- Runtime consumers import JSON statically, including a client component (`apps/web/src/components/nav-client.tsx:14`, `apps/web/src/components/nav-client.tsx:72`), root layout analytics (`apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/app/[locale]/layout.tsx:147`), and sitemap constants (`apps/web/src/app/sitemap.ts:14`, `apps/web/src/app/sitemap.ts:18`).
- CLAUDE partly says `site-config.json` is for fallback/static build-time values (`CLAUDE.md:663`, `CLAUDE.md:673`), while the deploy persistence section lists it with runtime bind mounts (`CLAUDE.md:477`).

Risk scenario:
- An operator edits the mounted host JSON and restarts the existing container expecting nav home links or GA to change. Static import consumers may continue using values bundled at build time, while any server chunk that still resolves the JSON at runtime may behave differently. That produces split-brain config semantics.

Concrete fix:
- Decide the contract. Either remove/document the runtime bind mount as rebuild-only, or implement a validated runtime loader and pass client-safe values through server props/metadata so all consumers use the same source.
- Add a test/smoke that changes a mounted `site-config.json` without rebuild and asserts the documented behavior.

## Missed-Issue Sweep

- Searched exported server actions/admin API routes for origin wrappers, maintenance guards, direct DB writes, and exemptions.
- Searched restore-maintenance references across app routes, server actions, sidecar scripts, queue, background writes, and tests.
- Searched docs/tests for active deferred architecture items, TODO/FIXME/BUG/risk markers, `site-config`, `model_version`, and restore-maintenance claims.
- Reviewed migration/schema alignment for `image_embeddings` and deployment/runtime docs for `site-config.json`.

No additional confirmed architect-level findings were found beyond the two confirmed issues above.

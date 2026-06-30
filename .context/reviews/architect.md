# Cycle 29 Architect Review

Date: 2026-06-30
Reviewer role: architect subagent
Repository head reviewed: `b4fa1f64`
Scope: comprehensive architecture/design risk review only. No product code was modified.

## Process and Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the architecture-relevant source, config, migrations, scripts, deploy topology, tests, and current cycle review history. The review focused on boundaries, coupling, data model invariants, operational topology, deployment/contracts, migration strategy, privacy surfaces, and cross-module drift.

Key surfaces covered:
- Governance/docs: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, previous `.context/reviews/architect.md`, cycle review artifacts.
- Data model and migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, migration/reconcile tests.
- Public/admin data access and privacy: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public pages, public actions, semantic/similar search routes, map/timeline/search privacy tests.
- Restore/backup/maintenance topology: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts` view-count buffer, restore and quiesce tests.
- Upload/storage/processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/**`, Docker entrypoint storage setup.
- Operational/deploy surface: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/deploy.sh`, `apps/web/next.config.ts`, root and app package manifests.

## Findings

### C29-ARCH-01: Rate-limit retention purges by an unindexed time column on the single MySQL writer

Severity: Medium  
Confidence: High  
Classification: Confirmed issue

Evidence:
- `apps/web/src/db/schema.ts:212-219` defines `rate_limit_buckets` with only the composite primary key `(ip, bucket_type, bucket_start)`.
- `apps/web/drizzle/0001_sync_current_schema.sql:22-27` and `apps/web/scripts/migrate.js:525-530` mirror that schema without any leading `bucket_start` index.
- `apps/web/src/lib/rate-limit.ts:515-517` deletes expired rows with `WHERE bucket_start < cutoff`.
- `apps/web/src/lib/image-queue.ts:1019-1024` runs that purge at startup, and `apps/web/src/lib/image-queue.ts:1039-1047` repeats it hourly in the web process.

Failure scenario:
A period of bot traffic, failed auth attempts, public search/load-more usage, view-record attempts, or OG/share-key probes creates many distinct `(ip, bucket_type, bucket_start)` rows. The hourly purge cannot use the current primary key efficiently for a predicate on `bucket_start` alone, so MySQL scans the rate-limit table on the same writer that handles uploads, public reads, admin actions, and restore preparation. Under enough accumulated buckets, the purge can become a recurring writer-side stall and can also make rate-limit checks fail open or fall back to in-memory behavior in surrounding callers.

Suggested fix:
Add a migration and reconcile mirror for a leading retention index, for example `INDEX rate_limit_buckets_bucket_start_idx (bucket_start)` or `(bucket_start, bucket_type)`. Consider chunking `purgeOldBuckets()` deletes with a bounded `LIMIT`, matching the audit purge pattern in `apps/web/src/lib/audit.ts:125-134`, so one hourly sweep cannot monopolize the writer.

### C29-ARCH-02: Public page components honor restore maintenance, but metadata paths still hit DB during restore

Severity: Low  
Confidence: Medium  
Classification: Likely issue

Evidence:
- Public page bodies short-circuit on restore maintenance, for example `apps/web/src/app/[locale]/(public)/page.tsx:151-156`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:126-137`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:131-145`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:80-85`.
- The same route files run DB-backed `generateMetadata` before those body guards: home metadata calls `getSeoSettings()`, `getTagsCached()`, and `getLatestImageForOgCached()` at `apps/web/src/app/[locale]/(public)/page.tsx:20-32` and `apps/web/src/app/[locale]/(public)/page.tsx:91-95`; photo metadata calls `getSeoSettings()` and `getImageCached()` at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:43-56`; topic metadata calls `getTopicBySlugCached()`, `getTagsCached()`, and `getSeoSettings()` at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:35-58`; smart-collection metadata calls `getSmartCollectionBySlugCached()` and `getSeoSettings()` at `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:18-29`.
- Restore begins durable maintenance before import and drains known mutable writers at `apps/web/src/app/[locale]/admin/db-actions.ts:492-503`, so the intended contract is that DB-backed public work should stop or degrade during the restore window.

Failure scenario:
An admin starts a DB restore. Public route bodies render the maintenance component, but Next can still execute `generateMetadata` for the request and issue DB reads while `mysql` import is dropping/recreating/restoring tables. Users or crawlers can receive 500s, incorrect `notFound` metadata, stale OG tags, or noisy DB errors instead of the maintenance response. This does not look like data corruption, but it violates the operational topology implied by the body-level maintenance guards.

Suggested fix:
Introduce a tiny shared metadata guard for DB-backed public metadata. If restore maintenance is active, return static `noindex` maintenance metadata without calling data accessors. Apply it to every public `generateMetadata` that reads `@/lib/data`, and add a source or unit test that pairs public page maintenance guards with metadata guards for DB-backed routes.

### C29-ARCH-03: Semantic and similar search still use request-thread brute-force scans with a high operator cap

Severity: Medium  
Confidence: Medium  
Classification: Risk needing capacity validation

Evidence:
- `apps/web/src/lib/clip-embeddings.ts:36-44` permits `SEMANTIC_SCAN_LIMIT` up to `25_000` rows by environment configuration, defaulting to `2_000`.
- `apps/web/src/app/api/search/semantic/route.ts:247-279` embeds the query, selects up to `SEMANTIC_SCAN_LIMIT` embeddings ordered by recency, and `apps/web/src/app/api/search/semantic/route.ts:292-311` decodes and scores every scanned vector synchronously in the request.
- `apps/web/src/app/api/search/similar/[id]/route.ts:132-177` loads the target vector and the same scan set, then `apps/web/src/app/api/search/similar/[id]/route.ts:186-201` scores every vector on the request path.
- The route enrichment select is privacy-hardened through `searchEnrichmentSelectFields` at `apps/web/src/lib/search-enrichment-fields.ts:29-46`, so this finding is about operational topology, not PII leakage.

Failure scenario:
On a larger gallery or after an operator raises `SEMANTIC_SCAN_LIMIT`, each semantic request pulls thousands of BLOB vectors through MySQL and performs vector scoring inside the Next.js request worker. A small number of concurrent same-origin browser requests can compete with photo rendering, admin actions, uploads, and restore-adjacent DB work. The current cap is bounded, but the architecture is still linear in the scan limit and latest-row biased; relevance quality and latency both depend on an operator-tuned brute-force window.

Suggested fix:
Keep the current implementation behind the existing production/stub gates, but add explicit capacity validation before increasing the cap: record p95 latency, MySQL bytes read, and CPU at representative row counts. For a durable fix, move similarity search behind a dedicated vector index/service or a precomputed/materialized candidate layer, and enforce a documented production cap that matches the deployed host budget. If this remains in-process, consider a DB-backed limiter for semantic endpoints to survive process restarts and align with other expensive public surfaces.

### C29-ARCH-04: Proxy/header trust depends on deployment invariants that need live validation

Severity: Medium if misconfigured, otherwise informational  
Confidence: Medium  
Classification: Risk needing manual validation

Evidence:
- `apps/web/docker-compose.yml:15-22` runs the container with host networking and sets `TRUST_PROXY=true`.
- `apps/web/nginx/default.conf:25-30` documents that port 80 is intended as an internal HTTP hop behind a TLS-terminating edge, and `apps/web/nginx/default.conf:64-70` forwards `Host`, `X-Forwarded-Host`, `X-Real-IP`, and `X-Forwarded-For`.
- `apps/web/src/lib/request-origin.ts:45-68` trusts forwarded protocol/host only when `TRUST_PROXY=true`, and `apps/web/src/lib/request-origin.ts:79-107` uses that expected origin for same-origin checks.
- `apps/web/src/lib/rate-limit.ts:164-194` also switches client-IP derivation based on `TRUST_PROXY=true`, with trusted-hop behavior controlled separately by `TRUSTED_PROXY_HOPS`.

Failure scenario:
If the Next process or nginx HTTP listener is reachable directly from an untrusted network, or if the real edge appends a different number/order of forwarded headers than the code assumes, origin checks and rate-limit identity can be based on attacker-controlled or wrong header positions. This could cause false same-origin acceptance, rate-limit bucket collapse, or widespread false rate limiting. The source is internally consistent; the remaining risk is whether production networking matches the documented topology.

Suggested fix:
Validate production with explicit ops checks: external clients cannot reach the Next listener directly; nginx port 80 is internal or redirected by a TLS edge; the observed `X-Forwarded-*` chain matches `TRUSTED_PROXY_HOPS`; and same-origin checks fail when spoofed headers are sent directly. Record the verified topology in `CLAUDE.md` or the deploy runbook so future infra changes do not silently invalidate this trust boundary.

## Confirmed Non-Findings From This Pass

- The cycle-28 restore analytics concern appears addressed: public analytics writes now use `trackBackgroundDbWrite()` at `apps/web/src/app/actions/public.ts:430-438`, `apps/web/src/app/actions/public.ts:462-470`, and `apps/web/src/app/actions/public.ts:498-506`; the tracker lives in `apps/web/src/lib/background-db-writes.ts:5-31`; restore drains it at `apps/web/src/app/[locale]/admin/db-actions.ts:492-503`.
- The private-original upload directory mode concern appears addressed: `ensurePrivateOriginalUploadDirectory()` creates and chmods the directory at `apps/web/src/lib/upload-paths.ts:49-56`; the image pipeline calls it at `apps/web/src/lib/process-image.ts:443-450`; the container entrypoint also applies `chmod 700` at `apps/web/scripts/entrypoint.sh:16-24`; original files are written with mode `0600` at `apps/web/src/lib/process-image.ts:905-910`.
- Public privacy field selection is strongly guarded: `publicSelectFields`, `publicMapSelectFields`, `PrivacySensitiveKeys`, and compile-time guards are in `apps/web/src/lib/data.ts:368-488`; semantic result enrichment uses the shared guarded shape in `apps/web/src/lib/search-enrichment-fields.ts:29-46`; tests mirror the privacy contract in `apps/web/src/__tests__/privacy-fields.test.ts` and map/search privacy tests.
- Migration/reconcile strategy is deliberate: fresh and legacy DB convergence route through `reconcileLegacySchema()` and journal baselining at `apps/web/scripts/migrate.js:741-795`, with the post-condition hash assertion at `apps/web/scripts/migrate.js:797-818`. I did not find a new migration drift issue in this pass.

## Missed-Issues Sweep

I re-swept for direct public DB imports, restore-maintenance guard coverage, advisory-lock usage, rate-limit schema/index drift, privacy-sensitive field names, semantic search enrichment, and migration/reconcile contracts with `rg`. Generated build output, dependency folders, binary/media assets, and unrelated dirty review artifacts were excluded from conclusions. No additional architecture-level findings above the threshold were confirmed.

## Covered-File Summary

Detailed review included the documented source/config/migration surfaces above, with especially close reads of:
- `apps/web/src/db/schema.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/storage/**`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/proxy.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/scripts/entrypoint.sh`
- architecture/privacy/restore/migration/rate-limit tests under `apps/web/src/__tests__/**`

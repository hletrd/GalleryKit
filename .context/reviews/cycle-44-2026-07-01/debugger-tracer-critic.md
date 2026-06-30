# Cycle 44 Debugger / Tracer / Critic Review

Date: 2026-07-01 02:46 KST
Reviewer: debugger-tracer-critic
Base HEAD: f417d86b
Scope: restore maintenance, upload quotas, delete/update races, smart collections, share routes, analytics/view retention, public search/similar/semantic flows, OG fallback, worker/service-worker update paths.

## Inventory

- Restore maintenance:
  - Process flag and upload cleanup guard: `apps/web/src/lib/restore-maintenance.ts:21`, `apps/web/src/lib/restore-maintenance.ts:33`, `apps/web/src/lib/restore-maintenance.ts:48`
  - Durable marker sync/clear: `apps/web/src/lib/restore-maintenance-durable.ts:36`, `apps/web/src/lib/restore-maintenance-durable.ts:73`, `apps/web/src/lib/restore-maintenance-durable.ts:81`
  - Restore lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:493`, `apps/web/src/app/[locale]/admin/db-actions.ts:503`, `apps/web/src/app/[locale]/admin/db-actions.ts:508`
- Upload quotas and restore/update interlocks:
  - Browser upload claim-before-await and lock scope: `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:252`, `apps/web/src/app/actions/images.ts:264`, `apps/web/src/app/actions/images.ts:418`, `apps/web/src/app/actions/images.ts:424`, `apps/web/src/app/actions/images.ts:616`, `apps/web/src/app/actions/images.ts:643`
  - Lightroom upload parse slot, quota settlement, and lock scope: `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:152`, `apps/web/src/app/api/admin/lr/upload/route.ts:160`, `apps/web/src/app/api/admin/lr/upload/route.ts:270`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`, `apps/web/src/app/api/admin/lr/upload/route.ts:422`, `apps/web/src/app/api/admin/lr/upload/route.ts:488`, `apps/web/src/app/api/admin/lr/upload/route.ts:504`
  - Shared advisory lock helper: `apps/web/src/lib/upload-processing-contract-lock.ts:9`, `apps/web/src/lib/upload-processing-contract-lock.ts:44`
- Delete/update/share mutation races:
  - Single and bulk delete queue cleanup, DB transaction, strict file cleanup, and revalidation: `apps/web/src/app/actions/images.ts:648`, `apps/web/src/app/actions/images.ts:694`, `apps/web/src/app/actions/images.ts:708`, `apps/web/src/app/actions/images.ts:725`, `apps/web/src/app/actions/images.ts:746`, `apps/web/src/app/actions/images.ts:806`, `apps/web/src/app/actions/images.ts:821`, `apps/web/src/app/actions/images.ts:855`
  - Metadata and bulk updates: `apps/web/src/app/actions/images.ts:906`, `apps/web/src/app/actions/images.ts:946`, `apps/web/src/app/actions/images.ts:984`, `apps/web/src/app/actions/images.ts:1075`
  - Share creation/revoke/delete conditional paths: `apps/web/src/app/actions/sharing.ts:91`, `apps/web/src/app/actions/sharing.ts:139`, `apps/web/src/app/actions/sharing.ts:194`, `apps/web/src/app/actions/sharing.ts:258`, `apps/web/src/app/actions/sharing.ts:317`, `apps/web/src/app/actions/sharing.ts:336`, `apps/web/src/app/actions/sharing.ts:357`, `apps/web/src/app/actions/sharing.ts:376`
- Smart collections:
  - Save/update/delete actions: `apps/web/src/app/actions/collections.ts:15`, `apps/web/src/app/actions/collections.ts:64`, `apps/web/src/app/actions/collections.ts:112`
  - Parser/compiler guards: `apps/web/src/lib/smart-collections.ts:142`, `apps/web/src/lib/smart-collections.ts:160`, `apps/web/src/lib/smart-collections.ts:316`, `apps/web/src/lib/smart-collections.ts:330`, `apps/web/src/lib/smart-collections.ts:374`, `apps/web/src/lib/smart-collections.ts:444`
  - Public page and load-more action: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84`, `apps/web/src/app/actions/public.ts:171`
- Share routes:
  - Shared photo metadata/body: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:39`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:87`
  - Shared group metadata/body: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:44`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:92`
  - Public share queries and denormalized view buffer: `apps/web/src/lib/data.ts:1205`, `apps/web/src/lib/data.ts:1271`, `apps/web/src/lib/data.ts:1341`
- Analytics and retention:
  - View recording actions and background write drain: `apps/web/src/app/actions/public.ts:417`, `apps/web/src/app/actions/public.ts:445`, `apps/web/src/app/actions/public.ts:477`, `apps/web/src/lib/background-db-writes.ts:5`, `apps/web/src/lib/background-db-writes.ts:28`
  - Shared-group view buffer and flush: `apps/web/src/lib/data.ts:49`, `apps/web/src/lib/data.ts:75`, `apps/web/src/lib/data.ts:222`
  - Retention sweep: `apps/web/src/lib/view-retention.ts:39`, `apps/web/src/lib/view-retention.ts:64`
- Public search, semantic, and similar flows:
  - Text search and load-more rate limits: `apps/web/src/app/actions/public.ts:121`, `apps/web/src/app/actions/public.ts:236`
  - Semantic route: `apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:186`, `apps/web/src/app/api/search/semantic/route.ts:247`, `apps/web/src/app/api/search/semantic/route.ts:263`
  - Similar route: `apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:110`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`
  - CLIP queue and embedding decode: `apps/web/src/lib/clip-model.ts:117`, `apps/web/src/lib/clip-model.ts:156`, `apps/web/src/lib/clip-embeddings.ts:135`, `apps/web/src/lib/clip-embeddings.ts:164`
- OG fallback:
  - Site OG route: `apps/web/src/app/api/og/route.tsx`
  - Per-photo OG route and fallback: `apps/web/src/app/api/og/photo/[id]/route.tsx:39`, `apps/web/src/app/api/og/photo/[id]/route.tsx:109`, `apps/web/src/app/api/og/photo/[id]/route.tsx:118`, `apps/web/src/app/api/og/photo/[id]/route.tsx:249`
  - Derivative fetch fallback helper: `apps/web/src/lib/og-photo-fetch.ts`
- Worker/service worker:
  - Registration: `apps/web/src/components/register-service-worker.tsx:13`
  - Build stamp: `apps/web/scripts/build-sw.ts:27`
  - Template cache and update logic: `apps/web/public/sw.template.js:26`, `apps/web/public/sw.template.js:209`, `apps/web/public/sw.template.js:317`, `apps/web/public/sw.template.js:362`, `apps/web/public/sw.template.js:367`, `apps/web/public/sw.template.js:390`
  - Reference/tests: `apps/web/src/lib/sw-cache.ts:47`, `apps/web/src/__tests__/sw-template-contract.test.ts:28`, `apps/web/src/__tests__/sw-cache.test.ts:112`

## Findings

No new finding.

## Trace Notes

- Restore maintenance is held behind `LOCK_DB_RESTORE`, the upload-processing contract lock, color backfill lock, semantic backfill lock, and a durable marker. The restore path flushes shared-group view counts, quiesces the image queue, drains tracked background writes, runs import plus migrations, and only clears maintenance/resumes queue on the verified or non-keep-maintenance path. I did not find a new restore/upload overlap that survives the existing lock ordering.
- Browser uploads acquire the upload-processing contract before quota claim, filesystem writes, DB insert, or enqueue. Lightroom uploads parse/prevalidate before that lock, but save/insert/enqueue occur under the lock; lock timeout and every pre-insert failure path settle the preclaim. If a restore occupies the lock, the LR route either times out before saving or proceeds after the restore without an overlap.
- Delete/update/share paths already handle the concrete races I traced: conditional share-key revoke, FK rollback for group-share creation, transactionally deleted rows, stale bulk-delete counts, strict cleanup treating `ENOENT` as success, and share/group revalidation from keys captured before delete.
- Smart-collection persistence validates JSON byte size, AST node count, group child count, depth, finite scalar values, per-column operators, date strings, and capped `IN` lists. Public rendering reparses and recompiles before query execution, and load-more uses the same cursor contract as the main image list.
- Share route metadata intentionally stays generic and avoids unmetered key lookups. The page body validates base56 keys, checks maintenance, rate-limits once, then performs the share lookup.
- View recording validates visible targets before durable inserts and rechecks restore maintenance before calling `trackBackgroundDbWrite`; restore preparation drains those tracked writes. The denormalized shared-group view buffer has bounded retry/backoff behavior and an explicit shutdown flush.
- Semantic and similar endpoints gate same-origin and maintenance before rate-limit charge, charge before DB-backed semantic-mode work, filter model versions, cap scan/topK, and use shared compile-guarded enrichment fields. The known web-process CLIP catch-up risk remains the Cycle 42 deferred item and is not re-raised here.
- Per-photo OG generation pins internal derivative fetches to `BASE_URL`, falls through configured image sizes, caps fetch size/time, and uses charged fallback behavior after DB/internal-fetch work. I did not find a new host-control or unbounded fallback path.
- The service worker uses a deterministic template-plus-pipeline cache namespace, immediate activation, old-cache purge, revocable-page HTML bypasses, bounded HEAD revalidation, serialized metadata mutation, and contract tests that compare the shipped template/generation behavior.

## Validation

- Read project instructions and latest context requested by the prompt:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.context/reviews/_aggregate.md`
  - `.context/reviews/cycle-43-2026-07-01/_aggregate.md`
  - `.context/plans/cycle-43-2026-07-01-plan.md`
  - `.context/plans/cycle-43-2026-07-01-deferred.md`
- Reviewed the files and flows listed in the inventory above.
- No source code was edited.

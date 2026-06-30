# Cycle 27 Performance Reviewer Report

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-27 perf-reviewer`
HEAD reviewed: `50dfcda0`
Mode: review-only. Source code was not changed; this report is the only intended edit.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-26-2026-06-30-plan.md`
- `.context/plans/cycle-26-2026-06-30-deferred.md`
- Prior `.context/reviews/perf-reviewer.md`

Inventory evidence before review:

- `git ls-files`: 2,594 tracked files.
- Focused runtime/config/test inventory: 582 tracked files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/public/sw*`, and root package/config files.
- Files changed since the cycle-26 reviewed commit are concentrated in review/plan history, restore maintenance, SQL restore scanning, modal isolation, search/lightbox/bottom-sheet consumers, and tests:
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/lib/restore-maintenance-durable.ts`
  - `apps/web/src/lib/sql-restore-scan.ts`
  - `apps/web/scripts/restore-maintenance-recovery.ts`
  - `apps/web/src/components/use-modal-tree-isolation.ts`
  - `apps/web/src/components/search.tsx`
  - `apps/web/src/components/lightbox.tsx`
  - `apps/web/src/components/info-bottom-sheet.tsx`
  - cycle-26 tests under `apps/web/src/__tests__/`
- Review-relevant areas examined: data access, schema indexes, public pages, timeline/year routes, semantic/similar search, rate limiting, analytics/view buffering, upload actions, Lightroom upload, image queue/backfill, Sharp image pipeline, CLIP inference queueing, restore/backup flow, service worker image cache, map UI, masonry/infinite scroll, modal UI responsiveness, and prior review/deferred registers.

## Findings Summary

New confirmed performance issues: 0.

New likely performance issues: 0.

New risks needing manual validation: 0.

Cycle 27 did not introduce a new performance/concurrency regression in the changed runtime surfaces I reviewed. The substantial open performance debt from cycle 26 is already tracked in `.context/plans/cycle-26-2026-06-30-deferred.md` and `.context/reviews/_aggregate.md`; I did not duplicate those as new findings.

## Confirmed Issues

None newly reportable for cycle 27.

The review found confirmed performance debt, but every confirmed item had an existing deferred owner/exit criterion from cycle 26 or earlier. Those are listed in "Known Deferred Items Not Re-filed" below.

## Likely Issues

None newly reportable for cycle 27.

Potential pressure points in the current code are either bounded by explicit caps or already tracked as deferred debt. I did not find a new high-confidence "likely issue" outside those registers.

## Risks Needing Manual Validation

None newly reportable for cycle 27.

Manual validation still matters for deferred large-gallery scenarios, but the scenarios are already named in the deferred plan. I did not identify a fresh manual-validation-only risk in the cycle-27 changes.

## Cycle 27 Cross-File Review Notes

### Restore maintenance and SQL restore path

- `apps/web/src/lib/restore-maintenance-durable.ts:16-29` resolves the marker path from runtime environment, not request data.
- `apps/web/src/lib/restore-maintenance-durable.ts:35-42` reads the durable marker with synchronous `fs.existsSync`, but this is used for startup/recovery state, not public hot-path rendering.
- `apps/web/src/lib/restore-maintenance-durable.ts:49-56` and `apps/web/src/lib/restore-maintenance-durable.ts:58-70` use synchronous marker write/unlink around restore lifecycle only.
- `apps/web/src/lib/restore-maintenance-durable.ts:80-99` begins/ends process maintenance with durable marker rollback/cleanup; failures do not leave the image queue resumed before marker handling.
- `apps/web/src/app/[locale]/admin/db-actions.ts:451-504` enters durable restore maintenance, flushes view buffers, quiesces image processing, and runs restore before post-restore cleanup.
- `apps/web/src/app/[locale]/admin/db-actions.ts:506-538` releases restore/image/backfill/semantic/upload locks and resumes queue after verified cleanup conditions.
- `apps/web/src/app/[locale]/admin/db-actions.ts:585-647` streams the uploaded restore SQL file to a temp path and scans bounded chunks instead of buffering the whole file in application memory.
- `apps/web/src/app/[locale]/admin/db-actions.ts:665-745` delegates restore execution to `mysql --one-database`, then runs migrations after a zero exit.
- `apps/web/src/lib/sql-restore-scan.ts:33-55` keeps allowed write/drop target regexes narrow.
- `apps/web/src/lib/sql-restore-scan.ts:57-123` blocks dangerous statements and schema qualifiers.
- `apps/web/src/lib/sql-restore-scan.ts:125-234` keeps only a 1 MiB tail plus the current chunk for boundary-aware scanning. This is bounded memory for the 250 MiB restore cap.

Assessment: no new performance finding. The sync filesystem calls are admin restore/recovery operations, not public request work; restore scanning is bounded and streamed.

### Modal isolation and UI responsiveness

- `apps/web/src/components/use-modal-tree-isolation.ts:19-65` walks modal ancestors/siblings once per active modal, applies `aria-hidden`/`inert`, blurs focus if needed, and restores attributes on cleanup.
- `apps/web/src/components/search.tsx:143-149` wires the hook to the search modal root.
- `apps/web/src/components/search.tsx:366-536` portals the modal rather than nesting it in the main page tree.
- `apps/web/src/components/lightbox.tsx:99-101` wires the hook only while the lightbox component is mounted/open.
- `apps/web/src/components/lightbox.tsx:434-451` handles body scroll/focus cleanup separately from tree isolation.
- `apps/web/src/components/info-bottom-sheet.tsx:52-58` wires the hook to the bottom-sheet modal root.
- `apps/web/src/components/info-bottom-sheet.tsx:177-214` renders the modal subtree through a root wrapper.

Assessment: no new performance finding. The hook iterates DOM siblings/ancestors, not every card/image descendant, and it runs on open/close rather than scroll/render loops.

### Upload and image pipeline

- Browser upload still claims quota and settings lock before per-file processing at `apps/web/src/app/actions/images.ts:175-242`, validates disk/topic at `apps/web/src/app/actions/images.ts:250-299`, and processes each file at `apps/web/src/app/actions/images.ts:346-506`.
- Lightroom upload checks declared content length before multipart parse at `apps/web/src/app/api/admin/lr/upload/route.ts:100-112`, then calls `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:153-173`.
- Lightroom upload holds the upload-processing lock across save/metadata/insert work at `apps/web/src/app/api/admin/lr/upload/route.ts:243-461`.
- Original save streams file contents to disk before metadata extraction at `apps/web/src/lib/process-image.ts:900-923`.
- Sharp process concurrency is capped by `apps/web/src/lib/process-image.ts:36-57`.
- Format generation still fans out per format/size at `apps/web/src/lib/process-image.ts:1220-1431`.
- GPS stripping still buffers the original at `apps/web/src/lib/process-image.ts:1737-1764`.
- Image queue concurrency defaults/caps are resolved at `apps/web/src/lib/image-queue.ts:87-108`.
- Queue retry maps are bounded and pruned at `apps/web/src/lib/image-queue.ts:198-220`.
- Queue bootstrap scans in batches and excludes permanent failures at `apps/web/src/lib/image-queue.ts:901-1058`.

Assessment: no new cycle-27 issue. The costly parts are known deferred items: GPS full-buffer stripping, long upload-processing lock scope, multipart materialization, and per-size Sharp re-decodes.

### DB query and memory surfaces

- View-count buffers are chunked/capped at `apps/web/src/lib/data.ts:13-35`, `apps/web/src/lib/data.ts:73-154`, and `apps/web/src/lib/data.ts:156-210`.
- Public first-page listing still uses grouped/window-count shapes at `apps/web/src/lib/data.ts:878-914` and smart collection initial offset path at `apps/web/src/lib/data.ts:1417-1468`.
- Topic/nav data still includes sitemap-oriented latest timestamp work at `apps/web/src/lib/data.ts:509-529`, while `Nav` consumes `getTopicsCached()` at `apps/web/src/components/nav.tsx:8-20`.
- Timeline date functions remain at `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-142`, and `apps/web/src/lib/data-timeline.ts:186-207`.
- Public map data remains capped at 10,000 rows at `apps/web/src/lib/data.ts:1649-1685`.
- Admin CSV export still materializes up to 50,000 rows and a single response string at `apps/web/src/app/[locale]/admin/db-actions.ts:80-160`.
- Rate-limit bucket purge still deletes by `bucketStart` at `apps/web/src/lib/rate-limit.ts:515-518` while the table primary key is `(ip, type, bucket_start)` at `apps/web/src/db/schema.ts:212-219`.
- View-retention deletes now align with indexed `(viewed_at, id)` access at `apps/web/src/lib/view-retention.ts:64-90` and schema indexes at `apps/web/src/db/schema.ts:225-264`.

Assessment: no new DB finding. The expensive public counts, timeline function predicates, nav topic timestamp, map cap, CSV memory, and rate-limit purge index shape were all already in prior registers or deferred plans.

### Semantic search, CLIP, and CPU concurrency

- Semantic search rejects oversized/missing/chunked request bodies before reading text at `apps/web/src/app/api/search/semantic/route.ts:136-167`.
- Semantic search rate-limits before config/body-dependent protected work at `apps/web/src/app/api/search/semantic/route.ts:173-184`.
- Semantic text search embeds and scans bounded rows at `apps/web/src/app/api/search/semantic/route.ts:238-311`, then enriches only result IDs at `apps/web/src/app/api/search/semantic/route.ts:321-352`.
- Similar search validates/rate-limits before expensive work at `apps/web/src/app/api/search/similar/[id]/route.ts:86-126`.
- Similar search scans `SEMANTIC_SCAN_LIMIT` embeddings and computes dot products in-process at `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`.
- CLIP inference slots and queue limits are defined at `apps/web/src/lib/clip-model.ts:53-160`.
- Text embedding uses bounded input length before model execution at `apps/web/src/lib/clip-model.ts:228-249`.
- Image embedding keeps Sharp decode/resize/raw conversion and model execution inside the inference slot at `apps/web/src/lib/clip-model.ts:261-312`.

Assessment: no new cycle-27 finding. The scan-based semantic routes remain bounded by configured limits; production scale-out to ANN/indexed vector search remains future work, not a newly introduced regression.

### Public UI, map, and service worker

- Home page first paint fetches 30 images through `getImagesLitePage()` at `apps/web/src/app/[locale]/(public)/page.tsx:149-168`.
- Infinite masonry keeps appending all loaded images at `apps/web/src/components/home-client.tsx:124-130` and renders accumulated cards at `apps/web/src/components/home-client.tsx:286-412`.
- Load-more observes and appends pages at `apps/web/src/components/load-more.tsx:23-161`.
- Map page serializes marker/list props from capped rows at `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`.
- Map client computes bounds and mounts all markers at `apps/web/src/components/map/map-client.tsx:76-140`.
- Service worker image cache still performs a bounded HEAD probe before serving cached images at `apps/web/public/sw.template.js:31-38` and `apps/web/public/sw.template.js:224-286`.

Assessment: no new UI responsiveness finding. The masonry, map, and SW behaviors are known deferred cycle-26 items.

## Known Deferred Items Not Re-filed

These remain real performance debts, but they have existing deferred ownership/exit criteria and are not duplicated as cycle-27 findings.

- Public first-page exact grouped/window totals: `apps/web/src/lib/data.ts:878-914`, `apps/web/src/lib/data.ts:1417-1468`, `apps/web/src/app/[locale]/(public)/page.tsx:165-168`.
- GPS stripping full-original buffering: `apps/web/src/lib/process-image.ts:1737-1764`, `apps/web/src/app/actions/images.ts:388-395`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-378`.
- Upload-processing lock spans slow I/O/CPU: `apps/web/src/app/actions/images.ts:175-190`, `apps/web/src/app/actions/images.ts:346-418`, `apps/web/src/app/api/admin/lr/upload/route.ts:243-461`.
- Infinite masonry retains all loaded cards: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-412`, `apps/web/src/components/load-more.tsx:116-132`.
- Public map serializes/mounts up to 10,000 markers/list rows: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-140`.
- CSV export duplicates large payloads in memory: `apps/web/src/app/[locale]/admin/db-actions.ts:80-160`.
- Timeline/year non-sargable date predicates: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:186-207`.
- Nav pays for sitemap-only topic timestamps: `apps/web/src/lib/data.ts:509-529`, `apps/web/src/components/nav.tsx:8-20`.
- Cached image display waits on per-tile HEAD probes: `apps/web/public/sw.template.js:31-38`, `apps/web/public/sw.template.js:224-286`.
- Lightroom multipart body materialization before per-file size check: `apps/web/src/app/api/admin/lr/upload/route.ts:153-173`.
- Rate-limit bucket purge lacks a leading `bucketStart` index: `apps/web/src/lib/rate-limit.ts:515-518`, `apps/web/src/db/schema.ts:212-219`.
- Sharp derivative generation re-decodes per format/size for correctness-preserving output isolation: `apps/web/src/lib/process-image.ts:1220-1431`.

## Final Sweep Confirmation

Final sweep performed across:

- Docs and review history: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, cycle-26 plan/deferred files, prior perf report.
- Changed cycle-27 runtime files: restore maintenance durable marker, restore DB action, SQL restore scanner, restore recovery script, modal isolation hook and its search/lightbox/bottom-sheet consumers.
- Performance categories: public DB queries, schema/index coverage, admin CSV, upload/browser/LR ingest, Sharp processing, image queue/backfill, CLIP/semantic CPU queues, service worker cache behavior, public map, masonry/infinite scroll, analytics/view buffering, rate limiting, restore concurrency.

I found no new cycle-27 performance findings outside already deferred items. No tests were run because this was a static review artifact request; validation evidence is source inspection with the exact citations above.

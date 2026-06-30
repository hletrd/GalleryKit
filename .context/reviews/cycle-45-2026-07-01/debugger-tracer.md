# Cycle 45 Debugger / Tracer Review

Date: 2026-07-01 03:19 KST
Reviewer: debugger-tracer
Base HEAD: `b430cddd`
Scope: read-only trace review for latent bugs, race conditions, state consistency gaps, error-handling gaps, and comment/test contract drift.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-44-2026-07-01/_aggregate.md`
- `.context/plans/cycle-44-2026-07-01-plan.md`
- `.context/plans/cycle-44-2026-07-01-deferred.md`
- `.context/reviews/cycle-44-2026-07-01/debugger-tracer-critic.md`

Cycle 44 scheduled scanner/docs fixes only and recorded deployment closure at `b430cddd`. Cycle 44 had no new deferred findings. I did not re-raise the carried-forward items (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`) because I found no new evidence changing their severity or making them scheduled now.

## Inventory

- Recent state:
  - Current HEAD and recent commits: `b430cddd`, `4ecfdde0`, `f417d86b`
  - Latest aggregate pointer: `.context/reviews/_aggregate.md`
  - Cycle 44 plan/deferred state: `.context/plans/cycle-44-2026-07-01-plan.md`, `.context/plans/cycle-44-2026-07-01-deferred.md`
- Restore / maintenance interlocks:
  - Process maintenance flag and original cleanup guard: `apps/web/src/lib/restore-maintenance.ts:21`, `apps/web/src/lib/restore-maintenance.ts:33`, `apps/web/src/lib/restore-maintenance.ts:48`
  - Durable marker read/write/fail-closed sync: `apps/web/src/lib/restore-maintenance-durable.ts:36`, `apps/web/src/lib/restore-maintenance-durable.ts:50`, `apps/web/src/lib/restore-maintenance-durable.ts:73`, `apps/web/src/lib/restore-maintenance-durable.ts:81`
  - Restore lock ordering, quiesce, drain, and resume: `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:378`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:492`, `apps/web/src/app/[locale]/admin/db-actions.ts:503`, `apps/web/src/app/[locale]/admin/db-actions.ts:507`
  - Shared upload-processing advisory lock helper: `apps/web/src/lib/upload-processing-contract-lock.ts:9`
- Upload / ingest / quota settlement:
  - Browser upload claim-before-await and one-shot settlement: `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:252`, `apps/web/src/app/actions/images.ts:258`, `apps/web/src/app/actions/images.ts:267`, `apps/web/src/app/actions/images.ts:300`, `apps/web/src/app/actions/images.ts:418`, `apps/web/src/app/actions/images.ts:424`, `apps/web/src/app/actions/images.ts:591`, `apps/web/src/app/actions/images.ts:616`, `apps/web/src/app/actions/images.ts:643`
  - Lightroom upload parse slot, preclaim settlement, upload lock, and post-save cleanup: `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:152`, `apps/web/src/app/api/admin/lr/upload/route.ts:160`, `apps/web/src/app/api/admin/lr/upload/route.ts:178`, `apps/web/src/app/api/admin/lr/upload/route.ts:252`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`, `apps/web/src/app/api/admin/lr/upload/route.ts:288`, `apps/web/src/app/api/admin/lr/upload/route.ts:374`, `apps/web/src/app/api/admin/lr/upload/route.ts:422`, `apps/web/src/app/api/admin/lr/upload/route.ts:488`, `apps/web/src/app/api/admin/lr/upload/route.ts:504`
  - Settings lock-once contract for upload-sensitive settings: `apps/web/src/app/actions/settings.ts:68`, `apps/web/src/app/actions/settings.ts:74`, `apps/web/src/app/actions/settings.ts:94`, `apps/web/src/app/actions/settings.ts:115`, `apps/web/src/app/actions/settings.ts:136`, `apps/web/src/app/actions/settings.ts:164`
- Delete / share / mutation races:
  - Single and bulk delete stale-row handling and derivative cleanup: `apps/web/src/app/actions/images.ts:666`, `apps/web/src/app/actions/images.ts:688`, `apps/web/src/app/actions/images.ts:694`, `apps/web/src/app/actions/images.ts:706`, `apps/web/src/app/actions/images.ts:714`, `apps/web/src/app/actions/images.ts:725`, `apps/web/src/app/actions/images.ts:774`, `apps/web/src/app/actions/images.ts:797`, `apps/web/src/app/actions/images.ts:806`, `apps/web/src/app/actions/images.ts:818`, `apps/web/src/app/actions/images.ts:828`, `apps/web/src/app/actions/images.ts:841`
  - Metadata/bulk updates and retry failed image: `apps/web/src/app/actions/images.ts:946`, `apps/web/src/app/actions/images.ts:956`, `apps/web/src/app/actions/images.ts:984`, `apps/web/src/app/actions/images.ts:1074`, `apps/web/src/app/actions/images.ts:1206`
  - Share creation/revoke/delete race handling and rate-limit rollback: `apps/web/src/app/actions/sharing.ts:91`, `apps/web/src/app/actions/sharing.ts:119`, `apps/web/src/app/actions/sharing.ts:139`, `apps/web/src/app/actions/sharing.ts:164`, `apps/web/src/app/actions/sharing.ts:194`, `apps/web/src/app/actions/sharing.ts:235`, `apps/web/src/app/actions/sharing.ts:258`, `apps/web/src/app/actions/sharing.ts:297`, `apps/web/src/app/actions/sharing.ts:317`, `apps/web/src/app/actions/sharing.ts:336`, `apps/web/src/app/actions/sharing.ts:357`
- Queue / async side effects:
  - Processing queue state, side-effect tracking, embedding writes: `apps/web/src/lib/image-queue.ts:293`, `apps/web/src/lib/image-queue.ts:346`, `apps/web/src/lib/image-queue.ts:353`, `apps/web/src/lib/image-queue.ts:395`
  - Per-image claim, processed update, delete-during-processing cleanup, caption/embedding side effects: `apps/web/src/lib/image-queue.ts:470`, `apps/web/src/lib/image-queue.ts:537`, `apps/web/src/lib/image-queue.ts:578`, `apps/web/src/lib/image-queue.ts:646`, `apps/web/src/lib/image-queue.ts:677`, `apps/web/src/lib/image-queue.ts:683`, `apps/web/src/lib/image-queue.ts:702`, `apps/web/src/lib/image-queue.ts:721`
  - Retry/permanent failure persistence and bootstrap: `apps/web/src/lib/image-queue.ts:773`, `apps/web/src/lib/image-queue.ts:816`, `apps/web/src/lib/image-queue.ts:901`, `apps/web/src/lib/image-queue.ts:925`, `apps/web/src/lib/image-queue.ts:978`, `apps/web/src/lib/image-queue.ts:1060`, `apps/web/src/lib/image-queue.ts:1104`
  - In-app color backfill state/lock/concurrency surface: `apps/web/src/lib/admin-backfill-runner.ts:105`, `apps/web/src/lib/admin-backfill-runner.ts:129`, `apps/web/src/lib/admin-backfill-runner.ts:316`
  - CLIP backfill script lock/cursor/cap: `apps/web/scripts/backfill-clip-embeddings.ts:103`, `apps/web/scripts/backfill-clip-embeddings.ts:111`, `apps/web/scripts/backfill-clip-embeddings.ts:141`, `apps/web/scripts/backfill-clip-embeddings.ts:144`, `apps/web/scripts/backfill-clip-embeddings.ts:156`, `apps/web/scripts/backfill-clip-embeddings.ts:231`
- Analytics / public expensive flows:
  - Tracked background writes and restore drain: `apps/web/src/lib/background-db-writes.ts:5`, `apps/web/src/lib/background-db-writes.ts:28`
  - Public view recorders: `apps/web/src/app/actions/public.ts:417`, `apps/web/src/app/actions/public.ts:445`, `apps/web/src/app/actions/public.ts:477`
  - Shared-group view buffer, retry cap, shutdown flush: `apps/web/src/lib/data.ts:49`, `apps/web/src/lib/data.ts:75`, `apps/web/src/lib/data.ts:222`, `apps/web/src/lib/data.ts:1271`, `apps/web/src/lib/data.ts:1351`
  - View retention sweep: `apps/web/src/lib/view-retention.ts:39`, `apps/web/src/lib/view-retention.ts:64`
  - Public semantic/similar gates, charge points, abort checks, model-version filters: `apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:186`, `apps/web/src/app/api/search/semantic/route.ts:247`, `apps/web/src/app/api/search/semantic/route.ts:263`, `apps/web/src/app/api/search/semantic/route.ts:317`, `apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:110`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`, `apps/web/src/app/api/search/similar/[id]/route.ts:207`
- Serving / OG fallback:
  - Upload serving path traversal, symlink, ETag, HEAD, stream handling: `apps/web/src/lib/serve-upload.ts:126`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:185`, `apps/web/src/lib/serve-upload.ts:203`, `apps/web/src/lib/serve-upload.ts:228`, `apps/web/src/lib/serve-upload.ts:252`
  - OG photo fetch budget/byte cap/fallback: `apps/web/src/lib/og-photo-fetch.ts:30`, `apps/web/src/lib/og-photo-fetch.ts:41`, `apps/web/src/lib/og-photo-fetch.ts:54`, `apps/web/src/lib/og-photo-fetch.ts:64`, `apps/web/src/lib/og-photo-fetch.ts:102`
  - Per-photo OG canonical-origin pinning and charged fallback: `apps/web/src/app/api/og/photo/[id]/route.tsx:39`, `apps/web/src/app/api/og/photo/[id]/route.tsx:48`, `apps/web/src/app/api/og/photo/[id]/route.tsx:58`, `apps/web/src/app/api/og/photo/[id]/route.tsx:109`, `apps/web/src/app/api/og/photo/[id]/route.tsx:118`, `apps/web/src/app/api/og/photo/[id]/route.tsx:231`, `apps/web/src/app/api/og/photo/[id]/route.tsx:249`

## Findings

No new issue found.

## Trace Notes

- Restore takes `LOCK_DB_RESTORE`, the upload-processing contract lock, color-backfill lock, and semantic-backfill lock before setting durable maintenance, then flushes shared-group view counts, quiesces the image queue, drains tracked DB writes, runs restore, clears maintenance, resumes the queue, and releases locks. I did not find a new lock-order inversion or maintenance-clear path that would overlap restore with uploads or queued processing.
- Browser uploads still claim quota synchronously before awaited disk/topic checks and settle through the one-shot helper on every early return I traced. Lightroom upload mirrors this with a declared-byte preclaim, bounded multipart parse slot, post-save cleanup block, late maintenance recheck, and settlement before enqueue. I did not find a new quota leak or original-file orphan path.
- Delete and share mutations still handle the high-risk races: queue state cleanup before deletion, affected-row checks after DB delete/update, full variant scans for derivative cleanup, conditional photo-share revoke, group-share FK rollback, and rate-limit rollback where the action did not execute.
- Queue processing holds per-image advisory claims, conditionally marks rows processed, removes variants if the row disappeared mid-processing, tracks caption/embedding side effects for restore/shutdown drain, and persists permanent failures. Bootstrap pagination plus retry timers avoid the previously documented starvation loops.
- Semantic/similar endpoints charge before protected DB/embedding work, preserve the no-rollback-after-admission policy documented in `rate-limit.ts`, filter by model version, cap scans/topK, and use shared enrichment fields. The production CLIP web-process catch-up design risk remains `PA-42-02`; I found no separate new evidence that changes its severity here.
- OG and upload serving paths keep canonical-origin pinning, byte/time budgets, symlink/path containment, and charged fallback behavior aligned with comments and tests. I did not find a new request-origin, open-redirect, or unbounded internal-fetch path.

## Validation

- Read-only review only; no source or plan files edited.
- Wrote this artifact exactly at `.context/reviews/cycle-45-2026-07-01/debugger-tracer.md`.
- No tests run; this lane was a source/document trace review, and executing the full gate suite was outside the requested read-only reviewer scope.

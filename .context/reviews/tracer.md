# Tracer Review - Cycle 22

Review lane: `tracer`
Scope: current `HEAD` (`85b0291f`)
Mode: review-only. Source files were not modified. No commit or push was performed.

## Inventory

I read the project instructions and operating context first, then traced current code broadly across the requested causal flows. This cycle rechecked prior suspicious seams against current HEAD instead of carrying forward stale findings.

Required docs and current review context examined:

- `AGENTS.md` instructions supplied in the prompt, including no source edits for this turn.
- `CLAUDE.md:1-760`, especially upload lifecycle, image processing, restore, semantic search, runtime topology, analytics retention, deploy notes, and security architecture.
- `.context/reviews/tracer.md:1-112` from cycle 21, to identify previously suspicious flows and avoid stale carry-forward.
- `.context/reviews/_aggregate.md:1-160` and `.context/reviews/architect-debugger-tracer.md:1-110`, to compare current source against recent aggregate findings.

Primary implementation files and regions inspected:

- Upload admission, quota claim/settle, and LR parity: `apps/web/src/app/actions/images.ts:114-624`, `apps/web/src/app/api/admin/lr/upload/route.ts:68-554`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-limits.ts`.
- Queue, processing, delete, and side effects: `apps/web/src/lib/image-queue.ts:76-178`, `apps/web/src/lib/image-queue.ts:334-427`, `apps/web/src/lib/image-queue.ts:489-827`, `apps/web/src/app/actions/images.ts:627-882`, `apps/web/src/lib/process-image.ts:594-651`, `apps/web/src/lib/upload-paths.ts:71-102`.
- Restore/backup and advisory-lock boundaries: `apps/web/src/app/[locale]/admin/db-actions.ts:162-550`, `apps/web/src/app/[locale]/admin/db-actions.ts:554-746`, `apps/web/src/lib/sql-restore-scan.ts:1-168`, `apps/web/src/app/api/admin/db/download/route.ts:21-109`, `apps/web/src/lib/advisory-locks.ts:18-47`, `apps/web/src/lib/restore-maintenance.ts`.
- Semantic search and CLIP lifecycle: `apps/web/src/app/api/search/semantic/route.ts:1-362`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-271`, `apps/web/src/lib/clip-model.ts:1-313`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/actions/embeddings.ts:57-205`, `apps/web/scripts/backfill-clip-embeddings.ts:67-233`.
- Public serving and OG/cache-adjacent paths: `apps/web/src/lib/serve-upload.ts:1-313`, `apps/web/src/app/uploads/[...path]/route.ts:1-30`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-24`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`.
- Auth/session/admin API gates: `apps/web/src/lib/session.ts:1-151`, `apps/web/src/app/actions/auth.ts:70-445`, `apps/web/src/lib/request-origin.ts:1-109`, `apps/web/src/lib/api-auth.ts:1-146`, `apps/web/src/proxy.ts:52-129`, `apps/web/src/lib/admin-tokens.ts`.
- Analytics, public views, and shared links: `apps/web/src/app/actions/public.ts:120-460`, `apps/web/src/lib/analytics.ts:1-190`, `apps/web/src/lib/view-retention.ts:1-90`, `apps/web/src/lib/data.ts:13-249`, `apps/web/src/lib/data.ts:1024-1342`, `apps/web/src/db/schema.ts:220-260`.
- Schema/migration anchors for traced tables: `apps/web/src/db/schema.ts:19-120`, `apps/web/src/db/schema.ts:184-260`, `apps/web/drizzle/0010_analytics_views.sql`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`, `apps/web/drizzle/0027_analytics_retention_indexes.sql`.

No tests were run; this was a static causal trace. Evidence below is from exact source regions.

## Findings

No new tracer findings were promoted in this cycle.

Severity summary: 0 Critical, 0 High, 0 Medium, 0 Low.

## Confirmed Negative Traces

- Upload lifecycle and quota settle/release: browser uploads claim the cumulative tracker synchronously before awaited validations at `apps/web/src/app/actions/images.ts:238-242`, roll back disk/topic failures at `apps/web/src/app/actions/images.ts:257-264` and `apps/web/src/app/actions/images.ts:286-292`, and reconcile the claim to actual success bytes at `apps/web/src/app/actions/images.ts:595-596`. LR uploads mirror the same preclaim/settle contract at `apps/web/src/app/api/admin/lr/upload/route.ts:114-151` and settle success to actual file size at `apps/web/src/app/api/admin/lr/upload/route.ts:473-477`.
- Upload processing snapshot parity: browser enqueue forwards the full processing snapshot, including `semanticSearchMode`, at `apps/web/src/app/actions/images.ts:499-531`. LR enqueue now forwards the same settings, including `semanticSearchMode`, at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`, closing the previous LR semantic-search drift hypothesis.
- Queue processing/deletion races: each queue worker holds the per-image advisory lock from `apps/web/src/lib/image-queue.ts:446-473`, verifies the row is still pending at `apps/web/src/lib/image-queue.ts:554-560`, and only marks processed with a conditional update at `apps/web/src/lib/image-queue.ts:653-657`. If deletion wins the race, it full-scans and removes all derivative variants at `apps/web/src/lib/image-queue.ts:659-675`.
- Admin deletion cleanup: `deleteImage` and `deleteImages` remove queue bookkeeping before deleting rows at `apps/web/src/app/actions/images.ts:673-684` and `apps/web/src/app/actions/images.ts:785-795`, then run strict original + full-variant cleanup at `apps/web/src/app/actions/images.ts:701-718` and `apps/web/src/app/actions/images.ts:820-858`. Schema FKs cascade dependent tag/share/view/embedding rows from `apps/web/src/db/schema.ts:128-153`, `apps/web/src/db/schema.ts:224-260`, and `apps/web/src/db/schema.ts:280-295`.
- Restore versus semantic backfill: restore now acquires `LOCK_SEMANTIC_EMBEDDING_BACKFILL` alongside restore/upload/color locks at `apps/web/src/app/[locale]/admin/db-actions.ts:376-445`. The server action and sidecar both acquire that same lock at `apps/web/src/app/actions/embeddings.ts:105-120` and `apps/web/scripts/backfill-clip-embeddings.ts:99-112`, so the cycle 21 write-through-restore finding is no longer present.
- SQL restore scanner bypass hypothesis: the scanner now checks both comment-stripped and comment-as-space forms at `apps/web/src/lib/sql-restore-scan.ts:113-155`, preserving detection for in-token obfuscation and multi-token comment-separated dangerous statements. Restore applies that scanner before invoking `mysql` at `apps/web/src/app/[locale]/admin/db-actions.ts:604-633`.
- Backup download descriptor leak hypothesis: the route keeps the opened file handle in outer scope and closes it on pre-stream errors unless stream ownership has transferred at `apps/web/src/app/api/admin/db/download/route.ts:42-80` and `apps/web/src/app/api/admin/db/download/route.ts:91-96`.
- Public serving: upload routes only permit `jpeg`, `webp`, and `avif` top-level dirs at `apps/web/src/lib/serve-upload.ts:133-149`; each segment is safe-checked at `apps/web/src/lib/serve-upload.ts:154-160`; symlinks/non-files and realpath escapes are rejected at `apps/web/src/lib/serve-upload.ts:175-184`. Both primary and locale-prefixed HEAD routes pass the `HEAD` mode at `apps/web/src/app/uploads/[...path]/route.ts:17-30` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:17-24`.
- Semantic route admission: the text semantic route rejects non-JSON and JSON-like subtypes at `apps/web/src/app/api/search/semantic/route.ts:117-134`, rejects comma-tokenized chunked transfer encodings at `apps/web/src/app/api/search/semantic/route.ts:136-145`, requires `Content-Length` at `apps/web/src/app/api/search/semantic/route.ts:147-167`, charges before DB-backed config lookup at `apps/web/src/app/api/search/semantic/route.ts:173-184`, and byte-checks the actual body with `Buffer.byteLength` at `apps/web/src/app/api/search/semantic/route.ts:206-218`.
- Semantic model separation: text search scans only the active model version at `apps/web/src/app/api/search/semantic/route.ts:202-205` and `apps/web/src/app/api/search/semantic/route.ts:263-275`; similar-photo search is production-only at `apps/web/src/app/api/search/similar/[id]/route.ts:110-126` and scans only `PRODUCTION_MODEL_VERSION` at `apps/web/src/app/api/search/similar/[id]/route.ts:132-177`.
- Auth/session: production refuses a DB-stored session-secret fallback at `apps/web/src/lib/session.ts:19-36`; tokens are HMAC-verified with equal-length `timingSafeEqual` at `apps/web/src/lib/session.ts:107-119`; token shape, age, and DB session expiry are checked at `apps/web/src/lib/session.ts:121-150`. Admin API routes wrapped in `withAdminAuth` enforce same-origin for cookie auth at `apps/web/src/lib/api-auth.ts:114-129` and scoped PAT auth for external clients at `apps/web/src/lib/api-auth.ts:68-111`.
- Public analytics retention: public view actions validate target existence before durable inserts at `apps/web/src/app/actions/public.ts:370-390`, `apps/web/src/app/actions/public.ts:397-424`, and `apps/web/src/app/actions/public.ts:428-459`. Retention uses a positive-only fallback window and chunked deletes at `apps/web/src/lib/view-retention.ts:39-89`.
- Shared-group view counts: buffered `shared_groups.view_count` increments are explicitly best-effort and process-local, but the buffer is capped/backed off at `apps/web/src/lib/data.ts:49-63` and `apps/web/src/lib/data.ts:75-219`, and restore flushes it before import at `apps/web/src/app/[locale]/admin/db-actions.ts:481-485`.

## Final Sweep

Final sweep rechecked the competing hypotheses most likely to hide causal bugs: browser/LR upload drift, quota claim leaks after post-claim awaits, restore sidecar writers outside process-local maintenance, queue/delete orphan variants, stale processing snapshots, upload-time CLIP write races, semantic body admission before rate limiting, model-version cross-contamination, public serving traversal/symlink/cache leakage, auth origin bypasses, session-secret downgrade, backup download TOCTOU/descriptor leaks, SQL restore scanner comment obfuscation, analytics unbounded growth, and shared-group count loss during restore.

Skipped or intentionally limited areas:

- I did not run tests, lint, typecheck, build, Playwright, or live browser QA.
- I did not inspect generated build output, `node_modules`, image/binary fixtures, `.next`, live production state, or external services.
- I sampled OG route/source files as public-serving adjacency but did not perform a full visual or social-crawler rendering pass.
- I left unrelated review artifacts and existing git state untouched.

# Tracer Review - Cycle 23

Review lane: `tracer`
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `45208b21`
Mode: review-only. Source files were not modified. This report is the only intended file change from this lane.

## Method / Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Current review-relevant inventory covered:

- 457 files under the requested executable/review surface: `apps/web/src/app/actions`, `apps/web/src/app/api`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/src/__tests__`, and `apps/web/e2e`.
- App/server config and deployment adjacency: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, root `package.json`, `README.md`, `CLAUDE.md`, and `AGENTS.md`.
- Prior/current review context: existing `.context/reviews/tracer.md`, `.context/reviews/run9-cycle8/tracer.md`, and the concurrently modified cycle-23 review artifacts. Existing changes in other `.context/reviews/*.md` files were left untouched.

Static causal traces performed end to end:

- Upload/process/delete/backfill: browser upload action, Lightroom upload route, upload quota tracker, original storage helpers, image queue, Sharp processing, delete actions, in-app backfill, sidecar backfill, queue bootstrap/shutdown, processing-setting snapshots, derivative cleanup.
- Admin auth/session/token: login/logout/password change, session signing/verification, admin API wrapper, PAT issuance/verification/scope enforcement/mark-used, Lightroom auth handoff.
- Public sharing/view counts/rate limiting: share creation/revocation, `/s` and `/g` public pages, view-event actions, shared-group view-count buffer, rate-limit maps/DB buckets, analytics sanitizers, retention.
- DB backup/restore/migrations: backup action/download route, restore upload/scanner/import/migration path, advisory locks, maintenance state, migration journal, schema/reconcile, migration tests.
- Semantic search: text semantic POST, similar-image GET, CLIP model gates, model-version separation, body admission, scan/enrichment privacy, embedding backfill.
- OG/image serving: topic OG, photo OG, internal derivative fetch chain, fallback redirects, upload route serving, cache/ETag/settings hash, traversal/symlink checks.
- Settings/privacy: gallery settings action, SEO settings action, config resolver, color-impacting hash, schema public/admin projections, search-enrichment privacy guard.

Validation run:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

No full lint/typecheck/build/Vitest/Playwright run was performed; this was a static deep trace with the custom security scanners above.

## Findings

### TRC23-01 - Lightroom token creation drops non-number MySQL `insertId` values to `0`

Severity: Low
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/lib/admin-tokens.ts:221-228` inserts the `admin_tokens` row, narrows the result to `{ insertId?: number }`, and returns `0` whenever `insertId` is not a JavaScript number.
- The repo already has a canonical safe coercion helper for this exact class: `apps/web/src/lib/validation.ts:173-199` documents that MySQL `insertId` may be `BigInt`, validates safe coercion, and throws on overflow.
- Other active insert-ID paths use `safeInsertId`: browser image upload at `apps/web/src/app/actions/images.ts:465`, shared-group creation at `apps/web/src/app/actions/sharing.ts:262-263`, and Lightroom image upload at `apps/web/src/app/api/admin/lr/upload/route.ts:458-462`.
- `createLrToken` records the returned ID as the audit target at `apps/web/src/app/actions/lr-tokens.ts:87-99`.

Failure scenario:

If mysql2 returns `insertId: BigInt(7)` for the PAT insert, the token row is created and the plaintext token works, but the caller receives `{ id: 0 }` and the audit event records `admin_token:0`. If the auto-increment value is unsafe for `number`, this path silently collapses to `0` instead of failing closed like the protected insert sites.

Concrete fix:

Import `safeInsertId` in `apps/web/src/lib/admin-tokens.ts`, widen the result header to `number | bigint`, and replace the fallback with `safeInsertId(header.insertId)` plus an explicit missing-header error. Add a unit test that mocks `db.execute` returning `[{ insertId: BigInt(7) }, []]`.

### TRC23-02 - Foreground image processing can pin most of the shared MySQL pool across Sharp work

Severity: Medium
Confidence: High
Status: Confirmed operational risk

Evidence:

- The shared pool has 10 connections and `queueLimit: 20`: `apps/web/src/db/index.ts:23-33`.
- Foreground queue concurrency accepts up to 8: `apps/web/src/lib/image-queue.ts:87-90`.
- Each queue task acquires an advisory-lock connection at `apps/web/src/lib/image-queue.ts:513-520`.
- That connection remains held while the worker reads the row, resolves the original, runs `processImageFormats`, verifies derivative files, and updates DB state: `apps/web/src/lib/image-queue.ts:554-657`.
- It is released only in the `finally` block at `apps/web/src/lib/image-queue.ts:812-815`.
- The in-app color backfill has explicit pool-budget arithmetic and clamps concurrency to preserve live-request headroom: `apps/web/src/lib/admin-backfill-runner.ts:95-141` and `apps/web/src/lib/admin-backfill-runner.ts:667-678`. The foreground upload queue has no equivalent cap.

Failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` for a large import. Eight workers can hold eight of ten pool connections for encode-duration Sharp work. Live gallery/photo requests, login/session checks, public search, admin actions, and the queue's own transient DB updates then compete for two remaining connections and a 20-item wait queue. This can manifest as avoidable request latency or 500/503 responses while CPU and MySQL are otherwise healthy.

Concrete fix:

Do not hold shared-pool advisory-lock connections across image encoding, or cap foreground queue concurrency using the same reserve arithmetic as the backfill runner. A practical fix is a short row-claim transition plus release before Sharp, followed by conditional DB update/cleanup; alternatively use a dedicated small pool for long-held processing locks. Add a regression test proving configured foreground concurrency cannot consume the live pool reserve.

### TRC23-03 - Browser upload quota settlement relies on per-branch comments instead of one idempotent cleanup path

Severity: Medium
Confidence: Medium
Status: Likely future-regression risk

Evidence:

- Browser uploads pre-claim the cumulative tracker synchronously at `apps/web/src/app/actions/images.ts:238-242`.
- Current post-claim awaited checks manually settle on known failure branches: disk pre-check at `apps/web/src/app/actions/images.ts:247-264` and topic lookup at `apps/web/src/app/actions/images.ts:280-292`.
- The code explicitly documents that any future await between claim and final settle must roll back manually: `apps/web/src/app/actions/images.ts:271-279`.
- A per-file cleanup await after the claim is safe only because `deleteOriginalUploadFile` currently swallows unlink errors: `apps/web/src/app/actions/images.ts:536-551`.
- Lightroom upload already uses an idempotent `trackerSettled` closure: `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`, and settles final success at `apps/web/src/app/api/admin/lr/upload/route.ts:473-477`.
- The browser regression lock is source-shape based rather than a behavior test for arbitrary post-claim failure: `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:96-108`.

Failure scenario:

A future validation, DB lookup, metadata step, or cleanup operation is inserted after the browser quota claim and throws before the success/all-failed settlement. The upload-processing lock still releases, but the in-memory upload tracker keeps failed files/bytes charged until the tracking window expires, causing false upload-limit rejections for that admin/IP.

Concrete fix:

Port the Lightroom `trackerSettled` pattern into `uploadImages` and wrap the full post-claim region in a `try/finally` that settles `(0, 0)` if no earlier path settled. Add a behavior test that injects a throw after the claim and asserts the tracker is restored.

### TRC23-04 - Audit retention deletes all expired rows in one unbounded statement

Severity: Low
Confidence: High
Status: Confirmed operational risk

Evidence:

- `purgeOldAuditLog` validates retention input, computes a cutoff, then issues one unbounded delete: `apps/web/src/lib/audit.ts:97-122`.
- The analogous public analytics retention path explicitly batches deletes with `.limit(VIEW_PURGE_BATCH)` and a per-table iteration cap: `apps/web/src/lib/view-retention.ts:31-37` and `apps/web/src/lib/view-retention.ts:64-89`.
- Existing audit-retention tests cover cutoff safety but not bounded delete behavior: `apps/web/src/__tests__/audit-retention.test.ts:52-95`.

Failure scenario:

A long-lived site accumulates a large expired audit backlog. The hourly cleanup can create one large MySQL delete transaction, causing unnecessary lock/undo/redo pressure and delaying admin writes that also insert audit rows. This is not a data-loss bug; it is a boundedness gap in the maintenance path.

Concrete fix:

Mirror `purgeOldViewEvents`: delete expired audit rows in conservative `DELETE ... LIMIT` batches with a max-iteration cap and return/log the deleted count. Add a unit test that proves the audit purge uses bounded deletes.

### TRC23-05 - Upload fallback serving validates a file path, then streams by reopening the pathname

Severity: Low
Confidence: Medium
Status: Manual-validation risk within same-host trust boundary

Evidence:

- `serveUploadFile` validates allowed top-level directories and extensions at `apps/web/src/lib/serve-upload.ts:137-149`.
- It rejects unsafe path segments at `apps/web/src/lib/serve-upload.ts:154-160`.
- It performs `lstat`, rejects symlinks/non-files, resolves realpath, and checks upload-root containment at `apps/web/src/lib/serve-upload.ts:169-184`.
- It builds `Content-Length` and ETag from the earlier `lstat` result at `apps/web/src/lib/serve-upload.ts:216-257`.
- It then streams with `createReadStream(resolvedPath)` and notes that this is not descriptor-backed validation: `apps/web/src/lib/serve-upload.ts:263-269`.
- The admin backup download route uses the stronger descriptor-backed pattern: open, `fileHandle.stat()`, then `fileHandle.createReadStream()` at `apps/web/src/app/api/admin/db/download/route.ts:58-90`.

Failure scenario:

A same-host process with write access to `public/uploads` swaps the target between validation and `createReadStream(resolvedPath)`. The response may stream bytes from a different inode than the one used for validation and ETag/length. In the documented deployment this requires already-trusted host write access, so this is defense-in-depth rather than an unauthenticated web exploit.

Concrete fix:

Use descriptor-backed serving for the fallback route: open the resolved path once, stat the descriptor, verify file type, and stream from the handle. This aligns upload serving with the backup download route and removes pathname-reopen TOCTOU from the serving fallback.

### TRC23-06 - The single-writer runtime topology is documented but not enforced

Severity: Medium
Confidence: Medium
Status: Likely architecture risk requiring deployment validation

Evidence:

- `CLAUDE.md:233-236` says the shipped deployment is single web-instance/single-writer and warns that restore flags, upload quota tracking, queue state, rate-limit maps, and shared-group view-count buffering are process-local.
- Restore maintenance is process-local `globalThis` state: `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota tracking is process-local `globalThis` map state: `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Queue bootstrap runs in every Node process: `apps/web/src/instrumentation.ts:1-6`.
- Shared-group view counts are module-local buffered state: `apps/web/src/lib/data.ts:13-63`.

Failure scenario:

An operator starts a second web process against the same DB/upload tree for availability or a process manager accidentally overlaps old/new instances. Process A begins restore maintenance; process B cannot see A's process-local maintenance flag, upload tracker, queue state, or analytics buffer. B can accept uploads, run queue bootstrap, or buffer analytics during A's restore window, violating restore and filesystem/DB consistency assumptions without any startup failure.

Concrete fix:

Make the topology executable. If GalleryKit remains single-writer, acquire a startup DB advisory lease and fail fast when another writer is active. If multi-process support is intended, move restore state, upload quotas, queue ownership, abuse-relevant rate limits, and buffered analytics to shared durable coordination.

## Confirmed Negative Traces

- Browser and Lightroom upload paths now forward equivalent processing snapshots into the queue. Browser enqueue includes quality, sizes, privacy/color/HDR, alt-text, semantic mode, EXIF, ICC, and color signals at `apps/web/src/app/actions/images.ts:499-531`; Lightroom mirrors the same fields at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- Queue/delete races are fenced: the queue checks the image is still pending before processing at `apps/web/src/lib/image-queue.ts:554-560`, conditionally marks processed at `apps/web/src/lib/image-queue.ts:653-657`, and full-scans variants for cleanup if deletion won at `apps/web/src/lib/image-queue.ts:659-675`.
- Restore now holds the DB restore lock, upload-processing contract lock, color-backfill lock, and semantic-backfill lock before importing at `apps/web/src/app/[locale]/admin/db-actions.ts:388-445`, then flushes shared-group view counts and quiesces the image queue at `apps/web/src/app/[locale]/admin/db-actions.ts:481-485`.
- Semantic search charges before DB-backed mode lookup, enforces same-origin and body-size admission, separates stub/production model versions, and enriches results through the shared privacy-guarded select at `apps/web/src/app/api/search/semantic/route.ts:107-204`, `apps/web/src/app/api/search/semantic/route.ts:263-331`, and `apps/web/src/lib/search-enrichment-fields.ts:29-46`.
- Similar-image search is production-only and scans only production embeddings for processed images at `apps/web/src/app/api/search/similar/[id]/route.ts:110-177`.
- Public share lookup metadata does not perform unthrottled key lookups; rate limiting is enforced in page bodies before DB lookup at `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:36-99` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:41-107`.
- Public view recording validates targets after per-IP rate limiting and writes fire-and-forget analytics only for visible objects at `apps/web/src/app/actions/public.ts:370-390`, `apps/web/src/app/actions/public.ts:397-424`, and `apps/web/src/app/actions/public.ts:428-459`.
- OG routes keep expensive failures charged after protected work, sanitize rendered text, and pin per-photo internal fetches to the canonical origin at `apps/web/src/app/api/og/route.tsx:61-124`, `apps/web/src/app/api/og/photo/[id]/route.tsx:45-128`, and `apps/web/src/lib/og-photo-fetch.ts:64-118`.
- Gallery/SEO settings enforce same-origin/admin/maintenance gates and validated key/value allowlists before upserting at `apps/web/src/app/actions/settings.ts:40-166` and `apps/web/src/app/actions/seo.ts:54-166`.
- Privacy projections remain guarded: sensitive image fields are omitted from public selects and mirrored in the test fixture at `apps/web/src/lib/data.ts:251-327`, `apps/web/src/__tests__/privacy-fields.test.ts:7-45`, and `apps/web/src/__tests__/privacy-fields.test.ts:60-93`.
- Migration journal non-monotonicity is known and compensated by reconcile/baseline/postcondition logic at `apps/web/drizzle/meta/_journal.json:47-58`, `apps/web/scripts/migrate.js:731-785`, and `apps/web/scripts/migrate.js:787-807`.

## Final Missed-Issues Sweep

Final sweep rechecked the highest-risk competing hypotheses: browser/LR upload drift, quota claim leaks, queue/delete orphan variants, foreground/backfill lock behavior, restore side writers, backup download descriptor handling, SQL restore scan/import flow, advisory-lock `BigInt(1)` handling, PAT/session origin and scope gates, public share enumeration, view-count buffer loss, semantic model contamination, semantic body admission ordering, OG SSRF/open redirect fallbacks, upload serving traversal/symlink/TOCTOU, settings-hash drift, privacy-field leaks, migration journal gaps, and stale docs around deployment/runtime topology.

Skipped or intentionally limited:

- I did not manually read binary fixtures, screenshots, generated build output, `.next`, `node_modules`, local upload/data directories, or live production state.
- I did not exhaustively read every historical `plan/**` and older `.context/reviews/**` artifact; I inspected current and adjacent-cycle review evidence plus executable source/tests/docs.
- I did not run full lint, typecheck, build, full Vitest, or Playwright. Only the three custom auth/origin/public-rate-limit scanners were run.

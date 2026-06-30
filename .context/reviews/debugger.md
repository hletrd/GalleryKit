# Debugger Review - Cycle 23

Review role: debugger  
Repository: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-06-30 KST  
Mode: review-only. Intended change scope is this report file only.

## Inventory

Read first, per instruction:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Reviewed active surfaces by inventory and targeted source sweeps, not by sampling one feature only:

- 571 review-relevant TS/TSX/JS/MJS/JSON/SQL files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e`.
- 508 files under `apps/web/src`.
- 244 active implementation/config files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/nginx`.
- App routes/actions/API handlers, auth/origin/rate-limit gates, upload/LR ingest, image queue/backfill, restore/backup, public data projections, migrations/journal, Docker/deploy/nginx config, i18n, public workers, and tests were included in static sweeps and deep reads around failure-prone seams.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 5
- Low: 4

## Findings

### DBG23-01 - Foreground image queue can pin most of the shared DB pool

Severity: Medium  
Confidence: High  
Status: Confirmed operational/runtime risk

Evidence:

- Shared MySQL pool is fixed at 10 connections with queue limit 20: `apps/web/src/db/index.ts:23-33`.
- `QUEUE_CONCURRENCY` can be raised to 8: `apps/web/src/lib/image-queue.ts:87-90`.
- Each job acquires a pooled advisory-lock connection before processing: `apps/web/src/lib/image-queue.ts:513-520`.
- That same job then performs DB checks, original-file resolution, Sharp fan-out, output verification, and DB update while the lock connection remains held: `apps/web/src/lib/image-queue.ts:554-657`.
- The lock connection is released only in `finally`: `apps/web/src/lib/image-queue.ts:812-815`.
- The in-app backfill runner already documents this same pool-starvation class and clamps concurrency against pool budget: `apps/web/src/lib/admin-backfill-runner.ts:96-141`, `apps/web/src/lib/admin-backfill-runner.ts:667-678`.

Failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` during a large upload. Eight encode jobs can hold eight of ten pooled DB connections for encode-duration work, leaving two connections for public pages, auth/session checks, admin actions, semantic search, and the queue's own follow-up queries. With `queueLimit: 20`, this can become 500/503 behavior rather than mere latency.

Concrete fix:

Apply the same pool-budget cap used by `resolveBackfillConcurrency` to foreground queue concurrency, or move encode-duration advisory locks to a dedicated tiny pool/non-pooled connections. Longer term, replace the long-held advisory lock with a short DB lease/claim that releases shared connections before CPU-heavy Sharp work.

### DBG23-02 - Single-writer topology is documented but not enforced

Severity: Medium  
Confidence: High  
Status: Likely architecture/runtime risk; manual deployment validation required

Evidence:

- `CLAUDE.md` says the shipped deployment is single web-instance/single-writer and warns that restore maintenance, upload quotas, queue state, rate-limit buckets, and view buffers are process-local: `CLAUDE.md:233-236`.
- Restore maintenance is `globalThis` state local to one Node process: `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota tracking is a process-local `globalThis` map: `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Queue bootstrap runs in each Node process: `apps/web/src/instrumentation.ts:1-6`.
- Shared-group view counts are buffered in module-local memory: `apps/web/src/lib/data.ts:13-55`.

Failure scenario:

If an operator starts a second web process against the same DB/upload tree, process A can enter restore maintenance while process B continues accepting uploads, bootstrapping queue work, or buffering analytics because it cannot see A's process-local flags. That can race restore with new originals/rows and violate the single-writer integrity assumptions without a startup failure.

Concrete fix:

Make the topology invariant executable. If single-writer remains the product contract, acquire a startup DB advisory lease and fail fast when another writer is active. If multi-process support is desired, move restore state, upload quota tracking, queue ownership, rate limits that matter for abuse, and analytics buffers into shared durable coordination.

### DBG23-03 - Dynamic public first pages still force grouped exact-count queries

Severity: Medium  
Confidence: High  
Status: Confirmed runtime scalability risk

Evidence:

- `getImagesLitePage` joins tags, groups by image id, sorts the full filtered set, and projects `COUNT(*) OVER()` before returning one page: `apps/web/src/lib/data.ts:878-907`.
- Smart-collection first-page offset mode has the same grouped/window-count shape: `apps/web/src/lib/data.ts:1446-1461`.
- Homepage, topic pages, and collection pages are dynamic (`revalidate = 0`) and call those helpers for first render: `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/page.tsx:164-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

Failure scenario:

Crawler or visitor bursts hit the hottest unauthenticated pages on a larger gallery. Each render asks MySQL to evaluate grouped tag aggregation plus an exact window count even though only 30 rows are returned. That can burn DB CPU/temp memory and pool time, then cascade into slow or failed public requests.

Concrete fix:

Split first-page loading into a keyset ID page query plus tag lookup for returned IDs. Remove exact public totals from the hot path or source them from cached/rollup state; use `hasMore` for the browsing UI. Avoid the offset/window-count path for smart collections when the predicate can be expressed cursor-safely.

### DBG23-04 - CSV export buffers the full export in server and browser memory

Severity: Medium  
Confidence: High  
Status: Confirmed runtime memory risk

Evidence:

- The action explicitly materializes up to 50k rows as CSV: `apps/web/src/app/[locale]/admin/db-actions.ts:79-84`.
- It loads the grouped DB result array in one query: `apps/web/src/app/[locale]/admin/db-actions.ts:102-117`.
- It then builds a full `csvLines` array and joins it into one string: `apps/web/src/app/[locale]/admin/db-actions.ts:121-153`.
- The client receives that full server-action string and creates a browser `Blob`: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-124`.

Failure scenario:

An admin exports a large gallery with long filenames/descriptions/tags while public traffic or queue work is active. The server holds the DB result array, CSV line array, joined CSV string, and response payload; the browser duplicates the payload into a Blob. On the disk-constrained/small-host production profile, this can cause GC stalls, request failure, or process memory pressure.

Concrete fix:

Move image CSV export to an authenticated streaming route or background export file. Stream MySQL rows in batches with backpressure and write CSV rows incrementally to the response/file, keeping only a bounded buffer in memory.

### DBG23-05 - Topic slug renames rely on manual fan-out across relational and JSON references

Severity: Medium  
Confidence: High  
Status: Confirmed latent data-integrity risk

Evidence:

- `topics.slug` is the primary key: `apps/web/src/db/schema.ts:4-6`.
- Slug references exist in `topic_aliases.topic_slug`, `images.topic`, and `topic_views.topic`: `apps/web/src/db/schema.ts:14-17`, `apps/web/src/db/schema.ts:19-34`, `apps/web/src/db/schema.ts:239-242`.
- Smart collections store topic references inside JSON query rules: `apps/web/src/db/schema.ts:297-306`.
- Rename is implemented as insert-new/update dependents/remap JSON/delete old: `apps/web/src/app/actions/topics.ts:255-340`.
- The code comments document already-missed sibling failures for `topic_views` cascade deletion and smart-collection JSON remapping: `apps/web/src/app/actions/topics.ts:292-309`.

Failure scenario:

A future table, JSON predicate, cache payload, or integration starts storing topic slugs. The schema compiles, but the manual rename fan-out is not updated. A later slug rename can leave stale references, empty smart collections, analytics loss through cascade, or inconsistent public navigation.

Concrete fix:

Prefer immutable surrogate topic IDs for ownership and keep slug as a unique mutable route field. If that migration is too large, centralize slug referrers in a rename registry/remapper and add tests that fail when a schema/JSON slug reference is added without rename-path support.

### DBG23-06 - Public map can render 10k Leaflet markers plus 10k list items

Severity: Low  
Confidence: High  
Status: Confirmed bounded UI/runtime risk

Evidence:

- Server cap is 10,000 map markers: `apps/web/src/lib/data.ts:1649-1658`.
- Public `/map` is dynamic and serializes all returned markers: `apps/web/src/app/[locale]/(public)/map/page.tsx:9-10`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50`.
- The page renders a normal list item for every marker: `apps/web/src/app/[locale]/(public)/map/page.tsx:77-89`.
- The client computes bounds with spread arrays and renders a `<Marker>`/`<Popup>` subtree for every marker: `apps/web/src/components/map/map-client.tsx:80-90`, `apps/web/src/components/map/map-client.tsx:119-140`.

Failure scenario:

A GPS-heavy gallery near the cap can ship and hydrate 10k markers plus 10k fallback list entries. Mobile browsers can freeze or reload the tab even though the server query is bounded.

Concrete fix:

Use viewport-bounded fetching or clustering/canvas rendering for the map layer, and virtualize or paginate the accessible fallback list. Compute bounds in one loop instead of spreading 10k-element arrays into `Math.min`/`Math.max`.

### DBG23-07 - Audit retention deletes all expired rows in one statement

Severity: Low  
Confidence: High  
Status: Confirmed operational boundedness issue

Evidence:

- `purgeOldAuditLog` validates the cutoff but runs one unbounded delete: `apps/web/src/lib/audit.ts:97-122`.
- Analytics retention uses bounded `DELETE ... LIMIT` batches with an iteration cap: `apps/web/src/lib/view-retention.ts:64-89`.

Failure scenario:

A long-lived site with a large audit backlog runs hourly GC. One large MySQL delete transaction can create avoidable lock, undo, redo, and replication pressure, delaying admin writes that also insert audit events.

Concrete fix:

Mirror `purgeOldViewEvents`: delete audit rows in conservative batches with a per-run cap and return/log the deleted count. Add a test that the retention path emits bounded deletes.

### DBG23-08 - Browser upload quota settlement depends on manually paired cleanup paths

Severity: Low  
Confidence: Medium  
Status: Likely future-regression risk; no current leaking branch confirmed

Evidence:

- Browser uploads pre-claim quota synchronously: `apps/web/src/app/actions/images.ts:238-242`.
- Some post-claim awaits manually roll back the claim on early return or throw: `apps/web/src/app/actions/images.ts:247-264`, `apps/web/src/app/actions/images.ts:280-292`.
- The code relies on an invariant comment that future post-claim awaits must settle on throw: `apps/web/src/app/actions/images.ts:271-279`.
- One post-claim cleanup await is safe only because `deleteOriginalUploadFile` currently never rejects: `apps/web/src/app/actions/images.ts:536-551`.
- Lightroom upload uses an idempotent settlement closure across its post-claim region: `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`.

Failure scenario:

A future validation, DB read, or cleanup step is inserted after the browser claim and throws before the final settlement at `apps/web/src/app/actions/images.ts:595-597`. The upload-processing lock still releases, but the upload tracker keeps the failed files/bytes charged until the tracking window expires, causing false upload-limit rejections for that admin/IP.

Concrete fix:

Port the Lightroom `trackerSettled`/`settleTrackerToActual` pattern into `uploadImages` and wrap the entire post-claim region in a `try/finally` that settles `(0, 0)` if no earlier path settled. Add behavior tests that inject failures after claim and assert tracker state is restored.

### DBG23-09 - Upload fallback serving validates a path and later reopens by pathname

Severity: Low  
Confidence: Medium  
Status: Manual-validation risk within the same-host trust boundary

Evidence:

- `serveUploadFile` validates path segments, `lstat`s, rejects symlinks/non-files, realpath-checks containment, and builds headers from that `lstat`: `apps/web/src/lib/serve-upload.ts:154-184`, `apps/web/src/lib/serve-upload.ts:216-257`.
- It later streams via `createReadStream(resolvedPath)` and notes this is not descriptor-backed validation: `apps/web/src/lib/serve-upload.ts:263-269`.
- The authenticated backup download route uses the stronger descriptor pattern: open once, `fileHandle.stat()`, stream from that handle: `apps/web/src/app/api/admin/db/download/route.ts:58-90`.

Failure scenario:

A same-host process with write access to the upload tree swaps the file after validation but before `createReadStream(resolvedPath)`. The response can stream bytes from a different inode than the one used for ETag/content-length. Under the documented deployment this requires same-host compromise or mispermissioning, so severity is low.

Concrete fix:

Open the validated file once with `fs.promises.open`, call `fileHandle.stat()` on the descriptor, build headers from descriptor stats, and stream with `fileHandle.createReadStream({ autoClose: true })`. Keep the realpath containment check, but ensure served bytes come from the same descriptor that was validated.

## Validation Evidence

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm test --workspace=apps/web -- cycle-22-source-contracts.test.ts audit-retention.test.ts serve-upload.test.ts image-queue-quiesce.test.ts upload-tracker.test.ts migrate-reconcile-coverage.test.ts` - 6 files / 92 tests passed

Additional static sweeps:

- Full active-source inventory under app/scripts/migrations/e2e.
- Auth/origin/rate-limit invariant scanner outputs.
- Grep sweeps for dynamic-code sinks, `dangerouslySetInnerHTML`, lint suppressions, raw SQL, advisory locks, file streaming, deletes, queue/concurrency, retention, and migration/schema interactions.

## Confirmed Non-Findings / Revalidated Areas

- Admin API exports pass the `withAdminAuth` scanner.
- Mutating server actions pass same-origin scanner.
- Public mutating API routes pass rate-limit scanner.
- Typecheck passes for app, tests, and scripts.
- Targeted tests around upload tracker, queue quiescence, serve-upload, audit retention, and migration reconcile coverage pass.
- JSON-LD `dangerouslySetInnerHTML` usages were present in static sweep but are routed through the existing `safeJsonLd`/sanitization pattern in the reviewed public pages; no new XSS finding was confirmed.

## Final Missed-Issues Sweep / Skipped Files

Final sweep covered active app routes, API handlers, server actions, shared libraries, DB schema, queue/backfill, upload serving, restore/backup, migrations/journal, scripts, Docker/nginx/deploy config, i18n, public workers, and relevant tests. No active executable source category was intentionally skipped.

Skipped from manual line-by-line review: `node_modules`, `.next`, `.git`, local upload/data directories, cache folders, binary image/font fixtures, generated screenshots, and historical `.context` plan/review archives not tied to current source behavior. These were either excluded as generated/runtime artifacts or used only as context/inventory, not treated as active executable source.

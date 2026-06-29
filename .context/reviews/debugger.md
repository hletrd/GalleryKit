# Debugger Review - Cycle 12

Scope: latent bug surfaces, failure modes, production-only regressions, async/race behavior, flaky behavior, and edge-case breakage in current `HEAD` of `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read and followed `AGENTS.md`, `CLAUDE.md`, and the `code-review` skill instructions.
- Built inventory before evaluating findings.
- Review-only lane: no implementation fixes, no deletes/reverts of source files.
- Validated behavior from code paths, not comments or tests. Comments/tests were used only to orient or compare intended coverage.
- Wrote this report artifact to `.context/reviews/debugger.md`.

## Inventory

Repository inventory:
- `git ls-files`: 2544 tracked files.
- Review-relevant app/runtime/test/migration inventory: 558 tracked files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/components`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/src/__tests__`.
- Route/action surfaces counted separately: 12 `apps/web/src/app` route/action files, 96 `apps/web/src/lib/*.ts` files, 57 component TS/TSX files.

Examined code regions without sampling:
- Public/admin routes and actions: all API route files under `apps/web/src/app/api`, all public/admin server actions under `apps/web/src/app/actions`, localized public pages, admin dashboard/settings/db pages, share pages, OG routes, feeds, sitemap, and middleware-adjacent request guards.
- Upload/processing/restore: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, and `apps/web/scripts/migrate.js`.
- Search/share/rate-limit state: `apps/web/src/app/actions/public.ts`, semantic/similar search APIs, OG APIs, share pages, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/data.ts`, CLIP embedding helpers, and queue embedding repair paths.
- Data/query surfaces: `apps/web/src/lib/data.ts`, smart collection compiler, validation/sanitize helpers, gallery config, SEO config, session/auth, audit, analytics, and privacy-sensitive field omission paths.
- Operational config: root and web package manifests, `apps/web/next.config.ts`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, deploy/migration scripts, Drizzle migrations/journal.

Excluded from bug claims:
- `node_modules`, `.next`, generated/build output, screenshots, trace artifacts, and historical `.claude/worktrees` copies were not treated as current product behavior.
- Existing `.context/reviews/*` and `.context/plans/*` were read only as review history, not as evidence that current code is correct.

## Findings

### DBG12-01 - Lightroom upload parses large multipart bodies before enforcing the 200 MiB per-file cap

Severity: High
Confidence: High
Status: Likely issue

Code regions:
- `apps/web/src/lib/upload-limits.ts:1-4` defines a 2 GiB rolling upload-byte budget and a separate 200 MiB per-file cap.
- `apps/web/src/app/api/admin/lr/upload/route.ts:85-98` requires `Content-Length` but rejects only when the declared request size exceeds `MAX_TOTAL_UPLOAD_BYTES`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:100-123` pre-claims quota against the 2 GiB rolling byte budget, again without comparing the single request to `MAX_UPLOAD_FILE_BYTES`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:139-152` calls `await request.formData()` before it can inspect `fileEntry.size`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:286-289` hands the already-materialized `File` to `saveOriginalAndGetMetadata`.
- `apps/web/src/lib/process-image.ts:435-439` aliases the per-file cap, and `apps/web/src/lib/process-image.ts:887-890` enforces it only after multipart parsing has completed.
- Browser uploads filter over-limit files before submission at `apps/web/src/components/upload-dropzone.tsx:151-156`; the LR API path lacks the equivalent pre-parse admission check.
- The deployed nginx config gives this route a 216 MiB edge body cap at `apps/web/nginx/default.conf:122-133`, but that is proxy configuration, not an app invariant.

Concrete failure scenario:
An authenticated Lightroom token client, admin-cookie fallback client, direct-to-Node dev client, or misrouted production request sends one multipart body with `Content-Length: 1500000000` and one file field. The route accepts the declared length because it is below `MAX_TOTAL_UPLOAD_BYTES` and pre-claims the quota. It then calls `request.formData()`, forcing Next/undici to materialize the multipart body before the shared 200 MiB guard in `saveOriginalAndGetMetadata` can reject it. Under the documented nginx path the blast radius is mostly capped at 216 MiB, but the route itself advertises a 2 GiB app-level admission window and relies on reverse-proxy correctness for the real cap.

User-visible impact:
A single valid upload credential can cause avoidable memory/disk pressure or process OOM before the app returns the intended "file too large" error. This is a production-only failure if nginx routing changes, a sidecar calls the Node port directly, or another deployment target does not preserve the 216 MiB route cap.

Suggested fix:
Import `MAX_UPLOAD_FILE_BYTES` and reject `declaredUploadBytes > MAX_UPLOAD_FILE_BYTES + SERVER_ACTION_BODY_OVERHEAD_BYTES` before `request.formData()`. After parsing, explicitly reject `fileEntry.size > MAX_UPLOAD_FILE_BYTES` before `saveOriginalAndGetMetadata` so the response is a clean 413/422 and the tracker is settled. Add a route-level regression test that simulates `Content-Length` between 216 MiB and 2 GiB and asserts the body parser is not invoked.

### DBG12-02 - Semantic search can read an oversized body when `Content-Length` is absent but transfer is not chunked

Severity: Medium
Confidence: Medium
Status: Likely issue

Code regions:
- `apps/web/src/app/api/search/semantic/route.ts:93-96` sets an 8192-byte semantic body cap.
- `apps/web/src/app/api/search/semantic/route.ts:135-144` rejects `Transfer-Encoding: chunked`.
- `apps/web/src/app/api/search/semantic/route.ts:146-162` enforces the cap only when `Content-Length` is present.
- `apps/web/src/app/api/search/semantic/route.ts:190-201` pre-increments the in-memory semantic rate limit.
- `apps/web/src/app/api/search/semantic/route.ts:203-214` then calls `await request.text()` and checks `Buffer.byteLength` after the body has already been materialized.
- Default nginx caps generic requests at 2 MiB via `apps/web/nginx/default.conf:29-31`, but `/api/search/semantic` has no route-specific 8 KiB edge cap and direct app access bypasses nginx entirely.

Concrete failure scenario:
An HTTP/2 or direct Node client sends a same-origin-looking semantic search POST without `Content-Length` and without `Transfer-Encoding: chunked`. The route cannot verify the size in the header branch, charges the in-memory rate-limit bucket, and then `request.text()` buffers the full request before the post-read 8192-byte check rejects it. Nginx currently reduces the default proxied case to 2 MiB, but the code path still violates the route's stated pre-parse body budget and direct/internal callers can exceed the intended cap.

User-visible impact:
The semantic endpoint is public and CPU/embedding-adjacent. A small number of overlarge no-length requests can consume request-body memory and tie up the Node process before the route returns 413. The rate limit helps but is process-local and occurs after origin/config checks; it does not make body materialization bounded.

Suggested fix:
Require a valid `Content-Length` for this endpoint, or read the request stream with an incremental byte counter that aborts once `MAX_SEMANTIC_BODY_BYTES` is exceeded. Mirror the 8 KiB cap in nginx with a specific `/api/search/semantic` location if this route remains deployed behind nginx. Add a route test that omits `Content-Length` and proves the handler rejects before body materialization or aborts the stream at the cap.

### DBG12-03 - Several production controls are process-local without a runtime single-process guard

Severity: Medium
Confidence: High
Status: Risk

Code regions:
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota state in a `globalThis` Map, and `apps/web/src/lib/upload-tracker-state.ts:70-78` reports active upload claims from that process-local Map.
- `apps/web/src/lib/rate-limit.ts:84-96`, `apps/web/src/lib/rate-limit.ts:110-119`, and `apps/web/src/lib/rate-limit.ts:349-352` define in-memory maps for OG, share-key lookup, login/search fast paths, admin-token auth, and semantic search. Some paths also write DB buckets, but OG/share/semantic enforcement remains process-local.
- Share-key lookup pages call only the in-memory share limiter before DB lookup: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:28-32` and `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:79-90`; group shares do the same at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:33-37` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:84-90`.
- `apps/web/src/lib/data.ts:18-34` and `apps/web/src/lib/data.ts:49-63` keep shared-group view-count buffering and flush timers in process memory.
- `apps/web/src/lib/image-queue.ts:275-324` keeps the foreground processing queue in a `globalThis` state object. The queue has MySQL advisory locks for per-image processing, but queue scheduling, retry maps, side effects, and bootstrap state are still per process.
- `apps/web/docker-compose.yml:3-27` defines one app service/container, but there is no startup assertion that rejects multiple Node workers, PM2 cluster mode, or accidental horizontal replicas against the same DB/uploads.

Concrete failure scenario:
An operator scales the app to multiple Node processes or containers to absorb traffic, or a platform runs more than one worker per deployment. Each process gets its own upload tracker, semantic/share/OG counters, view-count buffer, and queue scheduler. The effective unauthenticated rate limits multiply by process count, upload rolling quotas can be bypassed by load balancing across workers, buffered group-view increments can be lost on any individual process crash, and multiple queue bootstraps can race around shared files even though per-image advisory locks reduce duplicate final processing.

User-visible impact:
The current documented single-container deployment is consistent with this code, so this is not a confirmed bug in the default topology. It is a latent production regression surface: a normal scaling or process-manager change silently weakens abuse controls and durability guarantees.

Suggested fix:
Add an explicit runtime/deploy guard for the single-process contract, such as refusing startup when a configured `GALLERYKIT_REPLICA_COUNT`/cluster marker indicates more than one active worker unless distributed state is enabled. Longer term, move the remaining in-memory-only public limiters and upload tracker to the existing `rateLimitBuckets` table or another shared store, and make shared-group view counts durable per event or flushed through a shared queue. Keep the MySQL advisory locks for image processing, but document and test the startup guard so accidental scale-out fails closed.

## Final Sweep

Auth/origin/rate-limit:
- Admin API routes inspected use `withAdminAuth(...)`; mutating server actions inspected use `requireSameOriginAdmin()` or a documented public exemption.
- Public mutating/read-expensive surfaces inspected include load-more, text search, semantic search, OG image generation, share lookup pages, and analytics view recording.
- No additional confirmed missing-auth or missing-origin bug was found.

Race/async/resource handling:
- Image processing uses per-image MySQL advisory locks and verifies derivative existence before `processed=true`.
- Restore paths quiesce the queue and use lock/maintenance helpers; no new restore deadlock was confirmed in this pass.
- Shared-group view-count buffering has bounded retry/drop behavior in the current single-process topology; the remaining issue is the process-local deployment contract recorded as DBG12-03.

Data/query/privacy:
- Smart-collection query parsing validates columns/operators/scalar values before compilation.
- Public data selectors inspected omit private/admin-only fields through the existing data-layer projections.
- Keyset pagination paths for home/topic/smart collections were checked for the previously fixed duplicate/lost-row class; no new confirmed pagination bug was found.

Skipped files:
- No current review-relevant source/runtime/config files from the inventory were intentionally skipped.
- Generated dependencies/build artifacts, historical worktrees, and review-plan history were excluded from behavioral claims.

Verification:
- Static/code review only; no fixes were implemented and no test suite was run.
- Fresh command evidence gathered for inventory counts, relevant line-numbered code regions, auth/origin/rate-limit scans, and current git status before writing this artifact.

# Cycle 24 Critic Review

Date: 2026-07-08 KST
Role: `critic`
Review HEAD: `4b43fad7ab471287b82fe5c8dac85c05c511220a`
Scope: comprehensive repository critique across product, architecture, correctness, security, operations, test evidence, documentation, and maintainability. Review-only; no source code edited.

## Inventory Built First

I built a review inventory before assessing findings. Generated/runtime payloads (`node_modules`, `.next`, upload/data/resource output, Playwright artifacts, cache directories) were excluded as non-source. Concurrent uncommitted review-lane files were observed and left untouched.

Relevant categories examined or swept:

- Root control/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`, active/deferred plan registers, and current/prior review artifacts.
- App Router surfaces: all route handlers, public/admin pages, layouts, metadata routes, server actions, and admin DB actions under `apps/web/src/app`.
- Shared source: `apps/web/src/lib` auth/session/PAT, origin/rate-limit, upload/file serving, image processing, queue/backfill, restore, migration helpers, public data projections, smart collections, CSP/JSON-LD/OG, semantic search, service worker helpers, and i18n utilities.
- Data layer: `apps/web/src/db`, all Drizzle migrations and metadata, migration/reconcile scripts.
- UI: public gallery/photo/share/map/search components, admin components, upload/dropzone, navigation, lightbox, histogram, service-worker registration.
- Operations/config: `package.json`, `apps/web/package.json`, `next.config.ts`, Dockerfile, Compose, nginx template, deploy scripts, entrypoint, root scripts.
- Tests: unit/source-contract tests under `apps/web/src/__tests__`, Playwright specs under `apps/web/e2e`, and lint guard scripts.

Validation I ran:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Static sweeps checked route-handler guards, `dangerouslySetInnerHTML`/JSON-LD sinks, raw SQL patterns, TODO/FIXME risk markers, skipped/focused tests, service-worker drift, migration journal behavior, and plan/deferred provenance.

Full `lint`, `typecheck`, `build`, and `npm test` were not rerun by this critic lane; this is a review artifact, not a release verification artifact.

## Confirmed Issues

### CRIT24-01 - Cycle 24 has no active plan/register entry while the plan index still points at Cycle 23

- Severity: Medium
- Confidence: High
- Status: Confirmed documentation/provenance issue
- Region: `.context/plans/README.md:34-38`, `.context/plans/README.md:46-56`, `.context/plans/cycle-23-2026-07-08-plan.md:1-7`.

Why this is a problem:
The user invocation and current review files are for Cycle 24, but the plan index still lists Run-10 Cycle 23 as the active current-cycle plan/deferred pair at `.context/plans/README.md:34-38`. The same README later treats Cycle 22 and earlier cycles as recently completed, but there is no Cycle 24 active slot. The Cycle 23 plan also still says `Status: IMPLEMENTED - GATES PASSED; PUSH/DEPLOY PENDING` at `cycle-23-2026-07-08-plan.md:3`, while current HEAD is beyond the Cycle 23 fix lineage.

Concrete failure scenario:
A later planner or verifier follows `.context/plans/README.md` as instructed, treats Cycle 23 as still active, and schedules stale push/deploy/provenance work instead of consuming the Cycle 24 review aggregate. This weakens the review-plan-fix loop's main safety property: each cycle should have one clear current ledger and one clear deferred register.

Suggested fix:
Move Cycle 23 to recently completed with its final commit/push/deploy evidence or explicit supersession statement, then create/update the Cycle 24 active plan/deferred entries. Add a small plan-index consistency check that fails when current review artifacts mention a newer cycle than the active section.

### CRIT24-02 - The carry-forward age register is internally stale, weakening the 8-cycle and 16-cycle budget rules

- Severity: Medium
- Confidence: High
- Status: Confirmed documentation/provenance issue
- Region: `.context/plans/deferred-carry-forward.md:3-7`, `.context/plans/deferred-carry-forward.md:19-27`, `.context/plans/deferred-carry-forward.md:87-90`, `.context/plans/deferred-carry-forward.md:185-220`, `.context/plans/deferred-carry-forward.md:249-260`.

Why this is a problem:
The register says it must be updated every cycle at `.context/plans/deferred-carry-forward.md:6-7`, and its latest prose says the age-budget check is for run-10 Cycle 23 at lines 19-27. The table header still says `Age @ r10c21` at lines 87-90, while the table includes Cycle 23 rows at lines 249-256. Older rows also remain under-aged relative to Cycle 24; for example Cycle 20 rows are still age `1` at lines 196-220 even though the repo has progressed through Cycle 21, 22, 23, and now 24 review work.

Concrete failure scenario:
A deferred High finding crosses the 8-cycle scheduling threshold, but the stale age column makes it look younger. The planner then re-lists it without the required schedule/reclassify decision, allowing serious architectural or operational debt to evade the loop's explicit budget.

Suggested fix:
Refresh the register to a single `Age @ r10c24` basis, update every row's age, and add a mechanical check that the header/current-cycle note and newest cycle rows agree. Prefer deriving ages from first-deferred cycle metadata instead of manually editing many table cells.

### CRIT24-03 - Browser and Lightroom upload ingestion still duplicate the same critical pipeline

- Severity: Medium
- Confidence: High
- Status: Confirmed maintainability/architecture issue
- Region: `apps/web/src/app/actions/images.ts:87-610`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-633`, `.context/plans/deferred-carry-forward.md:249-251`.

Why this is a problem:
The browser upload action and Lightroom token route each implement their own full ingest pipeline: restore fencing, upload-processing contract lock, quota claim/settle, topic validation, config snapshot, disk preflight, original save, HDR/GPS gates, EXIF/color extraction, image insert shape, queue job shape, audit, and revalidation. The LR route contains repeated parity comments pointing back to the browser path, including filename parity at `route.ts:204-211`, disk-space parity at `route.ts:327-340`, HDR parity at `route.ts:398-407`, GPS parity at `route.ts:421-427`, and queue-setting parity at `route.ts:560-586`. The carry-forward register also keeps this class open as Cycle 23 High rows at `.context/plans/deferred-carry-forward.md:249-251`.

Concrete failure scenario:
A future privacy or color-pipeline column is added to the browser path's insert/enqueue block at `apps/web/src/app/actions/images.ts:397-516`, but the parallel LR payload at `apps/web/src/app/api/admin/lr/upload/route.ts:454-587` is missed. Browser uploads then record the new setting while API-token uploads silently omit it, producing inconsistent public behavior until another review finds the drift or a backfill repairs rows.

Suggested fix:
Extract a shared ingest service after route-specific auth/form parsing. That service should own config snapshotting, topic verification, disk preflight, original save, HDR/GPS policy, EXIF/color normalization, insert value construction, queue job construction, and post-commit bookkeeping inputs. Keep the browser action and LR route as adapters for auth, localization/error shaping, and HTTP status. Add behavior tests proving both adapters produce the same insert/enqueue contract for representative JPEG, HDR-rejected, GPS-stripped, RAW-rejected, and processing-setting cases.

## Likely Issues

### CRIT24-04 - Background DB/CPU budgets are local to each subsystem, not global to the host

- Severity: Medium
- Confidence: Medium
- Status: Likely architecture/availability issue; needs load evidence for live impact
- Region: `apps/web/src/db/index.ts:21-42`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/clip-model.ts:53-72`.

Why this is a problem:
The DB pool is fixed at 10 connections with queue limit 20 (`db/index.ts:31-42`). The image queue reserves about half the pool and caps itself independently (`image-queue.ts:121-153`). The admin backfill runner independently reserves about half the pool and can pin one advisory-lock connection plus two connections per worker (`admin-backfill-runner.ts:113-125`). CLIP inference has a separate in-process concurrency queue up to 4 slots (`clip-model.ts:53-72`). Each subsystem is reasonable alone, but the repository does not define a shared background budget when queue work, backfill, semantic scans, and CLIP inference overlap.

Concrete failure scenario:
An operator starts a color/semantic backfill while uploads are still being processed and visitors issue semantic/similar searches. Backfill can pin up to 5 DB connections, the image queue can pin several more, and public/admin requests still need transient DB connections. The pool queues or times out requests even though every lane locally "reserved" live headroom. CPU/RAM pressure from CLIP inference can compound the latency spike because it is budgeted separately from DB work.

Suggested fix:
Introduce a shared background permit system for DB-pinning work, or make queue/backfill concurrency mutually aware. As a minimal fix, reduce queue concurrency while backfill is active and vice versa. Validate with a combined stress test covering uploads, image queue processing, admin backfill, semantic search, and normal photo-page traffic before raising any concurrency defaults.

### CRIT24-05 - Local E2E evidence can look green while authenticated admin/browser coverage is skipped

- Severity: Low-Medium
- Confidence: High
- Status: Likely test-evidence issue
- Region: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:27-31`, `apps/web/e2e/origin-guard.spec.ts:55-73`, `apps/web/package.json:21-23`.

Why this is a problem:
The default `test:e2e` script at `apps/web/package.json:21` runs all Playwright specs, but admin workflows are skipped unless `E2E_ADMIN_ENABLED=true` (`admin.spec.ts:11-13`). The origin-guard suite only proves authenticated cross-origin rejection when admin E2E credentials are configured (`origin-guard.spec.ts:55-73`), and local runs explicitly skip the CI credential assertion (`origin-guard.spec.ts:27-31`, `admin.spec.ts:6-9`). This is intentional, but it makes "e2e passed" an ambiguous evidence claim unless the exact env and skip summary are recorded.

Concrete failure scenario:
A cycle report states `npm run test:e2e` passed from a local run. The admin login, admin navigation, authenticated origin-guard, upload/settings, and restore-adjacent browser paths may all have been skipped, so a regression in those flows ships with a green-looking browser gate.

Suggested fix:
Require release/provenance notes to distinguish default public E2E from `npm run test:e2e:admin` at `apps/web/package.json:22`. Add a small reporter/check that fails when admin specs are skipped in a release-designated environment, or writes an explicit `admin_e2e_skipped=true` artifact that planners cannot miss.

## Risks Needing Manual Validation

### CRIT24-06 - Proxy topology and public SSR edge limiting remain deployment assumptions, not repo-proven guarantees

- Severity: Low-Medium
- Confidence: Medium
- Status: Risk needing manual validation
- Region: `apps/web/docker-compose.yml:15-22`, `apps/web/nginx/default.conf:52-71`, `apps/web/nginx/default.conf:274-295`, `apps/web/src/lib/rate-limit.ts:175-216`, `scripts/check-proxy-topology.mjs:7-17`, `scripts/check-proxy-topology.mjs:131-134`.

Why this is a problem:
The container runs on host networking and sets `TRUST_PROXY=true` while depending on host nginx for rate limiting/security headers (`docker-compose.yml:15-22`). The nginx template explicitly warns that its X-Forwarded-For overwrite mode is correct only for certain topologies and collapses all app-side per-IP limits into one bucket if an upstream LB is the real peer (`nginx/default.conf:59-71`). The public SSR limiter lives in nginx and must be manually applied/reloaded (`nginx/default.conf:274-295`). The provided topology checker is useful, but it explicitly says it does not verify effective client-IP buckets or XFF overwrite behavior (`scripts/check-proxy-topology.mjs:12-17`, `131-134`).

Concrete failure scenario:
Production sits behind a CDN/LB that connects to nginx from one private address, but nginx overwrites `X-Forwarded-For` with `$remote_addr`. The app sees the LB as every visitor, so one abusive client can consume login/search/share/OG rate limits for everyone. If the nginx template was not applied, public SSR pages also lose the documented edge flood backstop.

Suggested fix:
Add a deployment validation runbook/artifact that captures `nginx -T`, confirms the public `location /` limiter is active, and proves two distinct external clients map to distinct app-side client keys. If an upstream LB exists, use append-mode XFF plus the correct `TRUSTED_PROXY_HOPS`, or configure `real_ip` before overwrite-mode headers.

## No Confirmed Runtime Security/Correctness Defect Found

I did not confirm a new source-level auth bypass, SQL injection, XSS, path traversal, restore write race, public PII leak, upload cleanup leak, or route-handler guard omission in this pass.

Evidence from the sweep:

- Admin API routes are guarded by `withAdminAuth`, and `lint:api-auth` passed.
- Mutating server actions enforce same-origin provenance or documented exemptions, and `lint:action-origin` passed.
- Public mutating/expensive route handlers use pre-increment rate-limit helpers or approved exemptions, and `lint:public-route-rate-limit` passed.
- Public JSON-LD sinks use `safeJsonLd`; the remaining inline script path is the Google Analytics ID path using JSON stringification.
- Public field projections have compile-time privacy guards, and map GPS exposure is constrained by map-visible topic filtering.
- Semantic/similar search routes enforce same-origin, content-type/size or id validation, restore maintenance guards, and rate-limit ordering before DB/embedding work.
- Restore/backup code has advisory locks, durable maintenance markers, bounded drain stages, SQL scan checks, dump header/trailer checks, and post-restore cleanup hooks.
- Drizzle migration reconciliation has explicit guards for historical non-monotonic journal entries and post-condition hash coverage.

## Final Sweep

File categories examined:

- App pages/layouts/routes/actions, admin DB actions, public metadata routes, upload serving, semantic/OG/feed routes.
- Shared libraries for auth/session/PAT, origin/rate limiting, data projection, uploads, image processing, queue/backfill, restore, migrations, smart collections, CSP/JSON-LD/OG, service worker, and config.
- DB schema, migrations, migration metadata, and migration/reconcile scripts.
- Components for public gallery/photo/share/map/search, admin tables/forms, upload dropzone, navigation, lightbox, histogram, and service-worker registration.
- Tests and guard scripts, including unit/source-contract tests and Playwright specs.
- Operational files: Dockerfile, Compose, nginx, deploy scripts, entrypoint, package scripts, env examples, and plan/review docs.

Common missed issue classes checked:

- Admin API exports missing auth wrappers.
- Mutating server actions admitted without same-origin or restore-mutation barriers.
- Public route handlers doing mutation/expensive work without rate limits.
- PII/internal fields leaking through public selects, map/search/timeline/feed helpers, or JSON-LD.
- Unsafe raw SQL interpolation, `dangerouslySetInnerHTML`, open redirects, SSRF-adjacent fetches, and CSP nonce gaps.
- Upload quota claim leaks, orphaned originals, GPS/HDR policy drift, and browser/LR ingest divergence.
- Restore windows clearing maintenance before drains/revocations/pending file deletions complete.
- Migration journal skip/drift and reconcile/baseline mismatch.
- Service-worker cache privacy, revocable-page caching, and generated `sw.js` template drift.
- E2E skip/focus markers and ambiguous release evidence.

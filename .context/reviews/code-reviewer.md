# Cycle 24 Code Reviewer Report

Date: 2026-07-08 KST
Review HEAD: `0f3e48e044bf0e6a8019f8910dd649d706a9e91b`
Role: code-reviewer lane
Scope: full repository review from code quality, logic, SOLID, maintainability, cross-file correctness, data flow, and edge-case angles. No source code was edited.

## Inventory Built

Review-relevant inventory, excluding generated/runtime payloads (`node_modules`, `.next`, `test-results`, upload/resource/data directories), contained 3,957 files.

High-risk categories examined:

- App Router pages, layouts, route handlers, and server actions under `apps/web/src/app` (80 files).
- UI components under `apps/web/src/components` (61 files).
- Shared libraries under `apps/web/src/lib` (115 files), with deep reads of upload, auth, restore, queue, semantic search, image processing, data projection, privacy, and cache paths.
- Database schema and connection layer under `apps/web/src/db` (3 files).
- Drizzle migrations and metadata under `apps/web/drizzle` (31 files).
- Operational scripts under `apps/web/scripts` (28 files).
- Unit and e2e tests under `apps/web/src/__tests__` and `apps/web/e2e` (373 files total).
- Root/package/deploy/config docs and plans, including `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, current cycle plan/deferred files, Docker, Compose, Next config, and deploy scripts.

Current validation evidence:

- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `git diff --check` passed.

## Confirmed Issues

### CR24-01: Browser and Lightroom upload ingestion still duplicate the same critical pipeline

Severity: Medium
Confidence: High
Status: Confirmed maintainability issue

Code region:

- `apps/web/src/app/actions/images.ts:87-610`
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-633`

The browser upload action and Lightroom token route each implement their own full ingest pipeline: restore maintenance fencing, upload processing contract locking, quota claim/settle, topic validation, config snapshotting, disk preflight, original save, HDR/GPS policy, EXIF/color extraction, image insert shape, queue job shape, audit, and revalidation. The LR route contains many comments explicitly documenting fixes made to "mirror the browser path" (`route.ts:204-211`, `route.ts:327-340`, `route.ts:398-407`, `route.ts:421-427`, `route.ts:560-586`), which is evidence that parity has already drifted multiple times and had to be patched manually.

Why this is a problem:

The current behavior appears intentionally aligned now, but the design relies on future contributors remembering to update two large, independently ordered implementations whenever upload policy changes. The duplicated insert and enqueue payloads are especially risky because they carry privacy, color/HDR, processing settings, and audit semantics.

Concrete failure scenario:

A future change adds a new admin upload-time processing setting or a new admin-only metadata column to the browser path's `insertValues` / `enqueueImageProcessing` payload (`images.ts:397-516`) but misses the LR route's parallel payload (`route.ts:454-587`). Browser uploads then honor the setting while LR publishes do not, producing rows with inconsistent processing snapshots or missing privacy-relevant metadata until a later backfill.

Suggested fix:

Extract a shared ingest service that starts after route-specific authentication/form parsing and owns: config snapshot, topic verification, disk preflight contract, original save, HDR/GPS gates, EXIF/color metadata normalization, image insert value construction, queue job construction, and post-commit bookkeeping inputs. Keep the server action and LR route as thin adapters for auth, request parsing, localization/error shaping, and response status. Add parity tests that assert browser and LR adapters produce the same insert/enqueue contract for representative JPEG, HDR-rejected, GPS-stripped, and RAW-rejected cases.

### CR24-02: `lib/data.ts` mixes analytics buffering, public privacy contracts, listing, search, sitemap, and map queries in one 1,897-line module

Severity: Low
Confidence: High
Status: Confirmed maintainability issue

Code region:

- `apps/web/src/lib/data.ts:13-249` implements shared-group view-count buffering and flushing.
- `apps/web/src/lib/data.ts:251-506` defines admin/public/map select fields plus privacy guards.
- `apps/web/src/lib/data.ts:514-1820` implements topic accessors, listing pagination, feed/sitemap helpers, search, map queries, and cached exports.

Why this is a problem:

The module now owns unrelated responsibilities with different failure modes: side-effecting analytics writes, data-projection privacy policy, public query composition, SEO/feed helpers, search result shaping, and map GPS exposure. The project has strong local guards, but the file's size and responsibility mix make future cross-file review harder and increase the chance that a change meant for one surface accidentally affects another.

Concrete failure scenario:

A contributor adding a new public listing/search field works in the same file as the canonical privacy omit blocks and may update one projection but miss a sibling projection or query helper. The compile-time guards reduce the chance of a sensitive-key leak (`data.ts:458-488`, `data.ts:1616-1626`), but the reviewer still has to reason across a long module containing analytics side effects and multiple public result shapes.

Suggested fix:

Split by responsibility while preserving exported APIs: for example `data/select-fields.ts` for admin/public/map field contracts and type guards, `data/listings.ts` for gallery pagination, `data/search.ts` for search result queries, `data/map.ts` for GPS/map-visible queries, `data/feed.ts` for feed/sitemap helpers, and `data/view-counts.ts` for the shared-group analytics buffer. Move tests with the contracts they protect, especially the privacy guard fixtures.

## Risks Needing Manual Validation

### CR24-03: Background DB/CPU budgets are calculated independently and can over-subscribe the shared host under combined load

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/db/index.ts:21-42`
- `apps/web/src/lib/image-queue.ts:121-153`
- `apps/web/src/lib/admin-backfill-runner.ts:97-143`
- `apps/web/src/lib/clip-model.ts:53-72`

The DB pool is fixed at 10 connections with a queue limit of 20 (`db/index.ts:31-42`). The image queue independently reserves about half the pool for live traffic and caps itself at 2 workers on the default pool (`image-queue.ts:121-153`). The admin backfill runner uses similar independent arithmetic and also caps itself at 2 workers while holding one whole-run advisory-lock connection (`admin-backfill-runner.ts:97-143`). CLIP inference has a separate in-process queue and up to 4 inference slots (`clip-model.ts:53-72`).

Why this is a problem:

Each subsystem's local budget is sensible in isolation, but none of the caps accounts for the other background subsystem already running. Queue workers, backfill workers, semantic scans, and CLIP inference can overlap on the same process and database pool. The comments in `db/index.ts:21-30` and `admin-backfill-runner.ts:113-125` reason about one background lane at a time, not combined queue plus backfill plus semantic traffic.

Concrete failure scenario:

An operator starts an admin color/semantic backfill while uploads are still processing and visitors issue semantic/similar searches. Backfill can pin up to 5 DB connections, image queue can pin up to 4 more, and live/semantic requests still need transient connections. The pool can queue or timeout requests even though each lane individually believes it reserved live headroom. In the same window, CLIP inference can consume CPU/RAM independently of the DB pool cap, raising latency further.

Suggested fix:

Introduce a shared background resource budget for DB-pinning work, or make backfill and queue concurrency mutually aware. A minimal step is to drop image queue concurrency while an admin backfill is active, or make both lanes acquire permits from a common semaphore whose capacity is derived once from `POOL_CONNECTION_LIMIT`. Validate with a stress test or production trace that combines uploads, backfill, semantic search, and normal photo-page requests before raising any concurrency defaults.

## Docs / Source Mismatches

### CR24-04: Cycle 23 plan index still marks Cycle 23 active/pending even though the fix commit is current HEAD history

Severity: Low
Confidence: High
Status: Confirmed docs/source mismatch

Code region:

- `.context/plans/cycle-23-2026-07-08-plan.md:1-7`
- `.context/plans/README.md:34-38`

The Cycle 23 implementation plan says `Status: IMPLEMENTED - GATES PASSED; PUSH/DEPLOY PENDING` (`cycle-23-2026-07-08-plan.md:3`), and the plan index still lists Cycle 23 under "Active Current-Cycle Plans" (`README.md:34-38`). Current git history is already at `0f3e48e0 fix(cycle23): harden restore and review findings`, so the docs no longer match the committed source state.

Why this is a problem:

This is not a runtime code defect, but it can mislead later review-plan-fix lanes. Agents may re-plan already committed Cycle 23 work, misclassify deferred findings as the active cycle, or assume push/deploy evidence is still pending when the repository has advanced to Cycle 24.

Concrete failure scenario:

A later planner reads only `.context/plans/README.md:34-38`, treats Cycle 23 as the active implementation ledger, and schedules duplicate work or stale deploy verification instead of using Cycle 24's review aggregate as the current source of truth.

Suggested fix:

Update the plan index and Cycle 23 plan status after the orchestrator records final push/deploy evidence, moving Cycle 23 into the recently completed section and making the current Cycle 24 artifacts the active ledger.

## No Confirmed Runtime / Security Defects Found

I did not find a new confirmed runtime correctness, auth, privacy, SQL-injection, restore-race, or upload-cleanup defect in this cycle.

Evidence from the sweep:

- Admin API route exports are guarded by `withAdminAuth`, confirmed by `lint:api-auth`.
- Mutating server actions enforce same-origin provenance or carry explicit approved exemptions, confirmed by `lint:action-origin`.
- Public mutating/expensive route handlers have pre-increment rate-limit coverage or explicit approved exemptions, confirmed by `lint:public-route-rate-limit`.
- Public JSON-LD call sites use safe serialization helpers in the public home/topic/photo pages.
- Public field projections have compile-time privacy guards, and public map GPS exposure is constrained to `map_visible` topics with a runtime assertion.
- Restore maintenance paths keep mutation fencing, strict session revocation flushing, queue pause/resume, and pending-file-deletion drainage in the expected order.
- Drizzle migration metadata and `migrate.js` reconciliation mirror the pending-file-deletion table shape.
- Route handlers touching filesystem/database paths are pinned to Node runtime where required.
- Searches for `.only`, broad type escapes in non-test source, raw SQL string assembly, `dangerouslySetInnerHTML`, and unchecked public projections did not reveal a new actionable defect.

## Final Sweep

File categories examined:

- Source: App Router pages/routes/actions, components, shared libraries, DB schema/connection, image processing, queue/backfill, auth/session, restore, semantic search, service-worker registration, and public data projection paths.
- Tests: unit privacy/auth/restore/upload/search/action-origin/rate-limit tests and e2e admin/public/origin flows.
- Operations: Dockerfile, Compose, deploy scripts, migration scripts, package scripts, Next config, and lint guard scripts.
- Documentation/plans: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, active/deferred cycle ledgers, and prior review artifact.

Common missed issue classes checked:

- Admin API exports missing auth wrappers.
- Mutating server actions admitted without same-origin guards.
- Public route handlers missing rate-limit pre-increment gates.
- PII/internal fields leaking through public selects, map selects, search results, timeline/feed helpers, or JSON-LD.
- Unsafe raw SQL interpolation and `dangerouslySetInnerHTML` usage.
- Restore maintenance windows admitting writes or clearing maintenance before required drains.
- Upload quota claims leaking on early exits, saved originals orphaning on DB failures, and browser/LR ingest drift.
- DB route handlers accidentally running on Edge runtime.
- Test focus markers (`.only`) and broad non-test `any` escapes.
- Generated/runtime payload directories were excluded from manual review as non-source artifacts.

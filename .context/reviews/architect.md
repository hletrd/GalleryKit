# Cycle 21 Architect Review

Target HEAD: `45b32d1db373e03d82a29511f53832051c770880`

Scope: repository-wide architectural/design risk review for coupling, layering, boundaries, invariants, operational topology, data lifecycle, and evolution hazards. I read `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md` before reviewing source.

## Architecture Inventory

### App Routes, Actions, Components

- Public app routes under `apps/web/src/app/[locale]/(public)/`: home, topic, photo detail, share key, shared group, smart collection, map, timeline, year, localized layout/loading/privacy/about, topic feed, and upload entry. The public page surface is intentionally dynamic (`revalidate = 0`) across home/topic/photo/map/timeline/year/share/group/collection.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected dashboard/categories/tags/users/tokens/settings/seo/password/db/analytics pages and page clients.
- Server actions under `apps/web/src/app/actions/`: `admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`; root `actions.ts` is a barrel.
- Admin DB action boundary: `apps/web/src/app/[locale]/admin/db-actions.ts`.
- API routes: admin DB download, Lightroom upload, live/health, OG images, semantic/similar search, upload, robots/sitemap/feed/manifest/icons.
- Components under `apps/web/src/components/`: admin UI clients, gallery/photo rendering, upload controls, public maintenance, color/HDR details, map/timeline/share widgets, SW/PWA surfaces, and UI primitives.

### Lib Subsystems

- Data/query boundary: `apps/web/src/lib/data.ts`, `data-gallery.ts`, `data-timeline.ts`, `data-years.ts`, `map-data.ts`, `smart-collections.ts`.
- Auth/session/admin boundary: `auth.ts`, `session.ts`, `admin-tokens.ts`, `action-guards.ts`, `admin-mutation-barrier.ts`, `pending-session-revocations.ts`.
- Upload/image lifecycle: `upload-paths.ts`, `process-image.ts`, `image-queue.ts`, `upload-limits.ts`, `image-quality.ts`, `storage/*`, `serve-upload.ts`.
- Color/HDR/semantic: `color-detection.ts`, `color-settings.ts`, `admin-backfill-runner.ts`, `clip-model.ts`, `embeddings.ts`, `image-embeddings.ts`, `semantic-search.ts`.
- Restore/operations: `restore-maintenance.ts`, `restore-maintenance-durable.ts`, `restore-drain-checklist.ts`, `single-writer-guard.ts`, `advisory-locks.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `rate-limit.ts`.
- Public/security/i18n: `content-security-policy.ts`, `csrf.ts`, `public-origin.ts`, `viewer-mode.ts`, `sw-cache.ts`, `metadata.ts`, `navigation.ts`.

### DB Schema, Migrations, Scripts, Deploy, Tests, Docs

- DB schema: `apps/web/src/db/schema.ts`, `index.ts`, `seed.ts`.
- Drizzle migrations: `apps/web/drizzle/0000_*.sql` through `0029_*.sql`, `meta/_journal.json`, and generated snapshots.
- Operational scripts: migration/reconcile (`scripts/migrate.js`), MySQL option helpers, backfills for color/CLIP/alt text, SW build, route/action/rate-limit lint scanners, restore-maintenance recovery, E2E seed/cleanup helpers.
- Deploy/topology: `apps/web/Dockerfile`, `docker-compose.yml`, `deploy.sh`, `nginx/default.conf`.
- Tests: Vitest tests under `apps/web/src/__tests__/` covering privacy fields, restore drains, advisory locks, action origin/auth, image queue, backfill contracts, rate limits, upload/delete behavior, UI audits; Playwright specs under `apps/web/e2e/`.
- Docs/plans: `CLAUDE.md`, `README.md`, `.context/plans/README.md`, active `.context/plans/run-10-cycle-20.md`, historical plan/review carry-forward directories, and operator notes in `docs/`.

## Confirmed Architectural Defects

### A1. Image deletion can leave public files orphaned after returning success

Severity: High
Confidence: High
Files/regions:

- `apps/web/src/app/actions/images.ts:719-756`
- `apps/web/src/lib/upload-paths.ts:101-117`
- `apps/web/src/lib/process-image.ts:621-640`
- `apps/web/next.config.ts:60-77`
- `apps/web/nginx/default.conf:210-226`

The delete action removes DB rows first, then attempts file cleanup afterward. Cleanup failures are logged, but the action still returns `{ success: true, cleanupFailureCount }` (`images.ts:747-756`). Strict cleanup helpers correctly throw on non-ENOENT failures (`upload-paths.ts:101-117`, `process-image.ts:628-640`), but there is no durable cleanup ledger or retry path once the DB row is gone.

Concrete failure scenario: an admin deletes a private photo while the filesystem is transiently read-only or a derivative file has permission drift. The DB row is gone, shared paths are revalidated, and the UI reports success. The original or public derivative remains on disk. Existing derivatives under `/public/uploads` are intentionally served as static/public assets with cache headers (`next.config.ts:60-77`) and proxied by nginx (`nginx/default.conf:210-226`), so a known URL can continue to fetch stale content even though the application has lost the row needed to clean it later.

Suggested fix: introduce a durable deletion outbox/tombstone. Mark the image as `deleting` or write `pending_file_deletions` before removing the row, retry cleanup until every file is gone, and make admin success depend on the durable deletion state rather than best-effort unlink completion. For public derivatives, either move served files out of `public/` behind an app-controlled handler that can honor tombstones, or ensure deletion/tombstone checks happen before any static serving path can return bytes.

### A2. Background image queue and admin backfill budgets can overcommit the DB pool together

Severity: High
Confidence: High
Files/regions:

- `apps/web/src/lib/image-queue.ts:121-153`
- `apps/web/src/lib/admin-backfill-runner.ts:106-142`
- `apps/web/src/lib/admin-backfill-runner.ts:393-431`
- `apps/web/src/lib/advisory-locks.ts:38-49`

The image queue and in-app admin backfill each compute their own safe concurrency against the same process DB pool. The image queue reserves half the pool and caps workers (`image-queue.ts:121-153`); the backfill runner independently reserves half the pool plus one whole-run advisory lock (`admin-backfill-runner.ts:106-142`). Those formulas are safe in isolation, but there is no shared semaphore or exclusive background-processing budget. Backfills serialize only other backfills (`LOCK_COLOR_PIPELINE_BACKFILL`, `LOCK_SEMANTIC_EMBEDDING_BACKFILL`), while queue workers use per-image processing claims (`advisory-locks.ts:38-49`).

Concrete failure scenario: uploads are actively processing at effective queue concurrency 2 on the default 10-connection pool while an admin starts the in-app color re-encode, also clamped to 2. The two systems can pin advisory-lock connections plus transient update/query connections at the same time. Live dynamic pages, which already issue multi-query fan-outs, can queue behind encode-duration work and fail or time out during an operator maintenance window.

Suggested fix: create one shared background DB/CPU budget used by `image-queue.ts`, `admin-backfill-runner.ts`, and sidecar backfill entry points. Either use a process-local weighted semaphore plus advisory operation locks, or make in-app backfill acquire an exclusive "background image processing" lock that pauses the upload queue. Add a contract test asserting the combined maximum background connection claim cannot exceed the live-reserved budget.

### A3. Pipeline backfill selection has no supporting index

Severity: Medium
Confidence: High
Files/regions:

- `apps/web/src/db/schema.ts:82-131`
- `apps/web/src/lib/admin-backfill-runner.ts:393-431`
- `apps/web/scripts/backfill-color-pipeline.ts:373-379`

`images.pipeline_version` is the central idempotency marker for pipeline migrations (`schema.ts:82-83`), but the `images` table indexes do not include `pipeline_version` or a composite matching the backfill predicates (`schema.ts:123-131`). Both in-app and sidecar backfills count and fetch candidates with `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT)` (`admin-backfill-runner.ts:393-431`, `backfill-color-pipeline.ts:373-379`).

Concrete failure scenario: a mature gallery with hundreds of thousands of processed rows upgrades the image pipeline. The backfill status/count and every keyset batch evaluate a low-selectivity predicate without a matching index. On MySQL this can degrade into repeated large scans during an already CPU-heavy maintenance operation, increasing lock wait and pool pressure for public page traffic.

Suggested fix: add a migration and journal entry for an index shaped for candidate discovery, for example `(processed, pipeline_version, id)` or a generated/stored candidate marker if MySQL optimizer behavior around `IS NULL OR <` is poor. Include an EXPLAIN-based script/test fixture or source contract that backfill predicates remain indexable.

## Risks Needing Product or Operator Decision

### R1. In-app backup/restore is database-only while the data model references mutable filesystem state

Severity: High
Confidence: High
Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:420-715`
- `apps/web/src/app/[locale]/admin/db-actions.ts:717-955`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:177-245`
- `apps/web/messages/en.json:21-26`
- `apps/web/docker-compose.yml:24-32`
- `apps/web/src/app/actions/images.ts:377-527`

The restore path is careful about DB-level invariants: it takes restore/upload/backfill locks, starts durable maintenance, drains process-local writers, imports SQL through `mysql`, then runs post-restore migrations (`db-actions.ts:420-715`, `717-955`). The UI now warns that backup/restore covers database rows only and leaves files unchanged (`db/page.tsx:177-245`, `messages/en.json:21-26`). The operational topology stores originals, derivatives, and resources in separate bind mounts (`docker-compose.yml:24-32`), while uploads write original files before inserting DB rows and enqueueing derivative processing (`images.ts:377-527`).

Concrete failure scenario: an operator restores a DB dump from Monday after deleting photos on Tuesday. Rows for those photos are reintroduced, but originals/derivatives may already be gone. The inverse also happens: files uploaded after the dump remain on disk after restore but have no rows. The app has maintenance fences for SQL consistency, but no filesystem snapshot, reconciliation, or rollback boundary.

Decision needed: either keep this explicitly DB-only and require paired host-level filesystem restore as an operator contract, or promote backup/restore to an application-level artifact that includes DB dump plus file manifest/snapshot. A middle ground is a post-restore filesystem verifier that marks missing originals/derivatives as failed, queues repair when originals exist, and reports orphan files for operator cleanup.

### R2. Public flood protection depends on manually applied nginx config, not deploy

Severity: Medium
Confidence: High
Files/regions:

- `apps/web/nginx/default.conf:1-29`
- `apps/web/nginx/default.conf:246-295`
- `apps/web/deploy.sh:51-108`
- `apps/web/src/app/[locale]/(public)/page.tsx:19`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:42`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:14`

Public SSR and image-optimizer protection is placed at nginx: `zone=public` for dynamic public pages and `zone=nextimage` for `/_next/image` (`nginx/default.conf:1-29`, `246-295`). The nginx file itself states it is config-only and must be manually applied/reloaded (`nginx/default.conf:290-293`). The deploy script rebuilds and starts Docker, health-checks the app, and prunes artifacts, but does not validate or reload nginx (`deploy.sh:51-108`). Public pages are dynamic (`revalidate = 0`) on key surfaces such as home, photo, and map.

Concrete failure scenario: a new host or emergency redeploy uses the app container successfully but misses the nginx template update. The app passes health checks, but the public dynamic route surface and Next image optimizer run without the edge limiter that the architecture assumes. A per-IP crawl or uncached image tuple flood burns DB, Sharp CPU, and disk cache with no app-layer fallback on those page navigations.

Decision needed: either make nginx config deployment/verification part of the release contract, or add an app-layer coarse limiter/failsafe for the dynamic public page surface when edge protection is not confirmed. A practical fix is a blocking deploy preflight that checks the live nginx config for the required zones and locations, plus documentation that `apps/web/nginx/default.conf` is not merely advisory.

### R3. Advisory lock names are server-scoped, which blocks multi-gallery co-location

Severity: Medium
Confidence: High
Files/regions:

- `apps/web/src/lib/advisory-locks.ts:10-49`
- `apps/web/src/lib/advisory-locks.ts:51-72`
- `apps/web/src/lib/image-queue.ts:752-780`

Most advisory lock names are global constants in MySQL's server-wide lock namespace (`advisory-locks.ts:10-49`). Only the single-writer liveness lock is database-scoped through a DB-name hash (`advisory-locks.ts:51-72`). The comments document the constraint, but the code still means separate GalleryKit databases on the same MySQL server serialize restores, upload-contract changes, topic changes, backfills, and per-image processing claims.

Concrete failure scenario: two independent galleries share one MySQL server with separate DBs. Gallery A runs a color backfill or restore and Gallery B's restore/backfill/upload-contract operations fail fast or wait unexpectedly. Worse, per-image processing claims such as `gallerykit:image-processing:123` collide by auto-increment ID across databases, so Gallery B can mark a row as claim-exhausted because Gallery A is processing a different image with the same ID (`image-queue.ts:752-780`).

Decision needed: either enforce "one GalleryKit per MySQL server" as a hard startup/deploy guard, or prefix every non-liveness advisory lock with a stable per-instance identifier or DB hash. The latter is the better evolution path if hosted multi-gallery or shared MySQL operations are expected.

### R4. The single-writer topology is warning-only while process-local state is correctness-critical

Severity: Medium
Confidence: High
Files/regions:

- `apps/web/src/lib/single-writer-guard.ts:6-21`
- `apps/web/src/lib/single-writer-guard.ts:218-235`
- `apps/web/src/lib/restore-drain-checklist.ts:10-17`
- `apps/web/src/app/[locale]/admin/db-actions.ts:580-635`

The repository correctly documents a single-web-instance/single-writer topology. The guard detects another live process on the same DB, but explicitly continues startup as a warning only (`single-writer-guard.ts:6-21`, `218-235`). At the same time, restore safety depends on process-local drains of buffered writers and queues (`restore-drain-checklist.ts:10-17`, `db-actions.ts:580-635`), and the guard's own message names process-local restore fences, upload quota tracking, and rate-limit fast paths as unsafe across multiple app processes.

Concrete failure scenario: an operator scales the web service to two containers to handle traffic. One process enters restore maintenance and drains its own image queue/background writers; the second process continues to accept or flush work because the restore drain checklist cannot see its memory. The SQL import can be followed by stale writes from the other process, corrupting the restored state.

Decision needed: decide whether multi-process is out of scope or a roadmap goal. If out of scope, make this fail-closed in production by default with an explicit override for emergency boot. If in scope, move process-local barriers, queues, upload quota, rate-limit fast paths, and restore drains to DB/distributed coordination before allowing horizontal scale.

## Positive Invariants Observed

- Mutating admin actions are consistently guarded by same-origin/admin checks and the admin mutation barrier, with restore using the exclusive side rather than a shared slot.
- Restore is much stronger than a basic SQL import: it holds DB restore/upload/backfill locks, durable maintenance state, image queue quiescence, background writer drains, admin mutation drains, and post-restore migrations.
- Public API routes with expensive or mutating behavior generally have app-layer rate-limit helpers; the remaining public page flood control is consciously delegated to nginx.
- Privacy-sensitive image fields are centralized in `data.ts` select maps and backed by tests, reducing accidental public leakage when schema fields are added.

## Final Sweep / Inspection Limits

No architecture-relevant tracked file category was intentionally skipped. I inspected the required docs first, built inventories across app routes/actions/components, lib subsystems, schema/migrations, scripts, deploy/nginx, tests, and docs/plans, then followed cross-file invariants for restore, upload/delete, image processing, backfill, rate limiting, and topology.

I did not line-review generated Drizzle snapshot JSON, binary/static assets, package manager lockfile internals, or unrelated dirty review files already present in `.context/reviews/`. I treated those as non-authoritative for current architecture except where schema/journal/deploy contracts reference them.

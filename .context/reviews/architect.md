# Architect Review — Prompt 1 Fan-out

Date: 2026-04-29 (Asia/Seoul)
Repository: `/Users/hletrd/flash-shared/gallery`
Role: architect
Mode: read-only architecture/design review; only this review artifact was written.

## Scope and inventory

I built the review inventory from tracked files plus deployment/runtime configuration using `git ls-files`, targeted `find`/`rg` sweeps, and direct file reads. I excluded `.git`, `node_modules`, build/cache artifacts, uploaded media, and historical/generated review-plan artifacts unless they shaped current architecture. This review is based on the current worktree; pre-existing local changes were left untouched.

### Review-relevant file groups examined

- Root/project contract: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.dockerignore`, `.nvmrc`, root `package.json`.
- CI/deployment/process topology: `.github/workflows/quality.yml`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/drizzle.config.ts`, `apps/web/scripts/*`.
- Next/app configuration: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig*.json`, `apps/web/site-config.example.json`, `apps/web/messages/*.json`.
- App router and actions: all files under `apps/web/src/app/**`, including admin/public routes, server actions, API routes, metadata/sitemap, proxy, instrumentation, and locale layout.
- UI/components: all files under `apps/web/src/components/**`, including admin forms, public gallery views, shell/navigation, UI primitives, and SEO/analytics components.
- Data/domain/runtime libraries: all files under `apps/web/src/lib/**`, including auth/session, CSRF/origin, data access, upload validation, queue, restore maintenance, locks, upload paths, storage abstraction, config/site-config, CSP, observability, and rate limiting.
- Database/migrations: `apps/web/src/db/**`, `apps/web/drizzle/**`.
- Tests and gates: all unit/integration files under `apps/web/src/__tests__/**`, e2e specs under `apps/web/e2e/**`, and guard scripts under `apps/web/scripts/**`.

## Architecture map observed

- Public/admin UI is a Next.js App Router app. Admin pages authenticate via session helpers and delegate mutation to server actions in `src/app/actions/**` plus admin DB actions under `src/app/[locale]/admin/(protected)/db/db-actions.ts`.
- Persistence is MySQL through Drizzle (`src/db/schema.ts`, `src/lib/db.ts`, `src/lib/data.ts`). Upload/image metadata rows reference filesystem filenames; original files live outside public web roots and derivatives/resources live under public upload paths.
- Image upload flow crosses several boundaries: admin action validation/origin/auth (`app/actions/images.ts`) → disk write (`lib/upload-paths.ts`) → DB row insert (`db/schema.ts`/Drizzle) → process-local queue (`lib/image-queue.ts`) → sharp conversion → public derivative files → DB `processed` update.
- Restore/backup flow is DB-centric: admin DB action shells out to `mysqldump`/`mysql`, flips process-local restore maintenance, quiesces the local image queue, and imports SQL. It does not own filesystem asset state.
- Runtime state is intentionally single-process in several places: restore maintenance flag, upload tracker, view-count buffer, queue scheduling/retry maps. README documents the single-writer expectation, but the running app does not enforce it.
- Deployment assumes a standalone Next container plus MySQL, host networking, bind-mounted `data/`, bind-mounted `public/`, and optional nginx static serving/rate limiting in front of Next.

## Findings

### A1. Restore and upload critical sections use disjoint locks, allowing DB/filesystem interleaving

- Severity: High
- Confidence: High
- Category: Confirmed
- Primary files/regions:
  - `apps/web/src/app/actions/images.ts:116-128` — upload checks process-local restore maintenance before doing work.
  - `apps/web/src/app/actions/images.ts:171-245` — upload acquires `acquireUploadProcessingContractLock()` and begins disk/config/tracker work.
  - `apps/web/src/app/actions/images.ts:274-317` — upload performs late maintenance cleanup then inserts the image DB row.
  - `apps/web/src/app/actions/images.ts:373-388` — upload enqueues processing after commit.
  - `apps/web/src/app/[locale]/admin/(protected)/db/db-actions.ts:274-347` — restore uses a MySQL restore advisory lock, process-local maintenance, queue quiesce, then SQL import.
  - `apps/web/src/lib/restore-maintenance.ts:1-56` — maintenance state is a `globalThis` boolean/counter.
  - `apps/web/src/lib/upload-processing-contract-lock.ts:4-10` — upload/settings lock is a separate DB advisory lock named `gallerykit_upload_processing_contract`.

Problem:

The restore flow and upload flow do not share one authoritative critical section. Uploads acquire the upload-processing contract lock, while restore acquires a different MySQL advisory lock (`gallerykit_db_restore`) and toggles a process-local maintenance flag. Uploads check the maintenance flag before work and again after saving originals, but that flag is not DB-backed, not cross-process, and not held as the same lock that restore uses. There is also a race inside one process: a restore can start after the upload's late maintenance check but before or during the upload DB insert/enqueue sequence.

Concrete failure scenario:

1. Admin A starts an upload. The action passes the initial maintenance check and writes an original file.
2. Admin B starts restore on the same host after the upload's late cleanup check, acquiring the restore lock and importing an older dump.
3. The upload inserts or returns a row that the restore import then removes, or the queue skips/enqueues during maintenance while the filesystem already contains a new original.
4. Result: the UI may report upload success for a row that no longer exists, an original file is orphaned, or pending/processed state diverges from the restored DB. In a multi-container deployment, a different process can accept uploads during restore because the maintenance flag is not shared.

Suggested fix:

Make DB restore, upload, delete, and settings/image-processing contract changes use one DB-backed mutation barrier or a deterministic lock hierarchy. For example, restore should acquire the upload-processing contract lock before entering maintenance, and uploads should acquire/check the same restore barrier immediately before the DB insert and queue enqueue. If keeping two locks, document and enforce lock ordering to avoid deadlocks. Add a regression test that simulates restore beginning between original-file save and DB insert/enqueue.

---

### A2. Backup/restore owns SQL only, while image data ownership spans private and public volumes

- Severity: Medium-High
- Confidence: High
- Category: Confirmed
- Primary files/regions:
  - `apps/web/src/app/[locale]/admin/(protected)/db/db-actions.ts:127-250` — `dumpDatabase()` shells out to `mysqldump`, writes a SQL file, and returns a download URL.
  - `apps/web/src/app/[locale]/admin/(protected)/db/db-actions.ts:350-490` — `runRestore()` validates/imports SQL only.
  - `apps/web/src/db/schema.ts:16-30` — image rows store filenames and topic/share metadata, not asset blobs.
  - `apps/web/src/lib/upload-paths.ts:11-46` — originals and derivatives/resources live in separate filesystem roots.
  - `apps/web/src/lib/serve-upload.ts:63-82` — public derivative/resource serving is filesystem-backed.
  - `apps/web/src/lib/image-queue.ts:248-255` — processing fails if the DB row references a missing original file.
  - `apps/web/docker-compose.yml:22-25` — runtime binds `./data` and `./public` as separate persistent volumes.
  - `README.md:176-181` — deployment notes distinguish private originals and public derivatives.

Problem:

The admin backup/restore feature presents an operationally important recovery path, but it captures only the relational database. The gallery's source-of-truth is split: database rows reference filenames, originals live under private upload roots, derivatives/resources live under public upload roots, and topic/resource images are plain files. SQL restore has no manifest, checksum, asset copy, or reconciliation pass.

Concrete failure scenario:

- Restoring a database dump on a fresh host recreates image rows whose derivative URLs point to files that do not exist; public galleries render broken images.
- Restoring an older dump onto newer volumes leaves orphaned public/private files that are no longer referenced by DB rows.
- Rows with `processed = false` can become permanently stuck if their originals are absent, because the queue can only process from existing originals.

Suggested fix:

Clarify the UI and docs that the current feature is a database-only backup/restore, then add a full gallery backup/restore path for operational recovery. A complete backup should bundle SQL, private originals, public derivatives/resources, and a manifest with checksums. At minimum, add a post-restore reconciliation job that reports missing originals/derivatives, optionally regenerates derivatives from originals, and can sweep orphaned files after operator confirmation.

---

### A3. Single-writer/process-local topology is documented but not enforced at runtime

- Severity: Medium
- Confidence: High
- Category: Confirmed
- Primary files/regions:
  - `README.md:146` — documentation says queue processing, upload quota tracking, and restore maintenance assume a single web instance/single writer.
  - `apps/web/src/lib/restore-maintenance.ts:1-56` — restore maintenance lives in process memory.
  - `apps/web/src/lib/upload-tracker-state.ts:7-20` — upload-byte tracker is a process-local `globalThis` map.
  - `apps/web/src/lib/data.ts:11-23` — view-count buffering is process-local state and timer.
  - `apps/web/src/lib/image-queue.ts:121-140` — queue, retry sets, processing sets, and processed job state are process-local.
  - `apps/web/src/app/api/health/route.ts:7-9` — health reports only the local process' restore-maintenance flag.

Problem:

The architecture has a real single-writer invariant, but it is enforced only by documentation. Multiple Node processes, PM2 clustering, Kubernetes replicas, or two Compose stacks pointed at the same DB/volumes would all boot normally. Some DB advisory locks reduce duplicate image processing, but they do not centralize all mutable runtime state.

Concrete failure scenario:

- Instance A enters restore maintenance while instance B continues accepting uploads and admin mutations.
- Upload quota/size tracking splits per process, allowing aggregate uploads above the intended cap.
- View-count buffers flush independently or are lost when one process restarts.
- Health checks against instance B report normal while instance A is in restore maintenance.

Suggested fix:

Choose one of two explicit architectures:

1. Enforce single-writer deployment at boot with a DB-backed lease/instance guard and clear failure when another writer is active; expose that invariant in health/readiness.
2. Move process-local state to shared infrastructure (DB tables or Redis) and make restore maintenance, upload quotas, queue state, and view-count buffering cross-instance.

Until then, document concrete prohibited topologies (`next start` cluster mode, PM2 cluster, multiple containers against the same DB/uploads) in deployment docs and CI/deploy templates.

---

### A4. `IMAGE_BASE_URL` splits build-time image policy from runtime URL generation

- Severity: Medium
- Confidence: High
- Category: Confirmed
- Primary files/regions:
  - `apps/web/next.config.ts:8-28` — parses `IMAGE_BASE_URL` during build/config evaluation.
  - `apps/web/next.config.ts:77-80` — Next image `remotePatterns` are derived from that build-time value.
  - `apps/web/src/lib/constants.ts:6-7` — runtime `IMAGE_BASE_URL` is read from `process.env`.
  - `apps/web/src/lib/image-url.ts:4-9` — rendered image URLs prepend the runtime value.
  - `apps/web/Dockerfile:35-38` — `IMAGE_BASE_URL` is a build argument.
  - `apps/web/docker-compose.yml:7-20` — Compose forwards `IMAGE_BASE_URL` to both build and runtime.
  - `README.md:142-144` — docs warn `IMAGE_BASE_URL` must be set before building.

Problem:

The app uses one environment variable for two different phases: build-time Next image optimizer allowlisting and runtime URL generation. The docs warn about this, but the container can still be run with a runtime `IMAGE_BASE_URL` that differs from the value used when the standalone app was built.

Concrete failure scenario:

An image is built with `IMAGE_BASE_URL=https://cdn-a.example.com`, then deployed with runtime `IMAGE_BASE_URL=https://cdn-b.example.com`. The UI emits `cdn-b` image URLs, but Next's optimizer remote allowlist still contains `cdn-a`. Depending on route/component behavior, images can fail optimization or be rejected even though the runtime env appears correct.

Suggested fix:

Make the phase boundary explicit and machine-enforced. Options:

- Generate a build manifest containing the build-time `IMAGE_BASE_URL` and fail startup if runtime differs.
- Split variables, e.g. `NEXT_IMAGE_REMOTE_BASE_URL` for build-time optimizer policy and `PUBLIC_ASSET_BASE_URL` for runtime rendering, with explicit docs about rebuild requirements.
- If uploads are always served by a CDN/static origin, avoid relying on Next optimizer remote policy for those URLs.

---

### A5. Experimental storage abstraction conflicts with the current private-original/public-derivative boundary

- Severity: Medium
- Confidence: High
- Category: Confirmed
- Primary files/regions:
  - `apps/web/src/lib/storage/types.ts:1-15` — storage layer is explicitly experimental and not wired through all paths.
  - `apps/web/src/lib/storage/index.ts:1-12` — current implementation is a local-only scaffold, not the live upload pipeline.
  - `apps/web/src/lib/storage/local.ts:20` — local storage creates an `original` directory under the storage root.
  - `apps/web/src/lib/storage/local.ts:123-126` — `getUrl()` returns `/uploads/${key}` for every key, including original keys.
  - `apps/web/src/lib/upload-paths.ts:24-40` — live pipeline keeps originals in `UPLOAD_ORIGINAL_ROOT` and public derivatives under `UPLOAD_ROOT`.
  - `apps/web/src/lib/upload-paths.ts:82-103` — production fails if legacy public originals are present.

Problem:

The live pipeline has a clear security/ownership boundary: originals are private, derivatives/resources are public. The experimental storage abstraction encodes a different model by putting `original/...` under the same root as public keys and returning a public URL for any key. That drift is currently contained because the abstraction is not wired into the live pipeline, but it is an architectural footgun for future storage/backend work.

Concrete failure scenario:

A future S3/local-storage migration switches original writes to `storage.put('original/<file>')` and displays or logs `storage.getUrl('original/<file>')`. With the current local adapter contract, originals become web-addressable under `/uploads/original/...`, undoing the private-original migration and potentially triggering the production legacy-original guard.

Suggested fix:

Redesign the storage interface around visibility/data class. For example, split `PrivateObjectStore` for originals from `PublicAssetStore` for derivatives/resources, or require `{ visibility: 'private' | 'public' }` in keys/operations and make `getUrl()` unavailable for private objects. Remove or quarantine `original` from the public local storage root until the abstraction is fully integrated and covered by security tests.

---

### A6. nginx admin mutation rate-limit topology omits settings and SEO routes

- Severity: Low-Medium
- Confidence: High
- Category: Confirmed
- Primary files/regions:
  - `apps/web/nginx/default.conf:77-90` — admin mutation rate-limit location covers `dashboard|db|categories|tags|users|password` only.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx` — settings is a protected admin mutation surface.
  - `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx` — SEO is a protected admin mutation surface.
  - `apps/web/src/app/actions/settings.ts:40-47` — `updateGallerySettings()` mutates gallery settings.
  - `apps/web/src/app/actions/seo.ts:55-62` — `updateSeoSettings()` mutates SEO settings.
  - `apps/web/nginx/default.conf:115-129` — generic fallback proxy has no equivalent admin mutation `limit_req`.

Problem:

The app-level auth/origin checks still protect these actions, so this is not an authentication bypass. The architectural issue is deployment-policy drift: nginx defines an admin mutation throttling zone for some protected admin pages, but settings and SEO mutations are outside the regex and fall through to the generic proxy location.

Concrete failure scenario:

A compromised admin browser session, automated client, or accidental repeated submission can hammer settings/SEO server actions without the stricter admin mutation rate limit applied to the other admin mutation pages. That can amplify DB writes, cache invalidations, and operational noise relative to the intended edge policy.

Suggested fix:

Make nginx routing derive from the same protected-admin route inventory as the app, or broaden the protected mutation location to include all admin subpaths except explicit safe/static exceptions. At minimum add `settings|seo` to the regex and add a CI guard that compares protected admin route directories with nginx admin rate-limit coverage.

---

### A7. Topic image resources can orphan on crash between final file write and DB commit

- Severity: Low
- Confidence: Medium-High
- Category: Likely
- Primary files/regions:
  - `apps/web/src/lib/process-topic-image.ts:42-80` — topic image conversion writes a final `resources/<uuid>.webp` file before the caller's DB transaction completes.
  - `apps/web/src/lib/process-topic-image.ts:95-102` — cleanup removes `tmp-*` resources, not already-final orphan resources.
  - `apps/web/src/app/actions/topics.ts:112-121` — create flow processes the image before the route/DB write is complete.
  - `apps/web/src/app/actions/topics.ts:124-139` and `151-153` — conflict/error cleanup handles normal failures.
  - `apps/web/src/app/actions/topics.ts:214-229` — update flow processes the replacement image before transaction completion.
  - `apps/web/src/app/actions/topics.ts:283-286` — previous image is deleted only after a successful update.

Problem:

The normal error paths clean up processed topic images well, but crash consistency is not atomic. A final public resource file can be written before the DB row that references it is committed. If the process exits after final write and before cleanup/commit, the file has no owner.

Concrete failure scenario:

During topic creation/update, the process writes `public/uploads/resources/<uuid>.webp` and then crashes before the DB transaction commits or before the catch/finally cleanup path runs. The topic row never references that filename, but the public file remains indefinitely. Repeated crashes or abandoned admin sessions can grow unreferenced resources and complicate backup/migration.

Suggested fix:

Introduce a staged resource lifecycle: write to a private/temp key, commit the DB row with intended filename, then promote/rename after commit; or store a pending asset record and finalize it transactionally. Add a startup/admin sweeper that compares `resources/*.webp` against `topics.image_filename` and reports/removes unreferenced resources after an age threshold.

---

### A8. Server-action origin guard lint is topology-scoped, not all-`use server` scoped

- Severity: Low
- Confidence: Medium
- Category: Likely
- Primary files/regions:
  - `apps/web/scripts/check-action-origin.ts:13-21` — scanner documents its limited file topology and hard-coded exclusions.
  - `apps/web/scripts/check-action-origin.ts:86-97` — discovery scans `src/app/actions/**` plus a hard-coded admin DB actions file.
  - `apps/web/src/proxy.ts:101-107` — proxy intentionally excludes API routes and notes admin API routes must authenticate themselves.
  - Current `rg '^use server' apps/web/src/app` sweep shows existing server-action files are covered by today's scanner shape, aside from intentional public/auth exclusions.

Problem:

The current codebase appears to satisfy the guard's topology, but the guarantee is brittle. Next allows colocated route-segment server action files, and a future admin feature could add `src/app/[locale]/admin/(protected)/foo/actions.ts` or another `use server` file outside `src/app/actions/**`. That file would not be scanned unless manually added to the hard-coded list.

Concrete failure scenario:

A developer adds a new protected admin mutation in a route-local `actions.ts` file and forgets `requireSameOriginAdmin()`. The action is outside the scanner's discovery set, so CI passes even though the architectural origin-guard invariant has been broken.

Suggested fix:

Invert the guard: scan all `src/app/**` files containing `'use server'`, then require explicit allowlist annotations/exemptions for public/auth-only actions. If the repository wants to ban colocated server actions, enforce that with a test that fails whenever a new `use server` file appears outside approved locations.

---

## Positive controls observed

- Private originals are separated from public derivatives in the live path (`upload-paths.ts`) and production startup rejects legacy public originals.
- Image deletion paths attempt to coordinate queue state and filesystem cleanup after DB deletion.
- Public/admin data query shapes intentionally separate public-safe fields from admin fields, with compile-time privacy checks around image selections.
- API auth and server-action origin checks have dedicated guard scripts, even though one scanner should be widened as noted above.
- README now documents important deployment assumptions, including single-writer behavior, image base URL build-time handling, and nginx/static upload path caveats.

## Final sweep and coverage confirmation

- Inventory source: tracked repository files and runtime config; generated/build/cache/media artifacts excluded.
- App actions reviewed: image, topic, tag, category, user, password, SEO, settings, auth, public/group loading, and admin DB backup/restore actions.
- Data layer reviewed: Drizzle schema, database connection, query/read models, view-count buffering, upload metadata, and privacy field selection.
- Image queue reviewed: process-local queue topology, MySQL per-image locks, pending bootstrap, restore quiesce/resume, filesystem derivative generation, and cleanup behavior.
- Restore reviewed: maintenance flag, DB advisory lock, mysqldump/mysql shell execution, SQL validation/import, queue quiesce, and backup-download serving.
- Auth/boundary reviewed: session helpers, CSRF/origin helpers, admin proxy/CSP behavior, API route auth guard script, and server-action origin guard script.
- UI reviewed: admin/public route organization, settings/SEO mutation surfaces, analytics/CSP integration, and component ownership boundaries at an architectural level.
- Tests reviewed: unit/integration/e2e coverage and guard scripts relevant to the findings above.
- Deployment reviewed: Dockerfile, Compose topology, nginx static/proxy/rate-limit config, environment examples, README deployment/runbook notes, and CI quality workflow.

No implementation changes were made. The only file intentionally written by this review pass is `./.context/reviews/architect.md`.

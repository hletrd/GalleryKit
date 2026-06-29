# Architect Review - Cycle 12

Review target: current `master` HEAD `23d20b4efb1c37a2b65879fe1d6739696d575a2d`.

Role: architectural/design risks, coupling, layering, invariants, deployment/runtime topology, migration architecture, data/privacy boundaries, and long-term maintainability. This is a review-only artifact; I did not implement fixes.

## Inventory Built Before Findings

I read `AGENTS.md` from the prompt and `CLAUDE.md` first, then built the review inventory before forming findings.

Review-relevant active inventory:

- Governance and architecture docs: `AGENTS.md`, `CLAUDE.md`, root package/workspace config, and current review artifacts.
- Request surface: all App Router pages, route handlers, API routes, and server actions under `apps/web/src/app`.
- Core architecture modules: all files under `apps/web/src/lib`, especially auth/session, action guards, rate limits, data selectors/privacy guards, upload paths, process-image, image queue, restore maintenance, DB restore, storage quarantine, semantic search, CLIP model paths, and revalidation.
- Schema/migration surface: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, and `apps/web/scripts/migrate.js`.
- Operations surface: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, and sidecar scripts under `apps/web/scripts`.
- Contract tests used as invariant evidence: privacy guards, search-route privacy scans, storage quarantine, migration reconcile/journal tests, upload/LR parity tests, queue/backfill tests, action/API/rate-limit lint scanners.

Counted active source/config files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/src/components`, `apps/web/scripts`, and `apps/web/drizzle`: 290 files. Excluded generated `.next`, `node_modules`, runtime data/uploads, screenshots, binary fixtures, and historical archived review material except where needed to avoid stale duplicate claims.

## Confirmed / Likely Findings

### ARCH-C12-01 - Reconcile + baseline can preserve old column defaults while marking migrations applied

Severity: Medium
Confidence: High
Status: Likely schema-convergence bug; not a currently observed upload leak

Evidence:

- The migration runbook requires every migration to be mirrored into `reconcileLegacySchema`: `CLAUDE.md:430-432`.
- The original schema created `images.processed` with `DEFAULT true`: `apps/web/drizzle/0000_nappy_madelyne_pryor.sql:37-40`.
- Migration `0002` corrects that to `DEFAULT false`: `apps/web/drizzle/0002_fix_processed_default.sql:1`.
- The Drizzle schema now expects `processed: boolean("processed").default(false)`: `apps/web/src/db/schema.ts:94-101`.
- `reconcileLegacySchema` creates fresh `images` tables with `processed boolean DEFAULT false`: `apps/web/scripts/migrate.js:342-383`.
- For existing `images` tables, the reconcile path only `ensureColumn`s columns at `apps/web/scripts/migrate.js:386-429` and structurally modifies `capture_date`, `latitude`, and `longitude` at `apps/web/scripts/migrate.js:431-444`; it does not verify or alter the existing `processed` default.
- If gallery tables exist but migration hashes are incomplete, the deploy path reconciles and then baselines every journal entry: `apps/web/scripts/migrate.js:756-761`. Drizzle will not later run `0002` because the hash is recorded.
- The current coverage test is explicit that it checks table/column mentions but "cannot verify types or defaults": `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-17`.

Failure scenario:

A legacy database has `images` from `0000` with `processed DEFAULT true`, but has an incomplete or poisoned `__drizzle_migrations` table. On deploy, `prepareLegacyDatabaseIfNeeded()` enters the reconcile + baseline path, sees the `processed` column already exists, does not modify its default, and records the `0002` hash. Current browser and Lightroom uploads explicitly write `processed: false` (`apps/web/src/app/actions/images.ts:404-425`, `apps/web/src/app/api/admin/lr/upload/route.ts:378-396`), so the immediate upload paths are protected. The schema is still not converged: a future import, seed, admin repair script, or direct Drizzle insert that omits `processed` can create a row as processed before derivatives exist, exposing broken public rows and bypassing the intended queue gate.

Suggested fix:

Make `reconcileLegacySchema` verify structural column properties for known drift-prone columns, starting with `images.processed DEFAULT false`, and issue an idempotent `ALTER TABLE images ALTER COLUMN processed SET DEFAULT false` or equivalent MySQL-compatible `MODIFY COLUMN` when drift is found. Add a migration-reconcile test that validates types/defaults for selected contract columns, not only column-name presence.

### ARCH-C12-02 - Public privacy guards are alias-key based, not column-origin based

Severity: Medium
Confidence: Medium
Status: Risk; confirmed guard limitation, no current public leak found

Evidence:

- Admin fields include sensitive columns such as originals, GPS, raw uploader id, color diagnostics, and processing state: `apps/web/src/lib/data.ts:251-327`.
- `publicSelectFields` is derived by destructuring sensitive keys out of `adminSelectFields`: `apps/web/src/lib/data.ts:368-408`.
- The compile-time public privacy guard checks `Extract<keyof typeof publicSelectFields, PrivacySensitiveKeys>`: `apps/web/src/lib/data.ts:473-477`.
- The map guard uses the same key-name pattern while allowing GPS only on the map path: `apps/web/src/lib/data.ts:479-489`; `getMapImages()` then enforces `topics.map_visible = true` and non-null GPS at `apps/web/src/lib/data.ts:1658-1687`.
- Similar key-name guards protect public search/timeline mirrors: `apps/web/src/lib/search-enrichment-fields.ts:29-46`, `apps/web/src/lib/data.ts:1508-1526`, and `apps/web/src/lib/data-timeline.ts:35-67`.
- The symmetric privacy fixture verifies admin-only key names against `SENSITIVE_KEYS`: `apps/web/src/__tests__/privacy-fields.test.ts:71-92`.
- The only column-origin denylist scan is scoped to the two public search API route files: `apps/web/src/__tests__/search-route-privacy.test.ts:54-63`.

Failure scenario:

A future public feature adds a field with a safe-looking alias, for example `gps: images.latitude`, `sourceName: images.user_filename`, or `profile: images.icc_profile_name`, to a public select object. The `Extract<keyof ...>` guards pass because the alias is not named `latitude`, `user_filename`, or `icc_profile_name`. The symmetric privacy fixture also passes because it compares exported key sets, not underlying Drizzle column origins. The leak only becomes visible in runtime review or if the affected route happens to be one of the two source-scanned search routes.

Suggested fix:

Move public projections behind a small allowlisted builder or registry whose values are canonical public-safe `images` columns, then make ad hoc public selects import from that registry instead of aliasing raw `images.*` columns. As a defense-in-depth test, add an AST/source scan over public data-access modules and public routes that rejects direct references to admin-only `images` columns unless the file/region is explicitly allowlisted, such as the `getMapImages()` GPS gate.

### ARCH-C12-03 - Browser and Lightroom upload paths still duplicate the ingest transaction boundary

Severity: Medium
Confidence: High
Status: Confirmed architectural coupling risk; current parity is maintained by comments and tests

Evidence:

- Browser upload owns the upload-processing lock, config snapshot, upload tracker claim, disk precheck, topic check, save original, HDR gate, GPS strip, restore-maintenance late check, insert, tag persistence, enqueue, audit, and revalidation in one server action: `apps/web/src/app/actions/images.ts:175-612`.
- The browser insert contract includes the core row shape and `processed: false`: `apps/web/src/app/actions/images.ts:404-425`, with queue snapshot fields at `apps/web/src/app/actions/images.ts:490-522`.
- Lightroom PAT upload repeats the same concerns in an API route: topic check at `apps/web/src/app/api/admin/lr/upload/route.ts:204-220`, upload-processing lock at `apps/web/src/app/api/admin/lr/upload/route.ts:222-238`, config/disk precheck at `apps/web/src/app/api/admin/lr/upload/route.ts:240-284`, save original at `apps/web/src/app/api/admin/lr/upload/route.ts:286-310`, HDR/GPS/restore/insert at `apps/web/src/app/api/admin/lr/upload/route.ts:327-439`, queue snapshot at `apps/web/src/app/api/admin/lr/upload/route.ts:456-493`, and audit/revalidation at `apps/web/src/app/api/admin/lr/upload/route.ts:495-524`.
- The LR route's own comments repeatedly call out "mirror the browser path" for lock, disk, HDR, GPS, restore, insert, uploader attribution, and queue settings: `apps/web/src/app/api/admin/lr/upload/route.ts:222-230`, `apps/web/src/app/api/admin/lr/upload/route.ts:256-269`, `apps/web/src/app/api/admin/lr/upload/route.ts:327-359`, and `apps/web/src/app/api/admin/lr/upload/route.ts:456-493`.

Failure scenario:

A future setting or invariant is added to the browser path first, such as a new retained-original scrubber, a new processing snapshot field, or a new pre-insert rejection. Because the LR route is a parallel implementation rather than a shared ingest service, the PAT path can keep accepting or queueing images under the old contract. This repo has already accumulated many parity comments, which is evidence that the duplicate boundary is difficult to keep synchronized.

Suggested fix:

Extract a shared `createImageIngestTransaction()` service that takes an already-authenticated actor, source kind (`browser` or `lightroom`), file-like object, metadata overrides, and response policy. Keep transport-specific validation and response shaping in the server action/API route, but centralize the save -> metadata -> policy gates -> DB insert -> queue contract. Preserve focused parity tests for the two adapters.

## Risks

### ARCH-C12-RISK-01 - Quarantined storage backend still points `original/` at the public upload root

Severity: Medium
Confidence: High
Status: Risk; confirmed design mismatch in quarantined code, not a live path today

Evidence:

- Canonical active paths split processed derivatives under `UPLOAD_ROOT` from originals under private `UPLOAD_ORIGINAL_ROOT`: `apps/web/src/lib/upload-paths.ts:11-46`.
- Legacy public originals are treated as unsafe and fail production startup when present: `apps/web/src/lib/upload-paths.ts:24-25`, `apps/web/src/lib/upload-paths.ts:110-130`, and `apps/web/src/instrumentation.ts:1-5`.
- The quarantined local storage backend imports only `UPLOAD_ROOT`: `apps/web/src/lib/storage/local.ts:14-20`.
- It resolves every key under that public root: `apps/web/src/lib/storage/local.ts:40-47`, and writes arbitrary keys there at `apps/web/src/lib/storage/local.ts:62-84`.
- It refuses to create public URLs for `original/*`: `apps/web/src/lib/storage/local.ts:130-138`, but the bytes would still be written under the public upload tree if a future caller used `writeBuffer("original/name", ...)`.
- The quarantine test prevents current app code outside `lib/storage` from importing it: `apps/web/src/__tests__/storage-quarantine.test.ts:111-132`.

Failure scenario:

A future storage-backend integration removes or relaxes the quarantine test and wires `LocalStorageBackend` into upload processing. Originals written with keys like `original/<uuid>` land under the same public upload root the rest of the app has spent several cycles moving away from. Nginx blocks `/uploads/original/`, and `getUrl()` refuses those keys, but the privacy boundary becomes dependent on every static/proxy path continuing to block that public directory instead of on storage location.

Suggested fix:

Before integrating `@/lib/storage`, change the local backend to route original keys to `UPLOAD_ORIGINAL_ROOT` and derivative/resource keys to `UPLOAD_ROOT`, or split the interface into private-object and public-object backends. Keep the quarantine test until that path split and serving contract are implemented in the same change.

### ARCH-C12-RISK-02 - The single-instance runtime contract is documented but not enforced by deployment guardrails

Severity: Low
Confidence: High
Status: Risk; current shipped topology is single web instance

Evidence:

- `CLAUDE.md` explicitly states the shipped deployment is "single web-instance / single-writer" and warns not to horizontally scale until process-local state is moved to a shared store: `CLAUDE.md:226-229`.
- Docker Compose currently defines one `web` service with host networking and bind mounts: `apps/web/docker-compose.yml:3-27`.
- Restore maintenance is a `globalThis` process flag: `apps/web/src/lib/restore-maintenance.ts:1-55`.
- The image processing queue is also process-local `globalThis` state with in-memory enqueued/retry/error sets: `apps/web/src/lib/image-queue.ts:76-90`, `apps/web/src/lib/image-queue.ts:303-323`.
- Several rate-limit buckets and counters are in-memory fast paths: `apps/web/src/lib/rate-limit.ts:75-119`; public view-recording has an in-memory per-IP limiter at `apps/web/src/app/actions/public.ts:323-331`.
- Shared-group view counts are buffered in process memory before DB flush: `apps/web/src/lib/data.ts:13-27`.

Failure scenario:

An operator adds `--scale web=2`, moves the app to a process manager with multiple Node workers, or ports the app to a horizontally scaled platform without reading the topology note. Restore maintenance in one process does not block uploads in another process; queue retry/enqueued state splits; rate-limit budgets multiply per process; best-effort view counters can be lost or double-buffered. Some correctness is protected by DB state and advisory locks, but the runtime contract is no longer the one the app was designed and tested against.

Suggested fix:

Add a deploy/runtime guard that makes the single-instance assumption explicit and hard to bypass. Options: a startup advisory lock that only one web process may hold, a required `GALLERYKIT_ALLOW_MULTI_INSTANCE=false` assertion with fail-loud documentation, or a migration plan that moves restore maintenance, queue coordination, and all public rate-limit/view counters into MySQL/Redis before any multi-instance deployment is allowed.

## Stale Finding Sweep

- Cycle 11 same-origin ordering is no longer current on at least the settings path: `updateGallerySettings` now checks maintenance, then `requireSameOriginAdmin()`, then `isAdmin()` at `apps/web/src/app/actions/settings.ts:40-47`.
- Cycle 11 sidecar backfill concurrency is no longer current: both `backfill-color-pipeline` and `backfill-cicp-recheck` now use `parseBoundedPositiveInteger(..., { fallback: 2, max: 8 })` before constructing `PQueue`: `apps/web/scripts/backfill-color-pipeline.ts:371-375`, `apps/web/scripts/backfill-cicp-recheck.ts:81-85`. The helper rejects non-finite values and clamps to max at `apps/web/src/lib/env.ts:1-24`.

## Final Sweep

Commonly missed areas checked:

- Migration journal non-monotonicity and reconcile/baseline architecture: checked `_journal.json`, all migration SQL, `migrate.js`, schema, and migration tests.
- Public privacy boundaries: checked canonical public/admin field sets, map exception, timeline/search mirrors, search routes, and privacy fixtures.
- Runtime topology: checked Docker Compose, deploy script, instrumentation shutdown, process-local queue/maintenance/rate-limit/view-count state, and CLAUDE topology note.
- Upload/original storage boundary: checked upload path split, legacy-original startup assertion, serve-upload route behavior, Nginx block, and storage quarantine.
- Older review findings: rechecked and excluded fixed stale findings rather than repeating them.

Skipped as non-review-relevant for this architecture pass: generated `.next`, `node_modules`, runtime uploads/data/backups, binary/image fixtures, screenshots, and historical review artifacts not needed for current-finding validation.

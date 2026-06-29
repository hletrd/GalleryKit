# Cycle 14 Architect Review

## Scope and Inventory

Reviewed current HEAD `c2da917d` only. I read `AGENTS.md` and `CLAUDE.md` first, then built an architecture inventory before inspecting implementation details.

Inventory built from tracked files:

- Root/project contracts and build config: `AGENTS.md`, `CLAUDE.md`, package manifests, TypeScript/Next config, Docker/Nginx/deploy files, GitHub workflow files.
- Active web app source: `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/db`.
- Data/schema/migration surfaces: `apps/web/drizzle`, `apps/web/scripts/migrate.js`, migration tests and schema-contract tests.
- Runtime/ops surfaces: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/nginx/default.conf`, env examples.
- Boundary and regression tests: `apps/web/src/__tests__`, `apps/web/e2e`, custom lint scripts.
- Historical context files under `.context/` were inventoried as review/plan history, but not treated as runtime authority for current HEAD.

Architecture-relevant file counts from the inventory: app routes/actions 77, components 57, lib modules 96, DB modules 3, migrations 31, scripts 27, E2E tests 8, source tests 265, web config/ops files 42, GitHub workflow files 3. I inspected the active architecture surfaces above by category rather than sampling a few representative files.

No production code was modified. Existing unrelated dirty review files were present before this pass and were not used as current-HEAD evidence.

## Confirmed Issues

No confirmed current-HEAD production architecture defects were found in the shipped local-filesystem, single-web-instance topology. The auth/API/action-origin/rate-limit boundaries, public/admin projection split, migration hash postconditions, private-original/public-derivative storage split, derivative serving containment checks, and documented Docker deployment shape are internally consistent for that topology.

## Likely Issues

### ARCH-C14-01 - Quarantined storage abstraction models topic resources in the wrong keyspace

- Severity: Medium
- Confidence: High
- Status: Likely issue if the storage abstraction is wired into production paths
- Citations:
  - `apps/web/src/lib/storage/index.ts:4`-`12` says the storage backend exists but is not wired into the live upload, processing, or serving pipeline.
  - `apps/web/src/__tests__/storage-quarantine.test.ts:1`-`27` and `apps/web/src/__tests__/storage-quarantine.test.ts:111`-`132` enforce that quarantine and describe wiring it in as a deliberate product decision.
  - `apps/web/src/lib/storage/local.ts:15`-`20` stores all storage keys, including `resources`, under `UPLOAD_ROOT`.
  - `apps/web/src/lib/storage/local.ts:130`-`137` returns `/uploads/<key>` for every non-original key.
  - `apps/web/src/lib/process-topic-image.ts:11`-`28` defines the real topic-resource root as `public/resources`, separate from `UPLOAD_ROOT`.
  - `apps/web/src/lib/process-topic-image.ts:72`-`102` writes and deletes topic images directly under that `public/resources` root.
  - `apps/web/docker-compose.yml:23`-`27` persists `./public/uploads` and `./public/resources` as separate bind mounts.
  - `apps/web/next.config.ts:29`-`34` permits both `/uploads/**` and `/resources/**` as distinct image sources.
  - `apps/web/src/lib/serve-upload.ts:15` and `apps/web/src/lib/serve-upload.ts:137`-`140` only serve upload top-level directories `jpeg`, `webp`, and `avif`.

Failure scenario: a future storage integration follows the advertised `getStorage()` path for topic cover images and writes a key such as `resources/topic.webp`. `LocalStorageBackend` stores it under `public/uploads/resources/topic.webp` and returns `/uploads/resources/topic.webp`. That path is not the deployed `public/resources` bind mount, is not the URL shape the app config treats as resources, and is rejected by the upload route because `resources` is not an allowed upload directory. The result is a topic image that appears successfully written by the storage layer but is not durably mounted or served through the intended resource URL.

Concrete fix: before relaxing the storage quarantine, split the storage model into explicit keyspaces or backends: upload derivatives under `UPLOAD_ROOT` with `/uploads/{jpeg,webp,avif}/...`, private originals under `UPLOAD_ORIGINAL_ROOT`, and topic resources under `public/resources` with `/resources/...`. Alternatively remove `resources` from `REQUIRED_DIRS` and from the storage abstraction until the resource-store design is implemented. Update `CLAUDE.md`, `storage-quarantine.test.ts`, and URL/serving tests in the same change that intentionally wires the abstraction into production.

### ARCH-C14-02 - LocalStorageBackend write paths are less hardened than the live upload pipeline

- Severity: Medium
- Confidence: Medium
- Status: Likely issue if the quarantine is breached or the backend becomes live
- Citations:
  - `apps/web/src/__tests__/storage-quarantine.test.ts:11`-`16` documents the hazard: importing `@/lib/storage` would establish a second write path parallel to audited upload/process serving behavior.
  - `apps/web/src/lib/storage/local.ts:40`-`47` prevents lexical path traversal by resolving under `UPLOAD_ROOT`.
  - `apps/web/src/lib/storage/local.ts:62`-`84` writes streams and buffers directly to the final path after `mkdir`.
  - `apps/web/src/lib/storage/local.ts:91`-`98` rejects symlinks only on the read-stream path, not before writes.
  - `apps/web/src/lib/storage/local.ts:118`-`127` copies by hard link or `copyFile` without destination symlink/regular-file checks.
  - `apps/web/src/lib/upload-paths.ts:11`-`46` defines the audited live upload roots that the production pipeline uses directly instead of `LocalStorageBackend`.

Failure scenario: after a future integration, an admin-triggered or background path writes through `LocalStorageBackend` to a key whose final path has been replaced by a symlink inside the writable upload tree. The resolver verifies the path string stays under `UPLOAD_ROOT`, but `createWriteStream()` / `fs.writeFile()` follow the final symlink. In a normal deployment direct filesystem access is restricted, which is why this is not a confirmed current bug; the architectural risk is that the dormant backend advertises a production-like storage API while missing the hardening expected of a live write path.

Concrete fix: either keep `lib/storage` quarantined, or make it production-grade before integration. Write to a random temp file in the same directory, open/create with no-follow/exclusive semantics where Node and the platform support them, verify parent and final path with `lstat`/`realpath`, then atomically rename. Apply equivalent checks to `copy()`, and add tests covering final-path symlink writes, parent traversal, temp-file cleanup, and failed partial writes.

## Risks Needing Manual Validation

### ARCH-C14-03 - Topic slug is a mutable natural key with manual rename fan-out

- Severity: Medium
- Confidence: High
- Status: Risk needing planned schema migration / manual validation
- Citations:
  - `apps/web/src/db/schema.ts:4`-`17` makes `topics.slug` the primary key and references it from `topic_aliases.topic_slug` without `onUpdate`.
  - `apps/web/src/db/schema.ts:19`-`33` references `topics.slug` from `images.topic` without `onUpdate`.
  - `apps/web/src/db/schema.ts:239`-`249` references `topics.slug` from `topic_views.topic` with delete cascade, also without `onUpdate`.
  - `apps/web/src/app/actions/topics.ts:255`-`301` renames a slug by inserting a new topic row, hand-updating FK children, then later deleting the old topic.
  - `apps/web/src/app/actions/topics.ts:303`-`336` separately scans and rewrites topic references inside `smart_collections.query_json`.
  - `apps/web/src/app/actions/topics.ts:338`-`339` deletes the old topic row after the manual fan-out.
  - `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1`-`23` explicitly states this is a tactical guard and that the structural fix, either `ON UPDATE CASCADE` plus in-place update or a surrogate key, is deferred.

Failure scenario: a later feature adds a new table, cache table, search index table, or JSON store that references `topics.slug`, but the developer misses the hand-maintained rename transaction. Renaming a topic can then cascade-delete history, leave stale JSON predicates, or silently orphan data. This already happened for `topic_views` according to the inline history at `apps/web/src/app/actions/topics.ts:294`-`300`, and the current guard only catches schema FKs plus the known smart-collection store.

Concrete fix: plan a migration away from mutable natural-key ownership. Preferred options are an immutable surrogate `topics.id` referenced by child tables with `slug` as a unique route field, or adding `ON UPDATE CASCADE` and changing rename to an in-place slug update for FK-backed stores. Keep a separate, explicit migration for JSON query normalization if smart collections continue to refer to slug values; the more durable design is to store topic predicates relationally or by immutable id. Until then, keep the FK registry test and add any new non-FK slug store to the rename transaction and tests in the same change.

### ARCH-C14-04 - Migration runner does not detect live schema drift once all hashes are recorded

- Severity: Medium
- Confidence: Medium
- Status: Risk needing manual validation
- Citations:
  - `apps/web/drizzle/meta/_journal.json:47`-`64` shows the committed journal has historical non-monotonic `when` values.
  - `apps/web/scripts/migrate.js:748`-`768` reconciles and baselines fresh databases.
  - `apps/web/scripts/migrate.js:771`-`777` returns early when every committed migration hash is present in `__drizzle_migrations`.
  - `apps/web/scripts/migrate.js:779`-`785` only runs `reconcileLegacySchema()` when gallery tables exist and the migration log is incomplete.
  - `apps/web/scripts/migrate.js:787`-`808` verifies hash presence after Drizzle's migrator, but not the actual live column/index/FK shape when hashes are already covered.
  - `CLAUDE.md:421`-`427` documents that the hash postcondition exists to catch Drizzle cursor skips caused by the non-monotonic journal.

Failure scenario: production records every migration hash but the live schema is still wrong because of a manual DB repair, a prior bug in `reconcileLegacySchema`, a failed external restore that also restored `__drizzle_migrations`, or an index/FK drift that the hash table cannot represent. On the next deploy, `prepareLegacyDatabaseIfNeeded()` sees all hashes and skips reconcile. `runMigrations()` also sees all hashes and succeeds. The app can then boot on a schema that is "migration-complete" by hash but missing a column, index, FK behavior, or default needed by current code.

Concrete fix: add a lightweight schema-shape postcondition after migrations that compares required tables, columns, nullability/defaults where important, and critical indexes/FKs against `schema.ts` / `reconcileLegacySchema`. It can start as a read-only verifier that fails deploy with actionable drift output. If always running full reconcile is too invasive, run only additive/idempotent checks on every deploy and reserve repair for explicit operator action. Keep the existing hash postcondition; it solves migration-log completeness, not live schema equivalence.

### ARCH-C14-05 - Single-instance runtime remains a correctness boundary, not just a deployment preference

- Severity: High if violated
- Confidence: High
- Status: Risk needing operational validation / accepted topology constraint
- Citations:
  - `CLAUDE.md:227`-`230` documents the shipped topology as single web instance / single writer and names process-local coordination states.
  - `apps/web/docker-compose.yml:3`-`27` defines one host-networked `web` service with local bind mounts.
  - `apps/web/src/lib/restore-maintenance.ts:1`-`22` stores restore maintenance state on `globalThis`.
  - `apps/web/src/lib/restore-maintenance.ts:44`-`55` toggles restore maintenance only in the current process.
  - `apps/web/src/lib/image-queue.ts:76`-`90` and `apps/web/src/lib/image-queue.ts:275`-`325` keep queue state in a process-local global.
  - `apps/web/src/lib/image-queue.ts:1035`-`1088` quiesces and resumes only the current process queue around restore.
  - `apps/web/src/lib/rate-limit.ts:75`-`96` and `apps/web/src/lib/rate-limit.ts:110`-`119` define in-memory public/admin-token rate-limit buckets.
  - `apps/web/src/lib/data.ts:13`-`35` and `apps/web/src/lib/data.ts:75`-`150` buffer shared-group view counts in process memory before flushing to MySQL.

Failure scenario: an operator later adds a second container, a blue/green overlap, Node clustering, or a process manager that runs multiple app processes against the same bind mounts and MySQL database. One process can enter restore maintenance while another still accepts uploads or queues image work. Public rate-limit budgets split per process. Shared-group view counts can be lost or double-buffered per process. Advisory locks cover some DB-critical sections, but they do not make the maintenance flag, queue lifecycle, rate-limit fast paths, or view-count buffer cluster-wide.

Concrete fix: keep "exactly one active web process per deployment" as an operational invariant and verify it in deploy/runbook checks. If horizontal scaling is desired, first move restore maintenance, upload/queue coordination, public rate limits, backfill status, and view-count buffering to shared durable state such as MySQL rows with transactional claims, Redis, or a dedicated worker queue. Add multi-process tests for restore/upload/queue interleavings before enabling scale-out.

## Final Missed-Issues Sweep

Final sweep commands covered current HEAD commit, dirty-state awareness, storage-import quarantine, and architecture risk markers across docs, app source, scripts, migrations, Docker/Nginx, and workflows. The sweep specifically rechecked terms around deferred work, quarantine, single-writer/process-local state, advisory locks, reconcile/baseline behavior, orphan cleanup, drift, and manual/operational hazards.

Relevant active architecture files skipped: none in the runtime source/config/schema/migration/deploy/test-contract set described above. Excluded as non-runtime or non-current evidence: historical `.context/reviews` and `.context/plans` artifacts, generated/build outputs, runtime upload/data directories, untracked env files, and unrelated dirty review files that were already present before this task.

Tests were not run because this was a review-only task and no production code was changed. Validation evidence is the current-HEAD inventory, direct file/line inspection, and targeted final searches described above.

# Architecture Review - Cycle 5/100

Date: 2026-06-29
Reviewer role: architect
Scope: current HEAD only (`2f7895a5`)
Output: report-only; no application code changes

## Inventory And Review Coverage

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the architecture-sensitive surfaces before filing findings. I used current cycle peer reports only to avoid duplicate filings, especially the current critic findings on legacy-original migration deletion, service-worker offline HTML, and disabled semantic-search request work.

Architecture-relevant inventory examined:

- Product and operating contract: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/critic.md`, `.context/reviews/architect.md`
- Deployment and storage topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`
- Database and migration strategy: `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration journal/reconcile tests
- Restore and backup flows: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/advisory-locks.ts`, restore-maintenance/upload-lock tests
- Background processing and data-model boundaries: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/process-topic-image.ts`, upload/delete actions
- Cache and service-worker boundaries: `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`, upload serving routes and headers
- Public/privacy/data access boundaries: `apps/web/src/lib/data.ts`, route/action ownership around uploads, topics, semantic search, and public mutation lint contracts

## Findings

### ARCH-C5-01 - Restore does not quiesce color-pipeline backfills

Severity: High
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:279-340` acquires only `LOCK_DB_RESTORE`, the upload-processing contract lock, starts restore maintenance, flushes shared-group view counts, and quiesces the image-processing queue before `runRestore(...)`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:341-354` ends maintenance and resumes the image queue after `runRestore(...)`, but never coordinates with the color-pipeline backfill lock.
- `apps/web/src/lib/admin-backfill-runner.ts:303-327` protects in-app color backfill with a separate `LOCK_COLOR_PIPELINE_BACKFILL` advisory lock.
- `apps/web/src/lib/admin-backfill-runner.ts:687-701` checks restore maintenance before fetching a batch and immediately before `reprocessOne(...)`, but an already-running `reprocessOne(...)` is not interrupted.
- `apps/web/src/lib/admin-backfill-runner.ts:498-617` holds a per-image processing claim, writes derivatives, detects color metadata, and persists updates by `WHERE id = ${row.id}` at `apps/web/src/lib/admin-backfill-runner.ts:560-573` or `apps/web/src/lib/admin-backfill-runner.ts:597-602`.
- `apps/web/scripts/backfill-color-pipeline.ts:301-311` uses the same color backfill advisory lock for the sidecar script, independent of restore.

Failure scenario:

An admin starts the in-app color backfill or the sidecar backfill script, then starts a database restore while one row is already inside `reprocessOne(...)`. Restore maintenance prevents new batches but does not drain the active re-encode/detect/update window. After the SQL import recreates rows, the old backfill task can update `images` by the pre-restore numeric id. If the restored database contains a different row with that id, stale pipeline metadata and derivative outputs from the old row can be written into the restored gallery. If the row no longer exists, derivative cleanup covers only the specific deleted-mid-reencode path, not the restored-row mismatch.

Concrete fix:

Treat color-pipeline backfill as part of the restore quiescence contract. Acquire `LOCK_COLOR_PIPELINE_BACKFILL` in `restoreDatabase(...)` before `beginRestoreMaintenance()` and release it in the restore `finally`, or expose an abort/drain primitive from `admin-backfill-runner` and wait for all active `reprocessOne(...)` work before SQL import. The sidecar script already uses the same advisory lock, so the same restore acquisition would also fail fast when an operator backfill is running. Add a restore contract test that proves `restoreDatabase(...)` obtains the color backfill lock before `runRestore(...)`, releases it on all paths, and does not resume queues until the lock is released.

### ARCH-C5-02 - Restored databases resume before current migrations/reconcile run

Severity: High
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/Dockerfile:137-143` runs `node apps/web/scripts/migrate.js` only in the container startup command before `server.js`.
- `apps/web/scripts/migrate.js:725-745` defines the migration post-condition that detects missing journal hash rows.
- `apps/web/scripts/migrate.js:771-789` runs legacy upload migration, legacy schema preparation, Drizzle migrations, and admin seeding in the startup migrator.
- `apps/web/src/app/[locale]/admin/db-actions.ts:331-340` restore preparation calls `runRestore(formData, t)` directly after flushing/quiescing.
- `apps/web/src/app/[locale]/admin/db-actions.ts:493-507` resolves a successful restore after temp cleanup, audit logging, and `revalidateAllAppData()`. It does not invoke `migrate.js`, `runMigrations(...)`, or `reconcileLegacySchema(...)`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:341-354` then ends restore maintenance and resumes the image queue.

Failure scenario:

An operator restores a SQL dump from before a current migration, or a dump carrying stale `__drizzle_migrations` rows. The current Next.js process resumes traffic and background work against a schema that may be missing columns, indexes, or repaired baseline rows expected by current code. Requests can fail with MySQL unknown-column errors, queue work can persist incomplete rows, and the Drizzle silent-skip post-condition in `migrate.js` is bypassed until the next container restart or deploy.

Concrete fix:

Run the same migration/reconcile/post-condition path inside the restore maintenance window after `mysql` exits successfully and before `endRestoreMaintenance()` or queue resume. Prefer extracting the reusable migration routine from `scripts/migrate.js` into a module callable by both startup and restore; a lower-risk interim is spawning `node apps/web/scripts/migrate.js` from the restore action with sanitized environment and treating failure as restore failure. Add a restore test/source contract that success cannot resolve until current migrations and reconcile checks have passed.

### ARCH-C5-03 - Backup/restore is database-only while durable gallery state is split across DB and bind-mounted files

Severity: Medium
Confidence: High
Status: Risk

Evidence:

- `apps/web/docker-compose.yml:23-27` persists mutable gallery state across `./data`, `./public/uploads`, `./public/resources`, and read-only `./src/site-config.json`.
- `apps/web/src/app/actions/images.ts:304-408` uploads write originals to filesystem first, then insert DB rows referencing generated filenames.
- `apps/web/src/app/actions/images.ts:653-677` deletes image DB rows transactionally, then removes original and derivative files best-effort afterward.
- `apps/web/src/lib/process-topic-image.ts:72-98` writes topic/resource images as files under the resources store, while DB topic rows reference those filenames.
- `apps/web/src/app/[locale]/admin/db-actions.ts:138-166` creates backups by running `mysqldump` into `data/backups`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:454-518` restores by piping SQL into `mysql`; no upload/resource/site-config snapshot, file manifest, or post-restore file reconciliation is part of the flow.

Failure scenario:

An admin takes a database backup, later deletes photos or replaces topic images, then restores the older SQL dump. The restored DB reintroduces rows pointing at originals, derivatives, or resource images that the filesystem no longer contains. Public pages can render broken image URLs, background processing can skip rows as missing originals, and topic covers can disappear. The reverse direction also leaves orphan files when the restored DB no longer references files that remain on disk. The current implementation may be intentionally named as a DB backup, but operationally it is adjacent to a gallery rollback button while gallery state is not DB-contained.

Concrete fix:

Either narrow the product contract or make the backup atomic. For a DB-only contract, label the admin action and restore result explicitly as database-only and add a post-restore reconciliation report listing DB rows with missing files and files without DB owners. For a full gallery restore contract, quiesce writers and create a snapshot bundle containing SQL plus `data` originals, `public/uploads`, `public/resources`, and the relevant site config, with a manifest and hashes. In either path, add a test or source contract so future UI/docs cannot imply full gallery restore unless file state is included or reconciled.

## Final Missed-Issues Sweep

- Searched restore, queue, in-app backfill, sidecar backfill, advisory-lock, and migration call sites with `rg` after drafting findings.
- Re-checked deployment and storage mounts against the backup/restore implementation.
- Re-checked service-worker/upload cache boundaries and did not re-file the current critic service-worker finding.
- Re-checked migration journal/reconcile contracts; the remaining issue is restore not invoking that existing migrator, not the migrator itself.

## Verification

Static architecture review only. I did not run the full quality gates because this lane changed only the review artifact and did not modify application code.

---

# Architecture Review - Cycle 4/100

Date: 2026-06-29
Reviewer role: architect
Scope: current HEAD only (`10b500bb`)
Output: report-only; no application code changes

## Inventory And Review Coverage

I read `AGENTS.md` and `CLAUDE.md` first, then used the existing review history only to avoid stale duplicates. The prior cycle-3 architect report and aggregate review already covered several known debts: process-local single-instance assumptions, detached embedding backfill, brute-force semantic scans, mutable topic slugs, split public selectors, the `api-auth` to app-action import, and dormant storage abstraction. I did not re-file those unchanged carry-forward items unless current HEAD exposed a new architectural failure mode.

Architecture-relevant inventory examined:

- Product and operational contract: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/architect.md`, `.context/reviews/_aggregate.md`, `.context/reviews/architect-debugger-tracer.md`
- Deployment topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/deploy-remote.js`, `apps/web/deploy.sh`
- Routes and server actions: all files under `apps/web/src/app/**/{route.ts,actions.ts,db-actions.ts}` including upload, restore, public analytics, semantic search, similar search, tokens, settings, admin APIs, health, and image serving
- Core architecture modules: `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/clip-*.ts`, `apps/web/src/lib/semantic-*`, `apps/web/src/lib/storage/**`, `apps/web/src/db/schema.ts`, migration scripts, and reconcile/migrate helpers
- State/cache/client boundaries: service worker cache files, upload serving headers, React/server-only config helpers, public selector privacy guards, embedding and smart collection flows
- Test contracts relevant to architecture: restore/upload locking, LR upload parity, semantic search body limiting, privacy fields, storage quarantine, auth/origin/rate-limit lint contracts, touch-target and product constraint tests

Unrelated review artifacts were already modified in the worktree (`.context/reviews/code-reviewer.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`, `verifier.md`). I left them untouched.

## Findings

### ARCH-C4-01 - Lightroom upload accepts and parses work during restore maintenance

Severity: Medium
Confidence: High
Status: confirmed ordering defect; production timing impact is likely

Code region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:70-75` parses the multipart body with `await request.formData()` immediately after token verification.
- `apps/web/src/app/api/admin/lr/upload/route.ts:126-133` reads `topics` before the restore-maintenance gate.
- `apps/web/src/app/api/admin/lr/upload/route.ts:143-148` checks `isRestoreMaintenanceActive()` only after body parsing, metadata validation, and the topic lookup.
- `apps/web/src/app/[locale]/admin/db-actions.ts:310-340` starts the restore maintenance window, flushes buffered state, quiesces the image queue, then runs the DB restore.
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:176-182` only asserts that the restore guard appears before `db.insert(images)`, so the current test contract allows expensive body parsing and a DB read during restore.

Why this is a problem:

`CLAUDE.md` documents restore as a quiescence boundary for upload/queue/database ownership. The browser upload path has an entry guard before meaningful upload work. The Lightroom route does not: it fully materializes the multipart payload and queries `topics` before recognizing that restore maintenance is active. This makes restore maintenance a late write-prevention guard instead of an early entry gate for one of the two production ingest paths.

Concrete failure scenario:

An operator starts a database restore. At the same time, Lightroom retries or publishes a 100-200 MB photo with a valid token. The route accepts the request, parses the whole multipart body, validates fields, and performs a `topics` SELECT while restore has already started dropping/recreating tables. The user can see a 500/404-style failure instead of a retryable 503, while the single web process spends memory and bandwidth on work that the documented maintenance boundary should reject immediately.

Concrete fix:

Move the restore-maintenance entry check to the top of the handler, immediately after cheap auth/token/IP derivation and before `request.formData()` or any database read. Keep the existing late post-save cleanup/recheck because it still covers the mid-request restore race after the original file has been written. Add a source-contract test that asserts the first `isRestoreMaintenanceActive()` check occurs before both `request.formData()` and the `topics` SELECT, not merely before `db.insert(images)`.

### ARCH-C4-02 - Lightroom cumulative upload quota is enforced after full multipart parsing

Severity: Medium
Confidence: High
Status: confirmed ordering defect; resource-exhaustion impact is likely but bounded to authenticated admin/PAT traffic and nginx caps

Code region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:70-75` reads the full multipart body before quota accounting.
- `apps/web/src/app/api/admin/lr/upload/route.ts:77-80` obtains `fileEntry` only after the body has already been parsed.
- `apps/web/src/app/api/admin/lr/upload/route.ts:210-238` initializes the upload tracker, checks cumulative count/bytes, and pre-claims quota only after the parsed `File` exists.
- `apps/web/nginx/default.conf:122-144` intentionally allows this route to receive bodies up to 216 MiB with an admin burst of 10.
- `apps/web/src/app/api/search/semantic/route.ts:140-174` shows the stronger local pattern for body-risk routes: validate body headers and charge the rate-limit budget before body materialization.
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:229-240` checks that tracker logic exists and settles, but not that it runs before `request.formData()`.

Why this is a problem:

The cumulative upload tracker currently protects the save/insert/enqueue stage, not the request-body boundary. For the Lightroom path, the expensive and memory-sensitive operation is `request.formData()`, because Next/Node must materialize the multipart body before the app can inspect `fileEntry.size`. Enforcing the 429 quota after that point leaves the single deployed web process exposed to avoidable parser, memory, temporary storage, and connection pressure.

Concrete failure scenario:

A compromised Lightroom token, a stuck plugin retry loop, or an authenticated admin client sends several 216 MiB multipart requests inside the nginx admin burst window. Every request can be accepted by nginx and parsed by the Node process before the in-process tracker rejects the later ones. On the documented disk-constrained single-host deployment, this can degrade the only web instance even though the route eventually returns 429 before saving files.

Concrete fix:

After auth and the early restore guard from ARCH-C4-01, add a pre-body gate for Lightroom uploads:

- Reject unsupported transfer encodings where body size cannot be known consistently with the upload policy.
- Parse and validate `Content-Length` before `request.formData()`.
- Pre-claim the upload tracker using `Content-Length` or a conservative declared-upload byte budget before parsing.
- After parsing, settle the claim from the conservative body budget to the actual `fileEntry.size`, preserving the existing rollback-on-failure behavior.

Then add a source-contract test that asserts the LR quota/body preflight and tracker claim occur before `request.formData()`. Keep nginx's 216 MiB cap as an outer limit, but do not rely on it as the only resource boundary for the Node process.

## Healthy Boundaries Reconfirmed

- Restore guard fixes from the prior review are present on LR token mutations, public analytics actions, browser upload/delete/update actions, settings mutations, semantic/similar search, and embedding backfill.
- The single-web-instance topology is explicit in Docker/nginx and consistent with process-local state for restore maintenance, upload tracking, queues, and volatile rate-limit buckets. The remaining risk is architectural scale-out debt, already documented in prior reviews.
- `@/lib/storage` remains quarantined from live runtime imports; current storage ownership is still direct local filesystem paths under the upload pipeline.
- Public data selectors and privacy guards remain centralized in `apps/web/src/lib/data.ts` and backed by tests.
- Upload derivative serving and service-worker cache behavior remain aligned: immutable-ish derivative URLs use ETag/settings hashes and bounded revalidation rather than hiding mutable originals behind long-lived opaque cache entries.
- Product constraints still match documentation in the inspected implementation: no paid/Stripe surface, no edit/culling/scoring workflow, and semantic scoring is confined to search/similar-image ranking.

## Missed-Issues Sweep

Final sweep covered route ordering, restore/queue boundaries, upload quota ownership, public/private data selectors, semantic search boundaries, storage quarantine, cache headers/service worker behavior, deployment body limits, migration/reconcile ownership, and product-constraint keywords. I also checked the cycle-3 report and aggregate notes to avoid re-reporting unchanged known debt.

This was a static architecture/design review only. I did not run lint, typecheck, tests, build, or deploy because the requested output was a report-only review of current HEAD with no application-code edits. Runtime concurrency behavior and production memory pressure are therefore validated by code-order evidence rather than load testing.

Finding count: 2

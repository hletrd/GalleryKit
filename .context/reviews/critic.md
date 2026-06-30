# Cycle 22 Critic Review

Reviewer: cycle 22 critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `85b0291f02cf0ea5839c662d6b4c2233df8e1d2b` on `master`
Source edits: none. This review artifact is the only file written.
Commit/push: intentionally not performed per user instruction.

## Inventory Examined

Guidance and review surface:

- `AGENTS.md:1-49` for workspace git/deploy/schema/quality-gate rules.
- `CLAUDE.md:1-90`, `CLAUDE.md:232-235`, and `CLAUDE.md:642-659` for product scope, topology, tech stack, deploy contract, and operational guidance.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md` for the required review stance.
- Current cycle 22 review artifacts already present at HEAD: `.context/reviews/architect.md:1-163`, `.context/reviews/debugger.md:1-177`, and `.context/reviews/_aggregate.md:1-140`.

Repository breadth checked:

- Current source inventory: 504 TypeScript/TSX files under `apps/web/src`; 789 non-binary tracked paths from `rg --files` after excluding common binary/dependency paths.
- App/router/actions/API: browser upload, Lightroom upload, public search/similar routes, OG routes, admin DB restore/download, public pages, admin pages, map/search/similar clients.
- Domain/runtime libraries: DB pool/schema, image queue, image processing, upload paths/tracker, restore maintenance, queue shutdown, data/public selectors, rate limits, audit/view retention, advisory locks, semantic embeddings, storage quarantine, gallery config/settings hash, serve-upload fallback.
- Deploy/config/docs: root and web `package.json`, `README.md`, `CLAUDE.md`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, migration scripts/journal.
- Tests searched or sampled around source contracts, migration journal, privacy fields, upload tracker, route guards, storage quarantine, serve-upload, backup download, pagination/env parsing, and touch targets.

Validation evidence:

- `git rev-parse HEAD` returned `85b0291f02cf0ea5839c662d6b4c2233df8e1d2b`.
- `git status --short --branch` returned `## master...origin/master`.
- Fresh static inspection and cross-file grep were used for the findings below.
- I did not run full lint/typecheck/build/Vitest/Playwright because this was an artifact-only skeptical review with no source changes. The already-present debugger artifact reports targeted route/action lint guard checks passed at its reviewed HEAD; I did not rely on those checks for new behavior claims except where explicitly noted as a cleared context item.

## Findings

### CRIT22-01 - Upload ingest still has multiple implementation owners

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- Browser upload owns the full ingest lifecycle: quota claim/preflight at `apps/web/src/app/actions/images.ts:238-292`, per-file processing and queue payload at `apps/web/src/app/actions/images.ts:490-531`, and final quota settlement/audit/revalidation at `apps/web/src/app/actions/images.ts:565-610`.
- Lightroom/PAT upload independently mirrors the same lifecycle: auth/maintenance gate at `apps/web/src/app/api/admin/lr/upload/route.ts:68-83`, quota claim/settle at `apps/web/src/app/api/admin/lr/upload/route.ts:114-151`, upload contract/config snapshot at `apps/web/src/app/api/admin/lr/upload/route.ts:243-275`, HDR/GPS gates at `apps/web/src/app/api/admin/lr/upload/route.ts:348-385`, and queue payload at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- A shared settings snapshot type exists at `apps/web/src/lib/image-queue.ts:92-120`, but both ingest adapters manually thread fields into queue jobs.
- The Lightroom route carries repeated parity-fix comments for previously missed drift: settings at `apps/web/src/app/api/admin/lr/upload/route.ts:489-505`, captions at `apps/web/src/app/api/admin/lr/upload/route.ts:506-515`, HDR at `apps/web/src/app/api/admin/lr/upload/route.ts:348-365`, and GPS at `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`.

Concrete failure scenario:

A future upload-time setting, metadata column, or photographer-intent gate is added to dashboard uploads and tests only cover that route. Lightroom publishes then diverge in GPS stripping, HDR rejection, color metadata, captions, semantic embedding mode, audit payloads, or processing settings. The defect may be invisible until a photographer compares exports from the two ingest paths or a later backfill rewrites derivatives.

Suggested fix:

Extract a server-only ingest service that owns config snapshotting, quota claim/settle, original save, GPS/HDR gates, insert DTO, tag hooks, audit payload shape, and queue job construction. Keep browser and Lightroom routes as thin request adapters. Add source-contract tests that fail when `ProcessingSettingsSnapshot`, queue job fields, or persisted ingest metadata can be supplied by one adapter but omitted by the other.

### CRIT22-02 - Queue workers can pin most of the shared MySQL pool during image encoding

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- The shared MySQL pool is fixed at 10 connections with queue limit 20 in `apps/web/src/db/index.ts:23-33`.
- Foreground image queue concurrency can be configured up to 8 in `apps/web/src/lib/image-queue.ts:87-90`.
- Each job checks out a shared pool connection for a MySQL advisory lock and returns that connection as the lock handle in `apps/web/src/lib/image-queue.ts:446-455`.
- The lock connection remains checked out while the job validates the image row, resolves the original, runs `processImageFormats`, verifies generated files, and updates `images` in `apps/web/src/lib/image-queue.ts:519-657`.
- The lock connection is released only in final cleanup at `apps/web/src/lib/image-queue.ts:812-815`.
- The codebase already applies a safer pool-budget pattern for admin backfill: reserve live headroom in `apps/web/src/lib/admin-backfill-runner.ts:105-141`, then clamp the runtime queue in `apps/web/src/lib/admin-backfill-runner.ts:667-678`.

Concrete failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` to process a large import. Eight jobs can hold eight of ten shared pool connections across AVIF/WebP/JPEG Sharp work. Live page renders, login/session checks, public search, upload actions, queue DB writes, and admin pages then compete for two remaining connections and a 20-item wait queue. The app can return 500/503 symptoms even though MySQL and Sharp are individually healthy.

Suggested fix:

Do not hold shared-pool advisory-lock connections across image encoding. Prefer a durable row-claim state transition, a dedicated small advisory-lock pool, or a foreground queue cap derived from `POOL_CONNECTION_LIMIT` with reserved live headroom, mirroring the backfill runner arithmetic. Add a stress/source-contract test that proves foreground queue settings cannot consume the same pool headroom reserved for live traffic.

### CRIT22-03 - Single-process topology is documented but not enforced

Severity: Medium
Confidence: High
Status: Risk

Evidence:

- `CLAUDE.md:232-235` explicitly says the shipped deployment is single web-instance/single-writer and lists process-local state.
- Restore maintenance is a process-local `globalThis` flag in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota and active-upload tracking are a process-local `globalThis` `Map` in `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Shared-group view counts are buffered in module-local memory in `apps/web/src/lib/data.ts:13-41` and flushed during shutdown in `apps/web/src/instrumentation.ts:18-65`.
- Queue bootstrap runs per process at `apps/web/src/instrumentation.ts:1-6`, while queue state/concurrency is process-local in `apps/web/src/lib/image-queue.ts:76-90`.
- Compose currently declares one web service in `apps/web/docker-compose.yml:1-28`, but there is no startup lease or writer-count assertion that fails if a second process joins the same DB/upload tree.

Concrete failure scenario:

A future operator starts a second web process behind the same reverse proxy for availability. Process A begins a DB restore and sets only its own maintenance flag. Process B does not see that flag, can accept uploads, can keep its own upload quota map and rate-limit buckets, can run queue bootstrap, and can buffer analytics during the restore window. That violates the single-writer restore and photographer-original integrity assumptions without an immediate fatal signal.

Suggested fix:

Make the topology executable. If single-writer remains the product contract, acquire a startup DB advisory lease and fail fast with an operator-facing error when another writer is active. If multi-process support is desired, move restore state, upload quota tracking, relevant public rate-limit buckets, queue ownership, and buffered analytics to shared durable coordination.

### CRIT22-04 - `topics.slug` is a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `topics.slug` is the primary key in `apps/web/src/db/schema.ts:4-12`.
- Direct slug foreign keys exist in `topicAliases.topicSlug` at `apps/web/src/db/schema.ts:14-17`, `images.topic` at `apps/web/src/db/schema.ts:19-34`, and `topicViews.topic` at `apps/web/src/db/schema.ts:239-242`.
- Smart collections store topic predicates inside JSON rather than through FK-backed relations in `apps/web/src/db/schema.ts:297-306`.
- Rename is implemented as create-new/update-dependents/remap-JSON/delete-old in `apps/web/src/app/actions/topics.ts:255-339`.
- The rename block already documents past missed-sibling classes: analytics cascade loss in `apps/web/src/app/actions/topics.ts:292-301` and smart-collection JSON remapping in `apps/web/src/app/actions/topics.ts:303-335`.

Concrete failure scenario:

A new analytics table, collection predicate, cache key, or integration payload starts storing topic slugs. The rename transaction is not updated. A later slug rename then leaves stale references that render empty topic/collection pages, lose analytics through cascade, or make photographer-visible organization differ from admin intent.

Suggested fix:

Use immutable surrogate topic IDs for relational ownership and keep slug as a unique mutable route attribute with optional slug history. If that migration is too large, centralize all slug referrers in a rename registry/remapper and add tests that fail when a schema/JSON referrer is added without a corresponding rename-path update.

### CRIT22-05 - `CLAUDE.md` still documents compose commands that bypass `.env.local` build args

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- `README.md:180-190` gives the corrected manual command: `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`.
- The deploy helper also uses the explicit env file in `apps/web/deploy.sh:30-32`.
- `CLAUDE.md:66-68` and `CLAUDE.md:642-659` still document `docker compose -f apps/web/docker-compose.yml up -d --build` without `--env-file`.
- Compose build args read `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` from the Compose interpolation environment in `apps/web/docker-compose.yml:4-11`; the runtime `env_file` is a separate setting in `apps/web/docker-compose.yml:18-22`.

Concrete failure scenario:

An operator follows `CLAUDE.md`, puts production values only in `apps/web/.env.local`, and runs the stale compose command. The running container receives runtime env from `env_file`, but the image build used empty/default build args. Next build-time behavior can then miss CDN remote patterns or bake different upload body limits than the runtime configuration suggests.

Suggested fix:

Update both `CLAUDE.md` command sites to match README and `deploy.sh`. Add a docs source-contract test that scans documented `docker compose ... --build` commands and requires `--env-file apps/web/.env.local`, unless the surrounding text explicitly instructs operators to export every build arg in the shell first.

### CRIT22-06 - Upload quota settlement is still protected by comments instead of structure

Severity: Medium
Confidence: High
Status: Risk

Evidence:

- Browser upload pre-claims quota synchronously in `apps/web/src/app/actions/images.ts:238-242`.
- `apps/web/src/app/actions/images.ts:271-279` documents the invariant: any awaited work added between claim and final settlement must roll the claim back on throw.
- Current explicit settlement points exist at `apps/web/src/app/actions/images.ts:257-264`, `apps/web/src/app/actions/images.ts:286-292`, `apps/web/src/app/actions/images.ts:570-571`, and `apps/web/src/app/actions/images.ts:595-596`.
- `apps/web/src/app/actions/images.ts:540-548` calls out a post-claim cleanup await that is safe only while `deleteOriginalUploadFile` never rejects.
- `apps/web/src/lib/upload-paths.ts:71-77` currently satisfies that contract by swallowing unlink failures.
- The Lightroom route has a better idempotent settlement closure at `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`.

Concrete failure scenario:

A future validation or cleanup step is added after the browser quota claim, or `deleteOriginalUploadFile` is changed to surface filesystem failures. A transient DB/filesystem error escapes before settlement. The outer cleanup path releases the upload-processing lock but does not settle the upload tracker, leaving failed bytes/files charged until the one-hour tracker window rolls over and causing legitimate uploads to be rejected.

Suggested fix:

Use the Lightroom route's structured pattern in the browser action: one idempotent `claimSettled` helper wrapped in a `try/finally` covering the whole post-claim span. Preserve current success/all-failed settlement semantics, but have the finally settle `(0, 0)` if no earlier settlement ran. Add a regression/source-contract test for a thrown post-claim await.

### CRIT22-07 - Audit retention deletes all expired rows in one statement

Severity: Low
Confidence: High
Status: Likely

Evidence:

- `apps/web/src/lib/audit.ts:97-122` validates retention input and then runs one unbounded `db.delete(auditLog).where(lt(auditLog.created_at, cutoff))`.
- The analogous analytics retention path uses bounded chunk deletion with `.limit(VIEW_PURGE_BATCH)` and an iteration cap in `apps/web/src/lib/view-retention.ts:64-87`.

Concrete failure scenario:

On a long-lived site, audit rows accumulate beyond the normal small-gallery expectation. The retention purge issues one large MySQL delete transaction, generating unnecessary lock/undo/redo pressure and potentially delaying admin writes that also insert audit rows. This is not a mass-delete correctness bug after the retention parsing fixes; it is an operational boundedness gap.

Suggested fix:

Mirror `purgeOldViewEvents`: delete expired audit rows in conservative batches with a per-run cap, return or log the deleted count, and add coverage that proves retention deletes are bounded rather than one unbounded statement.

### CRIT22-08 - Upload fallback serving validates one path and streams a later path by name

Severity: Low
Confidence: Medium
Status: Risk

Evidence:

- `apps/web/src/lib/serve-upload.ts:175-184` performs `lstat`, rejects symlinks/non-files, resolves `realpath`, and checks the resolved path stays inside the upload root.
- `apps/web/src/lib/serve-upload.ts:216-217` builds the ETag from the earlier `lstat` result.
- `apps/web/src/lib/serve-upload.ts:263-269` then opens `createReadStream(resolvedPath)` by pathname; the comment explicitly notes this is not descriptor-backed validation.
- The admin backup download route already shows the safer descriptor-backed pattern: open handle, stat handle, and stream the same handle in `apps/web/src/app/api/admin/db/download/route.ts:42-90`.

Concrete failure scenario:

A same-host actor or compromised side process with write access to the upload tree swaps the target after validation but before `createReadStream`. The route can stream bytes from a different inode than the one used for validation and ETag calculation. This is not a remote exploit under the documented trust model, but it leaves public file serving dependent on same-host trust rather than descriptor-backed invariants.

Suggested fix:

Open the file once with `fs.promises.open`, run `fh.stat()` on that descriptor, reject non-regular files, build headers from the descriptor stat, and stream via `fh.createReadStream({ autoClose: true })`. Keep the upload-root realpath check for path traversal, but make the served bytes come from the same object that was validated.

## Cleared Checks And Non-Findings

- The cycle 21 semantic-embedding restore race appears closed at current review state. The debugger artifact records restore acquiring same-session advisory locks and embedding backfills now use a restore-conflicting lock; I did not reopen it.
- The previous backup-download descriptor leak appears closed: `apps/web/src/app/api/admin/db/download/route.ts:42-96` tracks the opened handle and closes it if an error occurs before stream ownership transfers.
- README's manual compose command is fixed at `README.md:187-189`; the remaining documentation drift is specifically in `CLAUDE.md`.
- The storage abstraction remains quarantined. `apps/web/src/lib/storage/index.ts:1-18` says it is not wired into the live pipeline, and source grep found no production imports outside `lib/storage`; `apps/web/src/__tests__/storage-quarantine.test.ts` is the guard surface.
- The deployment root/build context false alarm was checked and not reported: `apps/web/docker-compose.yml:4-7` uses `context: ../..` relative to the compose file path, which resolves to the repository root for this layout.
- I did not find a new photographer-intent breach in the inspected color/HDR/GPS surfaces beyond the ingest duplication risk above; the larger risk is future parity drift between browser and Lightroom ingestion, not a confirmed current mismatch.

## Final Sweep / Skipped Files

Final sweep covered product correctness, maintainability, photographer intent, deployment, documentation truthfulness, edge cases, and hidden coupling across the live source, deploy, schema, and docs surfaces listed in the inventory.

Skipped or not line-read exhaustively:

- Binary/photo assets, generated screenshots, runtime logs, `.git`, `.omx` runtime state, and dependency directories.
- Gitignored local env files were not reproduced or used as evidence.
- Historical review/archive markdown and `.context/plans/` were searched/sampled for carried risks rather than read line-by-line.
- The full `apps/web/src/__tests__/` tree was not read line-by-line; targeted tests/source-contracts relevant to the reviewed invariants were inspected or searched.
- Full lint/typecheck/build/Vitest/Playwright and live deploy were not run because this was a read-only critic review with no source changes.

No critical or high-severity new source bug was confirmed at current HEAD. The actionable residuals above are medium/low risks with concrete failure scenarios and exact source evidence.

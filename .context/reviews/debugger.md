# Cycle 20 Debugger Review

Review lane: `debugger`  
Date: 2026-06-30 KST  
Mode: repository-wide latent bug / failure-mode / regression review. No implementation code was changed. No commit or push was made.

## Inventory

Primary guidance and workflow inputs read:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- Prior cycle artifacts: `.context/reviews/debugger.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-20-deferred.md`

Repository inventory performed before findings:
- Counted tracked source/doc/config surface, excluding generated `.next`: `api=8`, `actions=13`, `lib=97`, `components=57`, `unit_tests=269`, `e2e=8`, `scripts=27`, `drizzle=31`, `config=14`.
- Inventoried app routes and server actions under `apps/web/src/app`, including public/admin APIs, upload serving, feeds, OG routes, health/live probes, semantic search, similar search, DB admin actions, and all action modules.
- Inspected bug-prone source regions across uploads, Lightroom upload, delete paths, DB backup/restore, restore maintenance, upload-processing locks, image queue, CLIP inference queue, public rate limits, OG rendering, backup download, audit retention, migration/deploy scripts, and nginx/Docker config.
- Compared adjacent implementations and tests for zero-row mutation handling, rollback accounting, child-process watchdogs, route runtime pins, privacy select guards, and cleanup paths.

## Confirmed Findings

### DBG20-01 - DB child-process SIGKILL fallback is inert after SIGTERM

Severity: High  
Confidence: High  
Status: Confirmed

Code regions:
- `apps/web/src/app/[locale]/admin/db-actions.ts:36-57` defines the shared 30-minute child-process watchdog.
- `apps/web/src/app/[locale]/admin/db-actions.ts:52-55` sends `SIGTERM`, then checks `if (!child.killed)` before sending `SIGKILL`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:217-224` arms the watchdog for `mysqldump`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:629-631` arms it for `mysql` restore import.
- `apps/web/src/app/[locale]/admin/db-actions.ts:720-724` arms it for post-restore migrations.

Root-cause hypothesis:
`ChildProcess.killed` becomes true once a signal was successfully sent, not when the process has actually exited. After `child.kill('SIGTERM')`, the grace timer usually sees `child.killed === true`, so it never sends the intended `SIGKILL`.

Failure scenario:
A wedged `mysql`, `mysqldump`, or migration child ignores or does not promptly handle `SIGTERM`. The action resolves failure and the surrounding restore/backup flow proceeds, but the child can remain alive past the grace period. The restore case is most dangerous: `failRestore()` returns `keepMaintenance: true`, while the outer `finally` still releases DB/backfill/upload locks. A still-running `mysql` import can continue mutating the DB after the request has reported failure and coordination locks are gone.

Suggested fix:
Track actual process exit with a local `exited` flag set from `exit`/`close`, or use `child.exitCode !== null || child.signalCode !== null`/an equivalent settled flag. The grace timer should send `SIGKILL` unless exit was observed. Add a unit/source test that simulates timeout and asserts both `SIGTERM` and delayed `SIGKILL` are attempted when no exit event fires.

### DBG20-02 - Smart-collection load-more refunds after protected DB work

Severity: Medium  
Confidence: High  
Status: Confirmed

Code regions:
- `apps/web/src/app/actions/public.ts:197-203` pre-increments the public load-more limiter.
- `apps/web/src/app/actions/public.ts:207-211` looks up `getSmartCollectionBySlugCached(slug)`, then rolls back the limiter when the collection is missing or private.
- `apps/web/src/lib/rate-limit.ts:24-57` documents that public DB/CPU routes should stay charged once protected work begins.

Root-cause hypothesis:
The smart-collection path reuses a fairness-style rollback helper after a DB lookup, while the route’s protected resource is the lookup/query work itself. That makes invalid/private slugs cheaper than successful requests.

Failure scenario:
A caller repeatedly probes syntactically valid but nonexistent or private collection slugs. Every request performs a collection DB/cache lookup and then gets refunded, so the limiter no longer represents consumed DB work and the endpoint becomes a low-cost enumeration/resource-amplification surface.

Suggested fix:
Keep nonexistent/private collection responses charged after `getSmartCollectionBySlugCached()` runs. Add a regression around `loadMoreSmartCollectionImages` proving the invalid/private post-lookup branch does not call `rollbackLoadMoreAttempt`.

### DBG20-03 - Single-image delete can report success after deleting zero rows

Severity: Low  
Confidence: Medium  
Status: Confirmed race, low impact

Code regions:
- `apps/web/src/app/actions/images.ts:645-655` selects the image before deletion.
- `apps/web/src/app/actions/images.ts:685-691` deletes rows and stores `deletedRows`.
- `apps/web/src/app/actions/images.ts:693-697` only suppresses audit logging when `deletedRows === 0`.
- `apps/web/src/app/actions/images.ts:699-720` still attempts file cleanup, revalidation, and returns `{ success: true }`.

Root-cause hypothesis:
The action handles the audit duplicate case but does not make the post-transaction behavior conditional on the row actually being deleted.

Failure scenario:
Two admins delete the same image concurrently. Both select the row. The first transaction deletes it. The second transaction deletes zero rows but still runs cleanup/revalidation and returns success. File cleanup is mostly idempotent, so this is not data loss, but the UI receives a stale success and cleanup failures/noise can be attributed to a request that did not delete anything.

Suggested fix:
If `deletedRows === 0`, return the same stale/not-found shape used for missing images and skip file cleanup/revalidation. Keep the existing audit suppression. Add a concurrency/source regression similar to the tag/topic zero-row handling tests.

### DBG20-04 - Audit retention purge is a single unbounded DELETE

Severity: Low operational risk  
Confidence: High  
Status: Confirmed

Code regions:
- `apps/web/src/lib/audit.ts:97-122` computes the retention cutoff and deletes all matching audit rows in one statement.
- `apps/web/src/lib/view-retention.ts:31-83` shows the established chunked-retention pattern for high-volume analytics tables.

Root-cause hypothesis:
Audit retention inherited the simple delete shape after retention parsing was hardened, but it was not updated to the repo’s newer chunked-delete convention.

Failure scenario:
If audit volume grows or retention is lowered after a long-running instance, the hourly GC can issue one large `DELETE` against `audit_log`, holding locks and generating a large transaction. Today audit volume is likely low, so this is operationally gated, but it is asymmetric with view retention’s bounded cleanup.

Suggested fix:
Delete audit rows in bounded chunks with a per-run iteration cap, mirroring `purgeOldViewEvents()`. Keep the existing positive-retention parsing tests and add a chunking/source or unit regression.

## Likely / Validation Risks

### DBG20-RISK-01 - Failed restore keeps maintenance active without an evident in-app recovery path

Severity: Medium operational risk  
Confidence: Medium  
Status: Risk needing validation

Code regions:
- `apps/web/src/app/[locale]/admin/db-actions.ts:450-462` ends restore maintenance only when restore succeeded or `keepMaintenance` is false.
- `apps/web/src/app/[locale]/admin/db-actions.ts:618-628` resolves stream/stdin/timeout failures with `keepMaintenance: true`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:650-679` keeps maintenance after post-restore migration failure or nonzero `mysql` exit.
- `apps/web/src/lib/restore-maintenance.ts:1-60` stores maintenance state process-locally.

Root-cause hypothesis:
Fail-closed maintenance is correct when DB state may be partially restored, but recovery appears to depend on process restart or manual intervention rather than an explicit admin/operator recovery path.

Failure scenario:
A restore import partially applies and then fails, or post-restore migration fails. The app remains in restore maintenance, public/admin mutations stay blocked, and image processing remains paused. If the UI does not expose a deliberate recovery action or runbook, operators may see a stuck app with no obvious next step.

Suggested fix:
Validate the admin UI/recovery path. If absent, add an explicit operator-only recovery action with strong warning text, or document the manual recovery procedure where the DB restore UI surfaces the failed-maintenance state. Preserve fail-closed behavior for uncertain partial restores.

### DBG20-RISK-02 - Backup download validation and stream can diverge under same-host replacement

Severity: Low  
Confidence: Medium  
Status: Risk needing validation

Code regions:
- `apps/web/src/app/api/admin/db/download/route.ts:50-64` validates `lstat()`/`realpath()` and containment.
- `apps/web/src/app/api/admin/db/download/route.ts:72-84` opens a new stream from the earlier realpath and sends the earlier `stats.size` as `Content-Length`.

Root-cause hypothesis:
The route validates by path, then opens by path later. It reduces symlink/path traversal risk, but does not bind metadata and stream contents to the same file descriptor.

Failure scenario:
A same-host process with write access to `data/backups` replaces a backup file after validation but before `createReadStream()`. The response can stream bytes from a different file state while advertising the old `Content-Length`. This is mostly a local-admin trust-boundary issue, not a remote exploit.

Suggested fix:
Use descriptor-backed `open`/`fstat`/streaming so validation, `Content-Length`, and bytes come from the same file handle, or explicitly document backup-directory write access as trusted local operator capability.

### DBG20-RISK-03 - Topic OG tag parser allocates the full query value before taking 20 tags

Severity: Low  
Confidence: Medium  
Status: Likely, infrastructure-dependent

Code regions:
- `apps/web/src/app/api/og/route.tsx:35-39` accepts `tags` without a route-local max length.
- `apps/web/src/app/api/og/route.tsx:84-88` calls `tags.split(',')` before `slice(0, 20)`.

Root-cause hypothesis:
The rendered output is bounded to 20 tags, but parsing is not bounded to 20 candidate tokens or a maximum input length.

Failure scenario:
An unusually large admitted `tags` query allocates and filters an array for every comma-separated segment even though only 20 tags are rendered. Production proxy URL limits may blunt this, but the route itself does not express the bound.

Suggested fix:
Reject excessive `tags.length` before splitting, or replace the split chain with a small parser that stops after 20 candidate tags.

## Positive Debugging Evidence / Non-Findings

- Adjacent delete actions for topics, tags, and smart collections check `affectedRows === 0` before success; the stale-success race is isolated to single-image delete in the inspected action set.
- Browser upload and Lightroom upload both have preclaim/settle paths, disk checks, topic-existence checks, late restore-maintenance cleanup, GPS/HDR gates, and upload-processing contract locks.
- Image queue processing uses per-image advisory locks, validates filenames before enqueue, retries processing/claim failures, persists permanent failures, cleans derivatives on delete-during-processing, and drains tracked caption/embedding side effects on shutdown/restore.
- Semantic text search now threads `request.signal` into `embedTextReal`; `clip-model.ts` removes aborted waiters and re-checks abort after slot acquisition.
- Admin API and public route lint fixtures exist for auth/rate-limit invariants; source scans did not find a new unwrapped admin API route or public mutating API route without the expected scanner coverage.
- Privacy-sensitive public selects are centralized/guarded; I did not find a public data path selecting original filenames, user filenames, uploaded-by IDs, raw GPS coordinates, or admin-only color/HDR diagnostics outside documented admin/map behavior.

## Final Missed-Issue Sweep

Final sweep covered:
- Route/action inventories, auth/origin wrappers, public route rate-limit policies, rollback helpers, and source-contract tests.
- Upload and LR upload quota settlement, cleanup after failed saves/inserts, queue enqueueing, and restore-maintenance races.
- DB backup/restore child processes, advisory locks, restore maintenance, temp-file cleanup, post-restore migrations, backup download streaming, and deploy/migration scripts.
- Image queue retry/permanent-failure transitions, bootstrap continuation, CLIP embedding side effects, shutdown/restore drains, and stale delete cleanup.
- Public OG/feed/search/similar/upload-serving routes, analytics fire-and-forget inserts, smart collection parsing, sitemap/feed freshness, and resource bounds.
- Schema/migrations/journal/reconcile paths, privacy-field guards, lint scripts, Docker/nginx config, and prior cycle deferred findings.

Validation evidence:
- Static review and source scans only; I did not run full lint/typecheck/test/build gates because this assignment requested a review artifact only and no implementation changes.
- Exact file/line references above were taken from the current workspace with `nl -ba`/`rg`.
- Existing uncommitted review artifacts were present before this lane; this file is the only path intentionally changed.

Final count:
- High: 1
- Medium: 1
- Low: 2
- Validation risks: 3

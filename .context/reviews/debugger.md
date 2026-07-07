# Debugger Review - Cycle 13

Date: 2026-07-07 KST  
Reviewer lane: debugger  
HEAD reviewed: `bafe639d`  
Scope: latent bug/failure-mode review for regressions, null/undefined paths, async errors, recovery behavior, transactional consistency, deployment/runtime mismatches, and tests that may hide failures.

Constraints honored: review-only; no application source, plan, database, service, commit, push, or deploy changes. The only write is this review artifact.

## Inventory Of Bug-Prone Files

Read first:

- AGENTS instructions supplied for `/Users/hletrd/flash-shared/gallery`.
- `CLAUDE.md`.
- Code review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`.

Primary high-risk inventory examined:

- Upload/write paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker-state.ts`.
- Restore/backup/migration paths: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`.
- Runtime/deploy mismatch paths: `apps/web/src/instrumentation.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/single-writer-guard.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/next.config.ts`.
- Auth/admin mutation paths: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/sharing.ts`.
- Public expensive/read paths: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, share pages under `apps/web/src/app/[locale]/(public)/s/[key]` and `g/[key]`.
- Data/search/privacy paths: `apps/web/src/lib/data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, smart collection/search helpers.
- Tests likely to hide failures: source-contract tests in `apps/web/src/__tests__`, gated E2E in `apps/web/e2e`, gated CLIP integration tests, restore/db-pool source scans.

## Findings

### DBG13-01 - Timed-out DB child processes may never be force-killed

Severity: High  
Confidence: High  
Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:44-81` (`armDbChildProcessWatchdog`)
- `apps/web/src/app/[locale]/admin/db-actions.ts:243-249` (backup timeout callback)
- `apps/web/src/app/[locale]/admin/db-actions.ts:818-820` (restore timeout callback)
- `apps/web/src/app/[locale]/admin/db-actions.ts:929-934` (post-restore migration timeout callback)
- Test that misses it: `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:9-16`

Concrete failure scenario:

1. `mysqldump`, `mysql`, or the post-restore migration child hangs past `DB_CHILD_PROCESS_TIMEOUT_MS`.
2. The watchdog timeout sets `fired = true` and calls `onTimeout(err)` at `db-actions.ts:61-65`.
3. The caller's timeout handler resolves failure; the restore path calls `failRestore()`, which calls `clearRestoreWatchdog()` at `db-actions.ts:807-816`.
4. `clearRestoreWatchdog()` does not clear the already-fired timeout, but it still calls `markSettled()` at `db-actions.ts:76-80`. That sets `childSettled = true` before the process has emitted `exit` or `close`.
5. The timeout callback then continues and arms the SIGKILL grace timer at `db-actions.ts:69-71`, but the timer's guard sees `childSettled === true`, so it never sends SIGKILL.

Impact:

- A `mysql` restore process that ignores or stalls after SIGTERM can keep importing into the database after the admin action already returned failure and while restore maintenance may later be cleaned up by outer control flow.
- A hung `mysqldump` can continue holding resources and writing/holding pipes after the backup action reports failure.
- A wedged post-restore migration child can survive the failure resolution, leaving maintenance/recovery state harder to reason about.

Why tests hide it:

- The regression test only asserts that the source contains `childSettled`, `exit`/`close` listeners, and `if (!childSettled) child.kill('SIGKILL')` (`cycle-20-source-contracts.test.ts:9-16`). It does not execute the timeout path or verify that calling the returned clear function from `onTimeout` cannot mark the child settled prematurely.

Suggested fix:

- Keep actual child settlement separate from watchdog cleanup. The returned clear function should not call `markSettled()` after the timeout has fired; it should only remove listeners/clear timers for non-timeout success/error paths.
- Alternatively, in the timeout callback, send SIGTERM and arm SIGKILL before invoking `onTimeout`, and let only real `exit`/`close` events set `childSettled`.
- Add a behavioral unit test with a fake child emitter: trigger the timeout, have `onTimeout` call the returned clear function, do not emit `exit`/`close`, advance the grace timer, and assert `kill('SIGKILL')` was called.

### DBG13-02 - DB pool init timeout releases a still-busy connection back to the pool

Severity: Medium  
Confidence: High  
Files/regions:

- `apps/web/src/db/index.ts:68-75` (per-connection `SET group_concat_max_len` init promise)
- `apps/web/src/db/index.ts:102-119` (10s init timeout catch path)
- `apps/web/src/db/index.ts:126-142` (`query`/`execute` wrappers depend on initialized `getConnection`)
- Test that misses it: `apps/web/src/__tests__/db-pool-connection-handler.test.ts:33-43`

Concrete failure scenario:

1. MySQL accepts a pooled TCP connection, but the per-connection `SET group_concat_max_len = 65535` query hangs or is delayed beyond 10 seconds.
2. `getConnection()` races the init promise against `initTimeout` and enters the `catch` at `db/index.ts:109-117`.
3. The code calls `connection.release()` at `db/index.ts:110` even though the original init query may still be in flight on that connection.
4. The same physical connection can be returned to the pool while it is still processing the init command. A later app query may queue behind the stuck `SET`, see protocol-order surprises, or inherit a connection whose session init state is unknown.

Impact:

- Under DB overload or a network stall, the intended fail-fast path can poison the shared pool instead of retiring the suspect connection.
- Because `poolConnection.query` and `poolConnection.execute` are routed through this wrapper, the failure can affect broad request traffic, not just CSV/tag aggregation.

Why tests hide it:

- `db-pool-connection-handler.test.ts:33-43` is a source scan that verifies `Promise.race([initPromise, initTimeout])` exists. It does not simulate a hanging init promise or assert that the connection is destroyed rather than released on timeout.

Suggested fix:

- On init timeout, destroy the connection instead of releasing it to the pool. Since the init promise's `.catch()` already swallows query errors at `db/index.ts:70-74`, the `Promise.race` catch is effectively the timeout path; if you later let real init failures reject, split timeout vs. fast query failure deliberately.
- Add a behavioral test around a mocked pool connection where the init promise never settles, then assert `destroy()` is called and `release()` is not.

### DBG13-03 - Runtime-critical failure modes are protected by source-contract tests that can pass while behavior is broken

Severity: Low  
Confidence: High  
Files/regions:

- `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:9-16`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts:33-43`
- `apps/web/src/__tests__/db-restore.test.ts:47-74`
- Gated runtime suites: `apps/web/e2e/admin.spec.ts:7-12`, `apps/web/e2e/origin-guard.spec.ts:29-77`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`

Concrete failure scenario:

- DBG13-01 and DBG13-02 both survive current coverage because the tests assert substrings and rough ordering, not behavior under timers, process events, or pool timeouts.
- Restore cleanup tests at `db-restore.test.ts:47-74` check that cleanup phrases exist in the source, but they do not execute the child-process timeout/error paths or verify durable maintenance state transitions.
- Admin E2E and CLIP integration are appropriately gated for credentials/model weights, but default local `npm test --workspace=apps/web` can still pass without exercising the highest-risk deployed behavior.

Suggested fix:

- Keep source-contract tests only as guardrails for static invariants, but add behavior tests for the critical runtime mechanisms:
  - child-process watchdog timeout/SIGKILL behavior,
  - restore failure cleanup and `keepMaintenance` decisions,
  - DB pool init timeout connection disposal.
- Continue running the scheduled CLIP preflight (`.github/workflows/clip-preflight.yml:1-45`), but treat it as separate evidence from default unit coverage in release notes/review summaries.

## Notable Non-Findings / Rejected Candidates

- Upload accepted during restore: rejected. Restore acquires the upload processing contract lock before durable maintenance and drains; browser and Lightroom uploads use the same lock through insert/enqueue.
- Upload quota/claim rollback drift: rejected by inspection of browser upload and Lightroom route claim settlement, cleanup, and over-limit branches.
- Queue lost jobs on transient processing failure: rejected. Failed processing persists `processed=false`, error/failure metadata, bounded retries, startup bootstrap, and manual retry clearing.
- Semantic search accidentally enabling production mode: rejected. Config resolution and queue runtime both gate `production` on `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`; admin UI rejects production selection.
- Restore SQL scanner obvious bypass: rejected after reviewing chunk/tail handling, app table write target checks, dangerous statement checks, and `sql-restore-scan` tests.
- Public search/share rate-limit obvious bypass: rejected. Expensive public handlers pre-increment before expensive work and scanners exist for public route coverage.
- Privacy-sensitive admin columns leaking through public data: rejected by `data.ts` select/omit patterns and privacy field tests.
- Graceful shutdown missing entirely: rejected. `instrumentation.ts` owns SIGTERM/SIGINT, drains queue/background writes/view buffers, and Dockerfile sets `NEXT_MANUAL_SIG_HANDLE=true`; DBG13-01 is the narrower child-process timeout issue.

## Final Missed-Issue Sweep

- Re-ran static sweeps for `catch`, `Promise`, `setTimeout`, `spawn`, `process.exit`, `GET_LOCK`, `RELEASE_LOCK`, `.skip`, `.only`, `TODO`, `FIXME`, and source-test patterns across `apps/web/src`, `apps/web/scripts`, and `apps/web/e2e`.
- Rechecked restore/backup/migration flows end to end: lock order, durable maintenance, drain timeouts, SQL scan, temp cleanup, post-restore migration, migration reconcile/baseline, and journal cursor behavior.
- Rechecked image ingest flows: browser upload, Lightroom upload, settings snapshot capture, disk precheck, GPS strip, HDR/metadata gates, queue enqueue, retry/permanent failure, bootstrap resume, shutdown/recovery.
- Rechecked admin write flows: auth/session, password/user management, topic/tag/share/settings actions, same-origin guards, mutation barrier use, advisory locks, and audit side effects.
- Rechecked public flows: pagination, semantic/similar search, share pages, view analytics, rate-limit pre-increment behavior, and data privacy select sets.
- Rechecked deploy/runtime files: Docker PID/signal path, healthcheck, prune policy, host networking, env/TLS config, singleton warning guard, background DB write drains, and maintenance scheduler.

## Residual Risk

- This was a debugger source-review lane, not a full verification run. I did not run the full lint/typecheck/build/Vitest/Playwright suite or real MySQL restore drills.
- Existing unrelated modified review artifacts were present before this write: `.context/reviews/architect.md`, `critic.md`, `document-specialist.md`, `security-reviewer.md`, `test-engineer.md`, and `tracer.md`. I did not touch them.

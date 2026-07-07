# Debugger Review - Cycle 17

Date: 2026-07-08 KST
Reviewer lane: debugger subagent
Scope: whole-repository latent bug and failure-mode review, focused on regressions, error paths, lifecycle gaps, race conditions, crashes, surprising runtime states, and bugs tests may miss.

Constraints honored: review-only; no fixes, no database/service changes, no deploy, no commit, no push. The only write is this review artifact.

## Inventory And Coverage

Required instructions and repo context read before judging behavior:

- `AGENTS.md`
- `CLAUDE.md`, especially architecture, restore/race protections, schema/migration rules, deploy/runtime topology, semantic-search activation, CLIP backfill, and quality gates
- `.context/reviews/prompts/common_review_scope.md`
- `.context/reviews/prompts/debugger.md`
- `.context/plans/README.md`

Debugging-relevant inventory built first:

- `apps/web/src`: 618 TypeScript/TSX files total.
- Runtime/app source: 258 TS/TSX files across `app`, `components`, `lib`, and `db`, plus `proxy.ts`, `instrumentation.ts`, `i18n`, and `types`.
- Tests: 356 unit/source-contract test files under `apps/web/src/__tests__`.
- E2E: 12 files under `apps/web/e2e`, including hydration, origin guard, public/admin, focus restore, and visual reset specs.
- Migrations: 30 SQL migrations (`0000` through `0029`) plus Drizzle journal/snapshots under `apps/web/drizzle`.
- Scripts: 28 operational/build/migration/backfill scripts under `apps/web/scripts`, including `migrate.js`, restore recovery, CLIP/model seed, color and semantic backfills, entrypoint, and lint guards.
- Config/deploy surfaces: `apps/web/package.json`, root package/lock context, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `nginx/default.conf`, ESLint, TypeScript, Vitest, Playwright, and env examples.
- Review/context surfaces: current review prompts and plan index were read; archived `.context` reviews/plans were searched where useful but not fully reread because they are historical, not active behavior.

High-risk files were read directly: DB pool, advisory lock helpers, restore actions, restore maintenance marker, mutation barrier, upload action/API, upload tracker, image queue, queue shutdown, background DB writes, CLIP model/embedding/backfill paths, semantic/similar routes, settings/admin/topic/user actions, migration/deploy scripts, and revalidation. Broad UI and test surfaces were covered by full inventories plus targeted static sweeps for browser globals, hydration, storage, aborts, semantic-production gates, advisory locks, and request lifecycle hazards.

No runtime/source/migration/config/deploy category relevant to the requested failure modes was intentionally skipped. Existing unrelated dirty review artifacts were left untouched.

## Confirmed Issues

### DBG17-01 - Lightroom upload can leak quota claims when upload-directory creation fails

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/app/api/admin/lr/upload/route.ts:272-301`
- Settled neighboring error paths: `apps/web/src/app/api/admin/lr/upload/route.ts:303-312`
- Existing test mock always succeeds: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:74`

Why this is a problem:

The Lightroom upload route makes a conservative upload-tracker claim before slow work, then settles it on known rejection/error branches. After topic verification, it calls `await ensureUploadDirectories()` at line 301 outside a local catch. If that mkdir/chmod path throws because the bind mount is missing, read-only, permission-denied, or otherwise unhealthy, control jumps to the outer `finally` that releases only the upload-processing contract lock. The upload tracker claim is not settled and the route returns a framework-level 500 instead of the JSON error shape used by adjacent branches.

Concrete failure scenario:

1. `apps/web/public/uploads` or the private original root is temporarily unwritable after a host mount/configuration issue.
2. A Lightroom client uploads a valid multipart request.
3. The route preclaims `count=1` and the request byte size, verifies the topic, then `ensureUploadDirectories()` throws.
4. The client sees an opaque 500, and the preclaim remains charged for the rolling tracker window until pruning/expiry. Repeated retries can exhaust that admin/IP's upload budget even though no file was accepted.

Suggested fix:

Wrap `ensureUploadDirectories()` in the same settle-and-return style as `getGalleryConfigStrict()` and disk-space failures. On failure, call `settleTrackerToActual(false)` and return a no-store JSON error, likely 507 for storage/unwritable paths or 503 for transient setup failure. Add a route test that mocks `ensureUploadDirectories` rejecting and asserts tracker settlement plus JSON status.

### DBG17-02 - Sidecar CLIP backfill can permanently starve later images behind a failed prefix

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/scripts/backfill-clip-embeddings.ts:151-190`
- `apps/web/scripts/backfill-clip-embeddings.ts:199-202`
- `apps/web/scripts/backfill-clip-embeddings.ts:234-246`

Why this is a problem:

The sidecar semantic backfill starts each process with `cursor = 0`, scans processed images missing the target `model_version`, and stops when `processed + failed >= SEMANTIC_SCAN_LIMIT`. Production failures such as missing private originals increment `failed` but do not create an embedding row, so those low-ID rows remain eligible on the next invocation. Because the cursor is process-local, every retry starts at the same failed low-ID rows.

Concrete failure scenario:

1. Production has at least `SEMANTIC_SCAN_LIMIT` old processed images whose originals are missing or unreadable.
2. The operator follows the documented `--production --force` backfill runbook.
3. The script attempts only the failed prefix, logs failures, exits nonzero, and does not reach newer valid rows.
4. Re-running the same command repeats the same prefix from `cursor = 0`; later images never receive embeddings, so production semantic search remains partially or mostly unseeded despite repeated operator retries.

Suggested fix:

Make progress durable across failed rows. Options: persist a backfill cursor/checkpoint for sidecar runs, mark failed image IDs with a retry/dead-letter state that the candidate query can skip for the current activation pass, or separate "rows scanned" from "rows attempted" so the script can continue past failures while still bounding inference work. Add a regression with enough synthetic failed low-ID candidates to prove a later valid row is reached on a subsequent run.

## Likely Issues

### DBG17-03 - Pooled advisory-lock acquisition errors can return lock-holding sessions to the pool

Severity: High
Confidence: Medium

Files/regions:

- `apps/web/src/lib/upload-processing-contract-lock.ts:27-75`
- `apps/web/src/lib/image-queue.ts:668-684`
- `apps/web/src/lib/admin-backfill-runner.ts:324-342`
- `apps/web/src/lib/admin-backfill-runner.ts:363-379`
- `apps/web/src/app/actions/topics.ts:70-94`
- `apps/web/src/app/actions/admin-users.ts:239-315`
- `apps/web/src/app/actions/embeddings.ts:113-214`
- `apps/web/src/app/[locale]/admin/db-actions.ts:173-184`, `apps/web/src/app/[locale]/admin/db-actions.ts:349-358`, `apps/web/src/app/[locale]/admin/db-actions.ts:401-409`, `apps/web/src/app/[locale]/admin/db-actions.ts:425-440`, `apps/web/src/app/[locale]/admin/db-actions.ts:573-581`
- Test that currently locks in the unsafe upload-contract behavior: `apps/web/src/__tests__/upload-processing-contract-lock.test.ts:118-127`

Why this is a problem:

The repo correctly hardened advisory-lock release failures with `releasePooledAdvisoryLocks(...)`, which destroys pooled connections when `RELEASE_LOCK` cannot be proven. The acquisition side still has an ambiguity gap. Several pooled call sites issue `SELECT GET_LOCK(...)`, keep `lockAcquired = false` until the result is read, and release the connection back to the pool when the query throws.

If MySQL executed `GET_LOCK` but the client observes a mid-round-trip error before receiving the row, the session may hold the advisory lock. Returning that live session to the pool can poison future unrelated borrowers and wedge fail-fast lock paths until process restart. This is the same failure class the release helper was designed to prevent, just on acquisition rather than release.

Concrete failure scenario:

1. A network/proxy blip occurs after MySQL grants `gallerykit_upload_processing_contract` but before mysql2 resolves the query.
2. `acquireUploadProcessingContractLock()` catches the query error while `lockAcquired` is still false and calls `conn.release()`.
3. The pooled session still holds the lock. Future uploads, restore setup, and settings changes see the contract lock as busy or behave inconsistently depending on which pooled connection they borrow.
4. Equivalent wedges are possible for per-image processing locks, color/semantic backfills, topic route mutations, admin deletion, and restore/backup locks.

Suggested fix:

Centralize pooled advisory-lock acquisition in a helper. On explicit `GET_LOCK` result `1`, return a lock handle; on explicit `0`/`NULL`, release normally; on any query error before an explicit result, destroy the connection instead of releasing it. Update all pooled `GET_LOCK` acquisition sites to use it. Replace the current upload-contract test expectation at `upload-processing-contract-lock.test.ts:118-127` with a destroy-on-query-error assertion, and add source/behavior coverage for the other acquisition sites.

## Risks Requiring Manual Validation

- Browser upload DB-outage UX: `apps/web/src/app/actions/images.ts:307-316` now settles the preclaim before rethrowing a topic-lookup DB error, so the quota leak is closed, but the user-facing server-action behavior is still a framework error rather than a localized return object. Manually validate whether the admin UI presents a tolerable failure during a DB restart.
- Upload cancellation: the Lightroom route has many settle paths and the server action has a one-shot claim settler, but I did not run a live client-disconnect drill. The source-confirmed leak above is independent of cancellation.
- Production reverse proxy: `apps/web/nginx/default.conf` is a template and `CLAUDE.md` notes deploys do not apply host nginx changes automatically. Manual production validation should confirm the host copy still matches the current route/body-size/rate-limit contract.
- Semantic production activation: source gates correctly require DB mode plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`apps/web/src/lib/gallery-config.ts:123-126`) and the routes reject disabled mode, but actual deployed model weights/row counts require host validation per the runbook.

## Revalidated Non-Findings

- DB outage and pool exhaustion: `apps/web/src/db/index.ts` caps the pool (`connectionLimit=10`, `queueLimit=20`) and wraps borrowed connection startup in a timeout/destroy path. Write paths that require upload privacy/settings use `getGalleryConfigStrict()`; read paths intentionally fall back to defaults through `getGalleryConfig()`.
- Restore interruption: `db-actions.ts` uses durable restore maintenance, queue/background-write drains, admin mutation barrier, upload/backfill locks, child-process watchdogs, temp-file cleanup, and recovery tooling. The broad design is coherent; no new source-confirmed restore-interruption bug was found.
- Child-process timeout: `apps/web/src/lib/db-child-watchdog.ts` handles timeout with stdio teardown, SIGTERM, SIGKILL fallback, listener cleanup, and timer cleanup.
- Advisory-lock release failure: `apps/web/src/lib/advisory-lock-release.ts` destroys pooled sessions on failed `RELEASE_LOCK`; the remaining issue is acquisition ambiguity, not release.
- Cache/revalidation failure: `apps/web/src/lib/revalidation.ts:30-64` catches `revalidatePath` failures and keeps mutations from failing after commit.
- Invalid env: upload limit parsing and MySQL CLI TLS helpers fail closed or fall back as documented; production secrets/env enforcement is covered by migration/startup code and tests.
- Request aborts: semantic and similar search routes check `request.signal` before/after slow sections; CLIP text embedding accepts an abort signal.
- UI hydration: targeted sweeps for `window`, `document`, `localStorage`, `sessionStorage`, and hydration comments found deliberate client-only effect usage, suppression only for known date/device-dependent content, and a dedicated `hydration-photo-page.spec.ts`. No new source-confirmed hydration bug was found.

## Final Missed-Issues Sweep

Final sweeps covered advisory-lock acquisition/release shapes, semantic production gates, request abort paths, upload tracker settlement, restore maintenance lifecycle, child-process watchdog usage, browser-global hydration hazards, deploy/nginx/body-size contracts, migration/journal protections, and tests that pin these behaviors.

No relevant source, test, script, migration, config, or deploy category was intentionally skipped. Historical `.context` archives were not fully read end-to-end; they were treated as prior-review history rather than active runtime behavior.

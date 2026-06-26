# Tracer Report — Cycle 14

**Date:** 2026-06-27
**Agent:** tracer (cycle 14)
**HEAD at trace time:** current master (post-cycle-13 fixes applied)
**Scope:** 6 suspicious data/control flows — competing-hypothesis trace, evidence for/against, confidence verdict

---

## Verdict Table

| Flow | Verdict | Confidence |
|------|---------|------------|
| 1. SIGTERM / shutdown path (post-AGG-R13-01) | SAFE — exec fix confirmed correct, PID-1 chain verified | HIGH |
| 2. Upload→process→delete-during-processing race | SAFE — dual-check pattern (advisory lock + affectedRows) correctly wired end-to-end | HIGH |
| 3. Admin-only field leakage (publicSelectFields + cycle-13 guards) | SAFE — compile-time guard intact; cycle-13 isAdmin guards confirmed applied | HIGH |
| 4. Rate-limit buckets under process restart | SAFE for auth buckets (DB-backed source-of-truth); per-design for non-auth (process-local by documented intent) | HIGH |
| 5. ETag / cache invalidation — settings-hash path vs static Next path | OPERATIONAL CAVEAT ONLY — settings-hash ETag covers serve-upload fallback only; static path (majority of traffic) uses mtime+size; documented in CLAUDE.md, backfill required | HIGH |
| 6. Bootstrap queue on restart — permanentlyFailedIds cleared | LOW RISK — in-memory permanentlyFailedIds is cleared on restart; permanently failed images get up to 3 more attempts per restart; bounded overhead, no corruption | MEDIUM |

---

## Flow 1: SIGTERM / Shutdown Path

### Observation

Cycle-13 headline fix (AGG-R13-01) added `exec` to the Dockerfile CMD so that `node server.js` replaces the intermediate shell and becomes PID 1. The claimed effect: Docker's SIGTERM reaches the node process directly, triggering the `instrumentation.ts` `gracefulShutdown` handler.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | exec fix is correctly wired — node is PID 1, SIGTERM is received, gracefulShutdown runs | High | Strong | Source artifact at Dockerfile:130 is definitive; exec chain verified |
| 2 | exec fix is applied but PID-1 is still gosu or the ENTRYPOINT shell, not node | Low | Weak | Requires misreading how gosu exec-replaces the calling process |
| 3 | gracefulShutdown runs but fire-and-forget caption/embedding sub-tasks are not drained, leaving partial DB writes mid-flight | Medium | Strong | Confirmed by reading queue-shutdown.ts + image-queue.ts IIFE structure |

### Evidence For Hypothesis 1

`apps/web/Dockerfile:130`:
```
CMD ["sh","-c","node apps/web/scripts/migrate.js && exec node apps/web/server.js"]
```
`exec` is present. This replaces the shell with `node server.js` after migration completes.

`apps/web/scripts/entrypoint.sh:39`:
```
exec gosu node "$@"
```
gosu calls `execve()` with the CMD arguments as the target. This means:
- entrypoint.sh shell replaces itself with gosu via exec
- gosu exec-replaces itself with the CMD: `sh -c "node migrate.js && exec node server.js"` running as node user
- `sh` runs `node migrate.js`, waits for it to exit
- `sh` runs `exec node server.js`, replacing itself
- Final PID 1: `node server.js`

`apps/web/instrumentation.ts:73-88`: `process.on('SIGTERM', ...)` handler confirmed present; calls `gracefulShutdown()` with re-entrant guard (`shutdownInProgress`).

`apps/web/docker-compose.yml:13`: `stop_grace_period: 30s` — node gets 30 s to drain before SIGKILL.

`apps/web/src/lib/queue-shutdown.ts:15-45`: `drainProcessingQueueForShutdown` pauses the PQueue, clears pending jobs, clears the `enqueued` Set, and `await queue.onIdle()` waits for currently running queue slots to resolve.

### Evidence For Hypothesis 3 (fire-and-forget sub-tasks not drained)

`apps/web/src/lib/image-queue.ts` (approximately lines 460 and 498): two `void (async () => { ... })()` IIFEs are launched inside the queue job callback for caption generation and CLIP embedding respectively. The outer queue job callback returns WITHOUT awaiting these sub-tasks.

`queue.onIdle()` resolves when all PQueue-tracked callbacks complete. The fire-and-forget IIFEs are not tracked by PQueue. Therefore, after `onIdle()` resolves, both IIFEs may still be in-flight.

`gracefulShutdown` then calls `process.exit(exitCode)`, terminating the in-flight IIFEs.

Consequence: a caption `UPDATE` or embedding `INSERT ... ON DUPLICATE KEY UPDATE` could be interrupted mid-query. These operations are:
- Idempotent (embedding uses upsert; caption is a best-effort UPDATE)
- Not core to image delivery
- Wrapped in try/catch with warning-level logging

This is an intentional design trade-off: the comment in image-queue.ts states these hooks "MUST NOT block the queue job." Interrupted operations are retried on the next bootstrap/re-queue cycle.

### Evidence Against Hypothesis 2

gosu's design is to call `execve()` with the remaining args, replacing itself. `exec gosu node "$@"` replaces the entrypoint shell with gosu; gosu then calls `execve()` with the CMD args, replacing itself with `sh`. After `exec node server.js` inside that sh, gosu is gone from the process table. PID 1 = node. Hypothesis 2 requires gosu NOT to execve — contradicted by gosu's design.

### Rebuttal Round

Best challenge to Hypothesis 1: the 15 s `gracefulShutdown` timeout is shorter than `stop_grace_period: 30s`. Could a slow migration or a hung DB call cause SIGKILL before graceful exit?

Why Hypothesis 1 still stands: the 15 s timeout in `gracefulShutdown` calls `process.exit(exitCode)` explicitly — so even a timeout scenario produces a clean process exit rather than a SIGKILL-forced exit 137. The 30 s Docker grace period is the outer bound; the 15 s internal timeout fires first and exits cleanly.

### Current Best Explanation

The cycle-13 `exec` fix is correctly applied. PID 1 is `node server.js`. Docker SIGTERM reaches the node process, `gracefulShutdown` fires, the queue is drained via `pause/clear/onIdle`, the view-count buffer is flushed. Fire-and-forget caption/embedding tasks may be interrupted — this is accepted by design and does not affect image delivery correctness.

### Critical Unknown

Whether a process crash mid-IIFE (between the DB SELECT and the INSERT of an embedding) leaves any inconsistent state. Given the embedding write is an upsert and caption is a nullable UPDATE, the answer is almost certainly no — but this path has no dedicated test.

### Discriminating Probe

Add a test that calls `drainProcessingQueueForShutdown` while a fire-and-forget IIFE is pending (via a mock that captures outstanding Promises) and asserts that `process.exit` is called without waiting for them. This would explicitly pin the "intentional abandon on shutdown" behavior and catch any future change that accidentally makes them block shutdown.

---

## Flow 2: Upload → Process → Delete-During-Processing Race

### Observation

`deleteImage()` in `images.ts` does NOT acquire the per-image processing advisory lock before deleting the DB row and cleaning up files. This means a running queue job and a concurrent `deleteImage()` call can interleave. The codebase claims this is safe via a conditional UPDATE post-check (`affectedRows === 0`).

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | The dual-check pattern (advisory lock pre-claim + conditional UPDATE post-check) correctly handles all interleaving windows | High | Strong | Source artifacts at image-queue.ts:338-343, 433-454 verified; images.ts:560-650 verified |
| 2 | There is a window where derivative files exist on disk but the DB row is gone (orphaned files) | Low | Weak | Requires queue job to write files but never reach the conditional UPDATE — contradicted by unconditional post-check |
| 3 | The in-memory `enqueued.delete(id)` in deleteImage races with a job that has already left the enqueued Set (started running) | Confirmed — but benign | Strong | enqueued.delete is called on a tracking Set; a running job's actual cancellation is the affectedRows check |

### Evidence For Hypothesis 1

`apps/web/src/lib/image-queue.ts:338-343` (pre-check): before `processImageFormats()` runs, the queue job executes `SELECT WHERE id=X AND processed=false`. If the row is already deleted, the job exits with "no longer pending" log. No files are written.

`apps/web/src/lib/image-queue.ts:433-454` (post-check): after `processImageFormats()` completes and files are written, the job runs a conditional UPDATE `WHERE id=X AND processed=false`. If `affectedRows === 0` (row was deleted mid-processing), the job calls `deleteImageVariants(dir, filename, [])` (empty-array form = full directory scan) for each format directory, cleaning up all derivative variants just written.

`apps/web/src/lib/image-queue.ts:608-621` (finally block): the advisory lock is released and the `enqueued` Set entry is cleaned up in a `finally` block, ensuring cleanup runs even on error/retry.

`apps/web/src/app/actions/images.ts:636-641`: `deleteImage()` also calls `deleteImageVariants(...)` with the empty-array form. Because `deleteImageVariants` is idempotent on ENOENT, double-cleanup (one from the queue job, one from deleteImage) is safe in either order.

### Evidence For Hypothesis 3 (in-memory enqueued race — benign)

`apps/web/src/app/actions/images.ts:609-611`: `deleteImage()` calls `queueState.enqueued.delete(id)` before the DB transaction. However, by the time a queue job is actively executing inside `state.queue.add(async () => { ... })`, PQueue has taken ownership. The `enqueued` Set is used for bookkeeping (preventing duplicate enqueue), not for cancellation. A running job is not affected by `enqueued.delete()`.

The actual cancellation signal for a running job is the conditional UPDATE `affectedRows === 0`.

### Evidence Against Hypothesis 2

The post-check (lines 433-454) is outside any conditional branch — it always runs after `processImageFormats()` completes. A crash before this point leaves `processed=false` in the DB, so bootstrap re-discovers and re-processes on restart. Derivative files from a crash are overwritten by the re-run. Hypothesis 2 is contradicted.

### Rebuttal Round

Best challenge: on Linux, `deleteImage()` unlinks the original file. If Sharp has already opened the original via a file descriptor, `unlink()` removes the directory entry but the fd remains valid until Sharp closes it. Sharp completes successfully, derivatives are written, then the post-check finds `affectedRows=0` and cleans up. The race is fully handled.

### Current Best Explanation

The delete-during-processing race is safe. The dual-check pattern (pre-check WHERE processed=false exits early; post-check affectedRows=0 triggers cleanup) handles all interleaving windows. Cleanup is idempotent under ENOENT in both paths.

### Critical Unknown

Whether the `finally` block (which releases the advisory lock) runs correctly when `processImageFormats()` is interrupted by SIGKILL. Answer: the MySQL server closes the connection on process death and releases the advisory lock automatically, preventing deadlock on the next bootstrap.

### Discriminating Probe

Confirm that `__tests__/` includes a test covering the `affectedRows=0` cleanup branch in the queue job (not just the backfill path). If absent, add a unit test that mocks `processImageFormats` to succeed and then mocks the conditional UPDATE to return `affectedRows=0`, asserting that `deleteImageVariants` is called for cleanup.

---

## Flow 3: Admin-Only Field Leakage

### Observation

`publicSelectFields` is constructed from `adminSelectFields` by explicit omission of PII fields. A compile-time `_SensitiveKeysInPublic` type guard asserts the intersection is `never`. Cycle-13 added `isAdmin &&` guards in `color-details-section.tsx` for `transfer_function` and `is_hdr` access, and the feed route was patched to stop selecting `adminUsers.username`.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Field leakage is prevented — publicSelectFields omissions + compile-time guard + cycle-13 render guards are all correctly in place | High | Strong | Source artifacts at data.ts:209-360, 428-429, 795-806; color-details-section.tsx:227-228 verified |
| 2 | A field was added to adminSelectFields but not added to the `_omit*` block or `_PrivacySensitiveKeys` type, bypassing the guard | Low | Weak | Only possible if a developer forgets the migration checklist; the guard catches existing classified fields but cannot detect newly added unclassified ones |
| 3 | The compile-time guard passes but runtime serialization (e.g. JSON.stringify) includes an omitted field via prototype pollution or Drizzle ORM side-channel | Very Low | Very Weak | No evidence; Drizzle select with explicit field list excludes non-selected fields |

### Evidence For Hypothesis 1

`apps/web/src/lib/data.ts:428-429`:
```typescript
type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;
const _guard: _SensitiveKeysInPublic extends never ? true : false = true;
```
This is a compile-time type assertion. `tsc` fails the build if any key in `_PrivacySensitiveKeys` appears in `publicSelectFields`.

`apps/web/src/lib/data.ts:795-806` (post AGG-R13-07 fix): `getImagesForFeed` now uses `...publicSelectFields` and `author_name: sql<null>` (constant null), replacing the prior `adminUsers.username` join. The public Atom feed no longer emits per-image admin login names.

`apps/web/src/components/color-details-section.tsx:227-228` (post AGG-R13-06 fix):
```typescript
const hasColorDetails = isAdmin && (
    transfer_function !== null || is_hdr !== null || ...
);
```
`transfer_function` and `is_hdr` are gated by `isAdmin`. For public viewers these are `undefined` (omitted from `publicSelectFields`); the `isAdmin &&` guard closes the UI branch independently.

`apps/web/src/__tests__/privacy-fields.test.ts`: fixture test enumerates `SENSITIVE_KEYS` and asserts none appear in `publicSelectFields`. Runtime complement to the compile-time guard.

### Evidence Against Hypothesis 2

The CLAUDE.md migration checklist explicitly requires adding new admin-only columns to the `_omit*` block AND `_PrivacySensitiveKeys` AND the `SENSITIVE_KEYS` fixture. The compile-time guard fires if a key is added to `_PrivacySensitiveKeys` correctly. The process gap is: a NEW column not yet added to `_PrivacySensitiveKeys` at all is invisible to the guard. No evidence of such a column exists at HEAD.

### Rebuttal Round

Best challenge: `avif_10bit` was explicitly annotated as "public-safe (R10-M4)" and placed in `publicSelectFields`. Could a future column be similarly "safe" but accidentally classified as sensitive? Yes — but that is a false positive (causing a build failure, not a leak), not a false negative. The dangerous direction (sensitive field in public) requires both adding to `_PrivacySensitiveKeys` AND to `publicSelectFields` simultaneously, which the guard catches.

### Current Best Explanation

Admin-only field leakage is blocked by three layers: compile-time type assertion, runtime fixture test, and post-cycle-13 render-layer isAdmin guards. The feed route no longer discloses admin usernames.

### Critical Unknown

Whether any column added after the current `SENSITIVE_KEYS` fixture was written has been correctly classified. A diff of `apps/web/src/db/schema.ts` images columns against the fixture would confirm no drift.

### Discriminating Probe

Run `npm run typecheck --workspace=apps/web` to confirm the `_SensitiveKeysInPublic` guard passes at HEAD. Then diff `schema.ts` images columns against `__tests__/privacy-fields.test.ts` SENSITIVE_KEYS to catch any recently added column not yet classified.

---

## Flow 4: Rate-Limit Buckets Under Process Restart

### Observation

Login rate limiting uses both an in-memory `loginRateLimit` BoundedMap (fast path) and a DB-backed `rateLimitBuckets` table (source of truth). On process restart the in-memory map is empty. The question is whether a restart creates a brute-force window.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Login rate limiting is safe across restarts — the DB is the authoritative check; in-memory is a fast-path early-reject; the DB check runs unconditionally in the auth action | High | Strong | apps/web/src/app/actions/auth.ts:103-157 is the definitive artifact |
| 2 | Restart empties the in-memory map, and the login route returns early on the in-memory count without ever reaching the DB check — creating a post-restart brute-force window | Low | Contradicted by source | auth.ts:143-147 DB check is outside any in-memory-count conditional |
| 3 | Non-auth rate-limit buckets (OG, share, search, semantic) are process-local with no DB backup — a restart resets them | High (confirmed) | Strong | rate-limit.ts:77,89; no DB incrementRateLimit call for these buckets |

### Evidence For Hypothesis 1

`apps/web/src/app/actions/auth.ts:103-157`:
```typescript
const limitData = getLoginRateLimitEntry(ip, now);          // in-memory
if (limitData.count >= LOGIN_MAX_ATTEMPTS) { return 429 }  // early-reject (fast path only)

// ...

loginRateLimit.set(ip, limitData);  // pre-increment in-memory

// ALWAYS runs — DB check is not conditional on in-memory state:
const dbLimit = await checkRateLimit(ip, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, loginBucketStart);
const accountLimit = await checkRateLimit(accountRateLimitKey, 'login_account', ...);
if (isRateLimitExceeded(dbLimit.count, ...) || isRateLimitExceeded(accountLimit.count, ...)) {
    rollbackLoginRateLimit(...);
    return 429;
}
```

The pattern: in-memory check allows fast rejection WITHOUT a DB round-trip when the bucket is clearly over limit. The DB check at lines 143-147 runs unconditionally AFTER the in-memory gate. After a restart (in-memory empty, DB has counts), the in-memory early-reject will not fire, but the DB check catches any accumulated budget.

Net brute-force window from restart: zero extra attempts. The DB count enforces the budget regardless of in-memory state.

`apps/web/src/lib/rate-limit.ts:103-104` comment:
```typescript
// In-memory Maps kept as fast-path cache. On restart they are empty;
// the DB is the source of truth.
```
This matches the observed code behavior exactly.

### Evidence For Hypothesis 3 (non-auth buckets are process-local)

`apps/web/src/lib/rate-limit.ts`:
- `ogRateLimit` (line 77): `createResetAtBoundedMap`, no DB backup
- `shareRateLimit` (line 89): `createResetAtBoundedMap`, no DB backup
- `searchRateLimit` (line 107): `createResetAtBoundedMap`, no DB backup

CLAUDE.md: "the other rate-limit buckets (OG/share/search/semantic) are per-process, so distributed-attack defense weakens under scale-out." Under the single-process/single-container topology this is a documented and accepted design choice.

### Evidence Against Hypothesis 2

`apps/web/src/app/actions/auth.ts:143-157`: the DB `checkRateLimit` call is outside any conditional branch gated on the in-memory count. Even if the in-memory Map is empty (fresh restart), the DB check runs and the DB count is controlling. Hypothesis 2 is definitively contradicted.

### Rebuttal Round

Best challenge: `clearSuccessfulLoginAttempts` (auth-rate-limit.ts:55-58) calls `resetRateLimit` (DB reset) then `loginRateLimit.delete(ip)` (in-memory delete). If the DB reset fails (transient DB error) but the in-memory delete succeeds, the in-memory count is cleared while the DB count remains. On the next attempt, the in-memory check passes (count=0), but the DB check catches the non-reset count — attacker gets no benefit. The asymmetry is safe in the failure direction.

### Current Best Explanation

Login rate limiting is correct across restarts. The DB is the authoritative source; the in-memory map is a fast-path cache. Non-auth rate-limit buckets are process-local by design; this is documented and acceptable under the single-instance topology.

### Critical Unknown

Whether the `rateLimitBuckets` DB table is being pruned regularly. Unbounded growth could slow `checkRateLimit` queries. No GC job for this table was observed during the trace.

### Discriminating Probe

`SELECT COUNT(*) FROM rateLimitBuckets WHERE expires_at < NOW()` on production. If this count is large, a GC pass or a TTL-based purge job is warranted. Also verify that `checkRateLimit` queries use an index on `(key, bucket_type, bucket_start)` or equivalent to avoid full-table scans as the table grows.

---

## Flow 5: ETag / Cache Invalidation — Settings-Hash vs Static Next Path

### Observation

Two serving paths exist for derivative images: the static Next.js path (`public/uploads/`) and the `serve-upload.ts` fallback. The settings-hash ETag is only emitted by `serve-upload.ts`. Most production traffic goes through the static path, which uses mtime+size ETags.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Static path does NOT emit the settings-hash ETag — but mtime+size ETag changes after backfill re-encodes files, so cache invalidation works post-backfill | High | Strong | next.config.ts headers() + serve-upload.ts:215 are the definitive artifacts |
| 2 | Flipping a color/quality/size admin setting invalidates stale browser/CDN caches on the static path WITHOUT a backfill | Low | Contradicted by evidence | Only serve-upload.ts emits the settings-hash ETag; the static path has no knowledge of admin settings |
| 3 | The 5 s TTL module-scope settings-hash cache in serve-upload.ts introduces a correctness window where the ETag is stale | Low | Weak | Worst case is 5 s on the minority fallback path; static path is unaffected |

### Evidence For Hypothesis 1

`apps/web/next.config.ts:51-71`:
```typescript
headers: [
    { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
]
```
Applied to the `/uploads/` path. Next.js generates ETags from `size-hex + mtime-hex` for static files.

`apps/web/src/lib/serve-upload.ts:215`: ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` — only emitted by this module.

CLAUDE.md "Operational gotcha (CRT-D1)": "flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives ... The settings-hash ETag only affects the serve-upload path."

After a backfill re-encode: `processImageFormats` writes new bytes, changing both mtime and size. The static path mtime+size ETag changes, forcing revalidation.

### Evidence Against Hypothesis 2

No code path in `next.config.ts`, Next.js static serving, or the CDN configuration emits the settings-hash or responds to admin setting changes without a backfill. Hypothesis 2 is definitively contradicted.

### Rebuttal Round

Best challenge: for assets cached by the browser HTTP cache (served via the static path with the mtime ETag), those caches only invalidate after `max-age=3600` expires OR the file mtime changes (backfill). So a browser could serve old colors for up to 1 hour post-backfill. This is a documented operational caveat, not a bug. The `must-revalidate` directive causes browsers to revalidate after `max-age` expires; the backfill changes mtime, so revalidation fetches new bytes.

### Current Best Explanation

The ETag cache invalidation system works correctly within its documented scope. The settings-hash ETag covers the `serve-upload.ts` path. The static path relies on mtime-based invalidation triggered by a backfill re-encode. Operators must run a backfill after changing color/quality/size settings.

### Critical Unknown

Whether the SW HEAD revalidation timeout (300 ms AbortSignal) interacts with the 5 s module-scope settings-hash cache to produce a brief window where a warm SW cache reports the old ETag for requests on the `serve-upload.ts` path after settings change. The window is bounded at 5 s and affects only the minority fallback path.

### Discriminating Probe

After changing an admin color setting, issue a HEAD request to a known derivative URL on the `serve-upload.ts` path before and after the 5 s TTL. Confirm the ETag changes. Then confirm the same URL on the static Next path (`/uploads/...`) returns the old mtime ETag until a backfill runs and changes the file.

---

## Flow 6: Bootstrap Queue on Restart — permanentlyFailedIds Cleared

### Observation

The `permanentlyFailedIds` Set in `ProcessingQueueState` is in-memory and process-local. On process restart it is empty. Images that permanently failed (exhausted MAX_RETRIES=3) still have `processed=false` in the DB. The bootstrap query excludes `permanentlyFailedIds` only while the Set is populated.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Permanently failed images get up to 3 more processing attempts per restart — bounded overhead, no corruption or data loss | High | Strong | image-queue.ts:691-693 exclusion logic; bootstrap query structure; retry cap at MAX_RETRIES=3 |
| 2 | A permanently failed image with a corrupt input file causes an unbounded retry loop across restarts (3 attempts per restart indefinitely) | Medium | Moderate | True in theory; depends on deployment frequency; each restart window is bounded to 3 attempts |
| 3 | The permanent failure is persisted to the DB (`processing_error` column), making a bootstrap filter on `processing_error IS NULL` viable to prevent post-restart re-enqueue | High (as an improvement) | Strong | `images.processing_error` column confirmed to exist in schema; bootstrap query confirmed NOT to filter on it |

### Evidence For Hypothesis 1

`apps/web/src/lib/image-queue.ts:691-693`:
```typescript
if (state.permanentlyFailedIds.size > 0) {
    baseConditions.push(notInArray(images.id, [...state.permanentlyFailedIds]));
}
```
This exclusion is only effective while the process is alive. On restart, `permanentlyFailedIds` is empty (`new Set()`), so the `notInArray` condition is not appended. The bootstrap query finds any image with `processed=false` regardless of prior permanent failure status.

`apps/web/src/lib/image-queue.ts:560-607`: permanent failure path — the image is added to `permanentlyFailedIds` (in-memory), `processing_error` is persisted to the DB, and `scheduleBootstrapRetry` is called. On the NEXT bootstrap pass within the same process lifetime, the `notInArray` excludes the image. After restart, it does not.

Cost per restart for a permanently-failed image: up to 3 processing attempts. For a corrupt file that always fails, each deploy triggers 3 failed attempts. Not a safety issue; bounded overhead.

### Evidence For Hypothesis 3 (DB filter is viable)

The `processing_error` column on `images` contains the error string for a permanently failed image. The bootstrap query at lines 687-717 selects rows where `images.processed = false` but does NOT filter `processing_error IS NULL`. Adding this filter would prevent permanently failed images from being re-enqueued after restart.

This is a latent improvement. Its omission is not a bug under the current single-instance topology where restarts are infrequent.

### Rebuttal Round

Best challenge: could a burst of permanently failed images on a high-volume gallery create enough retry overhead on each restart to stall the queue for normal images? At MAX_RETRIES=3 with exponential backoff and `BOOTSTRAP_RETRY_DELAY_MS` between bootstrap scans, a large set of permanently failed images would delay bootstrap convergence for normal images. In practice, permanently failed images are rare (corrupt originals). For galleries with many corrupt uploads, the bootstrap filter would be a meaningful improvement.

### Current Best Explanation

On restart, permanently failed images get up to 3 more processing attempts. This is bounded overhead per restart, not a safety or correctness issue. The mitigation path (filter bootstrap by `processing_error IS NULL`) exists in the schema but is not wired. For the current production gallery scale, the overhead is negligible.

### Critical Unknown

How many images currently have `processing_error IS NOT NULL` AND `processed = false` in the production DB. If the count is non-zero, each deploy triggers 3 wasted attempts per such image.

### Discriminating Probe

Run on production:
```sql
SELECT COUNT(*) FROM images WHERE processed = false AND processing_error IS NOT NULL;
```
If > 0, extend the bootstrap query with `AND images.processing_error IS NULL` as a cheap improvement. This eliminates the need for the in-memory `permanentlyFailedIds` exclusion across restarts (DB becomes the authoritative permanent-failure store).

---

## Overall Assessment

No CRITICAL or HIGH findings in this trace. One new LOW finding (Flow 6: bootstrap re-enqueues permanently failed images after restart) is an informational improvement candidate with a specific DB probe. The five previously known patterns (SIGTERM path, delete-during-processing, field leakage, rate-limit restart, ETag caveat) are all SAFE or operating as documented with accepted trade-offs.

The highest-value discriminating probe across all flows is the Flow 6 production DB query because it directly determines whether a cheap bootstrap filter improvement is warranted. The highest-value new test to add is the Flow 2 `affectedRows=0` cleanup branch test (if absent) and the Flow 1 shutdown-IIFE drain behavior test.

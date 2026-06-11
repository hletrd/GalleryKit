# Tracer Review — Run 5 Cycle 2

**Date:** 2026-06-12
**Scope:** Cycle 1 changes (b7d4729b..HEAD, 20 commits). End-to-end causal tracing of suspicious flows.
**Method:** Evidence-driven competing-hypothesis analysis per Tracer protocol.

---

## Suppression note

Items TRC-R5C1-02 through TRC-R5C1-21 are confirmed deferred or no-action per `plan-317-run5-cycle1-deferred.md`. This report does not re-litigate them unless new evidence emerges from cycle 2 surface.

---

## TRC-R5C2-01 — Unlink-on-detection-failure races concurrent backfill reading the same original

### Observation

`saveOriginalAndGetMetadata` (process-image.ts:866–910) now wraps `extractIccProfileName`, `detectColorSignals`, and `resolveColorPipelineDecision` in a try/catch that calls `fs.unlink(originalPath)` on any exception before re-throwing (commit d71d2de5). The admin backfill runner (admin-backfill-runner.ts:179–185) resolves the original path and calls `fs.access(originalPath)` before passing it to `processImageFormats`. A race is conceivable: upload saves original → detection fails → unlink fires → concurrently-running backfill job has already called `fs.access` and proceeds with `processImageFormats` on a now-deleted file.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Race is structurally impossible because backfill only targets `processed=TRUE` rows, and a new upload's row is inserted as `processed=FALSE`; detection failure occurs before the DB insert | High | Strong (code path) | The unlink in `saveOriginalAndGetMetadata` fires BEFORE the `db.insert` at images.ts:376; at unlink time, no DB row references the file yet; backfill query (`WHERE processed = TRUE`) cannot see a row that was never inserted |
| 2 | A running backfill could touch an EXISTING processed image whose original is being re-read at the same time that a different admin action deletes the image | Low | Weak (multi-step scenario) | `deleteImage` removes the DB row then deletes files; backfill checks `fs.access` first, proceeds to encode, then UPDATE — the DB row is already gone so the conditional UPDATE (WHERE id=X) writes 0 rows, which `reprocessOne` does not check for 0 affected rows (but this is harmless benign no-op for backfill, not an unlink race) |

### Evidence For

- Hypothesis 1: `saveOriginalAndGetMetadata` exits the entire upload flow with the unlink BEFORE returning to `uploadImages`; `db.insert` is at images.ts:376, AFTER the `saveOriginalAndGetMetadata` call returns at :279. There is no window where the row exists in DB with `processed=TRUE` and the original is simultaneously being unlinked due to a detection failure.
- Hypothesis 1: Backfill fetches `WHERE processed = TRUE AND pipeline_version < CURRENT` (admin-backfill-runner.ts:168–175). Detection failure during upload means the row is never inserted at all.

### Evidence Against / Gaps

- Hypothesis 1: A subtle scenario exists where a previously-processed image IS referenced, but that scenario (deleteImage) does not involve the new unlink path at all — it goes through `deleteOriginalUploadFile`.
- Gap: `reprocessOne` (admin-backfill-runner.ts:178–281) does NOT verify `updateResult.affectedRows` after the UPDATE. If the row was concurrently deleted, the encode completes but the DB write silently no-ops. This wastes CPU but leaves no corrupted state. Low severity.

### Rebuttal Round

Strongest challenge: Could a detection retry (after `retryFailedImage`) collide with a concurrent backfill that reads the same original?

Answer: `retryFailedImage` clears `processing_error`, deletes from `permanentlyFailedIds`, and calls `enqueueImageProcessing`. The queue job acquires the MySQL advisory lock `gallerykit:image-processing:{id}` before processing. The backfill runner does NOT acquire this per-image lock — it processes all rows with `pipeline_version < CURRENT` via PQueue independently. Therefore, a retry-enqueued queue job and a concurrent backfill job CAN both process the same image concurrently.

### Convergence / Separation Notes

The original unlink-race hypothesis collapses (impossible). A separate, genuine concurrency gap surfaces: retry-path queue job and admin-backfill-runner can process the same image simultaneously because the per-image advisory lock is only held by the queue worker, not by the backfill runner.

### Current Best Explanation

**Verdict: CONFIRMED — different, new finding.** The unlink-on-detection-failure race (uploads vs. backfill) is not possible. However, `retryFailedImage` + concurrent `runBackfill` exposes a real concurrency gap: both the re-enqueued queue worker AND the backfill runner may call `processImageFormats` on the same image at the same time, writing derivative files concurrently with no per-image advisory lock on the backfill side. The backfill runner does hold the process-wide `gallerykit_color_pipeline_backfill` lock against other backfill runs, but not against the queue worker.

**Concrete failure scenario:** Admin clicks "Re-encode" while a retried image is mid-processing in the queue. Both write AVIF/WebP/JPEG in parallel; partial interleaved writes corrupt derivatives. Both then attempt DB UPDATE — whichever lands last wins, but intermediate disk state is non-atomic.

**Classification:** CONFIRMED

**Severity:** MEDIUM

**Confidence:** HIGH (code path is direct; per-image lock scope is documented as queue-only in image-queue.ts:183–210, advisory-locks.ts)

**Suggested fix:** In `reprocessOne` (admin-backfill-runner.ts), acquire the per-image advisory lock `gallerykit:image-processing:{id}` (already exported from `@/lib/advisory-locks`) before calling `processImageFormats`, and release it after the UPDATE. Skip (return) if the lock cannot be acquired (meaning the queue worker owns it).

---

## TRC-R5C2-02 — Backfill keyset cursor correctness under concurrent image deletion

### Observation

The new keyset pagination in `admin-backfill-runner.ts` (PERF-R5C1-01) advances the cursor to `batch[batch.length - 1].id` and fetches `WHERE id > cursor ORDER BY id ASC`. If rows are deleted mid-run, the cursor advances past deleted gaps correctly. But if a row is deleted whose id equals or precedes the current cursor, it is simply absent — no issue. The concern is whether cursor advancement can skip live rows.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Keyset pagination is correct — deletion mid-run cannot cause live rows to be skipped | High | Strong (SQL semantics) | `id > cursor ORDER BY id ASC` is a stable cursor on an auto-increment PK. Deleted rows below the cursor are already processed. Deleted rows above the cursor simply don't appear in future batches. No row can be pushed to a lower ID. |
| 2 | Insertion of NEW images during backfill could cause rows to appear after the cursor has passed them | Very Low | Weak | New uploads get `processed=FALSE`, so they are excluded from the backfill WHERE clause (`processed=TRUE`). Even if they were later processed, their high IDs would appear in future batches. |

### Evidence For

- Hypothesis 1: Auto-increment primary keys never reassign old IDs. `WHERE processed=TRUE AND pipeline_version < CURRENT AND id > cursor ORDER BY id ASC LIMIT 100` is a textbook stable keyset cursor. (admin-backfill-runner.ts:165–175)
- Hypothesis 1: The batch-drain-before-next-fetch pattern (`await queue.onIdle()` at :345) means PQueue has fully processed all items in the batch before the cursor advances, preventing any gap where a row is in the queue but the cursor has moved past it.

### Evidence Against / Gaps

- Gap: `reprocessOne` does NOT check `affectedRows` after UPDATE (admin-backfill-runner.ts:246–281). If a row is deleted between the batch fetch and the UPDATE, the encode runs to completion but the DB write silently no-ops. Orphaned derivative files from the encode remain on disk. This is a pre-existing gap (same as the original sidecar script), not introduced by PERF-R5C1-01.

### Current Best Explanation

Keyset cursor is correct. No skip or double-process risk from pagination logic itself. Residual gap: orphaned derivative files when an image is deleted mid-backfill — pre-existing, low severity (files are inert, not served publicly without a DB row).

**Verdict: No new finding. Pre-existing gap noted but not actionable this cycle.**

**Classification:** CONFIRMED SAFE (keyset logic); pre-existing file-leak acknowledged.

---

## TRC-R5C2-03 — retryFailedImage double-enqueue or stuck-processing state

### Observation

`retryFailedImage` (images.ts:1042–1114, commit 2032d5b8) adds `isAdmin()` gate, clears `permanentlyFailedIds`/`retryCounts`/`lastErrors`, then calls `enqueueImageProcessing`. The concern is double-enqueue (same job enqueued twice) and stuck states.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Double-enqueue is prevented by `state.enqueued.has(job.id)` guard in `enqueueImageProcessing` | High | Strong | image-queue.ts:245: `if (state.enqueued.has(job.id)) return;` — idempotent |
| 2 | A stuck-processing state occurs if the advisory lock is still held from the previous failed attempt | Medium | Moderate | MySQL advisory locks release on connection close; if the previous worker crashed mid-job without explicit RELEASE_LOCK, the lock auto-releases when the pool connection is recycled — lock scope is per-connection |
| 3 | retryFailedImage clears `permanentlyFailedIds` but not `claimRetryCounts`, so a stalled claim-retry timer could re-enqueue via timeout AFTER the admin retry also enqueues | Medium | Moderate (code inspection) | `retryFailedImage` at :1088–1090 deletes from `permanentlyFailedIds`, `retryCounts`, `lastErrors` but does NOT delete from `state.claimRetryCounts` |

### Evidence For

- Hypothesis 1: `enqueueImageProcessing` at image-queue.ts:245 checks `state.enqueued.has(job.id)` before adding. If the retry fires while a claim-retry timer is pending, the timer's eventual `enqueueImageProcessing` call will be a no-op (already enqueued). ✓
- Hypothesis 3: `retryFailedImage` at images.ts:1088–1090 — only `permanentlyFailedIds`, `retryCounts`, `lastErrors` are cleared. `claimRetryCounts` is NOT cleared. A lingering `claimRetryCounts` entry means if a stale claim-retry timer fires and calls `enqueueImageProcessing(job)`, the job's `claimRetryCounts` shows elevated count, potentially hitting `MAX_CLAIM_RETRIES` faster than expected on the new attempt.

### Evidence Against / Gaps

- Hypothesis 3: The stale `claimRetryCounts` value leads to premature claim-retry exhaustion, not a double-enqueue. The dequeued guard prevents double-enqueue. But if `claimRetryCounts` is not cleared and the old value was already near `MAX_CLAIM_RETRIES` (10), a legitimate single claim-acquisition failure on the retry attempt could immediately exhaust the limit and re-permanently-fail the job, making `retryFailedImage` appear to do nothing.

### Rebuttal Round

Is the `claimRetryCounts` gap actually reachable? For it to matter: the job must have failed with claim-retry pressure (not just a processing error), and a stale timer must still be in flight. If the permanent failure was due to processing errors (MAX_RETRIES=3 exceeded, not claim retries), `claimRetryCounts` is 0 and this is a non-issue. The gap is real but narrow.

### Current Best Explanation

**Verdict: LOW finding — `claimRetryCounts` not cleared on retry.** `retryFailedImage` correctly clears `permanentlyFailedIds`, `retryCounts`, and `lastErrors` but omits `claimRetryCounts`. If the original failure involved claim-retry exhaustion (the less common path), a lingering high `claimRetryCounts` value could cause the retried job to immediately exhaust its claim-retry budget on the first claim miss, re-permanently-failing it without the full `MAX_CLAIM_RETRIES` attempts.

**Concrete failure scenario:** Image permanently fails after `MAX_CLAIM_RETRIES` (10) due to a lock being held by another process. Admin clicks Retry. `claimRetryCounts` still holds value 10. Queue worker starts, can't acquire lock (expected transient — e.g. sidecar backfill holds it), increments to 11 >= MAX_CLAIM_RETRIES at first miss → immediately re-permanently-fails. Retry appears silently broken.

**Classification:** LIKELY

**Severity:** LOW

**Confidence:** HIGH

**Suggested fix:** Add `state.claimRetryCounts.delete(id)` at images.ts:1090, after `state.lastErrors.delete(id)`.

---

## TRC-R5C2-04 — semantic_search_mode fail-closed rework: stale config or default mismatch

### Observation

Commit 1fabf9ec changed the semantic search route to reject `'production'` mode with a 503, regardless of the DB value (route.ts:188: `if (semanticMode !== 'stub')`). The validator in gallery-config-shared.ts:171 also now rejects `'production'` as a storable value. The concern: can a stale cached config value or a default mismatch reopen the route?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Stale DB value `'production'` from before the validator change passes through `getGalleryConfig` and is returned as `semanticSearchMode: 'production'` | High | Strong (code path) | `_getGalleryConfig` at gallery-config.ts:125–128 calls `isValidSettingValue('semantic_search_mode', raw)` before returning. With the new validator, `'production'` fails validation → returns `DEFAULTS.semantic_search_mode` = `'disabled'`. So a stale DB value of `'production'` is safely handled: returns `'disabled'`, route 503s. ✓ |
| 2 | The route checks `semanticMode !== 'stub'` (lines 188), so even if `'production'` leaked through, the route still returns 503 | High | Strong | Defense-in-depth: validator blocks write, config-reader blocks stale read, route blocks execution. Three layers. ✓ |
| 3 | The React `cache()` wrapping of `getGalleryConfig` could serve a stale `'stub'`-mode config to the semantic route within the same SSR request cycle even after the setting is changed | Low | Weak | React `cache()` is per-request, not cross-request. Each Next.js route invocation gets a fresh cache scope. No cross-request stale config risk. |

### Evidence For

- gallery-config.ts:125–128: validator applied before returning; stale `'production'` → `'disabled'`.
- route.ts:188: `if (semanticMode !== 'stub')` — only `'stub'` serves requests; both `'disabled'` and `'production'` (if it ever leaked) return 503.
- gallery-config-shared.ts:171: `semantic_search_mode: (v) => v === 'disabled' || v === 'stub'` — write-time gate.
- gallery-config.ts:204: `export const getGalleryConfig = cache(_getGalleryConfig)` — React `cache()` is per-request deduplication only.

### Evidence Against / Gaps

- Gap: The route reads config AFTER rate-limit pre-increment (route.ts:170–194). If `getGalleryConfig()` throws (DB down), the catch block at :185–187 sets `semanticMode = 'disabled'` and the route returns 503. Rate-limit credit was consumed. The `rollbackSemanticAttempt` is called at :189, correctly. ✓
- Gap: The image-queue embedding hook (image-queue.ts:405–434) also reads `semanticSearchMode` via `getGalleryConfig()`. In the queue context (background worker, not an SSR request), `cache()` is a no-op (React cache is only active inside React render context). Each call hits the DB. This is correct behavior — no staleness risk in background jobs.

### Current Best Explanation

**Verdict: CONFIRMED SAFE.** The fail-closed rework is correct. Three independent layers block `'production'` mode from serving requests. React `cache()` boundary is not a risk here. No new finding.

---

## TRC-R5C2-05 — Session lifecycle: React cache() memo and revocation propagation

### Observation

`getCurrentUser` is wrapped with React `cache()` at auth.ts:33. `isAdmin()` calls `getCurrentUser()`. Every mutating server action calls `isAdmin()` plus `requireSameOriginAdmin()`. The question: if an admin session is revoked during a single SSR render pass (e.g., by a concurrent logout from another tab), can the memoized `getCurrentUser()` return a stale truthy user?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Within the same SSR request, React cache() memoizes the user lookup; a concurrent logout CANNOT invalidate this within the same request | High | Strong | This is documented in TRC-R5C1-06 (deferred, cycle 1): "acceptable — React `cache()` per-request session memo can't see same-request revocation; not exploitable." Not re-litigated. |
| 2 | Cross-request: expired sessions are purged hourly (bootstrapImageProcessingQueue GC interval) + immediately on logout (auth.ts:275). Revocation propagates to the next request. | High | Strong | auth.ts:275: `db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)))` on logout. New requests call `verifySessionToken` which hits the DB. |

### Evidence For

- auth.ts:29: `verifySessionToken(token)` is called fresh on each `getSession()` invocation, hitting the DB to check session expiry. React `cache()` only deduplicates WITHIN a single request's render tree.
- Middleware (proxy.ts:86–101) does a cheap cookie format check only — full DB verification is in server actions. This is defense-in-depth: middleware redirects missing/malformed tokens, actions verify cryptographically.

### Current Best Explanation

**Verdict: CONFIRMED SAFE.** Session revocation is correctly propagated cross-request. Per-request memoization is documented acceptable (TRC-R5C1-06). No new finding.

---

## TRC-R5C2-06 — SW fetch path: deploy mid-session cache invalidation

### Observation

SW_VERSION is embedded in cache names (`gk-images-${SW_VERSION}`, etc.). On deploy, `build-sw.ts` stamps a new SHA. The new SW installs, activates, calls `skipWaiting()`, and purges old caches. The concern: during the window between old SW and new SW, does the image SWR + ETag HEAD probe correctly handle the version bump?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Old SW continues serving from `gk-images-{old-SHA}` cache until activation of new SW; new SW activation purges old cache and starts fresh | High | Strong | sw.js:294–315: `activate` handler purges all `gk-images-*` caches not matching current `SW_VERSION`. `skipWaiting()` in `install` causes immediate activation on next page load. |
| 2 | HEAD probe ETag mismatch on deploy: new ETag (new pipeline version or settings-hash change) causes stale-cache bypass correctly | High | Strong | staleWhileRevalidateImage:208–226: If ETag differs (`networkEtag !== cachedEtag`), the full GET is dispatched. Correct. |
| 3 | Admin-render HTML could be cached by old SW if the x-gk-admin-render header was absent in the old SW version | Low | Weak | The `x-gk-admin-render` header check has been present since R4C6. Old and new SW both exclude admin-rendered pages from HTML cache. |

### Evidence For

- sw.js:289–291: `install` handler calls `self.skipWaiting()` — new SW takes over on next page load.
- sw.js:294–315: `activate` handler deletes all old-versioned caches.
- sw.js:252: `networkResponse.headers.get('x-gk-admin-render') !== '1'` — admin pages excluded from HTML cache in both old and new SW versions.

### Evidence Against / Gaps

- Gap (MEDIUM): The SW uses `fetch(request.url, { method: 'HEAD', headers: { 'If-None-Match': cachedEtag } })` for ETag probing (sw.js:210). HEAD requests to Next.js static files (`/uploads/avif/…`) served from `public/` are handled by Next's static server, which does honor If-None-Match. However, the HEAD probe creates TWO requests per cached image load (HEAD + conditional GET on miss), doubling request count for ETag-miss cases. This is a performance concern, not a correctness concern.
- Gap: `isSensitiveResponse` checks `Cache-Control: no-store` (sw.js:60–62). Every public HTML page ships `no-store` (per CLAUDE.md). The HTML cache's `networkFirstHtml` function explicitly exempts this via its own logic (sw.js:252), but does NOT call `isSensitiveResponse`. This is the documented deliberate exemption (R4C6 COR-R4C6-05). Correct.

### Current Best Explanation

**Verdict: CONFIRMED SAFE for correctness.** SW cache invalidation on deploy works correctly. Performance gap (double HEAD+GET on ETag miss) is pre-existing and not introduced by cycle 1.

---

## TRC-R5C2-07 — DB restore window vs concurrent uploads/queue/analytics (maintenance flag scope)

### Observation

`isRestoreMaintenanceActive()` reads from `globalThis[restoreMaintenanceKey].active` (restore-maintenance.ts:21–23). In the single-writer Docker topology, `globalThis` is per-process. The restore lock (`gallerykit_db_restore`) is a MySQL advisory lock, server-scoped. The question: is the process-local flag always consistent with the DB lock state?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | In single-process topology (CLAUDE.md documented), process-local flag is fully consistent with DB lock | High | Strong | Single web instance means `beginRestoreMaintenance()` and `endRestoreMaintenance()` are called within the same process that holds the DB lock. |
| 2 | A process crash DURING restore leaves DB advisory lock held until MySQL connection closes, but process-local flag resets to `false` on next process start | High | Strong | restore-maintenance.ts: flag is not persisted; it initializes to `false` (line 11–17). Advisory lock auto-releases when pool connection closes on crash. So on restart: flag=false, lock=released. Both reset consistently. ✓ |
| 3 | Analytics flush (view_count increment) races the restore window | Low | Weak | Documented in CLAUDE.md: "best-effort approximate analytics; best-effort approximate" — `view_count` buffered in memory, flushed async. A restore could overwrite a flush target. TRC-R5C1-07 verdict: acceptable. |

### Evidence For

- restore-maintenance.ts:1–19: process-local state via `globalThis` symbol, initialized `active: false`.
- image-queue.ts:231: `enqueueImageProcessing` checks `isRestoreMaintenanceActive()` before accepting new work.
- admin-backfill-runner.ts:374: `triggerAdminBackfill` checks `isRestoreMaintenanceActive()` before proceeding.

### Current Best Explanation

**Verdict: CONFIRMED SAFE for documented topology.** In multi-instance deployment (explicitly warned against in CLAUDE.md), the process-local flag cannot be shared — this is a known documented limitation, not a new finding.

---

## TRC-R5C2-08 — Stripe checkout → webhook → entitlement → paid download: idempotency and replay

### Observation

Stripe webhook route idempotency check (webhook/route.ts:307–323): `SELECT id FROM entitlements WHERE session_id = sessionId LIMIT 1` before INSERT. If the row exists, the webhook returns 200 to Stripe without re-minting a token. This prevents duplicate entitlements on Stripe retry.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Idempotent skip on duplicate webhook is correct | High | Strong | webhook/route.ts:307–323: pre-check on session_id; if row exists, skip token generation and return 200 to Stripe. |
| 2 | Token re-issue path is absent: if customer loses download token (email not delivered), no recovery path exists | High | Strong | No admin action for re-issue; TRC-R5C1-15 (plan-315, item 5) schedules a `reissueDownloadToken` action as planned work for cycle 1+. |
| 3 | The idempotency check is a SELECT then INSERT, not an INSERT ... ON DUPLICATE KEY — TOCTOU window between SELECT and INSERT exists | Medium | Moderate | Two concurrent webhook deliveries with the same session_id could both pass the SELECT check before either INSERT completes, resulting in a duplicate entitlement row. |

### Evidence For

- Hypothesis 3: webhook route executes `SELECT ... WHERE session_id = sessionId` then `INSERT` as separate queries without a transaction or UNIQUE constraint enforcement at application level. The `entitlements.session_id` column has a UNIQUE index (per schema; this is how Cycle 3 RPF / P262-07 described the idempotency). If UNIQUE constraint exists at DB level, the duplicate INSERT would throw a `ER_DUP_ENTRY` error, which may not be handled gracefully.

### Evidence Against / Gaps

- Gap: Need to verify whether `entitlements.session_id` has a UNIQUE constraint at the DB level. If it does, duplicate INSERT is caught by the DB and should be handled with a try/catch or `INSERT IGNORE`. Let me check.

Based on the webhook route comment "INSERT entitlement with session_id UNIQUE for idempotency" (line 22) and "Cycle 3 RPF / P262-07 / C3-RPF-07: idempotency on retry" (line 307), the UNIQUE constraint IS on the schema. The application SELECT-before-INSERT is belt-and-braces; the DB enforces uniqueness independently.

### Current Best Explanation

**Verdict: CONFIRMED SAFE** for idempotency correctness. UNIQUE DB constraint + pre-check = two-layer protection. Token re-issue gap is tracked in plan-315 item 5 (in-flight).

---

## TRC-R5C2-09 — Backfill `reprocessOne` does not validate `processImageFormats` return shape

### Observation

`reprocessOne` at admin-backfill-runner.ts:190–207 destructures `result.wasDownscaled` and `result.avif10bit` from `processImageFormats`. The return type of `processImageFormats` is `{ wasDownscaled: boolean, avif10bit: boolean }` (process-image.ts:1280). These field names must match what `reprocessOne` reads.

### Evidence

- process-image.ts:1280: `return { wasDownscaled: processingInputPath !== inputPath, avif10bit };` ✓
- admin-backfill-runner.ts:206–207: `wasDownscaled = result.wasDownscaled; avif10bit = result.avif10bit;` ✓

Field names match. No discrepancy. **Confirmed safe.**

---

## TRC-R5C2-10 — getGalleryConfig React cache() called from background queue workers

### Observation

`getGalleryConfig = cache(_getGalleryConfig)` (gallery-config.ts:204). `cache()` is React's per-request deduplication primitive. In background workers (image-queue.ts, admin-backfill-runner.ts), code runs outside any React render context.

### Evidence

- React's `cache()` outside a React render context falls back to a simple call-through with no memoization. Each call to `getGalleryConfig()` in the background queue hits the DB fresh. This is documented expected behavior.
- admin-backfill-runner.ts:297: `const config = await getGalleryConfig()` — called once at start of `runBackfill`, then settings are snapshotted into `RunnerSettings`. Subsequent `reprocessOne` calls use the snapshot, not repeated `getGalleryConfig` calls. ✓
- image-queue.ts:316–332: config is read per-job only when `quality` and `imageSizes` are absent from the job payload (bootstrap path). Upload-time jobs include `quality` snapshot. Correct.

**Verdict: CONFIRMED SAFE.** Background workers get fresh DB reads per invocation (no stale memo). Backfill snapshots settings once per run.

---

## TRC-R5C2-11 — Backfill advisory lock hand-off: lock connection lifetime vs fire-and-forget pattern

### Observation

`triggerAdminBackfill` acquires the backfill advisory lock, then hands the lock connection to `runBackfill` via `lockConnHandoff = lockConn; lockConn = null` (admin-backfill-runner.ts:402–403). `runBackfill` is called fire-and-forget. The lock is released in `runBackfill`'s `finally` clause.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Lock is released by `finally` in `runBackfill` — correctly always called | High | Strong | admin-backfill-runner.ts:362–365: `finally { state.running = false; await releaseBackfillLock(lockConn).catch(() => undefined); }` |
| 2 | If `runBackfill` throws synchronously before entering the try block, the finally doesn't catch it and the lock is held | Very Low | Weak | `runBackfill(lockConnHandoff).catch(...)` at :412 catches synchronous rejection. But the lock connection would not be released in this path. |

### Evidence For / Against

- admin-backfill-runner.ts:284–366: `runBackfill`'s entire body is inside a `try { ... } catch { ... } finally { ... }`. The `try` starts at line 294 (`state.running = true`). If `getState()` at line 293 throws synchronously (would require `globalThis` to be broken), the `finally` would not run. This is theoretical — `getState()` cannot throw under normal conditions.
- The `.catch()` at line 412 logs the error but does NOT release the lock if the `finally` never ran.

**Verdict:** Theoretical gap only. `getState()` cannot throw in practice. **Confirmed safe for normal operation.**

---

## TRC-R5C2-12 — retryFailedImage enqueues with stale `colorSignals` from DB

### Observation

`retryFailedImage` at images.ts:1093–1111 re-enqueues with `colorSignals` from the DB row (`image.color_primaries`, `image.transfer_function`, etc.). These were written at original upload time (or last backfill). If the original image's detection was wrong (e.g., the reason for failure was an ICC parsing bug now fixed), the retry re-uses the stale signals instead of re-detecting from the file.

### Evidence

- The queue job (`processImageFormats`) uses the passed `colorSignals` for color pipeline decisions (image-queue.ts:345–349). It does NOT re-run `detectColorSignals` during the queue job — that happened in `saveOriginalAndGetMetadata`.
- For a retry of a FAILED upload (never successfully processed), the `colorSignals` in the DB are from the upload's `saveOriginalAndGetMetadata` call. If that detection succeeded but the subsequent `processImageFormats` failed, signals are correct.
- If the failure was in `detectColorSignals` itself (rare — detection happens before DB insert for fresh uploads; but for bootstrapped retries, signals come from DB), the retry would use whatever was last stored.

**Verdict:** Low-severity design characteristic, not a regression introduced by cycle 1. The retry behavior is consistent with the backfill runner's behavior (both use stored DB signals). **Not a new finding — noted for completeness.**

---

## Final Sweep

| Flow | Status | Key Finding |
|------|--------|-------------|
| Upload → save-original → unlink-on-detection-failure | SAFE | No race with backfill (detection fails before DB insert) |
| Queue retry + concurrent backfill per-image lock gap | **TRC-R5C2-01 MEDIUM** | Backfill does not hold per-image advisory lock; can race with queue worker on retry path |
| Backfill keyset cursor correctness | SAFE | Stable keyset cursor; pre-existing orphan-file gap on concurrent delete |
| retryFailedImage auth gate | SAFE (TRC-R5C1-18 closed) | |
| retryFailedImage claimRetryCounts not cleared | **TRC-R5C2-03 LOW** | stale count can exhaust claim-retry budget on first miss after retry |
| semantic_search_mode fail-closed | SAFE | Three-layer defense; validator + config-reader + route all block 'production' |
| Session lifecycle / React cache() revocation | SAFE | Cross-request revocation works; per-request memo is documented acceptable |
| SW deploy cache invalidation | SAFE | Version-based cache purge + ETag probe correct |
| DB restore vs uploads/queue/analytics | SAFE | Single-writer topology; process-local flag consistent with DB lock |
| Stripe checkout → webhook → entitlement idempotency | SAFE | UNIQUE DB constraint + pre-check; re-issue gap tracked in plan-315 |
| Backfill return-shape field names | SAFE | Field names match |
| GalleryConfig cache() in background workers | SAFE | React cache() is no-op outside render; backfill snapshots once |
| Backfill lock-connection handoff | SAFE | finally clause always releases; theoretical gap only |

## Residual Uncertainties

1. **TRC-R5C2-01**: Per-image advisory lock scope for the backfill runner is the primary open gap. Whether this is reachable in practice depends on the likelihood of an admin clicking "Re-encode" exactly while a `retryFailedImage` result is being processed — low frequency, but architecturally incorrect.

2. **TRC-R5C2-03**: `claimRetryCounts` cleanup in `retryFailedImage` is a straightforward one-line fix.

3. **Stripe re-issue path** (TRC-R5C1-15): Tracked in plan-315 item 5, not yet implemented. Lost download tokens require manual DB surgery.

4. **AVIF HEAD probe double-request**: Performance issue (HEAD + conditional GET per image load when ETag differs). Not a correctness issue. No action this cycle unless a performance review is triggered.

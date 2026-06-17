# Debugger Report — Run-7 Cycle-1

**HEAD:** `17f743f7` (same as orchestrator-stated HEAD)
**Scope:** Latent-bug & failure-mode review across the entire repo. Failure-prone surfaces examined: async queue, backfill, view-count flush, SIGTERM/SIGKILL recovery, crash-during-write, advisory-lock release on every path, CLIP singleton retry, rate-limit Map eviction, memory bounds, Stripe webhook, LR upload, partial-failure ordering, try/catch swallowing.
**Verification executed at HEAD:**
- `npx tsc --noEmit -p tsconfig.typecheck.json` → **exit 0**.
- `npx vitest run --reporter=dot` → **237 files passed / 2 skipped; 2231 tests passed / 4 skipped / 0 failed**. The 4 skips are the model-weight-gated CLIP suites (`clip-offline-load` ×2, `clip-semantic-integration` ×2) — gated by design on `CLIP_MODELS_ROOT` weights, NOT failures.

## Verdict: 0 confirmed latent bugs. 1 LOW-severity observation (pre-existing, documented design contract — not scheduled; not a regression).

The codebase continues to converge. The cycle-11 debugger verdict (0 confirmed latent bugs) holds at HEAD `17f743f7` for the failure-mode angle. Every advisory lock, every fire-and-forget path, every atomic-rename, every partial-failure window I traced through is correctly bracketed by `try/finally` with idempotent release helpers, and every floating-promise pattern that does not block its caller carries either an inner `try/catch` or a terminal `.catch()` so it cannot surface as an `unhandledRejection` (which newer Node versions would use to terminate the process).

---

## Paths Examined (exhaustive)

### 1. Image-queue async pipeline (`apps/web/src/lib/image-queue.ts`)

**Status: Safe.** All five latent-bug angles clean.

- **Floating promises / unhandled rejections:** the caption hook (L395–410) is a `.then(async …).catch(…)` chain on `generateCaption(...)`. Even if the inner `async` callback's `db.update(...)` throws, it propagates to the `.catch(captionErr)` arm — the chain always settles. The embedding hook (L434–478) is an IIFE `void (async () => { … })()` whose body is wrapped in `try { … } catch (embedErr) { console.warn … }` (L443–477) — the IIFE never rejects, so there is no unhandled rejection. `enqueueImageProcessing` itself is synchronous and cannot float.
- **Try/catch swallowing:** L333 `catch {}` (Sharp fallback to defaults on DB-unavailable) is intentional and documented (Sharp 90/85/90 defaults are safe). L439 `catch {}` (semantic-mode probe skips silently on DB-unavailable) is the documented contract.
- **DB-vs-files consistency on crash:** the conditional `UPDATE … WHERE processed = false` (L370–372) is the source of truth. On `affectedRows === 0` (deleted-mid-processing, L374–391) the worker removes the just-written variants via `deleteImageVariants(dir, fn, [])` (full directory scan — catches non-default sizes). On a process crash between Sharp encode and the UPDATE, the row stays `processed = false`; the next bootstrap re-discovers it and re-encodes (idempotent — atomic `.tmp` rename clobbers prior bytes).
- **Crashed worker self-heal:** bootstrap (L608–731) re-scans `processed = false` rows; per-image advisory lock `gallerykit:image-processing:{jobId}` (L195–212) is held on a dedicated `PoolConnection` released in the worker's `finally` (L544–557). A crashed worker drops the connection, MySQL auto-releases the lock, the next worker acquires it cleanly.
- **Permanently-failed tracking bounded:** `MAX_PERMANENTLY_FAILED_IDS = 1000` with FIFO eviction (L501–514); `MAX_RETRY_MAP_SIZE = 10000` with `pruneRetryMaps` FIFO eviction (L98–111). The eviction callback (L506–513) ALSO cleans the associated `claimRetryCounts`/`retryCounts`/`lastErrors` entries so stale state does not accumulate.
- **Bootstrap GC re-arm:** AGG-M12 fix at L712 guards the hourly GC timer arming on `!state.gcInterval` so a multi-batch bootstrap no longer resets the 1-hour countdown on every continuation. Confirmed correct.
- **Restore quiesce deadlock (COR-R4C12-01):** `quiesceImageProcessingQueueForRestore` (L733–774) uses the documented `pause() → clear() → onIdle()` order so a paused queue with queued jobs does not deadlock waiting for `idle` (which never fires on a paused queue with non-empty queue). The comment at L737–756 documents the exact deadlock this prevented.

### 2. Admin backfill runner (`apps/web/src/lib/admin-backfill-runner.ts`)

**Status: Safe.**

- **Advisory-lock release on every path:** `runBackfill`'s body is wholly inside a single `try { … } finally { state.running = false; await releaseBackfillLock(lockConn).catch(() => undefined); }` (L627–808). The fire-and-forget `runBackfill(...).catch(...)` at L855 has a belt-and-braces catch for synchronous pre-`try` rejection (e.g. `getState()` re-entrancy). `triggerAdminBackfill`'s outer `catch` (L859–865) releases the lock if it was acquired but an error preceded handoff.
- **Per-image claim release:** `reprocessOne` (L442–615) holds the per-image claim across the entire encode→detect→UPDATE window in a `try { … } finally { await releaseImageProcessingClaim(row.id, claimConn).catch(() => undefined); }` (L610–614). The acquire (L484–490) is in its own `try/catch` so a pool-exhausted getConnection is classified as a `locked` skip, not an escape that leaks the claim.
- **Deleted-mid-reencode orphan cleanup (AGG-R8c3-03):** both the success branch (L573–576) and the detection-failed branch (L605–608) check `affectedRows === 0` and call `cleanupDeletedMidReencodeVariants` (L430–440) which passes `[]` sizes to `deleteImageVariants` for a full directory scan. Mirrors the upload-queue worker exactly.
- **Resumability:** candidate selection is `pipeline_version < CURRENT` (L400–408), so already-re-encoded rows are filtered out automatically. Detection-failed rows deliberately do NOT get a version bump (L580–609 with the long lineage comment) so a later run retries detection — the documented "pick up where it left off" contract.
- **Concurrency clamp:** `resolveBackfillConcurrency` (L129–142) clamps `ADMIN_BACKFILL_CONCURRENCY` to a pool-budget cap (`floor((LIMIT − RESERVED − 1) / 2)`) so a background re-encode cannot pin the shared pool. NaN guard at L137 for non-finite `poolLimit`.

### 3. View-count flush (`apps/web/src/lib/data.ts:43–202`)

**Status: Safe.**

- **Graceful SIGTERM flush wired:** `instrumentation.ts:18–22` calls `flushBufferedSharedGroupViewCounts()` inside `Promise.race([Promise.all([shutdownImageProcessingQueue, flushBufferedSharedGroupViewCounts]), shutdownTimeout(15s)])`. Both SIGTERM and SIGINT are registered via `process.once` (L33–34). Documented loss-on-SIGKILL invariant (CLAUDE.md) is honest — SIGKILL cannot be intercepted by any handler.
- **Double-buffer swap is atomic:** L95–96 `const batch = viewCountBuffer; viewCountBuffer = new Map()` is a reference swap. New increments during drain go to the fresh map. No lost increments on mid-flush crash (the old `batch` is drained chunk-by-chunk; a crash mid-drain loses only the in-flight chunk, not the post-swap increments).
- **COR-R4C11-01 stale-timer fix:** L75 `viewCountFlushTimer = null` runs BEFORE the `isFlushing` guard, so a timer that fires while a prior flush is draining does not strand the variable in a stale already-fired state. This was previously a real silent-strand bug; the fix is correct and is locked by existing tests.
- **Capacity bounds:** `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` (drops at L47–50 with a warn), `MAX_VIEW_COUNT_RETRY_SIZE = 500` with FIFO eviction (L169–187). Re-buffer path (L122–130) re-checks capacity before re-inserting. Post-flush enforcement loop (L143–150) catches overflow from re-buffered entries that already existed in the new map.
- **Restore-maintenance gate:** `bufferGroupViewCount` early-returns when `isRestoreMaintenanceActive()` (L44–46), so no new increments accumulate during a DB restore window. `restoreDatabase` (db-actions.ts:333) awaits `flushBufferedSharedGroupViewCounts()` BEFORE `quiesceImageProcessingQueueForRestore()` — by the time the quiesce runs, the buffer is already drained.

### 4. DB restore (`apps/web/src/app/[locale]/admin/db-actions.ts:266–520`)

**Status: Safe.**

- **Advisory lock on dedicated connection:** `conn = await connection.getConnection()` (L283) is held for the whole restore window; `GET_LOCK(LOCK_DB_RESTORE, 0)` is non-blocking (L289–296). Released in the inner `finally` (L349–351) on every path including the maintenance-begin early-return (L323–325, the AGG8R-03 fix). The outer `finally` (L355–360) releases `conn`. MySQL auto-releases `GET_LOCK` on connection close, so a crashed restore never wedges the next attempt.
- **Upload-contract lock pairing:** `acquireUploadProcessingContractLock(0)` (L302) is acquired after the restore lock and released in the same inner `finally` (L352–353). The contract-lock helper (`upload-processing-contract-lock.ts`) has an idempotent `released` flag so a double-release is a no-op.
- **Temp-file cleanup on every path:** `runRestore` writes the FormData to `os.tmpdir()/restore-<uuid>.sql` (L375) and unlinks it in the header-invalid branch (L404), the dangerous-SQL branch (L435), the missing-config branch (L442), AND the `close` handler (L496) — covering success AND failure. The `failRestore` helper (L465–474) also unlinks.
- **Inner early-return at L337:** the `return { success: false }` inside the inner `try` still triggers BOTH finally blocks (inner: endRestoreMaintenance + resume queue + release locks; outer: conn.release). Verified by JS `try/finally` semantics — `return` inside `try` runs the `finally` before the function returns.
- **Stream-error handling:** `readStream.on('error')`, `restore.stdin.on('error')`, `restore.stderr.on('data')`, `restore.on('close')`, `restore.on('error')` all route through `failRestore` (L465) which destroys streams, kills the child, unlinks, and resolves. `settled` flag (L463) prevents double-resolve.

### 5. CLIP inference singleton (`apps/web/src/lib/clip-model.ts:76–108`)

**Status: Safe.**

- **Retryable on failure:** `loadPromise` is set to `null` inside the `.catch((err) => { loadPromise = null; throw err; })` arm (L101–105), so a failed load (missing weights, corrupt ONNX, OOM) does NOT wedge the singleton — the next call re-attempts. This is the documented cycle-11 finding (verified correct) and remains correct at HEAD.
- **Dimension guards:** `data.length < EMBEDDING_DIM` throws explicitly for both text (L133–137) and image (L193–197) embeddings. Missing output keys (`l2norm_text_embeddings` / `l2norm_image_embeddings`) throw explicit errors (L129–131, L189–191).
- **No reset path needed:** once loaded, the model is cached for the process lifetime. A `false`-equivalent never populates `loadPromise` because the catch re-nulls it.

### 6. Rate-limit Map eviction (`apps/web/src/lib/rate-limit.ts` + `bounded-map.ts`)

**Status: Safe.**

- **All in-memory Maps are bounded:** `loginRateLimit` (WindowBoundedMap, 5000 keys), `searchRateLimit` (ResetAtBoundedMap, 2000), `ogRateLimit` (2000), `checkoutRateLimit` (2000), `shareRateLimit` (2000), `semanticRateLimit` (2000). Each `preIncrement*` helper calls its `prune(now)` first.
- **DB-backed `decrementRateLimit` transaction (L461–491):** wraps UPDATE (`GREATEST(count-1, 0)` — prevents negative count) and DELETE-of-zero in a single `db.transaction`. Concurrent increments between the UPDATE and DELETE are not lost because the transaction holds the row locks. All four call sites (`sharing.ts:73`, `admin-users.ts:54`, `public.ts:36,72`) wrap the call in `.catch(err => console.debug(...))` so a transient DB error does not surface as an unhandled rejection.
- **`getClientIp` proxy-header trust (L161–192):** gated on `process.env.TRUST_PROXY === 'true'`. Without it, an attacker cannot spoof `X-Forwarded-For` to bypass per-IP limits. The `unknown` fallback (L186) means all untrusted-proxy users share one bucket — the warn at L189 surfaces this.

### 7. Stripe webhook (`apps/web/src/app/api/stripe/webhook/route.ts`)

**Status: Safe.** Partial-failure / idempotency well-handled.

- **Idempotency on retry:** SELECT-then-INSERT (L320–331) is the primary idempotency guard for the manual-distribution log line; `onDuplicateKeyUpdate({ set: { sessionId } })` (L357–365) is belt-and-suspenders for the SELECT→INSERT race. The `insertedFresh` disambiguation (L382: `affectedRows === 1 && insertId > 0`) correctly distinguishes a TRUE fresh insert from a no-op dup-key loser under `CLIENT_FOUND_ROWS` (the prior R4C3 form gated on `affectedRows === 1` alone and would log a dead token).
- **Deleted-image FK handling (COR-R4C18-02):** both the pre-INSERT SELECT (L273–281) and the INSERT catch (L390–398) detect `ER_NO_REFERENCED_ROW_2` / missing row and return 200 (so Stripe stops retrying) with a structured manual-refund error log. Without this, Stripe's multi-day retry schedule would have hammered a permanent-FK 500 indefinitely.
- **Documented `async_payment_succeeded` gap:** the CLAUDE.md / in-code comment at L95–112 documents that `checkout.session.async_payment_succeeded` is NOT yet handled — delayed-payment methods (bank transfer / ACH) would complete checkout but never receive an entitlement row. This is mitigated operationally by the card-only pin (`app/api/checkout/[imageId]/route.ts` `payment_method_types: ['card']`, AGG-H1) so async methods cannot be initiated. This is a documented, tracked deferral (plan-316 CRT-R5C1-04), NOT a latent bug — it is intentional interim guard.

### 8. Atomic-rename in `process-image.ts` (L1227–1259, L1565–1643)

**Status: Safe.**

- **Atomic-rename fallback chain:** `link → rename` (atomic, zero-copy) → `copyFile → rename` (atomic if rename succeeds) → `copyFile` (non-atomic, only on severely broken filesystem, with a `console.warn`). The `.tmp` file is always cleaned in the `finally` (L1255–1257, L1643). A crash between `link` and `rename` leaves a `.tmp` file, which `cleanOrphanedTmpFiles` (image-queue.ts:32–73) sweeps at bootstrap — and the sweep now narrows its catch to ENOENT-expected (AGG8R-08) so a real I/O error surfaces.
- **Partial-format failure cleanup (R10-L11):** `writtenSizedPaths` tracks every file written by THIS invocation; the `catch` at L1295–1311 unlinks only those paths (via `Promise.all` of `.catch(() => {})`-wrapped unlinks) so a mid-size AVIF failure does not leave smaller AVIF variants stranded, AND pre-existing files from a prior successful run are not touched.

### 9. Upload path (`apps/web/src/app/actions/images.ts:108–541`)

**Status: Safe.**

- **File-vs-DB ordering:** `saveOriginalAndGetMetadata` writes the original FIRST (L279), then `db.insert(images)` (L382). On DB-insert failure, the catch (L464–481) deletes the saved original via `deleteOriginalUploadFile(savedOriginalFilename)` — so a failed insert does not orphan the original. `savedOriginalFilename` is tracked per-file (L270) and nulled after cleanup so the outer per-file catch (L468–470) does not double-delete.
- **Upload-contract lock released in finally (L538–540):** the lock helper's `release()` is idempotent (the `released` flag), so even if the inner code threw before the explicit `await uploadContractLock.release()`, the finally would still run.
- **Tracker pre-claim reconciliation (L511–512):** `settleUploadTrackerClaim` adjusts the optimistically-pre-claimed bytes/count to the actual success count, so a partial-failure upload does not permanently consume the tracker budget.

### 10. Lightroom upload route (`apps/web/src/app/api/admin/lr/upload/route.ts`)

**Status: Safe.** Symmetric with the browser path.

- Contract lock released in `finally` (L478–482). DB-insert failure cleanup at L406–414 deletes the original AND calls `settleTrackerToActual(false)` AND returns 500. Audit log is `.catch()`-wrapped (L463–470) so a transient DB error does not fail the upload response.

### 11. SIGTERM/SIGKILL handling (`apps/web/src/instrumentation.ts`)

**Status: Safe.**

- **Graceful flush wired:** `flushBufferedSharedGroupViewCounts` runs in `Promise.race` with a 15s shutdown timeout. After the race resolves (or times out), `process.exit(0)` runs.
- **`process.once` (not `process.on`):** the handler is one-shot, so a second signal during the drain window does not re-enter `gracefulShutdown` — it falls through to Node's default SIGTERM behavior (immediate exit). This is the correct posture: a polite SIGTERM drains; an impatient second SIGTERM kills.
- **Documented SIGKILL loss:** CLAUDE.md is explicit that the shared-group view buffer is best-effort and lost on SIGKILL — this is the honesty invariant, not a bug.

---

## LOW-severity observation (NOT scheduled — documented design contract)

### OBS-R7C1-01 [LOW, conf H] — `deleteImage` best-effort file cleanup can orphan derivatives on transient disk error

**Where:** `apps/web/src/app/actions/images.ts:618–632` (and the batched sibling `deleteImages` at L752–760).

**Scenario:**
1. Admin deletes an image. The DB transaction (L603–607) commits, removing the `images` and `imageTags` rows.
2. The parallel `collectImageCleanupFailures` (L50–81) runs `deleteImageVariants` for webp/avif/jpeg/original with a single 50 ms retry (L44, L57–67).
3. If a transient disk error (NFS hiccup, EIO, brief ENOSPC) causes ALL retries to fail for one or more formats, the `images` row is already gone, but the on-disk `{filename}_{size}.{ext}` files remain — orphaned, with no DB row referencing them.

**Severity: LOW.** This is the documented "best-effort" pattern (`cleanupFailureCount` is surfaced to the admin at L636; the operator can manually sweep `public/uploads/{avif,webp,jpeg}/`). It is also self-healing on the NEXT delete of a different image — the orphaned files are simply never reaped (they do not block any future operation; they only consume disk). For a personal-gallery single-writer topology this is acceptable.

**Why I am NOT scheduling it:**
- It is a documented design contract, not a regression — the `cleanupFailureCount` return field exists specifically to surface it.
- The fix (a janitor that sweeps `public/uploads/*` for files whose `images` row is gone) is a feature, not a minimal bug fix, and is out of scope for the debugger angle (the contract is honest, the surface is intentional).
- No data loss, no security implication, no crash, no consistency violation at the DB level.

**Re-open criterion:** if orphan accumulation becomes a real disk-pressure issue on the deploy host (the `df -h /` line in deploy logs trends upward across cycles with no matching `images` growth), a background janitor becomes warranted. The 2026-06-17 disk-full incident documented in `CLAUDE.md` was a Docker image/cache accumulation issue, NOT orphaned upload variants — so this criterion has not yet been hit.

---

## Final sweep — commonly-missed issues

- **Off-by-one in `clampSemanticTopK` / `isRateLimitExceeded`:** verified in cycle-11 and unchanged. `isRateLimitExceeded(count, max, includesCurrent)` correctly flips on `>` vs `>=` based on the pre-increment contract.
- **Null/undefined in `decodeEmbeddingColumn`:** 3-case decode (raw Buffer / legacy base64-in-Buffer / string) all return `null` on non-match, callers filter. Locked by existing tests.
- **Type coercion in `getTrustedProxyHopCount`:** `Number.parseInt(value, 10)` with `!Number.isInteger(parsed) || parsed < 1` guard falls back to default. No coercion bug.
- **Async ordering in `flushGroupViewCounts`:** the `viewCountFlushTimer = null` (L75) runs BEFORE the `isFlushing` guard (L76) — the documented COR-R4C11-01 fix. The reentrant path (L83–86) re-arms only if `viewCountBuffer.size > 0 && !viewCountFlushTimer`. Correct.
- **`resolveBackfillConcurrency` NaN guard:** L137 `Number.isFinite(poolLimit) ? poolLimit : 10` handles the test-mock-missing-binding case so the cap arithmetic never yields NaN.
- **`safeInsertId` BigInt precision:** used at images.ts:384 and lr/upload/route.ts:405 to prevent silent BigInt→Number precision loss on AUTO_INCREMENT ids. Correct.
- **`toMySqlDateTime` vs `toISOString`:** the `failed_at` write at image-queue.ts:529 uses `toMySqlDateTime(new Date())` — the prior `toISOString()` form carried a trailing `Z` that MySQL strict mode rejected (ER 1292), and the catch swallowed it so `processing_error` never persisted. Documented fix at L517–523, verified intact.

---

## Summary

| Path | Status | Notes |
|---|---|---|
| image-queue.ts (async, claim, retry, bootstrap) | Safe | All floating promises have terminal `.catch()`; advisory lock released in `finally`; permanently-failed IDs bounded with FIFO eviction |
| admin-backfill-runner.ts | Safe | Single `try/finally` wraps the whole run; per-image claim in nested `try/finally`; deleted-mid-reencode cleanup on both success and detection-failed branches |
| data.ts view-count flush | Safe | Graceful SIGTERM flush wired (instrumentation.ts:18–22); double-buffer swap atomic; COR-R4C11-01 stale-timer fix intact; capacity-bounded |
| db-actions.ts restore | Safe | Advisory lock on dedicated conn released on every path; upload-contract lock idempotent; temp file cleaned on every path; inner early-return triggers both finally blocks |
| clip-model.ts singleton | Safe | `loadPromise` nulled on failure → retryable; dimension guards throw explicit errors |
| rate-limit.ts Maps | Safe | All Maps bounded (WindowBoundedMap / ResetAtBoundedMap); `decrementRateLimit` transactional with `GREATEST(...-1, 0)` |
| stripe webhook | Safe | SELECT-then-INSERT idempotency + `onDuplicateKeyUpdate` belt-and-suspenders; deleted-image FK returns 200; `async_payment_succeeded` gap documented + card-only mitigated |
| process-image.ts atomic rename | Safe | 3-stage fallback (link/rename → copy/rename → copy); `.tmp` cleaned in finally; orphan sweep at bootstrap |
| images.ts upload | Safe | File-then-DB ordering with cleanup on insert failure; contract lock released in finally; tracker pre-claim reconciled |
| lr/upload route | Safe | Symmetric with browser path; contract lock in finally; audit log `.catch`-wrapped |
| instrumentation.ts SIGTERM | Safe | `process.once` (one-shot); 15s shutdown timeout via `Promise.race`; documented SIGKILL-loss invariant is honest |

**Net confirmed latent bugs this cycle: 0.**
**Observations (pre-existing, documented, not scheduled): 1 (OBS-R7C1-01 LOW — `deleteImage` best-effort cleanup orphans on transient disk error; documented via `cleanupFailureCount` return field; self-healing criterion defined).**
**Typecheck: PASS (exit 0). Tests: 2231 pass / 4 design-gated skips / 0 fail.**

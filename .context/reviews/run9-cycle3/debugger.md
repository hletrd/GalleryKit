# Debugger Review — Run-9 Cycle-3

**Scope:** Full repo deep debugging sweep.  
**Baseline:** run-9 cycle-2 commit c2d3857a. Since that commit, one production fix landed (`e1acaff1` — `onEmpty` → `onIdle` in `backfill-cicp-recheck.ts`); no other production logic changed.  
**Instruction:** Hold a HIGH bar. Do NOT manufacture findings. Do NOT re-file adjudicated BENIGN/REFUTED items.

---

## 1. cicp-recheck onEmpty → onIdle Fix Verification

**Commit:** `e1acaff1` — `apps/web/scripts/backfill-cicp-recheck.ts:136`

**Correctness verdict: CORRECT.**

The fix replaces `queue.onEmpty()` with `queue.onIdle()` at line 136. The distinction (per p-queue 9.1.2):

- `onEmpty()` resolves when `queue.size === 0` (nothing waiting), but `queue.pending` may still be > 0 (tasks actively running).
- `onIdle()` resolves when `queue.size === 0 && queue.pending === 0` (all work done).

All four per-row counters (`checked`, `flips.*`, `missing`, `errors`) are mutated inside queued task bodies. With `onEmpty()`, the final `≤ concurrency` in-flight tasks could race the summary print at lines 138–147. With `onIdle()`, all task bodies complete before execution reaches the summary. No double-counting or error mishandling is introduced — the counters are incremented once per task with no shared mutable state between tasks.

The fix matches all five sibling drain sites in the codebase (`backfill-color-pipeline.ts:500`, `image-queue.ts:595/759`, `queue-shutdown.ts:33`, `admin-backfill-runner.ts:764`), which all use `onIdle()`.

**No residual issues.** The script is read-only (never writes DB or filesystem) so even the pre-fix race could only corrupt diagnostic output, not data.

---

## 2. Two New Test Files from Cycle-1 (TE-R9C1-01, TE-R9C1-02)

### `upload-tracker-state.test.ts` (TE-R9C1-01)

**Verdict: VALID. Does not mask real bugs.**

The tests correctly exercise the three functions in `upload-tracker-state.ts`:

- `pruneUploadTracker`: expiry boundary (strict `>` comparison at `now - entry.windowStart > WINDOW_MS * 2`), MAX_KEYS eviction (collect-then-delete, insertion-order FIFO).
- `resetUploadTrackerWindowIfExpired`: strict `> WINDOW_MS` comparison at the 1x boundary.
- `hasActiveUploadClaims`: positive (count > 0, bytes > 0), negative (empty tracker, window-expired entries that get in-place zeroed before the count check).

The `globalThis[Symbol.for('gallerykit.uploadTracker')]` singleton is cleared in `beforeEach` — no cross-test contamination. All boundary values are derived from the same constants the production module uses (`WINDOW_MS = 60 * 60 * 1000`, `MAX_KEYS = 2000`). The test correctly captures the edge case at line 133–138: a stale entry (`windowStart` > 1x window ago but < 2x window ago) gets its count/bytes zeroed by `resetUploadTrackerWindowIfExpired` inside `hasActiveUploadClaims`, so it is NOT counted as an active claim.

### `upload-processing-contract-lock.test.ts` (TE-R9C1-02)

**Verdict: VALID. Does not mask real bugs.**

Tests pin both `number` and `BigInt(1)` arms of the `acquired === 1 || acquired === BigInt(1)` guard at `upload-processing-contract-lock.ts:32`. The mock correctly simulates mysql2's pool connection interface (`.query()` returning `[[{ acquired }], undefined]`, `.release()` as a spy). The idempotency test confirms `RELEASE_LOCK` is issued exactly once on double-release. The null/0/error/connection-failure paths are all covered without false assurance — each path returns `null` and releases the connection exactly once.

---

## 3. Benign-Table Spot-Check (5 modules)

| Module | Check | Verdict |
|--------|-------|---------|
| `color-detection.ts` | `MAX_DEPTH = 5` at line 231; `walk()` guards `depth > MAX_DEPTH` before recursing; 1 MB pre-cap on buffer before `walk()` call | BENIGN — confirmed at current HEAD |
| `gps-exif-strip.ts` | `MAX_IFD_CHAIN = 8`, `MAX_IFD_ENTRIES = 1024` at lines 43–44; `visited` Set cycle detection at lines 158–161; `ifdAbs <= tiffStart + 7` structural guard at line 157 | BENIGN — confirmed at current HEAD |
| `validation.ts` | `UNICODE_FORMAT_CHARS` (no `/g`) used only with `.test()` at lines 74, 106, 120; `UNICODE_FORMAT_CHARS_GLOBAL` (new RegExp with `/g`) kept separate, used only with `.replace()` at line 94 — no `lastIndex` hazard | BENIGN — confirmed at current HEAD |
| `upload-tracker-state.ts` | All Map iterations use collect-then-delete; `hasActiveUploadClaims` runs `pruneUploadTracker` then `resetUploadTrackerWindowIfExpired` before counting — no stale-window false positive | BENIGN — confirmed at current HEAD |
| `image-queue.ts` `pruneRetryMaps` | Collect-then-delete for three Maps (`retryCounts`, `claimRetryCounts`, `lastErrors`) at lines 99–110; `MAX_RETRY_MAP_SIZE` cap enforced | BENIGN — confirmed at current HEAD |

---

## 4. Fresh Sweep

### 4a. Global `/g` Regex Reuse

All module-level `/g` regexes found:

| Symbol | File | Usage | Safe? |
|--------|------|-------|-------|
| `UNICODE_FORMAT_CHARS_RE` | `sanitize.ts:17` | `.replace()` only (line 22) | Yes — `.replace()` resets `lastIndex` |
| `UNICODE_FORMAT_CHARS_GLOBAL` | `validation.ts:82` | `.replace()` only (line 94) | Yes |
| `OG_C0_CONTROL_CHARS` | `og-sanitize.ts:25` | `.replace()` only (line 29) | Yes |
| `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` | `sql-restore-scan.ts:18` | `.replace()` via `maskMatches()` only (line 105) | Yes |

`sanitize.ts:165–170` contains an explicit comment documenting the `/g` + `.test()` hazard and explaining why `UNICODE_FORMAT_CHARS_RE` is not used with `.test()`. The comment itself demonstrates the team is aware of the hazard class. No violation found.

`DANGEROUS_SQL_PATTERNS` in `sql-restore-scan.ts` are all non-`/g` and used only with `.test()` — safe.

**No `/g` lastIndex hazard found.**

### 4b. Promise Error-Swallowing

Reviewed all `.catch()` call sites in `src/lib/`:

- `image-queue.ts:408` — caption generation failure: logged with `console.warn`, fire-and-forget by design (must not block queue job).
- `image-queue.ts:587`, `599` — bootstrap retry/continuation: logged with `console.debug`, scheduled retry paths.
- `image-queue.ts:602` — `onIdle()` rejection: resets `bootstrapContinuationScheduled` flag + logs, belt-and-braces.
- `image-queue.ts:689–718` — background GC tasks (session purge, bucket purge, audit log, view events): all log with `console.debug`, all are best-effort maintenance.
- `admin-backfill-runner.ts:435` — `cleanupDeletedMidReencodeVariants` cleans up orphaned variant files: logs with `console.warn`, does not suppress the error from the caller's perspective (function signature is `Promise<void>`, and the error is non-fatal post-deletion cleanup).
- `admin-backfill-runner.ts:807`, `861` — `releaseBackfillLock` in finally/error path: `catch(() => undefined)` swallows lock-release failure, which is correct — the advisory lock is released automatically on connection close anyway; swallowing here prevents a secondary error from masking the primary.
- `clip-model.ts:101` — nulls `loadPromise` then re-throws, allowing callers to retry on next request.
- `upload-paths.ts:77–78` — `fs.unlink` for legacy paths: `catch(() => {})` is correct (file may not exist on both paths).
- `data.ts:111` — view count flush retry with bounded retry count and `console.warn` on drop.
- `admin-tokens.ts:159` — `last_used_at` update: `console.debug` log, non-critical metadata.
- `process-image.ts:270` — `handle?.close()` best-effort fd release.
- `serve-upload.ts:169` — `realpath` failure returns typed error.

**No error-swallowing corruption found.** Every silent `.catch` is either best-effort cleanup, non-critical metadata, or has an explicit re-throw after state reset.

### 4c. Unhandled Rejection Paths

`bootstrapImageProcessingQueue` is the only async function called without `await` at the process level. All call sites either `await` it or attach `.catch(console.debug)` — the `scheduleBootstrapRetry` and `scheduleBootstrapContinuation` wrappers both handle rejection. No bare floating Promise found.

### 4d. BigInt / Number Coercion

- `validation.ts:176–183` — `safeInsertId` guards both `> Number.MAX_SAFE_INTEGER` and `< Number.MIN_SAFE_INTEGER` before `Number(insertId)`.
- `gps-exif-strip.ts:395`, `472` — `BigInt(Number.MAX_SAFE_INTEGER)` guard before `Number(big)`.
- `upload-processing-contract-lock.ts:32` — `acquired === 1 || acquired === BigInt(1)` dual-arm guard; now covered by TE-R9C1-02.
- `admin-backfill-runner.ts:378` — `Number(rows[0].cnt)` on a `COUNT(*)` result. `COUNT(*)` on any realistic row count (< 2^53) is safe with `Number()`. Not an exploitable overflow.

**No unsafe BigInt coercion found.**

### 4e. Map/Set Mutation During Iteration

All Map iteration in `src/lib/` uses the established collect-then-delete pattern (confirmed at `data.ts:178–186`, `image-queue.ts:99–110`, `upload-tracker-state.ts:31–59`). The only direct-delete-during-iteration site is `sw-cache.ts` and `bounded-map.ts`, both confirmed benign in prior cycles.

**No mutation-during-iteration bug found.**

---

## Determination

**0 new bugs.**

- cicp-recheck `onIdle` fix is correct.
- Both new test files (TE-R9C1-01, TE-R9C1-02) are valid and do not mask real bugs.
- All 5 spot-checked benign-table modules confirmed clean at current HEAD.
- Fresh sweep of `/g` regex reuse, Promise error-swallowing, BigInt coercion, and Map mutation during iteration found no latent bugs.

**Convergence confirmed.**

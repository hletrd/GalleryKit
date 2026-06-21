# Architect Review — Run-9 Cycle-4 (HEAD `094842a4`)

**Date:** 2026-06-21
**Reviewer angle:** architecture invariants — advisory-lock coverage/scope, race-condition protections, image-queue lifecycle, ETag/cache-invalidation precedence, settings-hash COLOR_IMPACTING_KEYS, connection-pool budgeting, migration/schema-drift reconcile parity, process-local vs shared state. High bar: only genuine architectural DEFECTS that manifest in the shipped single-writer Docker topology.

## Verdict: ZERO NEW ARCHITECTURAL DEFECTS — convergence holds.

Every architecture invariant validated against code at HEAD `094842a4`. The CLAUDE.md architecture claims I spot-checked are all accurate against the source. No new correctness / data-loss / scaling hazard found in the shipped single-writer topology. The carried-forward deferrals (R7C1-CR-01, OBS-R7C2-02..07, advisory-lock server-scope note, ARCH-R7C2-01) remain documented-design or multi-writer-only and were NOT re-filed.

---

## Source delta verified (since run-8 convergence `f63af3b9`)

`git diff --stat f63af3b9..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle apps/web/messages` = exactly 4 files:
- `scripts/backfill-cicp-recheck.ts` (+11/-2) — CR-R9C2-01 drain fix
- `__tests__/upload-processing-contract-lock.test.ts` (new, +146) — TE-R9C1-02
- `__tests__/upload-tracker-state.test.ts` (new, +147) — TE-R9C1-01 + TE-R9C3-01 hardening
- `components/bulk-edit-dialog.tsx` (+4/-2) — DES-R9C3-01 a11y

ZERO production architecture / schema / config / migration / lock-logic change since `f63af3b9`. The only production-adjacent change is the cicp-recheck SCRIPT drain (`onEmpty()`→`onIdle()`, off any product runtime path). `git diff f63af3b9..HEAD -- scripts/backfill-cicp-recheck.ts` confirms it is the documented 1-line drain swap with a correct sibling-site rationale; cicp-recheck holds NO advisory lock (correct — read-only diagnostic; `grep GET_LOCK` = 0 hits).

## Gate state (fresh runs by me at HEAD `094842a4`)

- `npm run typecheck` (app + scripts) → exit 0. Machine-proof that schema.ts ↔ data-layer types ↔ settings-hash key-guard all align (the `_ColorKeysAreSettingKeys` / privacy guards compile).
- Lock + invariant test suites (5 files, 37 tests) all pass: `upload-processing-contract-lock.test.ts`, `backfill-color-pipeline.test.ts` (column-set contract), `admin-backfill-runner-detection-failure.test.ts` (no version bump on detection fail), `settings-hash.test.ts`, `privacy-fields.test.ts`.

---

## Invariants validated (file:line evidence)

### 1. Advisory-lock coverage + scope — CLEAN
All 6 lock names centralized in `apps/web/src/lib/advisory-locks.ts:21-49` and used at exactly the documented sites with acquire/release symmetry on **dedicated pool connections**:

| Lock | Acquire | Release | Scope |
|---|---|---|---|
| `LOCK_DB_RESTORE` | `db-actions.ts:290` `GET_LOCK(?,0)` | `:304/:323/:349` (all 3 early-return + finally paths) | nested w/ contract lock |
| `LOCK_UPLOAD_PROCESSING_CONTRACT` | `upload-processing-contract-lock.ts:28` | `:49` (closure) + `:63` (error path) | held for full restore window |
| `LOCK_TOPIC_ROUTE_SEGMENTS` | `topics.ts:67` `GET_LOCK(?,5)` | `:78` finally | per-rename |
| `LOCK_ADMIN_DELETE` | `admin-users.ts:219` `GET_LOCK(?,5)` | `:284` finally (only if acquired) | **global, table-wide** |
| `LOCK_COLOR_PIPELINE_BACKFILL` | `admin-backfill-runner.ts:310` `GET_LOCK(?,0)` | `:327` | whole-run, dedicated conn |
| `getImageProcessingLockName(jobId)` | `image-queue.ts:199` + `admin-backfill-runner.ts:347` `GET_LOCK(?,0)` | `:218` / `:364` | per-image |

- **admin_delete is correctly GLOBAL, not target-scoped** (`admin-users.ts:215`). The protected invariant ("never delete the last admin") is table-wide, so a global lock is the right choice — two concurrent deletes of *different* users serialize, COUNT-then-DELETE runs inside the lock+transaction window (`:227-265`), lock released in `finally` only if acquired, conn always released. No "delete the final two accounts" race.
- **Restore dual-lock ordering is consistent** (`db-actions.ts`): always db_restore (`:290`) THEN contract (`:309`); both released on every early-return (`:304-305`, `:323-326`) and in the inner finally (`:349-361`). No lock-ordering deadlock; the documented C3-AGG-01 single-release invariant holds (inner finally nulls `uploadContractLock`, outer finally only releases the conn).
- Server-scope caveat is documented design (`advisory-locks.ts:6-15` + CLAUDE.md) — multi-tenant-only, NOT a single-writer defect. Not re-filed.

### 2. Race-condition protections — CLEAN
- **Delete-while-processing** (`image-queue.ts:370-391`): conditional `UPDATE ... WHERE id=? AND processed=false`; on `affectedRows===0` → `deleteImageVariants(dir, fn, [])` with **`[]` empty sizes** so the full directory scan catches non-default-configured-size variants (AGG-C4-04). Matches the backfill runner's `cleanupDeletedMidReencodeVariants` (`admin-backfill-runner.ts:430-440`) and both UPDATE branches there (`:573`, `:605`). Symmetric across all 3 re-encode paths (queue + in-app runner + sidecar).
- **Per-image claim** is 0-second NON-BLOCKING `GET_LOCK` in both the queue worker (`image-queue.ts:195-212`) and the backfill runner (`admin-backfill-runner.ts:343-359`); a pool-exhausted `getConnection()` in the runner degrades to a `locked` skip (`:484-493`), NOT a tight error spin — documented AGG-R5C3-05 and verified.
- **Restore quiesce** (`image-queue.ts:733-774`) uses the COR-R4C12-01-correct `pause()` → `clear()` → `await onIdle()` ordering that fixed the prior real deadlock; `beginRestoreMaintenance()` runs before quiesce so enqueue is rejected, eliminating clear↔onIdle interleave.
- **TOCTOU at serve path** (`serve-upload.ts:181-184, 265`): `realpath` containment check, then `createReadStream(resolvedPath)` (not the original path) closes the symlink-swap TOCTOU; symlink + non-file rejected (`:177`); 4-layer path traversal (allowlist dir `:138`, ext↔dir map `:147`, segment regex/length/`..` `:154-160`, realpath-startsWith `:182`).

### 3. Image-queue lifecycle — CLEAN
Bounded everywhere: retry maps capped `MAX_RETRY_MAP_SIZE=10000` with collect-then-delete FIFO prune (`image-queue.ts:98-111`); permanently-failed set capped `MAX_PERMANENTLY_FAILED_IDS=1000` with FIFO eviction + associated-map cleanup (`:501-514`); bootstrap excludes permanently-failed IDs via `notInArray` (`:626-628`) so no infinite re-enqueue; GC timer armed ONCE (`!state.gcInterval` guard `:712`, AGG-M12) so multi-batch bootstrap doesn't starve the hourly purges; all timers `unref()`'d. Verify-3-formats-non-zero before marking processed (`:359-366`). All state process-local — documented single-writer design (header CLAUDE.md "Runtime topology").

### 4. ETag / cache-invalidation precedence — CLEAN
- `serve-upload.ts:215` ETag = `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`; settingsHash is 8 chars already (`settings-hash.ts:68` `HASH_LENGTH=8`) so no `.slice(0,8)` at the ETag site — matches CLAUDE.md.
- COLOR_IMPACTING_KEYS is **not** re-enumerated inline at the ETag site (`serve-upload.ts:197-202` references the constant only — AGG-D1/AGG-C3-06 drift fix holds).
- `settings-hash.ts:42-54` has **exactly 9** keys (5 color + 3 quality + image_sizes), matching CLAUDE.md "COLOR_IMPACTING_KEYS=9". Compile-time `_ColorKeysAreSettingKeys` guard present (`:63-66`).
- Cache policy `public, max-age=3600, must-revalidate` consistent across the 304 path (`:230`) and 200 path (`:252`).
- Static-path-vs-serve-upload-path invalidation gotcha (CRT-D1) is documented design, not a defect: static path rides mtime+size ETag (re-encode rewrites file); serve-upload path adds the settings-hash. R8-H1 config-arg form bypasses the internal cache and is debounced by serve-upload's own 5 s SWR cache (`:46-83`).

### 5. Connection-pool budgeting — CLEAN
`resolveBackfillConcurrency` (`admin-backfill-runner.ts:129-142`): `cap = max(1, floor((LIMIT − RESERVED − 1)/2))` with `RESERVED = max(3, ceil(LIMIT/2))` → at POOL_CONNECTION_LIMIT=10, RESERVED=5, **cap=2** (matches CLAUDE.md). NaN-guard on a non-finite pool import (`:137`) prevents a frozen PQueue. A backfill pins ≤ 1 (lock) + 2×2 (workers) = 5, leaving ≥ 5 for a live `getImage()` `Promise.all` fan-out. Requests above cap clamped DOWN with a warning (`:664-669`). Sidecar `BACKFILL_CONCURRENCY` is uncapped by design (separate `--rm` container, own pool).

### 6. Migration / schema-drift reconcile parity — CLEAN (independently re-verified by parser)
- Journal (`drizzle/meta/_journal.json`) confirmed non-monotonic exactly as documented (idx 7 `when=1746144000000` < idx 6 `1778304060000`) — this is WHY `migrate.js` uses hash-based post-conditions, not `MAX(created_at)`. Newest entries 0018-0023 strictly monotonic.
- **schema.ts `images` ↔ reconcileLegacySchema parity: HOLDS.** Programmatic column diff (base CREATE 37 cols + 24 `ensureColumn` ALTERs) → **every schema.ts `images` column is reconciled; ZERO missing.** The color/HDR era columns (0015-0018: color_pipeline_decision/color_primaries/transfer_function/matrix_coefficients/is_hdr/has_gain_map/pipeline_version) ARE present (`migrate.js:385-391`, the R4C1 COR-R4C1-13 fix), plus avif_10bit (`:401`), uploaded_by (`:396`), processing_error/failed_at (`:398-399`).
- Migration-0023 removals (entitlements table + license_tier column) mirrored as `dropTableIfPresent`/`dropColumnIfPresent` LAST (`:627-628`) so reconcile converges to the post-0023 schema.
- Post-condition assertion (`migrate.js:724-734`) throws on any journal hash missing from `__drizzle_migrations` — fails the deploy loud on future drift. Fresh-DB and legacy-DB both route through the same reconcile + per-entry baseline path (`prepareLegacyDatabaseIfNeeded:675-712`, COR-R4C1-12). typecheck-pass + privacy-fields test-pass corroborate the column-set is consistent end-to-end.
- Orphan `0014_drop_reactions.sql` (on disk, no journal entry) = INFO-R7C2-08, destructive-action-gated, NOT re-filed.

### 7. Process-local vs shared state — documented design, NOT a defect
All process-local state (rate-limit fast-path buckets, restore-maintenance flag, backfill-runner status, shared-group view buffer, image-queue maps) is correctness-fenced by advisory locks where correctness matters (backfill, upload contract, image-processing claim) and explicitly documented as single-writer-topology design in CLAUDE.md "Runtime topology". These are multi-writer-only concerns (R7C1-CR-01 etc.) — out of scope per the high bar, NOT re-filed.

---

## NON-FINDINGS / re-confirmed-benign this cycle (do NOT re-file)
- cicp-recheck drain fix (CR-R9C2-01) — re-verified correct + complete; matches all sibling drain sites; read-only, no lock needed.
- All carried-forward deferrals (R7C1-CR-01..04, OBS-R7C2-02..07, INFO-R7C2-08/09, advisory-lock server-scope, ARCH-R7C2-01) — re-confirmed unchanged at HEAD; documented-design / multi-writer-only / operator-mitigated. NOT re-filed.
- settings-hash no-arg vs config-arg divergence (R8-H1) — benign-by-design; serve path uses config-arg form. NOT a defect.

## Disposition
- **NEW architectural defects:** 0.
- **Convergence:** CONFIRMED on the architecture axis. Eight prior cycles' agents + this fresh deep parser-assisted sweep agree.

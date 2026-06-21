# Architect Review — Run-9 Cycle-5 (HEAD `e34c04cf`)

**Date:** 2026-06-21
**Reviewer angle:** architecture invariants — single-writer-topology invariants, shared-state hazards (process-local vs scale-out), advisory-lock acquire/release symmetry on dedicated connections, race conditions, schema/migration drift (schema.ts ↔ reconcileLegacySchema parity), connection-pool budgeting, ETag/cache invalidation, data-access `cache()` dedup. High bar: only genuine architectural DEFECTS manifesting in the shipped single-web-instance / single-MySQL-writer Docker topology.

## Verdict: ZERO NEW ARCHITECTURAL DEFECTS — convergence holds.

Every invariant was **independently re-verified against source at HEAD `e34c04cf`** (not trusted from prior review text). All hold. The only production-source changes since run-8 convergence are two pure-a11y UI components with zero architectural surface. No DEFECT manufactured. Carried-forward deferrals were NOT re-filed (no new evidence met any exit criterion).

## Schema ↔ reconcile parity verdict: **0 MISSING COLUMNS** (exact bijection).

Programmatic diff: `schema.ts images` = **50 columns**; `reconcileLegacySchema` reconciled set (base `CREATE TABLE images` 37 cols ∪ `ensureColumn(images,…)` 24 ALTERs) = **50 columns**. Set difference both directions = **0 missing, 0 extra**. The color/HDR era columns (`color_pipeline_decision`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `pipeline_version`, `avif_10bit`, `uploaded_by`, `was_downscaled`, `processing_error`, `failed_at`) are all reconciled. Independent of prior-cycle text; recomputed this cycle.

---

## Source delta verified (since run-8 convergence `f63af3b9`)

`git diff --name-only f63af3b9..HEAD` (excluding `.context/reviews`) = 6 files:
- `public/sw.js` — regenerated SW_VERSION stamp (build artifact)
- `scripts/backfill-cicp-recheck.ts` (+11/-2) — CR-R9C2-01 drain fix (off-runtime diagnostic script)
- `__tests__/upload-processing-contract-lock.test.ts` (new) — TE-R9C1-02
- `__tests__/upload-tracker-state.test.ts` (new) — TE-R9C1-01/TE-R9C3-01
- `components/bulk-edit-dialog.tsx` (+4/-2) — DES a11y (aria-labels on SelectTrigger/input/textarea)
- `components/similar-photos.tsx` (+19/-5) — DES-R9C4-01 a11y (non-empty accname on thumb Link)

**ZERO production change to advisory locks, image-queue, schema, migrate.js, settings-hash, serve-upload, data-access, gallery-config, or any migration since `f63af3b9`.** The two UI deltas are pure accessibility additions (aria-label / accessible-name fallbacks) — no shared state, no data access, no locks, no DB. Not architecture-relevant. `backfill-cicp-recheck.ts` holds NO advisory lock (correct — read-only diagnostic).

## Gate state (fresh runs this cycle at HEAD `e34c04cf`)

- `npm run typecheck` (app + scripts) → **exit 0**. Machine-proof that schema.ts ↔ data-layer types ↔ `_ColorKeysAreSettingKeys` settings-hash guard ↔ privacy guards all compile.
- Invariant suites (5 files, **37 tests, all pass**): `settings-hash.test.ts`, `privacy-fields.test.ts`, `backfill-color-pipeline.test.ts`, `admin-backfill-runner-detection-failure.test.ts`, `upload-processing-contract-lock.test.ts`.

---

## Invariants re-verified (file:line evidence, independent)

### 1. Advisory-lock coverage + acquire/release symmetry on dedicated connections — CLEAN
All 6 lock names centralized in `advisory-locks.ts:22-49`; `grep GET_LOCK/RELEASE_LOCK` shows every acquire has a paired release on a **dedicated pool connection**:

| Lock | Acquire | Release path(s) | Notes |
|---|---|---|---|
| `LOCK_DB_RESTORE` | `db-actions.ts:290` `GET_LOCK(?,0)` | `:304` + `:323` (2 early-returns) + `:349` (restore finally); conn always released `:359` | dual-lock w/ contract |
| `LOCK_UPLOAD_PROCESSING_CONTRACT` | `upload-processing-contract-lock.ts:28` | `:49` (closure) + `:63` (acquire-error path) | held full restore window |
| `LOCK_TOPIC_ROUTE_SEGMENTS` | `topics.ts:67` `GET_LOCK(?,5)` | `:78` finally (`.catch`) | per-rename |
| `LOCK_ADMIN_DELETE` | `admin-users.ts:219` `GET_LOCK(?,5)` | `:284` finally **only if `lockAcquired`** (`:283`); conn `:286` | global, table-wide |
| `LOCK_COLOR_PIPELINE_BACKFILL` | `admin-backfill-runner.ts:310` + sidecar `backfill-color-pipeline.ts:305` | `:327` / `:516` | whole-run, dedicated conn |
| `getImageProcessingLockName(jobId)` | `image-queue.ts:199` (via local alias of the import, `:184-185`) + runner `:347` | `:218` / `:364` | per-image, `GET_LOCK(?,0)` non-blocking |

- **admin-delete is correctly GLOBAL** (`advisory-locks.ts:35-44`, `admin-users.ts:215`): the protected invariant ("≥1 admin remains") is table-wide, so COUNT-then-DELETE runs inside one global lock + transaction (`admin-users.ts:227-265`). Two concurrent deletes of *different* users serialize → no "delete the final two" race. Release-only-if-acquired (`:283`), conn always released (`:286`).
- **Restore dual-lock**: ordering always db_restore (`:290`) THEN contract (`:302`); both released on every early-return (`:304-306`, `:323-327`) and in the inner finally (`:349-353`). Inner finally nulls `uploadContractLock`; outer finally only releases conn (`:355-359`) — the documented C3-AGG-01 single-release invariant. Verified the quiesce-throw path (`:334`): the inner catch's `return` (`:337`) is inside the outer try (`:331`), so the finally (`:341`) still releases both locks + resumes queue. No leak on any path.

### 2. Race-condition protections — CLEAN
- **Delete-while-processing affectedRows===0 cleanup symmetric across ALL 3 re-encode paths**: queue worker `image-queue.ts:374-388` → `deleteImageVariants(dir, fn, [])` (empty sizes = full directory scan, catches non-default-size variants); in-app runner BOTH UPDATE branches `admin-backfill-runner.ts:573-575` + `:605-607` → `cleanupDeletedMidReencodeVariants` (`:430-440`, also `[]`); sidecar `backfill-color-pipeline.ts:127-131` + `flushBatch` `:456`. Identical contract.
- **Restore quiesce ordering**: `image-queue.ts:757-759` `pause()` → `clear()` → `await onIdle()` — the COR-R4C12-01 deadlock fix. Comment (`:754-757`) documents `beginRestoreMaintenance()` runs before quiesce so no new-job interleave between clear() and onIdle().
- **Per-image claim** non-blocking `GET_LOCK(?,0)` in both queue + runner; pool-exhaust degrades to `locked` skip, not a spin.

### 3. Image-queue lifecycle / bounded state — CLEAN
- Retry maps capped `MAX_RETRY_MAP_SIZE=10000` (`:81`, `:100-101`); permanently-failed set capped `MAX_PERMANENTLY_FAILED_IDS=1000` with FIFO eviction + associated-map cleanup (`:502-507`); bootstrap excludes permanently-failed via `notInArray(images.id, …)` (`:626-627`) → no infinite re-enqueue.
- GC timer armed ONCE (`if (!state.gcInterval)` `:712`, AGG-M12) so a multi-batch bootstrap doesn't starve hourly purges; all 5 sweeps wired (sessions/buckets/audit/view-events/retry-prune `:714-719`); timer `unref()`'d (`:721`).

### 4. ETag / settings-hash — CLEAN
- `serve-upload.ts:215` ETag = `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. `settings-hash.ts:68` `HASH_LENGTH=8` → no `.slice(0,8)` at ETag site.
- `COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`) = **exactly 9** (5 color + 3 quality + `image_sizes`), matching CLAUDE.md. Compile-time `_ColorKeysAreSettingKeys` guard present (`:63-66`). The ETag site references the constant only (`serve-upload.ts:198-199`) — no inline re-enumeration drift.
- Cache policy `public, max-age=3600, must-revalidate` consistent on 304 (`:230`) + 200 (`:252`) paths.

### 5. Connection-pool budgeting — CLEAN
`resolveBackfillConcurrency` (`admin-backfill-runner.ts:129-139`): `cap = max(1, floor((LIMIT − RESERVED − 1)/2))`, `RESERVED = max(3, ceil(LIMIT/2))`. At `POOL_CONNECTION_LIMIT=10` → RESERVED=5, **cap=2**. NaN-guard on non-finite pool import (`:131-137`). A backfill pins ≤ 1 (lock) + 2×2 (workers) = 5, leaving ≥ 5 for a live `getImage()` fan-out. Over-cap requests clamped DOWN with warning. Sidecar `BACKFILL_CONCURRENCY` uncapped by design (separate `--rm` container, own pool).

### 6. Migration / schema-drift — CLEAN (parser-verified)
- Journal (`drizzle/meta/_journal.json`) 24 entries; **exactly 1 non-monotonic `when` pair** (idx 7 `1746144000000` < idx 6 `1778304060000`) — the documented historical reason migrate.js uses hash-based post-conditions, not `MAX(created_at)`. Last 6 entries (18-23) strictly monotonic → future migrations baseline cleanly.
- schema.ts ↔ reconcileLegacySchema images parity = **0 missing** (see verdict above).
- 0023 removals (entitlements table + license_tier col) mirrored as drop-if-present LAST so reconcile converges to post-0023 state; post-condition assertion throws on any journal hash missing from `__drizzle_migrations`.

### 7. Data-access `cache()` dedup — CLEAN
10 `cache()`-wrapped exports in `data.ts` (`:1330,1606-1619,1660`) = the 9 documented `*Cached` + `getSeoSettings`, matching CLAUDE.md exactly. Privacy guards (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`) compile (typecheck exit 0).

### 8. Process-local vs shared state — documented single-writer design, NOT a defect
All process-local state (rate-limit fast-path buckets, restore-maintenance flag, backfill-runner status, shared-group view buffer, image-queue maps) is correctness-fenced by advisory locks where correctness matters and is explicitly documented as single-writer-topology design (CLAUDE.md "Runtime topology"). Multi-writer-only concerns → out of scope per the high bar, NOT re-filed.

---

## NON-FINDINGS / re-confirmed-benign (do NOT re-file)
- The two UI deltas (`bulk-edit-dialog.tsx`, `similar-photos.tsx`) — pure a11y, zero architecture surface. Verified by full diff.
- `backfill-cicp-recheck.ts` drain (CR-R9C2-01) — off-runtime diagnostic, no lock needed.
- Carried deferrals (R7C1-CR-01 restore-maintenance process-local; OBS-R7C2-02..06; INFO-R7C2-08 orphan `0014_drop_reactions.sql`; INFO-R7C2-09 lock separator; advisory-lock server-scope note; ARCH-R7C2-01 Stripe CLOSED-OBSOLETE) — re-confirmed unchanged at HEAD; documented-design / multi-writer-only / operator-mitigated. No new evidence met any exit criterion. NOT re-filed.

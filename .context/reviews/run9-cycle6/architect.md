# Architect Review — run-9 cycle-6

**Scope:** architecture / concurrency / invariants. HEAD `ba3277da`. Single web-instance / single-writer topology.
**Bar:** HIGH. Deeply-converged repo; "ZERO new DEFECTS" is the success condition.

## Summary

All five assigned areas verified clean. The 6 MySQL advisory locks are symmetrically acquired/released on every path including error paths; the 3 delete-mid-reencode cleanup paths (queue, in-app runner, sidecar) all use the full-scan `deleteImageVariants(dir, fn, [])` form; the schema↔reconcile parity is **18 of 18 tables, 0 missing columns** (independently corroborated by the existing `migrate-reconcile-coverage.test.ts` runtime-introspection contract); the ETag settings-hash invariants hold (9 keys, HASH_LENGTH 8); and the migration journal post-condition is sound (idx 23 is the strict unique max). 147 targeted invariant tests pass. No new defects.

---

## 1. Advisory-lock acquire/release symmetry (6 locks)

Enumerated every `GET_LOCK` site repo-wide (non-test): exactly 6 distinct lock names across 6 sites, all matching `advisory-locks.ts`. Each is symmetric.

| Lock | Site | Acquire | Release | Verdict |
|---|---|---|---|---|
| `gallerykit:image-processing:{jobId}` | `image-queue.ts:195-222` | `acquireImageProcessingClaim` non-blocking GET_LOCK(0) | `releaseImageProcessingClaim` in queue-task `finally` (`:545`) with `.catch`; conn released in `finally` | CLEAN |
| `gallerykit_db_restore` | `db-actions.ts:283-360` | GET_LOCK(0) on dedicated pooled conn | released on ALL 3 early-returns (upload-contract-fail `:304`, maintenance-begin-fail `:323`, success/throw outer `finally` `:349`); `conn.release()` outer `finally` | CLEAN |
| `gallerykit_upload_processing_contract` | `upload-processing-contract-lock.ts` | GET_LOCK(timeout) | `release()` idempotent via `released` flag; conn-acquire-fail→null, non-acquired→release+null, query-throw→conditional release | CLEAN |
| `gallerykit_topic_route_segments` | `topics.ts:61-82` | `withTopicRouteMutationLock` GET_LOCK(5) | `finally` release-if-acquired + `conn.release()` | CLEAN |
| `gallerykit_admin_delete` | `admin-users.ts:209-287` | GET_LOCK(5), `lockAcquired` guard | `finally` release-if-acquired + `conn.release()`; rollback on throw | CLEAN |
| `gallerykit_color_pipeline_backfill` | runner `admin-backfill-runner.ts:303-333`; sidecar `backfill-color-pipeline.ts:301-520` | in-app GET_LOCK(0) non-blocking; sidecar GET_LOCK(10) | runner: `runBackfill` `finally` `:807` always releases; `triggerAdminBackfill` releases on zero-work `:837` and on count-throw via catch `:860`; handoff nulls `lockConn` `:846` so no double-release. sidecar: every `process.exit()` preceded by `lockConn.release()` (`:311/:317/:355`); success release `:516`+`:520` | CLEAN |

No missing finally/release on any error path. The handoff pattern in `triggerAdminBackfill` (null `lockConn` after handoff, runner owns lifetime) is correct — if `fetchCandidateCount()` throws after acquire but before handoff, the catch at `:860` releases.

## 2. Race conditions / shared-state hazards (single-writer)

- **Queue claim/process/mark** (`image-queue.ts:255-558`): per-image GET_LOCK claim → `WHERE processed=false` conditional check `:286` → conditional UPDATE `:370-372`. Claim retry capped (MAX_CLAIM_RETRIES=10) with escalating backoff + `unref`. CLEAN.
- **Delete-while-processing, all 3 paths use full-scan `[]`:**
  - Queue: `image-queue.ts:374-391` — `affectedRows===0` → `deleteImageVariants(dir, fn, [])` (AGG-C4-04). VERIFIED.
  - In-app runner: `admin-backfill-runner.ts:573-575` (signals branch) AND `:605-607` (detection-failed branch) → `cleanupDeletedMidReencodeVariants(row)` → `deleteImageVariants(dir, fn, [])` `:430-440`. BOTH branches covered. VERIFIED.
  - Sidecar: `backfill-color-pipeline.ts` — `collectDeletedMidReencodeFiles` filters `affectedRows===0` `:143-145`, `cleanupDeletedMidReencodeVariants` `:128-132` uses `[]`. VERIFIED.
- **Restore quiesce** (`image-queue.ts:733-761`): `pause() → clear() → onIdle()` then `enqueued.clear()` — matches documented shutdown order. CLEAN.
- **Backfill concurrency cap** (`resolveBackfillConcurrency` `:129-142`): at pool 10, RESERVED=max(3,ceil(10/2))=5, cap=max(1,floor((10−5−1)/2))=**2**. Matches spec. NaN-guard present (`:137`) against undefined pool-limit mock. CLEAN.
- Non-snapshot keyset walk (`fetchCandidateBatch`) correctness rests on the backfill advisory lock + fresh-uploads-at-CURRENT invariants, both documented and intact.

## 3. Schema↔reconcile parity (computed)

**RESULT: 18 of 18 tables covered; 0 missing columns.**

Method: extracted all 18 `mysqlTable` definitions from `src/db/schema.ts` with full column lists; parsed `reconcileLegacySchema` in `migrate.js` for both CREATE-TABLE bodies and `ensureColumn(...)` adds; computed the set difference.

- Tables: schema {18} ≡ reconcile CREATE-TABLE {18 (+`__drizzle_migrations` infra)}. Zero missing, zero extra.
- Columns: my first-pass regex flagged 3 (`topics.order`, `admin_settings.key`, `shared_groups.key`) — all FALSE POSITIVES: they are backtick-escaped reserved words (`` \`order\` `` `:274`, `` \`key\` `` `:293`/`:422`) my column regex skipped. Manually verified all three present. True missing-column count = **0**.
- Independent corroboration: `src/__tests__/migrate-reconcile-coverage.test.ts` introspects the live Drizzle schema (real column names via `Object.values(colsObj).map(c=>c.name)`, no regex blind spot), asserts every table has `CREATE TABLE IF NOT EXISTS` AND `missing = columns.filter(c=>!MIGRATE_SRC_CODE.includes(c))` is `[]`. PASSES — confirms my computation.
- 0023 removal symmetry: `reconcileLegacySchema` ends with `dropTableIfPresent('entitlements')` `:627` + `dropColumnIfPresent('images','license_tier')` `:628`; neither appears in schema.ts. Post-0023 state consistent on fresh + legacy + incremental paths.

**Schema-derived allowlists in sync:**
- `APP_BACKUP_TABLES` (`sql-restore-scan.ts:12-31`) = **18 tables**, matches schema exactly (c5 / CR-R9C5-01 fix confirmed; `sql-restore-scan.test.ts` passes).
- Privacy guards (`data.ts`): `PrivacySensitiveKeys` union (20 admin-only keys, `:414`) ∩ `publicSelectFields` asserted `never` via `_privacyGuard` `:416-417`; map-select + large-payload guards present. All admin-only color/HDR columns omitted from public; `avif_10bit` correctly PUBLIC (in `adminSelectFields:275`, absent from every omit block — R10-M4). `privacy-fields.test.ts` + `map-privacy.test.ts` pass.
- `COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`) = **9** keys (5 color + 3 quality + image_sizes), compile-time guarded by `_ColorKeysAreSettingKeys`.

## 4. ETag / cache-invalidation invariants

- `COLOR_IMPACTING_KEYS` = 9 ✓; `HASH_LENGTH` = 8 ✓ (`settings-hash.ts:68`).
- `buildHashFromConfig` `:89-102` maps all 9 keys; `fetchHashFromDb` selects the same set via `inArray`. No-arg form 5s-debounced; config-arg form pure. `settings-hash.test.ts` passes.
- The 9 keys are exactly the byte-impacting settings (color + quality + size). No byte-impacting setting omitted.

## 5. Migration journal monotonicity + post-conditions

- Journal has the documented non-monotonic dip at idx 7 (`0007_image_reactions`, when 1746144000000 < idx 6's 1778304060000) — this is the EXACT known condition `migrate.js` handles via per-entry hash baselining (`baselineAllJournalMigrations` `:658`) instead of MAX(created_at). Not a defect.
- New migration idx 23 (`0023_remove_paid_downloads`, when=1782000000000) is the **strict unique maximum** → passes drizzle's `lastDbMigration.created_at < folderMillis` cursor and the post-condition. Verified strict-max.
- `runMigrations` post-condition `:724-734`: `missing = expected.filter(m => !recordedHashes.has(m.hash))`; throws loud on any gap. Fresh-DB bootstrap routed through reconcile+baseline (`prepareLegacyDatabaseIfNeeded:678-696`, COR-R4C1-12). Sound.

## Evidence — test runs (all pass)

- settings-hash + privacy-fields + backfill-color-pipeline + admin-backfill-detection-failure: 30/30.
- migrate-reconcile-coverage + concurrency-cap + advisory-locks + sql-restore-scan + 2× deleted-mid-reencode + sidecar-deleted-mid-reencode + map-privacy: 109/109.
- Total: 147 invariant tests pass.

## Out-of-scope note

`apps/web/public/sw.js` is modified in the working tree but is solely the `SW_VERSION` git-SHA build stamp (`d1cde2e4-p7` → `ba3277da-p7`, regenerated by `scripts/build-sw.ts`). No SW logic change; benign for cache invariants.

## Schema↔reconcile parity computation result

**18 of 18 tables covered, 0 missing columns** (regex false-positives on backtick-escaped reserved words `order`/`key` manually disproven; corroborated by passing `migrate-reconcile-coverage.test.ts`).

---

## VERDICT: ZERO new DEFECTS

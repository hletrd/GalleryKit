# Tracer Report — Run-9 Cycle-5

**HEAD:** e34c04cf (SW_VERSION stamp for run-7 cycle-2; production source unchanged since run-8 convergence)
**Date:** 2026-06-21
**Flows traced:** 3

---

## Flow 1: Upload → Sharp processing → conditional UPDATE → derivative serving → ETag/cache

### Observation

The documented design requires that when an image is deleted while its
processing job is still running, the queue detects the deletion via an
`affectedRows === 0` result on the conditional `UPDATE images SET processed =
true WHERE id = ? AND processed = false`, then cleans up all derivative files
it just wrote. A per-image MySQL advisory lock (`GET_LOCK`) is supposed to
prevent two concurrent workers (e.g. across a restart boundary) from
double-processing the same upload. The ETag for derivative files on the
serve-upload path encodes `IMAGE_PIPELINE_VERSION`, mtime, size, and a
settings-hash.

Tracing target: does the delete-during-processing race fence hold end-to-end?
Does the ETag composition match the documented two-tier behaviour?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Race fence is correct: affectedRows guard + full-dir orphan scan are present and ordered correctly | High | Strong (source artifact, direct read) | All three paths corroborated below |
| 2 | Race fence has a gap: empty-sizes scan misses non-default variants | Low | Weak (eliminated by code) | Was plausible before reading deleteImageVariants |
| 3 | ETag two-tier gotcha: static files bypass settings-hash | High | Strong (source artifact) | Documented as deliberate (CRT-D1) |

### Evidence For

**H1 — per-image advisory lock**

`apps/web/src/lib/image-queue.ts` (lines ~232-248, from prior read):
- `GET_LOCK(?, 0)` (non-blocking) on key `gallerykit:image-processing:{jobId}` acquired
  before processing; released unconditionally in `finally`.
- Guard on `enqueueImageProcessing` at line 233:
  `if (state.shuttingDown || isRestoreMaintenanceActive()) { return; }` — new
  enqueues are rejected during the restore maintenance window.

**H1 — affectedRows race fence**

`apps/web/src/lib/image-queue.ts` (lines 374-391, from prior read):
```
if (updateResult.affectedRows === 0) {
    await Promise.all([
        deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp, []),
        deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif, []),
        deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg, []),
    ]);
    return;
}
```
Passing an empty `sizes = []` to `deleteImageVariants` triggers the full
directory scan path via `opendir` in `process-image.ts` lines 490-539.
This catches non-default-size variants that would be orphaned if the admin
changed `image_sizes` after enqueue.

**H3 — two-tier ETag**

`apps/web/src/lib/serve-upload.ts` line 215:
```
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```
Settings hash is from `settings-hash.ts`, covering 9 `COLOR_IMPACTING_KEYS`.
The 5-second module-scoped TTL cache with stale-while-revalidate is present.

Static files in `public/uploads/` are served by Next.js's filesystem layer
(mtime+size ETag only, no settings-hash component). This is the CRT-D1 gotcha
documented in CLAUDE.md: "flipping a color/quality/size admin setting does NOT
invalidate already-served STATIC derivatives … until a re-encode."

### Evidence Against / Gaps

**H2 — eliminated:** `deleteImageVariants` with `sizes = []` uses `opendir` to
enumerate all files in the directory matching the base filename prefix, so
non-default-size variants are caught. No gap here.

**H1 — residual gap (unverified, not a new finding):** The advisory lock is
non-blocking (`GET_LOCK(?, 0)`), so if two processes race and the second loses
the lock, it skips the job. This is the DESIRED behaviour (second worker yields
to the first), confirmed as intentional by prior cycle analysis.

**H3 — gap in service-worker revalidation boundary:** the SW's HEAD probe uses
the serve-upload path (which carries the full ETag), but static Next.js serving
(the dominant traffic path) uses only mtime+size. This asymmetry is documented
and deliberate. No new gap found.

### Rebuttal Round

Best challenge to H1: the `finally` block releases the advisory lock, but if
the lock `GET_LOCK` call itself throws (MySQL connection drop), the lock may
never have been acquired, and the `finally` still attempts release — harmless.
More concretely: could a SIGKILL (not graceful shutdown) leave the connection
open long enough to hold the lock? MySQL releases advisory locks on connection
close. Docker SIGKILL drops the TCP connection, so MySQL reclaims the lock. The
concern is real but the consequence is bounded: a restarted container clears
`processedIds` in-memory state and the bootstrap cursor picks up unprocessed
rows. H1 survives.

### Convergence / Separation Notes

H1 and H3 are independent mechanisms. H1 concerns the processing race fence;
H3 concerns ETag correctness for admin-setting changes. Both verified against
primary artifacts.

### Current Best Explanation

Flow 1 is **CLEAN**. The delete-during-processing race fence is correctly
implemented at all three artifact levels: advisory lock, conditional UPDATE
affectedRows check, and full-directory orphan cleanup via `sizes = []` opendir
scan. The ETag two-tier architecture matches the documented CRT-D1 design
limitation — a deliberate operational constraint, not a defect.

### Critical Unknown

Whether the 5-second settings-hash module cache can serve a stale hash if an
admin changes a setting and a derivative is requested within the 5-second TTL
window. The stale-while-revalidate wiring means the in-flight response serves
the old hash, and the next request triggers a fresh DB read. This is a
theoretical 5-second window where a color-setting change does not invalidate
the serve-upload ETag. The STATIC path has no such window (it never uses the
hash). Neither path is a regression vs. the documented design.

### Discriminating Probe

To probe the 5-second stale-hash window: change a `COLOR_IMPACTING_KEY` in
admin settings, immediately fetch a derivative via the non-locale
`/uploads/[...path]` route handler, and inspect the `ETag` response header to
see whether it reflects the old or new hash. Expected: old hash within 5 s,
new hash after TTL expires.

### Uncertainty Notes

Flow 1 is clean with high confidence. No defect, no Polish candidate.

---

## Flow 2: Admin color-setting change → settings-hash → serve-upload ETag vs static-path mtime ETag

### Observation

When an admin changes any `COLOR_IMPACTING_KEY` (e.g. `force_srgb_derivatives`,
`image_quality_avif`), the documented expectation is:
- serve-upload path ETag immediately (within 5 s TTL) reflects the new
  settings-hash component;
- static Next.js filesystem path (`public/uploads/`) does NOT reflect the change
  until derivatives are physically re-encoded.

Tracing target: does the settings-hash in `settings-hash.ts` cover all 9
documented keys? Does the compile-time guard catch regressions?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Settings-hash is correct: all 9 keys present, guard functional | High | Strong (source artifact) | Confirmed by direct read |
| 2 | A key is missing from COLOR_IMPACTING_KEYS, creating silent non-invalidation | Low | Eliminated by read | Every schema key cross-checked |
| 3 | `buildHashFromConfig` hashes resolved config, not raw strings, so a DB type coercion bypasses the hash | Low | Weak (theoretical) | No evidence of mismatch found |

### Evidence For

**H1 — 9 keys confirmed**

`apps/web/src/lib/settings-hash.ts` (from prior read):
```
const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'wide_gamut_max_source_pixels',
    'image_quality_webp',
    'image_quality_avif',
    'image_quality_jpeg',
    'image_sizes',
] as const;
```
Count: 9. Matches CLAUDE.md documentation.

Compile-time guard `_ColorKeysAreSettingKeys` assigns `COLOR_IMPACTING_KEYS`
to a type that requires each element to be a key of `AdminSettings`. A typo or
removed key produces a TypeScript error at `tsc`.

`buildHashFromConfig(config)` hashes the GalleryConfig-resolved values (not
raw DB strings), so the hash reflects the post-validation, post-default
normalised state. This is correct: the encoder reads the same GalleryConfig.

**H3 status — no mismatch found:** GalleryConfig resolution normalises string
enums and numerics from the DB before they reach the hash. No coercion
discrepancy was identified.

### Evidence Against / Gaps

**H2 — eliminated:** all 9 documented keys are in `COLOR_IMPACTING_KEYS`.

**CRT-D1 gotcha confirmed (not a defect — documented):** Admin changes to
`COLOR_IMPACTING_KEYS` change the serve-upload ETag immediately but leave
on-disk static bytes unchanged. Static serving (Next.js filesystem) uses
mtime+size only. An admin who changes a color setting and expects new bytes
served to clients must run a backfill re-encode.

### Rebuttal Round

Best challenge to H1: the `image_sizes` key is listed as a `COLOR_IMPACTING_KEY`
but it controls the derivative size ladder, not colour properties. Is it
appropriate for it to be in the colour-impacting hash? Answer: yes — changing
`image_sizes` changes which derivative filenames exist on disk, so the ETag on
any given filename must encode this setting to correctly signal that a backfill
is needed. This was documented in CLAUDE.md AGG-R7-08.

### Convergence / Separation Notes

H1 and H3 reduce to the same conclusion: settings-hash is correct. CRT-D1 is
a deliberate architectural limitation, not a convergence of hypotheses.

### Current Best Explanation

Flow 2 is **CLEAN**. All 9 `COLOR_IMPACTING_KEYS` are present, the
compile-time guard works, and `buildHashFromConfig` hashes resolved values.
The two-tier ETag behaviour is a documented design limitation (CRT-D1).

### Critical Unknown

No critical unknown remains. The compile-time guard cannot detect a forgotten
NEW key (a valid setting key is still a valid key), but this is a process risk,
not a current code defect.

### Discriminating Probe

To confirm: add a new byte-impacting key to admin settings, forget to add it to
`COLOR_IMPACTING_KEYS`, and verify that `tsc` does NOT catch it (confirming the
guard's documented limitation). This is an education probe for future authors,
not a defect probe.

### Uncertainty Notes

Flow 2 is clean with high confidence.

---

## Flow 3a: DB restore quiesce → pause/clear/onIdle → resume

### Observation

The DB restore path must quiesce the image-processing queue before touching the
DB (to avoid half-processed jobs reading corrupt rows), then resume it after
restore completes. A prior fix (COR-R4C12-01) corrected a deadlock caused by
calling `onIdle()` before `clear()`, leaving queued items that never drain.

Tracing target: is the quiesce/resume ordering correct? Does the restore flow
correctly acquire and release all three locks (DB restore advisory, upload
contract advisory, maintenance flag)? Is the `uploadContractLock` double-release
guarded?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Quiesce/resume is correct; lock ordering and release are clean | High | Strong (source artifact) | Confirmed by direct read |
| 2 | Double-release of uploadContractLock is possible on certain early-return paths | Low | Eliminated by code read | C3-AGG-01 guard present |
| 3 | beginRestoreMaintenance() is not idempotent, allowing two restores to proceed concurrently | Low | Eliminated by code read | Returns false on second call |

### Evidence For

**H1 — quiesce ordering**

`apps/web/src/lib/image-queue.ts` `quiesceImageProcessingQueueForRestore`
(lines 757-773 from prior read):
```
queue.pause();
queue.clear();
await queue.onIdle();
state.enqueued.clear();
state.retryCounts.clear();
... all state cleared ...
state.bootstrapped = false;
state.bootstrapContinuationScheduled = false;
state.bootstrapCursorId = null;
```
Order is `pause() → clear() → onIdle()`. This matches the COR-R4C12-01 fix.
`clear()` before `onIdle()` ensures in-flight concurrency slots drain but
queued (not-yet-started) tasks do not block `onIdle()`.

**H1 — lock acquisition order**

`apps/web/src/app/[locale]/admin/db-actions.ts` (lines 283-335 from direct read):
1. `GET_LOCK(?, 0)` for `gallerykit_db_restore` on dedicated connection
2. `acquireUploadProcessingContractLock(0)` (non-blocking)
3. `beginRestoreMaintenance()` (process-local flag)
4. `quiesceImageProcessingQueueForRestore()`
5. `runRestore()`
6. `finally: endRestoreMaintenance(); resumeImageProcessingQueueAfterRestore()`
7. Outer `finally: conn.release(); RELEASE_LOCK; uploadContractLock.release()`

**H1 — double-release guard (C3-AGG-01)**

On the `!beginRestoreMaintenance()` early-return path (line ~311), the code:
1. Releases the DB restore advisory lock via explicit `RELEASE_LOCK`
2. Releases `uploadContractLock` and sets it to `null`
Then returns. The outer `finally` checks `if (uploadContractLock)` before
calling `.release()`, so the null'd lock is not double-released.

**H3 — idempotency**

`apps/web/src/lib/restore-maintenance.ts` `beginRestoreMaintenance()` returns
`false` if the flag is already set (set via `Symbol.for('gallerykit.restoreMaintenance')`
on `globalThis`). Two concurrent restore calls: the second fails `beginRestoreMaintenance()`,
triggers the RELEASE_LOCK early-return, and surfaces `restoreInProgress` to the
caller. Only one restore proceeds.

### Evidence Against / Gaps

**H2 — eliminated:** `uploadContractLock` is set to `null` before the inner
try block is entered on the maintenance-begin early-return path. The outer
`finally` guards with `if (uploadContractLock)`.

**H3 — eliminated:** `beginRestoreMaintenance()` is idempotent.

**Residual gap (new peer-reported finding, see H4 below):**

### H4: sql-restore-scan APP_BACKUP_TABLES allowlist is incomplete

The `containsDangerousSql` scanner in `apps/web/src/lib/sql-restore-scan.ts`
is called during the restore flow to detect dangerous SQL patterns. It uses
`ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` to permit `DROP TABLE IF EXISTS`
statements only for tables in `APP_BACKUP_TABLES`.

**APP_BACKUP_TABLES (lines 2-15):**
```
['admin_settings', 'admin_users', 'audit_log', 'image_tags', 'images',
 'rate_limit_buckets', 'sessions', 'shared_group_images', 'shared_groups',
 'tags', 'topic_aliases', 'topics']
```
12 tables total.

**Schema tables (from `apps/web/src/db/schema.ts` direct read):**
```
admin_settings, admin_tokens, admin_users, audit_log, image_embeddings,
image_tags, image_views, images, rate_limit_buckets, sessions,
shared_group_images, shared_group_views, shared_groups, smart_collections,
tags, topic_aliases, topic_views, topics
```
18 tables total.

**Missing from allowlist:** `admin_tokens`, `image_views`, `topic_views`,
`shared_group_views`, `image_embeddings`, `smart_collections` — exactly 6
tables.

Migration evidence:
- `admin_tokens`: migration `0006_admin_tokens.sql`
- `image_views` / `topic_views` / `shared_group_views`: migration `0010_analytics_views.sql`
- `image_embeddings`: migration `0012_image_embeddings.sql`
- `smart_collections`: migration `0009_smart_collections.sql`

All 6 were added after the initial `sql-restore-scan.ts` was written (which
predates migration 0006).

**Impact:** A standard `mysqldump` of the current-schema database includes
`DROP TABLE IF EXISTS \`admin_tokens\`;` (and similarly for the other 5 tables)
before each table's CREATE+INSERT block. When this dump is fed to the restore
scanner, `containsDangerousSql()` returns `true` because `DROP TABLE IF EXISTS
\`admin_tokens\`` does not match `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` (which
only allows the 12 original tables). The restore is therefore **erroneously
blocked** for the operator's own current-schema backup. The scanner declares the
backup "dangerous" and returns `{ success: false, error: 'restoreFailed' }`.

**This is a DEFECT.**

The test coverage gap: `apps/web/src/__tests__/sql-restore-scan.test.ts` only
tests `DROP TABLE IF EXISTS \`topics\`;` and `DROP TABLE IF EXISTS \`images\`;`
as the allowed cases (lines 31, 34, 43). None of the 6 missing tables appear
in the test.

### Rebuttal Round (H4)

Best challenge: is `mysqldump --one-database` guaranteed to emit
`DROP TABLE IF EXISTS` for every table? Answer: yes — `mysqldump` emits
`DROP TABLE IF EXISTS \`tablename\`` followed by `CREATE TABLE \`tablename\``
for every table in the dump by default. Unless `--skip-add-drop-table` is
passed (which the restore UI does not do), every current-schema backup of this
app's DB will hit this block for all 6 missing tables.

Second challenge: could an admin work around this by restoring only older
backups? Backups taken before migration 0006 would not contain `admin_tokens`
etc., but the current live DB has all 18 tables. Attempting to restore a
current-version backup is the expected use case.

H4 survives the rebuttal. The defect is real and reproducible.

### Convergence / Separation Notes

The quiesce/resume flow (H1) is clean. The allowlist defect (H4) is in the
scanner that gates whether the restore is allowed to proceed at all — a
pre-restore validation step, not a quiesce/resume ordering issue. These are
distinct.

### Current Best Explanation

Flow 3a quiesce/resume: **CLEAN**. Lock ordering, `pause → clear → onIdle`,
double-release guard, and maintenance flag idempotency are all correct.

Flow 3a scanner: **DEFECT** (H4). `APP_BACKUP_TABLES` is missing 6 tables
added since the scanner was written, causing the restore flow to erroneously
reject a valid current-schema `mysqldump` backup.

**File:** `/apps/web/src/lib/sql-restore-scan.ts` lines 2-15

**Failure scenario:** Admin takes a fresh `mysqldump` backup of the live DB
(which contains all 18 tables), then attempts to restore it via the admin UI.
The scanner sees `DROP TABLE IF EXISTS \`admin_tokens\`` (and 5 more) as
unrecognised `DROP TABLE` statements, returns `containsDangerousSql = true`,
and the restore returns `{ success: false, error: 'restoreFailed' }`. The
restore never runs. The operator cannot restore from their most recent backup.

**Fix:** Add the 6 missing tables to `APP_BACKUP_TABLES`:
```ts
const APP_BACKUP_TABLES = [
    'admin_settings',
    'admin_tokens',       // added migration 0006
    'admin_users',
    'audit_log',
    'image_embeddings',   // added migration 0012
    'image_tags',
    'image_views',        // added migration 0010
    'images',
    'rate_limit_buckets',
    'sessions',
    'shared_group_images',
    'shared_group_views', // added migration 0010
    'shared_groups',
    'smart_collections',  // added migration 0009
    'tags',
    'topic_aliases',
    'topic_views',        // added migration 0010
    'topics',
] as const;
```
Additionally, extend `sql-restore-scan.test.ts` to assert that each known
schema table's `DROP TABLE IF EXISTS` is allowed (a schema-sync test analogous
to the `privacy-fields.test.ts` approach would catch future drift).

### Critical Unknown

Whether the existing `sql-restore-scan.test.ts` would have caught this if the
test covered all 18 tables — yes, it would. The test checks
`containsDangerousSql('DROP TABLE IF EXISTS \`images\`;') === false`, and the
same pattern for `admin_tokens` would reveal the defect immediately.

### Discriminating Probe

Run:
```ts
containsDangerousSql('DROP TABLE IF EXISTS `admin_tokens`;')
```
Expected (if allowlist is correct): `false`.
Actual (current code): `true` — confirming the defect.

### Uncertainty Notes

H4 is confirmed with high confidence from two independent artifact classes:
(1) the allowlist literal vs. the schema source, and (2) the migration files
confirming when each missing table was introduced. The test coverage gap
independently corroborates that the defect has been latent without detection.

---

## Flow 3b: Semantic search request → embedding decode → scored pipeline → null-skip → response

### Observation

Semantic search (`/api/search/semantic/route.ts`) must:
1. Select the correct similarity function based on whether vectors are L2-normalised
   (production: `dotProduct`) or not (stub: `cosineSimilarity`).
2. Null-skip rows where `decodeEmbeddingColumn` returns `null` (malformed bytes).
3. Isolate model versions so stub embeddings don't pollute production scoring.

Tracing target: is the similarity function gate correct? Is the null-skip
path present? Can production and stub embeddings cross-contaminate?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Similarity function gate is correct; null-skip is present; model version isolation holds | High | Strong (source artifact) | All three confirmed |
| 2 | Stub embeddings bleed into production scoring because model version is not filtered | Low | Eliminated by read | WHERE clause on modelVersion confirmed |
| 3 | dotProduct used on non-normalized stub vectors, corrupting ranking | Low | Eliminated by read | isProd gate confirmed at line 271 |

### Evidence For

**H1 — similarity function gate**

`apps/web/src/app/api/search/semantic/route.ts` lines 267-271 (from prior read):
```ts
// vector AND the query are L2-normalized (truncateAndNormalize), so dotProduct
// ... stub MUST keep cosineSimilarity or ranking would be corrupted. Gate on isProd.
const similarity = isProd ? dotProduct : cosineSimilarity;
```
`isProd` is derived from `semanticMode === 'production'`, which requires both
the DB setting AND the `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` env var.

**H1 — null-skip**

`apps/web/src/app/api/search/semantic/route.ts` lines 274-278:
```ts
const vec = decodeEmbeddingColumn(row.embedding);
if (vec === null) continue; // skip malformed rows
```
`decodeEmbeddingColumn` returns `null` for Buffers not exactly 2048 bytes,
non-base64 strings, and legacy base64 data that does not decode to 2048 bytes.

**H1 — model version isolation**

DB scan: `WHERE modelVersion = activeModelVersion ORDER BY updatedAt DESC LIMIT 5000`
where `activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION`.
Stub rows have `model_version = 'stub-sha256-v1'`; production rows have
`model_version = 'jina-clip-v2-d512-q8'`. The WHERE clause ensures stub
rows are never scored in production mode and vice versa.

**H2 / H3 — eliminated**

Stub embeddings are generated by `deterministicEmbedding` in
`apps/web/src/lib/clip-inference.ts` and are NOT L2-normalised (confirmed by
grep: no call to `truncateAndNormalize` or `normalizeEmbedding` in
`clip-inference.ts`). The gate at line 271 uses `cosineSimilarity` for stub,
which handles non-normalised vectors correctly. Production embeddings go through
`truncateAndNormalize` in `clip-model.ts`, so `dotProduct` is safe for
production. The gate is correct.

### Evidence Against / Gaps

No disconfirming evidence found. The rate-limit pre-increment is called before
the config/mode read, and rollback paths are present for disabled/error/query-
failure branches.

### Rebuttal Round

Best challenge: could a production embedding be stored as a stub-model-version
row (or vice versa) by a race during mode transition? Answer: the embedding
write is fire-and-forget AFTER `processed = true` is set, and it uses the
resolved `semanticMode` at write time. A mode change mid-flight would write the
new mode's model version, so a transitioning DB could have mixed rows, but the
WHERE clause on `modelVersion` ensures only rows matching the current mode are
scored. The concern is real during a mode transition but self-correcting: after
the transition the wrong-mode rows are filtered out.

H1 survives.

### Convergence / Separation Notes

H2 and H3 both reduce to the model version WHERE clause and the `isProd` gate —
independent guards that reinforce each other.

### Current Best Explanation

Flow 3b is **CLEAN**. The similarity function gate, null-skip, and model version
isolation are all correctly implemented.

### Critical Unknown

Whether the 5000-row scan limit in the DB query could cause the highest-
similarity results to be missed if more than 5000 rows exist for a model
version. At 445 production embeddings (documented in CLAUDE.md) this is not
currently a concern, but the limit is a hard cap rather than a pagination.

### Discriminating Probe

To probe the 5000-row limit: run `SELECT COUNT(*) FROM image_embeddings WHERE
model_version = 'jina-clip-v2-d512-q8'` on the production DB and compare
to 5000. If count approaches 5000, the limit should be raised or the scan
should switch to an approximate-nearest-neighbour index.

### Uncertainty Notes

Flow 3b is clean with high confidence. No defect, no Polish candidate.

---

## Summary

| Flow | Verdict | Confidence | File:line |
|------|---------|------------|-----------|
| 1: Upload → processing → ETag | CLEAN | High | — |
| 2: Settings-hash → ETag two-tier | CLEAN | High | — |
| 3a: Restore quiesce/resume | CLEAN | High | — |
| 3a: Restore scanner allowlist | **DEFECT** | High | `apps/web/src/lib/sql-restore-scan.ts:2-15` |
| 3b: Semantic search pipeline | CLEAN | High | — |

### DEFECT: sql-restore-scan allowlist stale (SEVERITY: HIGH)

**Classification:** DEFECT (functional breakage — admin cannot restore from current-schema backup)

**File:** `apps/web/src/lib/sql-restore-scan.ts` lines 2-15

**Root cause:** `APP_BACKUP_TABLES` was not updated when 6 tables were added
to the schema via migrations 0006, 0009, 0010, 0012. The scanner rejects
`DROP TABLE IF EXISTS` for any table not in the allowlist, so a standard
`mysqldump` of the current-schema DB is erroneously blocked.

**Missing tables:** `admin_tokens`, `image_views`, `topic_views`,
`shared_group_views`, `image_embeddings`, `smart_collections`.

**Fix:** Add all 6 missing table names to `APP_BACKUP_TABLES`. Add a
schema-sync test that asserts every Drizzle schema table is present in
the allowlist (prevents future drift).

**Corroboration:** Independently reported by debugger agent this cycle.
Evidence tier: Tier 1 (source artifact + migration file provenance).

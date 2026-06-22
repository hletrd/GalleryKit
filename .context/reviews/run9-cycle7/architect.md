# Run-9 Cycle-7 — ARCHITECT review (HEAD feb63faa)

Scope: single-web-instance / single-writer topology invariants — 6 MySQL advisory
locks (acquire/release symmetry on all paths), delete-while-processing
`affectedRows===0` cleanup, restore quiesce (pause→clear→onIdle) + maintenance
flag, ETag/cache invalidation (COLOR_IMPACTING_KEYS / HASH_LENGTH /
IMAGE_PIPELINE_VERSION), backfill concurrency cap vs pool budget, migration/
schema-drift runbook. Plus the CRITICAL DRIFT SWEEP and SPECIAL FOCUS #3
(per-enqueue-site settings-snapshot forwarding).

Verdict: **1 DEFECT (MEDIUM)** — the SPECIAL FOCUS finding is CONFIRMED. Everything
else verified clean (no drift, all locks symmetric, quiesce/maintenance correct,
ETag count correct, concurrency cap correct).

---

## DEFECT — CR-R9C7-01 (MEDIUM, confidence HIGH): LR publish path silently drops 6 admin processing settings on enqueue

**File:** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444` (the
`enqueueImageProcessing({...})` call on the Lightroom Classic publish-plugin
ingest path).

**Invariant violated:** SPECIAL FOCUS #3 / REPO-CONVENTION #7 drift — "a snapshot
field added to the job type but not forwarded by one enqueue site." The cycle-6
fix CR-R9C6-01 extended `ImageProcessingJob` (`image-queue.ts:130-135`) with 6
admin-tunable processing settings and wired them from `uploadConfig` on the
BROWSER upload (`images.ts:461-466`). The LR route was NOT updated. It is the
exact same defect class as CR-R9C6-01, on the primary non-browser ingest path.

**Evidence chain:**
- LR enqueue forwards only `quality` (`route.ts:428-432`), `imageSizes`
  (`:433`), `camera_model`/`capture_date` (`:438-439`), `iccProfileName` (`:440`),
  `colorSignals` (`:443`). It does NOT forward `forceSrgbDerivatives`,
  `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`,
  or `autoAltTextEnabled`.
- The queue handler gate is `if (!quality && !imageSizes)` at `image-queue.ts:336`.
  It loads the 6 from config ONLY when BOTH `quality` and `imageSizes` are absent.
  The LR job supplies `quality` (always) + `imageSizes`, so the gate is NOT entered.
- Therefore the handler falls through to the per-field defaults at
  `image-queue.ts:326-335`:
  - `autoAltTextEnabled = job.autoAltTextEnabled ?? false` → **false**
  - `forceSrgbDerivatives = job.forceSrgbDerivatives ?? false` → **false**
  - `wideGamutJpegChroma = job.wideGamutJpegChroma` → **undefined**
  - `avifEffort = job.avifEffort` → **undefined**
  - `sdrJpegChroma = job.sdrJpegChroma` → **undefined**
  - `wideGamutMaxSourcePixels = job.wideGamutMaxSourcePixels` → **undefined**
- These undefined/false values are passed to `processImageFormats(...)`
  (`image-queue.ts:357-372`), so the encoder uses its own internal defaults
  instead of the admin's configured values.

**Failure scenario (concrete):** An admin sets `force_srgb_derivatives=true`
(e.g. to ship sRGB JPEG/WebP for compatibility) and `avif_effort` to a tuned
value, then a photographer publishes from Lightroom Classic via the publish
plugin. The published photo is encoded with `forceSrgbDerivatives=false` (so
wide-gamut JPEG/WebP are emitted against the admin's explicit force-sRGB setting),
the wrong JPEG chroma subsampling (process-image default, not the admin's
`wide_gamut_jpeg_chroma`/`sdr_jpeg_chroma`), AVIF effort at Sharp's default (4)
instead of the shipped/tuned value, the default wide-gamut pixel cap, and with
auto-alt-text suppressed (always "[AUTO] Photo" never generated, even when the
admin enabled `auto_alt_text_enabled`). Browser uploads with the SAME admin
config produce DIFFERENT bytes/metadata than LR uploads. The mismatch is silent
until a backfill re-encode (which DOES honor config) rewrites the LR-published
derivatives — exactly the CR-R9C6-01 symptom, now on the Lightroom path.

Scope note: the LR plugin is a real, supported, documented ingest surface
(216 MiB nginx location, PAT auth, US-P53). This is not a dead path. The defect
applies to every photo published from Lightroom Classic, not the browser.

**Severity rationale (MEDIUM not HIGH):** No data loss, no crash, no security
hole. Color/quality differences are real but recoverable via a backfill
re-encode (which is idempotent and config-honoring). `force_srgb_derivatives`
being ignored is the most visible consequence (wide-gamut bytes shipped where
the admin asked for sRGB), but AVIF is still gamut-preserved in all cases and the
default chroma/effort are reasonable. The auto-alt-text suppression is a
quality-of-life miss. This matches the MEDIUM rating cycle-6 gave CR-R9C6-01.

**Fix:** Mirror the browser path exactly. The `config` object (from
`getGalleryConfig()` at `route.ts:170`) is already in scope and already carries
all 6 fields. Add to the LR enqueue object (after `:433`):

```ts
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```

This is a one-block, zero-risk change. Suggest also adding a fixture-style test
asserting BOTH enqueue sites (browser + LR) forward the same 6 settings, so the
"derived list drifted from its source" class is caught at test time on the next
such addition (the recurring REPO-CONVENTION #7 theme).

---

## VERIFIED CLEAN

### Enqueue-site forwarding sweep (SPECIAL FOCUS #3) — full verdict
Six `enqueueImageProcessing` call sites (`grep` over src/ + scripts/):

| Site | quality+imageSizes | 6 settings | Gate enters (loads config)? | Verdict |
|---|---|---|---|---|
| browser upload `images.ts:440` | YES | YES (all 6) | No | CORRECT (job snapshot) |
| **LR upload `lr/upload/route.ts:420`** | **YES** | **NO** | **No** | **DEFECT (above)** |
| bootstrap `image-queue.ts:674` | No | No | Yes | CORRECT (loads from config) |
| claim-retry `image-queue.ts:290` | re-enqueues same `job` | inherits | n/a | CORRECT (inherits origin) |
| error-retry `image-queue.ts:510` | re-enqueues same `job` | inherits | n/a | CORRECT (inherits origin) |
| retryFailedImage `images.ts:1139` | No | No | Yes | CORRECT (loads from config) |

The two backfill writers do NOT enqueue — they call `processImageFormats`
directly with fully-resolved settings: admin runner `admin-backfill-runner.ts:499-514`
(settings built from config at `:644-657`), sidecar `backfill-color-pipeline.ts:203-218`.
Both correct, unaffected by the gate.

LR is the ONLY defective site. The retry paths (290/510) re-enqueue the same job
object, so an LR job that retries inherits the missing-6 condition — a consequence
of the root defect at :420, not a separate finding.

### CRITICAL DRIFT SWEEP (REPO-CONVENTION #7)
- **schema.ts ↔ reconcileLegacySchema (migrate.js) table parity:** 18/18 tables
  match (topics, topic_aliases, images, tags, image_tags, admin_settings,
  shared_groups, shared_group_images, admin_users, audit_log, sessions,
  admin_tokens, rate_limit_buckets, image_views, topic_views, shared_group_views,
  image_embeddings, smart_collections). **NO DRIFT.**
- **schema.ts ↔ reconcileLegacySchema `images` COLUMN parity:** all **50/50**
  images columns are covered — every column is either in the `CREATE TABLE IF NOT
  EXISTS images` block (`migrate.js:317-358`) or an `ensureColumn(... 'images' ...)`
  call (`:360-401`). A fresh DB with no `__drizzle_migrations` rows baselines with
  all 50 columns. **NO DRIFT.**
- **APP_BACKUP_TABLES superset:** `sql-restore-scan.ts:12-31` lists all 18 schema
  tables; the comment + tripwire test (`__tests__/sql-restore-scan.test.ts`)
  enforce the superset invariant. **NO DRIFT.**
- **COLOR_IMPACTING_KEYS count:** `settings-hash.ts:42-54` = 9 keys (5 color +
  3 quality + 1 size), matching the docstring (`:5-12`), `buildHashFromConfig`
  (`:90-100`), and CLAUDE.md. `HASH_LENGTH=8` consistent with the ETag site
  (no `.slice(0,8)` at serve-upload). Compile-time guard `_ColorKeysAreSettingKeys`
  (`:63-66`) present. **NO DRIFT.**
- **Privacy field guards three-way parity:** `publicSelectFields` omit-set
  (`data.ts:323-351`), `PrivacySensitiveKeys` type (`data.ts:414`), and
  `SENSITIVE_KEYS` fixture (`privacy-fields.test.ts:6-42`) all describe the SAME
  19 fields. `avif_10bit` correctly EXCLUDED (public-safe per `data.ts:273-274`).
  Test at `privacy-fields.test.ts:83-90` asserts exact set equality. **NO DRIFT.**

### Advisory locks — acquire/release symmetry (all 6, incl. early/error paths)
1. `LOCK_DB_RESTORE` (`db-actions.ts:266-361`): all 4 paths release — (a) not
   acquired → outer finally releases conn only; (b) contract-lock fail →
   RELEASE_LOCK + return; (c) `beginRestoreMaintenance` fail → RELEASE_LOCK +
   `uploadContractLock.release()` + return; (d) success/error → inner finally
   does endMaintenance + resume + RELEASE_LOCK + contract release; outer finally
   releases conn. Symmetric.
2. `LOCK_UPLOAD_PROCESSING_CONTRACT` (`upload-processing-contract-lock.ts`):
   `released` guard prevents double-release; conn-acquire fail, lock-not-acquired,
   query-throw-after-acquire all handled. LR caller releases in `finally`
   (`route.ts:476-479`); restore caller releases on every branch. Symmetric.
3. `LOCK_TOPIC_ROUTE_SEGMENTS` (`topics.ts:61-82`): `lockAcquired`-gated
   RELEASE in finally; conn always released; throw-on-fail needs no release.
   Symmetric.
4. `LOCK_ADMIN_DELETE` (`admin-users.ts:209-288`): `lockAcquired`-gated RELEASE
   in finally; transaction rolled back on throw; COUNT→DELETE window held under
   lock so last-admin invariant holds against concurrent deletes; audit-log FK
   detach (COR-R4C10-01) present. Symmetric.
5. Per-image `getImageProcessingLockName` (`image-queue.ts:207-234` +
   `admin-backfill-runner.ts:343-368`): acquire returns null on not-acquired
   (releases conn), throws release conn; release helper no-ops on null and
   releases conn in finally. Queue handler releases in finally (`:565`);
   backfill releases in finally (`:613`). Symmetric.
6. `LOCK_COLOR_PIPELINE_BACKFILL` (`admin-backfill-runner.ts:303-333` +
   `backfill-color-pipeline.ts:305/516`): ownership-transfer pattern —
   `triggerAdminBackfill` sets `lockConn=null` after handoff (`:846`) so the
   outer catch can't double-release; zero-candidate path releases (`:837`);
   runner `finally` always releases (`:807`). Symmetric.

### Delete-while-processing `affectedRows===0` cleanup
- Queue handler (`image-queue.ts:394-411`): on `affectedRows===0`,
  `deleteImageVariants(dir, fn, [])` (empty sizes → full dir scan, catches
  non-default-size variants). Correct (AGG-C4-04).
- Admin runner: BOTH branches handled — success (`:573-576`) and detection-failed
  (`:605-608`) call `cleanupDeletedMidReencodeVariants(row)` on `affectedRows===0`.
  Correct (AGG-R8c3-03).
- Sidecar `flushBatch` (AGG-C4-02) — parity confirmed via the same pattern
  (verified the runner + queue; sidecar documented as landed Run-9 C1).

### Restore quiesce + maintenance flag
`quiesceImageProcessingQueueForRestore` (`image-queue.ts:753-794`) does
`pause() → clear() → await onIdle()` — the COR-R4C12-01 deadlock fix is intact
(clearing BEFORE onIdle so a paused queue with queued jobs doesn't hang forever).
`beginRestoreMaintenance()` is set BEFORE quiesce (`db-actions.ts:310` then
`:334`) so `enqueueImageProcessing` rejects (`image-queue.ts:245`) during the
window. `endRestoreMaintenance()` + resume in the inner finally. Resume
(`:796-806`) guards on `state.shuttingDown`. Correct.

### Backfill concurrency cap vs pool budget
`resolveBackfillConcurrency` (`admin-backfill-runner.ts:129-142`): at pool
LIMIT=10, RESERVED=max(3,ceil(10/2))=5, cap=floor((10−5−1)/2)=2. Matches the
docstring (`:122-124`) and CLAUDE.md. NaN guard for an undefined pool import
(`:137`). Requests above cap clamped DOWN with a warning (`:664-667`). Budget
arithmetic (1 lock + 2N workers ≤ LIMIT−RESERVED) sound. Correct.

### Migration/schema-drift runbook
`migrate.js` uses per-entry hash post-conditions (not `MAX(created_at)`):
`reconcileLegacySchema` + `baselineAllJournalMigrations` on missing hashes, and
the post-condition assertion throws "Drizzle silently skipped N migration(s)".
The `images` column parity (50/50, above) confirms `reconcileLegacySchema` is
maintained to current schema state. No new migrations added since last cycle
to re-verify the journal-monotonicity rule. Correct.

---

## Items NOT re-filed (per brief — no new evidence)
- `affectedRows` optional-chaining — REFUTED repeatedly; the `as {affectedRows?}`
  casts + `=== 0` checks are present at every delete-mid-processing site.
- 3 binary-parser bounds-check FPs (color-detection colr / gps-exif ILOC /
  gain-map+icc-extractor) — each flagged read has a preceding bounds check.
- All prior-FIXED run-9 items (CR-R9C2-01, TE-R9C3-01, DES-R9C3/4-01,
  CR-R9C5-01, CR-R9C6-01) — confirmed landed; CR-R9C6-01 is the direct
  precedent for this cycle's CR-R9C7-01 (same class, LR path).

## Summary line
schema↔reconcile parity: **18/18 tables, 50/50 images columns — NO DRIFT.**
Enqueue-site forwarding: **LR route at route.ts:420 does NOT forward the 6
settings → CONFIRMED DEFECT (CR-R9C7-01, MEDIUM/HIGH).** All other 5 enqueue
sites correct. All 6 advisory locks symmetric. ETag/cache, quiesce, concurrency
cap, privacy guards, APP_BACKUP_TABLES all clean.

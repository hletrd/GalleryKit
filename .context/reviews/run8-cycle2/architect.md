# Architect Review — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Agent:** architect (READ-ONLY)
**Scope:** whole-repo architecture — module boundaries & coupling, color/HDR pipeline, migration/reconcile architecture, single-writer runtime topology invariants, ETag/settings-hash invalidation, data-access layer privacy derivation, doc-code drift, and paid-download-removal architectural residue.

## NEW FINDINGS: 0

No new actionable architecture-level finding. Every named invariant is intact at HEAD `f63af3b9`. The cycle-1 cleanup (commits `47b1e21f`..`f63af3b9`, FIND-R8C1-01..05) landed correctly and introduced no architectural inconsistency. The codebase remains CONVERGED.

---

## Coverage justification (what was verified, with evidence)

### 1. ETag / settings-hash invalidation — `COLOR_IMPACTING_KEYS = 9` invariant HOLDS
- `apps/web/src/lib/settings-hash.ts:42-54` — `COLOR_IMPACTING_KEYS` has exactly 9 entries: 5 color (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) + 3 quality (`image_quality_webp/avif/jpeg`) + 1 size (`image_sizes`). Matches the CLAUDE.md "9" claim and the docstring at `settings-hash.ts:5-12`.
- `settings-hash.ts:63-66` — the `_ColorKeysAreSettingKeys` compile-time guard (`(typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey`) holds; `npm run typecheck` PASS proves no key drifted out of `GALLERY_SETTING_KEYS`.
- `settings-hash.ts:89-102` — `buildHashFromConfig` enumerates the SAME 9 keys as `COLOR_IMPACTING_KEYS`. **Cross-checked field-by-field:** the config-arg path and the DB path cannot diverge on key set. This is the subtle drift risk (two parallel key lists) and it is currently symmetric.
- All 9 keys are present in `GALLERY_SETTING_KEYS` (`gallery-config-shared.ts:25-66`) with matching `DEFAULTS` (`:91-125`) and `VALIDATORS` (`:146-193`). No `licensePrices`/`license_tier` key survives in any of the three records.
- **Invariant at risk:** an author adding a new byte-impacting setting forgets to add it to `COLOR_IMPACTING_KEYS` (the type guard cannot catch a *new* valid key — documented at `settings-hash.ts:56-62` and in the CLAUDE.md "Adding a new color-impacting setting" checklist). No new setting landed this cycle, so the gap is dormant, not triggered. No finding.

### 2. Migration / reconcile architecture — DUAL-PATH correctness for 0023 HOLDS
- **Journal `when` monotonicity for the NEW migration (the only invariant that matters for 0023):** `apps/web/drizzle/meta/_journal.json` 0023 `when = 1782000000000` is strictly greater than the prior max `1781687094232` (0022). ✓ The journal is *globally* non-monotonic by design (entry 0 = `1766198349853` Dec-2025, then `1746144000000` May-2025 mid-list) — this is the EXACT documented hazard that the hash-based post-condition (`migrate.js:714-735`) defends against, not a regression.
- **0023's drops are mirrored in `reconcileLegacySchema`:** `migrate.js:627-628` calls `dropTableIfPresent(connection,'entitlements')` + `dropColumnIfPresent(connection,dbName,'images','license_tier')` as the LAST reconcile statements (`:621-628`). The drops are correctly placed after all CREATE/ALTER so reconcile converges to the post-0023 schema. ✓
- **No contradiction (reconcile never re-creates what 0023 drops):** the `images` CREATE block + `ensureColumn` list contain NO `license_tier` (only the documented "removed in 0023" comment at `migrate.js:370`); the `entitlements` table is NOT created in reconcile (only the comment at `:596-597`). So reconcile drops `license_tier`/`entitlements` without ever having added them — idempotent, no oscillation. ✓
- **0023 `.sql` unguarded `ALTER TABLE images DROP COLUMN license_tier` is safe on a fresh DB:** `prepareLegacyDatabaseIfNeeded` (`migrate.js:675-712`) routes BOTH fresh (`!hasGalleryTables` → `:693-694`) and partial/legacy (`:710-711`) DBs through `reconcileLegacySchema` + `baselineAllJournalMigrations`, which baselines ALL journal hashes (including 0023) so `drizzle.migrate()` never executes the 0023 `.sql` body. On an incremental prod DB, migrations 0008 (adds `license_tier`) + 0013 (creates `entitlements`) baseline before 0023, so the targets exist if drizzle ever runs the file. The MySQL-8 "no `DROP COLUMN IF EXISTS`" caveat is documented in the `.sql` header and correctly handled by routing around it. ✓
- **Tripwire test landed (FIND-R8C1-05 fix):** `__tests__/migrate-reconcile-coverage.test.ts:191-205` now pins BOTH drop calls with executable-code regexes (not comment matches). A regression that silently removes either drop now fails the suite. ✓
- **Post-condition still fires loud:** `migrate.js:724-734` throws if any journal hash is missing from `__drizzle_migrations`. Unchanged, correct.

### 3. Data-access layer — `publicSelectFields` derivation + privacy guards HOLD
- `apps/web/src/lib/data.ts:208` — `adminSelectFields` is the full field set; `publicSelectFields` (`:324-353`) and `publicMapSelectFields` (`:365-...`) are derived by **destructure-omit from `adminSelectFields`** (the documented separate-reference pattern). No `licenseTier`/`license_tier`/`entitlement` field in any select set (paid-download removal cleanly dropped it from the data layer).
- `data.ts:414-417` — `_PrivacySensitiveKeys` (21-key union) + `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` + the `_privacyGuard` const force a `tsc` failure if any sensitive key leaks into `publicSelectFields`. `data.ts:427-428` — parallel `_MapSensitiveKeysInPublicMap` guard for the map variant (excludes lat/long, which the map intentionally exposes behind the `topics.map_visible` inner JOIN). Typecheck PASS proves both guards hold.
- React `cache()` deduplication wrappers unchanged (the 10 `*Cached` + `getSeoSettings` set claimed in CLAUDE.md). No new uncached hot-path query introduced by the removal.

### 4. Single-writer runtime topology invariants HOLD
- **Advisory locks (`apps/web/src/lib/advisory-locks.ts:19-44`):** the documented 6 names are present and unchanged — `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, + the per-job `gallerykit:image-processing:{jobId}`. The `:`-vs-`_` separator on the per-job name is the carried cosmetic INFO-R7C2-09 (no collision, no change).
- **Process-local state** (restore-maintenance flag, backfill-runner status, rate-limit fast-path buckets, shared-group view buffer) is unchanged by the removal — the deleted Stripe webhook/checkout routes carried no shared coordination state. The single-writer topology documented in CLAUDE.md is still accurate.
- `original/` privacy exclusion intact at BOTH layers: app `ALLOWED_UPLOAD_DIRS = {'jpeg','webp','avif'}` (`serve-upload.ts:15`, enforced `:138`) and nginx `location ^~ /uploads/original/ { return 404; }` (`nginx/default.conf:163-165`). This is the structural guarantee behind RES-R7C6-01's CLOSED status (no public route streams the on-disk original anymore — verified: the only former consumer, `api/download/[imageId]`, is deleted).

### 5. Color/HDR pipeline module boundaries HOLD
- `process-image.ts:13,21,315` — `IMAGE_PIPELINE_VERSION` is DEFINED once in `gallery-config-shared.ts:21` (= 7) and RE-EXPORTED from `process-image.ts:315`. No duplicate definition / drift. Matches CLAUDE.md.
- `process-image.ts:32-34` — `ColorPipelineDecision` type + `COLOR_PIPELINE_DECISIONS` enum re-exported from the canonical client-safe `color-pipeline-decisions.ts`. `detectColorSignals` imported from `color-detection.ts:18`. Clean layering: shared constants → detection → encoder, no circular import.
- The fresh-decode-per-format / wide-gamut downscale structure (`process-image.ts:~1019`) is unchanged; the removal touched `process-image.ts` only by a comment edit (FIND-R8C1-02, landed).

### 6. Half-removed-abstraction / doc-code drift check — NONE found
- **`@/lib/storage`** (`index.ts`/`local.ts`/`types.ts` present; only `storage-local.test.ts` imports it; app uses `upload-paths` directly) — exactly matches the CLAUDE.md "Storage Backend (Not Yet Integrated)" claim. Not a half-removal; it predates and is orthogonal to the paid-download removal.
- **Whole-tree dangling-reference scan** for `entitlement|license_tier|licenseTier|licensePrices|downloadToken|stripe|checkout|license-tier|downloadInterstitial`: 0 hits in `src/**` production code (`schema.ts` CLEAN, `data.ts` CLEAN, `gallery-config*.ts` CLEAN). The only 17 matches are in `__tests__/` and are all intentional regression-guards (`free-download-contract.test.ts`, `migrate-reconcile-coverage.test.ts`) or benign English/identifier coincidences (`"checkout under full-suite CPU"`, the generic `'checkout'` rate-limit bucket name in `rate-limit-db.test.ts:106`).
- CLAUDE.md / README / AGENTS.md on-disk are already clean (confirmed cycle-1 by 3 agents; the stale paid-download copy is ONLY in this session's injected system-reminder). No new doc claim drifted: `IMAGE_PIPELINE_VERSION=7`, `COLOR_IMPACTING_KEYS=9`, advisory-lock set, ALLOWED_UPLOAD_DIRS, privacy field sets all match code.

### Gate evidence
- `npm run typecheck --workspace=apps/web` → PASS (app `tsconfig.typecheck.json` incl. `__tests__/` + scripts, 7 JS files). This is load-bearing: it proves the `_privacyGuard`, `_colorKeysAreSettingKeys`, and `_MapSensitiveKeysInPublicMap` compile-time invariants all hold.

---

## Carried deferrals — re-verified UNCHANGED, no new evidence, no exit criterion met (do NOT re-raise)
- **OBS-R7C2-02..07** [LOW] — reconcile `position` backfill non-rerunnable; non-transactional restore; `failRestore` temp leak; pool not `.end()`'d; unbounded bootstrap retry; `updateTopic` no `FOR UPDATE`. All in `migrate.js` / `db-actions.ts` / `image-queue.ts` / `db/index.ts` / `topics.ts`. Documented-design / operator-mitigated; none triggered by the cycle-1 cleanup.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN`; `'XX'` country sentinel; timeline bounds validation. Unchanged.
- **INFO-R7C2-08** — orphan `0014_drop_reactions.sql` (destructive-action-gated deletion). **INFO-R7C2-09** — advisory-lock `:`-vs-`_` separator (cosmetic, re-confirmed at `advisory-locks.ts:41`). Both unchanged.

## Closed/moot (do NOT re-file)
- **ARCH-R7C2-01** + **TE-R7C2-02** (Stripe webhook) — route deleted, MOOT/CLOSED (cycle-1).
- **RES-R7C6-01** (HEIC GPS-strip residual) — leak vector eliminated, CLOSED (cycle-1); re-open criterion preserved: any future route streaming from `data/uploads/original/` re-opens at HIGH/CRITICAL.

---

## Verdict
The architecture is converged. The paid-download removal left ZERO architectural residue at the structural level: no orphaned abstraction, no invariant drift, no half-removed coupling. Every named invariant — `COLOR_IMPACTING_KEYS=9`, migration dual-path + 0023-drop mirroring + journal-`when` monotonicity for new entries, single-writer advisory-lock set, `publicSelectFields` derivation + compile-time privacy guards, color-pipeline module boundaries — is intact and proven by the typecheck gate. The cycle-1 cleanup commits are surgically correct. Nothing NEW to schedule.

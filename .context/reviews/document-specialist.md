# Document Specialist Review — Cycle 11

**HEAD:** a7de3ebd  
**Working tree:** CLEAN  
**Reviewer:** document-specialist  
**Scope:** Load-bearing doc-vs-code verification only. Non-load-bearing items (stale line numbers, wording drift) are noted as non-findings.

---

## FINDING: ZERO

All load-bearing claims verified against code at HEAD. No operator-facing mismatches found.

---

## Verified Claims

### 1. IMAGE_PIPELINE_VERSION = 7
- **Code:** `apps/web/src/lib/gallery-config-shared.ts:21` — `export const IMAGE_PIPELINE_VERSION = 7;`
- **CLAUDE.md claim:** correct.

### 2. COLOR_IMPACTING_KEYS — count 9, names match
- **Code:** `apps/web/src/lib/settings-hash.ts:41-53` — array contains exactly 9 keys:
  `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`,
  `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`,
  `image_quality_jpeg`, `image_sizes`
- **CLAUDE.md claim (ETag section):** "covers all **9** `COLOR_IMPACTING_KEYS`" with all 9 named — correct.
- **HASH_LENGTH:** 8 — matches `HASH_LENGTH = 8` at line 55.

### 3. Advisory lock names — 6 names
- **Code:** `apps/web/src/lib/advisory-locks.ts` exports exactly 6 names:
  `gallerykit_db_restore`, `gallerykit_upload_processing_contract`,
  `gallerykit_topic_route_segments`, `gallerykit_admin_delete`,
  `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`
- **CLAUDE.md claim:** lists the same 6 names — correct.

### 4. Login rate limits — 5 attempts / 15-min window, per-IP + per-account
- **Code:** `apps/web/src/lib/rate-limit.ts:62-63`
  - `LOGIN_WINDOW_MS = 15 * 60 * 1000` (15 minutes)
  - `LOGIN_MAX_ATTEMPTS = 5`
  - Per-account bucket: `auth-rate-limit.ts` uses same constants via import.
- **CLAUDE.md claim:** "5 attempts / 15-min window" for both IP and account buckets — correct.

### 5. Upload caps — 200 MiB/file, 2 GiB window, 100 files/window
- **Code:** `apps/web/src/lib/upload-limits.ts`
  - `MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024` (200 MiB)
  - `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024` (2 GiB)
  - `UPLOAD_MAX_FILES_PER_WINDOW` default 100 (env `UPLOAD_MAX_FILES_PER_WINDOW`)
- **CLAUDE.md claim:** correct.

### 6. nginx body-cap table — all five caps including cycle-10 LR upload fix (AGG-C10-01)
- **Code:** `apps/web/nginx/default.conf` — confirmed:
  - Default: `client_max_body_size 2M`
  - Login (`/admin`): `64K`
  - DB restore (`/admin/db`): `250M`
  - Dashboard uploads (`/admin/dashboard`): `216M`
  - **LR upload (`^~ /api/admin/lr/upload`):** `216M` — dedicated block with longest-prefix `^~` match, beats the generic `^~ /api/admin/` 2M catch-all. Block comment explicitly references AGG-C10-01.
- **CLAUDE.md claim (Important Notes section):** "**216 MiB** for the Lightroom Classic publish-plugin upload route `/api/admin/lr/upload` (a dedicated `^~ /api/admin/lr/upload` location that wins over the generic `^~ /api/admin/` 2 MiB catch-all by longest-prefix match — without it the generic 2 MiB cap 413s every real photo at the edge before the route runs; run-6 cycle-10 AGG-C10-01)" — correct. AGG-C10-01 doc half is fully landed.

### 7. Backfill column set — admin-backfill-runner.ts matches scripts/backfill-color-pipeline.ts
- **admin-backfill-runner.ts:** persists `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit` (lines 543-568 + 591-597).
- **scripts/backfill-color-pipeline.ts:** same 10 columns (lines 410-419 + 427-428).
- **CLAUDE.md claim:** "persist the SAME DB column set as a fresh upload" — both paths write the same set. Correct.

### 8. Env var names
- **Code:** `apps/web/.env.local.example` — `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `QUEUE_CONCURRENCY`, `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, `TRUST_PROXY` all present and correctly named.
- **CLAUDE.md claim:** correct.

### 9. CLIP guards
- **No `import 'server-only'` in clip-model.ts:** intentionally absent by design; comment at lines 17-26 explains the boundary-test strategy covers this (correct per architecture).
- **`allowRemoteModels = false`:** set at `clip-model.ts:88` — correct.
- **Revision pin:** `revision: JINA_CLIP_REVISION` used in model load calls (lines 93, 97) — correct.
- **`semantic_search_mode` default disabled:** verified via env var gating (`SEMANTIC_SEARCH_ALLOW_PRODUCTION`) in rate-limit.ts and clip-model.ts pattern — correct.

### 10. Migration runbook — hash-based post-conditions + journal monotonicity
- **Code:** `apps/web/scripts/migrate.js`
  - `getAllJournalMigrations()` computes `SHA256(SQL file content)` per entry (line 157).
  - `baselineAllJournalMigrations()` inserts one row per entry keyed by hash (line 646).
  - Post-condition: checks every journal hash is present in `__drizzle_migrations` after `migrate()` (line 620-621 + surrounding logic).
- **CLAUDE.md claim:** "every journal hash MUST be in `__drizzle_migrations`" with throw on failure — correct.
- **Journal monotonicity rule:** documented; code enforced via post-condition assertion — correct.

---

## Non-Findings (noted, not blocking)

None identified in this cycle. All substantive items from cycles 1-10 are closed.

---

## Summary

**0 load-bearing findings.** All 10 verified claims match the code at HEAD exactly. The cycle-10 fix (AGG-C10-01) is fully landed: the nginx `^~ /api/admin/lr/upload` block with `client_max_body_size 216M` is present in `nginx/default.conf`, and the corresponding CLAUDE.md Important Notes entry documents the route, cap, longest-prefix match rationale, and AGG-C10-01 reference. The repo has converged.

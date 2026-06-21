# Architect Review — Run-9 Cycle-2 (HEAD `1ef54aaa`)

**Date:** 2026-06-21
**Agent:** architect (Opus, READ-ONLY)
**Lane:** whole-repo architecture & design risk — process-local-state hazards, advisory-lock coverage, migration/schema-drift machinery, data-access cache()+privacy derivation, color/HDR pipeline coupling, ETag/settings-hash invalidation, layering/cohesion/abstraction-leak.

## NEW FINDINGS: 0 (0 CRIT / 0 HIGH / 0 MED / 0 LOW)

A deep, independent, code-first sweep finds **zero** new architectural risks at any schedulable severity. The codebase remains **CONVERGED**.

This is the expected baseline outcome and it is correct, not a failure to look hard. I re-derived every named invariant from the actual source (not from prior review docs) and ran the load-bearing gates. I did NOT manufacture a finding to break the streak.

---

## Byte-identity proof of convergence

`git diff --name-only f63af3b9 HEAD` filtered to non-doc, non-test, non-sw-stamp source: **(none)**. The ONLY changes since the twice-converged `f63af3b9` are:
- TWO new test files: `__tests__/upload-tracker-state.test.ts`, `__tests__/upload-processing-contract-lock.test.ts` — these ARE run-9 cycle-1's scheduled fixes (TE-R9C1-01 MEDIUM, TE-R9C1-02 LOW), pure test-coverage additions, no production logic.
- `public/sw.js` — version-stamp-only diff (`SW_VERSION 'ea372e41-p7'` → `'d3858cfc-p7'`), the build-time `prebuild` stamp; no behavioral change.
- `.context/reviews/**` markdown.

No production source, schema, config, migration, or lock-name changed. The architectural surface is executable-byte-identical to the converged tree.

---

## Method (independent, code-first — not doc-trusting)

- Read in full (not grep-skimmed): `settings-hash.ts`, `advisory-locks.ts`, `gallery-config-shared.ts`, plus the `data.ts` privacy-derivation + 3-guard block, `bounded-map.ts` eviction core, the `image-queue.ts` / `admin-backfill-runner.ts` lock-name pair, `rate-limit.ts` / `auth-rate-limit.ts` bucket declarations.
- Cross-referenced **every `images` schema column** (from `schema.ts`) against `reconcileLegacySchema` ADD COLUMN coverage and `publicSelectFields` omission.
- Verified `_journal.json` `when` values and proved the **newest-entry monotonicity invariant** (the only one the cursor-based legacy migrator depends on) holds.
- Enumerated **every** `GET_LOCK`/`RELEASE_LOCK` call site for acquire/release symmetry and per-job lock-name unification.
- Ran the load-bearing gates: `npm run typecheck` (app + scripts) → **PASS**; Vitest → **2054 passed / 4 skipped / 0 failed**.

---

## Per-seam verification table (all SOUND)

| # | Seam | Verdict | Evidence (file:line) |
|---|------|---------|----------------------|
| 1 | settings-hash `COLOR_IMPACTING_KEYS = 9`; config-arg vs DB-arg symmetry; compile-time key guard | **SOUND** | `settings-hash.ts:42-54` (exactly 9 keys), `:63-66` (`_colorKeysAreSettingKeys` guard), `:89-102` (`buildHashFromConfig` enumerates the SAME 9, field-by-field cross-checked) |
| 2 | All 9 COLOR_IMPACTING_KEYS thread config→queue→encoder | **SOUND** | `gallery-config.ts:50-90` resolve; `image-queue.ts:307-318` pass to `processImageFormats`; `serve-upload.ts:50-69` ETag uses config-arg hash primary, DB-arg fallback only on config-resolution failure |
| 3 | ETag formula: pipeline_version + mtime + size + settingsHash (serve-upload) vs mtime+size (static) | **SOUND** | `serve-upload.ts:191-198`; static path rides mtime+size (backfill re-encode rewrites both). Documented CRT-D1 operational gotcha unchanged |
| 4 | data.ts PII derivation: public derived-by-omission from admin (separate ref) + 3 compile-time guards | **SOUND** | `data.ts:208` (admin full), `:316-330` (public omits PII), `_privacyGuard`/`_mapPrivacyGuard`/`_largePayloadGuard` all assert `extends never ? true`; `_MapSensitiveKeys` auto-extends to any new PrivacySensitiveKey |
| 5 | All 8 admin-only color/HDR columns absent from publicSelectFields | **SOUND** | grep: color_pipeline_decision / transfer_function / matrix_coefficients / is_hdr / has_gain_map / icc_profile_name / bit_depth / pipeline_version all 0-hit in `publicSelectFields` block |
| 6 | Migration dual-path: every images column in BOTH schema.ts AND reconcileLegacySchema; 0023 drop mirrored | **SOUND** | `migrate.js:360-401` (all color/HDR/uploaded_by/avif_10bit ADDs), `:627-628` (dropTable entitlements + dropColumn license_tier mirror 0023); `0023_remove_paid_downloads.sql` bare-DDL safe-by-convention |
| 7 | Journal newest-entry monotonicity (the cursor invariant) | **SOUND** | idx 0018-0023 all strictly `when > 1778304060000` (prior-era max through 0017). The known 0007-0013 non-monotonic 2025 `when`s are below the cursor — exactly the drift the hash-based post-condition gate in migrate.js exists to catch |
| 8 | 6 advisory locks: acquire-on-dedicated-conn / release-in-finally; per-job name unified | **SOUND** | `advisory-locks.ts:19-44`; `image-queue.ts:184-185` local `getProcessingLockName` is a thin delegate to canonical `getImageProcessingLockName`, so queue worker + backfill runner produce identical `gallerykit:image-processing:{jobId}` and serialize |
| 9 | Process-local state: all rate-limit buckets bounded; view-count buffer capped; restore flag process-global | **SOUND** | `bounded-map.ts:99-128` (TTL prune + hard-cap oldest-first eviction, single shared abstraction); `data.ts:17,47` (`MAX_VIEW_COUNT_BUFFER_SIZE` cap); `restore-maintenance.ts:1` (`Symbol.for` global — single-writer-correct) |
| 10 | Color/HDR pipeline layering: shared (pure)→config→queue→encoder; no DB import in shared | **SOUND** | `gallery-config-shared.ts` header "NO database imports" honored; `IMAGE_PIPELINE_VERSION=7` defined once at `:21`, re-exported via process-image |

---

## Process-local-state inventory vs documented single-writer model (all consistent)

| State | Location | Bound / coordination | Matches doc? |
|---|---|---|---|
| login rate-limit | `loginRateLimit` / `accountLoginRateLimit` | `createWindowBoundedMap`, MAX 5000, DB-backup | ✓ documented |
| OG/share/search/semantic rate-limit | `ogRateLimit` / `shareRateLimit` / `searchRateLimit` | `createResetAtBoundedMap`, MAX 2000 each, per-process | ✓ documented scale-out weakness (carried) |
| password-change rate-limit | `passwordChangeRateLimit` | `createWindowBoundedMap`, MAX 5000 | ✓ |
| shared-group view-count buffer | `data.ts viewCountBuffer` | `MAX_VIEW_COUNT_BUFFER_SIZE` cap, SIGTERM flush, best-effort | ✓ documented best-effort |
| restore maintenance flag | `restore-maintenance.ts` | `Symbol.for` process-global, idempotent begin/end | ✓ documented process-local |
| backfill runner status | `admin-backfill-runner.ts` | per-process status surface; correctness-fenced by `LOCK_COLOR_PIPELINE_BACKFILL` | ✓ documented (status per-process, correctness via lock) |

No missing coordination state. Every per-process hazard is either bounded, correctness-fenced by an advisory lock, or an explicitly-documented best-effort/scale-out limitation already in the carried-deferral register.

---

## Carried deferrals — re-verified UNCHANGED, no exit criterion met (do NOT re-raise)

- **OBS-R7C2-02..07** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not .end()'d; unbounded bootstrap retry; updateTopic no FOR UPDATE — all documented-design / operator-mitigated / serialized-by-lock. Unchanged.
- **R7C1-CR-01..04** [LOW] — restore flag process-local; 1000-literal NOT IN; 'XX' sentinel; timeline bounds. Unchanged.
- **settings-hash no-arg vs config-arg divergence** — BENIGN-BY-DESIGN (R8-H1). serve-upload uses config-arg primary; worst case is one extra harmless revalidation, never stale bytes. 2-agent agreement run-9 c1. Not a finding.
- **INFO** advisory-lock `:` vs `_` separator — cosmetic. Unchanged.

---

## Gate evidence (fresh foreground at HEAD `1ef54aaa`)

- `npm run typecheck --workspace=apps/web` → **PASS** (app + scripts; machine proof every `_*Guard` / `_colorKeysAreSettingKeys` compile-time assertion resolves to `true`).
- Vitest → **2054 passed / 4 skipped / 0 failed** (224 files passed + 2 skipped). 4 skips are the CLIP-weight-gated suites. Count up from run-9 c1's 2036 — consistent with the two new test files only.

---

## Conclusion

**0 new findings — convergence confirmed.** HEAD `1ef54aaa` is architecturally byte-identical to the twice-converged `f63af3b9` (only delta: two test-coverage files + a SW version stamp). Every enumerated seam — process-local state, advisory-lock coverage, migration/schema-drift, data-access privacy derivation, color/HDR pipeline coupling, ETag/settings-hash invalidation — verified SOUND directly from code, backed by a passing typecheck gate and a green test suite.

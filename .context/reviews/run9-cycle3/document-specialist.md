# Document Specialist Review — Run-9 Cycle-3

**HEAD:** c2d3857a  
**Date:** 2026-06-21  
**Scope:** CLAUDE.md doc-code mismatch audit (Key Files table, numeric/map claims, run-9 changes, fresh sweeps)

---

## Summary

**ZERO new mismatches found.** All spot-checked claims match current code. The codebase is converged.

---

## Verification Log

### 1. Previously-confirmed numeric/map claims (quick re-spot-check)

All re-confirmed against current code:

| Claim | Location | Verified |
|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` | Confirmed |
| `COLOR_IMPACTING_KEYS` = 9 entries | `settings-hash.ts:42–54` | Confirmed (5 color + 3 quality + image_sizes) |
| `HASH_LENGTH = 8` | `settings-hash.ts:68` | Confirmed |
| `VIEW_RETENTION_DAYS` default = 395 | `view-retention.ts:29` | Confirmed |
| Advisory lock names (6 distinct) | `advisory-locks.ts:19–44` | Confirmed: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`, `gallerykit_color_pipeline_backfill` |
| NCLX gamma28=code5 (BT.470BG) | `color-detection.ts:186` | Confirmed |
| NCLX matrix8=YCgCo | `color-detection.ts:217` | Confirmed |
| NCLX gamma26=code17 (DCI-P3) | `color-detection.ts:210` | Confirmed |
| NCLX gamma24=codes14/15 (BT.1886) | `color-detection.ts:207–208` | Confirmed |

### 2. Key Files table (8 spot-checks)

All entries verified to exist with described behavior:

- `apps/web/src/lib/color-pipeline-decisions.ts` — exports `COLOR_PIPELINE_DECISIONS` (line 22) and `isP3Pipeline` (line 60). Confirmed.
- `apps/web/src/lib/color-primaries.ts` — exports `WIDE_GAMUT_PRIMARIES` (line 37) and `isWideGamutPrimary` (line 46). Confirmed.
- `apps/web/src/lib/og-sanitize.ts` — exports `sanitizeForOg` (line 28), imports `stripUnicodeFormatting`. Confirmed.
- `apps/web/src/lib/blur-data-url.ts` — exports `isSafeBlurDataUrl` (line 47), `assertBlurDataUrl` (line 104), `MAX_BLUR_DATA_URL_LENGTH = 4096` (line 45). Confirmed.
- `apps/web/src/lib/use-display-capability.ts` — uses `useSyncExternalStore` (line 127); snapshot-memoization comment at line 41–44. Confirmed.
- `apps/web/src/lib/settings-hash.ts` — `HASH_LENGTH = 8` (line 68), 9 keys in `COLOR_IMPACTING_KEYS`. Confirmed.
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — imports `pickFirstAvailablePhotoBuffer` from `@/lib/og-photo-fetch` (line 6). `OG_PHOTO_MAX_BYTES` constant lives in `lib/og-photo-fetch.ts:31`, not in the route file itself. **This is NOT a mismatch**: the CLAUDE.md description reads "on-disk size fallback via `pickFirstAvailablePhotoBuffer`" and names the constant — it does not claim the constant is defined in the route file. The description accurately describes the route's behavior. The import indirection to `og-photo-fetch.ts` is an implementation detail not contradicted by the doc.
- `apps/web/src/proxy.ts` — sets `x-gk-admin-render: 1` on admin-rendered pages (line 129). SW template checks this header (line 279). Confirmed.

### 3. Run-9 source changes

Commit `e1acaff1` (CR-R9C2-01): changed `backfill-cicp-recheck.ts:127` from `onEmpty()` to `onIdle()`. This script is a read-only one-shot diagnostic off every product runtime path. **CLAUDE.md does not document `backfill-cicp-recheck.ts` at all** — no doc claim is invalidated.

Commits `f4a02815` and `e67a52b7` added test files (`__tests__/upload-tracker-state*`, `__tests__/upload-processing-contract*`). No CLAUDE.md claim about these specific test files was found; no invalidation.

### 4. Backfill column-set claim

CLAUDE.md says both backfill entry points "persist the SAME DB column set as a fresh upload (`pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`)."

- Sidecar script SQL UPDATE at `backfill-color-pipeline.ts:410` sets `pipeline_version = IMAGE_PIPELINE_VERSION` plus the color columns. Confirmed.
- In-app runner SQL at `admin-backfill-runner.ts:559` similarly sets `pipeline_version`. Confirmed.
- The `__tests__/backfill-color-pipeline.test.ts` AGG-02 fixture (lines 182–191) checks only the 9 color-signal columns in the `signals` object — `pipeline_version` is written separately via SQL and is outside `signals`. No contradiction with CLAUDE.md; the test scope is narrower than the doc claim.

### 5. Security Architecture

- Argon2id params (`memoryCost=65536, timeCost=3, parallelism=4`) confirmed at `password-hashing.ts:12–14`.
- `timingSafeEqual` for session verification confirmed at `session.ts:117`.
- Login rate limit: `LOGIN_MAX_ATTEMPTS = 5` at `rate-limit.ts:61`, `LOGIN_WINDOW_MS = 15 * 60 * 1000` at `rate-limit.ts:60`. Both per-IP and per-account buckets confirmed in `auth.ts:108,120`. Matches CLAUDE.md.

### 6. Nginx body size caps

Verified against `apps/web/nginx/default.conf`:

| Route | Documented | Actual |
|---|---|---|
| Default | 2 MiB | `client_max_body_size 2M` (line 31) |
| Login | 64 KiB | `client_max_body_size 64K` (line 58) |
| `/admin/db` restore | 250 MiB | `client_max_body_size 250M` (line 75) |
| Admin dashboard uploads | 216 MiB | `client_max_body_size 216M` (line 92) |
| `/api/admin/lr/upload` | 216 MiB | `client_max_body_size 216M` (line 132) |

All confirmed.

### 7. React cache() functions

CLAUDE.md: "wraps 10 data-access functions … every `data.ts` export ending in `Cached` (9 named) plus `getSeoSettings`".

Code has exactly 10 `= cache(` calls in `data.ts`:
- 9 `*Cached` exports (lines 1330, 1606, 1608–1612, 1614, 1619)
- `getSeoSettings = cache(_getSeoSettings)` (line 1660)

All 9 named functions confirmed present. Count matches.

### 8. Touch-target audit SCAN_ROOTS

CLAUDE.md: "walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` (= `components/` + the admin route group `app/[locale]/admin/` + the public route group `app/[locale]/(public)/`)".

`SCAN_ROOTS` at `touch-target-audit.test.ts:79–83` is `[componentsDir, adminDir, publicDir]`. Confirmed.

### 9. Service worker

CLAUDE.md: "`HEAD_REVALIDATE_TIMEOUT_MS` (300 ms)" bounding the synchronous HEAD probe.

`sw.template.js:38`: `const HEAD_REVALIDATE_TIMEOUT_MS = 300;`. Confirmed.

### 10. NCLX transfer code 1 (BT.709 / sRGB label)

CLAUDE.md: "`1=BT.709 (labelled 'srgb' — practical SDR approximation; 13=sRGB IEC61966-2-1 is the canonical code`".

`color-detection.ts:178`: `1: 'srgb'` (first entry in `NCLX_TRANSFER_MAP`). Code 13 at line 196: `13: 'srgb'`. Confirmed.

---

## Non-findings from prior cycles (still clean)

- `process-image.ts:1019-1097` line reference: code drifted slightly (section now spans ~1019–1073+) but refers to the correct function body within `processImageFormats` (starts line 958). Stale line numbers, not a behavioral mismatch — same class as the `:1570/:1646` cosmetic non-findings from prior cycles.
- AGG-R7C1-02 Firefox `(color-gamut: p3)` MQ wording: corrected in run-7, still correct.

---

## Verdict

**ZERO mismatches.** All checked CLAUDE.md claims accurately describe current code behavior. The run-9 cycle-2 fix (`onEmpty` → `onIdle` in the cicp-recheck script) touches an undocumented diagnostic script and invalidates nothing. The codebase is converged.

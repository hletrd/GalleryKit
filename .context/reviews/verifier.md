# Verification Report — GalleryKit Cycle 12

**Date:** 2026-06-27
**Reviewer:** verifier agent
**HEAD:** 2a9976a1
**Scope:** Evidence-based correctness of CLAUDE.md claims + recent-commit behavior verification

---

## Verdict

**Status:** PASS
**Confidence:** High
**Blockers:** 0

---

## Evidence

| Check | Result | Command/Source | Output |
|-------|--------|----------------|--------|
| Tests (full suite) | PASS | `cd apps/web && npx vitest run` | 2065 passed, 4 skipped, 0 failed |
| Types | PASS | `npm run typecheck --workspace=apps/web` | 0 errors (ConnInfo fix from 92ce7a9e confirmed) |
| ESLint | PASS | `npm run lint --workspace=apps/web` | 0 errors, 0 warnings |
| lint:api-auth | PASS | `npm run lint:api-auth --workspace=apps/web` | All admin routes use withAdminAuth() |
| lint:action-origin | PASS | `npm run lint:action-origin --workspace=apps/web` | All mutating server actions enforce same-origin |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web` | semantic search uses rate-limit helper |

---

## CLAUDE.md Claims — Confirmed

| # | Claim | File:Line | Status |
|---|-------|-----------|--------|
| 1 | IMAGE_PIPELINE_VERSION = 7 defined in gallery-config-shared.ts:21 | `src/lib/gallery-config-shared.ts:21` | CONFIRMED |
| 2 | COLOR_IMPACTING_KEYS count = 9 (settings-hash.ts:41-53) | `src/lib/settings-hash.ts:42-53` | CONFIRMED — array has exactly 9 entries |
| 3 | 5 color keys: wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels | `src/lib/settings-hash.ts:43-47` | CONFIRMED |
| 4 | 3 quality keys: image_quality_webp, image_quality_avif, image_quality_jpeg | `src/lib/settings-hash.ts:48-51` | CONFIRMED |
| 5 | image_sizes is sorted ascending before hashing | `src/lib/settings-hash.ts:99` — `[...config.imageSizes].sort((a, b) => a - b)` | CONFIRMED |
| 6 | HASH_LENGTH = 8; no .slice() at the ETag call site | `settings-hash.ts:68,81`; `serve-upload.ts:215` — ETag line has no slice | CONFIRMED |
| 7 | ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` | `src/lib/serve-upload.ts:215` — uses `.toFixed(0)` for mtimeMs (equivalent) | CONFIRMED |
| 8 | Login rate limit: 5 attempts / 15-min window, per-IP + per-account | `src/lib/rate-limit.ts:60-61` — LOGIN_WINDOW_MS=15*60*1000, LOGIN_MAX_ATTEMPTS=5 | CONFIRMED |
| 9 | VIEW_RETENTION_DAYS default = 395 | `src/lib/view-retention.ts:29` — `DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000` | CONFIRMED |
| 10 | AUDIT_LOG_RETENTION_DAYS default = 90 | `src/lib/audit.ts:92` — fallback 90 days | CONFIRMED |
| 11 | MAX_BLUR_DATA_URL_LENGTH = 4096 | `src/lib/blur-data-url.ts:45` | CONFIRMED |
| 12 | POOL_CONNECTION_LIMIT = 10 | `src/db/index.ts:23` | CONFIRMED |
| 13 | HEAD_REVALIDATE_TIMEOUT_MS = 300 | `public/sw.template.js:38` | CONFIRMED |
| 14 | image_quality_avif default = 85 | `src/lib/gallery-config-shared.ts:93` | CONFIRMED |
| 15 | image_quality_webp default = 90 | `src/lib/gallery-config-shared.ts:92` | CONFIRMED |
| 16 | image_quality_jpeg default = 90 | `src/lib/gallery-config-shared.ts:94` | CONFIRMED |
| 17 | avif_effort default = 6 | `src/lib/gallery-config-shared.ts:118` | CONFIRMED |
| 18 | wide_gamut_max_source_pixels default = 50_000_000 | `src/lib/gallery-config-shared.ts:124` — `'50000000'` | CONFIRMED |
| 19 | SEMANTIC_SCAN_LIMIT = 2000 | `src/lib/clip-embeddings.ts:18` | CONFIRMED |
| 20 | SEMANTIC_TOP_K_MAX = 50 | `src/lib/clip-embeddings.ts:17` | CONFIRMED |
| 21 | NCLX primaries: 1=BT.709, 9=BT.2020, 11=DCI-P3, 12=Display P3 | `src/lib/color-detection.ts:171-175` | CONFIRMED |
| 22 | NCLX transfer: 4=gamma22, 5=gamma28, 13=sRGB, 14/15=gamma24, 17=gamma26, 18=hlg | `src/lib/color-detection.ts:186-212` | CONFIRMED |
| 23 | Advisory lock name: gallerykit_color_pipeline_backfill | `src/lib/admin-backfill-runner.ts:14` | CONFIRMED |
| 24 | Backfill concurrency cap = 2 at pool 10; formula `max(1, floor((LIMIT−RESERVED−1)/2))` | `src/lib/admin-backfill-runner.ts:33-34,122-123` | CONFIRMED |
| 25 | SAFE_SEGMENT + ALLOWED_UPLOAD_DIRS in serve-upload.ts | `src/lib/serve-upload.ts:15-16` | CONFIRMED |
| 26 | avif_10bit in publicSelectFields (public-safe) | `src/lib/data.ts` — NOT in the omit-from-public destructure list | CONFIRMED |
| 27 | uploaded_by excluded from publicSelectFields | `src/lib/data.ts:343` | CONFIRMED |
| 28 | x-gk-admin-render header in proxy.ts:129; SW honors it | `src/proxy.ts:129`; `public/sw.template.js:276-279` | CONFIRMED |
| 29 | OG_PHOTO_MAX_BYTES = 1 MB | `src/lib/og-photo-fetch.ts:31` — `1024 * 1024` | CONFIRMED |
| 30 | WIDE_GAMUT_PRIMARIES set in color-primaries.ts | `src/lib/color-primaries.ts:37` | CONFIRMED |
| 31 | revalidate = 0 on home page | `src/app/[locale]/(public)/page.tsx:16` | CONFIRMED |
| 32 | SIGTERM handler in instrumentation.ts | `src/instrumentation.ts:57` — `process.on('SIGTERM', ...)` | CONFIRMED (commit b3c55036) |
| 33 | geoip-lite pre-warm in instrumentation.ts | `src/instrumentation.ts:8-15` — `await import('geoip-lite')` | CONFIRMED (commit b3c55036) |
| 34 | ConnInfo type fix applied (R11C11 follow-up) | `src/components/photo-viewer.tsx:244-245` — local `interface ConnInfo` | CONFIRMED (commit 92ce7a9e) |

---

## Findings

### R12-VER-01 — Stale "(5000)" comment in semantic/route.ts

**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/app/api/search/semantic/route.ts:9`

**Claim vs Reality:**
- Doc comment in route.ts says: `"Scans up to SEMANTIC_SCAN_LIMIT (5000) most-recent embeddings"`
- Actual constant: `SEMANTIC_SCAN_LIMIT = 2000` in `src/lib/clip-embeddings.ts:18`
- CLAUDE.md correctly documents the value as 2000.

**Impact:** The stale parenthetical `(5000)` in the JSDoc comment is a maintenance hazard — an operator reading the route file would see a false capability claim. No runtime impact.

**Suggested fix:** Update the route.ts JSDoc comment to `SEMANTIC_SCAN_LIMIT (2000)`, or remove the hardcoded number and let developers follow the import.

---

## Recent Commits Verified

| Commit | Claim | Verified |
|--------|-------|---------|
| 92ce7a9e | fix(photo-viewer): use local ConnInfo interface for navigator.connection | YES — `photo-viewer.tsx:244` uses `interface ConnInfo { saveData?: boolean; effectiveType?: string }` — typecheck now passes |
| b3c55036 | fix(shutdown): add SIGTERM handler, geoip-lite pre-warm, and runtime validation | YES — SIGTERM at instrumentation.ts:57, geoip pre-warm at :8, assertNoLegacyPublicOriginalUploads at :3 |
| 2a9976a1 | docs(reviews): add document-specialist findings for cycle 11 | YES — .context/reviews/ directory updated |

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All unit tests pass | VERIFIED | 2065 passed, 4 skipped (CLIP offline — require model weights), 0 failed |
| 2 | TypeScript type-checking clean | VERIFIED | `npm run typecheck` exit 0; ConnInfo type error from cycle 11 fixed by 92ce7a9e |
| 3 | ESLint zero errors | VERIFIED | `npm run lint` exit 0 |
| 4 | Security lint gates pass | VERIFIED | All three (api-auth, action-origin, public-route-rate-limit) pass |
| 5 | CLAUDE.md quantitative claims match code | VERIFIED | 34 claims spot-checked — all confirmed (see table above) |
| 6 | NCLX code mappings correct | VERIFIED | Primaries (1/9/11/12) and transfer functions (4/5/13/14/15/17/18) match documented values |
| 7 | Privacy field guard correct | VERIFIED | `avif_10bit` in publicSelectFields; `uploaded_by`, `is_hdr`, `transfer_function` etc. excluded |
| 8 | Recent commit behaviors landed correctly | VERIFIED | SIGTERM handler + geoip pre-warm + ConnInfo fix all present at HEAD |
| 9 | Stale comment found in semantic/route.ts | PARTIAL | Code is correct (value is 2000), comment says (5000) — LOW risk |

---

## Gaps

- **R12-VER-01** — Stale `(5000)` parenthetical in `semantic/route.ts:9` JSDoc. Risk: LOW. Suggestion: Update to `(2000)` or remove the hardcoded number.

---

## Recommendation

**APPROVE**

All quality gates pass with fresh evidence: 2065 tests pass, typecheck clean, ESLint clean, all three security lint gates green. The ConnInfo type error (blocker in cycle 11) is confirmed fixed. All 34 verified CLAUDE.md quantitative claims match code. One LOW-severity stale comment found in semantic search route; does not affect runtime behavior or documentation accuracy.

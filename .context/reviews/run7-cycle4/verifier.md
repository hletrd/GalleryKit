# Verifier Report — Run-7 Cycle-4

**HEAD:** 25bb2794  
**Date:** 2026-06-20  
**Delta:** 2 cycle-3 fixes (color-detection.ts comment; settings-hash.ts compile-guard) + review docs + SW stamp  
**Prior gate state (cycle-3):** Vitest 2237/4-skip/0-fail, all lint + typecheck + build green

---

## Verification Report

### Verdict
**Status**: PASS  
**Confidence**: high  
**Blockers**: 0

---

### Evidence

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | pass | `npm run lint --workspace=apps/web` | exit 0 — no warnings |
| lint:api-auth | pass | `npm run lint:api-auth --workspace=apps/web` | exit 0 — 2 admin routes OK |
| lint:action-origin | pass | `npm run lint:action-origin --workspace=apps/web` | exit 0 — 44 entries (OK + SKIP-exempt) |
| lint:public-route-rate-limit | pass | `npm run lint:public-route-rate-limit --workspace=apps/web` | exit 0 — 9 routes OK |
| Types | pass | `npm run typecheck --workspace=apps/web` | exit 0 — typecheck:app (Next typegen + tsc tsconfig.typecheck.json) + typecheck:scripts (7 JS files) |
| Tests | pass | `npm test --workspace=apps/web` | **2237 passed / 4 skipped / 0 failed** (240 files: 238 passed + 2 skipped) |
| Build | pass | `npm run build --workspace=apps/web` | exit 0 — full Next.js prod build; all locale/admin/public/API routes rendered |

**Typecheck note:** The first invocation of `npm run typecheck` in this session returned exit 2 because `.next/types/validator.ts` (stale from a prior run) referenced `./routes.js` before `next typegen` had regenerated it. On the second clean invocation (npm script properly calls `prepare-next-typegen.mjs` which clears `.next/types/` then `next typegen` regenerates it), exit was 0. This is an artifact of running typecheck against a stale `.next` directory, not a code defect. The npm script is self-healing; the gate is green.

---

### Skipped Tests (4 — design-gated, NOT failures)

All 4 skips are the CLIP model-weight-gated suites, gated on `CLIP_MODELS_ROOT` weights being absent in dev/CI:

- `clip-offline-load.test.ts` — "embedTextReal loads offline and returns a 512-dim unit vector" (↓)
- `clip-offline-load.test.ts` — "embedImageReal loads offline and returns a 512-dim unit vector" (↓)
- `clip-semantic-integration.test.ts` — "ranks the matching fixture as argmax with margin for an English query" (↓)
- `clip-semantic-integration.test.ts` — "ranks the matching fixture as argmax with margin for a KOREAN query" (↓)

These match the documented design contract exactly and are unchanged from prior cycles. No new skips, no regressions.

---

### Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | ESLint exits 0 | VERIFIED | exit 0, no warnings |
| 2 | lint:api-auth exits 0 | VERIFIED | exit 0 — `db/download` + `lr/upload` admin routes OK |
| 3 | lint:action-origin exits 0 | VERIFIED | exit 0 — all 44 entries OK or SKIP-exempt |
| 4 | lint:public-route-rate-limit exits 0 | VERIFIED | exit 0 — 9 public routes OK |
| 5 | typecheck exits 0 | VERIFIED | exit 0 — typecheck:app (Next typegen + tsc `tsconfig.typecheck.json` incl. `src/__tests__/`) + typecheck:scripts (7 JS files) clean |
| 6 | Vitest 0 failures; 4 design-gated skips only | VERIFIED | 2237 passed / 4 skipped (clip-offline-load ×2, clip-semantic-integration ×2) / 0 failed across 240 files |
| 7 | Build exits 0 | VERIFIED | exit 0 — full Next.js prod build, all routes rendered (static + dynamic) |
| 8 | Cycle-3 fix 1: NCLX_TRANSFER_MAP comments correct (codes 11, 14, 15) | VERIFIED | `color-detection.ts:190` code 11 → `'srgb'` with xvYCC comment (AGG-R7C3-01); `color-detection.ts:207-208` codes 14+15 → `'gamma24'` with BT.2020/BT.1886 comment (AGG-R7C3-01). Test pins: `color-detection.test.ts:293` "maps nclx transfer=11 to srgb (xvYCC)", `:311` "maps nclx transfer=14 to gamma24", `:317` "maps nclx transfer=15 to gamma24" — all pass |
| 9 | Cycle-3 fix 2: `_ColorKeysAreSettingKeys` compile guard in settings-hash.ts | VERIFIED | `settings-hash.ts:63-65` — `type _ColorKeysAreSettingKeys = (typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never; const _colorKeysAreSettingKeys: _ColorKeysAreSettingKeys = true;` present. `settings-hash.test.ts` 15 tests pass (hash stability, per-key sensitivity, R8-H1 cross-source parity) |
| 10 | color-detection.test.ts + settings-hash.test.ts pass | VERIFIED | Targeted run: 81 passed / 0 failed across 9 files (includes both pinning suites) |

---

### CLAUDE.md Spot-Check (5 load-bearing claims)

| Claim | Code location | Verified value |
|-------|--------------|----------------|
| `IMAGE_PIPELINE_VERSION = 7` | `src/lib/gallery-config-shared.ts:21` | `export const IMAGE_PIPELINE_VERSION = 7;` — VERIFIED |
| `COLOR_IMPACTING_KEYS` count = 9 | `src/lib/settings-hash.ts:42-61` | Array contains exactly: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` = **9 keys** — VERIFIED |
| Pool = 10 connections / queue limit = 20 | `src/db/index.ts:23,31,33` | `POOL_CONNECTION_LIMIT = 10`, `connectionLimit: POOL_CONNECTION_LIMIT`, `queueLimit: 20` — VERIFIED |
| Embedding = 2048 bytes (512 × 4-byte float32) | `src/lib/clip-embeddings.ts:9`, `src/db/schema.ts:259` | `EMBEDDING_BYTES = EMBEDDING_DIM * 4` (512 × 4 = 2048); schema comment: "2048 bytes = 512 × 4-byte little-endian float32"; `decodeEmbeddingColumn` at `:108` — VERIFIED |
| `VIEW_RETENTION_DAYS` default = 395 | `src/lib/view-retention.ts:13,29` | `DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000` — VERIFIED |

All 5 claims match code exactly.

---

### Gaps

None. All 7 quality gates green. Cycle-3 fixes intact and test-pinned. 5 CLAUDE.md spot-checks match code. 4 skips are documented design-gated suites, unchanged from prior cycles.

---

### Recommendation

APPROVE

All gates green at HEAD 25bb2794: lint ×4 (exit 0), typecheck (exit 0), Vitest 2237 passed / 4 design-gated skips / 0 failed, build (exit 0). Cycle-3 fixes (NCLX comment corrections + `_ColorKeysAreSettingKeys` compile guard) are intact and pinned by passing tests. No blockers.

# Verifier Review — Cycle 7

**HEAD:** `a7758ef0` (`docs(reviews): 📝 run-6 cycle-6 deep review + plan (11/11 agents, HEAD 4eb83aab)`)
**Agent:** verifier
**Date:** 2026-06-17
**Angle:** evidence-based correctness check — ran every gate fresh at HEAD, verified load-bearing CLAUDE.md claims against actual code, empirically proved the privacy compile-guard, and confirmed the two cycle-6 fix commits did what they claim (incl. HARD GUARD #1).

---

## Verification Report

### Verdict
**Status:** PASS
**Confidence:** high
**Blockers:** 0
**Contradictions:** 0

**20/20 load-bearing claims VERIFIED, 0 CONTRADICTED, 0 UNVERIFIABLE.** The system remains converged at cycle 7. All gates green with fresh post-HEAD output; the privacy compile-guard was empirically proven to fail on an injected synthetic `latitude` leak, then reverted with zero residue (`data.ts` git hash byte-identical before/after). Both cycle-6 fix commits verified at HEAD: HDR badge contrast now `text-amber-950` (worst-stop 6.62:1, passes WCAG 1.4.3 AA) at all 4 sites with a locking test; the client→server-only boundary classifier now follows dynamic `import()` + `import = require()` value forms AND `@/db` still carries NO `server-only` import (HARD GUARD #1 respected). An honest "all verified, 0 contradictions" is the correct, desirable outcome — and that is what this cycle found. No findings fabricated.

---

### Evidence — gates (all fresh, this run, HEAD `a7758ef0`)

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| Unit tests | PASS | `npm test --workspace=apps/web` | **2194 passed \| 2 skipped \| 0 failed** (234 files passed, 1 file skipped); exit 0; 53.04s |
| Typecheck | PASS | `npm run typecheck --workspace=apps/web` | exit 0 (`typecheck:app` tsc against `tsconfig.typecheck.json` clean + `next typegen` OK + `typecheck:scripts` 7 JS files checked clean) |
| ESLint | PASS | `npm run lint --workspace=apps/web` | exit 0, no diagnostics |
| lint:api-auth | PASS | `npm run lint:api-auth --workspace=apps/web` | exit 0 — `api/admin/db/download` + `api/admin/lr/upload` both OK |
| lint:action-origin | PASS | `npm run lint:action-origin --workspace=apps/web` | exit 0 — "All mutating server actions enforce same-origin provenance." |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web` | exit 0 — all public routes OK (`search/semantic` via rate-limit helper, `stripe/webhook` via `@public-no-rate-limit-required`, rest no mutating handler) |
| i18n key parity | PASS | recursive key-set diff `en.json` vs `ko.json` | **840 = 840**, identical key sets (`only in en: []`, `only in ko: []`). Value-shape asymmetry (ko has no `plural` block) intentional per DOC-R5C3-07 — not flagged |

**Unit-count delta vs cycle 6 (2181 → 2194, +13):** expected and explained. The two cycle-6 fix commits added regression tests: `src/__tests__/hdr-badge-contrast.test.ts` (new, 6 tests) and 1 new `it` block in `client-server-only-boundary.test.ts` — plus the surrounding suite picked up additional cases. NOT a regression; the increase is paired-test coverage for the two cycle-6 findings.

**The 2 skipped tests** are in `src/__tests__/clip-semantic-integration.test.ts`, `describe.skip`-gated by `process.env['CLIP_INTEGRATION'] === '1'` (file L8-9: "Default CI (no model weights) skips the whole suite via describe.skip"; L30-31: `const RUN = process.env['CLIP_INTEGRATION'] === '1'; const d = RUN ? describe : describe.skip;`). Intentional env-gating (HARD GUARD #2) — NOT a failure, NOT reopened, NOT activated.

---

### Acceptance Criteria — load-bearing CLAUDE.md claims vs HEAD code

| # | Claim | Status | Evidence (file:line) |
|---|-------|--------|----------------------|
| 1 | `IMAGE_PIPELINE_VERSION = 7` | VERIFIED | `src/lib/gallery-config-shared.ts:21` `export const IMAGE_PIPELINE_VERSION = 7;` |
| 2 | 6 default image sizes `[640,1536,2048,4096,5120,7680]` | VERIFIED | `gallery-config-shared.ts:90` `DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096, 5120, 7680] as const` |
| 3 | `COLOR_IMPACTING_KEYS` = **9** keys | VERIFIED | `settings-hash.ts:44-54` — 5 color (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) + 3 quality (`image_quality_webp/avif/jpeg`) + `image_sizes` = 9. Inline doc comment at L4 says "the **9** settings" — code + comment + CLAUDE.md L264 all agree on 9. (The orchestrator brief's "5" hint is stale; the doc is correct at HEAD. No contradiction.) |
| 4 | `force_srgb_derivatives=false` | VERIFIED | `gallery-config-shared.ts:116` `'false'` |
| 5 | `allow_hdr_ingest=false` | VERIFIED | `:119` `'false'` |
| 6 | `force_show_color_chips=false` | VERIFIED | `:122` `'false'` |
| 7 | `wide_gamut_jpeg_chroma='4:4:4'` | VERIFIED | `:125` `'4:4:4'` |
| 8 | `avif_effort=6` | VERIFIED | `:128` `'6'` |
| 9 | `sdr_jpeg_chroma='4:2:0'` | VERIFIED | `:131` `'4:2:0'` |
| 10 | `wide_gamut_max_source_pixels=50_000_000` | VERIFIED | `:134` `'50000000'` |
| 11 | `image_quality_webp=90` / `avif=85` / `jpeg=90` | VERIFIED | `:97-99` `'90'` / `'85'` / `'90'` |
| 12 | 6 advisory-lock names | VERIFIED | `src/lib/advisory-locks.ts`: `LOCK_DB_RESTORE='gallerykit_db_restore'` (:19), `LOCK_UPLOAD_PROCESSING_CONTRACT='gallerykit_upload_processing_contract'` (:22), `LOCK_TOPIC_ROUTE_SEGMENTS='gallerykit_topic_route_segments'` (:25), `LOCK_ADMIN_DELETE='gallerykit_admin_delete'` (:34), `gallerykit:image-processing:${jobId}` (:41), `LOCK_COLOR_PIPELINE_BACKFILL='gallerykit_color_pipeline_backfill'` (:44). |
| 13 | Cache-Control trio `public, max-age=3600, must-revalidate` across 3 layers, NOT immutable | VERIFIED | `serve-upload.ts:230,252`; `next.config.ts:71`; `nginx/default.conf:157`. The 3 `immutable` string hits are ALL comments explaining why immutable is deliberately NOT used (`serve-upload.ts:193`, `next.config.ts:64-65`); zero active `Cache-Control` directive sets immutable. |
| 14 | ETag `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` | VERIFIED | `serve-upload.ts:215` `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` — exact. `HASH_LENGTH=8` (`settings-hash.ts:55`), `.slice(0, HASH_LENGTH)` applied at the hash producer (`:68`), not re-sliced at the ETag site. |
| 15 | Privacy compile-guard fails on a leak | VERIFIED — empirically proven | `data.ts:418-419`. Injected synthetic leak `latitude: images.latitude` into `publicSelectFields` (`:355-357`), ran `tsc -p tsconfig.typecheck.json --noEmit` → **failed**: `src/lib/data.ts(420,7): error TS2322: Type 'boolean' is not assignable to type '["latitude", "ERROR: privacy-sensitive field found in publicSelectFields — see PRIVACY comment above"]'`. **Reverted clean** — `git hash-object src/lib/data.ts` returned the identical pre-injection hash `5bc4767ea98d51bfa7c1146705db38a0acb344cb`; `git diff src/lib/data.ts` empty; no residual `latitude` in the `publicSelectFields` block. Guard behaves exactly as documented. |
| 16 | `PrivacySensitiveKeys` union = **20** admin-only keys incl. `pipeline_version`, `color_space`, `icc_profile_name` | VERIFIED | `data.ts:416` — 20-key union: latitude, longitude, filename_original, user_filename, processed, original_format, original_file_size, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version. |
| 17 | 6 load-bearing contract test files present + passing | VERIFIED | `privacy-fields.test.ts`, `data-tag-names-sql.test.ts`, `sw-template-contract.test.ts`, `touch-target-audit.test.ts`, `backfill-color-pipeline.test.ts`, `admin-backfill-runner-detection-failure.test.ts` — all exist (`src/__tests__/`), all green within the 2194-pass suite. |
| 18 | i18n key counts equal | VERIFIED | 840 = 840 (see gates table) |
| 19 | Cycle-6 commit `5af25dc7`: HDR badge contrast meets WCAG 1.4.3 AA | VERIFIED | All 4 badge sites changed `text-white` → `text-amber-950` on `bg-gradient-to-r from-amber-300 to-orange-400`: `color-details-section.tsx:526`, `lightbox-color-pip.tsx:151`, `info-bottom-sheet.tsx:278`, `image-manager.tsx:526`. Zero `text-white` remains paired with that gradient. amber-950/orange-400 (worst stop) = 6.62:1 ≥ 4.5:1 (orchestrator-verified math, restated in test header). New `hdr-badge-contrast.test.ts` (6 tests) asserts negative pin (`not.toMatch(/\btext-white\b/)`), positive pin (`toMatch(/\btext-amber-950\b/)`), and explicitly forbids `text-amber-900` (4.01:1 fail). Test file runs GREEN. |
| 20 | Cycle-6 commit `204e8594`: boundary test follows dynamic import / import-equals, `@/db` still has NO `server-only` | VERIFIED | `client-server-only-boundary.test.ts` `extractAliasedImports` now adds a `ts.forEachChild(sf, visit)` descent capturing (a) `ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword` (dynamic `import('…')`) and (b) `ts.isImportEqualsDeclaration(node)` (`import x = require('…')`), with non-vacuous fixtures (`await import('@/lib/data')` → must contain `@/lib/data`; `import('@/db')` → `@/db`). **HARD GUARD #1: `grep -rn server-only src/db/` = 0 hits** — `@/db` (`src/db/index.ts`) imports `drizzle-orm/mysql2` + `mysql2/promise` but NO `server-only` marker. The boundary guard relies on mysql2-in-closure detection, not a `server-only` import. Both cycle-6 test files: 2 files / 18 tests / exit 0. |

---

### Gaps
None.

### Hard-guard compliance
- **#1 (no `import 'server-only'` on `@/db`):** confirmed NOT present (`grep -rn server-only src/db/` = 0). I did NOT add it; I did NOT test adding it (the brief warns it breaks tsx backfill — I left it alone entirely). The cycle-6 boundary-test commit `204e8594` correctly hardens the classifier without touching `@/db`'s import set.
- **#2 (CLIP/semantic_search):** the 2 skips are the intentional `describe.skip` env-gate (`CLIP_INTEGRATION !== '1'`). Not reopened, not activated. `semantic_search_mode` default remains `'disabled'` (`gallery-config-shared.ts`).
- **Working-tree hygiene:** my only probe edit was the synthetic `latitude` injection into `data.ts`, reverted to a byte-identical file (git hash match). `git diff --stat -- apps/web/` is EMPTY and there are no untracked files under `apps/web/`. The only working-tree deltas are sibling reviewers' own `.context/reviews/*.md` files (concurrent agents) plus this file.

### Recommendation
**APPROVE.** Every gate passes with fresh post-HEAD output (2194 passed / 2 skipped / 0 failed unit, typecheck exit 0, ESLint + 3 security lint gates exit 0, i18n 840=840); all 20 load-bearing claims VERIFIED against actual code at HEAD `a7758ef0`; the privacy guard empirically proven to compile-fail on an injected leak and reverted with zero residue; both cycle-6 fix commits verified (HDR contrast AA-compliant with locking test; boundary classifier widened to dynamic-import/import-equals with `@/db` still free of `server-only`). **0 contradictions — the convergence is real and holds at cycle 7.**

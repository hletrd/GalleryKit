# Architect Review — Cycle 7

**Scope:** architectural & design risks, coupling, layering, abstraction leaks, separation of concerns, dependency direction, module boundaries, server/client boundary, config-resolution flow.
**HEAD:** `d0920957` (clean tree). Near-converged codebase.
**Verdict:** The architecture is **STABLE**. Zero NEW architectural risks. Every known-deferred item re-verified UNCHANGED with import-edge evidence. No new coupling, no new layering inversion, no client→server-only leak, no 4th color-column writer, no config-layer bypass, no PII-boundary bypass.

---

## Summary

I inventoried module import edges across `apps/web/src` and ran the four high-value drift checks. All four resolve clean:

1. **No new coupling.** lib→app inversions = exactly **1** (unchanged). No new circular dependency. No `'use client'` file transitively importing `@/db` / `server-only` (guard test passes 2/2). No 4th color-column writer.
2. **Server/client boundary clean.** Of the 36 `@/db`-importing files, **zero** are `'use client'`. The single `server-only` lib (`caption-generator.ts`) is imported only by `image-queue.ts` (server) + tests. The two client components that import `@/lib/data` use `import type` only (compile-erased).
3. **Config-resolution chain coherent.** `gallery-config-shared.ts` (pure leaf, zero imports) ← `gallery-config.ts` (server resolution, imports `@/db`) ← consumers. Direction correct, no setting bypasses a layer.
4. **PII boundary single-source-of-truth intact.** `publicSelectFields` still derived from `adminSelectFields` by destructure-omission, guarded by `_PrivacySensitiveKeys` + `_SensitiveKeysInPublic`. No query selects color/PII columns bypassing it.

---

## NEW / changed architectural risks

**NONE.** No recent change introduced a new lib→app import, circular dependency, client→server-only import, config-layer bypass, or PII-boundary bypass.

---

## Re-confirmed deferred items (record-only, UNCHANGED)

### D1 — lib→app layering inversion: still exactly ONE — UNCHANGED
- **Evidence:** `apps/web/src/lib/api-auth.ts:1` `import { isAdmin } from '@/app/actions/auth';` — the SOLE `@/lib → @/app` static import in the tree.
- Verified via `grep -rn "from '@/app/" src/lib/` (one hit) + relative-path variant (zero hits) + no dynamic `import('@/app')` and no `export … from '@/app'` re-export in `src/lib/`.
- **Drift signal:** a *second* lib→app edge would indicate erosion. Still one. No drift.
- Confidence: **High**.

### D2 — WI-09 color/HDR writer multiplicity: converging, NOT drifting — UNCHANGED
The color/HDR column set has **5 INSERT/UPDATE touchpoints** (the prompt's "upload path" folds two of these together):

| # | Path | Op | File:line |
|---|------|----|-----------|
| 1 | Browser upload | INSERT | `apps/web/src/app/actions/images.ts:350-358` |
| 2 | Lightroom PAT upload (US-P53) | INSERT | `apps/web/src/app/api/admin/lr/upload/route.ts:376-404` |
| 3 | Queue post-process | UPDATE | `apps/web/src/lib/image-queue.ts` (sets `was_downscaled`/`avif_10bit` + processed) |
| 4 | Admin backfill runner | UPDATE | `apps/web/src/lib/admin-backfill-runner.ts:559-568` (+ derivative-only `:596-597`) |
| 5 | Sidecar backfill script | UPDATE | `apps/web/scripts/backfill-color-pipeline.ts:370-380` (+ derivative-only `:388-389`) |

- **Backfill parity (the safety invariant):** writers #4 and #5 remain **byte-equivalent** on the 10-column success UPDATE — identical column set AND order: `pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit`. Both derivative-only fallbacks set exactly `was_downscaled, avif_10bit` with NO `pipeline_version` bump (the "no stale metadata stranded at current version" contract from Run-2 Cycle 1 AGG-01/02). **Still converging.**
- **INSERT parity:** writers #1 and #2 are column-parallel on the 8 color/HDR columns (`icc_profile_name, bit_depth, color_pipeline_decision, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, pipeline_version`). Writer #2 self-documents the parity intent (R8-H2, SEC-C3-01/02). Neither INSERT writes `was_downscaled`/`avif_10bit` — correct, since both set `processed: false` and those derivative columns are written later by writer #3.
- **No 4th writer was introduced.** Writer #2 (`lr/upload`) is NOT new this cycle — created at `79721bf4` (US-P53), last touched `f3d68197` (2026-06-11, before this cycle). `scripts/backfill-cicp-recheck.ts` matched the column grep but is **read-only** (self-documented "never writes to the DB or filesystem"; only SELECTs + logs flip counts) — it is a diagnostic, not a writer.
- **Latent risk (unchanged, deferred):** parity across writers #1/#2 (INSERT) and #4/#5 (UPDATE) is maintained by hand + comments + the `backfill-color-pipeline.test.ts` / `admin-backfill-runner-detection-failure.test.ts` contract tests, not by a shared writer function. This is the WI-09 consolidation that remains deferred. No action this cycle.
- Confidence: **High**.

### D3 — COLOR_IMPACTING_KEYS: 9 keys, matches CLAUDE.md — UNCHANGED
- **Evidence:** `apps/web/src/lib/settings-hash.ts:37-48` lists exactly 9 keys: 5 color (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) + 3 quality (`image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`) + 1 size (`image_sizes`).
- **CLAUDE.md is in sync:** line 263 reads "covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`)" and notes "AGG-R7-08 corrected the count from a stale 5". No doc drift. (The prompt's brief paraphrased the old 5-key summary; the committed CLAUDE.md is correct.)
- Still hand-maintained (not derived from `GalleryConfig`/`GALLERY_SETTING_KEYS`) — the deferred coupling. No action this cycle.
- Confidence: **High**.

### D4 — @/lib/storage dead seam: 390 LOC, unwired — UNCHANGED
- **Evidence:** `apps/web/src/lib/storage/{local.ts:139, types.ts:105, index.ts:146}` = 390 LOC total. Only `index.ts` references its siblings; **zero production importers** outside the module (`grep -rln "from '@/lib/storage'" src/ | grep -v __tests__` returns only `index.ts` itself).
- Self-documented internal abstraction; product is local-FS only. No action this cycle.
- Confidence: **High**.

---

## Boundary verification details (the valuable stability evidence)

### Server/client boundary
- `'use client'` files: **62**. Direct `@/db` imports among them: **0**. Direct `@/lib/data` imports among them: **2** (`home-client.tsx:13`, `load-more.tsx:6`) — both `import type { ImageListCursorInput }`, type-only, erased at compile. No runtime client→data-layer coupling.
- `server-only` markers in `src/`: **3** total — `__tests__/client-server-only-boundary.test.ts`, `__tests__/stubs/server-only.ts`, and exactly one production lib: `lib/caption-generator.ts`. That file is imported only by `lib/image-queue.ts` (server) + its test. NOT reachable from any client module.
- **Guard test `src/__tests__/client-server-only-boundary.test.ts` PASSES (2/2, 10s).** It walks every `'use client'` module's transitive `@/lib`/`@/db` static-import closure and asserts none contains `import 'server-only'`. This is a fast-loop pin (AGG-R5C3-21 / ARCH-R5C3-01) against the AGG-R5C2-02 regression class. Holding.
- Client→`@/app/actions` **value** imports (e.g. `image-manager.tsx:4`, `upload-dropzone.tsx:7`, `settings-client.tsx:10,25`) are server-action references — the App Router compiles these to network-RPC proxies, NOT bundled server code. This is the framework's intended client→server-action boundary, not a layering violation. Each action body carries `requireSameOriginAdmin()` + `isAdmin()` per the lint gates.

### Config-resolution chain
- `lib/gallery-config-shared.ts` — **pure leaf**: zero `import … from` statements, no `@/db`, no `server-only`, no reference to the resolution layer. Safe for client consumption (`settings-client.tsx`, `histogram.tsx`, `lightbox-color-pip.tsx`, `photo-viewer.tsx`, `search.tsx`, `home-client.tsx` all import it).
- `lib/gallery-config.ts` — server resolution: `gallery-config.ts:12 import { db, adminSettings } from '@/db'` and depends DOWN on shared (`:24-27`). Imported only by server contexts (server components, `actions/`, `api/`, server libs). No client component imports the resolution layer.
- Validation (shared) → resolution (server) → consumption (`image-queue.ts`, `process-image.ts`, `serve-upload.ts`, `admin-backfill-runner.ts`). No setting bypasses a layer; `image_sizes`/quality keys flow through `COLOR_IMPACTING_KEYS` into the ETag exactly as documented.

### PII / data-access boundary
- `lib/data.ts:208` `adminSelectFields` (full set incl. PII) → `:326` `publicSelectFields` derived by destructure-omission (`latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, `processed`, …). Separate object reference. Compile-time guards `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` enforce no sensitive key lands in the public set. Still the single source of truth — no query observed selecting color/PII columns directly into a public response.

---

## Recommendations

**None actionable this cycle.** The architecture is stable and near-converged. The four deferred items (D1–D4) are the known long-tail consolidation backlog; none drifted, and re-opening them now would be speculative refactor churn against a clean tree. Continue to rely on the existing pin tests:
- `client-server-only-boundary.test.ts` (client→server-only boundary)
- `backfill-color-pipeline.test.ts` + `admin-backfill-runner-detection-failure.test.ts` (WI-09 writer parity)
- `privacy-fields.test.ts` (`_PrivacySensitiveKeys` PII boundary)
- `check-api-auth` / `check-action-origin` lint gates (auth coupling on the app side)

If/when WI-09 is scheduled, the highest-leverage move is extracting writers #1/#2 (INSERT) and #4/#5 (UPDATE) to a single `writeColorColumns(values)` builder so parity is structural rather than test-enforced — but that is a deferred enhancement, not a cycle-7 risk.

---

## Trade-offs (WI-09 consolidation, when scheduled)

| Option | Pros | Cons |
|--------|------|------|
| **A. Keep 5 writers + contract tests (status quo)** | Zero churn on a clean tree; each path keeps its own transaction/error semantics (LR-upload's post-save catch window, queue's claim-UPDATE, backfill's detection-failure branch differ legitimately) | Parity is hand-maintained; a 6th ingest path could silently diverge before a test catches it |
| **B. Extract shared `buildColorColumnValues()` / `applyColorColumnUpdate()`** | Parity becomes structural, not test-enforced; one place to add a future color column | Touches 5 hot/transactional paths at once on a near-converged tree; the INSERT vs UPDATE vs derivative-only shapes don't fully unify (3 builders, not 1), so payoff is partial |

---

## References
- `apps/web/src/lib/api-auth.ts:1` — the sole lib→app inversion (`isAdmin` from `@/app/actions/auth`).
- `apps/web/src/app/actions/images.ts:350-358` — browser-upload color-column INSERT.
- `apps/web/src/app/api/admin/lr/upload/route.ts:376-404` — LR PAT-upload color-column INSERT (parallel writer #2, not new; `79721bf4`→`f3d68197`).
- `apps/web/src/lib/admin-backfill-runner.ts:559-568` / `:596-597` — backfill UPDATE + derivative-only fallback.
- `apps/web/scripts/backfill-color-pipeline.ts:370-380` / `:388-389` — sidecar UPDATE + derivative-only fallback (byte-equivalent to runner).
- `apps/web/scripts/backfill-cicp-recheck.ts:1-24` — read-only diagnostic (NOT a writer; matched grep but never writes).
- `apps/web/src/lib/settings-hash.ts:37-48` — `COLOR_IMPACTING_KEYS` (9 keys, matches CLAUDE.md:263).
- `apps/web/src/lib/gallery-config-shared.ts` — pure leaf (zero imports); `gallery-config.ts:12,24-27` — server resolution depending down on shared.
- `apps/web/src/lib/data.ts:208,326` — `adminSelectFields` → `publicSelectFields` derivation (PII boundary).
- `apps/web/src/lib/caption-generator.ts:1` — lone server-only lib; imported only by `image-queue.ts`.
- `apps/web/src/components/home-client.tsx:13`, `apps/web/src/components/load-more.tsx:6` — `import type` only of `ImageListCursorInput` (no runtime client→data coupling).
- `apps/web/src/__tests__/client-server-only-boundary.test.ts` — transitive client→server-only guard, PASSES 2/2.
- `apps/web/src/lib/storage/{local.ts,types.ts,index.ts}` — 390 LOC unwired dead seam (zero production importers).

# Architect Review — Cycle 8/100 (HEAD `9c40d261`, working tree clean)

**Reviewer:** architect agent (read-only context — `Write`/`Edit` disabled; persisted by orchestrator per the documented read-only-reviewer write-recovery pattern)
**Date:** 2026-06-14

**NO NEW architectural finding.** This loop is at convergence. One new NON-DEFECT observation recorded (ARC8-01) to stop the next cycle re-discovering it. All four prior architecture deferrals (AGG-C7-R1..R4) re-confirmed UNCHANGED by source-level re-count.

## Re-confirmed counts (evidence, measured live at `9c40d261`)

| Invariant | Measured | Status |
|---|---|---|
| lib→app inversions | **exactly 1** — `src/lib/api-auth.ts:1` (`isAdmin` from `@/app/actions/auth`); no cycle (`auth.ts` does not import `api-auth.ts`) | UNCHANGED (AGG-C7-R2) |
| `COLOR_IMPACTING_KEYS` | **9** verbatim at `settings-hash.ts:37-49` (5 color + 3 quality + `image_sizes`) | UNCHANGED (AGG-C7-R3). Brief's "5" was a stale snapshot |
| color-column writers | **5 touchpoints / 4 modules**: `actions/images.ts:352`, `api/admin/lr/upload/route.ts:376`, `admin-backfill-runner.ts` (×2 branches), `scripts/backfill-color-pipeline.ts` (×2). `image-queue.ts:369` writes **0** color cols (only `processed`/`pipeline_version`). `backfill-cicp-recheck.ts` = **read-only** (0 write statements) | UNCHANGED — no new writer module (AGG-C7-R1) |
| paired backfill writers | column sets match (7 color/HDR cols + `was_downscaled`/`avif_10bit`), contract-locked by `backfill-color-pipeline.test.ts` + `admin-backfill-runner-detection-failure.test.ts` | converging, NOT drifted |
| `@/lib/storage` dead seam | **390 LOC**, only importer is its own `index.ts` barrel | UNCHANGED (AGG-C7-R4) |
| lone `server-only` module | **`caption-generator.ts:19`** only (the other 4 grep hits are comment substrings; files documented client-safe); imported only by `image-queue.ts` + 2 tests | UNCHANGED |
| client→`@/db` direct import | **0** | UNCHANGED |
| god modules | `data.ts` 1649 / `process-image.ts` 1638 — pre-existing, no app-layer import from `data.ts` | no NEW god module |
| single-writer coordination state | no NEW module-scope mutable state assuming multi-instance; known process-local states unchanged | UNCHANGED |

## ARC8-01 (NEW observation — NON-DEFECT, High confidence)

`search.tsx:1` (`'use client'`) runtime-imports `SEMANTIC_TOP_K_DEFAULT` + `topK` from `@/lib/clip-embeddings`, a module that also exports `Buffer`-using functions (`embeddingToBuffer`/`bufferToEmbedding`, `clip-embeddings.ts:41-66`).

**Not a leak:** `search.tsx` imports only a numeric const and the pure `topK` (`:76-81`, no Buffer); ESM tree-shaking drops the Buffer functions; the module carries no `server-only` directive and no DB/Node top-level import; and the blocking `client-server-only-boundary.test.ts:153` transitive guard already catches the only forward risk (a future `server-only` added when the CLIP stub is productionized).

**Fix: none.** Optionally split `clip-embeddings-shared.ts` only when the real inference path lands — a no-op refactor today; recorded so it is not re-flagged as novel next cycle.

## Disposition

- **SCHEDULE: nothing.** No new architectural defect; ARC8-01 is a non-defect already guarded by an existing test.
- **DEFER (unchanged, do not re-escalate):** AGG-C7-R1 (WI-09 consolidation), AGG-C7-R2 (api-auth inversion), AGG-C7-R3 (`COLOR_IMPACTING_KEYS` hand-maintained), AGG-C7-R4 (storage dead seam).

**Trade-off (ARC8-01):** leave-as-is (recommended — zero churn, boundary test guards the regression) vs. pre-emptive shared-split (no-op churn at convergence, rejected per the "no manufactured refactors" directive).

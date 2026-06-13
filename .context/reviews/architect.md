# Architect Review — Cycle 9/100 (HEAD `0ce84b1b`, working tree clean)

**Reviewer:** architect agent (read-only context — `Write`/`Edit` disabled by design; returned inline for orchestrator persistence per the documented cycle-7/cycle-8 read-only-reviewer write-recovery pattern)
**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6 photo gallery)

## Summary

**ZERO new architectural findings.** The architecture axis has converged. Both cycle-8 schedulable items are now CLOSED in committed HEAD (`71ab0f41` landed the `generateBase56` distribution test = AGG-C8-01; `aa8a6f8a` fixed the `SCAN_ROOTS` doc = AGG-C8-02). The only commits since the cycle-8 baseline (`9c40d261..0ce84b1b`) are tests + docs + review/plan artifacts — **no production `.ts`/`.tsx` change and no new `src/` module**. All four prior architecture deferrals (AGG-C7-R1..R4) re-confirmed UNCHANGED by live source-level re-count. Recommendation: SCHEDULE nothing on the architecture axis.

## Analysis — module/dependency inventory (measured live at `0ce84b1b`)

| Invariant | Measured at HEAD | Status |
|---|---|---|
| lib→app inversions | **exactly 1** — `src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth`; broader sweep (relative paths + components/api targets) finds no other. No cycle: `auth.ts` does not import `api-auth.ts` | UNCHANGED (AGG-C7-R2) |
| `COLOR_IMPACTING_KEYS` | **9** verbatim at `settings-hash.ts:36-49` (5 color + 3 quality + `image_sizes`), hand-maintained `as const` array | UNCHANGED (AGG-C7-R3) |
| color-column WRITE fan-out | **4 row-write modules / 5 write touchpoints**: `actions/images.ts` (1), `api/admin/lr/upload/route.ts` (1), `admin-backfill-runner.ts` (2 branches: `:549` Drizzle `.set`, `:566` raw-SQL UPDATE), `scripts/backfill-color-pipeline.ts` (2 branches: `:218`, `:378`). Producer `process-image.ts:×2` computes the decision; the 4 call sites perform the row write | UNCHANGED (AGG-C7-R1) |
| `image-queue.ts` color writes | **0 writes** — `:625-628` is a SELECT projection and `:647-651` a read-passthrough object feeding `processImageFormats`; both are reads, not `.set()` writes | UNCHANGED (confirms cycle-8) |
| paired backfill writer column sets | match (7 color/HDR cols + `was_downscaled` + `avif_10bit`); contract-locked by `backfill-color-pipeline.test.ts` + `admin-backfill-runner-detection-failure.test.ts` | converging, NOT drifted |
| `@/lib/storage` dead seam | **390 LOC**; only external importer is a TEST (`src/__tests__/storage-local.test.ts:10`), **0 production importers** | UNCHANGED (AGG-C7-R4) |
| lone real `server-only` module | **`caption-generator.ts`** only (other grep hits are the boundary test + `__tests__/stubs/server-only.ts`); imported by `image-queue.ts` + 2 tests | UNCHANGED |
| client→`@/db` direct import | **0** | UNCHANGED |
| node-builtin (fs/crypto/sharp/mysql2/argon2) in `'use client'` | **0** real hits — the only match is `client-server-only-boundary.test.ts` itself (imports built-ins to assert their ABSENCE from client code) | UNCHANGED |
| god modules | `data.ts` **1649** / `process-image.ts` **1638** — identical to cycle-8; no app-layer import from `data.ts` | no NEW god module |
| single-writer process-local state | `restore_in_progress` advisory-lock maintenance signal via `getRestoreMaintenanceMessage` (`sharing.ts`, `tags.ts`, `admin-backfill.ts`, `admin-backfill-runner.ts:818`); queue singleton `enqueued: Set<number>` (`image-queue.ts:138,167`); upload limits are env-derived **constants** (`upload-limits.ts:15-16`), no mutable module-scope quota map | UNCHANGED — no NEW multi-instance-unsafe state |

### Boundary, layering, and cohesion assessment

- **Client/server boundary** is coherent and guarded. `client-server-only-boundary.test.ts` (190 lines) is the blocking transitive guard; the lone `server-only` directive sits on `caption-generator.ts`; no client component reaches `@/db` or a Node built-in. The data-access layer's public/admin select-field partition (`adminSelectFields` → `publicSelectFields` by omission, `_PrivacySensitiveKeys` / `_SensitiveKeysInPublic` compile-time guards) remains the canonical PII boundary and is intact.
- **Layering** is sound: exactly one lib→app inversion (`api-auth.ts → @/app/actions/auth`), acyclic and deliberate (the auth check lives in the action layer; api-auth re-exports it for route wrappers). No new edge.
- **Advisory-lock-as-coordination** design unchanged: the documented server-scoped locks (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`, etc.) remain the single-writer serialization mechanism. The documented caveat (server-scoped, not DB-scoped → run one GalleryKit per MySQL server) is still accurately reflected in CLAUDE.md.
- **Color-pipeline write fan-out** (R1) is the one genuine maintainability seam, and it is unchanged: the 4 row-write call sites still duplicate the same column set rather than funneling through a single writer helper. The two backfill paths are contract-locked by tests, so drift would be caught — this is why it remains a MED *maintainability* deferral, not a defect.

## Root Cause (of "no findings")

The repo reached its clean stop signal on the code/security/perf axes in cycle 8; cycle 9 added only the two scheduled cycle-8 closures (a test + a doc line) plus review artifacts. With no production source change since the baseline, there is no new surface for an architectural defect to appear on. The remaining structural seams (R1 fan-out, R4 dead storage barrel, R3 hand-maintained key list, R2 single inversion) are pre-existing, bounded, test-guarded or deliberately deferred behind the WI-09 / storage-integration lineage — none has changed.

## Recommendations

1. **SCHEDULE nothing on the architecture axis** — effort: none — impact: none. No new defect; the convergence stop signal holds for this axis.

## Trade-offs

| Option | Pros | Cons |
|---|---|---|
| A. Leave all four deferrals as-is (recommended) | Zero churn at convergence; R1 fan-out is test-locked, R4 seam is inert, R2/R3 are benign | The R1 4-site column-set duplication persists until WI-09 productionizes the HDR writer |
| B. Pre-emptively consolidate R1 color writers / split `clip-embeddings-shared.ts` (ARC8-01) | Removes the duplication seam early | Manufactured refactor at convergence with no triggering change; violates the "no speculative rewrites" directive; the boundary test already guards the only ARC8-01 forward risk |

## Re-confirmed deferrals (UNCHANGED — do NOT re-escalate)

- **AGG-C7-R1** — WI-09 color-pipeline writer consolidation: **5 write touchpoints / 4 row-write modules**, column-set-locked by 2 tests. MED maintainability. Lineage: plan-338/340/342/344. UNCHANGED.
- **AGG-C7-R2** — lib→app inversion = **exactly 1** (`api-auth.ts:1` `isAdmin` from `@/app/actions/auth`, acyclic). LOW. UNCHANGED.
- **AGG-C7-R3** — `COLOR_IMPACTING_KEYS` = **9** hand-maintained (`settings-hash.ts:36-49`). LOW. UNCHANGED.
- **AGG-C7-R4** — `@/lib/storage` = **390-LOC** dead seam (0 production importers; test-only). LOW. UNCHANGED.

## ARC8-01 (prior NON-DEFECT observation — re-confirmed, still NOT a finding)

`search.tsx` (`'use client'`) runtime-imports `SEMANTIC_TOP_K_DEFAULT` + the pure `topK` from `@/lib/clip-embeddings` (a module that also exports `Buffer`-using `embeddingToBuffer`/`bufferToEmbedding`). NOT a leak: only the numeric const + pure function are imported (ESM tree-shaking drops the Buffer fns), the module carries no `server-only` directive and no DB/Node top-level import, and `client-server-only-boundary.test.ts` already guards the only forward risk (a future `server-only` added when the CLIP stub is productionized). Fix: none.

## Note on `backfill-cicp-recheck.ts`

The cycle-8 aggregate listed `backfill-cicp-recheck.ts` as a "read-only (0 write statements)" color module. Live check: **the file does not exist at that path and git history is empty for it** — it never existed under git. This is immaterial to R1 (it wrote 0 columns regardless), so the R1 lineage is unaffected; flagging only so the inventory stays accurate.

## References

- `apps/web/src/lib/api-auth.ts:1` — the single lib→app inversion (`isAdmin` import); acyclic
- `apps/web/src/lib/settings-hash.ts:36-49` — `COLOR_IMPACTING_KEYS` 9-entry hand-maintained array
- `apps/web/src/lib/admin-backfill-runner.ts:549,566` — 2 of the 4 color-column write branches (R1)
- `apps/web/scripts/backfill-color-pipeline.ts:218,378` — the other 2 backfill color-column write branches (R1)
- `apps/web/src/lib/image-queue.ts:625-651` — color columns READ (SELECT projection + passthrough), 0 writes
- `apps/web/src/lib/storage/` — 390 LOC; only external importer `apps/web/src/__tests__/storage-local.test.ts:10` (R4 dead seam)
- `apps/web/src/__tests__/client-server-only-boundary.test.ts` — 190-line blocking client/server boundary guard
- `apps/web/src/lib/caption-generator.ts` — lone real `server-only` module
- `apps/web/src/lib/data.ts:1649` / `apps/web/src/lib/process-image.ts:1638` — god-module sizes, unchanged

---

**NEW genuine findings: 0.** Architecture axis converged. All four prior deferrals (AGG-C7-R1..R4) re-confirmed UNCHANGED with live line counts (R1: 5 touchpoints/4 modules; R2: 1 inversion; R3: 9 keys; R4: 390 LOC dead seam). Both cycle-8 schedulable items (AGG-C8-01/02) are CLOSED in committed HEAD.

# Architect Review — Cycle 6 (review-plan-fix)

**One-line summary:** Architecture STABLE at HEAD `4c3d5924` — 0 NEW coupling/layering/cohesion defects; cycle-5's sidecar refactor added 2 module-level exports + 1 exported type that are *justified test seams* (consumed only by the new test, narrowly scoped); the two backfill writer paths remain **byte-equivalent** on UPDATE column sets + `[]`-dir-scan cleanup (did NOT diverge, did NOT add a 4th color-writer); all four prior-deferred items (AGG-C5-R1/R2/R3/R4) **re-affirmed UNCHANGED** by authoritative re-scan.

---

## Summary

This is a convergence cycle. I authoritatively re-scanned (did not trust prior notes) for lib→app inversions, `@/db` importers, `server-only` markers, the `@/lib/storage` dead seam, and circular deps. Then I focused on the prompt's four specific concerns about the cycle-5 backfill changes: (1) new exports widening the API surface, (2) writer-path divergence the test could mask, (3) new lib→app / circular / private-internals reach, (4) a 4th color-column writer. **None of those risks materialized.** The cycle-5 work was test-hardening + a11y; its only structural footprint is two new exports on the sidecar that are a clean, minimal test seam, not API bloat.

## Analysis

### Cycle-5 commit set (6 commits, `07a838d6`..`4c3d5924`) — architectural footprint

`git diff --stat 07a838d6~1 4c3d5924` touched 10 files: 1 production-script (`scripts/backfill-color-pipeline.ts`, +60/-40), 3 tiny a11y className edits (timeline/home-client/topic-empty-state, 1 line each), 4 test files, 2 plan docs.

- `apps/web/src/lib/admin-backfill-runner.ts` — **UNTOUCHED** by cycle-5 (`git diff --stat 07a838d6~1 4c3d5924 -- ...admin-backfill-runner.ts` is empty). The in-app writer-path contract is therefore *definitionally* unchanged; any convergence/divergence could only come from the sidecar side, which I diffed below.

### Concern 1 — Did cycle-5 widen the API surface unnecessarily? PARTIALLY YES but JUSTIFIED (test seam, not bloat)

`apps/web/scripts/backfill-color-pipeline.ts` gained two module-level exports + one promoted type (the AGG-C5-01 fix, commits `300009d4`→`fad9c279`→`4c3d5924`):

- `apps/web/scripts/backfill-color-pipeline.ts:116` — `export type BatchFilenames` (was a local `type` inside `main()` before; promoted to module scope + exported).
- `apps/web/scripts/backfill-color-pipeline.ts:127` — `export async function cleanupDeletedMidReencodeVariants(files: BatchFilenames)` (extracted from the former in-`main` closure `cleanupDeletedMidReencode`).
- `apps/web/scripts/backfill-color-pipeline.ts:142` — `export function collectDeletedMidReencodeFiles(results)` (the new `affectedRows===0` partition helper).

Full export set at HEAD: `ImageRow` (64), `BatchFilenames` (116), `cleanupDeletedMidReencodeVariants` (127), `collectDeletedMidReencodeFiles` (142), `reprocessRow` (162). **Consumers:** only the test tree (`backfill-color-pipeline-deleted-mid-reencode.test.ts:48-52`, `backfill-color-pipeline.test.ts:20`, `backfill-detection-failure-contract.test.ts:41`) — no production code outside this script imports these symbols (verified by grep across `src/` + `scripts/`).

**Architectural risk assessment (coupling): LOW, and the right call.** This is a script, not a published library — it has no external API contract to protect, and the two new exports are the *minimum* surface needed to unit-test the freshly-landed `affectedRows===0` orphan-cleanup guard on the PRODUCTION re-encode path (per CLAUDE.md the prod container lacks `tsx`, so this sidecar IS how prod re-encodes). The prior cycle (AGG-C5-01) correctly flagged that this guard was code-only with zero coverage; extracting two pure-ish helpers (one is a 1-line `.filter().map()`, the other 3 `deleteImageVariants` calls) plus a `readFileSync` source-shape pin proving `flushBatch` wires them (`...deleted-mid-reencode.test.ts:124-148`) is the standard, low-coupling way the repo already tests un-reachable closures (same idiom as `image-queue-delete-race-cleanup-wiring.test.ts`). The alternative — exporting `flushBatch` itself or a DB-driving seam — would have widened the surface *more*. This is a net cohesion improvement: the delete-race decision is now a named, single-responsibility unit instead of buried inline.

### Concern 2 — Did the two backfill writer paths DIVERGE? NO — byte-equivalent, re-diffed at HEAD

I extracted both paths' UPDATE SQL directly (not via the test, which could mask drift):

**Full-success UPDATE — 10 columns, IDENTICAL column set AND order on both paths:**
`pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit`
- Sidecar: `apps/web/scripts/backfill-color-pipeline.ts:369-381`
- Runner: `apps/web/src/lib/admin-backfill-runner.ts:558-568`

**Detection-failure (derivative-only) UPDATE — 2 columns, IDENTICAL on both:** `was_downscaled, avif_10bit`
- Sidecar: `apps/web/scripts/backfill-color-pipeline.ts:387-391`
- Runner: `apps/web/src/lib/admin-backfill-runner.ts:595-598`

**Cleanup contract — IDENTICAL body on both:** `deleteImageVariants(UPLOAD_DIR_WEBP/AVIF/JPEG, fn, [])` (the `[]` full-dir-scan form).
- Sidecar: `apps/web/scripts/backfill-color-pipeline.ts:128-132`
- Runner: `apps/web/src/lib/admin-backfill-runner.ts:430-435`

**The one structural difference is PRE-EXISTING, not a cycle-5 divergence:** the runner cleans up *inline per-row* inside the transaction loop (`admin-backfill-runner.ts:573-575, 605-607`), while the sidecar partitions + cleans up *post-commit* in a batch (`backfill-color-pipeline.ts:393-406`). This asymmetry is inherent to the two designs — the sidecar batches its UPDATEs (the `flushBatch` was introduced by `300009d4`, before cycle-5) and MUST defer unlink past commit so a best-effort unlink error cannot roll back legitimate sibling-row UPDATEs in the same batch; the runner does not batch, so per-row inline cleanup is correct there. The detection-failure semantics (no `pipeline_version` bump on the derivative-only branch, so a later run retries detection) match on both. **The test does NOT mask a divergence — I confirmed equivalence at the source, independent of the test.** AGG-C5-R1's framing holds: the duplication is B↔C (~120 LOC, parallel private/public `cleanupDeletedMidReencodeVariants` bodies), CONVERGING.

### Concern 3 — NEW lib→app import / circular dep / private-internals reach? NONE

- **lib→app:** authoritative scan (`grep -rn "from '@/app" apps/web/src/lib/` + the `../app` relative form) finds **exactly one** hit: `apps/web/src/lib/api-auth.ts:1` `import { isAdmin } from '@/app/actions/auth'`. No cycle. UNCHANGED vs AGG-C5-R2.
- **New test imports — zero internals reach:** `i18n-key-parity.test.ts:24-25` imports only `messages/en.json` + `ko.json` (public data); `image-queue-delete-race-cleanup-wiring.test.ts:30` is a pure `readFileSync` source-shape pin (imports no app symbols at all); `touch-target-audit.test.ts` is a self-contained regex fixture; `backfill-color-pipeline-deleted-mid-reencode.test.ts` imports only the two *intentionally-exported* test-seam helpers + `UPLOAD_DIR_*` from `@/lib/upload-paths` (already-public). No test reaches a private internal via an over-broad export.
- **Circular dep:** the two new sidecar helpers import only `deleteImageVariants` (from `@/lib/process-image`) and `UPLOAD_DIR_*` (from `@/lib/upload-paths`) — both pre-existing leaf imports, no new edge into the dependency graph.

### Concern 4 — A 4th color-column writer? NO

Color/derivative columns are written in exactly the three documented places, unchanged: (B) sidecar `flushBatch` UPDATE, (C) runner `processCandidate` UPDATE, and the upload path which SPLITS the concern (color cols at INSERT in `images.ts`, derivative flags at the queue UPDATE in `image-queue.ts`). Cycle-5 added no new writer — it only extracted B's cleanup decision into helpers. The `applyColorPipelineResult()` consolidation (WI-09) remains the correct deferral.

### Prior-deferred items — authoritative re-scan results

| Item | Prior state | HEAD `4c3d5924` re-scan | Verdict |
|---|---|---|---|
| AGG-C5-R1 color-writer duplication converging | byte-equiv 10-col + `[]` cleanup + detection-failure semantics | UPDATE sets + cleanup re-diffed byte-equivalent; runner untouched; no 4th writer | **UNCHANGED (re-affirmed open, DEFER WI-09)** |
| AGG-C5-R2 sole lib→app inversion | 1 (`api-auth.ts:1`) | exactly 1, no cycle | **UNCHANGED** |
| AGG-C5-R3 `COLOR_IMPACTING_KEYS` hand-maintained; 14 `@/db` libs, 1 `server-only` | 9 keys; 14; caption-generator only | 9 keys (`settings-hash.ts:37-49`: 5 color + 3 quality + 1 size); `@/db` importers = **14** (identical set); only `caption-generator.ts` carries `import 'server-only'` | **UNCHANGED** |
| AGG-C5-R4 `@/lib/storage` dead seam | 390 LOC, only index + 1 test | 390 LOC; consumers = `storage/index.ts` + `storage-local.test.ts` only | **UNCHANGED** |

## Root Cause

There is no defect to root-cause this cycle. The structural question the prompt raised — "could the AGG-C5-01 test extraction have widened the API surface or masked a writer divergence?" — resolves to: the extraction is a correctly-scoped test seam on a script (no library contract), and the writer paths are equivalent at the source independent of the test. The underlying *latent* maintainability item (B↔C parallel `cleanupDeletedMidReencodeVariants` bodies) is the same AGG-C5-R1 duplication, now with one of the two copies promoted to module scope — which, if anything, makes a future WI-09 consolidation marginally easier (the sidecar half is now a named export a shared module could absorb).

## Recommendations

1. **No action required this cycle (architecture stable).** — zero effort — accept convergence. The 2 new exports are justified; the writer paths are equivalent; all prior-deferred items unchanged.
2. **(Optional, DEFER — bundle into WI-09) Note the now-asymmetric `cleanupDeletedMidReencodeVariants` visibility for the eventual consolidation.** The runner's copy (`admin-backfill-runner.ts:430`, private, `CandidateRow`) and the sidecar's (`backfill-color-pipeline.ts:127`, exported, `BatchFilenames`) are byte-identical in body but differ in signature shape and visibility. When `applyColorPipelineResult()` lands, it can also unify these two into one shared `cleanupDeletedMidReencodeVariants({webp,avif,jpeg})` helper. — low effort when WI-09 runs — low impact (correctness already locked by tests on both paths). **DEFER; do not schedule standalone.**

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| A. Accept the 2 new sidecar exports (status quo) | Minimal, well-documented test seam; pins the prod-path orphan-cleanup guard that was previously uncovered; lowest-coupling way to test an in-`main` closure | Slightly widens a script's module surface (2 fns + 1 type) reachable in principle by future non-test importers — negligible for a script with no API contract |
| B. Consolidate B↔C cleanup into one shared module now | Removes the parallel byte-identical bodies; single source of truth | Premature — couples to the larger WI-09 refactor, expands blast radius beyond this cycle's converged scope; the duplication is correct and test-anchored, so this is a maintainability investment not a fix |

## Consensus Addendum (architecture stability assessment)

- **Antithesis (steelman against "stable, no action"):** "Promoting a closure to two new exports purely to test it is the camel's nose — the script's surface now leaks an internal partition helper, and the next agent will import `collectDeletedMidReencodeFiles` from production code, cementing the sidecar as a de-facto library." — **Rebuttal:** verified no production importer exists; the helper is a 1-line `.filter().map()` with a single test consumer; and the repo's documented honesty rule already treats this script as the canonical prod backfill entry point, so its symbols being reachable is expected, not accidental. The risk is real but LOW and bounded by the existing lint/test gates.
- **Tradeoff tension:** test-coverage-of-a-prod-correctness-guard (high value, AGG-C5-01 was a legitimately-uncovered guard on the path prod actually uses) vs. encapsulation-of-a-script-internal (low cost here). The cycle correctly resolved in favor of coverage; the residual encapsulation cost is the kind WI-09 absorbs for free.
- **Synthesis:** keep the exports; fold both `cleanupDeletedMidReencodeVariants` copies into the WI-09 shared `applyColorPipelineResult()`/cleanup module when that lands, at which point the export becomes an internal of the shared module and the surface narrows again.

## References

- `apps/web/scripts/backfill-color-pipeline.ts:116` — `export type BatchFilenames` (promoted from local type this cycle)
- `apps/web/scripts/backfill-color-pipeline.ts:127` — `export async function cleanupDeletedMidReencodeVariants` (new test-seam export; body identical to runner's)
- `apps/web/scripts/backfill-color-pipeline.ts:142` — `export function collectDeletedMidReencodeFiles` (new `affectedRows===0` partition helper)
- `apps/web/scripts/backfill-color-pipeline.ts:369-391` — sidecar full-success (10-col) + derivative-only (2-col) UPDATE SQL
- `apps/web/scripts/backfill-color-pipeline.ts:393-406` — post-commit batch cleanup (deferred unlink for batch-tx integrity)
- `apps/web/src/lib/admin-backfill-runner.ts:430-435` — runner's private `cleanupDeletedMidReencodeVariants` (byte-identical body, `CandidateRow` signature)
- `apps/web/src/lib/admin-backfill-runner.ts:558-568` / `595-598` — runner full-success / derivative-only UPDATE SQL (column-set match to sidecar)
- `apps/web/src/lib/admin-backfill-runner.ts:573-575,605-607` — runner per-row inline cleanup (pre-existing batch-vs-row asymmetry, not a divergence)
- `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:48-52` — new test imports only the 2 intentional seams + `BatchFilenames`; `:124-148` source-shape pin that `flushBatch` wires them
- `apps/web/src/lib/api-auth.ts:1` — the SOLE lib→app inversion (`isAdmin` from `@/app/actions/auth`), unchanged, no cycle
- `apps/web/src/lib/settings-hash.ts:37-49` — `COLOR_IMPACTING_KEYS` hand-maintained, 9 keys (5 color + 3 quality + 1 size), unchanged
- `apps/web/src/lib/storage/index.ts` + `apps/web/src/__tests__/storage-local.test.ts` — the only two consumers of the 390-LOC `@/lib/storage` dead seam, unchanged
- `apps/web/src/__tests__/i18n-key-parity.test.ts:24-25` / `image-queue-delete-race-cleanup-wiring.test.ts:30` — new tests; zero internals reach (JSON data + `readFileSync` source pin)

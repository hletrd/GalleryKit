# Architectural-Risk Review — GalleryKit

**HEAD:** `1dde9b1e` · **Date:** 2026-06-13 · **Angle:** coupling / layering / abstraction-leak / module-boundary integrity / cost-of-duplication
**Working tree:** CLEAN · all 6 gates GREEN (per prior aggregate; not re-run here — pure arch read)
**Cycle:** 5 (review-plan-fix). Prior aggregate = cycle 4 @ `ce0029aa`. This is a FRESH pass against the 6 cycle-5 commits (`40a65aef`..`1dde9b1e`).

---

## Summary

The cycle-4 scheduled batch landed cleanly and — critically for my angle — **the triplicated color-pipeline writer is CONVERGING, not drifting.** All three writers now carry the `affectedRows===0 → cleanup` guard, the two backfill writers now have byte-identical 10-column UPDATE sets, identical `[]`-dir-scan cleanup contracts, and identical detection-failure semantics, cross-anchored by "mirrors X" comments and (as of `2251b122`) symmetric tests on BOTH cleanup branches. **The recent fixes added ZERO new coupling**: no new `lib→app` import, no new circular dep, no test reaching into private internals, no new `@/db`-importing lib. Every known/deferred arch item is re-affirmed at its prior severity. **No net-new architectural defect this cycle.** Honest convergence on the arch axis is reached.

The one nuance worth recording: the prior aggregate's "triplicated" framing is imprecise — the operation is **duplicated across the two BACKFILL paths**, while the upload path implements a *split* of the same concern (color columns at INSERT in the action, derivative flags at UPDATE in the queue). This sharpens the refactor target and is documented below.

---

## Analysis

### 1. The color-pipeline writer — converging duplication (re-affirmed, sharpened)

I diffed the three writers line-by-line at current HEAD.

**Writer A — upload path (SPLIT, not a third copy of the backfill writer):**
- `app/actions/images.ts:340-360` — on upload, color detection runs in the action; the **full color column set is written at INSERT time** from `data.colorSignals` / `data.colorPipelineDecision`.
- `lib/image-queue.ts:368-371` — the post-processing queue UPDATE writes ONLY `processed`, `pipeline_version`, `was_downscaled`, `avif_10bit`, `processing_error`, `failed_at`. It does NOT re-run `detectColorSignals` and does NOT touch the 7 color columns.
- Delete-mid-processing cleanup at `image-queue.ts:372-387` now passes `[]` (AGG-C4-04, commit `18de78eb`) → full dir scan.

**Writer B — in-app backfill runner** (`lib/admin-backfill-runner.ts:442-615`):
- Re-runs `processImageFormats` + `detectColorSignals` + `resolveColorPipelineDecision`, then writes the **10-column set** (`pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`).
- Two UPDATE branches (success `:557-577`, detection-failure `:594-609`), each guarding `affectedRows===0 → cleanupDeletedMidReencodeVariants(row)` which calls `deleteImageVariants(dir, fn, [])`.

**Writer C — sidecar backfill script** (`scripts/backfill-color-pipeline.ts`):
- Same imports (`processImageFormats`, `detectColorSignals`, `resolveColorPipelineDecision`, `deleteImageVariants`, `IMAGE_PIPELINE_VERSION` — from `../src/lib/...`).
- `ReprocessSignals` interface (`:75-90`) is **field-identical** to the runner's inline signals shape + `was_downscaled` + `avif_10bit`.
- `flushBatch` (`:336-392`) writes the same 10-column set in a batched transaction; the `affectedRows===0` rows are collected and cleaned via `cleanupDeletedMidReencode(files)` → `deleteImageVariants(dir, fn, [])`, run AFTER commit (correct — a unlink error can't roll back sibling updates).
- Detection-failure branch (`derivativeBatch`, `:366-376`) writes exactly `was_downscaled` + `avif_10bit`, mirroring the runner.

**Quantified duplication at HEAD:**

| Shared concern | Writer A (upload) | Writer B (runner) | Writer C (sidecar) |
|---|---|---|---|
| 10-column color UPDATE | split (INSERT in action) | yes `:557-570` | yes `:340-352` |
| `detectColorSignals` + `resolveColorPipelineDecision` | in action (pre-enqueue) | yes `:541-549` | yes `:174-175` |
| `affectedRows===0 → []`-dir-scan cleanup | yes (2-format set) | yes (both branches) | yes (both branches) |
| detection-failure = derivative-only, NO version bump | n/a | yes `:594-609` | yes `:366-376` |

- **Duplicated LOC:** the B↔C overlap is ~120 LOC each (the encode→detect→resolve→write-10-cols→cleanup sequence). The two are now **semantically identical** on every column and every cleanup path.
- **Shared concerns coupled by comment, not by type:** 4 (column list, detection call, cleanup contract, detection-failure semantics). The coupling mechanism is still **textual "mirrors admin-backfill-runner.ts:268-273" comments** — there is no shared `applyColorPipelineResult()` function and no shared column-list constant. A drift in one is caught only if a reviewer reads both, or if a cross-site test happens to exercise the divergent column.

**Drift direction: CONVERGING.** Cycle 4 closed the two divergences that the duplication had *already produced* (sidecar missing cleanup = AGG-C4-02; upload-worker wrong sizes arg = AGG-C4-04). Cycle 5 closed the *test* asymmetry (AGG-C4-05, the runner's second cleanup branch was untested). The two backfill writers are now as close as they have ever been. The structural risk is unchanged: **the next column added to the color set must be hand-applied in three places** (action INSERT + runner UPDATE x2 + sidecar UPDATE x2), and only the `backfill-color-pipeline.test.ts` (column set) + the new `admin-backfill-runner-deleted-mid-reencode*.test.ts` pins guard against omission. The `applyColorPipelineResult()` extraction is **still the right call**, and the WI-09 deferral is **still justified** — the duplication is now correct and well-anchored; the consolidation is a maintainability investment, not a correctness fix. Re-affirmed: **DEFER to WI-09** (status: open, unchanged from AGG-C4-R1).

### 2. lib→app layering inversion (re-affirmed open, unchanged)

Authoritative scan at HEAD: `grep -rn "from '@/app'" src/lib/` returns **exactly one** hit — `lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth`. This is the SOLE lib→app inversion. `api-auth.ts` is consumed by 2 admin route handlers (`lr/upload`, `db/download`) + its own test; no cycle. No recent fix touched it. Status: **open, DEFER** (AGG-C4-R2, plan-338, unchanged). Exit criteria (a second inversion, or a need to consume `api-auth` from `lib`) remain unmet.

### 3. server-only boundary (re-affirmed enforced; no new leak)

- `@/db`-importing libs at HEAD: **14** (matches CLAUDE.md). Full list: `admin-backfill-runner`, `admin-tokens`, `analytics-data`, `audit`, `data-timeline`, `data`, `gallery-config`, `image-queue`, `rate-limit`, `session`, `settings-hash`, `smart-collections`, `tag-records`, `upload-processing-contract-lock`.
- Only **`caption-generator.ts:19`** carries `import 'server-only'` — unchanged.
- **No NEW lib started importing `@/db` this cycle** (the cycle-5 churn touched `image-queue.ts` cleanup args only, no new import).
- The boundary test (`__tests__/client-server-only-boundary.test.ts`) is **still enforcing and non-vacuous**: it walks every `'use client'` module's transitive `@/lib`/`@/db` static-import closure and asserts none reaches a `server-only` file, with a `clientFiles.length > 0` anti-vacuity guard (`:161`) and a specific `photo-title.ts` regression pin (`:181-189`). It tests the *direction that actually breaks the build* (client→server-only), which is the correct invariant — the 14 db-libs being server-only-by-docstring rather than by `import 'server-only'` is a hardening gap, not a live defect, because nothing client-side imports them. Status: **DEFER** (AGG-C4-R3, unchanged). Adding `import 'server-only'` to the other 13 would convert a silent build-break-on-misuse into a clearer one, but is not load-bearing today.

### 4. @/lib/storage dead seam (re-affirmed RECORD-only, unchanged)

`src/lib/storage/` is **390 LOC**; the only consumer outside the dir is its own test (`__tests__/storage-local.test.ts`). No production code path imports it. CLAUDE.md self-documents it as unwired ("Storage Backend (Not Yet Integrated)"). No change this cycle. Status: **RECORD** (AGG-C4-R4). Interface-rot risk persists: the seam's `StorageBackend` interface has never been validated against the real `fs` call sites in `image-queue.ts` / `process-image.ts` / `serve-upload.ts`, so wiring an S3 backend later risks an interface that doesn't match how the fs is actually used (atomic-rename contract, dir-scan deletes, `lstat` symlink rejection). Not a defect — a future-cost note.

### 5. COLOR_IMPACTING_KEYS hand-maintained (re-affirmed open; doc is CORRECT)

`settings-hash.ts:37-49` — `COLOR_IMPACTING_KEYS` is now **9 keys** (5 color + 3 quality + 1 sizes), still a hand-maintained `as const` array NOT derived from `GalleryConfig`. CLAUDE.md:263 correctly says "**9**" with the right line range (`:37-49`) — AGG-R7-08 fixed the count, and I confirm the doc and code agree at HEAD (I initially suspected a stale "5" but the doc is accurate). The architectural risk is unchanged: a new color/quality/size-impacting `GalleryConfig` key added without a corresponding `COLOR_IMPACTING_KEYS` entry silently fails to invalidate cached variants on the serve-upload path. Status: **DEFER** (AGG-C4-R3). A type-level "exhaustive subset of GalleryConfig keys" guard would close it.

### 6. Coupling-deepening check on the cycle-5 fixes (NONE found)

I audited each of the 6 cycle-5 commits for new coupling:

| Commit | File(s) | New coupling introduced? |
|---|---|---|
| `40a65aef` (touch-target regex) | `touch-target-audit.test.ts` | No — self-contained regex + self-check assertions. |
| `300009d4` (sidecar cleanup) | `scripts/backfill-color-pipeline.ts` | No — REDUCES divergence; uses already-imported `deleteImageVariants`. |
| `fd708c1e` (sales badge a11y) | `sales-client.tsx` | No — CSS token only. |
| `18de78eb` (queue dir-scan) | `image-queue.ts` | No — changed a 2-arg `deleteImageVariants` call to 3-arg `[]`; no new import. |
| `2251b122` (runner 2nd-branch test) | new `admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` (226 LOC) | No — imports the public runner surface + the documented `_resetAdminBackfillStateForTesting` test hook; does NOT reach into private internals via deep relative paths. |
| `1dde9b1e` (doc honesty) | CLAUDE.md, `(public)/page.tsx`, `p/[id]/page.tsx` | No — comments only. |

The new test uses the module-owned `_resetAdminBackfillStateForTesting()` hook (`admin-backfill-runner.ts:261`) rather than poking the `Symbol.for(...)` global directly — this is the *correct* test-coupling posture (the prior AGG-R5C3-22 fix routed reset through the owning module precisely to avoid field-list drift). No test-into-implementation reach-in introduced.

---

## Root Cause

There is **no net-new architectural root cause this cycle.** The pre-existing root cause — the color-pipeline write operation living in three hand-synchronized sites coupled by comments rather than a shared abstraction — is **unchanged and now fully convergent** (all known divergences closed). The cycle-5 fixes were symptom-level (cleanup guards, test depth, a11y, docs) and correctly did NOT attempt the WI-09 consolidation, keeping authoring and refactor as separate passes.

---

## Recommendations

1. **DEFER `applyColorPipelineResult()` extraction to WI-09** — low urgency, low impact today, MED maintainability payoff. The duplication is correct and anchored; consolidate when WI-09 (HDR encoder) forces a touch to all three sites anyway. Extract: (a) the 10-column UPDATE as a single writer taking `(id, signals, derivativeFlags)`, (b) the `affectedRows===0 → []`-dir-scan cleanup as one shared helper, (c) ideally a shared `COLOR_PIPELINE_COLUMNS` const so the column list has one definition. Anchor with one cross-site test asserting all three writers persist the identical column set. Trade-off: the sidecar imports from `../src/lib` and runs under `tsx` with full source mounts, so the shared writer must not pull in anything that breaks the standalone script's import graph (it already shares `process-image` / `color-detection`, so this is safe).
2. **DEFER the 13 missing `import 'server-only'` markers to the WI-09 hardening pass** — LOW. Convert silent-build-break-on-misuse to explicit. Trade-off: each marker is a one-line add but must be verified not to break any test that imports the lib in a non-server context (vitest stubs `server-only` via `__tests__/stubs/server-only.ts`, so this is low-risk).
3. **RECORD the `COLOR_IMPACTING_KEYS` exhaustiveness gap** — LOW. A `satisfies readonly (keyof GalleryConfig)[]` is already implicitly true; the real gap is *completeness* (a new key omitted), which a type can't catch without an explicit "color-impacting" marker on `GalleryConfig` fields. Defer unless a missed-invalidation bug materializes.
4. **RECORD `@/lib/storage` interface-rot** — LOW. When storage backends are wired, validate the `StorageBackend` interface against the real fs call sites (atomic-rename, dir-scan delete, symlink rejection) BEFORE migrating any writer.

---

## Trade-offs

| Option (for the color-writer duplication) | Pros | Cons |
|---|---|---|
| **A. Keep 3 hand-synced writers (status quo)** | Zero refactor risk now; each site reads top-to-bottom; sidecar's standalone import graph stays simple | A new color column = 5 edit sites; correctness rests on comments + 2 test pins; already produced 2 historical divergences |
| **B. Extract `applyColorPipelineResult()` now** | One column-list definition; one cleanup contract; drift becomes a compile error | Touches all 3 hot paths in a convergence cycle (churn risk); sidecar import-graph constraint; no live defect to justify the risk |
| **C. Defer to WI-09 (recommended)** | Consolidate when HDR work forces the touch anyway; current duplication is correct + anchored | Duplication persists one more milestone; relies on the 2 test pins holding until then |

---

## References

- `apps/web/src/lib/admin-backfill-runner.ts:557-577` / `:594-609` — Writer B, both UPDATE branches with `affectedRows===0 → cleanupDeletedMidReencodeVariants` (the `[]`-dir-scan cleanup at `:430-440`).
- `apps/web/scripts/backfill-color-pipeline.ts:75-90` — Writer C `ReprocessSignals`, field-identical to Writer B's inline shape; `:336-392` `flushBatch` with post-commit cleanup; `:326-334` `cleanupDeletedMidReencode` (`[]` dir-scan).
- `apps/web/src/lib/image-queue.ts:368-371` (queue UPDATE — derivative flags only) + `:372-387` (delete-mid-processing cleanup, now `[]` per AGG-C4-04).
- `apps/web/src/app/actions/images.ts:340-360` — Writer A, color columns written at INSERT (the "split" that makes this NOT a third copy of the backfill writer).
- `apps/web/src/lib/api-auth.ts:1` — the SOLE lib→app inversion (`isAdmin` from `@/app/actions/auth`).
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:152-189` — the enforcing, non-vacuous client→server-only boundary test.
- `apps/web/src/lib/caption-generator.ts:19` — the ONLY lib with `import 'server-only'`.
- `apps/web/src/lib/settings-hash.ts:37-49` — `COLOR_IMPACTING_KEYS` (9 keys, hand-maintained); CLAUDE.md:263 cite is correct.
- `apps/web/src/lib/storage/` — 390 LOC dead seam; only `__tests__/storage-local.test.ts` consumes it outside the dir.
- `apps/web/src/__tests__/admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` — new cycle-5 test (commit `2251b122`) closing AGG-C4-05; uses the `_resetAdminBackfillStateForTesting` hook, no private reach-in.

---

## Known/Deferred Item Status Lines (re-affirmed at HEAD `1dde9b1e`)

- **AGG-C4-R1 — triplicated color writer:** re-affirmed OPEN. Duplication is **converging, not drifting** (B↔C now byte-identical column sets + cleanup + detection-failure semantics). `applyColorPipelineResult()` still the right call; WI-09 deferral still justified. No new divergence.
- **AGG-C4-R2 — lib→app inversion (`api-auth.ts`):** re-affirmed OPEN, exactly 1 site, no cycle, unchanged. DEFER.
- **AGG-C4-R3 — COLOR_IMPACTING_KEYS hand-maintained + 13/14 db-libs lack `import 'server-only'`:** re-affirmed OPEN. Boundary test still enforcing. DEFER.
- **AGG-C4-R4 — `@/lib/storage` dead seam (390 LOC):** re-affirmed RECORD-only, unchanged, honestly self-documented.

---

NET-NEW ARCH FINDINGS THIS CYCLE: 0

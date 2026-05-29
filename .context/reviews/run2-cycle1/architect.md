# Architect Review — Run-2 Cycle 1 (HEAD eaee58dc)

Scope: recently-landed code (R27/R28/R29 surfaces) + cross-file contracts. Faithful-delivery photo surface — no feature/rewrite proposals.

## ARCH-01 — Backfill contract drift: operator script does NOT persist `avif_10bit`; in-app runner DOES (MED, High confidence)

**Files:**
- `apps/web/scripts/backfill-color-pipeline.ts` — `reprocessRow` (lines 96-158) returns a `ReprocessSignals` shape WITHOUT `avif_10bit`, and `flushBatch` (lines 262-283) UPDATEs `was_downscaled` + color columns but NEVER `avif_10bit`.
- `apps/web/src/lib/admin-backfill-runner.ts` — `reprocessOne` (lines 171-264) captures `avif10bit` from `processImageFormats` and UPDATEs `avif_10bit = ${avif10bit}` (line 250, and line 260 in the detection-failed branch).
- `apps/web/src/lib/image-queue.ts:368` — the normal upload path also writes `avif_10bit`.
- `apps/web/src/db/schema.ts:112` — `avif_10bit` is a real nullable boolean column.
- `apps/web/src/lib/data.ts:252-254` — `avif_10bit` is **public** ("describes the encoded output… public-safe") and surfaces in the delivered-bit-depth chip / Color Details audit.

**Why it's a problem:** `IMAGE_PIPELINE_VERSION = 7`. When an operator runs the sidecar script `backfill-color-pipeline.ts` to re-encode photos, the AVIF derivative is regenerated and its actual 10-bit-vs-8-bit status may change (e.g. a wide-gamut photo that previously fell back to 8-bit now encodes 10-bit after a libheif/effort change, or vice versa). The script advances `pipeline_version` to 7 and refreshes every color column EXCEPT `avif_10bit`, leaving it stale. Because `avif_10bit` is a **public** field, the stale value is shown to end users in the delivered-bit-depth chip. The two backfill paths (script vs in-app runner) now produce DIVERGENT DB state for the same input — the in-app runner is correct, the script is stale. This is silent data inconsistency: an operator who runs the documented sidecar pattern (CLAUDE.md "Backfill" section) gets a different, wrong result than the in-app button.

**Failure scenario:** Photo #42 was encoded at pipeline v6 as 8-bit AVIF (`avif_10bit = false`). A libheif upgrade + `avif_effort` bump makes the v7 re-encode produce a 10-bit AVIF. Operator runs the sidecar script (the CLAUDE.md-documented prod path). Script regenerates the 10-bit AVIF on disk and sets `pipeline_version = 7` but leaves `avif_10bit = false`. The Color Details audit + delivered-bit-depth chip now claim 8-bit for a file that is actually 10-bit. The in-app runner button would have set it to `true`.

**Fix:** Add `avif_10bit` to the script's `ReprocessSignals` interface and `flushBatch` UPDATE, capturing `result.avif10bit` from `processImageFormats` exactly as the runner does. Unify the persisted column set between the two implementations (consider extracting the UPDATE column list / signals shape into one shared helper so they can't drift again — the existing `backfill-color-pipeline.test.ts` should then assert the column set).

## ARCH-02 — Two parallel backfill implementations with no shared core (LOW, High confidence)

**Files:** `apps/web/scripts/backfill-color-pipeline.ts` and `apps/web/src/lib/admin-backfill-runner.ts`.

**Why it's a problem:** Both implement: resolve original path → fs.access → processImageFormats → re-detect signals → UPDATE. They are ~80% identical but diverge in (a) the persisted column set (ARCH-01), (b) lock-acquisition timeout (script `GET_LOCK(?, 10)` blocking; runner `GET_LOCK(?, 0)` non-blocking — intentional), (c) batched-transaction UPDATE (script) vs per-row UPDATE (runner), (d) error/skip accounting. ARCH-01 is the first concrete drift; more will accrue. The `reprocessRow` function in the script is already exported "for unit tests" — it's a natural seam to share.

**Fix (minimal, not a rewrite):** Extract the single-row reprocess+signals logic and the canonical UPDATE column set into one module imported by both. Defer if the team prefers; ARCH-01 must be fixed regardless.

## ARCH-03 — Process-local `globalThis` backfill state is correct for single-writer topology but undocumented as a constraint (LOW, Medium confidence)

**File:** `apps/web/src/lib/admin-backfill-runner.ts:83-114` (`adminBackfillStateKey` Symbol-keyed `globalThis` state).

**Why:** The `running` flag, `completedRuns`, `lastError` live in process memory. The MySQL advisory lock is the cross-process serializer, but `readAdminBackfillState()` (surfaced by `getBackfillStatus`) reflects ONLY the local process. CLAUDE.md already documents "single web-instance / single-writer topology… do not horizontally scale… process-local" state — this runner's state is consistent with that note, so this is informational, not a defect. If the deployment ever scales horizontally, the status UI would under-report a backfill running on another instance (the advisory lock would still correctly serialize the work). No action required while single-instance; verifier/doc note only.

## Clean surfaces (audited, no findings)
- `analytics-data.ts` query layer is consistent with the rest of `data.ts`; alias-ordering pattern (`orderBy(desc(sql\`viewCount\`))`) matches the existing working queries.
- Layering server-action → runner → process-image is clean; the runner does not reach improperly across layers.
- forceSrgbDerivatives wiring (share routes → Lightbox → children) passes an admin *config* boolean, not an admin-only image field; no layering violation.

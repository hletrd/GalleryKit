# Code Reviewer — Deep Review (Cycle 6 / review-plan-fix)

**Summary: 0 NEW actionable findings.** The repo is genuinely converged at HEAD `4c3d5924` (working tree CLEAN, verified). Every cycle-5 fix (AGG-C5-01..03, AGG-C5-T1/T2, AGG-C5-02) landed correctly, is present in code, and is pinned by non-vacuous tests. No regression of any prior-closed finding. No new logic, error-handling, SOLID, maintainability, or type-safety defect surfaced from my angle.

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**Angle:** code quality, logic correctness, SOLID, maintainability.
**Scope reviewed:** full repo from this angle; line-by-line on the recently-touched high-yield surface.

---

## Verdict

**COMMENT** — No CRITICAL / HIGH / MEDIUM / LOW actionable findings. Reporting honest convergence.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

---

## Cycle-5 fixes RE-VERIFIED CLOSED at HEAD (not trusted on the aggregate's word)

| Prior finding | Status at `4c3d5924` | Evidence (read line-by-line) |
|---|---|---|
| **AGG-C5-01** sidecar `flushBatch` orphan-cleanup test gap | **CLOSED, PROVEN NON-VACUOUS** | `scripts/backfill-color-pipeline.ts:127-146` extracts `cleanupDeletedMidReencodeVariants` + `collectDeletedMidReencodeFiles` as module-level exports; `flushBatch:397-406` wires them. `backfill-color-pipeline-deleted-mid-reencode.test.ts` (149 LOC) pins the partition (only `affectedRows===0` selected), the `[]` dir-scan arg on all 3 formats, AND a source-shape pin that `flushBatch` invokes both + adjusts the `processed -= … / deletedMidReencode += …` tally. Ran it: **16 tests pass.** Comment documents proven-RED on filter-drop / sizes-change. |
| **AGG-C5-02** touch-target `<select>` `max-` false-positive | **CLOSED** | `touch-target-audit.test.ts:415,419` (+ 2 more) carry `(?<!max-)` before `(?:h-8|h-9|h-10)` on all four native-`<select>` FORBIDDEN patterns, mirroring the `40a65aef` Button fix; negative self-check fixture at `:988` (`<select className="max-h-10">` must NOT flag). |
| **AGG-C5-03** three public inline `<Link>` < 44 px | **CLOSED** | `topic-empty-state.tsx:18`, `home-client.tsx:434`, `timeline/page.tsx:154` all now carry `inline-flex items-center min-h-11 px-2`. Verbatim-read. |
| **AGG-C5-T1** en/ko leaf-key parity gate | **CLOSED** | `i18n-key-parity.test.ts` flattens both message trees and asserts SET equality (keys only, respecting DOC-R5C3-07's en-ICU/ko-fixed value asymmetry) + duplicate-key sanity. Correct design. |
| **AGG-C5-T2** upload-queue `[]`-sizes wiring pin | **CLOSED** | `image-queue-delete-race-cleanup-wiring.test.ts` present; `image-queue.ts:383-387` passes `[]` on all 3 `deleteImageVariants` calls. |

---

## What I stress-tested and found CLEAN (no action)

- **Backfill correctness (both paths byte-equivalent on the contract).** Sidecar `flushBatch` (`backfill-color-pipeline.ts:358-411`) and in-app runner `reprocessOne` (`admin-backfill-runner.ts:442-615`) both: (a) version-bump UPDATE on detection success, (b) derivative-only UPDATE (no version bump) on detection-failure → row stays a candidate for retry, (c) `affectedRows===0` → deleted-mid-reencode cleanup with `[]` dir-scan, post-commit (sidecar) so a unlink error can't roll back sibling rows. The `processed` counter math in the sidecar is correct: rows are counted `processed++` at enqueue (incl. derivative-only), then `processed -= deletedMidReencodeFiles.length` in flush partitions BOTH update kinds (both were counted). No double-count, no leak.
- **`deleteImageVariants` `[]` dir-scan contract is real** (`process-image.ts:486`): `sizes=[]` → `fs.opendir` scan matching `${name}_*${ext}`. UUID filenames make prefix-collision false-deletion impossible (no UUID is a prefix of another followed by `_`).
- **Tag filtering + GROUP_CONCAT interaction is correct** (`data.ts:563-590`, `605`, `728-755`). `buildTagFilterCondition` filters via `inArray(images.id, <subquery with own GROUP BY/HAVING>)`, so the outer LEFT JOIN + `GROUP_CONCAT(DISTINCT tags.name)` still aggregates ALL tags per matching image, not just the filtered subset. `tag_names` aria-labels stay correct under filtering. Locked by `data-tag-names-sql.test.ts`.
- **`admin-backfill-runner` concurrency cap arithmetic** (`resolveBackfillConcurrency:129-142`): NaN-guarded pool limit, `cap = max(1, floor((LIMIT-RESERVED-1)/2))` = 2 at pool=10. Clamps DOWN with a warning. Pool-exhausted claim → `locked` skip (no tight error spin). Sound.
- **`getBackfillStatus`** (`admin-backfill.ts:103-130`) omits `deletedMidReencode` from the surfaced result — intentional (the runner documents it as neither success nor failure, doesn't need operator attention). Benign, not a defect.
- **Image-queue lifecycle** (`image-queue.ts`): per-image claim lock + `WHERE processed=false` conditional UPDATE + delete-race cleanup; `failed_at` uses `toMySqlDateTime` (the R4C2 fix for the trailing-`Z` ER 1292); FIFO eviction on bounded maps; quiesce uses pause→clear→onIdle (the COR-R4C12-01 deadlock fix). Fire-and-forget caption/embedding hooks both carry `.catch()` / internal try-catch. Clean.
- **NCLX ISOBMFF walker** (`color-detection.ts:217-283`): depth ≤ 5, scan ≤ 1 MB, `size < headerSize` / `pos+size > buffer.length` rejection, `dataSize >= 11` guard before all `readUInt16BE(dataStart+4/+6/+8)`, `meta` FullBox +4 skip, `pos = boxEnd` termination. NCLX-precedence applies only DEFINED values (the COR-1 fix avoids clobbering ICC with H.273 code-2 "Unspecified"). Bulletproof.
- **Histogram** (`histogram.tsx`): AbortController + `aborted` flag on the img-load effect; `markFailed` URL fall-through (AVIF→sized JPEG→base); `canvasDims` in the redraw deps (the COR-R4C8-04 buffer-clear fix); `useImperativeHandle` for cycleMode. No stale-closure or leak.
- **Home-client pagination** (`home-client.tsx`): cursor-based load-more (`getClientImageListCursor`) means no offset-under-insertion duplicate-key risk; `key={image.id}`; prop-driven `setAllImages(images)` reset on filter change with LoadMore's own `queryVersionRef` discarding stale responses. Sound.
- **Blur consumer** (`photo-viewer.tsx:192-200`): gates through `isSafeBlurDataUrl` at read time; producer + write-time also assert (symmetric defense). Clean.
- **Public pages** (`(public)/page.tsx`, `p/[id]/page.tsx`, `timeline/page.tsx`): all `revalidate = 0`; numeric id validated `/^\d+$/` before parseInt; JSON-LD via `safeJsonLd` + CSP nonce; timeline month bucketing guards `Number.isFinite(m) && 1..12`. Clean.

---

## Gate evidence (run live this cycle)

- `npm run typecheck` (app + scripts) → **exit 0** (clean isolated run at HEAD `4c3d5924`; an earlier `code 2` was a spurious `tsc` build-cache collision from running 3 concurrent typechecks, NOT a real type error — re-ran in isolation, green).
- Targeted tests `backfill-color-pipeline-deleted-mid-reencode` + `admin-backfill-concurrency-cap` + `admin-backfill-runner-deleted-mid-reencode` → **16/16 pass.**
- `check:js-scripts` → 7 files checked, clean.

---

## Non-findings considered and dismissed (skeptical pass)

- **Committed `sw.js` stamp `ee0f38bd-p7` ≠ HEAD `4c3d5924`** — the `prebuild` hook (`build-sw.ts`) regenerates the stamp at build, so the deployed artifact is correct; the committed file being a stamp behind is a documented build-artifact pattern, not a runtime defect. (Already in the aggregate's VERIFIED-CLEAN.) Not counted.
- **Sidecar counts detection-failure rows as `processed`** while the in-app runner separates `detectionFailures` — this is an intentional reporting difference (the sidecar's final log only reports processed/skipped/errors/deletedMidReencode and doesn't claim a detection-failure breakdown). Both persist the same columns; the divergence is cosmetic, documented, and re-affirmed CONVERGING (AGG-C5-R1). Not a defect.
- **Color-pipeline writer duplication B↔C (~120 LOC)** — re-confirmed CONVERGING not drifting; WI-09 consolidation deferral remains justified (maintainability investment, not correctness). No new divergence. Record-only (matches AGG-C5-R1).

---

## Conclusion

Honest convergence holds and is the correct outcome. The prior cycle's two MED items (sidecar test gap + bare inline links) are closed with proven-RED / verbatim-confirmed fixes; the four LOW items are closed; no prior-closed finding regressed; and a fresh full-angle sweep of the recently-touched backfill/queue/data/color/histogram/page surface plus their cross-file interactions produced no new logic, error-handling, SOLID, maintainability, or type-safety defect worth a code change. **0 new actionable findings.**

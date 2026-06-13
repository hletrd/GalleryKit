# Performance Review — Cycle 8/100 (review-plan-fix)

**Reviewer:** perf-reviewer lane (ran read-only / write-blocked; persisted by orchestrator per the documented write-recovery pattern). Substance cross-checked against the 4 perf-relevant source files at HEAD.
**Date:** 2026-06-14
**HEAD:** `9c40d261` (working tree clean)

**NO NEW actionable perf defect.** The only source change in the cycle-8 window (`isLosslessWebpByChunk` in `process-image.ts`, commit `85bca582`) was inspected directly and is perf-clean. The other 6 commits in the `b47cdbb6..9c40d261` window touched only docs, tests, `admin-header.tsx` (one className token), and review artifacts — none are perf surfaces. All prior RECORD-ONLY / DEFERRED perf observations re-confirmed UNCHANGED.

## Cycle-7 perf item now CLOSED at HEAD

| Prior item | Status | Evidence |
|---|---|---|
| **AGG-C7-05** — `input.includes(Buffer.from('VP8L'))` whole-buffer substring scan in the GPS re-encode (Tier-2) fallback could misclassify a lossy WebP as lossless | **CLOSED** (commit `85bca582`) | `grep` finds no `includes(Buffer.from('VP8L'))` in `process-image.ts`. Replaced by a bounded RIFF walker `isLosslessWebpByChunk()` (defined `src/lib/process-image.ts:1498-1518`, called at the re-encode fallback `~:1608`). The walker is **perf-clean**: bounded by `buf.length` (`while (offset + 8 <= buf.length)`), monotonic-progress guard (`if (next <= offset) return false`), no allocation, no decode, runs once per upload on a rare fallback path. No perf regression introduced. |

## RECORD-ONLY / DEFERRED perf observations — re-confirmed UNCHANGED (do NOT re-flag as new)

All of the following are documented-intentional or bounded. They were re-confirmed unchanged at HEAD; none is a live defect.

| ID | Item | Disposition |
|---|---|---|
| RC-1 | SW image-cache metadata lost-update (whole-doc overwrite, no CAS) | best-effort by design |
| RC-2 | bootstrap `inArray`/`notInArray` sweep ≤1000 IDs (`image-queue.ts:~609`) | bounded |
| RC-3 | decode-per-format ~18/image (WI-14 fresh `sharp(inputPath,…)` per format, `process-image.ts:~1110`) | intentional anti-contamination |
| RC-4 | Atom feed filesort bounded | bounded |
| RC-5 | timeline non-sargable `YEAR()`/`MONTH()` | bounded |
| RC-6 | single-pool/10 single-writer topology | documented runtime topology |
| RC-7 | `getMapImages` unbounded result set (= PERF-R4C15-B) | deferred, documented |
| RC-8 | analytics 'all'-window temp-table (= PERF-R5C2-01) | deferred, documented |
| PERF-C7-OBS-1 | semantic-search scores ≤5000 512-dim vectors synchronously on the event loop (`clip-embeddings.ts:14` `SEMANTIC_SCAN_LIMIT=5000`) | bounded + default-disabled + 30/min/IP rate-limited + stub-demo; single-digit-to-low-tens-ms worst case. No fix. |

## Clean-surface highlights (accurate at HEAD)

- Bounded `inArray` sweep in queue bootstrap.
- Sharp `cache(false)` + concurrency÷3 + streamed `.toFile()` in the encode pipeline.
- CSS-`columns` masonry grid (`useMemo` reorder, `requestAnimationFrame`-debounced resize).
- Web-Worker-driven histogram (256×256 canvas cap).
- `useDisplayCapability` snapshot-memoized `getSnapshot` (stable reference — avoids React #185 infinite loop).
- React `cache()` SSR dedup on the data-access layer.

## Recommendation

**No new perf finding.** AGG-C7-05 moved to CLOSED. The regenerated review is a clean "no new findings" pass against HEAD `9c40d261`. The prior record-only / deferred items remain bounded and intentional.

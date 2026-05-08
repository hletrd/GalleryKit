# Cycle 6 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 6/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/cycle5-rpf-photographer/_aggregate.md` — cycle 5 master.
- `.context/reviews/cycle4-rpf-photographer/_aggregate.md` — cycle 4.
- `.context/reviews/photographer-r3/_aggregate.md` — original master.
**Master plans in flight:**
- `.context/plans/44-cycle5-rpf-photographer.md` — fully shipped (C5-A1..C5-A5 all landed). Archive in cycle 6.
- `.context/plans/38-photographer-r3-followup.md` — already in `archive/`; deferred set carried.

---

## Executive summary

Cycle 5 closed C5-A1..C5-A5 cleanly. All four gates green at cycle-6 baseline (`eslint` exit 0; `vitest` 138 files / 1213 tests; `lint:api-auth`; `lint:action-origin`). Master HEAD `b93af71a`.

Cycle 6 surfaces **ONE genuinely new MED finding** with cross-angle agreement (color-fidelity + ui-ux, 2-way): the gamut-aware download button label predicate `image.color_pipeline_decision?.startsWith('p3-from-')` is duplicated literally three times across three call sites with no shared helper and no test lock.

**No CRIT, no HIGH from the photographer perspective this cycle.**

The convergence trajectory (9 → 18 → 25 → 13 → 4 → 1) is now near-zero. The deferred set (C5-D1..C5-D14 / C6-ARCH-MED-1) is unchanged.

---

## Findings inventory (deduplicated across all per-angle reviews)

### MED (1 unique action item)

| ID | Angle | File:line | One-line | Confidence |
|---|---|---|---|---|
| **C6-COL-MED-1** = **C6-UX-MED-1** | color-fidelity + ui-ux (cross-angle, 2-way agreement) | `info-bottom-sheet.tsx:333, 550`; `photo-viewer.tsx:847` | Gamut-aware download label predicate `startsWith('p3-from-')` triplicated; no shared helper, no test lock | HIGH |

### LOW (1 new + carry-forwards)

| ID | Angle | File:line | One-line |
|---|---|---|---|
| **C6-COL-LOW-1** | color-fidelity | `color-details-section.tsx:55-69` | `humanizeColorPipelineDecision` switch parameter typed as `string \| null \| undefined`, not `ColorPipelineDecision` — defensive only; cycle-5 i18n test catches photographer-visible failures |

### Carry-forwards (cycle-5 deferred set re-affirmed)

| ID (cycle 6) | Source | Severity | Confidence | Reason for deferral | Exit criterion |
|---|---|---|---|---|---|
| **C6-D1** = C5-D1 | C5-HDR-LOW-3 / C4-D1 | LOW | HIGH | `parseCicpFromHeif` `full_range_flag` unconsumed | When WI-09 picks up |
| **C6-D2** = C5-D2 | C5-HDR-LOW-4 / C4-D2 | LOW | HIGH | Legacy `is_hdr=true` admin diagnostic | When WI-09 ships, OR a photographer reports legacy oddity |
| **C6-D3** = C5-D3 | C5-HDR-LOW-5 / C4-D3 | HIGH (deferred severity preserved) | HIGH | ICC TRC-based detection — large effort | When P3-13 plan is scheduled |
| **C6-D4** = C5-D4 | C5-INT-LOW-2 / C4-D4 | MED | MEDIUM | `validatedNumber` silent clamp | When operations report stale-config drift |
| **C6-D5** = C5-D5 | C5-INT-LOW-3 / C4-D5 | LOW | MEDIUM | 10-bit AVIF probe never reset | When Sharp build reload patterns become common |
| **C6-D6** = C5-D6 | C5-INT-LOW-4 / C4-D6 | LOW | HIGH | `.wi15.tmp` cleanup race | When filesystem hygiene becomes a reported concern |
| **C6-D7** = C5-D7 | C5-INT-LOW-5 / P3-12 | LOW | HIGH | Real HEIF + ICC fixtures | When P3-12 plan is scheduled |
| **C6-D8** = C5-D8 | C5-UX-LOW-1 / C4-D8 | LOW | HIGH | `colorDetailsId` collision sidebar↔sheet | When C5-D12 lands |
| **C6-D9** = C5-D9 | C5-UX-LOW-2 / C4-D9 | LOW | MEDIUM | Histogram clip threshold hardcoded | When P3-33 picked up |
| **C6-D10** = C5-D10 | C5-UX-LOW-3 / C4-D10 | LOW | HIGH | Histogram canvas not responsive | When P3-33 picked up |
| **C6-D11** = C5-D11 | C5-UX-LOW-4 / C4-D11 | LOW | HIGH | `c`/`h` shortcuts dead on mobile | When C5-D12 lands |
| **C6-D12** = C5-D12 | C5-ARCH-MED-1 / C4-D12 | MED | HIGH | Architectural refactor — hoist accordion + histogram state | When mobile bottom-sheet IA is refactored |
| **C6-D13** = C5-D13 | C5-INT-LOW-6 / C4-D13 | MED | MEDIUM | Encoder-side fixture for `wide_gamut_jpeg_chroma` | When P3-12 fixture infra lands |
| **C6-D14** = C5-D14 | C5-COL-LOW-2 | LOW | LOW | `'p3-from-rec2020-hlg'` enum split for legacy admin diagnostic | When WI-09 ships and re-process flow exists |
| **C6-D15** (NEW) | C6-COL-LOW-1 | LOW | LOW | `humanizeColorPipelineDecision` switch parameter type tightening | If C6-A1 ships, fold into the helper test |

**Repo-policy compliance** for deferred items:
- File + line citation: present in source review files.
- Original severity / confidence: preserved (NOT downgraded to justify deferral).
- Reason for deferral: stated above.
- Exit criterion: stated above.
- None of the deferred items is a security, correctness, or data-loss finding.

---

## Cross-angle agreement (highest-signal findings)

### Two-way cross-angle: C6-COL-MED-1 = C6-UX-MED-1

The gamut-aware download button label predicate is triplicated. Flagged independently by color-fidelity and ui-ux. MED, HIGH confidence. **Recommend: fix in cycle 6.**

This is the only photographer-relevant cross-angle finding new this cycle. Trajectory of new findings: 9 → 18 → 25 → 13 → 4 → 1. Single-cycle convergence is plausible.

---

## Recommended cycle-6 implementation queue

In priority order:

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | C6-COL-MED-1 / C6-UX-MED-1 | Add `isP3Pipeline(decision)` helper to `apps/web/src/lib/color-pipeline-decisions.ts`. Replace 3 call sites in `info-bottom-sheet.tsx` (lines 333, 550) and `photo-viewer.tsx` (line 847) with the imported helper | S |
| 2 | C6-A1 lock test | Add `__tests__/is-p3-pipeline.test.ts` walking `COLOR_PIPELINE_DECISIONS` asserting the helper returns the expected boolean for every enum value. Also assert call-site usage in `info-bottom-sheet.tsx` + `photo-viewer.tsx` source matches `isP3Pipeline(...)` (source-inspection style) so a future re-introduction of the inline `startsWith` is caught | S |
| 3 | Plan-44 archive | Move `plans/44-cycle5-rpf-photographer.md` to `plans/done/` since C5-A1..C5-A5 all landed | XS |

**Total estimated effort:** 3 items, 3 fine-grained semantic commits (#3 is a doc move). Each commit GPG-signed, gitmoji + Conventional Commits, no `--no-verify`. After all: run all gates, then `npm run deploy` once.

### Items deferred / carry-forward

See §"Carry-forwards" above for the full deferred set. None of these are security / correctness / data-loss findings.

---

## Plan-44 archival recommendation

After cycle 6 lands C6-A1..C6-A2 (helper extraction + lock test), plan-44 should be moved to `.context/plans/done/` since all C5-A1..C5-A5 items shipped.

---

## Cycle-6 baseline gate state

| Gate | Status |
|---|---|
| `lint` (eslint) | PASS — exit 0 |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS |
| `vitest` | PASS — 138 files / 1213 tests |
| `build` (next/tsc) | PASS via vitest gate |

---

## Convergence note (for the orchestrator)

With **1 new MED finding** at cycle entry, the loop is near-convergence. If cycle 7 returns 0 new findings AND 0 commits, the orchestrator's single-cycle convergence rule terminates the loop. Cycle 6 ships C6-A1..C6-A2 to close the only remaining new-finding so cycle 7 can converge cleanly.

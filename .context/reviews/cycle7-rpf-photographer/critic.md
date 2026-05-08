# Cycle 7 RPF — Critic Review

**Cycle:** 7/100
**Date:** 2026-05-08
**Reviewer angle:** critic — challenge the cycle-6 plan, audit completeness of consolidations, find skipped sites.
**Baseline HEAD:** `9847c0dc`.

## What I challenged

The cycle-6 plan claimed C6-A1 (`isP3Pipeline` helper extraction) and C6-A2 (lock test) closed the photographer-relevant cross-angle finding "gamut-aware download button label predicate triplicated". The cycle-6 aggregate explicitly listed three call sites:

- `info-bottom-sheet.tsx:333`
- `info-bottom-sheet.tsx:550`
- `photo-viewer.tsx:847`

I ran a wider audit of all `startsWith('p` / `startsWith('p3` / `startsWith('p3-from-` predicates in `apps/web/src` to verify the count.

## Finding

### C7-CRIT-MED-1 — C6-A1 consolidation incomplete (3 sites locked, 4 sites in code)

**Severity:** MED. **Confidence:** HIGH.

`grep -rn "startsWith('p3" apps/web/src --include='*.ts' --include='*.tsx'` returns **four** non-test sites:

| File:line | Predicate | Locked by |
|---|---|---|
| `info-bottom-sheet.tsx:334` | `isP3Pipeline(decision)` (cycle 6) | `is-p3-pipeline.test.ts` C6-A2 |
| `info-bottom-sheet.tsx:551` | `isP3Pipeline(decision)` (cycle 6) | `is-p3-pipeline.test.ts` C6-A2 |
| `photo-viewer.tsx:848` | `isP3Pipeline(decision)` (cycle 6) | `is-p3-pipeline.test.ts` C6-A2 |
| **`color-details-section.tsx:230`** | **`startsWith('p3')`** (still inline) | `color-details-section-delivered.test.ts:48` (locks the WRONG shape) |

(The other three matches are inside `process-image.ts` and are server-side ICC profile-name string matching against `'p3-d65'` / `'dci-p3'` — out of scope for the `isP3Pipeline` enum predicate.)

The cycle-6 plan's audit window was `info-bottom-sheet.tsx` and `photo-viewer.tsx`. It did not include `color-details-section.tsx`, even though that file is a peer consumer of the same enum, on the same surfaces, for a label adjacent to the gamut-aware download button label.

The wrong-predicate lock at `color-details-section-delivered.test.ts:48` is the more pressing issue: when a future contributor fixes this on their own, they will see the test fail and either revert the fix or have to update the test, which signals "this regex was load-bearing" — an extra speed-bump that the cycle-7 fix should remove.

**Recommendation:** treat C6-A1's consolidation as cycle-7 unfinished work. Land the fourth site, update the existing lock test for the row, and extend the `is-p3-pipeline.test.ts` consumer list.

## Process critique

- The cycle-6 audit relied on the cycle-5/cycle-6 review documents naming three sites. A wider grep would have caught the fourth. Recommendation for cycle 7+: when a helper consolidation lands, run a project-wide grep for the inline literal as the closing audit step before commit. The cycle-6 lock test does this on its three target files but does not enumerate the codebase.
- The cycle-6 plan-archival step (C6-A3) is still pending. Plan 45 lives in `plans/` but C6-A1 and C6-A2 are committed. Move it to `plans/done/` in cycle 7.

## Verdict

**1 MED, 0 HIGH, 0 CRIT.** Same underlying finding as C7-COL-MED-1 / C7-UX-MED-1 viewed through the cycle-6-completeness lens. Cross-angle 3-way agreement (color-fidelity, ui-ux, critic) is the strongest signal photographer-relevant work this cycle.

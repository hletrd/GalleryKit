# Cycle 7 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 7/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/cycle6-rpf-photographer/_aggregate.md` — cycle 6 master.
- `.context/reviews/cycle5-rpf-photographer/_aggregate.md` — cycle 5.
- `.context/reviews/cycle4-rpf-photographer/_aggregate.md` — cycle 4.
- `.context/reviews/photographer-r3/_aggregate.md` — original master.

**Master plans in flight:**
- `.context/plans/45-cycle6-rpf-photographer.md` — fully shipped (C6-A1, C6-A2 both landed; C6-A3 doc archive pending). Archive in cycle 7.

---

## Executive summary

Cycle 6 closed C6-A1 (`isP3Pipeline` helper) and C6-A2 (lock test) cleanly. All four gates green at cycle-7 baseline (`eslint` exit 0; `vitest` 139 files / 1233 tests; `lint:api-auth`; `lint:action-origin`). Master HEAD `9847c0dc`.

Cycle 7 surfaces **ONE genuinely new MED finding** with cross-angle agreement (color-fidelity + ui-ux + critic, 3-way): `isP3Pipeline` consolidation in cycle 6 was incomplete. A **fourth** call site in `color-details-section.tsx:230` uses an inline `startsWith('p3')` predicate (NOTE: bare `'p3'`, NOT `'p3-from-'`) that drives the photographer-facing "Delivered bit depth" label between "10-bit AVIF, 8-bit WebP/JPEG" and "8-bit (all formats)". The existing lock test for that row at `color-details-section-delivered.test.ts:48` actively asserts the wrong predicate shape, so a refactor that fixes the implementation breaks the test. C6-A1 missed this site because its lock scope was limited to `info-bottom-sheet.tsx` and `photo-viewer.tsx`.

**No CRIT, no HIGH from the photographer perspective this cycle.**

The convergence trajectory (9 → 18 → 25 → 13 → 4 → 1 → 1) sustains the near-zero-finding plateau. The deferred set (C6-D1..C6-D15) is unchanged and re-affirmed.

---

## Findings inventory (deduplicated across all per-angle reviews)

### MED (1 unique action item)

| ID | Angle | File:line | One-line | Confidence |
|---|---|---|---|---|
| **C7-COL-MED-1** = **C7-UX-MED-1** = **C7-CRIT-MED-1** | color-fidelity + ui-ux + critic (cross-angle, 3-way agreement) | `color-details-section.tsx:230`; lock test `color-details-section-delivered.test.ts:48` | C6-A1 helper consolidation incomplete: fourth call site uses bare `startsWith('p3')` predicate (NOT `'p3-from-'`) for the "Delivered bit depth" label; existing lock test asserts the wrong predicate | HIGH |

#### Rationale

Pre-cycle-7 state of the four call sites:

| File:line | Predicate | Photographer-facing label |
|---|---|---|
| `info-bottom-sheet.tsx:334` | `isP3Pipeline(decision)` (cycle 6) | Mobile: "Download (Display P3 JPEG)" vs "Download JPEG" |
| `info-bottom-sheet.tsx:551` | `isP3Pipeline(decision)` (cycle 6) | Mobile alt path: same |
| `photo-viewer.tsx:848` | `isP3Pipeline(decision)` (cycle 6) | Desktop sidebar: same |
| **`color-details-section.tsx:230`** | **`startsWith('p3')`** (still inline, missed by C6-A1) | **Mobile + desktop:** "10-bit AVIF, 8-bit WebP/JPEG" vs "8-bit (all formats)" |

**Today the predicates are functionally equivalent** because every current `COLOR_PIPELINE_DECISIONS` value starting with `p3` also starts with `p3-from-` (the enum is `'p3-from-displayp3' | 'p3-from-dcip3' | 'p3-from-adobergb' | 'p3-from-prophoto' | 'p3-from-rec2020'`). However:

1. **Forward-compat hazard:** when WI-09 lands HDR encoding, a hypothetical enum extension `'p3only'` or `'p3-hdr'` (anything starting with `p3` but missing `-from-`) would diverge. The bit-depth row would say "10-bit AVIF" while the download button would say "Download JPEG". The two labels describe the same delivery and must agree.
2. **Test-locked wrong predicate:** `color-details-section-delivered.test.ts:48` regex-matches the inline `startsWith('p3')`. A future contributor who fixes the implementation to use `isP3Pipeline(decision)` will see this test fail with a confusing message about a missing `startsWith` literal — a worse outcome than a non-locked predicate. The lock should track the *contract* (decision → bit-depth label) not the *literal* (`startsWith('p3')`).
3. **Discoverability:** any engineer reading the cycle-6 plan / commit would reasonably believe consolidation was complete. The fourth site is invisible to the cycle-6 audit.

**Severity rationale:** MED, not LOW. The naked `startsWith('p3')` is a latent semantic divergence from the new helper's contract (`startsWith('p3-from-')`), and the test-locked wrong predicate makes the divergence harder to fix. Photographer impact is the same as C6 — wrong cross-surface label could confuse photographers about which delivery format encodes which bit-depth.

**Severity rationale not HIGH:** today the two predicates are equivalent on every shipping enum value, so a real-world photographer cannot encounter the divergence on any production photo. The gap is forward-compat + maintainability, not active bug.

---

### LOW (0 new this cycle)

No new LOW-severity photographer-relevant findings beyond the deferred set carried from cycle 6.

---

### Carry-forwards (cycle-6 deferred set re-affirmed)

| ID (cycle 7) | Source | Severity | Confidence | Reason for deferral | Exit criterion |
|---|---|---|---|---|---|
| **C7-D1** = C6-D1 | C5-HDR-LOW-3 / C4-D1 | LOW | HIGH | `parseCicpFromHeif` `full_range_flag` unconsumed | When WI-09 picks up |
| **C7-D2** = C6-D2 | C5-HDR-LOW-4 / C4-D2 | LOW | HIGH | Legacy `is_hdr=true` admin diagnostic | When WI-09 ships, OR a photographer reports legacy oddity |
| **C7-D3** = C6-D3 | C5-HDR-LOW-5 / C4-D3 | HIGH (deferred severity preserved) | HIGH | ICC TRC-based detection — large effort | When P3-13 plan is scheduled |
| **C7-D4** = C6-D4 | C5-INT-LOW-2 / C4-D4 | MED | MEDIUM | `validatedNumber` silent clamp | When operations report stale-config drift |
| **C7-D5** = C6-D5 | C5-INT-LOW-3 / C4-D5 | LOW | MEDIUM | 10-bit AVIF probe never reset | When Sharp build reload patterns become common |
| **C7-D6** = C6-D6 | C5-INT-LOW-4 / C4-D6 | LOW | HIGH | `.wi15.tmp` cleanup race | When filesystem hygiene becomes a reported concern |
| **C7-D7** = C6-D7 | C5-INT-LOW-5 / P3-12 | LOW | HIGH | Real HEIF + ICC fixtures | When P3-12 plan is scheduled |
| **C7-D8** = C6-D8 | C5-UX-LOW-1 / C4-D8 | LOW | HIGH | `colorDetailsId` collision sidebar↔sheet | When C6-D12 lands |
| **C7-D9** = C6-D9 | C5-UX-LOW-2 / C4-D9 | LOW | MEDIUM | Histogram clip threshold hardcoded | When P3-33 picked up |
| **C7-D10** = C6-D10 | C5-UX-LOW-3 / C4-D10 | LOW | HIGH | Histogram canvas not responsive | When P3-33 picked up |
| **C7-D11** = C6-D11 | C5-UX-LOW-4 / C4-D11 | LOW | HIGH | `c`/`h` shortcuts dead on mobile | When C6-D12 lands |
| **C7-D12** = C6-D12 | C5-ARCH-MED-1 / C4-D12 | MED | HIGH | Architectural refactor — hoist accordion + histogram state | When mobile bottom-sheet IA is refactored |
| **C7-D13** = C6-D13 | C5-INT-LOW-6 / C4-D13 | MED | MEDIUM | Encoder-side fixture for `wide_gamut_jpeg_chroma` | When P3-12 fixture infra lands |
| **C7-D14** = C6-D14 | C5-COL-LOW-2 | LOW | LOW | `'p3-from-rec2020-hlg'` enum split for legacy admin diagnostic | When WI-09 ships and re-process flow exists |
| **C7-D15** = C6-D15 | C6-COL-LOW-1 | LOW | LOW | `humanizeColorPipelineDecision` switch parameter type tightening | If/when consolidation extends |

**Repo-policy compliance** for deferred items:
- File + line citation: present in source review files.
- Original severity / confidence: preserved (NOT downgraded to justify deferral).
- Reason for deferral: stated above.
- Exit criterion: stated above.
- None of the deferred items is a security, correctness, or data-loss finding.

---

## Cross-angle agreement (highest-signal findings)

### Three-way cross-angle: C7-COL-MED-1 = C7-UX-MED-1 = C7-CRIT-MED-1

The fourth p3-prefix predicate in `color-details-section.tsx:230` is flagged independently by:
- **color-fidelity:** photographer-facing bit-depth label inconsistency on a future enum extension.
- **ui-ux:** label semantics drift from the gamut-aware download button label on the same surface.
- **critic:** C6-A1 lock test scope was incomplete; four sites in the codebase, only three locked.

MED, HIGH confidence. **Recommend: fix in cycle 7.**

This is the only photographer-relevant cross-angle finding new this cycle. Trajectory: 9 → 18 → 25 → 13 → 4 → 1 → 1. Single-cycle convergence is plausible after C7-A1.

---

## Recommended cycle-7 implementation queue

In priority order:

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | C7-COL-MED-1 / C7-UX-MED-1 / C7-CRIT-MED-1 | Replace inline `startsWith('p3')` at `color-details-section.tsx:230` with `isP3Pipeline(image.color_pipeline_decision)`. Update the existing lock test `color-details-section-delivered.test.ts:48` to lock the helper-call pattern instead of the inline literal | S |
| 2 | C7-A1 lock extension | Extend `__tests__/is-p3-pipeline.test.ts` Part 2 (call-site source-inspection) to also cover `color-details-section.tsx`, ensuring the helper import + helper call exists, AND the inline `startsWith('p3-from-')` literal is absent (existing assertion). Add a new assertion that the bare `startsWith('p3')` literal is also absent on this consumer file | S |
| 3 | Plan-45 archive | Move `plans/45-cycle6-rpf-photographer.md` to `plans/done/` (C6-A1, C6-A2 both shipped; C6-A3 doc archive completes here) | XS |

**Total estimated effort:** 3 items, 3 fine-grained semantic commits (#3 is a doc move). Each commit GPG-signed, gitmoji + Conventional Commits, no `--no-verify`. After all: run all gates, then `npm run deploy` once.

### Items deferred / carry-forward

See §"Carry-forwards" above for the full deferred set. None of these are security / correctness / data-loss findings.

---

## Plan-45 archival recommendation

After cycle 7 lands C7-A1..C7-A2 (helper extension + lock test extension), plan-45 should be moved to `.context/plans/done/` since C6-A1 and C6-A2 both shipped and C6-A3 (plan archival) is the trailing doc step.

---

## Cycle-7 baseline gate state

| Gate | Status |
|---|---|
| `lint` (eslint) | PASS — exit 0 |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS |
| `vitest` | PASS — 139 files / 1233 tests |
| `build` (next/tsc) | PASS via vitest gate |

---

## Convergence note (for the orchestrator)

With **1 new MED finding** at cycle entry, the loop is sustaining the near-zero plateau. Cycle 7 ships C7-A1..C7-A3 to close the only remaining new-finding so cycle 8 can converge cleanly.

The cycle-6 prediction "if cycle 7 returns 0 new findings AND 0 commits, the orchestrator's single-cycle convergence rule terminates the loop" was conservative — cycle 7 finds 1 MED. Honest reporting per the framing prompt: this finding is real, photographer-relevant, and closing it is a small, well-scoped change.

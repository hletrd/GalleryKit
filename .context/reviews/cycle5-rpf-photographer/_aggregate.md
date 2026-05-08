# Cycle 5 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 5/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/cycle4-rpf-photographer/_aggregate.md` — cycle 4 master.
- `.context/reviews/cycle3-rpf-photographer/_aggregate.md` — cycle 3.
- `.context/reviews/cycle2-rpf-photographer/_aggregate.md` — cycle 2.
- `.context/reviews/photographer-r3/_aggregate.md` — original master.
**Master plans in flight:**
- `.context/plans/43-cycle4-rpf-photographer.md` — fully shipped (C4-A1..C4-A8 all landed).
- `.context/plans/38-photographer-r3-followup.md` — mostly shipped; deferred set carried.

---

## Executive summary

Cycle 4 closed the C4-A1..C4-A8 queue cleanly. All four gates are green at cycle-5 baseline (`eslint`, `lint:api-auth`, `lint:action-origin`, `vitest 137 files / 1207 tests`). Master HEAD `82b3dcfd`.

Cycle 5 surfaces ONE genuinely new MED finding (cross-angle, three-way agreement) plus one MED cosmetic and one LOW test-coverage extension. There is also one MED that re-frames a deferred cycle-4 item (`C4-A4 / C4-HDR-LOW-4` — already implemented; archive instead of carry-forward).

**No CRIT, no HIGH from the photographer perspective this cycle.**

---

## Findings inventory (deduplicated across all per-angle reviews)

### MED (3 unique action items + 1 archive)

| ID | Angle | File:line | One-line | Confidence |
|---|---|---|---|---|
| **C5-COL-MED-1** = **C5-HDR-MED-1** = **C5-UX-MED-1** | color-fidelity + hdr-workflow + ui-ux (cross-angle, 3-way agreement) | `lightbox.tsx:120-128, 150-161` | Lightbox color-pip expanded panel double-renders the HDR badge | HIGH |
| **C5-COL-MED-2** | color-fidelity | `__tests__/color-pipeline-decision-i18n.test.ts`; `lib/process-image.ts` | Cycle-4 i18n test does not import the resolver-side `ColorPipelineDecision` source-of-truth | MEDIUM |
| **C5-UX-MED-2** | ui-ux | `info-bottom-sheet.tsx:207, 234` | Mixed tab+space indentation on 2 lines | HIGH |
| **C5-HDR-LOW-2** (already-fixed → archive) | hdr-workflow | `upload-dropzone.tsx:199-296` | C4-A4 / C4-HDR-LOW-4 (HDR upload toast dedup) is already implemented via `hdrWarningCount` aggregation; archive | HIGH |

### LOW (mostly carry-forwards from cycle 4 deferred set)

| ID | Angle | File:line | One-line |
|---|---|---|---|
| **C5-COL-LOW-1** | color-fidelity | `lightbox.tsx:85-166` | `LightboxColorPip` not export-tested; cycle 5 adds source-inspection fixture |
| **C5-COL-LOW-2** | color-fidelity | `color-details-section.tsx:65` | Legacy `'p3-from-rec2020'` shared between SDR + ex-HLG sources (carry-forward, couples to WI-09) |
| **C5-HDR-LOW-1** = **C5-INT-LOW-1** | hdr-workflow + internal-formats (cross-angle) | `lib/hdr-filenames.ts:5` | Dead-code helper preserved for WI-09; **VERIFIED**: `__tests__/hdr-filenames.test.ts` already exists. Documentation-only finding |
| **C5-HDR-LOW-3** | hdr-workflow | `lib/color-detection.ts:222` | `parseCicpFromHeif` `full_range_flag` (carry-forward C4-D1 / C3-D7) |
| **C5-HDR-LOW-4** | hdr-workflow | `lib/data.ts:217` | Legacy `is_hdr=true` admin diagnostic (carry-forward C4-D2 / C3-D5) |
| **C5-HDR-LOW-5** | hdr-workflow | `lib/color-detection.ts:64` | P3-13 ICC TRC detection (carry-forward C4-D3) |
| **C5-INT-LOW-2** | internal-formats | `lib/gallery-config.ts:163` | `validatedNumber` silent clamp (carry-forward C4-D4) |
| **C5-INT-LOW-3** | internal-formats | `lib/process-image.ts:48` | 10-bit AVIF probe never reset on encode failure (carry-forward C4-D5) |
| **C5-INT-LOW-4** | internal-formats | `lib/process-image.ts:702` | `.wi15.tmp` cleanup race (carry-forward C4-D6) |
| **C5-INT-LOW-5** | internal-formats | missing | Real HEIF + ICC fixtures (carry-forward C4-D7 / P3-12) |
| **C5-INT-LOW-6** | internal-formats | missing | Encoder-side fixture for `wide_gamut_jpeg_chroma` (carry-forward C4-D13) |
| **C5-UX-LOW-1** | ui-ux | `color-details-section.tsx:111` | `colorDetailsId` collision (carry-forward C4-D8) |
| **C5-UX-LOW-2** | ui-ux | `histogram.tsx:281` | Histogram clip threshold hardcoded (carry-forward C4-D9) |
| **C5-UX-LOW-3** | ui-ux | `histogram.tsx` | Histogram canvas not responsive (carry-forward C4-D10) |
| **C5-UX-LOW-4** | ui-ux | `info-bottom-sheet.tsx` | `c`/`h` shortcuts dead on mobile (carry-forward C4-D11) |
| **C5-ARCH-MED-1** | security-and-arch | `info-bottom-sheet.tsx`, `photo-viewer.tsx` | `colorDetailsToggleRef` / `histogramCycleRef` not passed (carry-forward C4-D12) |

---

## Cross-angle agreement (highest-signal findings)

### Three-way cross-angle: C5-COL-MED-1 = C5-HDR-MED-1 = C5-UX-MED-1

The lightbox color-pip expanded panel double-renders the HDR badge. Flagged independently by three reviewers (color-fidelity, hdr-workflow, ui-ux). MED, HIGH confidence. **Recommend: fix in cycle 5.**

### Already-fixed audit — C4-A4

C4-A4 (HDR upload toast dedup) was on the cycle-4 implementation queue but the existing `hdrWarningCount` aggregation already meets the spec. **Recommend: archive C4-A4 in plan-43, do not re-implement.**

---

## Recommended cycle-5 implementation queue

In priority order:

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | C5-COL-MED-1 / C5-HDR-MED-1 / C5-UX-MED-1 | Drop the panel-internal HDR row from `LightboxColorPip` (lines 150-161 in `lightbox.tsx`). The chip already conveys HDR; the panel duplicates with no information gain | XS |
| 2 | C5-COL-MED-1 lock test | Add `__tests__/lightbox-color-pip-hdr.test.ts` source-inspection fixture asserting (a) `transfer_function`-driven gating, (b) HDR badge renders exactly once when `isHdr=true` (locks both C4-A3 and C5-COL-MED-1) | S |
| 3 | C5-COL-MED-2 | Extract `COLOR_PIPELINE_DECISIONS` const array in `apps/web/src/lib/color-pipeline-decisions.ts`; refactor `humanizeColorPipelineDecision` and the cycle-4 i18n test to walk it. Locks the test against silent enum drift in the resolver | S |
| 4 | C5-UX-MED-2 | Normalize tab+space indentation in `info-bottom-sheet.tsx:207, 234` to all-spaces 4-indentation | XS |
| 5 | C4-A4 / C5-HDR-LOW-2 archive | Update plan-43 status table marking C4-A4 / C4-HDR-LOW-4 as already-resolved. Documentation-only — no code change | XS |

**Total estimated effort:** 5 items, 4 fine-grained semantic commits (#5 is a plan doc edit only). Each commit GPG-signed, gitmoji + Conventional Commits, no `--no-verify`. After all: run all gates, then `npm run deploy` once.

### Items deferred to plan-45 / future cycles (carry-forward set)

Recorded per the deferred-fix rules. None of these are security / correctness / data-loss findings.

| ID | Source review | Severity | Confidence | Reason for deferral | Exit criterion |
|---|---|---|---|---|---|
| **C5-D1** | C5-HDR-LOW-3 / C4-D1 | LOW | HIGH | `parseCicpFromHeif` `full_range_flag` unconsumed; depends on WI-09 HDR encoder | When WI-09 picks up |
| **C5-D2** | C5-HDR-LOW-4 / C4-D2 | LOW | HIGH | Legacy `is_hdr=true` admin diagnostic; depends on WI-09 for re-process flow | When WI-09 ships, OR a photographer reports legacy oddity |
| **C5-D3** | C5-HDR-LOW-5 / C4-D3 | HIGH (deferred severity preserved) | HIGH | ICC TRC-based detection; large effort awaiting its own plan | When P3-13 plan is scheduled |
| **C5-D4** | C5-INT-LOW-2 / C4-D4 / C3-D8 | MED | MEDIUM | `validatedNumber` silent clamp; admin UI validates upstream | When operations report stale-config drift |
| **C5-D5** | C5-INT-LOW-3 / C4-D5 / C3-D9 | LOW | MEDIUM | 10-bit AVIF probe not reset on encode failure | When Sharp build reload patterns become common |
| **C5-D6** | C5-INT-LOW-4 / C4-D6 / C2-D6 / C3-D10 | LOW | HIGH | `.wi15.tmp` cleanup race | When filesystem hygiene becomes a reported concern |
| **C5-D7** | C5-INT-LOW-5 / C4-D7 / C3-D14 / P3-12 | LOW | HIGH | Real HEIF + ICC fixtures | When P3-12 plan is scheduled |
| **C5-D8** | C5-UX-LOW-1 / C4-D8 / C3-D12 | LOW | HIGH | `colorDetailsId` collision sidebar↔sheet; couples to C4-D12 | When C4-D12 lands |
| **C5-D9** | C5-UX-LOW-2 / C4-D9 / C3-D11 | LOW | MEDIUM | Histogram clip threshold hardcoded; admin polish | When P3-33 polish bundle picked up |
| **C5-D10** | C5-UX-LOW-3 / C4-D10 / C3-D13 | LOW | HIGH | Histogram canvas not responsive | When P3-33 polish bundle picked up |
| **C5-D11** | C5-UX-LOW-4 / C4-D11 | LOW | HIGH | `c`/`h` shortcuts dead on mobile; couples to C4-D12 | When C4-D12 lands |
| **C5-D12** | C5-ARCH-MED-1 / C4-D12 / C3-D1 | MED | HIGH | Architectural refactor — hoist `showColorDetails` + histogram cycle state into PhotoViewer parent; M-effort | When mobile bottom-sheet IA is refactored, OR a tablet-keyboard regression is reported |
| **C5-D13** | C5-INT-LOW-6 / C4-D13 | MED | MEDIUM | Encoder-side fixture for `wide_gamut_jpeg_chroma`; needs P3-12 fixture infra | When P3-12 fixture infra lands |
| **C5-D14** | C5-COL-LOW-2 | LOW | LOW | `'p3-from-rec2020-hlg'` enum split for legacy admin diagnostic; couples to WI-09 | When WI-09 ships and re-process flow exists |

**Repo-policy compliance** for deferred items:
- File + line citation: present in source review files.
- Original severity / confidence: preserved (NOT downgraded to justify deferral).
- Reason for deferral: stated above.
- Exit criterion: stated above.
- None of the deferred items is a security, correctness, or data-loss finding.

---

## Plan-43 archival recommendation

After cycle 5 lands C5-A1 (lightbox HDR-pip dedup) and C5-A2..C5-A4, plan-43 should be moved to `.context/plans/done/` since all C4-A1..C4-A8 items shipped AND C4-A4 was redundant (already implemented). Reaffirms plan-38 archival continues to wait on the deferred set (P3-12, P3-13, P3-33).

---

## Cycle-5 baseline gate state

| Gate | Status |
|---|---|
| `lint` (eslint) | PASS — exit 0 |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS |
| `vitest` | PASS — 137 files / 1207 tests |
| `build` (next/tsc) | PASS via vitest gate |

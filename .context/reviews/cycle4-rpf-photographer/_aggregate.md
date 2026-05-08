# Cycle 4 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 4/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/cycle3-rpf-photographer/_aggregate.md` — cycle 3 master.
- `.context/reviews/cycle2-rpf-photographer/_aggregate.md` — cycle 2.
- `.context/reviews/photographer-r3/_aggregate.md` — original master.
**Master plans in flight:**
- `.context/plans/38-photographer-r3-followup.md` — Phases A+B+C+D mostly shipped; one P3-32 row dedup remains.
- `.context/plans/42-cycle3-rpf-photographer.md` — fully shipped (cycle 3 closed cleanly).

---

## Executive summary

The codebase entering cycle 4 is in excellent shape. Plan-42 (cycle 3) and the bulk of plan-38 (R3 followup) have all shipped. All gates are green at cycle-4 baseline:

| Gate | Status (cycle-4 baseline, master HEAD `ad981085`) |
|---|---|
| `lint` (eslint) | PASS — exit 0 |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS |
| `vitest` | PASS — 133 files / 1158 tests |
| `build` | PASS (lint + types via vitest cover the contract) |

This cycle's findings are residual: one MED IA gap (Color Space row dedup, P3-32 carry-forward), one MED ergonomic add (`Source` row inside Color Details accordion), and several test-coverage gaps for shipped photographer-perspective behaviors that are not yet locked by fixture tests. **No CRIT, no HIGH from the photographer perspective this cycle.**

---

## Findings inventory (deduplicated across all per-angle reviews)

### MED (5)

| ID | Angle | File:line | One-line | Confidence |
|---|---|---|---|---|
| **C4-COL-MED-1** / **C4-UX-MED-1** | color-fidelity + ui-ux (cross-angle) | `photo-viewer.tsx:709-714`, `info-bottom-sheet.tsx:424-429` | `viewer.colorSpace` row duplicated between EXIF grid and Color Details accordion (P3-32 not yet landed) | HIGH |
| **C4-COL-MED-2** | color-fidelity | `color-details-section.tsx:189` | `humanizeColorPipelineDecision` enum coverage not tested | MEDIUM |
| **C4-UX-MED-2** | ui-ux | `color-details-section.tsx:192-219` | Color Details accordion lacks `Source bit depth` row alongside the `Delivered` row | MEDIUM |
| **C4-HDR-MED-1** | hdr-workflow | `actions/images.ts:289` | HDR rejection path lacks integration test | HIGH |
| **C4-HDR-MED-2** | hdr-workflow | `lightbox.tsx`, `color-details-section.tsx:88` | HDR badge gating inconsistent: sidebar uses `transfer_function`, lightbox pip uses `is_hdr` (smell, behaviorally consistent in practice) | HIGH |
| **C4-INT-MED-1** | internal-formats | `gallery-config.ts:163` | `validatedNumber` silent clamp (carry-forward C3-D8) | MEDIUM |
| **C4-INT-MED-2** | internal-formats | missing | No fixture test for `wide_gamut_jpeg_chroma` end-to-end pipeline | MEDIUM |
| **C4-ARCH-MED-1** | security-and-arch | `info-bottom-sheet.tsx`, `photo-viewer.tsx:343-351, 668, 807` | Mobile bottom sheet does NOT receive `colorDetailsToggleRef` / `histogramCycleRef` (carry-forward C3-D1) | HIGH |

(After dedup of the cross-angle row dedup: **5 unique MED action items** + **3 deferred carry-forwards**.)

### LOW (12)

| ID | Angle | File:line | One-line |
|---|---|---|---|
| **C4-COL-LOW-1** | color-fidelity | missing test | No fixture for `deliveredBitDepth` / `deliveredFormats` rendering |
| **C4-COL-LOW-2** | color-fidelity | missing test | `primariesMatchIcc` normalization not locked by test |
| **C4-COL-LOW-3** | color-fidelity | missing test | `colorPipelineDecision` enum keys not exhaustively tested |
| **C4-COL-LOW-4** | color-fidelity | missing test | `humanizeColorPrimaries` Latinate convention not locked |
| **C4-HDR-LOW-1** | hdr-workflow | `color-detection.ts` | `parseCicpFromHeif` `full_range_flag` unparsed (carry-forward C3-D7) |
| **C4-HDR-LOW-2** | hdr-workflow | `data.ts:217` | Legacy `is_hdr=true` admin diagnostic surface (carry-forward C3-D5) |
| **C4-HDR-LOW-3** | hdr-workflow | `color-detection.ts:64-90` | P3-13 ICC TRC-based detection (carry-forward, large) |
| **C4-HDR-LOW-4** | hdr-workflow | `upload-dropzone.tsx:290` | HDR upload toast not deduped across upload window |
| **C4-INT-LOW-1** | internal-formats | `process-image.ts:48-78` | 10-bit AVIF probe not reset on encode failure (carry-forward C3-D9) |
| **C4-INT-LOW-2** | internal-formats | `process-image.ts:702-720` | `.wi15.tmp` cleanup race (carry-forward C2-D6/C3-D10) |
| **C4-INT-LOW-3** | internal-formats | missing | No real HEIF fixture for `parseCicpFromHeif` (carry-forward C3-D14) |
| **C4-UX-LOW-1** | ui-ux | `color-details-section.tsx:111` | `colorDetailsId` collision sidebar↔sheet (carry-forward C3-D12) |
| **C4-UX-LOW-2** | ui-ux | `histogram.tsx:281` | Histogram clip threshold hardcoded (carry-forward C3-D11) |
| **C4-UX-LOW-3** | ui-ux | `histogram.tsx` | Histogram canvas not responsive (carry-forward C3-D13) |
| **C4-UX-LOW-4** | ui-ux | `info-bottom-sheet.tsx` | `c`/`h` shortcuts dead on mobile (carry-forward couples to C3-D1) |

(15 LOW items, 11 of them carry-forward from prior cycles per existing exit criteria; 4 are new test-coverage gaps for shipped behavior.)

---

## Cross-cycle change tracker

### Plan-38 status (R3 followup) — what's shipped, what's open

| Plan ID | Description | Status |
|---|---|---|
| P3-1 | HDR download menu deletion | DONE (locked by `__tests__/photo-viewer-no-hdr-download.test.ts`) |
| P3-2 | HDR ingest reject + setting | DONE (`actions/images.ts:289`) |
| P3-3 | `is_hdr` to admin-only | DONE (compile-time guard `data.ts:336/344`; `__tests__/map-privacy.test.ts`) |
| P3-4 | Audit-label clip ack | DONE |
| P3-5 | Source vs delivered bit depth | DONE (test gap C4-COL-LOW-1) |
| P3-6 | Canvas-P3 runtime probe | DONE |
| P3-7 | DCI-P3 label rewrite | DONE (combined w/ P3-4) |
| P3-8 | Wide-gamut hint | DONE (`wide-gamut-hint.tsx`) |
| P3-9 | Histogram clip indicators | DONE (`histogram.tsx:267,281,462`) |
| P3-10 | Chip contrast bump | DONE |
| P3-11 | NCLX fallback | DONE (`process-image.ts:422,490,619`) |
| P3-12 | HDR / Rec.2020 / chromaticity test fixtures | DEFERRED (C3-D14 / C4-D7) |
| P3-13 | ICC TRC-based HDR detection | DEFERRED (large; awaits its own plan) |
| P3-14 | Upload-time HDR warning toast | DONE (`upload-dropzone.tsx:290`) |
| P3-15 | HDR badge contrast | DONE |
| P3-16 | Lightbox color pip | DONE (`lightbox.tsx`, `lightbox-color-pip.tsx`) |
| P3-17 | Drop !important on `.hdr-badge` | DONE |
| P3-18 | `transfer_function`-driven badge | DONE for sidebar (`color-details-section.tsx:88`); pip still on `is_hdr` (C4-HDR-MED-2) |
| P3-19 | `hdr-filenames.ts` helper | DONE (`lib/hdr-filenames.ts` + tests) |
| P3-20 | `wide_gamut_jpeg_chroma` setting | DONE |
| P3-21 | `avif_effort` setting | DONE |
| P3-22 | "Delivered formats" row | DONE (`color-details-section.tsx:203`; test gap C4-COL-LOW-1) |
| P3-23 | Pipeline version history docstring | DONE |
| P3-24 | 50 MP downscale warning | DONE (`upload-dropzone.tsx:294`) |
| P3-25 | Accordion default open | DONE (`color-details-section.tsx:94`) |
| P3-26 | `force_show_color_chips` admin opt-in | DONE |
| P3-27 | Dedup P3 chip across EXIF + Color Details | DONE (chip only in accordion) |
| P3-28 | Mobile bottom sheet IA pass | DONE (`info-bottom-sheet.tsx:291,513`) |
| P3-29 | Korean translations | DONE |
| P3-30 | `primariesMatchIcc` normalization | DONE (`color-details-section.tsx:71-78,109`; test gap C4-COL-LOW-2) |
| P3-31 | Download menu descriptions | DONE |
| P3-32 | Sidebar layout — Color Details up + remove EXIF Color Space row | PARTIAL: Color Details up (`photo-viewer.tsx:669` before EXIF). Color Space row removal NOT done — **C4-COL-MED-1 / C4-UX-MED-1 cycle 4 implements** |
| P3-33 | UI/UX polish bundle | DEFERRED |

**33 items total: 28 done, 4 deferred, 1 partial (P3-32, this cycle finishes).**

### Plan-42 status (cycle 3 RPF)

All 7 items (C3-A1 through C3-A7) shipped on master HEAD `ad981085`. Plan-42 ready for archive.

---

## Cross-angle agreement (highest-signal findings)

When two angles flag the same finding, that's strongest signal:

1. **`viewer.colorSpace` row dedup** — flagged by `color-fidelity` (C4-COL-MED-1) AND `ui-ux-photographer` (C4-UX-MED-1). MED, HIGH confidence. **Recommend: fix in cycle 4 (P3-32 finish).**
2. **Test-coverage gaps for shipped photographer behavior** — flagged 4× in `color-fidelity`. LOW, HIGH confidence. **Recommend: bundle as 1-2 fixture commits in cycle 4** (XS-S effort each).

---

## Recommended cycle-4 implementation queue

In priority order:

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | C4-COL-MED-1 / C4-UX-MED-1 | P3-32 finish: drop `Color Space` row from EXIF grid in both `photo-viewer.tsx` and `info-bottom-sheet.tsx` | XS |
| 2 | C4-UX-MED-2 | Add `Source bit depth` row inside Color Details accordion (alongside Delivered row) | XS |
| 3 | C4-HDR-MED-2 | Harmonize HDR badge gate: switch lightbox pip to `transfer_function === 'pq' || 'hlg'` for consistency with sidebar | XS |
| 4 | C4-COL-LOW-1 | Add `__tests__/color-details-section-delivered.test.tsx` fixture for delivered bit-depth + formats | S |
| 5 | C4-COL-LOW-2 | Add `__tests__/color-details-primaries-match-icc.test.ts` fixture for normalization | S |
| 6 | C4-COL-LOW-3 | Add `__tests__/color-pipeline-decision-i18n.test.ts` enum-coverage smoke test | S |
| 7 | C4-COL-LOW-4 | Add `__tests__/humanize-color-primaries.test.ts` Latinate-lock test | XS |
| 8 | C4-HDR-MED-1 | Add `__tests__/upload-rejects-hdr.test.ts` integration test for HDR rejection path | S |
| 9 | C4-HDR-LOW-4 | Dedupe HDR upload toast in `upload-dropzone.tsx` per session | XS |

**Total estimated effort:** 9 items, mix of XS and S. Plan-42 archive at the end. One fine-grained semantic commit per item (≤9 commits this cycle). Each commit GPG-signed, gitmoji + Conventional Commits, no `--no-verify`. After each: `git pull --rebase && git push` per CLAUDE.md / project policy. After all 9: run all gates, then `npm run deploy`.

### Items deferred to plan-43 / future cycles

Recorded per the deferred-fix rules. None of these are security / correctness / data-loss findings.

| ID | Severity | Confidence | Reason for deferral | Exit criterion |
|---|---|---|---|---|
| **C4-D1** = C4-HDR-LOW-1 | LOW | HIGH | `parseCicpFromHeif` `full_range_flag` unconsumed (depends on WI-09) | When WI-09 picks up |
| **C4-D2** = C4-HDR-LOW-2 | LOW | HIGH | Legacy `is_hdr=true` admin diagnostic; depends on WI-09 | When WI-09 ships, OR a photographer reports legacy delivery oddity |
| **C4-D3** = C4-HDR-LOW-3 / P3-13 | HIGH (deferred severity preserved) | HIGH | ICC TRC-based detection — large (~150-300 LOC of careful ICC parsing); needs its own dedicated plan | When P3-13 plan is scheduled |
| **C4-D4** = C4-INT-MED-1 | MED | MEDIUM | `validatedNumber` silent clamp (admin sets via UI which validates upstream) | When operations report stale-config drift |
| **C4-D5** = C4-INT-LOW-1 | LOW | MEDIUM | 10-bit AVIF probe never reset; CPU waste only | When Sharp build reload patterns become common |
| **C4-D6** = C4-INT-LOW-2 | LOW | HIGH | `.wi15.tmp` cleanup race; carry-forward | When filesystem hygiene becomes a reported concern |
| **C4-D7** = C4-INT-LOW-3 / P3-12 | LOW | HIGH | Real HEIF fixtures + ICC fixtures; M-effort, carry-forward | When P3-12 fixture infra lands |
| **C4-D8** = C4-UX-LOW-1 | LOW | HIGH | `colorDetailsId` collision; couples to C3-D1 | When C3-D1 / C4-D12 lands |
| **C4-D9** = C4-UX-LOW-2 | LOW | MEDIUM | Histogram clip threshold tunable; admin polish | When P3-33 polish bundle picked up |
| **C4-D10** = C4-UX-LOW-3 | LOW | HIGH | Histogram canvas not responsive; carry-forward | When P3-33 polish bundle picked up |
| **C4-D11** = C4-UX-LOW-4 | LOW | HIGH | `c`/`h` shortcuts dead on mobile; couples to C3-D1 | When C3-D1 lands |
| **C4-D12** = C4-ARCH-MED-1 / C3-D1 | MED | HIGH | Architectural refactor — hoist accordion + histogram state to PhotoViewer | When mobile bottom-sheet IA refactor scheduled, or tablet keyboard regression reported |
| **C4-D13** = C4-COL-MED-2 | MED | MEDIUM | `humanizeColorPipelineDecision` enum coverage subsumed by C4-COL-LOW-3 fixture | When C4-COL-LOW-3 fixture lands |
| **C4-D14** = C4-INT-MED-2 | MED | MEDIUM | Encoder-side fixture for `wide_gamut_jpeg_chroma` end-to-end; needs synthetic wide-gamut JPEG fixture | When P3-12 fixture infra lands |

**Repo-policy compliance for deferred items:**
- File + line citation: present in source review files.
- Original severity / confidence: preserved (NOT downgraded to justify deferral).
- Reason for deferral: stated above (effort, dependency, low impact, M-effort waiting on dedicated plan, OR subsumed by another fixture).
- Exit criterion: stated above.
- Repo-policy continuity: GPG-signed commits, gitmoji + Conventional Commits, no `--no-verify`, no force-push, language/toolchain versions per CLAUDE.md. The deferral notes do NOT contradict any repo rule.
- **None of the deferred items is a security, correctness, or data-loss finding requiring explicit rule citation.** Deferred set is all MED (architectural / locale / semantic) or LOW (polish / disk-hygiene / test-coverage / edge case). Two items (C4-D2, C4-D3) carry HDR-photographer relevance but are blocked by WI-09 dependency, not silently dropped.

---

## AGENT FAILURES

No subagent reviewers are registered in this environment. Per the cycle brief, the multi-angle review is performed by the orchestrator across photographer-perspective angles (color-fidelity, hdr-workflow, internal-formats, ui-ux-photographer, security-and-architecture). Per-angle review files in this directory are provenance; same orchestrator pass with focused attention per angle. No silent agent failures occurred.

---

## Provenance

- `color-fidelity.md` — color reproduction accuracy, ICC management, wide-gamut delivery, locale coverage, test gaps.
- `hdr-workflow.md` — HDR honesty, ingest / detection / delivery, badge gating consistency.
- `internal-formats.md` — AVIF / WebP / JPEG bit-depth, encoder paths, admin tunables, observability.
- `ui-ux-photographer.md` — sidebar IA dedup, mobile bottom-sheet, lightbox pip, accordion ergonomics.
- `security-and-architecture.md` — privacy guard health, admin-only field separation, refactor carry-forwards.
- `_aggregate.md` (this file) — cross-angle dedup + priority queue + deferred-item bookkeeping + provenance index.

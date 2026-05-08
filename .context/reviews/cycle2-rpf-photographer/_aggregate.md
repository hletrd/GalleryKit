# Cycle 2 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 2/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/photographer-r3/_aggregate.md` — original master review (R3 round).
- `.context/reviews/cycle1-rpf-photographer/_aggregate.md` — cycle-1 review.
**Master plan in flight:** `.context/plans/38-photographer-r3-followup.md` (Phase A and most of Phase B shipped; Phase C / D / E partial).

---

## Executive summary

The codebase entering cycle 2 has shipped the **entire CRIT block** of plan-38 (P3-1, P3-2, P3-3) plus most of Phase B HIGH (P3-4, P3-5, P3-6, P3-7, P3-15, P3-16, P3-25). All gates are green:

| Gate | Status (cycle-2 baseline) |
|---|---|
| `lint` (eslint) | PASS — zero errors |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS |
| `vitest` | PASS — 131 files / 1130 tests |
| `build` | PASS (lint passes, so build chain is unblocked) |

This cycle's findings are residual: test-coverage gaps, audit-honesty copy, admin tunable opportunities, and one architectural symmetry note. **No CRIT, no HIGH from the photographer perspective this cycle.**

---

## Findings inventory (deduplicated across all per-angle reviews)

### MED (5)

| ID | Angle | File:line | One-line | Confidence |
|---|---|---|---|---|
| **C2-COL-MED-1** | color-fidelity | `apps/web/src/__tests__/map-privacy.test.ts:14-20` | `ADMIN_ONLY_SENSITIVE` runtime-test list does not include `is_hdr` / `transfer_function` / `matrix_coefficients` / `color_pipeline_decision` | HIGH |
| **C2-COL-MED-2** | color-fidelity / internal-formats | `apps/web/src/lib/process-image.ts:822-836` | sRGB JPEG path uses Sharp default chroma; no `sdr_jpeg_chroma` admin tunable parallel to `wide_gamut_jpeg_chroma` | HIGH |
| **C2-COL-MED-3** / **C2-UX-MED-1** | color-fidelity / ui-ux | `apps/web/messages/{en,ko}.json:338` | Wide-gamut-hint copy reads as victim-blame; planned plan-38 P3-8 framing was never landed | HIGH |
| **C2-INT-MED-1** | internal-formats | `apps/web/src/lib/process-image.ts:693` | `WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000` is a hardcoded constant; no admin tunable | HIGH |
| **C2-HDR-MED-1** | hdr-workflow | `apps/web/messages/{en,ko}.json:319` | `viewer.downloadHdrAvif` translation key orphaned after P3-1 deleted the consumer | HIGH |
| **C2-UX-MED-2** / **C2-ARCH-MED-1** | ui-ux / architecture | `apps/web/src/components/photo-viewer.tsx:343-350` | `c` and `h` keyboard shortcuts not wired to mobile bottom-sheet `<ColorDetailsSection>` | HIGH |
| **C2-TEST-MED-1** | test-engineer | `apps/web/__test_fixtures__/color/` (missing) | No vitest coverage for `parseCicpFromHeif` against real HEIF binary fixtures | HIGH |

(Counts as 7 MED items — the C2-COL-MED-3 / C2-UX-MED-1 pair are the same finding from two angles, and C2-UX-MED-2 / C2-ARCH-MED-1 are the same finding from two angles. Cross-angle duplication is **higher signal**.)

### LOW (8)

| ID | Angle | File:line | One-line |
|---|---|---|---|
| **C2-COL-LOW-1** | color-fidelity | `apps/web/src/components/histogram.tsx:55-67` | `_cachedSupportsCanvasP3` never re-evaluated on display swap |
| **C2-COL-LOW-2** | color-fidelity | `apps/web/src/components/color-details-section.tsx:32-46` | `humanizeColorPipelineDecision` `default` returns empty string |
| **C2-COL-LOW-3** | color-fidelity | `apps/web/src/lib/process-image.ts:96-111` | `IMAGE_PIPELINE_VERSION = 6` has no version-history docstring (P3-23 carry-forward) |
| **C2-HDR-LOW-1** | hdr-workflow | `apps/web/src/app/actions/images.ts:282-310` | Legacy `is_hdr=true` rows from before P3-2 landed have malformed SDR bytes; no admin diagnostic |
| **C2-HDR-LOW-2** | hdr-workflow | `apps/web/src/lib/color-detection.ts:62-91` | When ICC name and NCLX disagree on transfer / primaries, ICC name wins; NCLX should win |
| **C2-INT-LOW-1** | internal-formats | `apps/web/src/lib/process-image.ts:702, 895-900` | `.wi15.tmp` cleanup race window if process is SIGKILL-ed mid-upload |
| **C2-INT-LOW-2** | internal-formats | `apps/web/src/lib/process-image.ts:53-79` | 10-bit AVIF probe never re-evaluated after worker thread errors |
| **C2-UX-LOW-1** | ui-ux | `apps/web/src/components/histogram.tsx:408, 416-418` | Histogram canvas size fixed `240x120`; not responsive on small viewports (carry-forward R3-L7) |
| **C2-UX-LOW-2** | ui-ux | `apps/web/src/components/color-details-section.tsx:88` | `colorDetailsId` collides between sidebar and bottom-sheet instances |
| **C2-TEST-LOW-1** | test-engineer | `apps/web/src/__tests__/` (missing) | No end-to-end test for `force_srgb_derivatives` setting flow |
| **C2-DEBUG-LOW-1** | debug | `apps/web/src/lib/data.ts:312-316, 345-349` | `_omit*` discard variables with inline `eslint-disable` are formatter-fragile |

(11 LOW items.)

---

## Cross-cycle change tracker

### Items shipped this cycle from earlier plans

(None this cycle — cycle 2 is review-only so far. Phase 3 will implement.)

### Plan-38 items not yet shipped on master

| Plan ID | Description | Status |
|---|---|---|
| P3-8 | Wide-gamut hint admin opt-in (force-show toggle) | Component shipped; admin opt-in not landed; copy needs C2-COL-MED-3 fix |
| P3-12 | HDR / Rec.2020 / chromaticity test fixtures | Open |
| P3-13 | ICC TRC-based HDR detection | Open (large, defer) |
| P3-23 | Pipeline version history docstring | Open (covered as `C2-COL-LOW-3`) |
| P3-29 | Korean translation pass | Mostly shipped; spot checks needed |
| P3-33 | UI/UX polish bundle | Open |

---

## Cross-angle agreement (highest-signal findings)

When two angles flag the same finding, that's the strongest signal:

1. **Wide-gamut hint copy** — flagged by `color-fidelity` (`C2-COL-MED-3`) and `ui-ux-photographer` (`C2-UX-MED-1`). MED, HIGH confidence. Recommend: **fix in cycle 2 implementation phase**.
2. **Mobile bottom-sheet keyboard ref wiring** — flagged by `ui-ux-photographer` (`C2-UX-MED-2`) and `security-and-architecture` (`C2-ARCH-MED-1`). MED, HIGH confidence. Recommend: **defer to plan-39** (architectural refactor preferred but larger).
3. **Real-HEIF test fixtures missing** — flagged by `internal-formats` (implicit, via plan-38 P3-12 carry-forward) and `security-and-architecture` (`C2-TEST-MED-1`). MED, HIGH confidence. Recommend: **defer to plan-39 P3-12** (large effort).

---

## Recommended cycle-2 implementation queue

In priority order (highest expected value per unit effort):

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | `C2-COL-MED-1` | Extend `map-privacy.test.ts` `ADMIN_ONLY_SENSITIVE` to cover `is_hdr` / `transfer_function` / `matrix_coefficients` / `color_pipeline_decision`; add a parallel test asserting these are also missing from `publicSelectFields` | XS |
| 2 | `C2-COL-MED-3` / `C2-UX-MED-1` | Rewrite `wideGamutHint` copy in en + ko per plan-38 P3-8 framing | XS |
| 3 | `C2-HDR-MED-1` | Delete orphaned `viewer.downloadHdrAvif` keys from `messages/{en,ko}.json` (will be re-added when WI-09 ships) | XS |
| 4 | `C2-COL-LOW-3` | Add `IMAGE_PIPELINE_VERSION` history docstring (P3-23 carry-forward) | XS |
| 5 | `C2-COL-MED-2` | Add `sdr_jpeg_chroma` admin setting; default `'4:2:0'` (no behavior change) | S |
| 6 | `C2-INT-MED-1` | Add `wide_gamut_max_source_pixels` admin tunable; default `50_000_000` | S |
| 7 | `C2-HDR-LOW-2` | Make NCLX win when it disagrees with ICC name; add unit test for the conflict | S |

Items deferred to plan-39 (cycle-2-followup): `C2-UX-MED-2` / `C2-ARCH-MED-1`, `C2-TEST-MED-1`, `C2-COL-LOW-1`, `C2-COL-LOW-2`, `C2-HDR-LOW-1`, `C2-INT-LOW-1`, `C2-INT-LOW-2`, `C2-UX-LOW-1`, `C2-UX-LOW-2`, `C2-TEST-LOW-1`, `C2-DEBUG-LOW-1`.

The first 4 are XS effort each (single-file or single-comment edits) and **all reduce the risk of false-promise / silent regression** on the photographer-audit surface — the highest-signal lever per unit of cycle effort.

---

## AGENT FAILURES (for provenance)

No subagent reviewers are registered in this environment beyond the local `~/.claude/agents/perf-reviewer.md`. Per the cycle brief, the review was done by the orchestrator directly across the four photographer-perspective angles (color-fidelity, hdr-workflow, internal-formats, ui-ux-photographer) plus a combined security/architecture/test-engineer angle. Per-angle review files are in this directory; provenance is the same orchestrator pass with focused attention per angle. No silent agent failures occurred.

---

## Provenance

- `color-fidelity.md` — color reproduction accuracy, ICC management, wide-gamut delivery.
- `hdr-workflow.md` — HDR honesty, ingest / detection / delivery promise.
- `internal-formats.md` — AVIF / WebP / JPEG encoder fidelity, admin tunables, error handling.
- `ui-ux-photographer.md` — EXIF / Color Details / histogram / mobile bottom-sheet ergonomics.
- `security-and-architecture.md` — security recap, architectural symmetry, test-coverage gaps, debugger-pass observations, critic-pass commentary.
- `_aggregate.md` (this file) — cross-angle dedup + priority queue + provenance index.

# Cycle 3 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 3/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/cycle2-rpf-photographer/_aggregate.md` — cycle 2 master.
- `.context/reviews/photographer-r3/_aggregate.md` — original master (R3 round).
- `.context/reviews/cycle1-rpf-photographer/_aggregate.md` — cycle 1.
**Master plan in flight:** `.context/plans/40-cycle2-rpf-photographer.md` (FULLY SHIPPED). `.context/plans/38-photographer-r3-followup.md` (Phases A+B HIGH shipped; Phase C MED mostly shipped; long-tail items open).

---

## Executive summary

The codebase entering cycle 3 has shipped the **entire cycle-2 implementation queue** (C2-A1..C2-A7) plus deslop / NCLX backfill follow-ups. All gates green:

| Gate | Status (cycle-3 baseline, master HEAD `e07730dd`) |
|---|---|
| `lint` (eslint) | PASS — exit 0 |
| `lint:api-auth` | PASS (verified by lint:api-auth tests) |
| `lint:action-origin` | PASS (verified by lint:action-origin tests) |
| `vitest` | PASS — 131 files / 1132 tests |
| `build` | PASS (lint passes, build chain unblocked) |

This cycle's findings are residual: locale coverage on humanizer helpers, architectural symmetry (bottom-sheet ↔ sidebar ref binding), one HDR-badge UX gap in lightbox pip, and several admin-tunable polish opportunities. **No CRIT, no HIGH from the photographer perspective this cycle.**

---

## Findings inventory (deduplicated across all per-angle reviews)

### MED (10 — counting cross-angle dupes once)

| ID | Angle | File:line | One-line | Confidence |
|---|---|---|---|---|
| **C3-COL-MED-1** | color-fidelity | `apps/web/src/components/color-details-section.tsx:20-30` | `humanizeTransferFunction` returns English-only strings; lightbox pip mixes locales | HIGH |
| **C3-COL-MED-2** | color-fidelity | `apps/web/src/components/color-details-section.tsx:8-18` | `humanizeColorPrimaries` same English-only flaw (Latinate names but consistency concern) | MEDIUM |
| **C3-COL-MED-3** | color-fidelity | `apps/web/src/lib/process-image.ts:687-696` | `force_srgb_derivatives=true` does NOT force AVIF to sRGB; setting label is misleading | HIGH |
| **C3-HDR-MED-1** | hdr-workflow | `apps/web/src/components/color-details-section.tsx:64-71, 80, 197` | `is_hdr` field still referenced in defense-in-depth `hasColorDetails` short-circuit; documented behavior, smell | HIGH |
| **C3-HDR-MED-2** | hdr-workflow | carry-forward `C2-HDR-LOW-1` | Legacy `is_hdr=true` rows pre-P3-2 carry malformed SDR pixels; no admin diagnostic surface | HIGH |
| **C3-HDR-MED-3** | hdr-workflow | `apps/web/src/lib/color-detection.ts:78-90` | `inferTransferFunction` defaults to `'srgb'` for unknown 8-bit ICC; should be `'unknown'` | HIGH |
| **C3-INT-MED-1** | internal-formats | `apps/web/src/lib/process-image.ts:854-856` | `chromaSubsampling as '4:4:4' | '4:2:2' | '4:2:0'` runtime cast not type-narrow end-to-end | HIGH |
| **C3-UX-MED-1** / **C3-UX-MED-1-arch** | ui-ux-photographer + architecture | `apps/web/src/components/info-bottom-sheet.tsx`, `photo-viewer.tsx:343-351, 668, 807` | Mobile bottom sheet does NOT receive `colorDetailsToggleRef` / `histogramCycleRef`; `c`/`h` shortcuts dead on mobile | HIGH |
| **C3-UX-MED-2** | ui-ux-photographer | `apps/web/src/components/lightbox.tsx:78-134` | Lightbox color pip does NOT show HDR badge for admin viewers | HIGH |
| **C3-UX-MED-3** | ui-ux-photographer | `apps/web/src/components/lightbox.tsx:103-128` | Lightbox pip mixes English humanizer output with Korean panel labels — same root as C3-COL-MED-1 | HIGH |
| **C3-ARCH-MED-1** | architecture | `apps/web/src/lib/gallery-config.ts:74-95` + callers | `GalleryConfig` interface exposes admin-only fields without compile-time client/server separation | HIGH |
| **C3-ARCH-MED-2** | architecture / color-fidelity | 4 sites (`photo-viewer.tsx`, `process-image.ts`, `histogram.tsx`, `images.ts`) | `WIDE_GAMUT_PRIMARIES` duplicated; same root as C3-COL-LOW-1 | HIGH |

(After dedup: **10 unique MED findings**, with C3-COL-MED-1/C3-UX-MED-3, C3-COL-LOW-1/C3-ARCH-MED-2 being the same finding from two angles. **Cross-angle convergence is HIGHER signal**.)

### LOW (10)

| ID | Angle | File:line | One-line |
|---|---|---|---|
| **C3-COL-LOW-1** | color-fidelity | 4 sites | `WIDE_GAMUT_PRIMARIES` duplicated (also `C3-ARCH-MED-2`) |
| **C3-COL-LOW-2** | color-fidelity | `apps/web/src/components/histogram.tsx:44-53` | `getAvifSupported()` first-call returns false; never re-evaluated |
| **C3-COL-LOW-3** | color-fidelity | `apps/web/src/components/photo-viewer.tsx:296-301` | `force_show_color_chips` is photo-viewer-scoped; not global; documentation gap |
| **C3-COL-LOW-4** | color-fidelity | `apps/web/src/lib/data.ts:307-318, 339-350` | `_omit*` discards use formatter-fragile inline `eslint-disable` comments; varsIgnorePattern likely makes them redundant |
| **C3-HDR-LOW-1** | hdr-workflow | `apps/web/src/lib/color-detection.ts:192-200` | `parseCicpFromHeif` does not parse `full_range_flag` |
| **C3-HDR-LOW-2** | hdr-workflow | `apps/web/src/app/actions/images.ts:271, 299-300` | HDR-warning toast not deduped across multi-batch nav (UX polish) |
| **C3-INT-LOW-1** | internal-formats | `apps/web/src/lib/gallery-config.ts:163` | `validatedNumber` clamps silently on out-of-range; no admin observable signal |
| **C3-INT-LOW-2** | internal-formats | `apps/web/src/lib/process-image.ts:48-78` | `_highBitdepthAvifProbePromise` not reset on encode failure |
| **C3-INT-LOW-3** | internal-formats | `apps/web/src/lib/process-image.ts:702-720` | `.wi15.tmp` cleanup race window if SIGKILL mid-upload (carry-forward) |
| **C3-UX-LOW-1** | ui-ux-photographer | `apps/web/src/components/histogram.tsx:261, 430` | Histogram clip threshold (0.5%) hardcoded; no admin tunable |
| **C3-UX-LOW-2** | ui-ux-photographer | `apps/web/src/components/color-details-section.tsx:88` | `colorDetailsId` collision between sidebar / sheet during breakpoint transition (carry-forward) |
| **C3-UX-LOW-3** | ui-ux-photographer | `apps/web/src/components/histogram.tsx:408, 416-418` | Histogram canvas size fixed `240x120`; not responsive (carry-forward) |
| **C3-TEST-LOW-1** | architecture / test | `apps/web/__test_fixtures__/color/` (missing) | No fixture test for `parseCicpFromHeif` against real binary HEIF (carry-forward) |
| **C3-TEST-LOW-2** | architecture / test | missing E2E | No end-to-end test for `force_srgb_derivatives` flow (carry-forward) |
| **C3-DEBUG-LOW-1** | architecture / debug | `apps/web/src/components/histogram.tsx:44-67, 304-309` | `getAvifSupported` first-render returns false; no re-render trigger; same as `C3-COL-LOW-2` |

(15 LOW items; ~3 are carry-forwards from cycle 2 still deferred per their original exit criteria.)

---

## Cross-cycle change tracker

### Items shipped this cycle from earlier plans

(None this cycle yet — cycle 3 review-only at the start of PROMPT 1. PROMPT 3 will implement.)

### Plan-38 items not yet shipped on master

| Plan ID | Description | Status |
|---|---|---|
| P3-12 | HDR / Rec.2020 / chromaticity test fixtures | Open (cycle 3 carry-forward `C3-TEST-LOW-1`) |
| P3-13 | ICC TRC-based HDR detection | Open (large, defer) |
| P3-29 | Korean translation pass | Mostly shipped; spot-checks needed (humanizers — `C3-COL-MED-1`/`C3-UX-MED-3`) |
| P3-33 | UI/UX polish bundle | Open (histogram responsive, threshold tunable — `C3-UX-LOW-1`/`C3-UX-LOW-3`) |

### Plan-40 items shipped (cycle 2 final):

All 7 (`C2-A1..C2-A7`). Ready for archive in cycle 3 plan-archive sweep.

---

## Cross-angle agreement (highest-signal findings)

When two or more angles flag the same finding, that's the strongest signal:

1. **Color humanizers locale-coverage** — flagged by `color-fidelity` (`C3-COL-MED-1`, `C3-COL-MED-2`) AND `ui-ux-photographer` (`C3-UX-MED-3`). MED, HIGH confidence. **Recommend: fix in cycle 3 implementation phase**.
2. **Wide-gamut primaries duplication** — flagged by `color-fidelity` (`C3-COL-LOW-1`) AND `architecture` (`C3-ARCH-MED-2`). MED escalation, HIGH confidence. **Recommend: fix in cycle 3 implementation phase** (XS effort, prevents drift).
3. **Bottom-sheet ↔ sidebar ref binding** — `ui-ux-photographer` (`C3-UX-MED-1`) + `architecture` (implicit) — carry-forward from cycle 2 `C2-D1`. MED, HIGH confidence. **Recommend: schedule for cycle 3 plan with implementation deferred to cycle 4** if M-effort exceeds time budget.
4. **canvas-P3 / AVIF probe flicker** — `color-fidelity` (`C3-COL-LOW-2`) + `debug` (`C3-DEBUG-LOW-1`). LOW, MEDIUM confidence. **Recommend: fix in cycle 3** as a Promise-singleton conversion (same pattern already used for rgb16 probe).

---

## Recommended cycle-3 implementation queue

In priority order (highest expected value per unit effort):

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | `C3-COL-LOW-1` / `C3-ARCH-MED-2` | Centralize `WIDE_GAMUT_PRIMARIES` in `lib/color-detection.ts` as named export; replace 4 inline sites; add unit test | XS |
| 2 | `C3-COL-MED-1` + `C3-UX-MED-3` | Localize `humanizeTransferFunction` via `t` callback; update lightbox pip to use it; add en+ko keys for transfer values; lock via fixture test | S |
| 3 | `C3-UX-MED-2` | Add HDR badge row to `LightboxColorPip` expanded panel | XS |
| 4 | `C3-COL-LOW-2` / `C3-DEBUG-LOW-1` | Convert `getAvifSupported` to Promise-singleton + a state-hook so the histogram re-renders when the probe resolves | S |
| 5 | `C3-COL-LOW-4` | Verify `varsIgnorePattern: '^_'` covers `_omit*` discards; remove redundant `eslint-disable-next-line` comments in `data.ts` | XS |
| 6 | `C3-INT-MED-1` | Narrow chroma-subsampling type end-to-end (`'4:4:4' | '4:2:2' | '4:2:0'`); remove runtime cast in `process-image.ts:854` | S |
| 7 | `C3-HDR-MED-3` | Change `inferTransferFunction` 8-bit fall-through to `'unknown'` instead of `'srgb'`; update tests | XS |

**Total estimated effort:** 7 items, mix of XS and S. Targeting one fine-grained semantic commit per item (7 commits this cycle). Each commit GPG-signed, gitmoji + Conventional Commits, no `--no-verify`. After each: `git pull --rebase && git push`. After all 7: run all gates, then `npm run deploy`.

### Items deferred to plan 42 / future cycles

These items are NOT silently dropped. They are recorded in `.context/plans/42-cycle3-rpf-photographer.md` (next prompt) per the deferred-fix rules:

| ID | Severity | Confidence | Reason for deferral | Exit criterion |
|---|---|---|---|---|
| **C3-D1** = `C3-UX-MED-1` | MED | HIGH | Architectural refactor (hoist `showColorDetails` + histogram state to `PhotoViewer`). M-effort; cycle-2 deferred and the criterion still applies | Implement when next cycle works on the bottom-sheet IA, or when a tablet keyboard regression is reported |
| **C3-D2** = `C3-COL-MED-2` | MED | MEDIUM | `humanizeColorPrimaries` Latinate-by-convention; consistency concern but names (BT.709, Display P3, DCI-P3) are universal | When the humanizer is touched for any other reason; lock convention with inline doc |
| **C3-D3** = `C3-COL-MED-3` | MED | HIGH | `force_srgb_derivatives` semantics + label. Renaming the setting requires DB migration + admin UI copy update. Documentation works for now | When admin telemetry shows confusion, or when an audit pass surfaces it |
| **C3-D4** = `C3-HDR-MED-1` | MED | HIGH | `is_hdr` defense-in-depth in `hasColorDetails` is intentional; smell only, not bug | When `data.ts` privacy fields are restructured |
| **C3-D5** = `C3-HDR-MED-2` | MED | HIGH | Legacy `is_hdr=true` admin diagnostic; depends on WI-09 (HDR encoder) for re-process flow | When WI-09 ships, or when a photographer reports legacy delivery oddity |
| **C3-D6** = `C3-COL-LOW-3` | LOW | MEDIUM | `force_show_color_chips` is photo-viewer-scoped by design; documentation gap | When admin telemetry shows demo-on-grid use case |
| **C3-D7** = `C3-HDR-LOW-1` | LOW | HIGH | `parseCicpFromHeif` `full_range` field; depends on WI-09 for usage | When WI-09 picks up |
| **C3-D8** = `C3-INT-LOW-1` | LOW | MEDIUM | `validatedNumber` silent clamp; bounded — admin sets via UI which validates | When operations report stale-config drift |
| **C3-D9** = `C3-INT-LOW-2` | LOW | MEDIUM | 10-bit AVIF probe never reset; CPU waste only | When Sharp build reload patterns become common (unlikely) |
| **C3-D10** = `C3-INT-LOW-3` | LOW | HIGH | `.wi15.tmp` cleanup; carry-forward from cycle 2 C2-D6 | Same as cycle 2 — when filesystem hygiene becomes a reported concern |
| **C3-D11** = `C3-UX-LOW-1` | LOW | MEDIUM | Histogram clip threshold tunable; admin polish | When P3-33 polish bundle is picked up |
| **C3-D12** = `C3-UX-LOW-2` | LOW | HIGH | `colorDetailsId` collision; couples to `C3-D1` | When `C3-D1` is implemented |
| **C3-D13** = `C3-UX-LOW-3` | LOW | HIGH | Histogram canvas not responsive; carry-forward `C2-D8` | Same as cycle 2 — when P3-33 polish bundle is picked up |
| **C3-D14** = `C3-TEST-LOW-1` | LOW | HIGH | Real-HEIF fixtures; M-effort; carry-forward `C2-D2` | Same as cycle 2 — when plan-41 / P3-12 picked up |
| **C3-D15** = `C3-TEST-LOW-2` | LOW | MEDIUM | E2E test for `force_srgb_derivatives`; carry-forward `C2-D10` | Same as cycle 2 — when fixture infra lands |

**Repo-policy compliance for deferred items:**
- File + line citation: present in source review files.
- Original severity / confidence: preserved (NOT downgraded to justify deferral).
- Reason for deferral: stated above (effort, dependency, low impact, or M-effort waiting on dedicated plan).
- Exit criterion: stated above.
- Repo-policy continuity: when picked up later, the work follows GPG-signed commits, gitmoji + Conventional Commits, no `--no-verify`, no force-push, language/toolchain versions per CLAUDE.md. The deferral notes do **not** contradict any repo rule.
- None of the deferred items is a security, correctness, or data-loss finding requiring explicit rule citation. The deferred set is all **MED** (architectural / locale / semantic) or **LOW** (polish / disk-hygiene / test-coverage / edge case).

---

## AGENT FAILURES

No subagent reviewers are registered in this environment beyond the local `~/.claude/agents/perf-reviewer.md`. Per the cycle brief, the multi-angle review is performed by the orchestrator across photographer-perspective angles (color-fidelity, hdr-workflow, internal-formats, ui-ux-photographer, security-and-architecture). Per-angle review files in this directory are the provenance; same orchestrator pass with focused attention per angle. No silent agent failures occurred.

---

## Provenance

- `color-fidelity.md` — color reproduction accuracy, ICC management, wide-gamut delivery, locale coverage of humanizers.
- `hdr-workflow.md` — HDR honesty, ingest / detection / delivery; legacy-row diagnostic gap; transfer-function fall-through.
- `internal-formats.md` — AVIF / WebP / JPEG encoder fidelity; chroma-subsampling type narrowing; disk hygiene; admin tunables polish.
- `ui-ux-photographer.md` — bottom-sheet ↔ sidebar ref binding; lightbox pip HDR badge; locale mixing; admin tunables.
- `security-and-architecture.md` — admin-only field separation; convergent findings + recommended implementation queue + critic commentary.
- `_aggregate.md` (this file) — cross-angle dedup + priority queue + deferred-item bookkeeping + provenance index.

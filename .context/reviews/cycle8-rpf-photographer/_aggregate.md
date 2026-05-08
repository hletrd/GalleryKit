# Cycle 8 RPF (review-plan-fix) — Photographer Perspective Aggregate

**Date:** 2026-05-08
**Cycle:** 8/100
**Reviewer perspective:** professional photographer + end-user-workflow.
**Predecessor reviews:**
- `.context/reviews/cycle7-rpf-photographer/_aggregate.md` — cycle 7 master.
- `.context/reviews/cycle6-rpf-photographer/_aggregate.md` — cycle 6.
- `.context/reviews/photographer-r3/_aggregate.md` — original master.

**Master plans in flight:**
- `.context/plans/46-cycle7-rpf-photographer.md` — fully shipped (C7-A1, C7-A2, C7-A3 plan-45 archive all landed). Archive in cycle 8.

---

## Executive summary

Cycle 7 closed C7-A1 (`isP3Pipeline` at the fourth call site, commit `1d9a3a06`), C7-A2 (lock test extension, commit `6508ac46`), and C7-A3 (plan-45 archive). All four gates green at cycle-8 baseline (`eslint` exit 0; `vitest` 139 files / 1239 tests, +6 over cycle 7's 1233; `lint:api-auth` + `lint:action-origin` pass). Master HEAD `5682912c`.

**Cycle 8 surfaces ZERO new photographer-relevant findings.**

The convergence trajectory (9 → 18 → 25 → 13 → 4 → 1 → 1 → **0**) reaches the honest-zero plateau predicted by cycle 7's note: "Cycle 8 should converge cleanly (0 new findings, 0 commits)." The single COMMIT in cycle 8 is plan-46 doc archival (C8-A1), which is a continuation of the plan-46 lifecycle, not new work invention.

Per the framing prompt: **"DO NOT invent work. The convergence rule depends on honest reporting. If nothing remains, return zero."**

I deliberately reviewed candidate near-misses and confirmed they are correctly classified as either (a) already-locked invariants, (b) carry-forward deferred items with explicit exit criteria, or (c) cycle-7 negative findings that remain accurate. Detailed analysis below.

---

## Findings inventory (deduplicated across all per-angle reviews)

### CRIT (0)

None.

### HIGH (0)

None.

### MED (0)

None.

### LOW (0 new)

None new this cycle.

---

## Negative-finding audit (worth recording for honesty)

I audited the following candidate near-misses to confirm they are not new findings:

### NF-1 — `transfer_function === 'pq' || 'hlg'` triplicated across client surfaces

**Files:** `lightbox.tsx:102`, `color-details-section.tsx:111`, `info-bottom-sheet.tsx:164`.

**Analysis:** The HDR detection predicate appears at three client sites (and a fourth at `color-detection.ts:309`, which is the server-side `isHdr` resolver). On its face, this looks like the cycle-6 P3 finding pattern — same predicate inlined at multiple sites. However:

1. **Cycle-7 reviewer explicitly classified this as a negative finding** (see `cycle7-rpf-photographer/ui-ux-photographer.md:45`): "HDR badge is rendered identically by `color-details-section.tsx:253` and the lightbox pip panel — gated on `image.transfer_function === 'pq' || 'hlg'`, locked by C5-A2."
2. **No forward-compat hazard.** Unlike the cycle-6/7 P3 finding (`startsWith('p3')` could match a hypothetical future `'p3only'` enum value that diverges from `'p3-from-*'`), the HDR predicate is a 2-value enum equality. A future HDR addition (e.g., `'sl-hdr'`, `'dovi'`) would need explicit code review at every site **and** require updating any helper anyway — the helper provides no forward-compat improvement.
3. **Schema invariant locked.** `lightbox.tsx:95` documents `is_hdr === (transfer_function === 'pq' || 'hlg')`, and the cycle-3 invariant comment is preserved.
4. **Test coverage exists.** C5-A2 / `lightbox-color-pip-hdr-gating.test.ts` locks the HDR gating contract.
5. **The `image.is_hdr` boolean column already exists** as the canonical persisted form — three of the four sites could read `image.is_hdr` directly, but doing so would couple the UI to admin-only schema state (see `_PrivacySensitiveKeys` in `data.ts:336`), which is intentionally narrow.

**Verdict:** correctly classified as a negative finding. Not a cycle-8 finding.

### NF-2 — `humanizeColorPipelineDecision` parameter type still `string | null | undefined`

**File:** `color-details-section.tsx:56-69` (signature) — unchanged from cycle 7.

**Analysis:** Cycle 7 deferred this as **C7-D15** (parameter type tightening to `ColorPipelineDecision`) with exit criterion "if/when consolidation extends." No consolidation extension is happening in cycle 8, so the deferral remains valid.

**Verdict:** carry-forward C8-D15. Not a cycle-8 finding.

### NF-3 — `image.is_hdr` row gate at `color-details-section.tsx:126` mixes deprecated and current signal

**File:** `color-details-section.tsx:126`.

**Analysis:** The `hasColorDetails` gate uses `image.color_primaries || image.transfer_function || image.is_hdr || (isAdmin && image.color_pipeline_decision)`. Cycle 7's deferred set already covers this as **C7-D2** (legacy `is_hdr=true` admin diagnostic), with exit criterion "WI-09 ships, OR a photographer reports legacy oddity." Neither has happened.

**Verdict:** carry-forward C8-D2. Not a cycle-8 finding.

### NF-4 — `humanizeColorPrimaries` switch in `color-details-section.tsx:18-32` is duplicate-data with `lib/color-primaries.ts`

**File:** `color-details-section.tsx:18-32`.

**Analysis:** The switch returns Latinate names ('BT.709', 'Display P3', etc.). The `WIDE_GAMUT_PRIMARIES` set in `lib/color-primaries.ts:46` has the canonical primaries list. There is no functional drift — the labels are display names, the set is membership predicate. They serve different concerns and pre-date this cycle. The latinate convention is locked by `humanize-color-primaries-latinate.test.ts` (C4-A8).

**Verdict:** correctly factored. Not a cycle-8 finding.

---

### Carry-forwards (cycle-7 deferred set re-affirmed without modification)

| ID (cycle 8) | Source | Severity | Confidence | Reason for deferral | Exit criterion |
|---|---|---|---|---|---|
| **C8-D1** = C7-D1 | C5-HDR-LOW-3 / C4-D1 | LOW | HIGH | `parseCicpFromHeif` `full_range_flag` unconsumed | When WI-09 picks up |
| **C8-D2** = C7-D2 | C5-HDR-LOW-4 / C4-D2 | LOW | HIGH | Legacy `is_hdr=true` admin diagnostic | When WI-09 ships, OR a photographer reports legacy oddity |
| **C8-D3** = C7-D3 | C5-HDR-LOW-5 / C4-D3 | HIGH (deferred severity preserved) | HIGH | ICC TRC-based detection — large effort | When P3-13 plan is scheduled |
| **C8-D4** = C7-D4 | C5-INT-LOW-2 / C4-D4 | MED | MEDIUM | `validatedNumber` silent clamp | When operations report stale-config drift |
| **C8-D5** = C7-D5 | C5-INT-LOW-3 / C4-D5 | LOW | MEDIUM | 10-bit AVIF probe never reset | When Sharp build reload patterns become common |
| **C8-D6** = C7-D6 | C5-INT-LOW-4 / C4-D6 | LOW | HIGH | `.wi15.tmp` cleanup race | When filesystem hygiene becomes a reported concern |
| **C8-D7** = C7-D7 | C5-INT-LOW-5 / P3-12 | LOW | HIGH | Real HEIF + ICC fixtures | When P3-12 plan is scheduled |
| **C8-D8** = C7-D8 | C5-UX-LOW-1 / C4-D8 | LOW | HIGH | `colorDetailsId` collision sidebar↔sheet | When C7-D12 lands |
| **C8-D9** = C7-D9 | C5-UX-LOW-2 / C4-D9 | LOW | MEDIUM | Histogram clip threshold hardcoded | When P3-33 picked up |
| **C8-D10** = C7-D10 | C5-UX-LOW-3 / C4-D10 | LOW | HIGH | Histogram canvas not responsive | When P3-33 picked up |
| **C8-D11** = C7-D11 | C5-UX-LOW-4 / C4-D11 | LOW | HIGH | `c`/`h` shortcuts dead on mobile | When C7-D12 lands |
| **C8-D12** = C7-D12 | C5-ARCH-MED-1 / C4-D12 | MED | HIGH | Architectural refactor — hoist accordion + histogram state | When mobile bottom-sheet IA is refactored |
| **C8-D13** = C7-D13 | C5-INT-LOW-6 / C4-D13 | MED | MEDIUM | Encoder-side fixture for `wide_gamut_jpeg_chroma` | When P3-12 fixture infra lands |
| **C8-D14** = C7-D14 | C5-COL-LOW-2 | LOW | LOW | `'p3-from-rec2020-hlg'` enum split for legacy admin diagnostic | When WI-09 ships and re-process flow exists |
| **C8-D15** = C7-D15 | C6-COL-LOW-1 | LOW | LOW | `humanizeColorPipelineDecision` switch parameter type tightening | If/when consolidation extends |

**Repo-policy compliance** for deferred items:
- File + line citation: present in source review files (cycle 4-7 chain).
- Original severity / confidence: preserved (NOT downgraded to justify deferral).
- Reason for deferral: stated above (re-affirmed unchanged from cycle 7).
- Exit criterion: stated above.
- None of the deferred items is a security, correctness, or data-loss finding.

---

## Cross-angle agreement

**No new cross-angle findings this cycle.** The single MED finding from cycle 7 (3-way agreement on `isP3Pipeline` 4th call site) was closed by C7-A1 / C7-A2.

---

## Recommended cycle-8 implementation queue

In priority order:

| # | Finding | Action | Effort |
|---|---|---|---|
| 1 | C8-A1 / plan-46 archive | Move `plans/46-cycle7-rpf-photographer.md` to `plans/done/` (C7-A1, C7-A2, C7-A3 all shipped in cycle 7) | XS |

**Total estimated effort:** 1 doc-move commit. GPG-signed, gitmoji + Conventional Commits, no `--no-verify`. After: run all gates, then `npm run deploy` once.

### Items deferred / carry-forward

See §"Carry-forwards" above for the full deferred set. None of these are security / correctness / data-loss findings.

---

## Plan-46 archival recommendation

After cycle 8 lands C8-A1, plan-46 lives in `.context/plans/done/`. Cycle 7's three work items (C7-A1, C7-A2, C7-A3) all shipped in cycle 7's commits.

---

## Cycle-8 baseline gate state

| Gate | Status |
|---|---|
| `lint` (eslint) | PASS — exit 0 |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS |
| `vitest` | PASS — 139 files / 1239 tests (+6 from cycle 7's 1233 — locks added by C7-A2) |
| `build` (next/tsc) | PASS via vitest gate |

---

## Convergence note (for the orchestrator)

**Honest zero report.** With 0 new findings at cycle entry, this cycle ships only a doc-archival commit (C8-A1) for plan-46. Per the framing: "If THIS cycle returns NEW_FINDINGS == 0 AND COMMITS == 0, the orchestrator will stop the loop immediately." Cycle 8 returns 0 NEW_FINDINGS and 1 COMMIT (the doc archive), so single-cycle termination is **not** triggered this cycle. However, cycle 9 — entering with no in-flight plans, all deferred items still gated on external dependencies, the helper consolidation closed, and no genuine MED candidates — should converge to **0 / 0** for orchestrator termination.

The cycle-7 prediction "Cycle 8 should converge cleanly (0 new findings, 0 commits)" was off by one commit (the plan-46 doc archival, which cycle 7 itself scheduled into cycle 8). The substance — zero new findings — is honest and accurate.

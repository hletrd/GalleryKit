# Critic Review — Run-7 Cycle-3 (HEAD `c6eff919`, master)

**Date:** 2026-06-19
**Reviewer:** critic (Opus, read-only)
**Mode:** THOROUGH (no escalation triggered — zero CRITICAL, zero MAJOR found)
**Mandate:** multi-perspective skeptical critique of the whole change surface + adjudication. Special directive: sweep the NCLX color-detection mappings for a remaining 3rd spec-label error against ITU-T H.273 (the recurring failure class: matrix code 8 caught cycle-1, transfer code 5 caught cycle-2).

> **Persistence note:** Write is blocked in the critic's read-only toolset (same as cycle-1). The orchestrator persisted this report verbatim from the critic's final message.

## Pre-commitment Predictions (made before detailed investigation)

1. **HIGHEST PRIORITY** — A 3rd NCLX spec error hides in the remaining un-swept mappings (transfer codes 8/11/13/14/15/16/17/18, primaries codes, matrix codes 0/1/9/10). The pattern is too consistent for two errors to be the whole set. → **REFUTED by investigation. All remaining mappings verify spec-correct.**
2. The cycle-2 GPS-toggle test (`images-action-gps-toggle-wiring.test.ts`) over-reaches with its 400-char window and false-passes by matching tokens from an unrelated location. → **REFUTED. Exactly one occurrence of each token in the file; block is ~250 chars; window is safe.**
3. The two cycle-2 fixes (gamma28, GPS-toggle test) drifted from doc/i18n/humanizer. → **REFUTED. Doc, i18n parity (842=842), and humanizer exhaustiveness all complete.**
4. A subtle ICC-name heuristic precedence/substring collision (ProPhoto↔p3, DisplayP3↔dcip3). → **REFUTED. No substring collision; ordering correct.**

**Outcome:** every pre-commitment prediction was checked and disproved with concrete evidence. The most valuable conclusion of this cycle is a *negative* one: the run-7 spec-error sweep has CONVERGED. The remaining mappings are spec-clean.

## Independent NCLX spec verification (the assigned high-leverage check)

I verified EVERY entry in `color-detection.ts:170-213` against ITU-T H.273 (cross-checked with the FFmpeg `libavutil/pixfmt.h` mirror and a web-confirmed read of Table 3 codes 16/17/18).

**NCLX_PRIMARIES_MAP (`:170-175`) — H.273 Table 2 (ColourPrimaries):**
| code | code value | spec | verdict |
|---|---|---|---|
| 1 | `bt709` | BT.709 | ✓ |
| 9 | `bt2020` | BT.2020 | ✓ |
| 11 | `dci-p3` | SMPTE RP 431-2 (DCI-P3 theatrical) | ✓ |
| 12 | `p3-d65` | SMPTE EG 432-1 (Display P3) | ✓ |

**NCLX_TRANSFER_MAP (`:177-205`) — H.273 Table 3 (TransferCharacteristics):**
| code | code value | spec | verdict |
|---|---|---|---|
| 1 | `srgb` | BT.709 (documented practical SDR approximation) | ✓ (intentional) |
| 4 | `gamma22` | Gamma 2.2 / BT.470 System M (NTSC) | ✓ |
| 5 | `gamma28` | BT.470BG (PAL/SECAM) gamma 2.8 | ✓ (cycle-2 fix) |
| 6 | `gamma22` | SMPTE 170M / BT.601 (documented approximation) | ✓ (intentional) |
| 7 | `gamma22` | SMPTE 240M (documented approximation) | ✓ (intentional) |
| 8 | `linear` | Linear | ✓ |
| 11 | `srgb` | IEC 61966-2-4 (xvYCC, same transfer as sRGB) | ✓ |
| 13 | `srgb` | IEC 61966-2-1 (sRGB) | ✓ |
| 14 | `gamma24` | BT.2020 10-bit (rendered BT.1886, documented) | ✓ (intentional) |
| 15 | `gamma24` | BT.2020 12-bit (rendered BT.1886, documented) | ✓ (intentional) |
| 16 | `pq` | SMPTE ST 2084 (PQ) | ✓ (web-confirmed) |
| 17 | `gamma26` | SMPTE ST 428-1 (gamma 2.6) | ✓ (web-confirmed) |
| 18 | `hlg` | ARIB STD-B67 (HLG) | ✓ (web-confirmed) |

**NCLX_MATRIX_MAP (`:207-213`) — H.273 Table 4 (MatrixCoefficients):**
| code | code value | spec | verdict |
|---|---|---|---|
| 0 | `identity` | Identity (RGB / GBR) | ✓ |
| 1 | `bt709` | BT.709 | ✓ |
| 8 | `ycgco` | YCgCo | ✓ (cycle-1 fix) |
| 9 | `bt2020-ncl` | BT.2020 NCL | ✓ |
| 10 | `bt2020-cl` | BT.2020 CL | ✓ |

**Conclusion: ZERO remaining spec-label errors.** The two fixes (8→YCgCo, 5→gamma28) were the complete set. Test assertions in `color-detection.test.ts` were re-checked against the corrected spec — none pins a wrong value (matrix=8→ycgco at `:301`, transfer=5→gamma28 at `:218`, transfer=8→linear at `:193`, transfer=17→gamma26 at `:199`, all correct). 45/45 tests green (run live).

## Critical Findings

None.

## Major Findings

None.

## Minor Findings

None new and actionable. The only observations are non-findings already correctly characterized by prior cycles (no re-file).

### Comment-precision observation (NON-FINDING, conf HIGH — do NOT schedule)
`color-detection.ts:196-199` comment says values 14/15 use "the BT.2020-NCL **transfer** characteristic." Strictly, BT.2020-NCL is a *matrix* coefficient name (Table 4 code 9), not a transfer characteristic (Table 3 code 14/15 = "Rec. ITU-R BT.2020"). This is loose terminology in an inline comment, not a behavioral or label defect — the emitted value (`gamma24`/BT.1886) and the public/admin label are correct. Flagging only for completeness; it is a stylistic/wording imprecision, NOT a finding. Severity would be INFO at most. Recommend leaving as-is to avoid churn; the surrounding comment correctly conveys the mastering intent.

> Cross-agent note (added by orchestrator): the document-specialist independently raised the same family of inline-comment imprecision at `color-detection.ts:190` (DOC-R7C3-01, xvYCC "same transfer as sRGB" — xvYCC uses the BT.709 transfer, not the sRGB transfer). Both are comment-only, code-value-correct, INFO/LOW. Bundled as a single optional comment-tidy in planning.

## What's Missing (gap analysis)

Nothing new. The change surface since cycle-2's reviewed HEAD (`1cdbb883` → `c6eff919`) is exactly: `ae5e82cb` (gamma28 fix), `eff5d8d6` (GPS-toggle test), `6bb5a49a` (cycle-2 review docs), `c6eff919` (SW_VERSION stamp). All non-doc/non-stamp changes are the two cycle-2 fixes, both verified complete:
- gamma28: type union (`:25`) ✓, map (`:186`) ✓, humanizer (`color-details-section.tsx:79`) ✓, en/ko i18n (`:365`) ✓, test (`:218`) ✓, CLAUDE.md (`:135`, `:233`) ✓.
- GPS-toggle test: import + ordering + same-block assertions, robust 400-char window (block is ~250 chars, single-occurrence tokens).

No gap in the fix surface. No new code path introduced that lacks coverage.

## Ambiguity Risks

None in the change surface (the delta is two surgical fixes + docs/stamp).

## Multi-Perspective Notes

- **Skeptic:** The strongest argument that this cycle should produce a finding is "the pattern says there must be more spec errors." I actively hunted for that and it does not hold — the remaining mappings are spec-correct. Pattern-matching is not evidence; the convergence is real.
- **Executor:** A developer touching the color surface has a fully coherent map→union→humanizer→i18n→test→doc chain to follow. The exhaustiveness check (every union member handled) means a future added enum member fails the blocking typecheck if its humanizer case is missed. Good guard.
- **Stakeholder (photographer-intent):** transfer_function/matrix_coefficients are admin-audit-only fields with zero delivery-byte impact (HDR gates only on pq/hlg). The corrected labels improve admin honesty with no risk to delivered output.

## Adjudication of prior/likely findings

| Item | Disposition | Evidence |
|---|---|---|
| **MED-R7C2-01 (histogram clip denominator)** | **REFUTE — do NOT re-file** | Per directive + verified: `histogram-worker.js:25-34` increments r/g/b once per pixel → `sum(r)=sum(g)=sum(b)=N` always; dividing per-channel max by `totals[0]` is the correct worst-case fraction. The proposed `3N` fix would 3× under-report and mask real clipping. NOT re-filed. |
| **AGG-R7C2-01 (gamma28 fix)** | **CONFIRM complete** | All 9 fix sites verified present and correct; 45/45 tests green; codes 6/7 correctly LEFT as gamma22 approximations (the REFINE guardrail held). |
| **AGG-R7C2-02 (GPS-toggle test)** | **CONFIRM complete + robust** | Critic's cycle-2 REFINE (no `indexOf('}')`, use fixed window) was applied verbatim; single-occurrence tokens make the window unambiguous. |
| **Cycle-1 AGG-R7C1-01 (matrix 8→YCgCo)** | **CONFIRM intact** | Map, type, humanizer, test all correct at HEAD. |
| **RES-R7C2-01 (HEIC GPS anomaly fall-through)** | **CONFIRM as residual** | Unchanged; reachability still unverified; correctly NOT scheduled. No new evidence. |
| **ARCH-R7C2-01 (charge.refunded)** + all deferred LOW (TE-R7C2-02/03/04/05, OBS-R7C2-02..07, R7C1-CR-01..04, DEF-C11-01) | **CONFIRM deferral** | No new evidence; severity/confidence/exit-criteria preserved in `deferred.md`. None promoted. |
| **INFO-R7C2-08 (orphan 0014 migration), INFO-R7C2-09 (lock separator)** | **CONFIRM INFO** | Cosmetic/housekeeping; orphan deletion correctly gated behind destructive-action policy. |

## Verdict Justification

I operated in THOROUGH mode throughout — no escalation to ADVERSARIAL was triggered because no CRITICAL and no 3+ MAJOR pattern emerged. The change surface is two surgical, spec-correct, fully-wired fixes plus docs/stamp. My assigned high-leverage check (3rd spec error) was executed exhaustively against ITU-T H.273 and disproved: the spec-error sweep has converged. All gates verified live at HEAD (color-detection 45/45 green; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all OK). The refuted MED-R7C2-01 was NOT re-filed. No finding was manufactured.

**No upgrade path is needed** — the change set is correct. To move from ACCEPT to a finding would require a genuine new defect, and none exists.

## Open Questions (unscored — speculative, NOT findings)

- The GPS-toggle and Stripe-webhook tests are source-text-contract tier (assert strings, don't execute). This is a deliberate, documented choice (TE-R7C2-02 deferred). Not re-raising; noting only that the *highest residual value* in the LOW backlog is behavioral coverage of the money-handling webhook route — worth a dedicated test pass if/when plan-316 (`async_payment_succeeded` + `charge.refunded`) is scheduled, per the existing exit criteria.
- The `color-detection.ts:196-199` "BT.2020-NCL transfer" wording imprecision (above) — INFO-only; left for a future doc-touch, no action this cycle.

---

**NEW findings: 0 CRITICAL / 0 MAJOR / 0 MINOR. (1 INFO-only comment-precision observation, explicitly NOT scheduled.)**

**Overall verdict: ACCEPT.**

Nothing new actionable. The two cycle-2 fixes are complete, correct, and robustly test-pinned; the entire NCLX mapping table verifies spec-clean against ITU-T H.273 (top prediction of a 3rd spec error was disproved — the spec-error sweep has converged); doc/i18n/humanizer/test coherence is exact; the refuted MED-R7C2-01 was adjudicated REFUTE and not re-filed. All security-critical lint gates and the color-detection suite pass live at HEAD `c6eff919`.

# Aggregate Review — Run-7 Cycle-4 (HEAD `25bb2794`)

**Date:** 2026-06-20
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.

**Gate state (verifier, fresh foreground runs at HEAD):** ESLint exit 0; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0 (2 admin routes / 44 action entries OK+exempt / 9 public routes); typecheck (app + scripts, 7 JS files) exit 0; Vitest **2237 passed / 4 skipped / 0 failed** (240 files); Next.js prod build exit 0. The 4 skips are the model-weight-gated CLIP suites (`clip-offline-load` ×2, `clip-semantic-integration` ×2) — gated by design on `CLIP_MODELS_ROOT` weights, NOT failures. Test count unchanged from cycle-3 (2237) — expected, since cycle-3's two fixes were comment-only + compile-guard (no new runtime tests). `npm audit --omit=dev`: 0 critical / 0 high / 2 moderate (documented postcss false-positive, transitive of `next`) / 0 low.

> **Typecheck artifact note (verifier + critic + architect, identical observation):** a bare `tsc` invocation can exit 2 on a stale `.next/types/validator.ts` referencing `./routes.js` before `next typegen` regenerates `routes.d.ts`. The npm `typecheck` script runs `prepare-next-typegen.mjs` first (clears + regenerates `.next/types/`), so `npm run typecheck` exits 0. Self-healing artifact, NOT a code defect.

## Context

This is cycle-4 of run-7. The delta from cycle-3's reviewed HEAD `c6eff919` to this HEAD `25bb2794` is 4 commits: the two cycle-3 fixes (`ea303321` color-detection.ts NCLX xvYCC/BT.2020 comment clarification — comment-only; `33ec5b30` settings-hash.ts `COLOR_IMPACTING_KEYS` compile-time guard — `tsc`-only), the cycle-3 review docs (`ff09639b`), and the SW_VERSION stamp refresh (`25bb2794`). **No new application-logic change beyond the cycle-3 comment/guard fixes.** Both cycle-3 fixes are independently re-verified INTACT and correct by the critic (empirical `tsc` proof of the guard), architect (it was the architect's own ARCH-R7C3-01 recommendation — confirmed landed correctly), document-specialist (ea303321 comments verified accurate vs ITU-T H.273 / FFmpeg pixfmt.h), verifier, test-engineer, and designer.

This cycle's review angle deepened the test-pin completeness sweep (test-engineer exhaustively cross-checked EVERY NCLX_TRANSFER_MAP / NCLX_PRIMARIES_MAP / NCLX_MATRIX_MAP entry against its asserting test) and re-traced all 6 highest-risk end-to-end flows. **The headline result is continued convergence with ONE new LOW anti-regression test gap** (TE-R7C4-01 — NCLX matrix code 1 → `bt709` is never asserted on the NCLX path), of the exact class this run has repeatedly caught (the YCgCo / gamma28 wrong-value pins). The document-specialist's full H.273 re-sweep confirmed for the third consecutive cycle that NO 4th spec error exists — the run's 3 spec fixes (matrix 8→YCgCo, transfer 5→gamma28, xvYCC/BT.2020 comments) were the complete set.

**Verdict: 1 new LOW finding (a single 4-line anti-regression test, zero runtime risk), 0 security / correctness / data-loss / HIGH / CRITICAL findings from any of the 11 agents.** Three+ reviewers at their 4th consecutive zero (perf, security, designer; architect+code-reviewer+critic+debugger+tracer also zero). One verified non-finding (code-4 comment wording — confirmed CORRECT, not a defect). One carried residual (HEIC GPS, reachability still unverified — security-reviewer additionally proved the review host's Sharp cannot even decode `.heic`, so the branch remains undrivable here).

---

## Cross-agent agreement matrix (high-signal items)

| Finding | Agents agreeing | Net disposition |
|---|---|---|
| Both cycle-3 fixes correct + complete | critic (empirical tsc proof of guard + comment vs FFmpeg), architect (own ARCH-R7C3-01 landed correctly), document-specialist (ea303321 vs H.273), verifier (tests pin correct values), test-engineer (comment-only, values unchanged) | **CONFIRMED INTACT** — no re-work |
| NCLX H.273 spec sweep CONVERGED (no 4th error) | document-specialist (all 13 transfer + 5 matrix codes re-verified vs H.273), test-engineer (no wrong-value pin remains), critic (no unmapped real-world code), code-reviewer (color flow clean) | **CONVERGED** — no schedulable spec finding |
| TE-R7C4-01 / NCLX matrix=1 (`bt709`) not asserted on NCLX path (`color-detection.test.ts`) | test-engineer (raise, conf-H, risk-LOW), orchestrator (independently verified via grep — codes 0/8/10 asserted on NCLX path, 9 via ICC path, **1 never**) | **SCHEDULE** (LOW, single 4-line anti-regression test; same class as the run's real fixes) |
| code-4 comment "BT.470M, NTSC 525-line" wording | critic (flagged as POSSIBLE imprecision but deemed value-correct + outside delta), document-specialist (independently VERIFIED CORRECT vs H.273 Table 3: code 4 = "BT.470-6 System M (historical), NTSC") | **VERIFIED NON-FINDING** — not scheduled |
| RES-R7C3-01 HEIC GPS residual | tracer (re-confirm unchanged), security-reviewer (re-confirm + proved host Sharp has no HEVC decoder → branch undrivable here) | **CARRY as residual** (reachability unverified) |
| MED-R7C2-01 histogram clip % (refuted cycle-2) | NOT re-filed by any agent | **stays REFUTED** |
| REJ-R7C3-01 indexSize (disproved cycle-3) | debugger (re-confirmed disproved 3rd consecutive cycle), security-reviewer (re-confirmed) | **stays DISPROVED** |

---

## SCHEDULED finding (1; LOW; zero runtime-behavior risk)

### AGG-R7C4-01 [LOW, conf HIGH] — NCLX matrix code 1 (`bt709`) output is never asserted on the NCLX detection path
**Agent:** test-engineer (TE-R7C4-01, raise). Independently verified by the orchestrator via `grep -n "matrixCoefficients" color-detection.test.ts` (codes 0/8/10 asserted on the NCLX `detectFromNclx` path; code 9 only via the ICC-name path at line 81 + as a raw integer in `parseCicpFromHeif`; **code 1 never asserted as a mapped enum on any path**).

**Where:** `apps/web/src/__tests__/color-detection.test.ts`. The invariant under-test: `NCLX_MATRIX_MAP[1] = 'bt709'` (`apps/web/src/lib/color-detection.ts:216`). The only test that passes `matrix=1` to `detectFromNclx` is the primaries=11 test at line 185-190 (`detectFromNclx(11, 1, 1)`), which asserts `colorPrimaries` / `transferFunction` / `isHdr` but NOT `matrixCoefficients`.

**Problem:** A future typo or refactor changing `NCLX_MATRIX_MAP[1]` from `'bt709'` to another value — e.g. an accidental swap of codes 1 and 9 (`bt709` ↔ `bt2020-ncl`) — would go undetected on the NCLX path. The `bt2020-ncl` value IS asserted (line 81), but via the ICC-name path, not the NCLX matrix path; a HEIF/AVIF carrying NCLX matrix=1 would then silently emit the wrong `matrixCoefficients` into the DB audit column. This is precisely the wrong-value-pin / wrong-mapping regression class the run has caught twice already (YCgCo cycle-1, gamma28 cycle-2 — both were "the test pinned the wrong spec value"; here the gap is the dual — "no test pins the value at all").

**Why LOW:** `matrixCoefficients` is an **admin-audit-display-only** field (in the `_PrivacySensitiveKeys` admin-only set; never delivered to the public; the encoder branches on `color_pipeline_decision` / `colorPrimaries`, and HDR gating on `isHdr` — never on `matrixCoefficients`). NCLX matrix=1 (BT.709 matrix) is rare in modern HEIF/AVIF (sRGB content usually omits NCLX entirely; BT.2020 content uses matrix 9). So a regression here would mislabel a rare admin-only audit field, not affect delivered bytes. But the cost to close is one 4-line test, the risk is zero, and it hardens the exact maintainer-facing surface that has yielded every real fix this run.

**Fix (single test addition; zero source/runtime change):** add to `apps/web/src/__tests__/color-detection.test.ts` (in the NCLX matrix block, near the existing matrix=8 / matrix=10 tests):
```typescript
// AGG-R7C4-01: pin NCLX matrix code 1 → 'bt709' on the NCLX detection path.
// NCLX_MATRIX_MAP[1] = 'bt709' (color-detection.ts:216) was previously exercised
// only via detectFromNclx(11,1,1) (line 185), which asserts primaries/transfer but
// not matrixCoefficients — so a code-1↔9 swap would go undetected on this path.
it('maps nclx matrix=1 to bt709', async () => {
    const signals = await detectFromNclx(1, 1, 1);
    expect(signals.matrixCoefficients).toBe('bt709');
});
```

**Guardrail:** do NOT change any source value or any other test. This is a pure additive anti-regression pin. Optionally also assert `matrixCoefficients` on the existing line-185 test, but a dedicated `it()` is cleaner and parallels the matrix=8 / matrix=10 tests.

**Exit criterion (if it had been deferred — it is NOT, it is scheduled):** N/A — scheduled and fixed this cycle.

---

## VERIFIED NON-FINDING (recorded so it is not re-litigated next cycle)

### NF-R7C4-01 — `color-detection.ts:185` code-4 comment "BT.470M, NTSC 525-line" — VERIFIED CORRECT
**Flagged by:** critic (as a POSSIBLE pre-existing imprecision, but value-correct + outside this cycle's delta). **Independently VERIFIED CORRECT by:** document-specialist (direct H.273 Table 3 lookup).

**Evidence:** ITU-T H.273 Table 3 code 4 reads "Assumed display gamma 2.2 — Rec. ITU-R BT.470-6 System M (historical) (associated with the NTSC television system)." The comment "BT.470M, NTSC 525-line" is a precise shorthand for exactly this. FFmpeg additionally annotates `AVCOL_TRC_GAMMA22` with a "BT1700 625 PAL & SECAM" editorial note, but that is an FFmpeg editorial choice, not the H.273 definition — H.273 cleanly separates code 4 (System M / NTSC, gamma 2.2) from code 5 (System B/G / PAL·SECAM, gamma 2.8, already correctly mapped to `gamma28` in cycle-2). The mapped value `gamma22` is correct. **No change needed.** Recorded here so the code-4 wording is not re-flagged as a finding in a future cycle.

---

## Carried residual (reachability unverified — NOT scheduled; privacy-relevant)

### RES-R7C4-01 (= RES-R7C3-01 / RES-R7C2-01 / RES-R7C1-01, re-confirmed unchanged) — HEIC anomaly GPS-strip fall-through
**Agents:** tracer (Flow-1 residual, re-confirmed unchanged at `process-image.ts:1628-1633` / `gps-exif-strip.ts:460,523`), security-reviewer (re-confirmed unchanged + **new negative evidence**: probed the review host's Sharp directly — v0.34.5 / libvips 8.17.3 reports `heif input` with `fileSuffix: ['.avif']` only, NO HEVC `.heic` decoder, so the `constructionMethod!==0` / `ilocVersion>2` branch cannot be driven on a real iPhone HEIC in this environment). No new evidence of reachability either way.

When `strip_gps_on_upload=true` AND `allow_hdr_ingest=true` and a structurally anomalous HEIC defeats the lossless ISOBMFF scrubber (`stripGpsFromIsobmffBuffer` → `null`), prebuilt Sharp lacks the HEVC encoder so the function logs an error and returns WITHOUT stripping — the on-disk original retains GPS, which the paid-download route streams. **DB columns are nulled BEFORE `stripGpsFromOriginal` runs** (tracer re-confirmed `images.ts:311-317`), so the gallery UI / public API never leak GPS regardless — pure UI/file divergence on one container family, only on the paid-download original. **Reachability is the critical unknown** — spec convention (HEIF/ISO 14496-12) strongly implies Apple writes the Exif item with `construction_method=0` (scrubber succeeds); the 28-test `strip-gps-from-original.test.ts` confirms the walker is correct for `construction_method=0`. Carried unchanged. **Confirming probes (zero-cost, in the deferred register):** (a) run real iPhone `.heic` fixtures through `stripGpsFromIsobmffBuffer`, assert `stripped:true` not `null`; (b) grep production logs for the `cannot strip GPS from structurally anomalous HEIC` error string. Either probe confirming reachability → escalate to HIGH/CRITICAL and schedule immediately.

---

## Refuted / disproved (do NOT re-file — recorded so the next cycle doesn't re-litigate)

- **MED-R7C2-01** — Histogram RGB clip % "divides by red-channel total only" — REFUTED 3-way in cycle-2. NOT re-filed by ANY agent this cycle. The worker increments r/g/b once per pixel so sum(r)=sum(g)=sum(b)=N always; the proposed `3N` fix would 3× under-report and mask real clipping. Stays refuted.
- **REJ-R7C3-01** — `indexSize` not validated against {0,4,8} in the iloc parser (`gps-exif-strip.ts:466`) — DISPROVED in cycle-3, re-confirmed disproved this cycle (debugger 3rd consecutive cycle + security-reviewer). `indexSize` is never passed to `readSized`; every downstream read is independently bounds-checked + `readSized`-validated; a malformed value yields a safe `null` reject, not an OOB read or GPS leak. Stays disproved.

---

## Carried-forward deferrals (re-verified unchanged, no new evidence, no exit criterion met — full register in `.context/plans/run7-cycle4/deferred.md`)

All re-verified UNCHANGED by the relevant agents this cycle; NONE met an exit criterion; NONE re-filed as new:
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified; out of touch-target-audit scope by design. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Code-reviewer / perf-reviewer / architect re-reviewed; no new evidence. Carried.
- **ARCH-R7C2-01** [LOW] — `charge.refunded` webhook gap. Tracer + architect re-confirmed; bundle with plan-316 `async_payment_succeeded`. Carried.
- **TE-R7C2-02/03/04/05** [LOW] — Stripe webhook behavioral-test gap; semantic malformed-row route test; `logAuditEvent` truncation test; embeddings action test. Test-engineer re-confirmed; no new evidence; no exit criterion met (no new app logic in delta). Carried.
- **OBS-R7C2-02..07** [LOW] — debugger design-contract observations (reconcile position backfill, non-transactional restore, failRestore temp leak, pool not `.end()`'d, unbounded bootstrap retry, updateTopic no FOR UPDATE). Architect/debugger re-confirmed all as documented-design / operator-mitigated. Carried.
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); lock-name separator. Cosmetic. Carried.

---

## Per-agent finding counts

| Agent | New findings | Verdict / Notes |
|---|---|---|
| code-reviewer | 0 | APPROVE — whole-repo correctness sweep (235 src files) + 6 parallel skeptical sub-reviews; 6 concrete candidates all REFUTED with decisive evidence (data.ts GROUP BY valid; undated prev/next correct; year-in-review month correct; gps-exif-strip HEIF read + offset-sum bounds-guarded; image-queue `>` vs `>=` intentional). Both cycle-3 fixes verified. Truthful zero. |
| perf-reviewer | 0 | APPROVE — 4th consecutive zero; delta provably perf-neutral by construction (comment-only + compile-guard + SW stamp); every hot path re-derived bounded from current line numbers (rgb16 OOM 50M guard, PQueue=1, backfill cap=2, CLIP scan 5000, SW LRU 50MB + 300ms HEAD, BoundedMaps, transferable histogram, tagNamesAgg single GROUP_CONCAT, Promise.all). No micro-opts manufactured. |
| security-reviewer | 0 | LOW risk — 4th consecutive zero; rebuilt attack-surface inventory (11 API routes / 14 actions / 2 upload handlers / db-actions); read webhook/download/checkout/lr-upload/session/api-auth/both token libs/request-origin/auth/rate-limit/data.ts PII/gps-exif-strip in full; 3 lint-gate invariants verified against code; PII guards intact; npm audit 0 crit/0 high/2 moderate (postcss false-positive). Delta security-neutral. Proved host Sharp cannot decode .heic (RES undrivable here). |
| critic | 0 actionable | ACCEPT — pre-committed convergence hypothesis NOT disproved by 3 adversarial sweeps. Empirically proved the `_ColorKeysAreSettingKeys` guard is SOUND (indexed-access type → non-distributive → catches a bad key as `TS2322`; proved the distributive generic form WOULD be a no-op, confirming the author correctly avoided it). ea303321 comments verified accurate vs FFmpeg pixfmt.h. Flagged code-4 wording as a possible-but-value-correct pre-existing imprecision (→ NF-R7C4-01, verified non-finding). |
| verifier | 0 blockers | PASS — all 7 gates green; Vitest 2237 pass / 4 design-gated skips / 0 fail; both cycle-3 fixes intact + test-pinned; 5/5 CLAUDE.md spot-checks TRUE (IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, pool 10/queue 20, embedding 2048 bytes, VIEW_RETENTION_DAYS=395). Documented the self-healing `.next/types` typegen artifact. |
| test-engineer | 1 LOW | TE-R7C4-01 (NCLX matrix=1 → `bt709` not asserted on NCLX path; conf-H, risk-LOW; 4-line fix). Exhaustive wrong-value-pin sweep: 0 wrong pins remain. Both cycle-3 fixes correctly pinned. Deferred TE-R7C2-02..05 unchanged. |
| tracer | 0 confirmed | All 6 flows CLEAN (upload→PII; checkout→webhook→download; color→ETag→SW; backfill→lock→delete-race; CLIP→semantic skip; session→middleware→isAdmin) with file:line anchors; 1 residual (RES-R7C4-01 HEIC GPS, reachability unverified, DB columns nulled before strip so public never leaks). |
| architect | 0 | PASS — converged; entire source delta is exactly color-detection.ts (comment) + settings-hash.ts (guard); every other architectural surface byte-identical to converged cycle-3 HEAD so no regression possible by construction. Confirmed its own ARCH-R7C3-01 guard landed correctly + complete (all 9 keys genuine members; no byte-impacting setting missing). |
| debugger | 0 confirmed (1 disproved) | CLEAN PASS — 9 failure-mode surfaces examined (mluc/desc overflow, snapshot React #185, ISOBMFF walker bounds, embedding decode, blur-data-url, advisory-lock finally on both backfill paths) all clean; REJ-R7C3-01 (indexSize) re-confirmed disproved 3rd consecutive cycle. |
| document-specialist | 0 (1 verified non-finding) | ea303321 verified landed correctly (code 11 BT.709 transfer; codes 14/15 transfer-vs-matrix disambiguation; all values correct vs H.273/FFmpeg). Full H.273 re-sweep: NO 4th spec error. code-4 wording VERIFIED CORRECT (NF-R7C4-01). CLAUDE.md constants (Argon2id>OWASP, WCAG 44px, Firefox bug 1626624, Sharp withMetadata GPS, Stripe async gap) all correct. |
| designer | 0 | ZERO new — 4th consecutive zero; zero files changed under SCAN_ROOTS (no render-path delta); full a11y surface re-verified (lightbox/search/bottom-sheet/accordion/pip/WideGamutHint ARIA + focus + ≥44px); i18n parity 842=842; all KNOWN_VIOLATIONS counts match cycle-3 (budget 17, no drift); DEF-C11-01 not re-raised. |

**Net schedulable findings this cycle: 1 LOW** (AGG-R7C4-01 — NCLX matrix=1 anti-regression test, zero-runtime-risk additive test).
**Refuted/disproved: 2** (MED-R7C2-01 histogram clip — stays refuted, not re-filed; REJ-R7C3-01 indexSize — stays disproved).
**Verified non-finding: 1** (NF-R7C4-01 code-4 comment wording — confirmed correct).
**Carried residual: 1** (RES-R7C4-01 HEIC GPS, reachability unverified).
**Carried-forward deferrals: full set** (DEF-C11-01, R7C1-CR-01..04, ARCH-R7C2-01, TE-R7C2-02..05, OBS-R7C2-02..07, INFO-R7C2-08/09) — re-verified unchanged in `deferred.md`.

**Convergence signal:** the NCLX spec-error sweep remains CONVERGED (document-specialist + test-engineer + critic agreement, 3rd consecutive cycle, exhaustive H.273 verification — no 4th error). All 7 gates + 2237 tests green. Eight reviewers at zero (code-reviewer, perf, security, critic, architect, debugger, tracer, designer + document-specialist 0-actionable). The single new item is a 4-line anti-regression test on the matrix-coefficient surface — LOW, additive, zero runtime risk, hardening the exact maintainer-facing color surface that yielded the run's real fixes.

## AGENT FAILURES

None permanently — all 11 agents returned and persisted. Operational notes:
- **tracer** and **document-specialist** each completed their full substantive investigation on the first pass but went idle before writing their report files (the recurring "agent idle mid-investigation" mode seen in prior cycles — both delivered complete substantive conclusions in their final messages). Per protocol they were re-dispatched ONCE as fresh, tightly-scoped agents seeded with the prior pass's conclusions to independently re-verify; both wrote complete reports on the retry (tracer: all 6 flows CLEAN + 1 residual; document-specialist: 0 actionable + ea303321 verified + code-4 non-finding + full H.273 sweep). The orchestrator additionally independently verified the test-engineer's one concrete finding (TE-R7C4-01) via direct grep of the test file before scheduling. No agent was silently dropped.

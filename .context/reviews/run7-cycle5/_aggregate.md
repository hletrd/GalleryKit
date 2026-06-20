# Aggregate Review — Run-7 Cycle-5 (HEAD `d38fa4a4`)

**Date:** 2026-06-20
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.

**Gate state (verifier, fresh foreground runs at HEAD):** ESLint exit 0; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0; typecheck (app + scripts, 7 JS files) exit 0; Vitest **2238 passed / 4 skipped / 0 failed** (240 files); Next.js prod build exit 0. The 4 skips are the model-weight-gated CLIP suites (gated by design on `CLIP_MODELS_ROOT` weights, NOT failures). Test count is **2238** (up 1 from cycle-4's 2237) — exactly the cycle-4 AGG-R7C4-01 matrix=1 test that landed in `f5d7aaf7`. `npm audit --omit=dev`: 0 critical / 0 high / 1 documented moderate (postcss transitive of `next`, false-positive) / 0 low.

## Context

This is cycle-5 of run-7. **The code HEAD is byte-identical to the converged cycle-4 source HEAD.** `git diff f5d7aaf7..HEAD` restricted to `apps/web/src/`, `apps/web/scripts/`, `apps/web/drizzle/` is **EMPTY** — the only commits since the cycle-4 test fix (`f5d7aaf7`) are the cycle-4 review docs (`2848b394`) and the SW-version stamp (`d38fa4a4`). No application-logic change exists to review beyond what cycle-4 already converged on. The architect confirmed this independently ("no architectural regression is possible by construction").

This cycle's review angle: a genuine fresh skeptical sweep from all 11 angles (NOT a diff-only review — each agent rebuilt its own inventory from scratch), plus the continued exhaustive wrong-value-pin / missing-pin sweep on the spec-mapping surface that has yielded EVERY real fix this run (matrix 8→YCgCo c1, transfer 5→gamma28 c2, matrix=1 pin c4).

**Headline result: continued convergence with ONE new LOW finding (TE-R7C5-01) — the exact dual/sibling of cycle-4's AGG-R7C4-01.** Cycle-4 pinned NCLX matrix code 1 → `bt709` on the NCLX detection path, motivated explicitly by "a code-1↔9 swap would go undetected" — but it closed only the matrix=1 side. The two SIBLING entries (matrix=0 → `identity`, matrix=9 → `bt2020-ncl`) remain unpinned on the pure NCLX `detectFromNclx` path, leaving an asymmetric pin set: a 1→9 swap is now caught, but a 9→1 swap on the NCLX path is still undetectable, and matrix=0 has the identical gap. This is the same wrong-mapping regression class the run has caught repeatedly, on the same admin-audit-only field — LOW severity, zero runtime risk, 2 additive tests that COMPLETE the sweep AGG-R7C4-01 only half-finished.

**Verdict: 1 new LOW finding (a 2-test anti-regression addition, zero runtime risk, zero source change), 0 security / correctness / data-loss / HIGH / CRITICAL findings from any of the 11 agents.** Ten agents at zero (code-reviewer, perf, security, critic, verifier, tracer, architect, debugger, document-specialist, designer). The document-specialist's 4th-consecutive full H.273 re-sweep (verified against VapourSynth/libavif authoritative CICP tables) confirmed NO 4th spec error — the run's 3 spec fixes remain the complete set.

---

## Cross-agent agreement matrix (high-signal items)

| Finding | Agents agreeing | Net disposition |
|---|---|---|
| Source byte-identical to converged cycle-4 HEAD (no regression possible by construction) | architect (empty `git diff` proof), critic (`git log -1 --` on src/** = f5d7aaf7), perf-reviewer (delta = O(1) const edits + compile guard, perf-neutral) | **CONFIRMED** — convergence baseline |
| NCLX H.273 spec sweep CONVERGED (no 4th error, 4th consecutive cycle) | document-specialist (all transfer + matrix codes re-verified vs H.273 via VapourSynth/libavif), test-engineer (no WRONG-value pin remains), critic (NCLX maps cross-checked vs H.273), code-reviewer (color flow clean) | **CONVERGED** — no schedulable spec finding |
| TE-R7C5-01 / NCLX matrix codes 0 + 9 not asserted on NCLX detection path | test-engineer (raise, conf-H, risk-LOW), **orchestrator independently verified via direct grep** (matrix=0 passed at test line 232 but matrixCoefficients never asserted; matrix=9 passed at lines 172/179/324/330 but matrixCoefficients never asserted; both values asserted ONLY via the ICC-name path at lines 81/63/72/90/99/108/257) | **SCHEDULE** (LOW, 2-test anti-regression addition completing AGG-R7C4-01's sweep) |
| Both cycle-4 + cycle-3 fixes intact | verifier (matrix=1 test line 313 + NCLX_MATRIX_MAP[1]='bt709'), test-engineer (matrix=1 asserts matrixCoefficients==='bt709'), document-specialist (matrix 8→ycgco, transfer 5→gamma28, xvYCC/BT.2020 comments all intact), critic (cycle-4 pin landed; settings-hash guard sound) | **CONFIRMED INTACT** — no re-work |
| RES-R7C4-01 HEIC GPS residual | tracer (re-confirm unchanged, DB columns nulled before strip so public never leaks), security-reviewer (re-confirm + no new reachability evidence; host Sharp lacks HEVC decoder) | **CARRY as residual** (reachability unverified) |
| REJ-R7C3-01 indexSize | debugger (re-confirmed disproved 4th consecutive cycle), security-reviewer (re-read gps-exif-strip.ts:455-530, indexSize only advances pos, never a read width) | **stays DISPROVED** |
| MED-R7C2-01 histogram clip % | NOT re-filed by any agent | **stays REFUTED** |
| NF-R7C4-01 code-4 comment "BT.470M, NTSC 525-line" | document-specialist (re-verified CORRECT vs H.273 Table 3, not re-raised per directive) | **stays VERIFIED NON-FINDING** |

---

## SCHEDULED finding (1; LOW; zero runtime-behavior risk)

### AGG-R7C5-01 [LOW, conf HIGH] — NCLX matrix codes 0 (`identity`) and 9 (`bt2020-ncl`) outputs are never asserted on the NCLX detection path
**Agent:** test-engineer (TE-R7C5-01, raise). **Independently verified by the orchestrator** via direct grep of `apps/web/src/__tests__/color-detection.test.ts` (every `matrixCoefficients).toBe(...)` assertion mapped to its owning `detectFromNclx(...)` / `detectColorSignals(...)` call).

**Where:** `apps/web/src/__tests__/color-detection.test.ts`. The invariants under-test:
- `NCLX_MATRIX_MAP[0] = 'identity'` (`apps/web/src/lib/color-detection.ts:215`)
- `NCLX_MATRIX_MAP[9] = 'bt2020-ncl'` (`apps/web/src/lib/color-detection.ts:217`)

**Evidence (pin-status of the NCLX matrix path):**
- matrix=0: the only NCLX-path call passing matrix=0 is `detectFromNclx(12, 13, 0)` (test line 232), which asserts `colorPrimaries`/`transferFunction` but **NOT `matrixCoefficients`**. The `'identity'` value IS asserted at lines 63/72/90/99/108/257, but ALL via the ICC-name path (`detectColorSignals` with an `icc` buffer; line 257 is the code-2/Unspecified fall-through to ICC) — never via the pure NCLX path.
- matrix=9: four NCLX-path calls pass matrix=9 (`detectFromNclx(9,16,9)` line 172, `(9,18,9)` line 179, `(9,14,9)` line 324, `(9,15,9)` line 330), but ALL assert transfer/primaries/isHdr only — **never `matrixCoefficients`**. The `'bt2020-ncl'` value IS asserted at line 81 (the "Rec.2020 ICC name" test — ICC-name path) and as a raw integer `9` at `parseCicpFromHeif` line 507 — never as the mapped enum on the pure NCLX path.
- For contrast, matrix codes 1 (line 315, cycle-4 fix), 8 (line 303), 10 (line 337) ARE pinned on the NCLX path.

**Problem:** The NCLX matrix-path pin set is asymmetric: {1, 8, 10} pinned, {0, 9} not. AGG-R7C4-01's own rationale was that a code-1↔9 swap would go undetected — it closed the matrix=1 side, so a 1→9 swap is now caught, but a **9→1 swap on the NCLX path is still undetectable** (matrix=9 unpinned there), and a matrix=0 mislabel has the identical gap. A HEIF/AVIF carrying NCLX matrix=0 or matrix=9 would silently emit the wrong `matrixCoefficients` into the DB audit column after such a refactor. Same wrong-mapping regression class caught three times this run (YCgCo c1, gamma28 c2, matrix=1-pin c4).

**Why LOW:** `matrixCoefficients` is an **admin-audit-display-only** field (in `_PrivacySensitiveKeys`; never delivered to the public; the encoder branches on `color_pipeline_decision`/`colorPrimaries`, HDR gating on `isHdr` — never on `matrixCoefficients`). A regression here would mislabel a rare admin-only audit field, not affect delivered bytes. Cost to close: 2 additive tests; risk: zero; it hardens the exact maintainer-facing color surface that has yielded every real fix this run, and it completes the sweep AGG-R7C4-01 only half-finished (consistency: cycle-4 scheduled the matrix=1 sibling on identical grounds).

**Fix (additive tests only; zero source/runtime change):** add to `apps/web/src/__tests__/color-detection.test.ts` (in the NCLX matrix block, near the existing matrix=1 / matrix=8 / matrix=10 tests):
```typescript
// AGG-R7C5-01: complete the NCLX matrix-path pin set started by AGG-R7C4-01.
// matrix codes 1/8/10 are pinned on the NCLX path; 0 and 9 were exercised only
// with matrix passed-but-not-asserted (line 232) or asserted via the ICC-name
// path (line 81) — so a 9->1 swap (the dual of the code-1<->9 swap AGG-R7C4-01
// guarded) and a code-0 mislabel would go undetected on the NCLX path.
it('maps nclx matrix=0 to identity', async () => {
    const signals = await detectFromNclx(1, 1, 0);
    expect(signals.matrixCoefficients).toBe('identity');
});
it('maps nclx matrix=9 to bt2020-ncl', async () => {
    const signals = await detectFromNclx(9, 1, 9);
    expect(signals.matrixCoefficients).toBe('bt2020-ncl');
});
```

**Guardrail:** do NOT change any source value or any other test. Pure additive anti-regression pins. After this lands, ALL 5 NCLX_MATRIX_MAP entries (0/1/8/9/10) are value-pinned on the NCLX path.

---

## Carried residual (reachability unverified — NOT scheduled; privacy-relevant)

### RES-R7C5-01 (= RES-R7C4-01 / RES-R7C3-01 / RES-R7C2-01 / RES-R7C1-01, re-confirmed unchanged) — HEIC anomaly GPS-strip fall-through
**Agents:** tracer (Flow-1 residual, re-confirmed unchanged at `process-image.ts:1628-1633` / `gps-exif-strip.ts:460,523`), security-reviewer (re-confirmed unchanged; no new reachability evidence; host Sharp has no HEVC `.heic` decoder so the branch is undrivable here; Apple EXIF item is typically file-offset `construction_method=0` so the scrubber succeeds).
**Where:** `apps/web/src/lib/process-image.ts:1628-1633`; `apps/web/src/lib/gps-exif-strip.ts:460,523`.
**Problem:** when `strip_gps_on_upload=true` AND `allow_hdr_ingest=true` and a structurally anomalous HEIC defeats the lossless ISOBMFF scrubber (`stripGpsFromIsobmffBuffer` → `null`), prebuilt Sharp can't re-encode HEVC, so the function logs an error and returns WITHOUT stripping — the on-disk original retains GPS, which the paid-download route streams. **DB columns are nulled BEFORE `stripGpsFromOriginal` runs** (`images.ts:311-317`, tracer re-confirmed), so the gallery UI / public API never leak GPS regardless — pure UI/file divergence on one container family, only on the paid-download original.
**Reason for NOT scheduling:** reachability is the critical unknown (provably undrivable on the review host); the speculative "fix" risks paid-deliverable corruption with no proven benefit. Carried as a residual (not a confirmed bug) pending a confirming probe.
**Confirming probes (zero-cost, do before scheduling any fix):** (a) run real iPhone `.heic` fixtures through `stripGpsFromIsobmffBuffer` on an HEVC-capable libheif host, assert `stripped:true` not `null`; (b) grep production logs for `cannot strip GPS from structurally anomalous HEIC`. Either probe confirming reachability → escalate to HIGH/CRITICAL and schedule immediately.

---

## Refuted / disproved (do NOT re-file — recorded so the next cycle doesn't re-litigate)

- **MED-R7C2-01** — Histogram RGB clip % "divides by red-channel total only" — REFUTED 3-way in cycle-2. NOT re-filed by ANY agent this cycle. Worker increments r/g/b once per pixel so sum(r)=sum(g)=sum(b)=N always; the proposed `3N` fix would 3× under-report. Stays refuted.
- **REJ-R7C3-01** — `indexSize` not validated against {0,4,8} (`gps-exif-strip.ts:466`) — DISPROVED cycle-3, re-confirmed disproved cycles 4 AND 5 (debugger 4th consecutive + security-reviewer re-read 455-530). `indexSize` only advances `pos` (never a read width); every downstream read is independently bounds-checked + `readSized`-validated; a malformed value yields a safe `null` reject. Stays disproved.
- **NF-R7C4-01** — `color-detection.ts:185` code-4 comment "BT.470M, NTSC 525-line" — VERIFIED CORRECT vs H.273 Table 3 (code 4 = BT.470-6 System M, NTSC, gamma 2.2). PAL/SECAM gamma 2.8 is code 5 (mapped to gamma28). Document-specialist re-confirmed, not re-raised. Stays verified non-finding.
- **NF-R7C5-01** (critic, refuted from code) — a subagent claimed `baselineAllJournalMigrations` could create duplicate rows on retry; critic read `migrate.js:646-661` (`getRecordedHashes()` → Set, then `filter((m) => !haveHashes.has(m.hash))`) — a retry inserts ONLY missing hashes, never duplicates. Not schedulable.

---

## Carried-forward deferrals (re-verified unchanged, no new evidence, no exit criterion met — full register in `.context/plans/run7-cycle5/deferred.md`)

All re-verified UNCHANGED by the relevant agents this cycle; NONE met an exit criterion; NONE re-filed as new:
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified; out of touch-target-audit scope by design. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Code-reviewer / perf-reviewer / architect re-reviewed; no new evidence. Carried.
- **ARCH-R7C2-01** [LOW] — `charge.refunded` webhook gap. Tracer + architect re-confirmed; bundle with plan-316 `async_payment_succeeded`. Carried.
- **TE-R7C2-02/03/04/05** [LOW] — Stripe webhook behavioral-test gap; semantic malformed-row route test; `logAuditEvent` truncation test; embeddings action test. Test-engineer re-confirmed; no new evidence; no exit criterion met. Carried.
- **OBS-R7C2-02..07** [LOW] — debugger/architect design-contract observations (reconcile position backfill, non-transactional restore, failRestore temp leak, pool not `.end()`'d, unbounded bootstrap retry, updateTopic no FOR UPDATE). Architect/debugger re-confirmed all as documented-design / operator-mitigated. Carried.
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); lock-name separator. Cosmetic. Carried.

---

## Per-agent finding counts

| Agent | New findings | Verdict / Notes |
|---|---|---|
| code-reviewer | 0 | APPROVE — 6-way parallel skeptical fan-out (rate-limit, money path, color binary parsers, GPS strip, data/privacy, queue/backfill); every sub-reviewer lead REFUTED from code (icc-extractor mluc length is bytes per ICC.1:2010 §10.13 — correct; color-detection box-size-0 loop terminates since `pos+8<=len` forces size>=8; login allows exactly 5 attempts). Money path / GPS / serve-upload / OG SSRF / base56 / React-#185 all re-verified clean. Truthful zero. |
| perf-reviewer | 0 | APPROVE — 5th consecutive zero; delta = O(1) const edits + compile guard + snapshot memo + 1 test, all perf-neutral. Every hot path re-derived from CURRENT line numbers (50 MP OOM guard 1004-1042, 24-encode cap, hard-link dedup, tagNamesAgg single GROUP_CONCAT, index↔query cross-check no gaps, CLIP 5000 scan cap, SW 50MB LRU + 300ms HEAD, BoundedMaps, transferable histogram). R7C1-CR-02 not re-filed. |
| security-reviewer | 0 | LOW risk — attack-surface rebuilt from scratch (11 API routes / 14 actions + db-actions / session+token+HMAC / upload path-traversal / rate-limit / PII guards / CSV+Unicode+OG sanitizers / 3 lint gates). npm audit 0 crit/0 high. 3 lint gates pass AND inspected for bypassability (real AST parsing). Auth/sessions/paid-flow/PII/injection all CONFIRMED clean; 111 security tests green. REJ-R7C3-01 + RES re-adjudicated, no escalation. |
| critic | 0 actionable | ACCEPT — pre-committed convergence hypothesis survived 4 adversarial sweeps verified FROM CODE (color/HDR, money path, PII, migration). The one candidate (subagent's `baselineAllJournalMigrations` duplicate-row claim) REFUTED from code (filter on missing-hash Set). settings-hash guard sound (key sets 9/9 identical). Truthful zero, no churn proposed. |
| verifier | 0 blockers | PASS — all 7 gates green; Vitest 2238 pass / 4 design-gated skips / 0 fail; build exit 0. 7/7 CLAUDE.md spot-checks VERIFIED (IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, pool 10/queue 20, embedding 2048 bytes, VIEW_RETENTION_DAYS=395, cycle-4 matrix=1 fix intact, NCLX_MATRIX_MAP[1]='bt709'). |
| test-engineer | 1 LOW | TE-R7C5-01 (NCLX matrix codes 0 + 9 → identity/bt2020-ncl not asserted on NCLX path; conf-H, risk-LOW; 2-test fix completing AGG-R7C4-01's sweep). Cycle-4 fix verified intact. Full NCLX map pin-status matrix: transfer + primaries maps fully pinned; only matrix map had the 0/9 gap. Carried TE-R7C2-02..05 unchanged. |
| tracer | 0 confirmed | All 6 flows CLEAN (upload→PII GPS-nulled-before-strip; checkout card-only→webhook sig+paid+idempotent→download token-hash+timingSafeEqual+single-use; color→ETag→SW 300ms HEAD; backfill→lock→delete-race affectedRows===0 cleanup; CLIP→heal-to-disabled→malformed-row skip; session→middleware→isAdmin) with file:line anchors; 1 residual (RES-R7C5-01 HEIC GPS, DB nulled before strip so public never leaks). |
| architect | 0 | PASS — converged; `git diff f5d7aaf7..HEAD` on src/scripts/drizzle EMPTY → no regression by construction. Re-verified independently: COLOR_IMPACTING_KEYS guard landed correctly (9 genuine byte-impacting keys cross-checked vs encoder); all 6 advisory locks centralized, no cross-row mutation lacks a needed lock; check-then-act paths constraint-backed (TOCTOU-safe). Fresh cross-cutting probe surfaced nothing new. |
| debugger | 0 confirmed (1 disproved) | CLEAN PASS — binary parsers (no overflow/divide-by-zero/unbounded recursion/box-size-0 hang), React #185 hazard (module-level value-comparison snapshot, stable SERVER_DEFAULT), concurrency/finally (lock+claim released in finally on both backfill paths), number/string edges (blur-data-url cap, audit surrogate-safe truncation, base56 threshold 224 divisible by 56 → zero modulo bias, decodeEmbeddingColumn exact-byte guard) all clean. REJ-R7C3-01 re-confirmed disproved 4th consecutive cycle. |
| document-specialist | 0 | PART A: 4th-consecutive full H.273 re-sweep vs VapourSynth/libavif authoritative CICP tables — all 3 NCLX maps verified, 3 prior spec fixes intact, NO 4th error. code-4 comment not re-raised (NF-R7C4-01). PART B: all 8 dense CLAUDE.md claims verified correct vs source (IMAGE_PIPELINE_VERSION=7, 9 COLOR_IMPACTING_KEYS, Argon2id params, VIEW_RETENTION_DAYS=395, Firefox 1626624, Sharp withMetadata GPS, Stripe async+card-only, ETag format). |
| designer | 0 | ZERO new — 5th consecutive zero; zero files changed under SCAN_ROOTS. Touch-target audit: 15 gate tests pass, KNOWN_VIOLATIONS budget exactly 17 across 8 files, no delta; similar-photos.tsx individually confirmed ≥44px. A11y surfaces (lightbox/search/bottom-sheet/accordion/pip/WideGamutHint) ARIA + focus + ≥44px all clean with cited attributes. i18n parity 882=882 keys; Korean plural asymmetry expected, not flagged. DEF-C11-01 not re-raised. |

**Net schedulable findings this cycle: 1 LOW** (AGG-R7C5-01 — NCLX matrix codes 0+9 anti-regression tests, zero-runtime-risk additive, completing AGG-R7C4-01's half-finished sweep).
**Refuted/disproved: 3** (MED-R7C2-01 histogram clip; REJ-R7C3-01 indexSize; NF-R7C5-01 migration duplicate-row) + **1 verified non-finding** (NF-R7C4-01 code-4 wording).
**Carried residual: 1** (RES-R7C5-01 HEIC GPS, reachability unverified).
**Carried-forward deferrals: full set** (DEF-C11-01, R7C1-CR-01..04, ARCH-R7C2-01, TE-R7C2-02..05, OBS-R7C2-02..07, INFO-R7C2-08/09) — re-verified unchanged in `deferred.md`.

**Convergence signal:** the NCLX spec-error sweep remains CONVERGED (document-specialist + test-engineer + critic agreement, 4th consecutive cycle, exhaustive H.273 verification — no 4th spec error). All 7 gates + 2238 tests green. Ten reviewers at zero. The single new item is a 2-test anti-regression pin completing the matrix-coefficient surface that AGG-R7C4-01 left asymmetric — LOW, additive, zero runtime risk. This is the natural tail of the run's hardening sweep: after this lands, all 5 NCLX_MATRIX_MAP entries are value-pinned on the NCLX path and the missing-pin class is exhausted.

## AGENT FAILURES

None permanently — all 11 agents returned and persisted. Operational note:
- **test-engineer** completed its full substantive investigation on the first pass but went idle before writing its report file (the recurring "agent idle mid-investigation" mode seen in prior cycles — it delivered its complete conclusion in its final message, ending mid-flow noting the matrix=0 NCLX-path gap). Per protocol it was re-dispatched ONCE as a tightly-scoped writer agent seeded with the prior pass's conclusions PLUS the orchestrator's independent grep-verification of the matrix=0/9 pin status; it wrote a complete report on the retry. The orchestrator independently verified TE-R7C5-01 from code (every `matrixCoefficients).toBe()` assertion mapped to its owning detect call) before scheduling. No agent was silently dropped.

# Aggregate Review — Run-7 Cycle-6 (HEAD `1463f219`)

**Date:** 2026-06-20
**Agents fanned out (11/11 returned + persisted):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.

**Gate state (verifier, fresh foreground runs at HEAD):** ESLint exit 0; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0 (2 admin routes / 44 action exports / 9 public routes OK); typecheck (app + scripts, 7 JS files) exit 0; Vitest **2240 passed / 4 skipped / 0 failed** (238 files passed + 2 skipped). The 4 skips are the model-weight-gated CLIP suites (gated by design on `CLIP_MODELS_ROOT` weights, NOT failures). Next.js prod build exit 0 (40 routes; 3 non-fatal ENOENT file-tracing warnings for dev-only `backfill-detfail-fixture_*` test fixtures under `public/` — exit code 0, not production-impacting). `npm audit --omit=dev`: 0 critical / 0 high / **2 documented moderate** (postcss `<8.5.10` CSS-stringify XSS, reachable ONLY via the copy bundled inside `next@16.2.6` — the project's own direct postcss is already ≥8.5.10; build-time-only, not runtime-reachable; `audit fix --force` would catastrophically downgrade to `next@9.3.3`; resolves when Next bumps its bundled copy — carried, below the crit/high bar).

## Context

This is cycle-6 of run-7. **The code HEAD is byte-identical to the converged cycle-5 source HEAD.** `git diff e855e6ee..HEAD` restricted to `apps/web/src/`, `apps/web/scripts/`, `apps/web/drizzle/` is **EMPTY** (architect re-verified `--stat` → zero output, exit 0; critic independently confirmed). The only commits since the cycle-5 test fix (`e855e6ee`, which landed AGG-R7C5-01) are the cycle-5 review docs (`ee2d05ba`) and the SW-version stamp (`1463f219`) — both outside the source trees. No application-logic change exists to review beyond what cycle-5 already converged on.

This cycle's review angle: a genuine fresh skeptical sweep from all 11 angles (NOT a diff-only review — each agent rebuilt its own inventory from scratch), with an explicit high-bar instruction that a truthful zero is the SUCCESS condition and manufacturing findings / cosmetic churn / coverage nicety is prohibited. The headline class that yielded EVERY real fix this run — the NCLX H.273 spec-map sweep (matrix 8→YCgCo c1, transfer 5→gamma28 c2, matrix=1 pin c4, matrix 0+9 pins c5) — was declared COMPLETE/EXHAUSTED by the orchestrator entering this cycle; the document-specialist + test-engineer + critic re-verified all 22 mapped entries against authoritative H.273 (CICP) tables (VapourSynth R74 + libavif/Wikipedia CICP) one more time and confirmed NO 4th spec error and all asserted values correct.

**Headline result: continued convergence with ZERO new actionable findings from any of the 11 agents.** All 11 reviewers reported a truthful zero. The critic's adversarial convergence hypothesis SURVIVED a from-code falsification sweep across all four named high-risk surfaces. Two items were surfaced and explicitly NOT filed (correctly, under the high bar — see "Non-findings noted but not filed" below).

**Verdict: 0 new actionable findings, 0 security / correctness / data-loss / HIGH / CRITICAL findings. The convergence-mechanics termination condition (NEW_FINDINGS==0) is met.** Per the orchestrator's CONVERGENCE MECHANICS directive, review artifacts are written to `.context/reviews/run7-cycle6/` but NOT committed — left local/untracked — and the cycle reports COMMITS:0, DEPLOY:none.

---

## Cross-agent agreement matrix (high-signal items)

| Finding | Agents agreeing | Net disposition |
|---|---|---|
| Source byte-identical to converged cycle-5 HEAD `e855e6ee` (no regression possible by construction) | architect (empty `git diff --stat` proof, exit 0), critic (only 2 commits since = review doc + sw.js stamp, outside reviewed tree), perf-reviewer (empty `git diff --stat`, only SW stamp moved) | **CONFIRMED** — convergence baseline |
| NCLX H.273 spec sweep CONVERGED/EXHAUSTED (no 4th error, 5th consecutive cycle clean) | document-specialist (all 22 entries re-verified vs VapourSynth R74 + CICP; 3 prior fixes intact), test-engineer (all 13 transfer + 4 primaries + 5 matrix asserted values correct vs H.273; no WRONG-value pin), critic (NCLX maps match H.273 Tables 2/3/4 exactly), code-reviewer (color binary parsers all bounds-checked + correct) | **CONVERGED/EXHAUSTED** — no schedulable spec finding |
| Cycle-5 fix (AGG-R7C5-01) intact | verifier (`color-detection.test.ts:327` matrix=0→identity, `:332` matrix=9→bt2020-ncl, both pass), test-engineer (all 48 color-detection tests pass; both pins present), document-specialist (3 prior run-7 fixes intact in source) | **CONFIRMED INTACT** — no re-work |
| All 7 quality gates green | verifier (authoritative: 4 lint + typecheck + 2240-test vitest + build all exit 0), code-reviewer (typecheck exit 0 + 158 targeted tests), security-reviewer (3 lint gates pass + 105 security tests), critic (typecheck + 3 lint gates pass), designer (touch-target gate 15/15 pass) | **CONFIRMED GREEN** |
| Money path CLEAN (no money-taken-no-goods, no token reuse) | tracer (Flow-2 CLEAN with anchors), code-reviewer (webhook guard ordering + double idempotency + card-only pin), critic (checkout card-only `route.ts:207` + sig + paid gate + idempotency discrimination), security-reviewer (A08 sig-before-DB + card-only + token open-before-claim) | **CONFIRMED CLEAN** |
| PII never reaches public (GPS nulled before strip; publicSelectFields omission + compile guard) | tracer (Flow-1 `images.ts:312-316` GPS null before insert), code-reviewer (`_privacyGuard` real compile assertion), critic (`publicSelectFields` omits icc_profile_name `data.ts:349`), architect (derived-by-omission + 3 compile guards intact), security-reviewer (`_SensitiveKeysInPublic` guard) | **CONFIRMED CLEAN** |
| Binary parsers free of overflow / div-zero / unbounded-loop / OOB | debugger (5 files all CLEAN with bounds cited), code-reviewer (parseCicpFromHeif/icc-extractor/icc-chromaticity/gain-map/gps-exif all bounds-checked) | **CONFIRMED CLEAN** |
| Advisory-lock coverage complete; all released in finally | architect (6 lock names all have live call sites; no uncovered cross-row mutation), debugger (backfill + image-processing + restore all release in finally on every path), tracer (Flow-4 lock+claim+affectedRows cleanup) | **CONFIRMED CLEAN** |
| RES-R7C5-01 HEIC GPS residual | tracer (re-confirmed unchanged `process-image.ts:1628-1633`; DB nulled before strip so public never leaks), security-reviewer (re-confirm; no new reachability evidence) | **CARRY as residual** (reachability unverified) |
| REJ-R7C3-01 indexSize | debugger (re-confirmed disproved 5th consecutive cycle; `readSized` rejects widths not in {0,4,8}), security-reviewer (re-adjudicated, no escalation) | **stays DISPROVED** |
| MED-R7C2-01 histogram clip % | NOT re-filed by any agent | **stays REFUTED** |
| NF-R7C4-01 code-4 comment "BT.470M, NTSC 525-line" | document-specialist (re-verified CORRECT vs H.273 Table 3, not re-raised) | **stays VERIFIED NON-FINDING** |

---

## SCHEDULED findings: NONE

Zero new actionable findings this cycle. No plan to write beyond carrying the deferred register forward unchanged.

---

## Non-findings noted but explicitly NOT filed (recorded for provenance; do NOT manufacture into findings)

### OBS-R7C6-01 (critic) — one-time vitest-parallel test-harness write-contention flake
**Agent:** critic (logged as a LOW deferral-at-most, explicitly NOT actionable under the cycle-6 high bar). Security-reviewer independently observed the same class (3 first-run failures on parallel Sharp/libvips AVIF-decode fixtures, all green on clean re-run).
**Where:** `apps/web/src/__tests__/process-image-color-roundtrip.test.ts` ("P3 source forceSrgbDerivatives=true") — tests write derivatives to the SHARED real `UPLOAD_DIR_*` under vitest parallelism.
**Evidence:** failed ONCE in a full-suite run (`Input file contains unsupported image format` reading a WebP derivative mid-write); **re-run passed 2240/2240, isolated run passed 11/11** (verifier's authoritative run was fully green). Root cause from code: test-harness write-contention race under parallel workers, NOT a source defect.
**Why NOT filed:** Production is immune (UUID filenames + PQueue concurrency 1 — no two jobs share a path). This is test-infra flakiness, not a product correctness issue. Per the cycle-6 high-bar mandate ("a finding that would be LOW and 'nice to have' is a deferral at most, not a commit"), this is at most a future test-isolation hardening (give each parallel test its own temp `UPLOAD_DIR`), recorded as an INFO-level observation, NOT a schedulable finding this cycle. Exit criterion: the flake recurs frequently enough to redden CI on clean runs → schedule per-test temp-dir isolation.

### NF-R7C6-01 (test-engineer) — `parseCicpFromHeif` inline comments mislabel transfer codes 13/14
**Agent:** test-engineer (noted, ruled non-actionable).
**Where:** `apps/web/src/__tests__/color-detection.test.ts:519` (comment calls code 13 "PQ"), `:537` (comment calls code 14 "HLG").
**Why NOT a finding:** `parseCicpFromHeif` returns RAW integers, so the assertions `toBe(13)` / `toBe(14)` are correct parser round-trip checks — the comment wording does NOT make any assertion wrong. The semantic mappings ARE correctly tested in the `detectColorSignals` block (transfer 13→`srgb` at line 286; transfer 14→`gamma24` at line 342). A comment-only cosmetic wording issue on a test file with zero behavioral impact. Not actionable under the high bar. (Mirror of NF-R7C4-01's class: a comment shorthand that is imprecise but does not break any assertion or mapping.)

### Code-reviewer internal observation (gain-map infe sibling-read) — NOT filed
**Where:** `lib/gain-map-detection.ts parseIinf` — an `infe` box claiming a size past the iinf box but within the buffer could read sibling bytes. Bounded by `buffer.length` (no OOB); only mis-detects a gain map on a deliberately malformed file; gain-map status is admin-only audit metadata. Code-reviewer judged not worth a finding. No public/correctness impact.

### Perf-reviewer internal observation (unconditional rate-limit prune) — NOT filed
**Where:** per-request unconditional `prune()` on OG/share/checkout/semantic/login rate-limit maps (only search is interval-gated). Bounded sub-millisecond O(≤2000–5000) sync sweep on a single-instance deployment; surfaced + accepted in cycles 1/3/4; latency-only with no new measured evidence — same deferral class as R7C1-CR-02. Re-filing would violate the no-re-file directive. Recorded with a concrete re-open criterion (horizontal scale-out or 10× cap raise).

---

## Carried residual (reachability unverified — NOT scheduled; privacy-relevant)

### RES-R7C6-01 (= RES-R7C5-01 / R7C4-01 / R7C3-01 / R7C2-01 / R7C1-01, re-confirmed unchanged) — HEIC anomaly GPS-strip fall-through
**Agents:** tracer (Flow-1 residual, re-confirmed unchanged), security-reviewer (re-confirmed; no new reachability evidence).
**Where:** `apps/web/src/lib/process-image.ts:1628-1633`; `apps/web/src/lib/gps-exif-strip.ts:460,523`.
**Problem:** when `strip_gps_on_upload=true` AND `allow_hdr_ingest=true` and a structurally anomalous HEIC defeats the lossless ISOBMFF scrubber (`stripGpsFromIsobmffBuffer` → `null`), prebuilt Sharp can't re-encode HEVC, so the function logs an error and returns WITHOUT stripping — the on-disk original retains GPS, which the paid-download route streams. **DB columns are nulled BEFORE `stripGpsFromOriginal` runs** (`images.ts:312-316`, tracer re-confirmed: the null precedes the strip call at `:316`), so the gallery UI / public API never leak GPS regardless — pure UI/file divergence on one container family, only on the paid-download original.
**Reason for NOT scheduling:** reachability is the critical unknown (provably undrivable on the review host — host Sharp lacks an HEVC `.heic` decoder; Apple EXIF item is typically file-offset `construction_method=0` so the scrubber succeeds). The speculative "fix" risks paid-deliverable corruption with no proven benefit. Carried as a residual (not a confirmed bug) pending a confirming probe.
**Confirming probes (zero-cost, do before scheduling any fix):** (a) run real iPhone `.heic` fixtures through `stripGpsFromIsobmffBuffer` on an HEVC-capable libheif host, assert `stripped:true` not `null`; (b) grep production logs for `cannot strip GPS from structurally anomalous HEIC`. Either probe confirming reachability → escalate to HIGH/CRITICAL and schedule immediately.

---

## Refuted / disproved (do NOT re-file — recorded so the next cycle doesn't re-litigate)

- **MED-R7C2-01** — Histogram RGB clip % "divides by red-channel total only" — REFUTED 3-way in cycle-2. NOT re-filed by ANY agent in cycles 3, 4, 5, or 6. Worker increments r/g/b once per pixel so sum(r)=sum(g)=sum(b)=N always; the proposed `3N` fix would 3× under-report. Stays refuted.
- **REJ-R7C3-01** — `indexSize` not validated against {0,4,8} (`gps-exif-strip.ts:466`) — DISPROVED cycle-3, re-confirmed disproved cycles 4, 5, AND 6 (debugger 5th consecutive: `readSized` rejects widths not in {0,4,8}; security-reviewer re-adjudicated). `indexSize` only advances `pos` (never a read width); every downstream read is independently bounds-checked; a malformed value yields a safe `null` reject. Stays disproved.
- **NF-R7C5-01** — `migrate.js:646-661` `baselineAllJournalMigrations` "could create duplicate rows on retry" — REFUTED from code cycle-5 (filters on missing-hash Set). Not re-raised. Stays refuted.
- **NF-R7C4-01** — `color-detection.ts:185` code-4 comment "BT.470M, NTSC 525-line" — VERIFIED CORRECT vs H.273 Table 3 (code 4 = BT.470-6 System M, NTSC, gamma 2.2). PAL/SECAM gamma 2.8 is code 5 (mapped to gamma28). Document-specialist re-confirmed, not re-raised. Stays verified non-finding.
- **NCLX matrix/transfer map pin class** — declared COMPLETE/EXHAUSTED entering cycle-6 (all 5 matrix entries 0/1/8/9/10 + all 13 transfer entries value-pinned on the NCLX detection path). Document-specialist + test-engineer + critic re-verified all asserted values correct vs H.273; NO missing-pin finding filed. Class closed.

---

## Carried-forward deferrals (re-verified unchanged, no new evidence, no exit criterion met — full register in `.context/plans/run7-cycle6/deferred.md`)

All re-verified UNCHANGED by the relevant agents this cycle; NONE met an exit criterion; NONE re-filed as new:
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified; out of touch-target-audit scope by design. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Code-reviewer / perf-reviewer / architect re-reviewed; no new evidence. Carried.
- **ARCH-R7C2-01** [LOW] — `charge.refunded` webhook gap. Tracer + architect re-confirmed; bundle with plan-316 `async_payment_succeeded`. Carried.
- **TE-R7C2-02/03/04/05** [LOW] — Stripe webhook behavioral-test gap; semantic malformed-row route test; `logAuditEvent` truncation test; embeddings action test. Test-engineer re-confirmed (these are pre-existing deferred items, not re-filed as new); no new evidence; no exit criterion met. Carried.
- **OBS-R7C2-02..07** [LOW] — debugger/architect design-contract observations (reconcile position backfill, non-transactional restore, failRestore temp leak, pool not `.end()`'d, unbounded bootstrap retry, updateTopic no FOR UPDATE). Architect/debugger re-confirmed all as documented-design / operator-mitigated. Carried.
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); lock-name separator. Cosmetic. Carried.

---

## Per-agent finding counts

| Agent | New findings | Verdict / Notes |
|---|---|---|
| code-reviewer | 0 | APPROVE — fresh from-code sweep (money path, color binary parsers, privacy, queue/backfill races); typecheck exit 0 + 158 targeted tests pass. Money-path double idempotency (`affectedRows===1 && insertId>0`), deleted-image FK race (pre-insert + in-catch), card-only pin, checkout rollback all clean; all 5 color binary parsers bounds-checked; `_privacyGuard` real compile assertion. One internal non-finding (gain-map infe sibling-read, bounded, admin-only) not filed. Truthful zero. |
| perf-reviewer | 0 | APPROVE — 6th consecutive zero; empty `git diff --stat`. Fresh hot-path inventory re-examined: tagNamesAgg single GROUP_CONCAT (no N+1), getImage 3-way Promise.all, every hot query maps to a composite index (no missing-index scan), 50 MP OOM guard, AVIF 10-bit probe singleton, CLIP 5000-cap single-pass, SW O(1) LRU + 300ms HEAD, histogram transferable, bounded rate-limit maps. Unconditional-prune observation not re-filed (latency-only, deferral class R7C1-CR-02). |
| security-reviewer | 0 | LOW risk — full OWASP attack surface rebuilt from scratch (11 API routes / 14 actions + db-actions / session+HMAC / Argon2 / PATs / download tokens / Stripe webhook / upload path-traversal / PII guards / sanitizers / 3 lint gates). npm audit 0 crit/0 high / 2 documented moderate (postcss via next internals, build-time-only). A01/A02/A03/A07/A08 all CONFIRMED clean with one-liners; 3 lint gates pass AND not bypassable (aliased/function-decl/class-decl exports rejected); 105/105 security tests green. REJ-R7C3-01 + RES re-adjudicated, no escalation. |
| critic | 0 actionable | ACCEPT — convergence hypothesis SURVIVED a from-code adversarial sweep across all 4 named surfaces (color/HDR vs H.273, money path, PII, migration). Byte-identical claim verified. settings-hash = exactly 9 keys with real compile guard. One anomaly (parallel-test write-contention flake) falsified as test-infra, re-run 2240/2240 + isolated 11/11 green — logged as OBS-R7C6-01 LOW deferral, NOT a commit. No adjudicated item re-filed. |
| verifier | 0 blockers | PASS — all 7 gates green; Vitest 2240 pass / 4 design-gated CLIP skips / 0 fail (238 files); build exit 0 (40 routes; 3 non-fatal dev-fixture ENOENT warnings). 11/11 spot-checks VERIFIED (AGG-R7C5-01 fix at lines 327/332, IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, pool=10, VIEW_RETENTION_DAYS=395). npm audit 2 moderate / 0 crit-high. |
| test-engineer | 0 | Truthful zero — cycle-5 fix intact (both pins present + pass; all 48 color-detection tests pass). ALL spec-map asserted values correct vs ITU-T H.273: NCLX_PRIMARIES_MAP (4: 1/9/11/12), NCLX_TRANSFER_MAP (13: 1/4/5/6/7/8/11/13/14/15/16/17/18), NCLX_MATRIX_MAP (5: 0/1/8/9/10 — all now value-pinned on the NCLX path). One comment-only non-finding (NF-R7C6-01, parseCicpFromHeif transfer comment wording) noted, ruled non-actionable. Carried TE-R7C2-02..05 unchanged. |
| tracer | 0 confirmed | All 5 critical flows CLEAN with file:line anchors (upload→PII GPS-nulled-before-insert; checkout card-only→webhook sig+paid+idempotent→download token-hash+timingSafeEqual+single-use+open-before-claim; color→9-key settings-hash→SW 300ms HEAD abort; backfill→lock→affectedRows===0 cleanup→version withheld on detection failure; session→middleware→isAdmin→dual rate-limit). 1 residual (RES-R7C6-01 HEIC GPS, DB nulled before strip so public never leaks). |
| architect | 0 | PASS — empty-delta claim verified independently (`git diff --stat` zero output, exit 0); no regression by construction. Fresh cross-cutting sweep CONFIRMED all 5 systemic invariants: 6 advisory locks all have live call sites (no uncovered cross-row mutation); 9-key COLOR_IMPACTING_KEYS exactly matches the byte-impacting encoder params (no missing byte-impacting setting); no new process-local state; admin-delete TOCTOU lock-then-COUNT safe; 3 privacy compile guards intact. |
| debugger | 0 confirmed (1 disproved) | CLEAN PASS — 5 binary parsers all bounds-checked (box-size-0/1 handled, MAX_DEPTH/MAX_SCAN caps, IFD chain cap + visited Set, readSized {0,4,8} guard, det/sum epsilon guards); React #185 hazard (module-level stable-reference snapshot + SERVER_DEFAULT constant); all advisory locks released in finally on every path; base56 threshold 224=4×56 zero modulo bias; audit truncation code-point-spread surrogate-safe; decodeEmbeddingColumn exact-2048-byte guard. REJ-R7C3-01 re-confirmed disproved 5th consecutive cycle. |
| document-specialist | 0 | PART A: all 22 NCLX map entries re-verified correct vs VapourSynth R74 (normative H.273 mirror) + CICP; 3 prior run-7 fixes intact (matrix 8→ycgco, transfer 5→gamma28, matrix 1→bt709); NCLX pin class EXHAUSTED, no 4th spec error. PART B: all 8 dense CLAUDE.md claims verified correct vs source (IMAGE_PIPELINE_VERSION=7, 9 COLOR_IMPACTING_KEYS, Argon2id 65536/3/4, VIEW_RETENTION_DAYS=395, ETag format, transfer 5/matrix 8 codes, Stripe card-only + async gap). Sources cited. |
| designer | 0 | ZERO new — 6th consecutive zero; zero files changed under SCAN_ROOTS. Touch-target audit 15/15 pass, KNOWN_VIOLATIONS budget exactly 17 across 8 files (unchanged); photo-viewer.tsx size="sm" all carry explicit h-11. A11y on 6 surfaces (lightbox/search/bottom-sheet/accordion/pip/WideGamutHint) ARIA + focus-trap + ≥44px all clean with cited attributes. i18n parity 842=842 keys; Korean plural asymmetry expected, not flagged. DEF-C11-01 not re-raised. |

**Net schedulable findings this cycle: 0.** Eleven reviewers at zero.
**Non-findings noted but not filed: 4** (OBS-R7C6-01 parallel-test flake; NF-R7C6-01 parseCicpFromHeif comment wording; gain-map infe sibling-read; unconditional rate-limit prune) — all recorded for provenance, none actionable under the high bar.
**Refuted/disproved: 4** (MED-R7C2-01 histogram clip; REJ-R7C3-01 indexSize; NF-R7C5-01 migration duplicate-row; NCLX pin class) + **1 verified non-finding** (NF-R7C4-01 code-4 wording).
**Carried residual: 1** (RES-R7C6-01 HEIC GPS, reachability unverified).
**Carried-forward deferrals: full set** (DEF-C11-01, R7C1-CR-01..04, ARCH-R7C2-01, TE-R7C2-02..05, OBS-R7C2-02..07, INFO-R7C2-08/09) — re-verified unchanged in `deferred.md`.

**Convergence signal:** This is the cleanest cycle of the run. Source byte-identical to the converged cycle-5 HEAD; the NCLX spec-error sweep is EXHAUSTED (5th consecutive cycle clean, document-specialist + test-engineer + critic agreement, all 22 entries re-verified vs authoritative H.273). All 7 gates + 2240 tests green. ELEVEN reviewers at zero — for the first time this run, no single new actionable finding was produced by any angle. The critic's adversarial convergence hypothesis survived a from-code falsification sweep. Per CONVERGENCE MECHANICS, with NEW_FINDINGS==0 the review artifacts stay local/untracked and the cycle reports COMMITS:0 / DEPLOY:none — the clean termination condition of a perfected system.

## AGENT FAILURES

None. All 11 agents returned and persisted their review files on the first pass. No re-dispatch was required this cycle.

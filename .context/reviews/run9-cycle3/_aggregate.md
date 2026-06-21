# Aggregate Review — Run-9 Cycle-3 (HEAD `c2d3857a`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs by verifier at HEAD `c2d3857a`, pre-fix):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 admin routes OK) / lint:action-origin (42 actions: 36 OK + 6 exempt-annotated) / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts) exit 0; Vitest **2054 passed / 4 skipped** (226 files) on stable runs; Next.js prod build exit 0 (Turbopack 5.3s, 10/10 static pages). The 4 skips are exclusively the CLIP-weight-gated suites. **Verifier observed ONE flake** — `upload-tracker-state.test.ts:122` failed on run 1 of 3, then 2054/2054 on runs 2-3 (lead independently re-ran ~14 more full suites, all green; flake is real but load-dependent and rare → TE-R9C3-01).

## Context

This is cycle-3 of run-9. Run-8 converged at cycle-2 (`f63af3b9`); run-9 cycle-1 converged-with-fixes at `d3858cfc` (2 LOW test files); run-9 cycle-2 converged-with-fix at `c2d3857a` (1 LOW off-path cicp-recheck drain). **Since run-8 convergence `f63af3b9`, the ONLY production-relevant source changes are THREE run-9 fixes** — `scripts/backfill-cicp-recheck.ts` (onEmpty→onIdle, CR-R9C2-01) and two new test files (`upload-tracker-state.test.ts`, `upload-processing-contract-lock.test.ts`). `git diff --stat f63af3b9..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle apps/web/messages` = those three files only. Since the run-9 c2 fix commit `e1acaff1`, ZERO source changes (HEAD is the docs-provenance commit). Zero production logic, schema, config, or migration change.

This cycle's review angle: a fresh deep skeptical whole-repo sweep from every angle, deliberately widened beyond the (empty since `e1acaff1`) source delta, to find anything missed across 9 runs.

**Headline result: convergence holds on every correctness/security/perf/arch/doc/migration axis.** Eight of eleven agents found ZERO new actionable findings. Three NEW items surfaced, all LOW, all on non-product-runtime surfaces:
- **TE-R9C3-01 [LOW]** — `upload-tracker-state.test.ts` is a flaky blocking-CI test (process-global `Symbol.for` Map contamination under the `forks` pool). REAL (verifier reproduced once in a real gate run under build+test concurrency). → SCHEDULED + FIXED (test-engineer applied `beforeAll` clear + docstring; lead kept the domain-agent's considered hardening).
- **DES-R9C3-01 [LOW]** — `bulk-edit-dialog.tsx:184/209/229` three conditionally-rendered controls (topic `<SelectTrigger>`, title-prefix `<Input>`, description `<Textarea>`) have NO label association — their `<Label>` has no `htmlFor`, a `<div>` breaks wrapping, and no `aria-label`. WCAG 1.3.1 / 4.1.2 Level A. Their four siblings in the same dialog ARE labelled. Fresh-missed across 9 runs (designer touched this file in run4-c7/run5-c3/run8-c2/run9-c1 without catching it). → SCHEDULED + FIXED (added `aria-label` reusing the existing `Label` i18n keys, matching the in-file line-246 pattern).
- **DES-R9C3-02 [LOW, advisory]** — analytics tables' `<th>` lack `scope="col"` (`analytics-client.tsx:96-98,138-139,169-170,206-207,246-247`). Advisory (UA heuristics handle simple 2-3-col tables in all major SRs); admin-only. → DEFERRED (would-be-nice, not commit-worthy under the high bar).

A naturally-produced `sw.js` SW_VERSION stamp refresh (`1ef54aaa-p7` → `c2d3857a-p7`) is present in the working tree from the verifier's prod build (prebuild hook); committed alongside the cycle's fixes per established cadence.

---

## Cross-agent agreement matrix (high-signal items)

| Finding / verdict | Agents agreeing | Net disposition |
|---|---|---|
| **Convergence genuine on correctness/security/perf/arch/doc/migration axes** | code-reviewer, security-reviewer, architect, critic, perf-reviewer, tracer, debugger, document-specialist (8) | **CONFIRMED — 0 new on these axes** |
| Only source change since converged `f63af3b9` = three run-9 fixes (cicp-recheck drain + two test files); ZERO since `e1acaff1`; typecheck PASS = machine proof of no dangling types | code-reviewer, architect, critic, perf-reviewer, security-reviewer, test-engineer | **CONFIRMED** (6 agents) |
| The cicp-recheck `onEmpty()`→`onIdle()` fix is CORRECT + COMPLETE (matches p-queue 9.1.2 typedef + all 5 sibling drain sites; counters mutated in task body genuinely raced the summary print) | code-reviewer, architect (p-queue 9.1.2 SOURCE :502-535), critic (typedef :107), debugger, perf-reviewer | **CONFIRMED CLEAN** (5 agents) |
| The two run-9 c1 test files are SOUND — mutation-proven non-tautological (critic: 4 source mutations each caught surgically incl. the load-bearing `\|\| entry.bytes > 0` disjunct), meaningful assertions, both BigInt(1)/numeric-1 lock arms + null/0/throw/double-release | critic (4 mutations), test-engineer (branch-by-branch table), code-reviewer, architect, debugger | **CONFIRMED SOUND** (5 agents) |
| `upload-tracker-state.test.ts` flaky under full-suite concurrency (verifier 1/3 fail at :122; lead ~14 clean re-runs); process-global Symbol.for Map race | verifier (reproduced), test-engineer (TE-R9C3-01), lead (mechanism: forks pool reuses process-global Symbol registry across files; `images-actions.test.ts` runs real unmocked tracker) | **SCHEDULED + FIXED — NEW (LOW)** |
| `bulk-edit-dialog.tsx` 3 conditional controls unlabelled (WCAG 1.3.1/4.1.2 Level A); 4 siblings ARE labelled | designer (DES-R9C3-01), lead (code-confirmed :184/209/229 vs labelled :246/261/274) | **SCHEDULED + FIXED — NEW (LOW)** |
| analytics `<th>` missing `scope="col"` — advisory, admin-only, UA-heuristic-handled | designer (DES-R9C3-02) | **DEFERRED — NEW (LOW advisory)** |
| Privacy derivation holds — `publicSelectFields` omit-derived; compile guards (`_SensitiveKeysInPublic`/`_privacyGuard`) hold; no PII leak; `avif_10bit` correctly public; `publicMapSelectFields` GPS double-gated | architect, security-reviewer, tracer (Flow 2), code-reviewer | **CONFIRMED CLEAN** (4 agents) |
| Migration / reconcileLegacySchema correct; journal newest entries (0018-0023) strictly monotonic; 0023 paid-download drop mirrored `migrate.js`; post-condition won't false-fail | architect, document-specialist, code-reviewer | **CONFIRMED CLEAN** (3 agents) |
| Advisory locks (6 names) acquire/release-symmetric on dedicated connections; cicp-recheck correctly takes NO lock (read-only) | architect, debugger, code-reviewer | **CONFIRMED CLEAN** (3 agents) |
| Delete-during-reencode race fully fenced — `affectedRows===0` → full-scan variant cleanup, counted `deleted-mid-reencode` (both runner success + detection-failed paths) | tracer (Flow 3), code-reviewer, critic, debugger | **CONFIRMED CLEAN** (4 agents) |
| Session/auth chain safe — HMAC + timingSafeEqual + post-HMAC format check + prod SESSION_SECRET startup guard + middleware structural fast-check + dual same-origin/isAdmin on actions | tracer (Flow 4), security-reviewer, code-reviewer | **CONFIRMED CLEAN** (3 agents) |
| Binary parsers (5/5) BENIGN — ISOBMFF/ICC/ICC-chromaticity/gain-map/GPS walkers all bounds/depth/scan-capped; rate-limit bounded-map collect-then-delete; global `/g` only on `.replace()` never `.test()` | security-reviewer, debugger (5-module spot-check), perf-reviewer | **CONFIRMED BENIGN** (3 agents) |
| No perf/concurrency regression on any hot path (masonry tagNamesAgg, getImage Promise.all, OG LIMIT-1, Sharp per-format decode, SW 300ms HEAD, view-retention chunked DELETE, analytics Promise.all LIMIT-bounded, timeline cap-500) | perf-reviewer (source-validated), code-reviewer, debugger, tracer | **CONFIRMED** (4 agents) |
| Fresh flows (view-analytics→GC; upload→derivative-serving→ETag) safe at every handoff — rate-limit + bounded map + chunked GC + non-finite guard; 4-layer path traversal + symlink reject + realpath containment + correct conditional-GET 304 | tracer (2 fresh flows) | **CONFIRMED CLEAN** |
| Touch-target gate PASS (15/15); i18n key parity en↔ko (ko no-plural by-design); FocusTrap + aria-label + skip-link present; DEF-C11-01 still out-of-scope | designer | **CONFIRMED CLEAN** |
| On-disk docs (CLAUDE.md/AGENTS.md/README) accurate against code on every spot-check (IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, VIEW_RETENTION_DAYS=395, backfill cap=2@pool10, advisory locks, NCLX maps, nginx caps, React cache()=10, backfill columns, Key-Files table 8/8 spot-checked) | document-specialist, verifier, architect | **CONFIRMED CLEAN** (3 agents) |

---

## SCHEDULED + IMPLEMENTED findings (this cycle)

### TE-R9C3-01 [LOW, conf HIGH] — `upload-tracker-state.test.ts` is a flaky blocking-CI test (process-global Symbol.for Map contamination)
**Where:** `apps/web/src/__tests__/upload-tracker-state.test.ts`.
**Why it's a defect:** `upload-tracker-state.ts` memoizes its Map on `globalThis[Symbol.for('gallerykit.uploadTracker')]`. Vitest 4.1.4's default `forks` pool runs multiple test files **sequentially in a pool of reused child processes**; `isolate:true` resets the per-file module registry but NOT the process-global `Symbol.for` registry — so `globalThis[thatSymbol]` persists across files in the same worker. `images-actions.test.ts` (and siblings) do NOT mock `@/lib/upload-tracker-state` and execute the REAL `getUploadTracker().set(...)` via the upload action. The `beforeEach` clear handles STATIC leftover state, but the verifier reproduced a failure at `:122` (`hasActiveUploadClaims === true` returned false) under build+test concurrency — consistent with a deferred write or cap-eviction race during heavy load. A flaky test in THIS loop's own convergence gate directly undermines its all-green signal.
**Why LOW:** test-only; the production logic is correct (5 agents confirmed); the flake is rare and load-dependent (verifier 1/3 + lead ~14 clean re-runs).
**Fix (implemented by test-engineer):** added `beforeAll(() => getUploadTracker().clear())` + an explanatory docstring covering the cross-file/pool-config contamination class. Kept as the domain agent's considered hardening. (Lead note: `beforeAll` hardens the non-default-pool case the test-engineer documented; the observed mid-test contamination under `forks` was not deterministically reproducible to validate a stronger candidate fix, so over-engineering an unreproducible race was deliberately avoided — the state-hygiene addition is root-cause-aligned and harmless.)

### DES-R9C3-01 [LOW, conf HIGH] — `bulk-edit-dialog.tsx` three conditional controls have no accessible name (WCAG 1.3.1 / 4.1.2 Level A)
**Where:** `apps/web/src/components/bulk-edit-dialog.tsx:184` (topic `<SelectTrigger>`), `:209` (title-prefix `<Input>`), `:229` (description `<Textarea>`).
**Why it's a defect:** Each control's `<Label>` (`:174/:201/:221`) has no `htmlFor`, a `<div>` sits between the `<Label>` and the control (breaking implicit wrapping), and the control had no `id` or `aria-label`. A screen-reader user focusing any of the three hears only the role ("combobox" / "edit text") with no name. The OTHER four labelled surfaces in the SAME dialog are correct: the alt-suggested `<SelectTrigger>` at `:246` has `aria-label`, and the two `<TagInput>` at `:261/:274` pass `ariaLabel`. So the gap is a clear in-file inconsistency, not a design choice. Admin-facing → LOW.
**Fix (implemented):** added `aria-label` to each of the three controls, reusing the existing `Label` i18n key (`imageManager.topic`, `imageManager.bulkTitlePrefix`, `imageManager.descField` — all present in en+ko), matching the established `:246` pattern. No new translation keys.

---

## DEFERRED finding (this cycle)

### DES-R9C3-02 [LOW, conf Medium, advisory] — analytics `<th>` lack `scope="col"`
**Where:** `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:96-98,138-139,169-170,206-207,246-247`.
**Why deferred:** advisory only — all five tables are simple 2-3-column `<thead>`+`<tbody>` structures where every major screen reader's UA heuristic correctly associates header↔cell without an explicit `scope`. Admin-only analytics surface. Not a firm WCAG failure; designer itself flagged it as advisory. Not security/correctness/data-loss → deferrable under the high-bar policy ("would-be-nice = deferral, not a commit").
**Exit criterion:** (a) a real screen-reader-user report of header confusion on the analytics tables; OR (b) any analytics-table is reworked to a complex (multi-row-header / spanning) structure where `scope` becomes load-bearing; OR (c) a general table-a11y hardening pass is scheduled.

---

## NON-FINDINGS / re-confirmed-benign this cycle (provenance — do NOT re-file)

- **debugger 5-module benign re-spot-check** — color-detection (MAX_DEPTH=5, 1MB pre-cap), gps-exif-strip (visited-Set cycle detection, IFD structural guard), validation (no `/g` on `.test()`), upload-tracker-state (collect-then-delete, correct window-reset sequencing), image-queue `pruneRetryMaps` (collect-then-delete ×3 Maps) — all BENIGN at HEAD; the prior 14-module table holds.
- **All re-traced tracer flows (2/3/4) + two fresh flows (view-analytics→GC, upload→derivative-serving→ETag) CONFIRMED-SAFE.** No new flow finding.
- **code-reviewer's REFUTED data-layer candidate** — `blur_data_url` read-path validation asymmetry: REFUTED (`photo-viewer.tsx:155` runs `isSafeBlurDataUrl()` and returns undefined before the value reaches `style.backgroundImage` — the documented read-time barrier).
- **critic's MINOR observation (not actionable)** — `backfill-cicp-recheck.ts` has no unit test; it's a read-only operator diagnostic on no product runtime path; testing it would mock p-queue to verify `onIdle` was called (tests the mock, not behavior). Not a gap → not filed.
- **test-engineer's pool-model claim correction** — its review states forks "process-isolates globalThis between files"; the LEAD's deeper analysis shows forks reuses process-global `Symbol.for` registries across sequentially-run files (which is WHY the flake is possible). The test-engineer's `beforeAll` fix is still a reasonable hardening; the mechanism note is recorded here for accuracy.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `c2d3857a`, no new evidence, no exit criterion met — full register in `.context/plans/run9-cycle3/deferred.md`)

- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified out-of-scope (`<Input>` deliberately excluded from touch-target audit). Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (perf-reviewer re-confirmed CR-02 no measured regression; architect re-confirmed CR-01 lock-serialized).
- **TE-R7C2-03** [LOW] — semantic route malformed-embedding row-skip untested. Carried (test-engineer re-confirmed STILL OPEN via grep).
- **TE-R7C2-04** [LOW] — `logAuditEvent` metadata-truncation untested. Carried (test-engineer re-confirmed STILL OPEN — used only as `vi.fn()` mock in consumers).
- **TE-R7C2-05** [INFO] — `embeddings.ts` action no dedicated test. Carried (STILL OPEN — only a structural import-check fixture exists).
- **OBS-R7C2-02..07** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry; updateTopic no FOR UPDATE. Carried (architect re-confirmed unchanged, documented-design / operator-mitigated).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.
- **R8-H1 non-finding** (settings-hash no-arg vs config-arg divergence) — benign-by-design (production serve path uses config-arg form). Carried as non-finding.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open — re-confirmed this cycle where examined)

- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8). Re-confirmed 0-hit grep (security-reviewer). Do NOT re-open.
- **RES-R7C6-01** (HEIC GPS-strip residual) — CLOSED (no surviving route streams `data/uploads/original/`; nginx 404 + startup assert). Re-confirmed by security-reviewer + tracer (Flow 2 adjacent).
- **CR-R9C2-01** (cicp-recheck onEmpty→onIdle) — FIXED run-9 c2; re-verified correct + complete this cycle (5 agents). Do NOT re-file.
- **MED-R7C2-01** (histogram clip %) — REFUTED. Stays refuted.
- **REJ-R7C3-01** (`gps-exif-strip.ts:466` indexSize) — DISPROVED. Stays disproved.
- **NF-R7C4-01** (`color-detection.ts:185` code-4 comment) — VERIFIED CORRECT vs ITU-T H.273. Stays verified.
- **NF-R7C5-01** (`migrate.js` baselineAllJournalMigrations duplicate rows) — REFUTED. Stays refuted.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. document-specialist re-confirmed maps match CLAUDE.md ↔ code (gamma28=code5, matrix8=YCgCo, gamma26=code17, gamma24=14/15). Class closed.
- **`process-image.ts:1108` "paid" idiom + `:1570/1646` "download-original" comments** — NOT findings (idiom / cosmetic zero-behavioral-impact). Re-confirmed not re-filed.
- **PASSWORD_CHANGE_MAX_ATTEMPTS orphaned / load-more mountedRef / session.ts:145 off-by-one / CSP nonce reuse** — all REFUTED prior cycles; not re-filed.
- **SW stamp lag-by-one** — intentional prebuild cadence, NOT a defect. The `c2d3857a-p7` stamp refresh this cycle rides the verifier's build per established cadence.

---

## AGENT FAILURES

Two agents (test-engineer `a67f9a86048f64a3d`, tracer `a64849f0f98b53015`) returned from their first spawn mid-work without emitting a final report or persisting their `.md` file (test-engineer was still running the suite; tracer was mid-COLOR_IMPACTING_KEYS check). Per the run instructions both were resumed once via SendMessage with their in-progress context; both resumes completed, wrote their files, and returned final conclusions. All 11 provenance files now exist in `.context/reviews/run9-cycle3/`.

---

## Disposition

- **NEW actionable findings:** 3 — TE-R9C3-01 (LOW, flaky CI test), DES-R9C3-01 (LOW, WCAG-A label gap), DES-R9C3-02 (LOW advisory, th scope). All on non-product-runtime surfaces (test / admin UI).
- **Scheduled + implemented fixes:** 2 (TE-R9C3-01 + DES-R9C3-01). Plans: `.context/plans/run9-cycle3/`.
- **Deferred:** 1 (DES-R9C3-02 advisory) + the run-7/8/9 carry-forward register, all in `.context/plans/run9-cycle3/deferred.md`.
- **Non-findings / re-confirmed-benign (provenance):** debugger 5-module re-spot-check + 5 tracer flows + blur-data-url REFUTED + cicp-recheck-no-test observation.
- **Gate state:** all green pre-fix (modulo the 1 flake that motivated TE-R9C3-01); re-run after the two fixes.
- **Deploy:** none (DEPLOY_MODE=none).

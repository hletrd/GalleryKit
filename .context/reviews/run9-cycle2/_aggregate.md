# Aggregate Review — Run-9 Cycle-2 (HEAD `1ef54aaa`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs by verifier at HEAD `1ef54aaa`, pre-fix):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 routes OK) / lint:action-origin (47 actions: 36 OK + 5 exempt-annotated) / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts, 7 JS files) exit 0; Vitest **2054 passed / 4 skipped / 0 failed** (226 files; 30.8s). The 4 skips are exclusively the CLIP-weight-gated suites. Next.js prod build run by the lead after the cycle's one fix.

## Context

This is cycle-2 of run-9. Run-8 converged at cycle-2 (`f63af3b9`); run-9 cycle-1 converged-with-fixes at `d3858cfc`. **Since run-8 convergence `f63af3b9`, the ONLY production-relevant source changes are TWO new test files** — `apps/web/src/__tests__/upload-tracker-state.test.ts` and `upload-processing-contract-lock.test.ts` (the run-9 cycle-1 scheduled fixes TE-R9C1-01/02), plus a SW version-stamp refresh and review-doc markdown. `git diff --stat f63af3b9..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle apps/web/messages` = those two test files only. Zero production logic, schema, config, or migration change across run-8c2 → run-9c1 → run-9c2.

This cycle's review angle: a fresh deep skeptical whole-repo sweep from every angle, deliberately widened beyond the (empty) source delta, to find anything missed across 9 runs.

**Headline result: convergence holds. Ten of eleven agents found ZERO new actionable findings.** The code-reviewer surfaced **one genuine, code-confirmed LOW finding (CR-R9C2-01)** in a read-only manual diagnostic script (`scripts/backfill-cicp-recheck.ts:127`, `onEmpty()` → `onIdle()`), independently re-verified by the lead against the installed p-queue 9.1.2 typedef AND the grep of all 6 queue-drain sites (5 siblings already use `onIdle()`; this file was the lone outlier). It is NOT in the carried deferral register. The fix is a one-line change matching established repo convention, on no product runtime path, risk-free → scheduled + implemented this cycle.

---

## Cross-agent agreement matrix (high-signal items)

| Finding / verdict | Agents agreeing | Net disposition |
|---|---|---|
| **Convergence genuine on correctness/security/perf/arch/doc/a11y/test axes** | code-reviewer, security-reviewer, architect, critic, verifier, perf-reviewer, tracer, debugger, document-specialist, designer, test-engineer (11) | **CONFIRMED — 0 new on these axes (CR-R9C2-01 is off-path diagnostic only)** |
| Only source change since converged `f63af3b9` = two test files (run-9c1's own fixes); typecheck PASS = machine proof of no dangling types | code-reviewer, architect, critic, perf-reviewer, security-reviewer | **CONFIRMED** (5 agents) |
| `backfill-cicp-recheck.ts:127` `onEmpty()` races in-flight tasks → summary counts/late errors omitted; should be `onIdle()` like all 5 siblings | code-reviewer (CR-R9C2-01), lead-confirmed against p-queue 9.1.2 typedef + 6-site grep | **SCHEDULED + FIXED — NEW (LOW)** |
| The two new test files (TE-R9C1-01/02) are SOUND — mutation-proven non-tautological, meaningful assertions, no false confidence | critic (3 source-mutation proofs), test-engineer (branch-by-branch), verifier (boundary assertions), architect | **CONFIRMED SOUND** (4 agents) |
| Privacy derivation holds — `publicSelectFields` omit-derived; compile guards (`_SensitiveKeysInPublic`/`_MapSensitiveKeysInPublicMap`) hold; no PII leak; `avif_10bit` correctly public | architect, security-reviewer, tracer (Flow 2), critic, code-reviewer | **CONFIRMED CLEAN** (5 agents) |
| Migration / reconcileLegacySchema correct; journal newest entries (0018-0023) strictly monotonic; 0023 paid-download drop mirrored `migrate.js:627-628`; post-condition won't false-fail | architect, critic, code-reviewer | **CONFIRMED CLEAN** (3 agents) |
| Advisory locks (6 names) acquire/release-symmetric on dedicated connections; queue worker + backfill runner serialize on identical names (`getImageProcessingLockName` delegate) | architect, critic, code-reviewer | **CONFIRMED CLEAN** (3 agents) |
| Delete-during-reencode race fully fenced — `affectedRows===0` → full-scan variant cleanup, counted `deleted-mid-reencode` (both runner + sidecar) | tracer (Flow 3), code-reviewer, critic, debugger | **CONFIRMED CLEAN** (4 agents) |
| Session/auth chain safe — HMAC + timingSafeEqual + post-HMAC format check (no timing oracle) + prod SESSION_SECRET startup guard + middleware format filter + dual same-origin/isAdmin on actions | tracer (Flow 4), security-reviewer, code-reviewer | **CONFIRMED CLEAN** (3 agents) |
| Admin-string Unicode-sanitization symmetric across ALL render surfaces (validation reject + sanitizeForOg + EXIF cleanString + JSON-LD safeJsonLd) | tracer (Flow 1), security-reviewer | **CONFIRMED CLEAN** (2 agents) |
| ETag/settings-hash `COLOR_IMPACTING_KEYS=9` holds; `_ColorKeysAreSettingKeys` guard holds; config-arg primary on serve path | architect, document-specialist, verifier | **CONFIRMED CLEAN** (3 agents) |
| No perf/concurrency regression on any hot path (masonry queries, getImage Promise.all, OG LIMIT-1, Sharp per-format decode, SW 300ms HEAD, view-retention chunked DELETE) | perf-reviewer (source-validated), code-reviewer, debugger | **CONFIRMED** (3 agents) |
| Binary parsers BENIGN — ISOBMFF/ICC/gain-map/GPS walkers all bounds/depth/scan-capped; rate-limit + bounded-map eviction collect-then-delete; global-regex `/g` instances non-shared | debugger (14-module table), code-reviewer, critic | **CONFIRMED BENIGN** (3 agents) |
| Touch-target gate PASS (15/15); i18n key parity en↔ko (ko no-plural by-design); FocusTrap + aria-label + skip-link present | designer | **CONFIRMED CLEAN** |
| On-disk docs (CLAUDE.md/AGENTS.md/README) accurate against code on every spot-check (IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, VIEW_RETENTION_DAYS=395, advisory locks, NCLX maps, backfill columns, nginx caps, 19/19 Key-Files paths exist) | document-specialist, verifier, architect | **CONFIRMED CLEAN** (3 agents) |

---

## SCHEDULED + IMPLEMENTED finding (this cycle)

### CR-R9C2-01 [LOW, conf HIGH] — `backfill-cicp-recheck.ts:127` drains the PQueue with `onEmpty()` instead of `onIdle()` — summary counts race in-flight tasks
**Where:** `apps/web/scripts/backfill-cicp-recheck.ts:127` — was `await queue.onEmpty();`.
**Why it's a bug:** Per the installed **p-queue 9.1.2** typedef (`node_modules/p-queue/dist/index.d.ts:105-107`): *"`.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet."* `onEmpty()` resolves at `queue.size === 0` (nothing WAITING), NOT `queue.pending === 0` (running). With `concurrency` (default 2, env-overridable), when the final ≤2 tasks are pulled to run, `size` hits 0 and `onEmpty()` resolves immediately while those tasks are still inside their `fs.access` / `sharp().metadata()` / `detectColorSignals()` chain. The per-row counters (`checked`/`flips`/`missing`/`errors`) are all mutated INSIDE the queued task body (including the `missing++; return` early-return at `:94-95`), and the summary block (`:129-138`) reads them right after the drain. So the last ≤concurrency images' tallies are frequently omitted from the printed totals, and a late `console.error` for an in-flight image prints AFTER "Done." For a tiny table (e.g. the documented ~445-image surface re-checked after an NCLX fix lands a handful of flips) the miss can flip an operator's decision on whether a real color backfill is warranted.
**Why LOW:** read-only one-shot MANUAL diagnostic (never writes DB/FS, not wired into any automatic job, not on any product request path). Worst case is an operator over/under-counting flips by ≤`concurrency` rows. No data corruption.
**Lead verification:** CONFIRMED — read the source, confirmed the p-queue 9.1.2 typedef semantics, and grepped all 6 drain sites: 5 siblings (`backfill-color-pipeline.ts:500`, `image-queue.ts:595/759`, `queue-shutdown.ts:33`, `admin-backfill-runner.ts:764`) already use `onIdle()`; this file was the lone `onEmpty()` outlier.
**Fix (implemented):** `onEmpty()` → `onIdle()` with an explanatory comment, bringing the file in line with all 5 siblings. One-line behavioral change; no new test required (read-only diagnostic with no automated harness; the fix simply waits for tasks the summary already reads).

---

## NON-FINDINGS / re-confirmed-benign this cycle (provenance — do NOT re-file)

- **debugger 14-module BENIGN table** — color-detection ISOBMFF walker (1MB pre-cap + MAX_DEPTH=5), icc-extractor mluc offset guards, icc-chromaticity XYZ bounds + singular-matrix guard, gain-map walker (try/catch + 1024 caps), gps-exif-strip TIFF/JPEG/XMP (visited-Set cycle detection + post-EOI trailer rejection), bounded-map collect-then-delete eviction, rate-limit decrement-not-delete rollback + non-shared `/g`, view-retention chunked-DELETE break-correct + negative/non-finite guard, upload-tracker `Math.max(0,…)`, sw-cache LRU delete-then-set, csv-escape non-shared `/g` + C0-pre-strip, validation `UNICODE_FORMAT_CHARS` `.test()`-only + `safeInsertId` BigInt guard, image-queue FIFO collect-then-delete + size caps — all BENIGN with file:line evidence. Re-confirms the prior-cycle adjudications; nothing changed.
- **All four tracer flows CONFIRMED-SAFE** (admin-string→render symmetry; color-column→public/admin field separation; backfill delete-race cleanup; session→middleware→isAdmin). No new flow finding.
- **settings-hash no-arg vs config-arg divergence** — re-confirmed BENIGN-BY-DESIGN (debugger did not re-raise; carried as non-finding from run-9c1). Production serve path uses config-arg form.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `1ef54aaa`, no new evidence, no exit criterion met — full register in `.context/plans/run9-cycle2/deferred.md`)

- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified out-of-scope (`<Input>` deliberately excluded from touch-target audit). Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (perf-reviewer re-confirmed CR-02 no measured regression; architect re-confirmed CR-01 lock-serialized).
- **TE-R7C2-03** [LOW] — semantic route malformed-embedding row-skip untested. Carried (test-engineer re-confirmed STILL OPEN).
- **TE-R7C2-04** [LOW] — `logAuditEvent` metadata-truncation untested (exit criterion documented: 4096-char metadata → assert `"truncated":true` + code-point-boundary preview). Carried (STILL OPEN).
- **TE-R7C2-05** [INFO] — `embeddings.ts` action no dedicated test. Carried (STILL OPEN).
- **OBS-R7C2-02..07** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry; updateTopic no FOR UPDATE. Carried (architect + debugger re-confirmed unchanged, documented-design / operator-mitigated).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open — re-confirmed this cycle where examined)

- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8). Confirmed 0-hit grep (security-reviewer, test-engineer). Do NOT re-open.
- **RES-R7C6-01** (HEIC GPS-strip residual) — CLOSED (no surviving route streams `data/uploads/original/`; nginx 404 + startup assert + evacuation). Re-confirmed by security-reviewer + tracer (Flow 2 adjacent) + debugger.
- **MED-R7C2-01** (histogram clip %) — REFUTED. Stays refuted.
- **REJ-R7C3-01** (`gps-exif-strip.ts:466` indexSize) — DISPROVED; file byte-identical. Stays disproved.
- **NF-R7C4-01** (`color-detection.ts:185` code-4 comment) — VERIFIED CORRECT vs ITU-T H.273 (critic re-verified entry-by-entry: 12 transfer + 5 matrix codes). Stays verified.
- **NF-R7C5-01** (`migrate.js` baselineAllJournalMigrations duplicate rows) — REFUTED. Stays refuted.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. critic + document-specialist re-confirmed all maps match between CLAUDE.md and code (gamma28=code5, matrix8=YCgCo, gamma26=code17, gamma24=14/15). Class closed.
- **`process-image.ts:1108` "Only paid on the wide-gamut path"** ("paid"=idiom) and **`:1570/1646` "download-original path" comments** (cosmetic, zero behavioral impact) — NOT findings. code-reviewer did not re-file.
- **CSP nonce reuse / PASSWORD_CHANGE_MAX_ATTEMPTS orphaned / load-more mountedRef / session.ts:145 off-by-one** — all REFUTED in prior cycles; code-reviewer + security-reviewer re-confirmed not re-filed.
- **SW stamp lag-by-one** — intentional prebuild cadence, NOT a defect.

---

## AGENT FAILURES

The test-engineer's first spawn returned mid-work (it was still scanning untested `lib/` modules and had not emitted a final report or persisted its file). Per the run instructions it was resumed once via SendMessage with its in-progress context; the resume completed, wrote `test-engineer.md`, and returned the final conclusion (0 new gaps; the two new test files SOUND; carried TE-R7C2-03/04/05 still open). All 11 provenance files now exist in `.context/reviews/run9-cycle2/`.

---

## Disposition

- **NEW actionable findings:** 1 (CR-R9C2-01 LOW — off-path read-only diagnostic correctness defect, lead-confirmed against the p-queue typedef + 6-site grep).
- **Non-findings / re-confirmed-benign (provenance):** debugger 14-module table + 4 tracer flows + settings-hash divergence.
- **Scheduled + implemented fixes:** 1 (CR-R9C2-01). Plan: `.context/plans/run9-cycle2/`.
- **Deferred-register bookkeeping:** all run-9 cycle-1 open deferrals carried forward unchanged in `.context/plans/run9-cycle2/deferred.md`.
- **Gate state:** all green pre-fix; re-run after the one-line script fix (no lint/typecheck/test/build risk — read-only script with no automated harness; typecheck:scripts covers it).
- **Deploy:** none (DEPLOY_MODE=none).

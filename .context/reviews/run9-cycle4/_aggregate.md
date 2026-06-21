# Aggregate Review — Run-9 Cycle-4 (HEAD `094842a4`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs by verifier at HEAD `094842a4`, pre-fix):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 admin routes OK) / lint:action-origin (42 actions: 36 OK + 6 exempt) / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts) exit 0; Vitest **2054 passed / 4 skipped / 0 failed** (226 files, 22.4s — no flake observed this run); Next.js prod build exit 0 (Turbopack 5.5s, 10/10 static pages). The 4 skips are exclusively the CLIP-weight-gated suites. A lead-run background lint+typecheck also returned exit 0.

## Context

This is cycle-4 of run-9. Run-8 converged at cycle-2 (`f63af3b9`); run-9 cycle-1 (`d3858cfc`, 2 LOW test files), cycle-2 (`c2d3857a`, 1 LOW off-path cicp drain), cycle-3 (`094842a4`, 2 LOW: test-harness `beforeAll` + bulk-edit aria-labels) all converged-with-fixes. **Since run-8 convergence `f63af3b9`, the production source delta is FOUR files**: `scripts/backfill-cicp-recheck.ts` (onIdle), two new test files, and `bulk-edit-dialog.tsx` (aria-labels). The production *runtime-logic* surface (`apps/web/src/lib` + `apps/web/src/app`) is essentially unchanged. This cycle deliberately widened the review beyond that near-empty delta — a fresh skeptical whole-repo sweep from every angle to find anything missed across 9 runs.

Under the orchestrator's HIGH-BAR directive: report only genuine DEFECTS; route marginal polish to deferral. This cycle the fan-out found **ONE genuine DEFECT** (designer, public-surface WCAG Level A), independently validated by the lead against code, the API contract, and the sibling-component pattern.

---

## Cross-agent disposition table

| Axis | Agent(s) | Verdict |
|---|---|---|
| Correctness / logic / quality | code-reviewer | **CLEAN** — 3 candidates RAISED then all REFUTED (claim-retry exhaustion not a failure; `and(...,undefined)` is idiomatic Drizzle filtered before SQL; WI-15 tmp cleanup is in `finally`). Smart-collections SQL compiler allowlist+bound-params+LIKE-escape clean. |
| Security (OWASP) | security-reviewer | **CLEAN** — auth chain, withAdminAuth token branch fail-closed, 8 API routes, 4-layer path-traversal+symlink+realpath, Drizzle parameterization + smart-collections allowlist, spawn-no-shell restore, CSV/OG/Unicode shared sanitizers, privacy guard. All 3 security lints validated to enforce their claims at AST level. Housekeeping note: `npm audit` not run (no registry assumed; zero manifest change). |
| Architecture (single-writer topology) | architect | **CLEAN** — 6 advisory locks symmetric, delete-while-processing `affectedRows===0` full-scan cleanup ×3 paths, restore quiesce `clear()`→`onIdle()`, ETag 9 COLOR_IMPACTING_KEYS + HASH_LENGTH=8, pool budget cap=2@pool10, **programmatic schema↔reconcile parity proof: 0 missing columns**. |
| Critic / meta-convergence | critic | **ACCEPT — convergence GENUINE.** 11 CLAUDE.md claims independently verified accurate; all gates green; the cycle-3 `beforeAll` near-no-op is the already-documented TE-R9C3-01 residual (DEFER, not new). |
| Gate evidence | verifier | **PASS** — 7/7 gates green; both cycle-3 fixes verified present; no flake this run; SW stamp matches HEAD. |
| Test health | test-engineer | **HEALTHY** — 6 fixture-contract tests validated correct against impl (view-retention chunk math, backfill 9-col, sanitize-for-og shared import, privacy 20-key symmetry, touch-target KNOWN_VIOLATIONS, upload-tracker beforeAll). No wrong/flaky/broken test. |
| Performance (hot paths) | perf-reviewer | **CLEAN** — no N+1 (tagNamesAgg single-query, getImage fixed-4, getSharedGroup `inArray` batch), indexes cover listing/topic/prev-next, Sharp fan-out bounded, serve-upload settings-hash TTL+SWR. POLISH-only items (admin write-path per-key tx) not filed. |
| Causal tracing (3 flows) | tracer | **CLEAN** ×3 — admin-backfill deleted-mid-reencode cleanup (all 3 dirs, no version bump on 0-rows); settings→ETag two-tier (documented gotcha holds); CLIP decode null-skip + resolver heal. |
| Latent bugs (parsing/boundary) | debugger | **ALL BENIGN** — icc-extractor mluc/desc offsets, gain-map dead-branch, sw-cache eviction-by-design, view-retention parseInt-truncate, icc-chromaticity invert3x3 1e-12, auth-rate-limit in-place reset (single-threaded), mluc recordSize×index overflow caught by `recOffset+12>iccLen` + 100-iter cap. (Returned mid-analysis without a final verdict line; all persisted analysis concludes BENIGN; the lead re-confirms no actionable bug.) |
| Docs vs code | document-specialist | **CLEAN** — all 10 mandated spot-checks MATCH (pipeline=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, retention=395, backfill cap=2@10, 6 lock names, cache()=10, nginx caps, NCLX maps, 11 key-file paths). No new drift. |
| UI/UX a11y | designer | **ONE NEW DEFECT** — DES-R9C4-01 (public-surface WCAG Level A empty accessible-name on similar-photos thumbnail link). Touch-target gate PASS; cycle-3 aria fix holds; all other public surfaces clean. |

---

## SCHEDULED + IMPLEMENTED finding (this cycle)

### DES-R9C4-01 [LOW, conf HIGH, DEFECT] — `similar-photos.tsx` thumbnail `<Link>` has an empty accessible name when title AND description are both null (WCAG 4.1.2 / 2.4.4 Level A) — PUBLIC surface

**Where:** `apps/web/src/components/similar-photos.tsx:174-199` (`SimilarThumb`); the empty value originates at `:145` (`title={item.title ?? item.description ?? null}`) and lands at `:182` (`title={title ?? undefined}`) and `:186` (`alt={title ?? ''}`).

**Why it's a DEFECT (not polish):**
- **Public, live surface.** `SimilarPhotos` renders only when `semanticSearchMode === 'production'` (`:101`). CLAUDE.md confirms the production deployment runs `semantic_search_mode=production` with live embeddings — so this panel is live on every `/p/[id]` photo page in production, not a dead/dark control.
- **Empty accessible name.** When a photo has neither `title` nor `description` (both are optional columns with no DB default — the common case for gallery photos), the `SimilarThumb` `<Link href="/p/{id}">` computes an accessible name of `""`:
  - `alt={title ?? ''}` → `alt=""` explicitly marks the `<Image>` decorative and removes it from the link's accname subtree;
  - `title={title ?? undefined}` → no `title` attribute;
  - no `aria-label` / `aria-labelledby` on the `<Link>`.
  A screen-reader user lands on a link announced only as "link" with no name — and a keyboard user tabbing the 3-up grid hits N indistinguishable unnamed links. This is a firm **WCAG 4.1.2 Name, Role, Value (Level A)** and **2.4.4 Link Purpose (Level A)** failure on a public control.
- **Clear in-repo inconsistency, established fix pattern exists.** The sibling search result (`search.tsx:83`) already does the right thing: `alt={image.title || t('common.photo')}` — falling back to the localized "Photo" string. `similar-photos.tsx` is the odd one out. The i18n key `common.photo` already exists in both `en.json:412` ("Photo") and `ko.json:412` ("사진") — no new translation key needed.

**Why LOW (not higher):** single component, graceful degradation (the link still works; only the *name* is missing); fix is one line reusing an existing key and an existing pattern. But a Level-A public-surface a11y failure with a trivial fix is a DEFECT, not deferrable polish — it is a firm WCAG violation affecting real users, and the high-bar policy lists "real product-runtime bug" as never-deferrable. Decisively scheduled.

**Fix (implemented):** give `SimilarThumb` a non-empty accessible name fallback matching `search.tsx`. Pass the localized "Photo" fallback so the `<Link>` always has an accname: set the `<Image>` `alt` to `title ?? <localized "Photo">` and add `aria-label={title ?? <localized "Photo">}` to the `<Link>` for the title-attr/no-image case, reusing the existing `common.photo` key (already imported as `tCommon` in the parent at `:61`). No new translation keys; matches the established sibling pattern.

---

## DEFERRED finding(s) (this cycle)

None new. (The designer's only finding was a genuine DEFECT and was scheduled+implemented.) The run-7/8/9 carry-forward register is preserved unchanged in `.context/plans/run9-cycle4/deferred.md` (re-verified UNCHANGED at HEAD; no exit criterion met for any).

---

## NON-FINDINGS / re-confirmed-benign this cycle (provenance — do NOT re-file)

- **code-reviewer's 3 REFUTED candidates:** (1) `image-queue.ts:265` claim-retry not added to `permanentlyFailedIds` — a failed *claim* means another worker holds the lock and is actively processing, NOT an image failure; blacklisting it would be a bug. (2) `data.ts:1368` `and(...,undefined)` — verified in drizzle-orm source: `and()` filters `c !== void 0` before building SQL; idiomatic. (3) `process-image.ts` WI-15 tmp leak — cleanup is in `finally` (1312-1316). All REFUTED.
- **debugger 9-module benign re-spot-check** — icc-extractor, gain-map-detection, sw-cache, view-retention, icc-chromaticity, settings-hash, auth-rate-limit, csv-escape, og-sanitize all BENIGN at HEAD; the prior 14-module table holds. (Notable: mluc `recordSize × recordIndex` cannot overflow into a served read — the `recOffset+12 > iccLen` guard + 100-iteration `numRecords` cap fire immediately.)
- **critic's TE-R9C3-01 residual observation** — the cycle-3 `beforeAll` is a near-no-op under the default `forks` pool (files run sequentially; `beforeEach` already covers it; the docstring concedes it only helps non-default pools). This is the ALREADY-DOCUMENTED scheduled-residual (run9-cycle3 aggregate lines 53/77, lead's deliberate "don't over-engineer an unreproducible race" decision), NOT a new defect. DEFER, no action.
- **tracer TE-R7C2-03 re-confirmation** — the CLIP scan-loop null-filter integration is still untested at route level (the decoder primitive IS tested). Carried, not re-filed (already in deferred register).
- **security npm-audit housekeeping** — not run (no registry assumed, zero dependency-manifest change since last audited cycle). Non-blocking carry-forward for the next deploy-host pass; not a finding.
- **document-specialist primaries-label observation** — CLAUDE.md says "Display P3" for NCLX primaries code 12 while the code enum label is `'p3-d65'`; same thing (Display P3 = D65 white point), human-readable marketing name is accurate. Not a defect.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `094842a4`, no new evidence, no exit criterion met — full register in `.context/plans/run9-cycle4/deferred.md`)

- **DES-R9C3-02** [LOW advisory] — analytics `<th>` lack `scope="col"` (admin-only, simple 2-3-col tables, UA heuristics associate correctly). Designer did NOT re-file (exit criterion unmet). Carried.
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Deliberately out of touch-target-audit scope. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (architect re-confirmed CR-01 lock-serialized; perf-reviewer re-confirmed CR-02/CR-04 no measured regression).
- **TE-R7C2-03/04/05** [LOW/INFO] — semantic route null-skip untested; logAuditEvent truncation untested; embeddings action no dedicated test. test-engineer + tracer re-confirmed STILL OPEN. Carried.
- **OBS-R7C2-02..06** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry. Carried (architect re-confirmed documented-design / operator-mitigated).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql`; advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open — re-confirmed where examined)

- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8). Security-reviewer re-confirmed 0-hit. Do NOT re-open.
- **RES-R7C6-01** (HEIC GPS-strip residual) — CLOSED (no surviving route streams `data/uploads/original/`). Security-reviewer re-confirmed.
- **CR-R9C2-01** (cicp-recheck onEmpty→onIdle) — FIXED run-9 c2; re-verified correct. Do NOT re-file.
- **TE-R9C3-01 / DES-R9C3-01** — FIXED run-9 c3; verifier + designer + test-engineer re-confirmed both fixes hold. Do NOT re-file.
- **MED-R7C2-01** (histogram clip %) — REFUTED. **REJ-R7C3-01** (gps-exif indexSize) — DISPROVED. **NF-R7C4-01** (color-detection code-4 comment) — VERIFIED CORRECT. **NF-R7C5-01** (migrate.js dup rows) — REFUTED. All stay closed.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. document-specialist re-confirmed maps match CLAUDE.md ↔ code.
- **CSP nonce reuse / session.ts off-by-one / load-more mountedRef / PASSWORD_CHANGE_MAX_ATTEMPTS** — all REFUTED prior cycles; not re-filed.

---

## AGENT FAILURES

None requiring resume. The debugger (`a0db3d5c5725674fb`) returned from its single spawn after a thorough 9-module analysis but stopped before emitting a final one-line verdict; every module it analyzed concluded BENIGN and it persisted its `.md` file. The lead reviewed its output and confirms no actionable bug was found — no resume needed. All 11 provenance files exist in `.context/reviews/run9-cycle4/`.

---

## Disposition

- **NEW actionable DEFECT findings:** 1 — DES-R9C4-01 (LOW, conf HIGH, public-surface WCAG Level A empty accessible-name). 10 of 11 agents reported convergence (zero new defects); the designer found the single real defect, lead-validated.
- **Scheduled + implemented fixes:** 1 (DES-R9C4-01). Plan: `.context/plans/run9-cycle4/plan-run9c4-fixes.md`.
- **Deferred:** 0 new; full run-7/8/9 carry-forward register preserved in `.context/plans/run9-cycle4/deferred.md`.
- **Gate state:** all 7 green pre-fix; re-run after the fix.
- **Deploy:** none (DEPLOY_MODE=none).

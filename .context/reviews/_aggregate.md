# Aggregate Deep Review — Cycle 9/100 (review-plan-fix)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6 photo gallery)
**Cycle:** orchestrator "cycle 9/100". Working tree CLEAN at start; HEAD `0ce84b1b` in sync with origin/master.
**Agents that returned (11/11):** code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer. **One read-only-reviewer write-recovery — see AGENT FAILURES (no finding lost).**

**Gate baseline measured live this cycle (orchestrator ran every gate INLINE before aggregating):**
- `npm run lint` → **exit 0** (clean)
- `npm run lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` → **all exit 0**
- `npm run typecheck` (app + scripts) → **exit 0** ("Types generated successfully", zero tsc errors; run isolated from concurrent vitest, so the documented `next typegen` race did NOT reproduce)
- `npx vitest run --no-file-parallelism` → **exit 0, 219 files / 2094 tests passed, 0 failed** (~164 s). Count is 2094 = the cycle-8 baseline 2093 + 1 (the AGG-C8-01 `generateBase56` distribution test landed in `71ab0f41`). Running with `--no-file-parallelism` avoided the documented cold-encoder real-encode flake (AGG-C8-R-FLAKE) entirely — clean green.

> The prior cycle-8 aggregate has been superseded by this file. Per-agent files were overwritten by this cycle's fan-out. `architect.md` was persisted by the orchestrator from the agent's inline-returned report (it ran read-only — see AGENT FAILURES); all others wrote their own files.

---

## TOP-LEVEL: THIS IS THE CLEAN CONVERGENCE STOP. ZERO new code-change findings from all 11 agents.

The finding-count trend across the run is now **12 → 13 → 17 → 9 → 5 → 6 → 5 → 2 → 0**. Every one of the 11 specialist axes — code-quality, security, performance, critique, verification, test-depth, causal-tracing, architecture, debugging, documentation, and UI/UX — independently reports **no new code change is warranted**. This is the clean stop signal the loop has been converging toward.

Crucially: **no production source changed since cycle 8.** The only commits since the cycle-8 baseline (`9c40d261..0ce84b1b`) are:
- `71ab0f41` — AGG-C8-01: `generateBase56` distribution **test** (test-only)
- `aa8a6f8a` — AGG-C8-02: CLAUDE.md SCAN_ROOTS **doc** line (doc-only)
- `7669217b`, `9c40d261`, `0ce84b1b` — review/plan artifacts (docs-only)

So there is no new production surface on which a defect could appear. Both cycle-8 scheduled items are CONFIRMED-CLOSED at HEAD by independent re-verification (NOT trusted on the plan's word):

| Prior finding | Status at HEAD `0ce84b1b` | Closing commit | Re-verified by |
|---|---|---|---|
| AGG-C8-01 — `generateBase56` had no modulo-bias / distribution test (the share-key entropy primitive) | **CLOSED, PROVEN NON-VACUOUS** — verifier AND test-engineer independently mutated `base56.ts` to naive `byte % 56` and drove the new distribution test RED (`ratio 1.29 / 1.30 ≥ 1.2`) while the other 9 base56 tests stayed GREEN (blind to the entropy regression); restored byte-identically (hash `39ddc2dc…` matches HEAD). | `71ab0f41` | verifier (RED-by-hand), test-engineer (RED-by-hand), security-reviewer, critic, designer |
| AGG-C8-02 — CLAUDE.md SCAN_ROOTS doc understated audit coverage | **CLOSED + CORRECTED** — `CLAUDE.md:505` lists all three real SCAN_ROOTS dirs (`components/` + `app/[locale]/admin/` + `app/[locale]/(public)/`) matching `touch-target-audit.test.ts:79-83`. The commit notably CORRECTED the cycle-8 critic's prose: the "root-level locale files" the review wanted added are `appLevelExtraFiles` (scanned but NOT a SCAN_ROOTS entry), so the author verified against source and did NOT add them — doc now matches code EXACTLY. | `aa8a6f8a` | document-specialist, verifier, critic |

---

## Cross-agent convergence map — NEW this cycle

**ZERO schedulable findings.** The single item raised by any agent is a non-defect (a transient concurrent-agent probe), documented below for provenance and explicitly NOT counted as a real finding.

| Agg ID | Finding | Severity | Conf | Agents | Status |
|---|---|---|---|---|---|
| **AGG-C9-NONDEFECT** | **`is_hdr` admin-only field transiently re-added to `publicMapSelectFields` in the WORKING TREE — NOT a committed defect; the compile-time guard correctly BLOCKED it.** During the concurrent fan-out, security-reviewer and code-reviewer both observed an uncommitted edit (mtime AFTER the HEAD commit) re-adding `is_hdr: images.is_hdr` (and in code-reviewer's view, `latitude`) to a public select field while the column stayed in `PrivacySensitiveKeys`. This was a **RED-proof verification probe left transiently by another fan-out agent** (the documented "prove the guard fires" pattern), not a real change. `npx tsc -p tsconfig.typecheck.json` → `error TS2322 … 'is_hdr' … ERROR: privacy-sensitive field found in publicMapSelectFields` — the `_mapPrivacyGuard` fired exactly as designed, and `typecheck:app` is a BLOCKING CI gate so the edit cannot pass commit/deploy. The orchestrator confirmed the source tree is CLEAN at HEAD (`git diff -- apps/web/src` empty; no `is_hdr`/`latitude` re-addition in `data.ts`). **The valuable half of this observation is the live proof that the defense-in-depth compile-time privacy guard is functional.** | **NOT A FINDING** (working-tree-only; guard-blocked; source clean at HEAD) | High (deterministically reproduced via tsc; tree confirmed clean at HEAD) | 2 (security-reviewer SEC9-01, code-reviewer CR9-OBS-1) | NON-DEFECT — recorded for provenance; **counts as 0 schedulable findings** |

### Record-only / re-confirmed-deferred tail (DEFER — bound by repo rules; no code change scheduled; severity preserved)

All carried UNCHANGED from prior cycles. None re-escalated. Each was re-counted/re-read against live source this cycle.

| Agg ID | Finding | Severity | Disposition |
|---|---|---|---|
| **AGG-C9-R1** | **CR9-OBS-1** (code-reviewer) — when the `data.ts` privacy guard fires, the FIRST `tsc` error points at `_mapPrivacyGuard`/`is_hdr` (line 432) rather than the `_privacyGuard`/`publicSelectFields` that semantically owns a `publicSelectFields` leak (line 420). The protection HOLDS (the build fails either way); this is a cosmetic TS error-ordering artifact, below the bar for a change. | LOW (cosmetic; protection intact) | DEFER / record-only — no code change; the guard works. |
| **AGG-C9-R2** | **DBG8-NC-01** (debugger) — `gain-map-detection.ts:87` harmless unreachable dead-code guard (`if (p > limit) return ''` after a `while (p < limit)`). Persists, zero functional impact. | LOW (harmless dead code) | RECORD — no fix. |
| **AGG-C9-R3** | **DBG8-NC-02** (debugger) — `isLosslessWebpByChunk` (`process-image.ts`) does not descend into `ANMF`, so an *animated lossless* WebP hitting the doubly-rare Tier-2 GPS re-encode fallback would re-encode lossy. Explicit SAFE default; **GPS is stripped either way** → zero privacy/correctness impact. | LOW (quality, doubly-rare path, privacy-safe) | DEFER / record-only — no privacy/correctness impact; optional comment-tightening only. |
| **AGG-C9-R4** | **TE8-02** (test-engineer) — `map-privacy.test.ts` runtime GPS-leak-guard tests re-implement the guard inline (structural mirror) rather than calling the real `getMapImages` predicate. The compile-time UNION contract + the runtime `getMapImages` INNER-JOIN/throw are the genuine protection and DO cover the column-leak vector; the mirror test is belt-and-braces. | LOW | DEFER / record-only — the real protection is sound and covered. |
| **AGG-C9-R5** | **DOC8-01** (document-specialist) — `AGENTS.md:40` says `.context/plans/` "is gitignored" but `git ls-files` shows tracked artifacts remain and no `.gitignore` rule matches it; live plans live in repo-root `/plan/`. Does not mislead any security/correctness decision. | LOW (doc nuance) | DEFER / record-only (unchanged from prior cycles). |
| **AGG-C9-R-FLAKE** | The real-encode AVIF/WebP test-isolation flake (= AGG-C8-R-FLAKE / AGG-C7-R7 / AGG-C4-T2). Did NOT reproduce in the orchestrator's `--no-file-parallelism` baseline (2094/2094 green), consistent with its characterization as a cold-encoder / shared `public/uploads` / parallelism-sensitive **test-infra flake, NOT a source defect**. Tracer re-ran the prior TRC8-01 WebP-XMP case 3/3 isolated PASS this cycle. | LOW (test infra; run-to-run nondeterministic; NOT a code defect) | DEFER — scoped `mkdtemp` per-test output-isolation + `beforeAll` encoder warm-up remains the documented deferred fix. Re-open: when a green-cold guarantee is required on a non-parallel CI lane. |

### Architecture / perf / designer / security record-only (re-confirmed UNCHANGED; all prior-deferred — DO NOT re-escalate)

| Agg ID | Finding | Severity | Disposition |
|---|---|---|---|
| **AGG-C9-R6** | Architecture deferrals re-confirmed UNCHANGED by live source re-count (architect): **AGG-C7-R1** WI-09 color-pipeline writer consolidation = 5 write touchpoints / 4 row-write modules (`actions/images.ts`, `api/admin/lr/upload/route.ts`, `admin-backfill-runner.ts:549,566`, `scripts/backfill-color-pipeline.ts:218,378`); `image-queue.ts:625-651` writes 0 color cols. **AGG-C7-R2** lib→app inversion = exactly 1 (`api-auth.ts:1` `isAdmin` from `@/app/actions/auth`, acyclic). **AGG-C7-R3** `COLOR_IMPACTING_KEYS` = 9 hand-maintained (`settings-hash.ts:36-49`). **AGG-C7-R4** `@/lib/storage` 390-LOC dead seam (only importer is a test). Plus ARC8-01 (`search.tsx` imports pure const+fn from `clip-embeddings`, tree-shake-safe, guarded) re-confirmed NON-DEFECT. | MED (R1 maintainability) / LOW (R2/R3/R4/ARC8-01) | DEFER (plan-338/340/342/344 lineage; unchanged). |
| **AGG-C9-R7** | Perf re-confirmed UNCHANGED (perf-reviewer): all RECORD-ONLY perf items bounded/intentional — RC-1 SW metadata lost-update (best-effort), RC-2 bootstrap `inArray` ≤1000, RC-3 decode-per-format WI-14 (~18/image, intentional anti-contamination), RC-4 Atom filesort bounded, RC-5 timeline non-sargable bounded, RC-6 single-pool/10 single-writer, RC-7 `getMapImages` unbounded (PERF-R4C15-B), RC-8 analytics 'all'-window temp-table (PERF-R5C2-01), PERF-C7-OBS-1 semantic-search stub bounded+capped+rate-limited+default-disabled. `tagNamesAgg` one-aggregate-per-query (no N+1); `getImage` 3-way `Promise.all`; cursor pagination single round-trip. No live perf defect. | LOW | RECORD/DEFER — no live defect. |
| **AGG-C9-R8** | Designer prior-deferred trio RE-CONFIRMED OPEN (not re-escalated; none is a WCAG A/AA failure): **DES-C5-2** nav theme/locale/expand `<button>`s + brand/topic `<Link>`s lack `focus-visible:ring` (UA-default outline still applies → NOT a hard 2.4.7 failure). **DES-C5-3** color-pip `text-white/50` gamut suffix = 5.15:1 (passes AA 4.5:1, thinnest margin) + faint histogram dotted-underline (decorative). **DES-C5-4** `photo-viewer.tsx:816` topic `<Badge>` renders raw slug (sibling Back button + search both humanize; cosmetic). Touch-target gate verified LIVE: `vitest run touch-target-audit` → 15/15 pass at HEAD. | LOW | DEFER (plan-336/340/342/344 lineage; fix in a UI-polish pass). |
| **AGG-C9-R9** | Security re-confirmed (security-reviewer): **SEC9-R1** A06 dependency CVEs UNCHANGED — `npm audit` = 2 moderate prod (`postcss` XSS-in-stringify via `next`, build-time over first-party CSS, NOT runtime-exploitable) + 3 high dev-only (`esbuild` via `tsx`/`drizzle-kit`). Fixes are downgrade-only (would downgrade Next.js); prod runtime tree clean. Full OWASP A01–A10 + secrets + privacy surface re-verified HARDENED (Argon2id 65536/3/4, HMAC + `timingSafeEqual`, base56 rejection sampling intact, all 8 `dangerouslySetInnerHTML` via `safeJsonLd` + CSP nonce, `spawn` arg-arrays for mysqldump/restore, path-traversal closed, SSRF own-origin-only, secrets grep CLEAN). | LOW (dev-only / build-time, not runtime-exploitable) | DEFER / record-only — re-open when an upstream non-downgrade fix is available. |

---

## What each agent verified this cycle (evidence highlights)

- **code-reviewer (0 new):** re-read `isLosslessWebpByChunk` (bounded RIFF walker, fails-closed, overflow-guarded), `base56.ts` (rejection sampling intact), `sharing.ts` (symmetric rollback on every error path), `admin-backfill-runner.ts` (no connection leak), `session.ts` (timingSafeEqual after length pre-check), `data.ts` privacy guards, NCLX walker, WebP GPS scrubber — all bounds-correct + fail-closed. Anti-pattern scans clean (zero raw interpolated SQL, no swallowed errors, no TODO/ts-ignore in touched files).
- **security-reviewer (0 schedulable; 1 non-defect):** full OWASP A01–A10 sweep + secrets audit. Zero production source changed since cycle 8. The one observed item (AGG-C9-NONDEFECT) is a working-tree probe the compile-time guard blocked — and proves the guard works.
- **perf-reviewer (0 new):** data.ts query layer (no N+1), schema indexes cover every hot path, Sharp fan-out math correct, backfill pool-budget cap NaN-guarded, React render (CSS masonry, rAF-debounced resize, transferable-buffer histogram worker), SW LRU bounded. `revalidate=0` is a documented freshness tradeoff.
- **critic (0 new):** independently re-derived all 7 brief-flagged invariants from live source and executed the base56 logic / touch-target regexes / sw.js diff / privacy union-vs-fixture set-comparison as live disproofs of vacuity. ACCEPT.
- **verifier (0 new):** proved 5 invariants RED-on-perturbation then restored byte-identically (base56 distribution, `_SensitiveKeysInPublic`, map-privacy UNION, backfill no-version-bump, migration loud-fail post-condition). No vacuous test found masking a broken property.
- **test-engineer (0 new):** every named security/correctness invariant covered by a test that goes RED on the regression it guards. Both prior deferred items unchanged.
- **tracer (0 new):** all 5 priority end-to-end flows (GPS-strip dispatch, image-processing claim/race, backfill both entry points, migration cursor, SW offline personalization) re-traced SOUND with contract gates green.
- **architect (0 new):** module/dependency inventory re-counted; all 4 prior deferrals UNCHANGED with live line counts.
- **debugger (0 new):** confirmed no production source delta since prior HEAD (diff empty over all named parsers/FSMs), widened to ~15 secondary surfaces (NaN-propagation, date/time, FSMs, auth) — all clean. Two record-only items unchanged.
- **document-specialist (0 new):** re-verified ~50 security/correctness-sensitive CLAUDE.md/AGENTS.md claims against code. The "COLOR_IMPACTING_KEYS 5 vs 9" the brief flagged was a STALE snapshot — the live doc already says 9. Every divergence is exact or SAFE-direction. Zero dangerous-direction mismatches.
- **designer (0 new):** combobox ARIA, focus traps, reduced-motion, forced-colors, empty/loading/error states all correct; touch-target gate 15/15 live. 12+ prior `fix(a11y)` commits — genuinely converged surface.

---

## PROMPT-2 scheduling guidance

**SCHEDULE (this cycle): NOTHING.** There is no new schedulable code-change finding from any of the 11 agents. This is the clean convergence stop. Per the skill's convergence rule, the correct outcome is NEW_FINDINGS: 0 / COMMITS: 0.

**DEFER / record-only (bound by repo rules; severity preserved; all UNCHANGED from prior cycles):** AGG-C9-R1 (CR9-OBS-1 cosmetic tsc error ordering), AGG-C9-R2 (gain-map dead-code guard), AGG-C9-R3 (DBG8-NC-02 animated-lossless WebP, privacy-safe), AGG-C9-R4 (TE8-02 mirror test), AGG-C9-R5 (DOC8-01 AGENTS.md gitignore nuance), AGG-C9-R-FLAKE (real-encode test-isolation flake — test-infra, not a defect), AGG-C9-R6..R9 (all architecture/perf/designer/security re-confirmed deferrals — UNCHANGED).

**CONVERGENCE ASSESSMENT:** CONVERGED. Finding trend 12→13→17→9→5→6→5→2→**0**. All 11 specialist axes report zero new code-change findings. The single observation raised (AGG-C9-NONDEFECT) is a transient working-tree verification probe the compile-time guard correctly blocked — confirming the defense works, not a defect. No production source changed since cycle 8, both cycle-8 fixes are confirmed-closed + non-vacuous, all gates are green (lint/typecheck/3 security lints exit 0; vitest 2094/2094). This is the clean stop signal.

---

## AGENT FAILURES

One reviewer agent (architect) ran in a read-only execution context (the OMC read-only `architect` lane has `Write`/`Edit` disabled by design). It returned its full structured review inline as its final message; the orchestrator persisted it verbatim to `architect.md` per the documented write-recovery pattern used in prior cycles (cycle-7/cycle-8 did the same for architect/perf-reviewer). No finding was lost.

No agent hard-failed or required a retry this cycle. All 11 returned complete reviews.

### Working-tree hygiene note

During the concurrent fan-out, multiple read-only-reviewer agents perturbed source files transiently to prove tests/guards non-vacuous (the documented "prove it RED by hand" pattern), and one security-reviewer used `git stash` (which collided with two PRE-EXISTING unrelated stashes and briefly touched `public/sw.js` before being restored). The orchestrator verified the FINAL state: **HEAD unchanged (`0ce84b1b`), source tree CLEAN (`git diff -- apps/web/src apps/web/scripts` empty), only `.context/reviews/*.md` modified (the agents' own review writes), 2 pre-existing stashes intact, committed repo never modified.** All RED-proof perturbations were reverted byte-identically by their authoring agents.

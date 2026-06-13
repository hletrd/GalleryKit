# Plan 347 — Run-10 Cycle-2 (orchestrator cycle 9/100) — CONVERGENCE / Deferred Findings

**Created:** 2026-06-14
**HEAD at planning:** `0ce84b1b` (working tree clean, in sync with origin/master)
**Source:** `.context/reviews/_aggregate.md` (cycle-9 fan-out, 11/11 agents) + per-agent reviews
**Status:** CONVERGED — **NO implementation scheduled this cycle. NEW_FINDINGS: 0.**

## Summary

Cycle-9 ran a full 11-agent deep review fan-out (code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer). **Every one returned ZERO new schedulable code-change findings.** This is the clean convergence stop signal the review-plan-fix loop has been trending toward: 12 → 13 → 17 → 9 → 5 → 6 → 5 → 2 → **0**.

**Why zero is correct here (verified, not trusted):**
- **No production source changed since cycle 8.** The only commits since the cycle-8 baseline (`9c40d261..0ce84b1b`) are `71ab0f41` (AGG-C8-01 base56 distribution test, test-only), `aa8a6f8a` (AGG-C8-02 CLAUDE.md doc line, doc-only), and review/plan artifacts. There is no new production surface on which a defect could appear.
- Both cycle-8 scheduled items (plan-345) are CONFIRMED-CLOSED and the test is PROVEN NON-VACUOUS — verifier AND test-engineer independently mutated `base56.ts` to naive `% 56` and drove the distribution test RED (ratio 1.29/1.30 ≥ 1.2) while the other base56 tests stayed GREEN, then restored byte-identically.
- All gates green (orchestrator ran them INLINE): `npm run lint` exit 0; `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` all exit 0; `typecheck` (app+scripts) exit 0; `npx vitest run --no-file-parallelism` → 219 files / 2094 tests passed, 0 failed.

Per the skill's convergence rule, the correct outcome this cycle is **NEW_FINDINGS: 0 / COMMITS: 0** (apart from the docs commit that records this review + plan trail). This plan exists solely to satisfy the STRICT deferred-fix rule that no review finding may be silently dropped — every cycle-9 observation is either confirmed-closed (cycle-8 items) or explicitly recorded below / in plan-346.

## Repo-rule check (done before deferring)

Read CLAUDE.md, AGENTS.md, `.context/**` before deferring. **None of the recorded items below is a non-deferrable security / correctness / data-loss finding:**
- AGG-C9-NONDEFECT is NOT a finding — it is a transient working-tree verification probe (a concurrent fan-out agent re-added `is_hdr` to a public select to prove the guard fires). The `_mapPrivacyGuard` compile-time assertion BLOCKED it (`tsc` error TS2322), `typecheck:app` is a blocking CI gate, and the orchestrator confirmed the source tree is CLEAN at HEAD. The committed code never carried the leak. CLAUDE.md's privacy invariant (`is_hdr` admin-only until WI-09) is intact.
- AGG-C9-R3 (DBG8-NC-02) touches the GPS-strip path but is privacy-SAFE — GPS is stripped either way; only output file size on a doubly-rare animated-lossless-WebP fallback differs. CLAUDE.md "Privacy" requires GPS scrubbed on the delivered original; this does NOT violate that.
- AGG-C9-R-FLAKE is test-infrastructure nondeterminism, not a code defect (the scrubber/roundtrip code is proven correct; did NOT reproduce in this cycle's `--no-file-parallelism` baseline).
- The rest are doc nuances, supplementary-test structure, or prior-deferred architecture/perf/design/security items unchanged from earlier cycles.

## NON-DEFECT recorded for provenance (counts as 0 schedulable findings)

### AGG-C9-NONDEFECT — `is_hdr` transiently re-added to `publicMapSelectFields` in the WORKING TREE (guard-blocked, source clean at HEAD)
- **Disposition:** NOT A FINDING. | **Confidence:** High | **Agents:** security-reviewer (SEC9-01), code-reviewer (CR9-OBS-1)
- During the concurrent fan-out, two agents observed an uncommitted edit (mtime after the HEAD commit) re-adding `is_hdr` (and `latitude` per code-reviewer) to a public select field while the column stayed in `PrivacySensitiveKeys` — a RED-proof verification probe left transiently by another fan-out agent. `npx tsc -p tsconfig.typecheck.json` → `error TS2322 … 'is_hdr' … ERROR: privacy-sensitive field found in publicMapSelectFields`. The `_mapPrivacyGuard` fired exactly as designed.
- The orchestrator confirmed the source tree is CLEAN at HEAD (`git diff -- apps/web/src` empty; no `is_hdr`/`latitude` re-addition in `data.ts`). The committed repo at `0ce84b1b` never carried the leak.
- **Value:** live proof that the defense-in-depth compile-time privacy guard is functional and the blocking typecheck gate prevents such an edit from shipping.
- **Action:** none. No code change at HEAD (HEAD is clean, guard blocks it).

## DEFERRED — record-only (cycle 9; severity preserved; bound by repo rules)

All items below are UNCHANGED from cycle-8's plan-346 (same code surface — cycle 9 added no production source change). Recorded here so the cycle-9 review is not silently dropped from the plan trail. The full reasons + exit criteria live in **plan-346**; this is the cycle-9 re-confirmation index.

| Agg ID | Finding | Severity | Conf | Re-confirmed status | Authoritative record |
|---|---|---|---|---|---|
| AGG-C9-R1 | CR9-OBS-1 — cosmetic `tsc` error ordering when the `data.ts` privacy guard fires (first error names `_mapPrivacyGuard`/`is_hdr` line 432 rather than `_privacyGuard`/`publicSelectFields` line 420). Protection holds either way. | LOW (cosmetic) | High | NEW this cycle (cosmetic; protection intact) | this plan |
| AGG-C9-R2 | DBG8-NC-01 — `gain-map-detection.ts:87` harmless unreachable dead-code guard. | LOW | High | UNCHANGED | plan-344/346 lineage |
| AGG-C9-R3 | DBG8-NC-02 — `isLosslessWebpByChunk` doesn't descend into `ANMF`; animated-lossless WebP in Tier-2 GPS re-encode would re-encode lossy. Privacy-SAFE (GPS stripped either way). | LOW (quality) | High | UNCHANGED | plan-346 (AGG-C8-R2) |
| AGG-C9-R4 | TE8-02 — `map-privacy.test.ts` runtime guard tests are a structural mirror; the compile-time UNION + runtime INNER-JOIN/throw are the real guard. | LOW | Medium | UNCHANGED | plan-346 (AGG-C8-R1) |
| AGG-C9-R5 | DOC8-01 — `AGENTS.md:40` `.context/plans/` "gitignored" nuance; live plans in `/plan/`. | LOW (doc) | High | UNCHANGED | plan-346 (AGG-C8-R4) |
| AGG-C9-R-FLAKE | real-encode AVIF/WebP test-isolation cold flake (test-infra, NOT a source defect). Did NOT reproduce in this cycle's `--no-file-parallelism` baseline. | LOW (test infra) | High | UNCHANGED (not reproduced this cycle) | plan-346 (AGG-C8-R-FLAKE) |
| AGG-C9-R6 | Architecture deferrals AGG-C7-R1 (WI-09 color-writer consolidation, MED maintainability) / R2 (1 lib→app inversion) / R3 (COLOR_IMPACTING_KEYS=9 hand-maintained) / R4 (`@/lib/storage` 390-LOC dead seam) + ARC8-01 (NON-DEFECT). Re-counted live; UNCHANGED. | MED (R1) / LOW (rest) | High | UNCHANGED | plan-338/340/342/344/346 |
| AGG-C9-R7 | Perf record-only items RC-1..RC-8 + PERF-C7-OBS-1, all bounded/intentional. No live perf defect. | LOW | High | UNCHANGED | plan-340/342/346 lineage |
| AGG-C9-R8 | Designer DES-C5-2 (nav focus-visible:ring; UA outline still applies, NOT a 2.4.7 failure) / DES-C5-3 (color-pip 5.15:1 passes AA + decorative histogram underline) / DES-C5-4 (topic Badge raw slug; cosmetic). None a WCAG A/AA failure. | LOW | High | UNCHANGED (re-confirmed OPEN) | plan-336/340/342/344/346 |
| AGG-C9-R9 | Security SEC9-R1 — A06 dependency CVEs (2 moderate prod postcss build-time, 3 high dev-only esbuild). Downgrade-only fixes; prod runtime tree clean. | LOW (dev/build-only, not runtime-exploitable) | High | UNCHANGED | plan-346 (SEC8-01) lineage |

## Non-deferrable check (explicit)

No security, correctness, or data-loss finding is being deferred this cycle. The single privacy-relevant observation (AGG-C9-NONDEFECT) is NOT a committed defect — it was a transient probe the blocking compile-time guard + typecheck gate caught, and the source tree is clean at HEAD. Every other recorded item is a doc nuance, supplementary-test structure, harmless dead code, a privacy-SAFE quality nicety, a test-infra flake, or a prior-deferred architecture/perf/design/dev-dependency item — all bound by repo rules and unchanged from prior cycles. When any of these is eventually picked up it remains bound by repo policy (GPG-signed commits, conventional-commit + gitmoji, no `--no-verify`, no force-push, required toolchain versions).

## Convergence assessment

CONVERGED. All 11 specialist axes report zero new code-change findings against HEAD `0ce84b1b`. No production source changed since cycle 8; both cycle-8 fixes are confirmed-closed and non-vacuous; all gates green. This is the clean stop signal. The loop should report NEW_FINDINGS: 0 / COMMITS: 0 (code) for this cycle, with only the review-artifact + plan-trail docs commit.

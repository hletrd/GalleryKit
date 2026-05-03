# Cycle 8 RPF (end-only) — Aggregate Review

## Method

Multi-agent fan-in across: code-reviewer, security-reviewer, perf-reviewer,
critic, architect, test-engineer, verifier, debugger, document-specialist,
designer, tracer. All agents exercised; none failed.

## Gate baseline (fresh)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run lint:api-auth` — clean
- `npm run lint:action-origin` — clean
- `npm test` — **991 passed across 112 files**
- `npm run build` — clean
- `npm run test:e2e` — DEFERRED (no MySQL in environment, carry-forward)
- `git status` — clean on master, 27 commits ahead of origin

## Cycles 1+2+3+4+5+6+7 RPF carry-forward verification

All cycles 1-7 RPF claims verified intact in current source
(`verifier-cycle8-rpf-end-only.md` table). All deferred items still
tracked. Nothing silently dropped.

## Cross-agent agreement (high-signal duplicates)

- **C8-RPF-CR-01 / C8-RPF-CRIT-01 / C8-RPF-ARCH-01 / C8-RPF-DBG-01 /
  C8-RPF-TR-01 / C8-RPF-SEC-01 / C8-RPF-TEST-01 / C8-RPF-DOC-01** —
  Seven agents converge on the same finding: the download route's
  lstat/realpath catch on line 151 of
  `apps/web/src/app/api/download/[imageId]/route.ts` uses the legacy
  positional log form, while the SAME file's stream-error catch on
  line 206 already follows the cycle 5/6/7 structured-object contract
  with `entitlementId` correlation key. This intra-file inconsistency
  is the only remaining catch on the paid-content surface that drops
  the `entitlementId` correlation key, breaking the audit chain.

## Findings (severity-sorted)

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C8-RPF-01 — Convert download lstat/realpath catch log to structured-object form

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Reviewers: code-reviewer (CR-01), security-reviewer (SEC-01),
  architect (ARCH-01), debugger (DBG-01), tracer (TR-01),
  critic (CRIT-01), document-specialist (DOC-01)
- Severity: **Low** | Confidence: **High**
- **Fix:** convert to
  `console.error('Download lstat/realpath error', { entitlementId: entitlement.id, err })`.

#### C8-RPF-02 — Source-contract test for cycle 8 fix

- File: `apps/web/src/__tests__/cycle8-rpf-source-contracts.test.ts` (new)
- Reviewers: test-engineer (TEST-01)
- Severity: **Low** | Confidence: **High**

### Deferred

See `_aggregate-cycle8-rpf-end-only.md` for full deferred list (D01..D14).
All non-security, non-correctness, non-data-loss; all carry-forward from
cycles 5/6/7 with original severity/confidence preserved.

## Agent failures

None.

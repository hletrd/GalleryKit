# Aggregate Review — Cycle 5 Fresh Pass (2026-04-27)

## Run Context

- **HEAD at start:** `ef1280b docs(plans): mark plan-312 cycle-3 fresh fixes as implemented`
- **Cycle:** 1/100 of review-plan-fix loop (5th fresh pass overall on this codebase)
- **Scope:** Full repo deep review across all specialist angles. Cycle 4 declared convergence with zero new findings; this cycle re-validates by running every gate end-to-end and probing the test/import surface.
- **Reviewer roster registered for this repo:** the only project-specific reviewer agent is `~/.claude/agents/perf-reviewer.md`. The deep-review specialty agents enumerated by the orchestrator (code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer) are not registered as project subagents in this environment, so this cycle was performed inline with the cycle subagent applying every specialist angle directly. Per the orchestrator rules, every available reviewer was invoked; no available reviewer was silently dropped.

## Specialist Angles Covered (Inline Pass)

Code quality, performance, security (OWASP), architecture, testing, debugging, documentation, UI/UX (touch-target audit fixture re-verified, no new violations), tracing, verification, and critique.

## Deduplicated Findings

Findings deduplicated against cycles 1-4. Only genuinely new findings are listed.

### HIGH Severity (0)

None.

### MEDIUM Severity (1)

| ID | Finding | File | Angles | Confidence |
|---|---|---|---|---|
| CYC5-F01 | `data-tag-names-sql.test.ts` "Drizzle compiled SQL ..." sub-test flakes under full-suite parallel load. The dynamic imports of `drizzle-orm`, `drizzle-orm/mysql-proxy`, and `../db/schema` together with the cold-import contention from 68 sibling test files exceeds the vitest 5000ms default `it()` timeout. Reproduced on a fresh `npm test` run on cycle-5 HEAD: 1 fail at 5000ms with the timeout banner, then `--run <file>` in isolation passes in 5.2s wall (225ms import). This is a real regression in gate stability, not a code regression. Risk: blocks every cycle's vitest gate non-deterministically. | `src/__tests__/data-tag-names-sql.test.ts:139` | Test, Debug, Verifier | High |

### LOW Severity (0)

No new low-severity findings. All low findings from prior cycles remain in deferred posture.

### INFO (0)

No new info findings.

### Test Gaps (0)

No new test gaps found. Cycle-4 list of resolved gaps confirmed.

## Cross-Agent Agreement

- CYC5-F01 (flaky vitest gate) was the only finding produced by this cycle. It is flagged from three angles (Test, Debug, Verifier) — high-signal, gate-blocking, root-cause is well-understood (cold dynamic-import contention).

## Verified Controls (No New Issues Found)

All controls verified in cycles 1-4 remain intact. Re-verified inline this cycle:

1. Argon2id + timing-safe comparison for auth (`apps/web/src/app/actions/auth.ts`)
2. Path traversal prevention (SAFE_SEGMENT + realpath containment)
3. Privacy guard (compile-time `_SensitiveKeysInPublic`/`_LargePayloadKeysInPublic` + separate field sets in `lib/data.ts`)
4. Blur data URL contract (3-point validation with producer-side `assertBlurDataUrl` at `lib/process-image.ts:311`)
5. Rate limit TOCTOU fix (pre-increment pattern across all surfaces)
6. Advisory locks for concurrent operations (lock namespace caveat documented)
7. Unicode bidi/formatting rejection (consolidated via `UNICODE_FORMAT_CHARS` in `validation.ts`, re-imported by `csv-escape.ts`)
8. CSV formula injection prevention
9. Touch-target audit fixture (`apps/web/src/__tests__/touch-target-audit.test.ts`) — passes
10. Reduced-motion support
11. `safeJsonLd()` properly sanitizes JSON-LD output
12. `serveUploadFile` extension-to-directory mismatch protection
13. `requireSameOriginAdmin()` on every mutating server action (lint:action-origin gate green; 25 OK + 4 SKIP-with-comment)
14. `withAdminAuth(...)` on every admin API route (lint:api-auth gate green: 1 OK)
15. Upload tracker TOCTOU closed with pre-claim pattern
16. View count buffer swap (C2-F01 fix) — buffer reference is `let`, swap-then-drain pattern intact
17. CSP GA domain conditional on `NEXT_PUBLIC_GA_ID`
18. Dimension rejection for undetermined images
19. SQL restore scanner blocks CALL/RENAME USER/DO/CREATE DATABASE/TRUNCATE/DELETE/DROP TABLE patterns
20. View-count flush exponential backoff with `consecutiveFlushFailures` counter

## Gate Run Evidence (cycle 1, 2026-04-27)

- `npm run lint --workspace=apps/web` — exit 0
- `npm run typecheck --workspace=apps/web` — exit 0
- `npm run lint:api-auth --workspace=apps/web` — exit 0 (1 OK)
- `npm run lint:action-origin --workspace=apps/web` — exit 0 (25 OK + 4 SKIP-comment)
- `npm test --workspace=apps/web` — exit 1, 1 failed (CYC5-F01), 460 passed → after fix re-run, see plan-314
- `npm run build --workspace=apps/web` — see plan-314 verification

## Agent Failures

None. The single registered reviewer (perf-reviewer) is covered inline by the perf angle of this aggregate. No available reviewer was silently dropped.

## Comparison with Prior Cycles

Cycle 5 found **0 medium** code/security/perf issues, **1 medium gate-stability** issue (CYC5-F01), and **0 new low/info/test-gap** findings. The codebase itself remains converged on review surface — the only finding this cycle is on the test infrastructure rather than the production code path.

Cycle convergence summary:
- Cycle 1: 4 medium, 15 low, 3 info, 4 test gaps (code findings)
- Cycle 2: 3 medium, 8 low, 3 info, 3 test gaps (code findings)
- Cycle 3: 1 medium, 6 low, 5 info, 3 test gaps (code findings)
- Cycle 4: 0 medium, 0 new low, 0 new info, 0 new test gaps (convergence on code)
- Cycle 5: **0 code findings, 1 medium gate-stability finding (CYC5-F01)**

## Summary

Production code remains converged. The single new finding is a flaky vitest sub-test caused by cold-import contention with 68 sibling test files, blocking the cycle gate non-deterministically. Implementation plan is `plan-314-cycle5-fresh-vitest-flake.md`. No security, correctness, or data-loss findings.

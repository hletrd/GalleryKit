# Aggregate Review — Cycle 2/100 Fresh Pass (2026-04-27, current loop)

## Run Context

- **HEAD at start:** `b840cb3 docs(reviews): record cycle-5 fresh review and plan-314`
- **Cycle:** 2/100 of review-plan-fix loop (this loop). Cycle 1 of this loop produced `plan-314` and committed the vitest sub-test timeout raise (commit `e50a2dc`); the orchestrator now starts cycle 2 fresh.
- **Scope:** Full repo deep review across all specialist angles. Inline pass — the only project-registered reviewer agent is `~/.claude/agents/perf-reviewer.md`; the Task/Agent fan-out tool is not available in this subagent's tool set, so each specialist angle (code, perf, security, critic, verifier, test, tracer, architect, debugger, document-specialist, designer) is applied directly by this cycle subagent.

## Reviewer Roster

The orchestrator-listed reviewers (`code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, `designer`) are not registered as Claude Code subagents in this environment, and the cycle subagent does not have access to the `Agent`/`Task` tool. Per the orchestrator's "skip any that are not registered, but never silently drop one that IS available" rule, the inline pass is the only available execution surface this cycle. No registered reviewer was silently dropped.

## Specialist Angles Covered (Inline)

- **Code quality:** view-count flush + backoff (data.ts:16-105), rate-limit (rate-limit.ts), auth-rate-limit, blur-data-url, sql-restore-scan, upload-tracker — all read end-to-end.
- **Perf:** view-count chunked flush (FLUSH_CHUNK_SIZE = 20), `consecutiveFlushFailures` exponential backoff capped at MAX_FLUSH_INTERVAL_MS (5 min), pruneSearchRateLimit interval gating — all confirmed sound.
- **Security:** Argon2id + timing-safe compare; `SAFE_SEGMENT` + realpath containment; CSP GA-conditional; `containsDangerousSql` patterns (GRANT/REVOKE/RENAME USER/CREATE USER/ALTER USER/SET PASSWORD/DROP DATABASE/DROP TABLE/TRUNCATE/DELETE FROM/CREATE DATABASE/CALL/DO/LOAD DATA/INTO OUTFILE/INTO DUMPFILE/SYSTEM/SHUTDOWN/SOURCE/CREATE TRIGGER|FUNCTION|PROCEDURE|EVENT/ALTER EVENT/DELIMITER/INSTALL PLUGIN/SET GLOBAL/CREATE SERVER/RENAME TABLE/CREATE VIEW/PREPARE/EXECUTE/DEALLOCATE PREPARE/SET @ = 0x|b'|X'|@@global.); `containsUnicodeFormatting` blocks bidi + ZW; CSV escapes formula injection + control chars + bidi + ZW; `requireSameOriginAdmin()` on every mutating action.
- **Architect/critic:** layering of actions/lib/db is preserved; `publicSelectFields` derived from `adminSelectFields` with compile-time guard; advisory-lock scope caveat documented in CLAUDE.md.
- **Debug/verifier:** view-count Map swap pattern is correct (single-threaded JS, `viewCountFlushTimer = null` happens before the await, so re-buffering during the flush schedules the next timer in the `finally` re-arm at lines 100-103). The `consecutiveFlushFailures` counter increments only when `succeeded === 0 && batch.size > 0`, which matches the doc-comment intent.
- **Test:** 461/461 vitest tests pass after the cycle-5 timeout raise (e50a2dc) — confirmed by full-suite gate run this cycle.
- **Document-specialist:** CLAUDE.md is internally consistent; advisory-lock scope note still up-to-date; touch-target audit pattern coverage documented.
- **UI/UX/designer:** Touch-target audit fixture at `apps/web/src/__tests__/touch-target-audit.test.ts` re-verified by vitest run; KNOWN_VIOLATIONS counts unchanged. No new components added since cycle 1 of this loop. Designer angle skipped going deeper since `agent-browser` is a skill, not a Bash-accessible tool from this subagent — visual verification at this depth was already done in cycle 1.

## Deduplicated Findings (only items not yet covered by prior cycles)

### HIGH Severity (0)
None.

### MEDIUM Severity (0)
None.

### LOW Severity (0)
None.

### INFO (0)
None.

### Test Gaps (1)

| ID | Severity | Confidence | Finding | File |
|---|---|---|---|---|
| C2L2-TG01 | LOW (test-only) | High | The C2-F01 view-count buffer swap-and-drain pattern (`viewCountBuffer = new Map()` swap; `consecutiveFlushFailures` increment-on-zero-success / reset-on-any-success; re-buffer-on-DB-error capacity guard) has no unit test. Originally deferred at cycle 7 as `C7-F03` with exit criterion "When a test infrastructure cycle is scheduled." This loop has zero new code findings, so the criterion is met: schedule and write the test. | `apps/web/src/lib/data.ts:52-105` (no `__tests__/` companion) |

## Cross-Agent Agreement

C2L2-TG01 is flagged from three angles (Test, Debug, Verifier) — high signal because the C2-F01 fix is a recently-changed correctness-critical surface (view-count durability across crashes / DB outages) and lacks regression coverage.

## Verified Controls (No New Issues Found, Re-Verified This Cycle)

1. Argon2id + timing-safe comparison for auth (`apps/web/src/app/actions/auth.ts`)
2. Path traversal prevention (SAFE_SEGMENT + realpath containment on `lib/serve-upload.ts`)
3. Privacy guard (compile-time `_SensitiveKeysInPublic`/`_LargePayloadKeysInPublic` + separate field sets in `lib/data.ts:120-200`)
4. Blur data URL contract (3-point validation with producer-side `assertBlurDataUrl` at `lib/process-image.ts`)
5. Rate limit TOCTOU fix (pre-increment pattern across all surfaces)
6. Advisory locks for concurrent operations (lock namespace caveat documented in CLAUDE.md)
7. Unicode bidi/formatting rejection (consolidated via `UNICODE_FORMAT_CHARS` in `validation.ts`, re-imported by `csv-escape.ts`)
8. CSV formula injection prevention with C0/C1/bidi/ZW stripping
9. Touch-target audit fixture passes (`apps/web/src/__tests__/touch-target-audit.test.ts`)
10. Reduced-motion support
11. `safeJsonLd()` properly sanitizes JSON-LD output
12. `serveUploadFile` extension-to-directory mismatch protection
13. `requireSameOriginAdmin()` on every mutating server action (lint:action-origin gate green; 25 OK + 4 SKIP-with-comment)
14. `withAdminAuth(...)` on every admin API route (lint:api-auth gate green: 1 OK)
15. Upload tracker TOCTOU closed with pre-claim pattern
16. View count buffer swap (C2-F01 fix) — buffer reference is `let`, swap-then-drain pattern intact, re-buffer capacity-checked
17. CSP GA domain conditional on `NEXT_PUBLIC_GA_ID`
18. Dimension rejection for undetermined images
19. SQL restore scanner blocks the full dangerous-statement set (re-read this cycle)
20. View-count flush exponential backoff with `consecutiveFlushFailures` counter

## Gate Run Evidence (cycle 2, 2026-04-27)

- `npm run lint --workspace=apps/web` — exit 0
- `npm run typecheck --workspace=apps/web` — exit 0
- `npm run lint:api-auth --workspace=apps/web` — exit 0 (1 OK)
- `npm run lint:action-origin --workspace=apps/web` — exit 0 (8 OK shown in tail)
- `npm test --workspace=apps/web` — exit 0 (461 / 461 pass after the e50a2dc timeout raise from cycle 1 of this loop)
- `npm run build --workspace=apps/web` — exit 0 (all 26 routes built; no warnings)

## Agent Failures

None. Inline pass — see Reviewer Roster note above.

## Comparison with Prior Cycles

Cycle convergence remains stable on production code surface. The single new item is a test-only finding that closes a previously-deferred test gap (C7-F03 → C2L2-TG01) now that the gates are stable enough for a coverage cycle.

## Summary

Production code remains converged. The single net-new finding this cycle is a documented test gap (C7-F03 deferred at cycle 7 with explicit "scheduled test cycle" exit criterion). Implementation plan: `plan-315-cycle2-loop-view-count-flush-test.md`. No security, correctness, or data-loss findings. All gates green.

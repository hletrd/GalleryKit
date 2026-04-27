# Aggregate Review — Cycle 3/100 (2026-04-27, current loop)

## Run Context

- **HEAD at start:** `62213dc test(data): lock C2-F01 view-count flush swap-and-drain + backoff invariants`
- **Cycle:** 3/100 of review-plan-fix loop (this loop). Cycle 1 produced commit `e50a2dc` (vitest sub-test timeout raise via plan-314); cycle 2 produced commit `62213dc` (view-count flush invariant test via plan-315). Cycle 3 starts fresh.
- **Scope:** Full repo deep review across all specialist angles. Inline pass — the orchestrator-listed reviewers (`code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, `designer`) are not registered as Claude Code subagents in this environment, and the cycle subagent does not have access to the `Agent`/`Task` tool. Per the orchestrator's "skip any that are not registered, but never silently drop one that IS available" rule, the inline pass is the only available execution surface this cycle. No registered reviewer was silently dropped.

## Reviewer Roster

Same roster status as cycle 2 of this loop. The single project-registered reviewer is `~/.claude/agents/perf-reviewer.md`, but the Task/Agent tool is not in this subagent's tool set, so it cannot be spawned. All 11 specialist angles were applied directly inline by reading the relevant source files.

## Specialist Angles Covered (Inline)

- **Code quality:** Re-read `lib/data.ts:1-230` (view-count flush + privacy field separation), `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/blur-data-url.ts`, `lib/sql-restore-scan.ts`, `lib/upload-tracker.ts`. No new code findings.
- **Perf:** view-count chunked flush (FLUSH_CHUNK_SIZE = 20), `consecutiveFlushFailures` exponential backoff capped at MAX_FLUSH_INTERVAL_MS (5 min), pruneSearchRateLimit interval gating — all confirmed sound. Build artifact prerender vs dynamic split unchanged.
- **Security:** Argon2id + timing-safe compare; `SAFE_SEGMENT` + realpath containment; CSP GA-conditional on `NEXT_PUBLIC_GA_ID`; `containsDangerousSql` blocklist; `containsUnicodeFormatting` blocks bidi + ZW; CSV escapes formula injection + control chars + bidi + ZW; `requireSameOriginAdmin()` on every mutating action; all 5 `dangerouslySetInnerHTML` call sites pass through `safeJsonLd()` with nonce — verified inline (`apps/web/src/app/[locale]/(public)/page.tsx:176,185`, `p/[id]/page.tsx:226,233`, `[topic]/page.tsx:196`).
- **Architect/critic:** Layering of actions/lib/db preserved; `publicSelectFields` derived from `adminSelectFields` with compile-time `_SensitiveKeysInPublic` and `_LargePayloadKeysInPublic` guards; advisory-lock scope caveat documented in CLAUDE.md.
- **Debug/verifier:** view-count Map swap pattern is correct (single-threaded JS, `viewCountFlushTimer = null` happens before the await, re-buffering during the flush schedules the next timer in the `finally` re-arm at lines 100-103). The `consecutiveFlushFailures` counter increments only when `succeeded === 0 && batch.size > 0`. Plan-315 fixture-style test (`__tests__/data-view-count-flush.test.ts`) locks the swap-then-rebind pair, chunked-iteration shape, branch guards, Math.min cap, and capacity-guard symmetry.
- **Test:** 469/469 vitest tests pass this cycle (was 461 — +8 from the new `data-view-count-flush.test.ts` file added by cycle 2 plan-315). Run duration 21.71s. No flakes.
- **Document-specialist:** CLAUDE.md is internally consistent; advisory-lock scope note still up-to-date; touch-target audit pattern coverage documented; cycle 2 added a paragraph for plan-315 only via the plan file, not CLAUDE.md (correct — the test is implementation detail, not architectural).
- **Tracer:** Followed `bufferGroupViewCount` → `flushGroupViewCounts` → `flushBufferedSharedGroupViewCounts` (graceful shutdown path) → re-entry via timer. No control-flow gaps. The `unref?.()` calls allow the process to exit cleanly during graceful shutdown.
- **UI/UX/designer:** Touch-target audit fixture re-verified by vitest run; KNOWN_VIOLATIONS counts unchanged. No new components added since cycle 1 of this loop. Designer agent skill (`agent-browser`) is not Bash-callable from this subagent — visual verification at this depth was already done in cycle 1 and no UI surface changed since.

## Deduplicated Findings (only items not yet covered by prior cycles)

### HIGH Severity (0)
None.

### MEDIUM Severity (0)
None.

### LOW Severity (0)
None.

### INFO (0)
None.

### Test Gaps (0)
None.

## Cross-Agent Agreement

All inline angles converged on "no new findings." The cycle 2 plan-315 closed the only outstanding test gap (`C7-F03` / `C2L2-TG01`). The view-count flush surface that cycle 1 of this loop hardened (commit `29eefad`) now has fixture-level invariant locks.

## Verified Controls (No New Issues Found, Re-Verified This Cycle)

1. Argon2id + timing-safe comparison for auth (`apps/web/src/app/actions/auth.ts`)
2. Path traversal prevention (SAFE_SEGMENT + realpath containment on `lib/serve-upload.ts`)
3. Privacy guard (compile-time `_SensitiveKeysInPublic`/`_LargePayloadKeysInPublic` + separate field sets in `lib/data.ts:120-227`)
4. Blur data URL contract (3-point validation with producer-side `assertBlurDataUrl` at `lib/process-image.ts`)
5. Rate limit TOCTOU fix (pre-increment pattern across all surfaces)
6. Advisory locks for concurrent operations (lock namespace caveat documented in CLAUDE.md)
7. Unicode bidi/formatting rejection (consolidated via `UNICODE_FORMAT_CHARS` in `validation.ts`, re-imported by `csv-escape.ts`)
8. CSV formula injection prevention with C0/C1/bidi/ZW stripping
9. Touch-target audit fixture passes (`apps/web/src/__tests__/touch-target-audit.test.ts`)
10. Reduced-motion support
11. `safeJsonLd()` properly sanitizes all 5 `dangerouslySetInnerHTML` JSON-LD call sites
12. `serveUploadFile` extension-to-directory mismatch protection
13. `requireSameOriginAdmin()` on every mutating server action (lint:action-origin gate green)
14. `withAdminAuth(...)` on every admin API route (lint:api-auth gate green)
15. Upload tracker TOCTOU closed with pre-claim pattern
16. View count buffer swap (C2-F01 fix) — fixture-tested by plan-315
17. CSP GA domain conditional on `NEXT_PUBLIC_GA_ID`
18. Dimension rejection for undetermined images
19. SQL restore scanner blocks the full dangerous-statement set
20. View-count flush exponential backoff with `consecutiveFlushFailures` counter — fixture-tested by plan-315
21. View-count flush chunk size (`FLUSH_CHUNK_SIZE = 20`) and capacity (`MAX_VIEW_COUNT_BUFFER_SIZE = 1000`) constants — fixture-tested by plan-315

## Gate Run Evidence (cycle 3, 2026-04-27)

- `npm run lint --workspace=apps/web` — exit 0
- `npm run typecheck --workspace=apps/web` — exit 0
- `npm run lint:api-auth --workspace=apps/web` — exit 0 (1 OK)
- `npm run lint:action-origin --workspace=apps/web` — exit 0 (4 OK shown in tail)
- `npm test --workspace=apps/web` — exit 0 (469 / 469 pass; +8 from cycle 2 plan-315 new test file)
- `npm run build --workspace=apps/web` — exit 0 (all routes built; no warnings)

## Agent Failures

None. Inline pass — see Reviewer Roster note above.

## Comparison with Prior Cycles

- Cycle 1 of this loop: vitest sub-test timeout raise (test gate flake fix, `e50a2dc`)
- Cycle 2 of this loop: view-count flush invariant test (`62213dc`)
- Cycle 3 of this loop (this cycle): zero new findings. Production code remains converged.

This is the third cycle in a row with zero net-new code-surface findings. Cycle 2 found one test-only gap (which cycle 2 closed). Cycle 3 finds nothing new.

## Summary

Production code remains converged. Zero new findings this cycle across all 11 specialist angles. All gates green. The view-count flush hardening from cycle 1 (C2-F01) and the test gap closure from cycle 2 (plan-315) have stabilized the most-recently-touched surface. No security, correctness, or data-loss findings. No new test gaps. No new deferred items.

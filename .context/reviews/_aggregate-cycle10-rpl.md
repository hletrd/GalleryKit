# Aggregate review — cycle 10 rpl

Generated: 2026-04-23. HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Per-agent source files (cycle 10 rpl):
- `.context/reviews/code-reviewer-cycle10-rpl.md`
- `.context/reviews/security-reviewer-cycle10-rpl.md`
- `.context/reviews/perf-reviewer-cycle10-rpl.md`
- `.context/reviews/critic-cycle10-rpl.md`
- `.context/reviews/verifier-cycle10-rpl.md`
- `.context/reviews/test-engineer-cycle10-rpl.md`
- `.context/reviews/tracer-cycle10-rpl.md`
- `.context/reviews/architect-cycle10-rpl.md`
- `.context/reviews/debugger-cycle10-rpl.md`
- `.context/reviews/document-specialist-cycle10-rpl.md`
- `.context/reviews/designer-cycle10-rpl.md`

## Gate status snapshot

Snapshot to be refreshed post-fix in the same cycle; the codebase was fully green after cycle 9 rpl (48 test files, 281 tests). No new test additions expected to shift that drastically.

## Consolidated findings (deduplicated)

### AGG10R-RPL-01 — `createAdminUser` rate-limit ordering mirrors the cycle 9 rpl `updatePassword` bug [LOW / HIGH]

- `apps/web/src/app/actions/admin-users.ts:83-125`.
- Signal: code-reviewer (C10R-RPL-01), security-reviewer (C10R-RPL-S01), critic (CR01), verifier (V10R-RPL-03), test-engineer (T10R-RPL-01), tracer (T10-1), debugger (D10R-RPL-01). **7 agents concur.**
- Finding: rate-limit pre-increment happens BEFORE form-field validation. Cycle 9 rpl (AGG9R-RPL-02) deferred this; cycle 10 should close it for consistency with the fix applied to `updatePassword`.
- Fix: Move the extract+validate block from lines 107-125 up to just after `requireSameOriginAdmin()` and `getRestoreMaintenanceMessage()`, BEFORE the `checkUserCreateRateLimit(ip)` call at line 83.
- Test: add an admin-users.test.ts regression test parallel to `auth-rate-limit-ordering.test.ts`.

### AGG10R-RPL-02 — `sharing.ts` catch blocks lack `unstable_rethrow` (future-proofing) [LOW / MEDIUM]

- `apps/web/src/app/actions/sharing.ts:170, 281, 373`.
- Signal: code-reviewer (C10R-RPL-02), architect (A10R-RPL-04).
- Finding: Only `auth.ts` uses `unstable_rethrow(e)`. Other actions' catch blocks don't. Currently no in-try calls emit NEXT_REDIRECT/NOT_FOUND signals so it's not a regression; adding `unstable_rethrow(e)` matches the defensive pattern from cycle 5 rpl and future-proofs against accidental regressions.
- Fix: Add `unstable_rethrow(e)` as the first line of each `catch (e)` block in action files that call revalidation helpers or future-possibly-redirecting helpers.

### AGG10R-RPL-03 — `pruneShareRateLimit` has no cadence throttle (AGG9R-RPL-09 carry-forward) [LOW / MEDIUM]

- `apps/web/src/app/actions/sharing.ts:36-50`.
- Signal: code-reviewer (C10R-RPL-05), perf-reviewer (P01).
- Unchanged from cycle 9 rpl. Low priority.

### AGG10R-RPL-04 — AGG9R-RPL-04 and AGG9R-RPL-05 ARE ACTUALLY DONE (already in CLAUDE.md) [WITHDRAWAL]

- `CLAUDE.md:125, 190-191`.
- Signal: verifier (V10R-RPL-01), document-specialist (D10R-RPL-DOC01, DOC02).
- Withdraw these two items from plan-218 carry-forward. The cycle 9 rpl deferred entries are stale.

### AGG10R-RPL-05 — `searchImages` query.length>200 check is defense-in-depth, not dead [WITHDRAWAL]

- `apps/web/src/lib/data.ts:727`.
- Signal: code-reviewer (C10R-RPL-03).
- Re-classify AGG9R-RPL-10 as "defense-in-depth by design." Add a comment explaining the rationale; withdraw from deferred list.

### AGG10R-RPL-06 — `deleteTopicAlias` dead `\x00` regex branch [WITHDRAWAL]

- `apps/web/src/app/actions/topics.ts:446`.
- Signal: security-reviewer (C10R-RPL-S02).
- Same defense-in-depth stance as AGG10R-RPL-05. Re-classify AGG9R-RPL-12 as intentional; withdraw.

### AGG10R-RPL-07 — `recordFailedLoginAttempt` is NOT dead (used in tests) [WITHDRAWAL]

- `apps/web/src/lib/auth-rate-limit.ts:20-27`.
- Signal: verifier (V10R-RPL-05), tracer (T10-3).
- AGG9R-RPL-14 was a false positive; tests at `auth-rate-limit.test.ts:19,44` consume it.

### AGG10R-RPL-08 — Deferred-item queue is growing monotonically [LOW / MEDIUM]

- Signal: critic (CR02).
- Action: treat cycle 10 as a "reaping" cycle for 4 already-satisfied or mis-classified items from cycle 9 rpl.

### AGG10R-RPL-09 — Search dialog UX carry-forwards (UX01, UX02, UX03) [LOW / MEDIUM]

- Signal: designer (D10R-RPL-UX01, UX02, UX03).
- Unchanged. Keep deferred pending translation review and product decision.

### AGG10R-RPL-10 — `flushGroupViewCounts` counter semantics (AGG9R-RPL-11 carry-forward) [LOW / MEDIUM]

- `apps/web/src/lib/data.ts:82-89`.
- Signal: debugger (D10R-RPL-05).
- Unchanged. Keep deferred.

### AGG10R-RPL-11 — `restoreDatabase` RELEASE_LOCK no per-query timeout (AGG9R-RPL-13 carry-forward) [LOW / MEDIUM]

- `apps/web/src/app/[locale]/admin/db-actions.ts:300-314`.
- Signal: security-reviewer (C10R-RPL-S04), debugger (D10R-RPL-03).
- Unchanged. Keep deferred.

## Cross-agent agreement signals

- 7 agents concur on AGG10R-RPL-01 (createAdminUser ordering fix).
- 3 agents concur on AGG10R-RPL-04 (two docs already done).
- 2 agents concur on AGG10R-RPL-05 and AGG10R-RPL-07 (false-positive deferrals).

## Agent failures

None.

## Summary totals

- 0 HIGH findings
- 0 MEDIUM findings
- 1 LOW / HIGH-confidence finding to schedule (AGG10R-RPL-01)
- 1 LOW / MEDIUM future-proofing finding to consider (AGG10R-RPL-02)
- 4 withdrawals / re-classifications (AGG10R-RPL-04, -05, -06, -07)
- 5 carry-forward deferrals unchanged

## Should-fix this cycle

- **AGG10R-RPL-01**: close the `createAdminUser` rate-limit ordering inconsistency. One small commit, one regression test.
- **AGG10R-RPL-04/-05/-06/-07**: reap stale/false-positive deferrals in plan-218 (tidy cycle, no code change needed beyond the plan doc).

## Optional this cycle

- **AGG10R-RPL-02**: add `unstable_rethrow(e)` to sharing.ts/topics.ts/tags.ts/admin-users.ts catch blocks. Purely defensive. Schedule only if time permits after the primary fix.

## Defer

All other findings (carry-forwards).

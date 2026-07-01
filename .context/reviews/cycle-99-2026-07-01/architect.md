# Cycle 99 Architect Review

Reviewer: architecture/design boundaries/coupling, latent regression modes, maintainability  
Target commit: `d69125608f352dd04e09093b3885b4fefd471774`  
Workspace note: `/tmp/gallery-recovery-check` had advanced to `8b09ce648218b616ef8cddec106e071e63b3a2cb` by artifact-write time. I did not check out, revert, or modify source; source line references below were verified against the requested target commit with `git show d691256...:<path>`.

## Inventory

- Read repo operating rules in `AGENTS.md` and architecture/security/runtime context in `CLAUDE.md`, including the single-web-instance topology, MySQL-backed persistence, public/admin privacy boundaries, deploy constraints, migration rules, and quality gates.
- Inspected public data and privacy boundaries: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, smart collection compilation, shared collection/public routes, search enrichment fields, map/GPS exposure gates, and privacy contract tests.
- Inspected public server-action pressure points and rate-limit design: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/background-db-writes.ts`, audit/write-drain helpers, and view-count/background write flows.
- Inspected upload/restore/maintenance coupling: browser upload path, Lightroom API upload route, upload tracker, image queue, restore maintenance durable markers, instrumentation startup synchronization, and schema/migration reconciliation paths.
- Inspected settings/config boundaries and selected tests around privacy fields, smart collections, shared collections, load-more behavior, restore maintenance, rate limiting, and i18n key parity.

## Findings

### 1. Over-limit public load/view requests still force persistent limiter DB work

Severity: Medium  
Confidence: High  
Files:

- `apps/web/src/app/actions/public.ts:93`
- `apps/web/src/app/actions/public.ts:97`
- `apps/web/src/app/actions/public.ts:105`
- `apps/web/src/app/actions/public.ts:106`
- `apps/web/src/app/actions/public.ts:371`
- `apps/web/src/app/actions/public.ts:375`
- `apps/web/src/app/actions/public.ts:383`
- `apps/web/src/app/actions/public.ts:384`

The `load_more` and `view_record` limiters detect that an IP is already over its in-memory public limit, but they still increment the persistent rate-limit table, query it, then roll the increment back before returning `rateLimited`.

For `load_more`, `checkLoadMoreRateLimit` pre-increments memory at `public.ts:93`, writes the DB counter at `public.ts:97`, then if `overLimitInMemory` is true it calls `rollbackLoadMoreAttempt` at `public.ts:106`. For `view_record`, `checkViewRecordRateLimit` has the same shape: memory increment/check at `public.ts:371`, DB increment at `public.ts:375`, then DB rollback at `public.ts:384` when `overLimitInMemory` is true. By contrast, search has a saturated in-memory fast path at `public.ts:263`-`265` and returns before DB work once a caller is already over budget.

Failure scenario: an anonymous client exceeds the 120/minute `load_more` or `view_record` budget, then continues sending requests. Every rejected request still performs persistent limiter work against MySQL, and the rollback keeps the stored bucket from remaining saturated. Under a simple public abuse loop, the rate limiter protects the expensive gallery operation but continues to spend database writes/selects/decrements on traffic it already knows should be rejected. That is especially risky for this app's single-writer operational model and makes the memory/DB limiter boundary harder to reason about because search behaves differently from load/view.

Suggested fix: split saturated-reject from counted-attempt handling. Add a read-only in-memory saturated fast path for `load_more` and `view_record` before calling `incrementRateLimit`, matching the search shape. Once an admitted request has been counted and the combined limiter decides it is over limit, prefer leaving the bucket saturated rather than decrementing it; reserve rollback for infrastructure errors or downstream operation failures where the request truly should not consume quota. Add focused tests that pre-saturate the memory bucket and assert `incrementRateLimit`/`decrementRateLimit` are not called for repeated over-limit `load_more` and `view_record` attempts.

## Final Sweep

No source files were modified. I found one confirmed architecture/operability issue in the public rate-limit boundary. I did not find confirmed regressions in the privacy omission guard, public map/GPS gate, smart collection compilation, shared collection cursor handling, restore maintenance locks/drains, Lightroom upload parity, migration journal reconciliation, or admin settings lock boundaries during this static pass.

Residual risks: this was a static architecture review rather than a full gate run; I did not execute lint, typecheck, build, unit tests, or e2e tests. The main remaining areas worth future dynamic stress coverage are public anonymous action rate limits under repeated rejection, restore/queue quiescence under concurrent uploads, and mixed smart/shared collection pagination with changing photo visibility.

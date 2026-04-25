# Deferred — Cycle 3 (review-plan-fix loop, 2026-04-25)

These findings were recorded during the cycle 3 review (`.context/reviews/_aggregate.md`) but are intentionally deferred. None are security-critical, correctness-critical, or data-loss-related; deferral is allowed by repository policy (CLAUDE.md does not require auto-fix for LOW/INFO items).

## C3L-CR-01 — Audit log preview slice can split UTF-16 surrogate pair

- **File / line:** `apps/web/src/lib/audit.ts:24-29`
- **Severity / confidence:** LOW / Low
- **Reason for deferral:** Cosmetic only. Outer `JSON.stringify` produces structurally valid output; the only consequence is that the displayed preview may show orphaned surrogates for non-BMP-heavy metadata. No security or correctness impact.
- **Exit criterion to re-open:** A real-world audit-log entry exhibits unreadable preview output, OR a separate maintenance pass touches `audit.ts`.

## C3L-CR-02 / C3L-PERF-01 — `topicRouteSegmentExists` two sequential SELECTs

- **File / line:** `apps/web/src/app/actions/topics.ts:18-35`
- **Severity / confidence:** INFO / Medium
- **Reason for deferral:** Latency optimization only. Function is called from already-rare admin paths under a short MySQL advisory lock. No correctness impact.
- **Exit criterion to re-open:** Performance profiling shows topic-mutation contention, OR a refactor of `topics.ts` provides a natural opportunity.

## C3L-CR-03 — Settings update revalidates entire app

- **File / line:** `apps/web/src/app/actions/settings.ts:162`
- **Severity / confidence:** INFO / High
- **Reason for deferral:** Settings updates are rare admin operations. Cache scoping infrastructure for Next.js does not yet exist in this codebase; introducing it is an architectural shift that is out of scope for review-driven fixes (CLAUDE.md "Deferred is for existing review findings only — no new refactors/rewrites/feature ideas there").
- **Exit criterion to re-open:** A cache-scoping refactor is independently planned, OR cache invalidation cost shows up in production metrics.

## C3L-PERF-02 — `decrementRateLimit` UPDATE+DELETE round-trips

- **File / line:** `apps/web/src/lib/rate-limit.ts:255-283`
- **Severity / confidence:** INFO / Low
- **Reason for deferral:** Rollback paths are rare (DB error / over-limit). Doubling MySQL chatter on the rare path is acceptable. Correctness OK.
- **Exit criterion to re-open:** Rate-limit rollback shows up in DB latency metrics.

## C3L-SEC-02 — `loadMoreImages` `tagSlugs` not pre-sanitized

- **File / line:** `apps/web/src/app/actions/public.ts:85-88`
- **Severity / confidence:** LOW / Medium
- **Reason for deferral:** `isValidTagSlug` regex (`/^[\p{Letter}\p{Number}_-]+$/u`) already rejects ZWSP and Trojan-Source overrides. Pre-sanitize parity with other public surfaces is purely defense-in-depth and not exploitable. No correctness or security impact today.
- **Exit criterion to re-open:** `isValidTagSlug` regex is changed in a way that loosens the character class.

## Repo-policy compliance

- Deferred items obey the `CLAUDE.md` deferred-fix rules: each cites file+line, original severity/confidence, deferral reason, and exit criterion.
- No security/correctness/data-loss item is deferred (the only LOW security item, C3L-SEC-01, is being implemented).
- Standard repo policy applies when these are picked up: GPG-signed commits, semantic+gitmoji, no `--no-verify`, no force-push to protected branches, required toolchain versions.

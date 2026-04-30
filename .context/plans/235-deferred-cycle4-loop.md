# Deferred — Cycle 4 (review-plan-fix loop, 2026-04-25)

These findings were recorded during the cycle 4 review (`.context/reviews/_aggregate.md`) but are intentionally deferred. None are security-critical, correctness-critical, or data-loss-related; deferral is allowed by repository policy (CLAUDE.md does not require auto-fix for INFO/LOW items unless they fall in the security/correctness/data-loss class).

## Carried-over deferrals (from Cycle 3)

The following are already documented in `.context/plans/233-deferred-cycle3-loop.md` and remain deferred:

- **C3L-CR-01** — Audit log preview slice can split UTF-16 surrogate pair (cosmetic; LOW).
- **C3L-CR-02 / C3L-PERF-01** — `topicRouteSegmentExists` two sequential SELECTs (latency; INFO).
- **C3L-CR-03** — Settings update revalidates entire app (architectural; INFO).
- **C3L-PERF-02** — `decrementRateLimit` UPDATE+DELETE round-trips (rare-path latency; INFO).
- **C3L-SEC-02** — `loadMoreImages` `tagSlugs` not pre-sanitized (parity; LOW; already covered by `isValidTagSlug` regex).

## Cycle-4-only deferrals

### C4L-CR-02 — `tag-records.ts` exact-match query case-sensitivity is intentional [INFO] [Low confidence]

- **File / line:** `apps/web/src/lib/tag-records.ts:30-44`
- **Reason for deferral:** Verified-intentional. UNIQUE on `tags.name` plus utf8mb4_*_ci collation produces case-insensitive matching, which is the desired behavior. No action required.
- **Exit criterion to re-open:** None — this is a non-issue logged for completeness.

### C4L-CR-01 / C4L-ARCH-01 / C4L-DOC-01 — bundled into the C4L-SEC-01 fix

- **Files:** `apps/web/src/lib/validation.ts`, `apps/web/src/__tests__/validation.test.ts`
- **Reason for deferral:** Not deferred — these are the cleanup, architecture, and documentation companions of C4L-SEC-01 and are being implemented in the same PROMPT 3 commit (shared `UNICODE_FORMAT_CHARS` export + comment update + parallel test coverage).
- **Exit criterion:** Closed when C4L-SEC-01 lands.

## Repo-policy compliance

- Deferred items obey the `CLAUDE.md` deferred-fix rules: each cites file+line, original severity/confidence, deferral reason, and exit criterion.
- No security/correctness/data-loss item is deferred (the only LOW security item, C4L-SEC-01, is being implemented).
- Standard repo policy applies when these are picked up: GPG-signed commits, semantic+gitmoji, no `--no-verify`, no force-push to protected branches, required toolchain versions.

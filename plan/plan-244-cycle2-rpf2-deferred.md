# Plan 244 — Cycle 2 RPF2 deferred items

**Source review:** `.context/reviews/_aggregate-cycle2-rpf2.md`
**Created:** 2026-04-25 (orchestrator-cycle 2 of the 100-cycle review-plan-fix loop)
**Repo policy honored:** every cycle 2 RPF2 finding is recorded here or in `plan/plan-243-cycle2-rpf2-fixes.md`; severity is preserved; exit criteria are stated; no security/correctness/data-loss item is deferred.

## Scope

The cycle 2 RPF2 review surfaced ten Low-severity findings on top of cycle 1's broad C8RPF fix sweep. Five are scheduled for immediate fix in `plan-243`. The remaining five are recorded here with preserved severity, an explicit reason for deferral, and an exit criterion that re-opens the work.

## Deferred findings

| ID | Severity | Confidence | File:line | Reason for deferral | Exit criterion |
|---|---|---|---|---|---|
| C2L2-02 | Low | Medium | `apps/web/src/app/actions/images.ts:157-410` | The MySQL advisory lock around the entire upload body is intentionally coarse so settings updates ("change image_sizes / strip_gps_on_upload") cannot race in-flight uploads. Narrowing it to only the DB-mutation phases requires re-modeling what "in-flight upload" means against the upload contract; cycle 1 already accepted this coarseness in C8RPF-06. The repo's small-changes posture (`CLAUDE.md`) and the single-writer topology (`CLAUDE.md` runtime topology section) make this acceptable. | Re-open when concurrent upload throughput is reported as user-visible (queue starvation, 5xx surge during simultaneous admin uploads), or when settings TOCTOU is moved from advisory lock to DB row lock. |
| C2L2-04 | Low | High | `apps/web/src/app/actions/auth.ts:139-142,239-243` | Asymmetric helper usage between IP-scoped (`rollbackLoginRateLimit`) and account-scoped (`decrementRateLimit`) rollbacks is a code-readability finding; behavior is correct because the account bucket has no in-memory mirror to keep in sync. Refactoring to a shared `rollbackAccountRateLimit` helper would be a non-functional change. | Re-open when (a) someone adds an in-memory cache for the account bucket and forgets the mirror, or (b) the next maintainer touches this surface and finds the asymmetry confusing in code review. |
| C2L2-06 | Low | Medium | `apps/web/src/lib/restore-maintenance.ts:1-19` | The `Symbol.for('gallerykit.restoreMaintenance')` registry is process-local. CLAUDE.md's runtime-topology section already documents the single-writer constraint and explicitly enumerates `restore-maintenance` as one of the per-process states that prevent horizontal scaling. The hot-reload risk is dev-only; production runs cannot hot-reload. Moving the flag to a shared store is part of the larger "single-instance → multi-instance" deferred work tracked in C8RPF-47. | Re-open with C8RPF-47 (move coordination state to shared storage). |
| C2L2-09 | Low | Medium | `apps/web/src/lib/rate-limit.ts:255-283` | Two-round-trip decrement is unmeasurable at current login/share/admin volumes. Collapsing to one statement is a perf polish that benefits very-high-traffic deployments only. | Re-open when login/share/admin rate-limit DB load shows up in slow-query logs. |
| C2L2-10 | n/a | High | (verification only) | Not a finding — verification that the cycle 1 fixes for share/admin/public rate-limit rollback bucket-pinning landed cleanly. No action needed. | n/a |

## Repo-policy compliance

- No security, correctness, or data-loss finding is deferred. C2L2-01, -03, -05, -07, -08 are scheduled in `plan-243`.
- Severity and confidence are preserved as recorded in `_aggregate-cycle2-rpf2.md`.
- Exit criteria are concrete and observable.
- All deferred items, when picked up, will follow the repo's existing rules: GPG-signed commits, conventional commit + gitmoji, small reviewable diffs, Node 24+, TypeScript 6, and the action-origin / api-auth lint gates.

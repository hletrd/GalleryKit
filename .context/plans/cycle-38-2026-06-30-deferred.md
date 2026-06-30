# Cycle 38/100 Deferred Findings

Date: 2026-06-30 KST
Source review: `.context/reviews/cycle-38-2026-06-30/_aggregate.md`
Reviewed HEAD: `564a7679`

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, and current repository plan/review history. No `.cursorrules`, `CONTRIBUTING.md`, or docs style/policy files requiring a different deferral policy were present in this checkout.

Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, required quality gates, and per-cycle deploy policy.

## New Cycle 38 Deferred Items

### AGG-C38-07 - Imported side-effect detection is prefix-based and misses real helper names

- Original severity/confidence: Medium / High
- File+line citation: `apps/web/scripts/check-action-origin.ts:294`, `apps/web/scripts/check-public-route-rate-limit.ts:58`, `apps/web/src/app/actions/images.ts:7`, `apps/web/src/app/actions/images.ts:370`
- Reason for deferral: The safe fix is a broader scanner model or reviewed pure-import allowlist. A quick prefix expansion would likely continue the recurring "fix one sibling, miss the next" pattern and could create false positives across many imports. Current source calls the known `saveOriginalAndGetMetadata` helper after the guard, so this is a regression gap rather than a live mutation bypass.
- Exit criterion: Re-open when the scanner import model is redesigned, when a real helper outside the prefix set is moved before a guard/limiter, or when a reviewed pure-import allowlist can be implemented with focused fixtures for current action and public-route code.

### AGG-C38-08 - Sidecar color backfill still materializes and enqueues the full candidate set

- Original severity/confidence: Low / High
- File+line citation: `apps/web/scripts/backfill-color-pipeline.ts:343`, `apps/web/scripts/backfill-color-pipeline.ts:475`, `apps/web/src/lib/admin-backfill-runner.ts:692`
- Reason for deferral: Operator-only/offline memory-pressure issue. This cycle schedules the medium failure-accounting bug in the same sidecar; converting candidate selection to keyset pagination is a larger throughput/memory refactor that should be tested separately against force-reencode and resume behavior.
- Exit criterion: Re-open when sidecar backfill memory usage is observed, when `--force-reencode` is run against a materially large gallery, or when sidecar throughput/resume behavior is being redesigned.

## Carry-Forward Note

Cycle 37 deferred findings remain recorded in `.context/plans/cycle-37-2026-06-30-deferred.md` with original severity/confidence, reason, and exit criterion. This cycle did not re-open those items because no fresh evidence changed their severity or made them scheduled now.

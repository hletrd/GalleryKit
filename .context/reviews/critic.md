# Cycle 18/100 Critic Review

Date: 2026-07-08 KST
Role lane: critic
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no source fixes, commits, pushes, or deploys performed.

## Instructions And Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-17-2026-07-08-plan.md`, `.context/plans/cycle-17-2026-07-08-deferred.md`, and the `review-plan-fix` workflow instructions.

Inventory was built with `rg --files` before findings. Critic-relevant areas reviewed:

- Governance and ledgers: `AGENTS.md`, `CLAUDE.md`, `.context/plans/**`, `.context/reviews/**`, `plan/**`, current git history/status.
- Application surface: all `apps/web/src/app/**` routes/pages/actions, admin/public/share/search/OG/feed/upload/db flows, `proxy.ts`, and service worker registration/cache behavior.
- Core libraries: auth/session/origin/rate-limit/admin tokens, upload/file serving/image processing, DB/restore/advisory-lock helpers, data/privacy/search, CLIP, CSP, config, queue/background state, and storage.
- Schema/migrations/scripts: `apps/web/src/db/**`, `apps/web/drizzle/**`, `apps/web/scripts/**`, root deploy scripts, Docker/Compose/nginx.
- Tests and quality gates: `apps/web/src/__tests__/**`, `apps/web/e2e/**`, lint scripts, CI workflows, dependency audit, and current deferred ledgers.

## Findings Summary

- Confirmed issues: 1
- Likely issues: 0
- Manual-validation risks: 0 new critic-only risks beyond the confirmed ledger drift below and the existing deferred registers.

## Confirmed Issues

### C18-CRIT-01 - Active plan ledgers disagree about the current cycle and Cycle 17 release state

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region:
  - `.context/plans/README.md:34-38` still lists Run-10 Cycle 17 as the active current-cycle plan/deferred pair from HEAD `fc15b235`.
  - `.context/plans/cycle-17-2026-07-08-plan.md:3-7` says Cycle 17 is `IMPLEMENTED - GATES GREEN; COMMIT/PUSH/DEPLOY PENDING`.
  - `.context/plans/cycle-17-2026-07-08-plan.md:141-158` marks WP1-WP5 and local gates complete but records no committed terminal deploy outcome in the plan itself.
  - `.context/plans/cycle-17-2026-07-08-deferred.md:1-7` remains an open Cycle 17 deferred register.
  - `plan/plan-374-cycle18-fixes.md:1-10` says a separate Cycle 18 plan is `DONE` and Cycle 18 deferred findings remain active in `plan/plan-375-cycle18-deferred.md`.
  - `plan/plan-375-cycle18-deferred.md:1-7` is a Cycle 18 deferred ledger outside `.context/plans`.
  - `git log --oneline --decorate -5` shows `a1863405 (HEAD -> master, origin/master, origin/HEAD) fix(cycle17): 🐛 harden review-plan-fix findings`, so the repository has already advanced past the plan's recorded `fc15b235` pending state.
- Why this is a real problem: This repo uses plan/deferred ledgers as orchestration state. The `.context/plans` index tells agents to treat Cycle 17 as active and pending release, while root `plan/` files describe Cycle 18 work as done/deferred, and git history proves Cycle 17 changes were pushed. That split makes the authoritative frontier ambiguous for future review-plan-fix cycles, deploy accountability, and carry-forward age budgets.
- Concrete failure scenario: A planner reads `.context/plans/README.md`, starts a new implementation from `fc15b235`, and reschedules or defers already-pushed Cycle 17 findings. Another agent reads `plan/plan-374-cycle18-fixes.md`, treats Cycle 18 as done, and skips updating the `.context/plans` active pointer. The next aggregate can then mix Cycle 17 and Cycle 18 deferred registers, aging findings incorrectly and losing the deploy-evidence gap.
- Suggested fix: Consolidate cycle state into the canonical `.context/plans` lineage. Move Cycle 17 to completed with final commit `a1863405`, explicit push/deploy result, and any deploy-evidence gap. Either migrate `plan/plan-374-cycle18-fixes.md` and `plan/plan-375-cycle18-deferred.md` into `.context/plans` or mark them historical/superseded from the index. Make the active pointer name the actual current cycle and start HEAD after ledger reconciliation.

## Likely Issues

No likely critic issues beyond the confirmed ledger split above survived cross-checking against current source and deferred registers.

## Manual-Validation Risks

No new manual-validation-only critic risks are raised in this lane. The existing deferred ledgers already preserve the operator/product-boundary risks for single-instance coordination, plaintext SQL backups, live proxy topology, CLIP activation, multipart memory, DB pool/background budgets, and Docker/deploy proof.

## Refuted Or Already Covered Suspicions

- Security wrappers are centralized and covered by lint gates: `withAdminAuth(...)` is the admin API boundary, mutating server actions use same-origin guards, and public expensive/mutating routes are scanned for pre-increment rate limits.
- Upload/download path traversal and symlink handling have descriptor/realpath containment checks in `serve-upload.ts`, `upload-paths.ts`, and admin backup download.
- Backup/restore child processes use fixed executables and argument arrays rather than shell strings; restore performs SQL shape scanning and post-restore migration checks.
- Public semantic/similar search now charges rate-limit budget before DB-backed disabled/stub configuration work, matching the Cycle 18 plan claim.
- The root Cycle 18 plan documents several issues as already implemented or deliberately deferred; where those deferrals match repo policy boundaries, I did not duplicate them as new findings.

## Final Sweep

Reviewed source, tests, scripts, config, CI, deploy, migrations, docs, plan/review ledgers, and high-risk cross-file interactions for stale assumptions, product/ops risk, release-state drift, and correctness claims that rely on comments instead of code. I did not edit source, run deploy, commit, push, or touch `.context/reviews/cycle-8-2026-07-07/perf-reviewer.md`.

Skipped by design: generated dependencies/build outputs, runtime data/uploads/resources, binary/media artifacts, ignored local env secret contents, and unrelated historical archives not needed to validate current active/deferred state.

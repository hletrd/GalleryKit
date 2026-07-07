# Cycle 23 Critic Review

Date: 2026-07-08 KST
Role: `critic`
Review HEAD: `57c1ae33c0b9a0dd483cfdf58750b81d42a7d775`
Base reviewed: Cycle 22 implementation range `8b795862..HEAD`
Scope: multi-perspective critique of correctness assumptions, verification claims, and release provenance. Review-only.

## Provenance

This critic pass follows the Cycle 23 code-reviewer inventory and independently re-checked the highest-risk changed surfaces:
- mutation-barrier scanner and fixtures;
- pending file deletion drain, restore hook, scheduler hook, schema, and filesystem delete helpers;
- timeline grouping behavior test and parser;
- Cycle 22 plan/deferred/carry-forward ledgers and top-level review artifacts.

Validation used:
- Current branch `master` at `57c1ae33`, matching `origin/master`.
- Targeted Vitest command passed for scanner, pending deletion, pending session revocation, and timeline behavior tests.
- `npm run lint:action-origin --workspace=apps/web` passed.
- Synthetic `checkActionSource()` repro confirmed the nested-slot scanner bypass.
- `git diff --check 8b795862..HEAD` failed on trailing whitespace in review docs.

## Critic Findings

### CRIT23-01 - The mutation-barrier lint model still mistakes "a slot exists somewhere" for "the action body is fenced"

- Severity: High
- Confidence: High
- Status: Confirmed
- Region: `apps/web/scripts/check-action-origin.ts:687-735`; `apps/web/src/__tests__/check-action-origin.test.ts:624-675`; `CLAUDE.md:434`.
- Critique: The checker is trying to enforce a whole-body restore invariant, but the implementation is still local-pattern matching. It now rejects one positive-guard sibling pattern, yet it still accepts a slot in a nested branch as proof for the whole exported action. That is a boundary mismatch: the product invariant is dominance over protected mutations, not textual presence of an approved `using`.
- Failure scenario: an admin action acquires the slot only in a conditional branch, then performs an outer write. Current lint can pass; the restore drain sees no slot holder on the path that skipped the branch.
- Suggested fix: treat this as a small control-flow problem. Define the allowed action shapes narrowly, or build an AST check that maps each mutating statement to an enclosing acquired-slot region. Add tests for nested branch, loop, try/finally, and mixed positive/negative guard shapes.

### CRIT23-02 - Cycle 22 release ledger is stale relative to the committed state and its own gate evidence

- Severity: Medium
- Confidence: High
- Status: Confirmed provenance issue
- Region: `.context/plans/cycle-22-2026-07-08-plan.md:1-4`, `154-175`; `.context/plans/README.md:34-37`; git state `57c1ae33` equals `origin/master`.
- Critique: The Cycle 22 plan still says `Status: IMPLEMENTED - GATES PENDING`, and WP6 still says "commit/push/deploy pending" at line 154 while the same file records full local gates as passed at lines 167-175. The repo is also already pushed to `origin/master` at `57c1ae33`. The plan index still lists Cycle 22 under active current-cycle plans.
- Failure scenario: Cycle 23 planning has to infer whether Cycle 22 is source-complete, pushed, deployed, or still pending. That ambiguity is exactly the provenance drift the previous cycle fixed for Cycle 21, and it can cause future agents to mix source-state and production-state assumptions.
- Suggested fix: append terminal Cycle 22 evidence: exact signed commit hash, push state, deploy result or explicit deploy-not-run/supersession statement. Move Cycle 22 from active to recently completed once that is known. If deploy did not run, leave that as an explicit open blocker instead of "gates pending."

## Additional Critique Notes

- The pending file deletion drain is directionally correct and closes the "no replay consumer" defect, but its behavior-test layer is thinner than the plan promised. This is captured as `CR23-02` in the code-reviewer report rather than repeated here.
- Changed review Markdown failing `git diff --check` is low severity but contributes to ledger noise. This is captured as `CR23-03` in the code-reviewer report.

## Final Missed-Issues Sweep

I re-swept scanner dominance assumptions, restore hook ordering, maintenance single-flight/drain behavior, pending-deletion idempotency, source-contract tests, plan/deferred consistency, and changed-artifact hygiene. No additional critic-specific runtime findings were confirmed beyond the scanner boundary defect and the stale Cycle 22 ledger.

# Cycle 66 Docs / Deploy Drift Review

## Inventory

- Reviewed `AGENTS.md`, `CLAUDE.md`, root/app READMEs, root/app package scripts, deploy env examples, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, Dockerfile/Compose, migration journal, `migrate.js`, and `.context` review/plan indexes.

## Findings

### C66-02 - Plan index advertises Cycle 64 as active during Cycle 66

- Severity/confidence: Medium / High.
- Citation: `.context/plans/README.md:7`, `.context/plans/README.md:12`.
- Evidence: Cycle 65 plan/deferred files exist, `.context/reviews/_aggregate.md` points at Cycle 65, and HEAD is `d3e18c6f fix(cycle-65)`.
- Failure scenario: Cycle 66 planning follows the stale index and reopens Cycle 64 instead of starting from the Cycle 65 aggregate/deferred state.
- Fix direction: update the active/recent plan index to Cycle 66 and close Cycle 65/64 state.

### C66-03 - Cycle 65 ledger leaves commit/push/deploy unresolved

- Severity/confidence: Medium / High.
- Citation: `.context/plans/cycle-65-2026-07-01-plan.md:49`, `.context/plans/cycle-65-2026-07-01-plan.md:50`.
- Evidence: `HEAD`, `origin/master`, and `origin/HEAD` point at signed commit `d3e18c6f`; the Cycle 66 invocation identifies that commit as current deployed `master` HEAD.
- Failure scenario: later cycles cannot tell whether the per-iteration deploy policy was satisfied for Cycle 65.
- Fix direction: mark the terminal steps done and record signature/origin/deployed-HEAD evidence.

## Non-Findings

- Root `npm run deploy` still delegates to `scripts/deploy-remote.sh` with config-driven env and SSH command.
- `apps/web/deploy.sh` still preserves the disk-hygiene guarantees: prune after healthy `up -d`, bind-mounted data, no `-a` on volume prune.
- Migration/schema runbook and code remain aligned.
- Photographer policy remains consistent: no editing/culling/scoring/payment surface, no bundled Lightroom plugin, local filesystem only, semantic search operator-enabled.
- Cycle 65's sidecar README drift is fixed.

## Final Sweep

Two docs/ledger findings scheduled.

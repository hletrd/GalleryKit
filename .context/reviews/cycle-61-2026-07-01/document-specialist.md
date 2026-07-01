# Cycle 61 Deploy / Docs Drift Review

Reviewed cycle ledgers, plan index, latest aggregate pointer, deploy-helper docs, and recent commit evidence at HEAD `7e85644e`.

## Findings

### C61-04 - Cycle 60 terminal evidence is stale after signed/pushed/deployed fix commit

- Severity: Medium
- Confidence: High
- File/line: `.context/plans/cycle-60-2026-07-01-plan.md:38`, `.context/plans/cycle-60-2026-07-01-plan.md:39`, `.context/plans/README.md:7`, `.context/reviews/_aggregate.md:3`
- Problem: Cycle 60's committed plan still leaves commit/push and deploy unchecked, and the plan index still marks Cycle 60 as active, even though `HEAD`, `origin/master`, and the cycle-61 invocation identify `7e85644e` as the current deployed `master` HEAD.
- Failure scenario: later cycles or operators repeat closed ledger work or treat the deployed baseline as uncertain.
- Fix: close Cycle 60 terminal progress with signed commit/origin/deployed-baseline evidence, advance the active plan index to Cycle 61, and repoint the latest aggregate to Cycle 61.

No new deploy-helper command drift was found; `AGENTS.md`, `CLAUDE.md`, and `scripts/deploy-remote.sh` agree on root `.env.deploy`, `$HOME/.gallerykit-secrets/gallery-deploy.env`, and `DEPLOY_ENV_FILE`.

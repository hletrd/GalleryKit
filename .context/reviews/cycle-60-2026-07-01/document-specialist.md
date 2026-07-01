# Cycle 60 Documentation / Deploy Drift Review

Reviewed HEAD: `fe112ba5859e42842389020544f2ffa1d91662d9`.

## Inventory Checked

- Committed Cycle 59 artifacts and current plan index.
- Deploy docs/helpers: `AGENTS.md`, `CLAUDE.md`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `.env.deploy.example`.
- Migration/deploy runbooks and deploy-script contract tests.

## Findings

### C60-01 - Cycle 59 terminal evidence is stale at current HEAD

- Severity: Medium
- Confidence: High
- File/line: `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-59-2026-07-01-plan.md:43`, `.context/plans/cycle-59-2026-07-01-plan.md:44`
- Problem: Cycle 59 remains marked active and terminal steps remain unchecked even though current HEAD is signed/pushed Cycle 59 closeout commit `fe112ba5`.
- Failure scenario: An operator treats Cycle 59 as still pending or deploy-unknown.
- Suggested fix: Update Cycle 59's plan/index with terminal evidence for `fe112ba5` and advance active status to Cycle 60.

### C60-02 - Short-form deploy docs omit the helper's fallback env file

- Severity: Low
- Confidence: High
- File/line: `AGENTS.md:17`, `AGENTS.md:18`, `CLAUDE.md:469`, `CLAUDE.md:679`, `scripts/deploy-remote.sh:22`, `scripts/deploy-remote.sh:28`
- Problem: The short deploy docs say `npm run deploy` reads root `.env.deploy`, while `scripts/deploy-remote.sh` uses root `.env.deploy` when present, otherwise falls back to `$HOME/.gallerykit-secrets/gallery-deploy.env`, with `DEPLOY_ENV_FILE` as an override. The later `CLAUDE.md` helper section documents this correctly.
- Failure scenario: An agent/operator relying on the short docs omits root `.env.deploy` and unintentionally deploys using a stale global fallback target.
- Suggested fix: Align `AGENTS.md` and the `CLAUDE.md` per-iteration paragraph with the detailed helper behavior.

## Non-Findings

- Migration runbook matches hash-based migration postconditions and reconcile mirroring.
- Deploy prune contract matches docs/tests: health before prune, bind-mounted mutable data, no `-a` on automatic `docker volume prune`.
- No source/runtime defect was identified in this lane.

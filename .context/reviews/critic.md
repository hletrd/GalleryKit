# Cycle 26 Critic Review

Reviewer: cycle-26 critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `d13d66377e6952ae974a6ee3d29ce52f0aa77640` on `master`
Scope: whole-repository critique from product, operational, maintainability, and hidden-assumption angles.

## Inventory First

I read `AGENTS.md` and `CLAUDE.md` first, then built a fresh file inventory before reviewing.

Inventory evidence:

- Git-tracked files: 2588 total.
- Top tracked areas: `.context` 1773, `apps` 617, `plan` 180, `docs` 2, plus root docs/manifests/deploy files.
- Raw workspace files excluding `.git`, `node_modules`, `apps/web/.next`, `dist`, and `coverage`: 6743 total.
- App TypeScript/TSX/e2e tracked files: 518.
- Review-relevant anchors inspected: `AGENTS.md`, `CLAUDE.md`, root/app READMEs, root/app package scripts, `.env.deploy.example`, `apps/web/.env.local.example`, Dockerfile, compose, nginx, deploy helpers, migration journal, migration runner, schema, quality-gate scripts/tests, semantic-search implementation, CLIP scripts, deployment docs, and `docs/superpowers`.
- `git status --short`, `git diff --stat`, and `git diff --name-only` produced no pre-existing unstaged change output before this report rewrite.

## Findings

### C26-CRIT-01 - Historical superpowers CLIP docs still assert live production activation

Severity: Medium
Confidence: High
Region: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:17`, compared with `CLAUDE.md:159` and `CLAUDE.md:541-545`

Failure scenario:

A future agent or operator starts from `docs/superpowers` because the task names that directory or because it looks like the latest CLIP design record. The spec says semantic search is "SHIPPED & ACTIVATED in production" and serving over a specific embedding count, while the current authoritative repo docs say production is operator-enabled, fresh installs default to disabled, the repo proves gates/runbooks rather than current live row count, and operators must verify the deployed host before treating production semantic search as active. That stale certainty can make a reviewer skip the actual env/DB/weights checks or report a disabled deployment as regressed when it is merely not opted in.

Concrete fix:

Demote the live-production statements in `docs/superpowers` to historical activation notes. Add a banner matching the plan file's historical-record language to the spec, remove the current row-count claim, and link to `CLAUDE.md` plus `apps/web/README.md` as the live activation/runbook source. Keep implementation decisions like model id, threshold, and cache layout, but make current runtime state explicitly non-authoritative there.

## No-New-Findings Areas

No additional critic findings rose to reportable confidence after the final sweep.

Evidence checked:

- Deployment: `apps/web/deploy.sh` still runs `git pull --ff-only`, builds with compose, waits for health, then prunes containers/images/builder cache/dangling volumes after the live container is healthy. The bind-mount guarantees in `AGENTS.md`/`CLAUDE.md` align with compose and deploy script.
- Migrations: journal entries, monotonicity tests, hash postcondition, and `reconcileLegacySchema` coverage were inspected; no new schema/runbook contradiction was found.
- Runtime env docs: upload/body caps, proxy trust, DB TLS, health/live split, CLIP weights root, and semantic-search limits matched source at the level reviewed.
- Quality gates: package scripts expose the blocking lint/typecheck/build/test gates described in `AGENTS.md` and `CLAUDE.md`.
- Product posture: no active docs or source reviewed reintroduced payment, editing/culling/scoring, or unsupported object-storage switching as a shipped feature.

## Final Missed-Issues Sweep

Final targeted sweep covered stale terms and contracts for `production`, `semantic_search_mode`, `CLIP`, `--force`, `SEMANTIC_SCAN_LIMIT`, deploy pruning, `volume prune`, migrations, `when`, `reconcileLegacySchema`, upload body caps, `TRUST_PROXY`, S3/MinIO/storage, Stripe/payment, Lightroom/PAT upload docs, and `docs/superpowers`.

Validation note: this was a review-artifact pass. I did not run the full app test suite because no product code was changed.

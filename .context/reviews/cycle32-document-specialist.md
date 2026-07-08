# Cycle 32 Document Specialist Review

Scope: document-specialist review at HEAD `4a728335ada304371743689de7f5bbf8670985b5`.

Constraints honored:
- Read-only review of source/docs/scripts.
- Wrote exactly this provenance file.
- No source edits, no commit, no push.

## Inventory

Authority and operator docs reviewed:
- `AGENTS.md` lines 17-38: deploy, schema, and blocking quality-gate policy.
- `CLAUDE.md` lines 467-506: migration/schema-drift runbook.
- `CLAUDE.md` lines 512-554 and 736-764: deploy helper, nginx apply, disk hygiene, Docker setup.
- `CLAUDE.md` lines 673-707: test and lint-gate documentation.
- `README.md` lines 129-214: remote deploy helper, env/build-time settings, Docker deployment.
- `apps/web/README.md` lines 27-44 and 46-64: package scripts and environment notes.
- `.context/plans/README.md` lines 1-12, 34-38, 261-265: current plan/review provenance rules.
- Prior duplicate-check docs: `.context/reviews/archive/_aggregate-cycle32.md` lines 5-14 and `.context/reviews/archive/cycle32-comprehensive-review.md` lines 12-16.

Implementation and gate files reviewed:
- Root `package.json` lines 17-29: root workspace command routing.
- `apps/web/package.json` lines 8-29: web package scripts.
- `.github/workflows/quality.yml` lines 54-83: CI quality-gate sequence.
- `.env.deploy.example` lines 1-16 and `scripts/deploy-remote.sh` lines 22-93: deploy env/helper contract.
- `apps/web/deploy.sh` lines 10-77 and 79-108: remote deploy, health check, prune behavior.
- `apps/web/docker-compose.yml` lines 15-32: host networking, trusted proxy, persistence mounts, site-config mount note.
- `apps/web/Dockerfile` lines 150-198 and `apps/web/scripts/entrypoint.sh` lines 16-47: runtime file layout, migration command, startup entrypoint.
- `apps/web/scripts/migrate.js` lines 210-227, 803-858, 968-988, and 1020-1036: journal hashing, baseline guards, post-condition, startup flow.
- `apps/web/drizzle/meta/_journal.json` lines 144-221: latest journal entries.
- `apps/web/src/lib/data.ts` lines 251-475 and `apps/web/src/__tests__/privacy-fields.test.ts` lines 41-160: admin-only/public privacy contract.

## Findings

### D32-DOC-01: CI has a blocking production dependency audit that the documented gate list omits

Severity: LOW

Confidence: High

Status: Current doc/code mismatch.

Citations:
- `AGENTS.md` lines 29-38 labels the listed commands as "Quality gates (all blocking)" but lists lint, three custom lint gates, typecheck, build, unit tests, and conditional e2e only.
- `CLAUDE.md` lines 673-683 documents the formal test surface, and lines 686-705 document the blocking lint gates, but neither includes the production dependency audit.
- `.github/workflows/quality.yml` lines 66-67 runs `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` as its own CI step between security lint gates and unit tests.
- Root `package.json` lines 17-29 and `apps/web/package.json` lines 8-29 expose no named script for this audit, so an operator following only the documented command list has no repo-local command name to discover it.

Concrete failure scenario:
An agent or maintainer follows `AGENTS.md` as the blocking local gate checklist before pushing a dependency or lockfile change. The documented gates all pass locally, but CI later fails at the undocumented `Production dependency audit` step. In a per-iteration deploy workflow, that turns the gate list into an incomplete release checklist and can waste a deploy/review cycle on a failure that should have been known before push.

Suggested fix:
Add the audit command to the documented blocking gate list in `AGENTS.md` and the test/gate section in `CLAUDE.md`. Consider adding a root script such as `npm run audit:prod` that wraps `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`, then use that script in CI and docs so the package scripts, CI, and operator runbook share one command.

Duplicate/fixed-finding check:
This is not the old Cycle 32 connection-pool documentation false positive. The archived aggregate explicitly marks C32-01 false positive at `.context/reviews/archive/_aggregate-cycle32.md` lines 5-14, and the detailed review confirms `CLAUDE.md` already matched the pool value at `.context/reviews/archive/cycle32-comprehensive-review.md` lines 12-16. Earlier dependency-audit deferrals found by search were about whether `npm audit` could be run in a networked pass, not about the audit being absent from the blocking gate documentation.

## No Other Current Findings Found

- Deploy helper docs match `scripts/deploy-remote.sh`: `.env.deploy` preference, fallback to `$HOME/.gallerykit-secrets/gallery-deploy.env`, `DEPLOY_ENV_FILE`, derived SSH command, `DEPLOY_REMOTE_SCRIPT`, and `DEPLOY_CMD` are consistent across `README.md` lines 129-140, `CLAUDE.md` lines 754-764, `.env.deploy.example` lines 1-16, and `scripts/deploy-remote.sh` lines 22-93.
- Remote deploy and disk-hygiene docs match `apps/web/deploy.sh`: the script pulls, builds with `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`, waits for health, then prunes containers, images, builder cache, and dangling volumes after the stack is healthy (`apps/web/deploy.sh` lines 10-77 and 79-108; `AGENTS.md` lines 17-20; `CLAUDE.md` lines 512-548).
- Docker persistence docs match compose and Dockerfile: bind mounts cover `/app/data`, uploads, resources, and read-only site config; the Dockerfile runs migrations before `server.js` (`apps/web/docker-compose.yml` lines 24-32; `apps/web/Dockerfile` lines 150-198; `CLAUDE.md` lines 736-752).
- Migration docs match implementation: journal entries are hashed, DML baselining is guarded, pending-vs-drift handling is explicit, and `runMigrations` asserts every committed hash is recorded (`CLAUDE.md` lines 467-506; `apps/web/scripts/migrate.js` lines 210-227, 803-858, and 968-988).
- Schema/privacy docs match current guard shape: the new admin-only-column checklist in `AGENTS.md` line 27 and `CLAUDE.md` line 489 matches `_PrivacySensitiveKeys`, public-field omission, and `SENSITIVE_KEYS` fixture coverage in `data.ts` and `privacy-fields.test.ts`.
- `.context` convention docs are internally consistent for current review provenance: `.context/reviews/` and `.context/plans/` are committed history per `AGENTS.md` lines 42-44, and `.context/plans/README.md` warns not to infer frontier state from the index alone at lines 1-12 and 261-265.

## Validation

Commands/evidence used:
- `git rev-parse HEAD` -> `4a728335ada304371743689de7f5bbf8670985b5`.
- `git status --short` was clean before writing this file.
- `omx explore --prompt ...` produced an independent docs+code inventory.
- Targeted `nl -ba` and `rg --line-number` reads for all citations above.

No tests were run; this was a read-only documentation/code review with one provenance-file write.

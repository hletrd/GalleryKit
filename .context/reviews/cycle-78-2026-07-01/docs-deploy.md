# Cycle 78 Docs/Deploy Drift Review

HEAD reviewed: `9286bef16f3401fb0d8c17f52de5c96804c04533`.

## Inventory

Reviewed: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, deploy/nginx contract tests, and recent cycle docs/deploy findings.

Validation from delegated lane:

- `npm test --workspace=apps/web -- deploy-script-contract nginx-config` passed: 2 files / 25 tests.
- `npm test --workspace=apps/web -- ensure-site-config upload-limits-env` passed: 2 files / 9 tests.
- Journal check: 29 journal entries, 29 SQL files, no missing/extra files.
- Docker daemon unavailable in delegated lane, so production dependency stage could not be smoke-built there.

## Findings

### C78-DOCDEP-01 - Runtime Docker dependency stage does not carry the native optional-dependency workaround

- Severity: Medium
- Confidence: Medium
- Citations: `apps/web/Dockerfile:32`, `apps/web/Dockerfile:49`, `apps/web/Dockerfile:63`, `apps/web/Dockerfile:119`, `apps/web/next.config.ts:45`, `apps/web/src/lib/process-image.ts:1`, `apps/web/src/lib/process-topic-image.ts:1`, `apps/web/src/app/api/og/photo/[id]/route.tsx:4`
- Problem: the Dockerfile documents a macOS-authored lockfile/Linux optional-dependency failure mode and applies explicit Linux native installs only in the build dependency stage. The runtime image copies a separate `prod-deps` stage that runs plain `npm ci --omit=dev --workspace=apps/web`; `sharp` is externalized and required at runtime.
- Failure scenario: a Linux production image build succeeds because the build stage received explicit native packages, but the runtime image lacks the matching `@img/sharp-*` binaries. Uploads, topic image processing, CLIP image embedding, or per-photo OG generation then fail at runtime while the image built successfully.
- Suggested fix: apply the same architecture-aware native install workaround to `prod-deps` and add a runtime dependency smoke check for `require('sharp')`.

## Non-Findings

- Root `npm run deploy` and `.env.deploy` fallback behavior match AGENTS/CLAUDE/README.
- `apps/web/deploy.sh` health-checks before prune and preserves the documented bind-mount/volume-prune safety contract.
- nginx body caps and `/api/admin/lr/upload` precedence match docs and tests.
- Migration journal/runbook coverage matches current `migrate.js` behavior.

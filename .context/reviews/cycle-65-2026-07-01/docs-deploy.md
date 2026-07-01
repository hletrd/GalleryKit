# Cycle 65 Docs / Deploy Review

## Inventory

- `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Root/app `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `entrypoint.sh`.
- `.env.deploy.example`, `.env.local.example`, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`.
- Migration journal, `apps/web/scripts/migrate.js`, recent SQL migrations, and `apps/web/src/db/schema.ts`.

## Findings

### C65-04 - Abbreviated sidecar commands can write CLIP/backfill data to the wrong paths

- Severity/confidence: Low / High.
- File/line: `apps/web/README.md:40`, `CLAUDE.md:345`, `CLAUDE.md:513`, `CLAUDE.md:528`, `apps/web/src/lib/clip-paths.ts:48`, `apps/web/src/lib/upload-paths.ts:12`.
- Evidence: the app README labels bare `npx tsx ...` commands as sidecar commands. The full production runbooks require Docker mounts plus env overrides such as `CLIP_MODELS_ROOT=/app/data/models/clip` and `UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original`.
- Failure scenario: an operator copies the README table command into a sidecar and writes model weights or backfill I/O under ephemeral `/app/apps/web/...` paths instead of persisted bind mounts.
- Suggested fix: mark the table commands as local/dev helpers and direct production sidecar users to the full `CLAUDE.md` runbooks.

## Validation

- Focused deploy/nginx/clip-path tests passed in the reviewer lane.
- Migration journal files were present; the known historical non-monotonic timestamp remains covered by hash-baseline protection.

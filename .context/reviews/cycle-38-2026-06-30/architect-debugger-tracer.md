# Cycle 38 Architecture/Deploy/Docs Review

Cycle: 38/100
Date: 2026-06-30 KST
Reviewed HEAD: `564a7679`

## Inventory

- `AGENTS.md`, `CLAUDE.md`
- Deploy/runtime: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, `nginx/default.conf`
- Migration/schema: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, recent migration SQL, `apps/web/src/db/schema.ts`
- Docs/context: root `README.md`, `apps/web/README.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, current/archived review aggregates

Validation run by the lane:

- `npm test --workspace=apps/web -- --run src/__tests__/deploy-script-contract.test.ts src/__tests__/nginx-config.test.ts src/__tests__/migrate-reconcile-coverage.test.ts`: 99 tests passed.

## Findings

### C38-DOC-01 - Manual disk-recovery runbook uses all-volume prune despite narrower deploy safety contract

Severity: Medium
Confidence: Medium

File/line:

- `CLAUDE.md:475`
- `CLAUDE.md:486`
- `AGENTS.md:19`
- `apps/web/docker-compose.yml:24`

The automatic deploy path documents and tests `docker volume prune -f` without `-a`, preserving the no all-volume-prune safety contract. The manual 100%-disk recovery snippet recommends `docker volume prune -af` and labels it safe because GalleryKit data is bind-mounted. The command is host-global and can delete unused named volumes from unrelated Docker workloads.

Failure scenario: an operator follows the emergency runbook on a reused/co-tenanted host and deletes another service's unused named volume or rollback snapshot while recovering GalleryKit disk pressure.

Suggested fix: make the default manual command `docker volume prune -f`. If `-a` is mentioned, label it as dedicated-host break-glass after inspecting `docker volume ls`.

### C38-DOC-02 - Latest aggregate file points to Cycle 37 but still embeds Cycle 35 content

Severity: Low
Confidence: High

File/line:

- `.context/reviews/_aggregate.md:1`
- `.context/reviews/_aggregate.md:15`
- `.context/plans/README.md:34`
- `.context/reviews/cycle-37-2026-06-30/_aggregate.md:1`

`.context/reviews/_aggregate.md` correctly points to `cycle-37-2026-06-30/_aggregate.md`, but the body after the separator still contains the Cycle 35 aggregate. `.context/plans/README.md` tells agents to read `.context/reviews/_aggregate.md`, so the current file mixes a current pointer with stale embedded detail.

Failure scenario: a later planning lane reads past the pointer and re-schedules Cycle 35 findings as if they were the latest state.

Suggested fix: replace the top-level aggregate with the current cycle aggregate and keep historical bodies only in cycle-specific files.

## No Current Finding

No actionable drift was found in executable deploy or migration paths. Deploy safety, Docker persistence, and migration reconcile coverage remain backed by tests.

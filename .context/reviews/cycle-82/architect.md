# Cycle 82 Architect / Document-Specialist / Critic Review

Start HEAD: `c272c5217ffdf1d324f001d8c35145262be310b4`.
Date: 2026-07-01.

## Inventory

- Required guidance read first: `AGENTS.md:1` and `CLAUDE.md:1`.
- Docs and release ledgers inspected: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-80-2026-07-01-plan.md`, `.context/plans/cycle-81-2026-07-01-plan.md`, `.context/plans/cycle-81-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, and `.context/reviews/cycle-81-2026-07-01/_aggregate.md`.
- Deploy surfaces inspected: `package.json`, `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/.env.local.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, and `apps/web/scripts/ensure-site-config.mjs`.
- Schema and migration surfaces inspected: `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/data.ts`, and `apps/web/src/__tests__/privacy-fields.test.ts`.
- Architecture and product-policy surfaces inspected: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/__tests__/map-thumb-wiring.test.ts`, and repo-wide searches for paid-download/Stripe, S3/MinIO, bundled Lightroom plugin, editing/culling/scoring exposure, and schema-derived-list drift.

## Finding

### C82-ARCH-01 - Cycle 81 ledger still reads active and deploy-unchecked after its pushed HEAD

Severity: Medium.
Confidence: High.

Evidence:

- Project policy requires every change to be committed and pushed (`AGENTS.md:7`) and requires `npm run deploy` after every commit pushed to `master` (`AGENTS.md:17`, `CLAUDE.md:469`).
- Current `HEAD`, `origin/master`, and remote `refs/heads/master` are signed commit `c272c5217ffdf1d324f001d8c35145262be310b4` (`fix(map): preserve meaningful marker titles`), so Cycle 81's implementation has reached the remote.
- `.context/plans/README.md:5` through `.context/plans/README.md:8` still list Cycle 81 under "Active Current-Cycle Plans".
- `.context/plans/cycle-81-2026-07-01-plan.md:47` and `.context/plans/cycle-81-2026-07-01-plan.md:48` still leave "Commit, pull --rebase, push" and "Deploy with `npm run deploy`" unchecked.
- The same plan records gate evidence through `git diff --cached --check` at `.context/plans/cycle-81-2026-07-01-plan.md:52` through `.context/plans/cycle-81-2026-07-01-plan.md:60`, but records no terminal commit/push evidence for `c272c521` and no deploy evidence or explicit deploy gap.

Failure scenario:

A future cycle or operator reads the committed ledgers and sees Cycle 81 as still active, despite its fix commit being signed and pushed. They cannot distinguish "deployed but not recorded" from "pushed but not deployed" without rerunning git and deploy checks, which weakens the repo's per-iteration deploy audit trail.

Suggested fix:

Close the Cycle 81 release ledger in the next implementation pass: record signed commit/push evidence for `c272c521`, record the `npm run deploy` result if it ran or an explicit deploy-evidence gap if it did not, move Cycle 81 out of the active section in `.context/plans/README.md`, and let the next deploy supersede production state when appropriate.

## Non-Findings

- Schema/migration runbook: no new mismatch found. The non-monotonic journal history remains documented, and the current migrator uses per-entry hashes plus postconditions (`apps/web/scripts/migrate.js:180`, `apps/web/scripts/migrate.js:803`). The reconcile path mirrors current adds/removals, including paid-download and reaction schema drops (`apps/web/scripts/migrate.js:699` through `apps/web/scripts/migrate.js:717`).
- Product policy: no current source/docs evidence reintroduces Stripe/payment, entitlements, `license_tier`, bundled Lightroom plugin claims, S3/MinIO switching, or photo editing/culling/scoring. The explicit policies remain in `README.md:31` through `README.md:46`, `CLAUDE.md:149`, `CLAUDE.md:271`, and `CLAUDE.md:584`.
- Cycle 81 map accessibility fix is present, not re-raised: the map route imports `getPhotoDisplayTitle` at `apps/web/src/app/[locale]/(public)/map/page.tsx:11` and uses it for `displayTitle` at `apps/web/src/app/[locale]/(public)/map/page.tsx:60`.
- `C80-06` remains deferred, not re-raised: `.context/plans/cycle-81-2026-07-01-deferred.md:12` carries forward the site-config runtime/build-time contract issue with the same dedicated exit criterion. I found no new evidence changing severity.

## Validation

- Targeted guard run: `npm test --workspace=apps/web -- --run src/__tests__/migration-journal.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/map-thumb-wiring.test.ts` passed: 4 files, 99 tests.
- `git status --short` was clean before writing this review artifact.

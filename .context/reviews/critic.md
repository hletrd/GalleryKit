# Critic Review - Cycle 7 Lane E

Reviewer: critic. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `cae5fbd9`.
Mode: read-only source/document critique, except this requested review artifact.

## Inventory

I built the review inventory before filing findings:

- Operating docs and policies: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Package and gate scripts: root `package.json`, `apps/web/package.json`, lint scanners, migration tests, deploy contract tests.
- Deploy/runbook surfaces: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`.
- Schema/migration surfaces: all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`.
- CLIP/semantic-search implementation: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/clip-*`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, and semantic settings UI/action code.
- Product boundary checks: storage abstraction, upload/serve paths, privacy omit guards, public/admin routes, payment/Stripe remnants, Lightroom API, and edit/cull/score wording.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- --run src/__tests__/storage-quarantine.test.ts src/__tests__/gallery-config-semantic-production.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` - pass, 39 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/deploy-script-contract.test.ts` - pass, 129 tests.

## Findings

### CRIT-E-01 - Embedding storage cannot retain multiple model versions even though the architecture is version-gated

- Severity: Medium
- Confidence: High
- Status: confirmed from code and docs; production-weight behavior was not manually exercised
- Perspectives: architecture, rollback safety, operator correctness, documentation mismatch

Evidence:

- `apps/web/drizzle/0012_image_embeddings.sql:5-11` creates `image_embeddings` with `image_id` as the sole primary key.
- `apps/web/src/db/schema.ts:286-300` mirrors that contract with `imageId: primaryKey`, while `modelVersion` is only a normal column plus an index.
- `apps/web/scripts/backfill-clip-embeddings.ts:25-42` documents that the sidecar writes one row per image and replaces the existing row for a new model version; `apps/web/scripts/backfill-clip-embeddings.ts:212-223` implements `onDuplicateKeyUpdate` against that single image key.
- `apps/web/src/app/actions/embeddings.ts:175-186` performs the same in-app upsert and overwrites `embedding`, `modelVersion`, and timestamps for the image.
- Serving is version-filtered: `apps/web/src/app/api/search/semantic/route.ts:270-279` filters candidates by the active production model version, and `apps/web/src/app/api/search/similar/[id]/route.ts:140-148` plus `apps/web/src/app/api/search/similar/[id]/route.ts:181-190` require the active version for target and candidate rows.
- `apps/web/README.md:70` says production serves only rows matching active `model_version`, and `CLAUDE.md:570-574` says sidecar and in-app scans converge with duplicates at worst. Those statements do not call out that prior-version embeddings are overwritten, not retained.

Failure scenario:

During a real model rollout or future model upgrade, a backfill for model version `B` overwrites each image's previous version `A` row. If the rollout is interrupted, production search for version `B` sees only the overwritten subset while untouched images remain on `A` and are filtered out. If an operator rolls configuration back to `A`, the rows already overwritten to `B` no longer have `A` embeddings. The system is therefore model-version gated at read time but not model-version retaining at write time.

Suggested fix:

Either document the current single-active-embedding limitation as an explicit operational constraint, or migrate the schema to retain rows by `(image_id, model_version)`. The durable fix is a composite primary key or surrogate key with a unique `(image_id, model_version)`, followed by Drizzle schema updates, `reconcileLegacySchema` coverage, queue/backfill conflict-target changes, search/similar query updates, and a retention/cleanup policy for obsolete model versions.

## No Additional Confirmed Critic Defects

The final sweep did not find additional current high-confidence defects in the reviewed surfaces:

- Admin API auth, mutating server-action origin protection, and public route rate-limit scanner contracts passed.
- Migration journal, monotonicity, reconciler coverage, pending-migration, and deploy-contract tests passed.
- Semantic production mode is gated by environment and settings code; the UI does not allow selecting production directly, and routes reject unavailable production search.
- Similar-photo UI is production-only and the route requires active production model rows.
- Storage abstraction is quarantined and documented as local-only/not integrated; direct upload/serve paths still use the local filesystem as documented.
- Payment/Stripe and bundled Lightroom-plugin features are not advertised as active product surfaces in the current app docs inspected.

Residual risk remains that live production behavior was not validated with real CLIP weights, a real production database, or a host nginx reload probe. This review is source-backed plus targeted local tests, not an operations audit.

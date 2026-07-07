# Document Specialist Review - Cycle 7 Lane E

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `cae5fbd9`.
Mode: read-only documentation/source review, except this requested review artifact.

## Inventory

I inventoried documentation and matched it against the code paths that implement the documented behavior:

- Canonical guidance: `AGENTS.md`, `CLAUDE.md`.
- User/operator docs: `README.md`, `apps/web/README.md`.
- Package scripts and gates: root `package.json`, `apps/web/package.json`.
- Deploy/runbooks: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, deploy contract tests.
- Schema/runbook implementation: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration source-contract tests.
- Semantic-search docs and implementation: `CLAUDE.md` CLIP runbook, `apps/web/README.md` semantic-search section, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/clip-*`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, semantic route/action/components/settings files.
- Product boundary docs: storage abstraction notes, privacy/data omit guards, upload/serve paths, public route policies, removed payment/download claims, and Lightroom API docs.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- --run src/__tests__/storage-quarantine.test.ts src/__tests__/gallery-config-semantic-production.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` - pass, 39 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/deploy-script-contract.test.ts` - pass, 129 tests.

## Findings

### DOC-E-01 - Semantic-search docs understate the single-row embedding overwrite limitation

- Severity: Medium
- Confidence: High
- Status: confirmed from code/docs; production-weight behavior was not manually exercised
- Documentation angle: the docs describe version-filtered serving but do not make the write-time retention limit clear enough for operators planning model rollout, rollback, or upgrades.

Evidence:

- `apps/web/README.md:64-72` documents disabled/stub/production semantic search and says production serves only rows matching the active `model_version`.
- `CLAUDE.md:527-602` is the CLIP activation and weight-seeding runbook. `CLAUDE.md:570-574` says forced production backfill and in-app scans converge, and that a race at worst duplicates one image's inference.
- The storage contract is single-row per image: `apps/web/drizzle/0012_image_embeddings.sql:5-11` has `PRIMARY KEY (image_id)`, and `apps/web/src/db/schema.ts:286-300` keeps `imageId` as the primary key.
- Both writers replace the row in place: `apps/web/scripts/backfill-clip-embeddings.ts:25-42` documents replacement for a new model version, `apps/web/scripts/backfill-clip-embeddings.ts:212-223` performs the duplicate-key update, and `apps/web/src/app/actions/embeddings.ts:175-186` does the same from the app worker path.
- Both readers are model-version filtered: `apps/web/src/app/api/search/semantic/route.ts:270-279`; `apps/web/src/app/api/search/similar/[id]/route.ts:140-148` and `apps/web/src/app/api/search/similar/[id]/route.ts:181-190`.

Failure scenario:

An operator reads the runbook as meaning old and new model-version rows can safely coexist while search selects only the configured version. They start a production backfill for a new version, stop midway, and then switch or roll back the configured model. Because the table stores only one row per image, rows already processed for the new version have lost the old embedding, while rows not yet processed remain invisible to the new-version filter. The docs explain the read filter but not the write-time overwrite/rollback consequence.

Suggested fix:

Update `CLAUDE.md` and `apps/web/README.md` to state the current contract explicitly until the schema changes: `image_embeddings` stores one active embedding per image; production backfills replace prior model-version rows; complete and verify a full backfill before relying on a new production model; rollback to a prior version requires re-embedding affected images. If the intended product contract is true coexistence, the docs should instead point to a migration that keys rows by `(image_id, model_version)`.

## Verified Aligned Areas

- Deploy docs match the scripts: root `npm run deploy` loads configured deploy env, refuses unsafe env permissions, performs host-side `git pull --ff-only`, rebuilds via Compose, health-checks `/api/live`, and prunes Docker after `up -d`.
- Docker persistence docs match compose/deploy behavior: `./data`, `./public/uploads`, `./public/resources`, and read-only `./src/site-config.json` are bind mounts, while immutable public assets come from the image.
- Schema docs match current safeguards: migration journal/file parity, strictly increasing `when`, hash post-condition assertion, pending-vs-drift separation, reconciler coverage, and DML-baseline protections are all represented in tests.
- Quality-gate docs match package scripts and scanners for ESLint, API auth, action origin, public route rate limits, typecheck, build, Vitest, and Playwright.
- Storage docs match implementation: `CLAUDE.md` says the storage backend is not integrated and local filesystem is the only active product path; the quarantine test protects that boundary.
- Product scope docs match current inspected code: paid downloads/Stripe are removed, and no edit/culling/scoring feature is advertised as an active photographer workflow.
- Semantic production selection docs match settings behavior: production requires env/DB/weights/real embeddings and cannot be selected directly from the admin UI without satisfying those gates.

## Final Sweep

Checked for stale runbooks, overclaimed features, mismatched deployment instructions, undocumented schema constraints, source-contract drift, route-policy gaps, local-vs-remote storage confusion, and product-scope wording around search, similar photos, Lightroom upload, payment, and photo editing/culling/scoring. Aside from DOC-E-01, I did not find another current documentation/code mismatch with enough confidence to file as a finding. Residual risk is limited to live-production validation not covered by a read-only repo review: real CLIP weights, production DB size/performance, and host nginx state were not exercised.

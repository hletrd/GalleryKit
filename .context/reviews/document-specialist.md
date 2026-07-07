# Document Specialist Review - Cycle 8

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `eca55414`.
Mode: docs-vs-code review. Only this requested review artifact was written. No fixes, commits, pushes, deploys, service changes, or database/container mutations were performed.

## Inventory

Built the documentation/source inventory first, then verified claims against implementation:

- Canonical instructions: `AGENTS.md`, `CLAUDE.md`.
- Public/operator docs: `README.md`, `apps/web/README.md`, `apps/web/__test_fixtures__/color/README.md`.
- Historical/context docs: `.context/**`, `plan/**`, `docs/**` inventoried via full file listing and searched for deploy, schema, semantic-search, payment, storage, Lightroom, smart-collection, and operational-state claims; current high-signal docs/readmes were read directly.
- Environment/config: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`.
- Package/deploy/runtime: root `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Schema/migration: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration source-contract tests.
- Source checked for claims: semantic search and similar-photo routes/components/actions, CLIP scripts/libs, gallery config, upload paths, topic resource paths, analytics/GA CSP path, admin settings, Lightroom upload API, storage quarantine, removed payment/reaction schema cleanup.

Validation scope:

- Static/read-only review only. I did not run test suites because this lane was constrained to one review-file write and no container/database mutation. Evidence below is from direct source/doc inspection.

## Findings

### DOC-C8-01 - Operator semantic-search docs still understate the single-row embedding overwrite contract

- Severity: Medium
- Confidence: High
- Classification: confirmed
- Files/regions: `apps/web/README.md:64-74`, `CLAUDE.md:553-574`, `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/src/db/schema.ts:286-300`, `apps/web/scripts/backfill-clip-embeddings.ts:25-42,212-223`, `apps/web/src/app/actions/embeddings.ts:127-186`, `apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:140-190`

Evidence:

- The operator docs explain production activation, model-version filtering, scan limits, and repeated backfill runs (`apps/web/README.md:64-74`; `CLAUDE.md:553-574`).
- The storage schema allows only one embedding row per image: `image_embeddings.image_id` is the primary key in SQL and Drizzle (`apps/web/drizzle/0012_image_embeddings.sql:5-11`; `apps/web/src/db/schema.ts:286-300`).
- Both embedding writers upsert on that primary key and replace the vector plus `model_version` in place (`apps/web/scripts/backfill-clip-embeddings.ts:212-223`; `apps/web/src/app/actions/embeddings.ts:175-186`). The sidecar script comment documents this locally (`apps/web/scripts/backfill-clip-embeddings.ts:25-42`), but the operator runbook does not surface the rollout/rollback consequence.
- Readers filter by active/production model version (`apps/web/src/app/api/search/semantic/route.ts:270-279`; `apps/web/src/app/api/search/similar/[id]/route.ts:140-148,181-190`).

Failure scenario:

An operator reads the runbook as meaning multiple model-version embeddings can coexist while search selects the active one. They start a new production backfill, stop midway, then roll back or flip model state during troubleshooting. Rows already processed for the new version have overwritten prior vectors, while unprocessed rows still lack the new version. The model-version filter then creates partial recall in both directions, and rollback requires re-embedding affected images rather than changing a config value.

Suggested fix:

Update `apps/web/README.md` and the `CLAUDE.md` CLIP runbook to state: `image_embeddings` currently stores exactly one embedding per image; a production/stub/model-version backfill replaces any previous vector for that image; complete and verify a full backfill before relying on a new production model; rollback to a previous model version requires re-running a backfill for that target version. If coexistence is desired, document it only after a schema migration keys embeddings by `(image_id, model_version)`.

### DOC-C8-02 - Semantic-search docs blur text-search stub mode with production-only similar photos

- Severity: Low
- Confidence: High
- Classification: confirmed
- Files/regions: `README.md:48`, `apps/web/README.md:64-72`, `apps/web/src/app/api/search/semantic/route.ts:186-204`, `apps/web/src/app/api/search/similar/[id]/route.ts:115-130`, `apps/web/src/components/similar-photos.tsx:47-52,138-141`, `apps/web/src/components/search.tsx:519-552`

Evidence:

- Public docs describe semantic search as natural-language search plus `"similar photos"` and then describe modes as `disabled`, `stub`, and `production` without distinguishing that only text search has a stub demo path (`README.md:48`; `apps/web/README.md:64-72`).
- The text semantic-search API serves both `stub` and `production` (`apps/web/src/app/api/search/semantic/route.ts:186-204`), and the search UI shows the semantic toggle in stub/production with a stub disclaimer (`apps/web/src/components/search.tsx:519-552`).
- The similar-photo API is production-only and returns 503 outside production (`apps/web/src/app/api/search/similar/[id]/route.ts:115-130`).
- The similar-photo UI is hidden unless `semanticSearchMode === 'production'` (`apps/web/src/components/similar-photos.tsx:47-52,138-141`).

Failure scenario:

An admin/operator enables stub mode from Settings to validate semantic wiring and expects both documented semantic features to appear. Natural-language search appears with the disclaimer, but "Similar photos" is absent and the endpoint would 503 if called directly. The current wording makes this look like a setup failure even though the code is intentionally hiding an unsupported stub-mode feature.

Suggested fix:

Clarify the mode matrix in `README.md` and `apps/web/README.md`: `stub` is a text-search wiring demo only; "similar photos" is available only in production mode with real CLIP embeddings. Keep the current operator-gated production wording, but split text search and image-to-image recommendations in the feature/runbook language.

## Verified Aligned Areas

- Deploy docs match scripts: root `npm run deploy` loads `.env.deploy` or the fallback env file, refuses unsafe permissions, derives SSH command fields, runs the remote deploy script, pulls on host, builds with Compose, health-checks `/api/live`, then prunes Docker after the new web container is healthy.
- Docker persistence docs match Compose: `./data`, `./public/uploads`, `./public/resources`, and read-only `./src/site-config.json` are bind mounts; `site-config.json` imports are build-time-inlined and edits require rebuild/deploy.
- Quality-gate docs match package scripts for lint, API auth, action-origin, public-route rate-limit, typecheck, build, Vitest, and Playwright e2e.
- Migration guidance matches the current journal/postcondition design: journal/file parity, `when` cursor caveat, hash assertion, and `reconcileLegacySchema` coverage are represented in docs and tests.
- Product-boundary docs match current source for no payment/Stripe surface, no bundled Lightroom Classic plugin, local-filesystem-only storage, smart-collection public read side without admin UI, and no editing/culling/scoring workflow.
- Analytics docs match runtime: `site-config.json.google_analytics_id` drives script rendering and middleware CSP through `proxy.ts`; the `NEXT_PUBLIC_GA_ID` CSP helper default is not the live request path.

## Final Sweep

Checked stale runbooks, migration/deploy instructions, env examples, unsupported feature exposure, schema comments, historical docs, current docs, package scripts, and relevant implementation. I found two current documentation/code mismatches above. Residual risk is limited to live-host state that a repo-only review cannot prove: actual production DB rows/settings, seeded CLIP weight presence, deployed nginx/proxy state, and real semantic-search result quality on the running demo.

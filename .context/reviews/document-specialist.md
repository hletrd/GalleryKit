# Document Specialist Review - Cycle 9

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `ff0c79d6`.
Mode: documentation/code mismatch review. Only this requested review artifact was written. No application code, commits, pushes, deploys, service changes, database actions, or container mutations were performed.

## Inventory

I read the canonical documentation first, then built a repository inventory and checked documentation claims against the current implementation:

- Canonical instructions and project docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `apps/web/__test_fixtures__/color/README.md`.
- Docs and context corpus: `docs/**`, `.context/plans/**`, `.context/reviews/**`, and `plan/**` were inventoried and searched for review-relevant claims. Current high-signal plan/review artifacts and the latest aggregate files were read directly; archived historical artifacts were included in repo-wide drift searches.
- Full file inventory: 6,677 filesystem entries enumerated with review conclusions focused on source/docs/config while excluding vendor, build, upload, runtime data, and `.git` internals from source-of-truth analysis.
- Source/config inventory: 1,266 relevant files under `apps/web` source, scripts, migrations, e2e, tests, messages, config, deploy, and package areas were covered by targeted reads and repo-wide searches.
- Domains checked: setup, deploy, environment variables, security, migrations, semantic search, CLIP operator runbooks, image/color/HDR pipeline, storage, e2e, quality gates, and current unsupported-product boundaries.

Validation was static/read-only. I did not run the app or test suites because this review lane is documentation/source consistency only and the user explicitly requested no application-code changes. Evidence below comes from direct source and documentation inspection.

## Findings

### DOC-C9-01 - Semantic-search docs claim per-model embedding rows, but storage still overwrites one row per image

- Severity: Medium
- Confidence: High
- Classification: confirmed documentation/code mismatch
- Files/regions: `apps/web/README.md:64-75`, `CLAUDE.md:156-160`, `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/src/db/schema.ts:286-301`, `apps/web/scripts/backfill-clip-embeddings.ts:24-42,210-223`, `apps/web/src/app/actions/embeddings.ts:170-186`, `apps/web/src/lib/image-queue.ts:500-524`, `apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:137-190`

Why this is a mismatch:

- The current docs say `image_embeddings` stores one row per `(image_id, model_version)` and that queries filter by active `model_version` (`apps/web/README.md:72`; `CLAUDE.md:160`).
- The actual SQL and Drizzle schema still key the table only by `image_id`; `model_version` is a regular column plus a secondary scan index (`apps/web/drizzle/0012_image_embeddings.sql:5-11`; `apps/web/src/db/schema.ts:286-301`).
- Every current embedding writer inserts/upserts by that single-image primary key and replaces both `embedding` and `modelVersion` in place (`apps/web/scripts/backfill-clip-embeddings.ts:210-223`; `apps/web/src/app/actions/embeddings.ts:175-186`; `apps/web/src/lib/image-queue.ts:512-523`).
- Read paths then filter by active or production model version (`apps/web/src/app/api/search/semantic/route.ts:263-279`; `apps/web/src/app/api/search/similar/[id]/route.ts:137-190`). The code therefore cannot retain side-by-side embeddings for multiple model versions even though the docs now describe that as the storage contract.

Concrete failure scenario:

An operator trusts the runbook language and runs a stub or next-model backfill against the same database, expecting old and new model rows to coexist. Processed images have their previous production vector overwritten with the new model tag, while unprocessed images remain on the previous tag. If the operator flips back to production or rolls back model settings, model-version filters omit the overwritten images until a full production re-embed is run. This presents as partial semantic-search recall and missing similar-photo results, not as an obvious migration/setup error.

Suggested fix:

Choose one contract and make docs/code agree. The smaller documentation fix is to update `apps/web/README.md` and `CLAUDE.md` to say there is exactly one embedding row per image; changing semantic mode or model version rewrites the prior vector for that image; rollback to a prior model requires re-running a backfill for that target model. If side-by-side model storage is the intended product behavior, add a migration and code changes for a composite key or unique constraint on `(image_id, model_version)`, then update writers, cleanup, tests, and operator rollback language.

## Verified Aligned Areas

- Setup and environment docs match current examples and source for required app secrets, MySQL connection variables, `DB_SSL_CA`/`DB_SSL=false`, upload limits, admin credentials, rate-limit trust proxy, semantic mode controls, and deploy env-file fallback behavior.
- Deploy docs match `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, Compose mounts, health checks, and post-health Docker pruning. I found no hardcoded deploy host/key drift in docs or scripts.
- Security docs match current auth/session/origin/rate-limit lint gates, public API rate-limit policy, admin API wrapping expectations, public data omission guards, CSP/GA request path, and no-editing/no-culling product boundary.
- Migration docs match the current journal/file parity, strictly increasing `when` warning, post-condition hash assertion, DML-baseline guard, and `reconcileLegacySchema` coverage.
- Semantic-search docs now correctly separate stub text-search behavior from production-only similar-photo recommendations, except for the embedding-row cardinality issue above.
- Image/color/HDR docs match the current derivative-impacting keys, pipeline version, hash length, AVIF/JPEG quality defaults, HDR ingest default, wide-gamut guardrails, and color-chip fixture intent.
- Storage docs match the current quarantine: local filesystem paths remain the live pipeline; `src/lib/storage` is not integrated outside storage tests.
- E2E docs match the current Playwright/server safety gates: Chromium-only project, local safe DB assertion before init/seed/build, and remote-admin e2e blocking unless explicitly enabled.
- Quality gate docs match current package scripts for ESLint, API auth lint, action-origin lint, public-route rate-limit lint, typecheck, build, Vitest, and Playwright e2e.

## Final Sweep

I performed final drift searches for commonly missed mismatches: stale Stripe/payment language, Lightroom plugin bundling, S3/MinIO support, smart-collection admin UI, editing/culling/scoring claims, `image_embeddings` cardinality, model-version filtering, DB SSL handling, deploy env fallback, nginx/body-limit behavior, GA/CSP placement, migration journal rules, color/HDR settings, privacy-sensitive fields, e2e safety, and quality-gate script names.

Confirmed finding count: 1. No additional confirmed documentation/code mismatches were found in the required domains. Residual risk is limited to live external state that a repo-only static review cannot prove: actual production DB rows, seeded CLIP model files, production nginx/host config, secret values, and real semantic-search quality on deployed data.

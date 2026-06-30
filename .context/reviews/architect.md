# Cycle 31 Architect Review

Reviewer: architect
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `f1dd39ebb9c2acde2a4dce5974e6cd1fada6f9aa`
Date: 2026-06-30 KST
Scope: architecture, coupling, layering, schema/migration contracts, deploy topology, and docs/source consistency. No product code was edited.

## Inventory

Inventoried current HEAD first, then inspected the architecture surfaces most likely to drift:

- Tracked files: 2612 total; 525 under `apps/web/src`; 276 Vitest test files; 8 e2e/support files.
- Governance/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`.
- Data/schema: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, migration/reconcile tests.
- Deployment/runtime: root `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Boundaries: public/admin API routes, server actions, upload/processing/storage helpers, restore maintenance, CLIP semantic search, public data selectors, storage quarantine tests.

## Findings

### C31-ARCH-01: Semantic retrieval still does brute-force vector scoring on the public request path

Severity: Medium
Confidence: High
Failure mode: scalability, recall, and request-latency coupling

Exact regions:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/app/api/search/semantic/route.ts:263-311`
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`
- Docs acknowledge the same design at `README.md:42` and `CLAUDE.md:553-557`

Evidence:

`SEMANTIC_SCAN_LIMIT` defaults to 2000 and can be raised to 25000. Both semantic text search and similar-photo search select the newest matching embeddings from MySQL, decode every embedding in the Next.js process, compute a score in JavaScript, and then run `topK`.

Concrete failure scenario:

Once production embeddings exceed the scan cap, relevant older photos are outside the candidate set and cannot be returned. If an operator raises the cap to recover recall, every public semantic/similar request can read and score thousands of 512-dim vectors on the web request thread, competing with gallery browsing, uploads, DB restore maintenance, queue work, and the single MySQL writer. Same-origin plus per-IP limits cap abuse, but they do not decouple this CPU/DB work from request latency or general app capacity.

Concrete fix:

Treat production semantic search as needing a search-owned boundary before larger galleries or higher traffic: a vector index/service, database-native vector index if available, precomputed candidate partitions, or a background-built candidate table keyed by model version and common filters. Add an operator-visible warning or test/health assertion when `COUNT(image_embeddings WHERE model_version = active)` exceeds `SEMANTIC_SCAN_LIMIT`, because the current result set is explicitly newest-window recall rather than corpus-wide recall.

## No-Finding Areas

- Storage: cycle-30's dormant storage-abstraction risk is now guarded by `apps/web/src/__tests__/storage-quarantine.test.ts:1-27` and `:111-142`, which fails if live source imports `@/lib/storage` without an intentional contract change. The current prose in `CLAUDE.md:149` also keeps it quarantined.
- Schema/migration: `migrate.js` mirrors tables, columns, indexes, dropped schema, and post-condition hash checks in `apps/web/scripts/migrate.js:317-713` and `:759-819`; test coverage includes migration journal monotonicity and reconcile coverage.
- Deployment: root deploy routing, host script, compose, nginx body caps, liveness, and Docker pruning align across `AGENTS.md:15-20`, `README.md:185-203`, `scripts/deploy-remote.sh:31-85`, `apps/web/deploy.sh:28-85`, `apps/web/docker-compose.yml:15-28`, and `apps/web/nginx/default.conf:91-163`.
- Public/admin route layering: admin API routes are under `api/admin/**`; public expensive routes carry rate limits or explicit exemptions; server-action origin and API auth gates are documented and backed by lint/test scripts.
- Privacy/data projection: public select boundaries remain explicit and test-pinned; no new schema column was found missing from the documented admin-only checklist in this review pass.

## Final Missed-Issue Sweep

Sweep terms included: migration journal, reconcile, deploy, Docker prune, volume prune, site config, health/live, public route rate limit, storage, semantic, CLIP, Lightroom, Stripe, Firefox, dynamic-range, color-gamut, schema line refs, and `.context` consistency.

Skipped: live production deploy, remote database inspection, full browser e2e, and full lint/typecheck/test gates. This was a review lane; no product code edits were made.

Conclusion: one current architecture issue was promoted. I did not find a fresh high/critical architecture, layering, migration, or deployment defect in current HEAD.

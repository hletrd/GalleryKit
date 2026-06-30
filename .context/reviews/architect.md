# Cycle 32 Architect Review

Reviewer: architect
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `3d174c96816bb87e6434f47cbda8dfea9c05ee19`
Date: 2026-06-30 KST
Scope: architecture/design risks, coupling, layering, data-boundary correctness, runtime topology, migration/deploy architecture, and long-term maintainability across the full repo. No product code or sibling review files were edited.

## Inventory

Inventoried first, then inspected the repo surfaces most likely to drift across architecture boundaries:

- Current source footprint: 527 files under `apps/web/src`, 276 top-level Vitest test files under `apps/web/src/__tests__`, and 8 files under `apps/web/e2e`.
- Governance/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, prior architect reviews under `.context/reviews/**`.
- Data/schema/migration: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, migration/reconcile tests.
- Runtime/deploy: root `package.json`, `package-lock.json`, `.github/workflows/quality.yml`, `.github/dependabot.yml`, `scripts/deploy-remote.sh`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Boundaries and state: admin/public API routes, server actions, upload and image processing queue, restore maintenance, advisory locks, rate limits, semantic search, dormant storage abstraction, service worker/cache policy, CLIP sidecar scripts.

## Findings

### C32-ARCH-01: Docker production build is not gated, but the Dockerfile carries manually synchronized native package pins

Severity: Medium
Confidence: High
Failure mode: CI green, production deploy fails or ships mismatched native binaries

Exact regions:

- `apps/web/Dockerfile:49-61`
- `.github/workflows/quality.yml:48-80`
- `apps/web/package.json:55-66`

Evidence:

The Docker dependency stage runs `npm ci`, then manually installs platform-specific native packages with hard-coded versions: Sharp/libvips, Parcel watcher, SWC, Next SWC, and Lightning CSS at `apps/web/Dockerfile:55-61`. The app dependency versions that drive those transitive/native packages remain semver-ranged in `apps/web/package.json:55-66`. CI installs dependencies, runs lint/typecheck/tests/e2e, and runs `npm run build`, but it never builds the Docker image that production actually deploys (`.github/workflows/quality.yml:48-80`).

Concrete failure scenario:

A routine Next, Sharp, SWC, or Lightning CSS upgrade passes local npm gates and GitHub Actions because the non-Docker build resolves a coherent root lockfile graph. The Dockerfile still injects stale native package pins with `--no-save`, so the deploy-only `docker compose ... up -d --build` path can fail during `next build`, fail at runtime loading native bindings, or build against native packages that no longer match the package graph. Because this project has no staging environment and `npm run deploy` is the per-iteration path, the first Docker-only signal is production deployment.

Concrete fix:

Add a Docker build gate to CI, for example `docker build -f apps/web/Dockerfile .` for at least the deployment architecture, and keep it near the existing `Build` step. Then remove or mechanize the hard-coded native package versions: derive them from `package-lock.json`, pin them through normal dependencies/overrides, or add a source test that compares the Dockerfile native pins against the lockfile-resolved versions.

### C32-ARCH-02: Dependabot is pointed at the workspace directory, but the canonical npm lockfile and overrides live at the repository root

Severity: Medium
Confidence: High
Failure mode: dependency automation watches the wrong graph boundary

Exact regions:

- `.github/dependabot.yml:1-18`
- `package.json:1-10`
- `package-lock.json:1-14`

Evidence:

The npm update entry uses `directory: /apps/web` (`.github/dependabot.yml:3-12`). This is an npm workspace repo: the root `package.json` declares `workspaces: ["apps/*"]` and root-level `overrides` (`package.json:1-10`), and the only committed `package-lock.json` is at the repository root with an `apps/web` package entry (`package-lock.json:1-14`). There is no `apps/web/package-lock.json`.

Concrete failure scenario:

Dependabot may not update the actual reviewed dependency graph, or it may miss root-level override pressure entirely. Security and maintenance updates for dependencies resolved through the root lockfile can be delayed while CI and Docker continue installing from that root lockfile. This is especially risky here because the deploy Dockerfile also has native package synchronization requirements.

Concrete fix:

Change the npm Dependabot entry to `directory: /` so it updates the workspace root lockfile and root overrides. If there is a reason to keep app-level monitoring too, add it as a second entry only after confirming GitHub Dependabot supports the intended workspace behavior for this repo shape. Add a lightweight CI/source assertion if desired: fail when `package-lock.json` exists at root but Dependabot's npm directory is not `/`.

### C32-ARCH-03: Advisory locks are globally named for one MySQL server, making accidental multi-instance or shared-server deployments cross-couple tenants

Severity: Low
Confidence: High
Failure mode: runtime topology coupling across databases or deployments sharing one MySQL server

Exact regions:

- `apps/web/src/lib/advisory-locks.ts:8-15`
- `apps/web/src/lib/advisory-locks.ts:18-47`
- `apps/web/src/__tests__/advisory-locks.test.ts:32-45`
- `CLAUDE.md:234-237`

Evidence:

The code documents that MySQL advisory locks are server-scoped, not database-scoped, and warns to run one GalleryKit per MySQL server or prefix lock names (`apps/web/src/lib/advisory-locks.ts:8-15`). The actual lock constants are fixed global strings (`apps/web/src/lib/advisory-locks.ts:18-47`), and tests pin those literal values (`apps/web/src/__tests__/advisory-locks.test.ts:32-45`). The runtime topology docs also state the shipped deployment is single web-instance/single-writer and should not be horizontally scaled without moving process-local coordination state (`CLAUDE.md:234-237`).

Concrete failure scenario:

An operator adds a second GalleryKit database on the same MySQL server, or adapts the compose deployment to another host/orchestrator while reusing the same MySQL service. A restore, backfill, topic route mutation, upload-processing contract change, admin deletion, or image-processing claim in one deployment serializes or blocks the other deployment even though the databases are separate. The symptoms look like random `restoreInProgress`, lock timeout, or stalled maintenance in the unaffected gallery.

Concrete fix:

Introduce an instance namespace for advisory locks, for example `GALLERYKIT_INSTANCE_ID` with a safe default derived from `DB_NAME`, and construct every lock through one helper that enforces MySQL's advisory-lock length limit. Update the advisory-lock tests to pin namespace behavior rather than global literals. If the project intentionally wants to keep the current one-instance-per-MySQL contract, add a startup/deploy assertion that makes the constraint explicit in runtime configuration instead of relying on comments.

### C32-ARCH-04: Production semantic retrieval is still a newest-window brute-force scan on the public request path

Severity: Medium
Confidence: High
Failure mode: recall and latency couple directly to request-time DB/CPU work

Exact regions:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/app/api/search/semantic/route.ts:263-311`
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`
- `README.md:42`
- `CLAUDE.md:553-557`

Evidence:

`SEMANTIC_SCAN_LIMIT` defaults to 2000 and can be raised to 25000 (`apps/web/src/lib/clip-embeddings.ts:36-44`). Both semantic text search and similar-photo search select the most recent matching embeddings from MySQL, decode each vector in the Next.js process, score them in JavaScript, and then run `topK` (`apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`). The docs are honest that this is a bounded newest-first scan, not a vector index (`README.md:42`, `CLAUDE.md:553-557`).

Concrete failure scenario:

Once production embeddings exceed the scan cap, relevant older photos are outside the candidate set and cannot be returned. If an operator raises the cap to recover recall, each public semantic or similar request can read and score thousands of 512-dimensional vectors on the web process, competing with gallery browsing, uploads, queue work, DB restore maintenance, and the single MySQL writer. Same-origin checks and per-IP limits cap abuse, but they do not decouple retrieval CPU/DB work from request latency.

Concrete fix:

Before marketing semantic search as corpus-wide for larger galleries, move retrieval behind a search-owned boundary: database-native vector index if available, a sidecar vector service, precomputed candidate partitions, or a background-built candidate table keyed by model version and filters. Add an operator-visible warning or health check when `COUNT(image_embeddings WHERE model_version = active)` exceeds `SEMANTIC_SCAN_LIMIT`, because current results are newest-window recall.

## No-Finding Areas

- Privacy/data projection: `publicSelectFields`, `publicMapSelectFields`, `PrivacySensitiveKeys`, and sibling search/timeline selectors remain explicit and test-pinned. I did not find a current public selector leaking the admin-only schema fields called out in `AGENTS.md`/`CLAUDE.md`.
- Migration/deploy schema safety: `migrate.js` has hash-based postconditions, legacy reconcile coverage, index coverage, drop tripwires, and monotonic journal tests. I did not find a new migration missing its reconcile mirror.
- Dormant storage abstraction: `@/lib/storage` remains quarantined by docs and `storage-quarantine.test.ts`; no live upload/processing/serving path imports it in this pass.
- Admin/public route layering: admin API routes use the auth wrapper pattern; mutating server actions and expensive public API routes are backed by lint gates and source tests. I did not promote a fresh route-boundary finding.
- Nginx body caps: the initially suspicious dashboard-upload path is valid: unauthenticated `/admin` redirects authenticated users to `/admin/dashboard`, and the protected upload UI lives under that dashboard segment.

## Final Sweep

Final sweep terms included: `GET_LOCK`, advisory lock, restore maintenance, upload tracker, `publicSelectFields`, `PrivacySensitiveKeys`, `reconcileLegacySchema`, migration journal, Dockerfile native pins, Dependabot, workspace lockfile, `serverExternalPackages`, `SEMANTIC_SCAN_LIMIT`, `@/lib/storage`, nginx body caps, site config, and production deploy.

Validation evidence: read `AGENTS.md` and full `CLAUDE.md`; inventoried source/docs/tests; inspected current source line citations above; checked existing dirty review files and left them untouched. Skipped live production deploy, remote DB inspection, and full lint/typecheck/test/e2e gates because this was a review artifact lane with no code changes.

Conclusion: no critical/high architecture defect found in current HEAD. Four actionable medium/low risks remain, mostly around production automation and future scaling boundaries.

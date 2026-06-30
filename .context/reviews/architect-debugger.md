# Cycle 33 Architect + Debugger Review

Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `168c38378061320f4192dad05ee6910cfd5b44e1`
Date: 2026-06-30 KST
Scope: full-repo architecture/design boundaries, coupling, layering, latent bug surface, failure modes, regressions, state consistency, and cross-module invariants. App/source files were not edited.

## Inventory

Inventoried before inspection:

- Governance/context: `AGENTS.md`, `CLAUDE.md`, root/package metadata, `.github/**`, prior `.context/reviews/**` and `.context/plans/**` artifacts.
- Runtime/deploy: `.github/workflows/quality.yml`, `.github/dependabot.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`.
- Data/schema/migrations: `apps/web/src/db/**`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`.
- Public/admin boundaries: all `apps/web/src/app/**` route handlers and server actions, `proxy.ts`, auth/session/API wrappers, public route rate-limit scanner.
- Stateful/failure-prone subsystems: image upload/delete/queue/retry/backfill, restore maintenance, advisory locks, upload tracker, shared-group view buffer, semantic search/CLIP, feeds/OG/sitemap, health/live routes.
- Current-cycle changed regions since cycle 32: Dependabot root boundary, load-more transient backoff, listing lookahead clamp, Atom feed content ETags, bulk tag validation, CLIP inference slot ownership, privacy docs.

Validation run:

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- --run src/__tests__/load-more-source-contracts.test.ts src/__tests__/smart-collection-pagination.test.ts src/__tests__/semantic-scan-limit-source.test.ts src/__tests__/health-route.test.ts` passed: 4 files, 27 tests.

## ARCHITECT

### ARCH-C33-01 - MEDIUM - CI still does not build the production Docker image

Severity: Medium
Confidence: High
Code regions: `.github/workflows/quality.yml:48-80`, `apps/web/Dockerfile:49-61`, `package-lock.json` native optional package entries

The CI workflow installs dependencies, runs lint/typecheck/unit/e2e, and executes `npm run build`, but it never runs `docker build` for the image that production deploys. The Dockerfile has a deployment-specific native-binary workaround: after `npm ci --workspace=apps/web --include=optional`, it manually installs Linux native packages for Sharp/libvips, Parcel watcher, SWC, Next SWC, and Lightning CSS at exact versions (`apps/web/Dockerfile:55-61`). The current pins match the lockfile, but that matching is not enforced by CI.

Concrete failure scenario: a dependency update changes Next/SWC/Sharp/Lightning CSS native package versions. The normal CI build stays green because it uses the workspace install graph. The Docker build path still injects stale native packages with `--no-save`, so production deploy is the first place to see a missing native binding, incompatible binary, or build-only failure.

Suggested fix: add a CI step that builds the production image, for example `docker build -f apps/web/Dockerfile .`, at least for the deployment architecture. Add a lightweight source/lockfile assertion that the Dockerfile's native package pins match `package-lock.json`, or derive those versions from the lockfile during the Docker build instead of duplicating them manually.

### ARCH-C33-02 - MEDIUM - Semantic retrieval is a request-time newest-window scan, not a corpus-wide search boundary

Severity: Medium
Confidence: High
Code regions: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`

`SEMANTIC_SCAN_LIMIT` defaults to 2000 and can be raised to 25000. Both semantic text search and similar-photo search query only the newest embeddings by `image_embeddings.updated_at`, decode and score those vectors in the Next.js process, and then rank with `topK`. This is correctly bounded for CPU/DB protection, but architecturally it means production semantic search is only a newest-window search once the embedded corpus is larger than the cap.

Concrete failure scenario: a gallery has 8000 embedded images and an older, highly relevant image sits outside the newest 2000 embeddings. The user searches for that concept or opens similar photos from a related image. The row is never read, so it cannot rank regardless of similarity. Raising the cap improves recall at the cost of public request latency, event-loop pressure, DB transfer, and GC work.

Suggested fix: introduce a search-owned retrieval boundary before presenting this as corpus-wide at scale: database-native vector index, sidecar vector service, partitioned candidate tables, or a background-maintained ANN index keyed by model version and filters. Until then, surface an operator warning when active embeddings exceed `SEMANTIC_SCAN_LIMIT`.

### ARCH-C33-03 - LOW - Advisory lock names are globally scoped to one MySQL server

Severity: Low
Confidence: High
Code regions: `apps/web/src/lib/advisory-locks.ts:8-15`, `apps/web/src/lib/advisory-locks.ts:18-47`

The advisory-lock registry correctly documents that MySQL advisory locks are server-scoped, not database-scoped, but the lock names are fixed global strings such as `gallerykit_db_restore`, `gallerykit_color_pipeline_backfill`, and `gallerykit_semantic_embedding_backfill`. Per-image locks also use a fixed `gallerykit:image-processing:${jobId}` namespace.

Concrete failure scenario: an operator runs two GalleryKit databases against the same MySQL server. A restore, backfill, upload-processing contract change, admin delete, topic route mutation, semantic backfill, or image-processing claim in one gallery can block or serialize the other even though their schemas are separate.

Suggested fix: namespace every advisory lock through one helper, e.g. `GALLERYKIT_INSTANCE_ID` with a safe default derived from `DB_NAME`, and enforce MySQL's lock-name length limit there. If the product intentionally keeps "one GalleryKit per MySQL server" as a hard topology constraint, add a startup/deploy assertion so the runtime contract is explicit.

## DEBUGGER

### DBG-C33-01 - MEDIUM - Semantic and similar search silently miss older relevant photos beyond the scan window

Severity: Medium
Confidence: High
Code regions: `apps/web/src/lib/clip-embeddings.ts:43-44`, `apps/web/src/app/api/search/semantic/route.ts:270-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:168-201`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-76`

Root cause: both public embedding routes apply `.orderBy(desc(imageEmbeddings.updatedAt)).limit(SEMANTIC_SCAN_LIMIT)` before scoring. The source-contract test intentionally locks the cap in place, but there is no runtime/user-visible indication that results are incomplete after the corpus exceeds the window.

Concrete failure scenario: after a production backfill, old vacation photos have excellent similarity to a query but their `updated_at` values fall outside the newest scan window. Searches return newer weaker matches or no matches. This looks like a relevance bug, not an obvious operational cap, and it will not reproduce in small test fixtures.

Suggested fix: same architectural fix as `ARCH-C33-02`; from a debugger perspective, also add an explicit metric/log branch when `rows.length === SEMANTIC_SCAN_LIMIT` so production support can correlate poor recall with a saturated scan window.

### DBG-C33-02 - LOW - Optional DB health probe is unauthenticated and unthrottled when enabled

Severity: Low
Confidence: Medium
Code regions: `apps/web/src/app/api/health/route.ts:7-31`, `apps/web/src/__tests__/health-route.test.ts:42-69`

Root cause: `/api/health` carries an explicit public rate-limit exemption. In default mode it returns liveness only. When `HEALTH_CHECK_DB=true`, every unauthenticated request executes `SELECT 1` before returning `ok` or `unavailable`.

Concrete failure scenario: an operator enables DB-aware readiness while leaving `/api/health` internet-reachable. A crawler or monitor loop turns a cheap public GET into sustained DB pool traffic, especially noisy during DB outages when readiness checks are already failing.

Suggested fix: keep DB health disabled unless the route is network-restricted, or add a tiny in-process TTL cache around the DB probe so repeated public hits reuse the same result for one or two seconds. If public readiness is required, replace the exemption with a small pre-increment rate limit.

## Current-Cycle Candidates Checked

- Cycle 32 load-more spin finding is fixed: `apps/web/src/components/load-more.tsx:43-99` now has `transientRetryAfterRef`, and `apps/web/src/__tests__/load-more-source-contracts.test.ts:18-23` locks the retry cooldown.
- Cycle 32 Dependabot workspace finding is fixed: `.github/dependabot.yml:3-12` now watches npm at `directory: /`.
- Listing lookahead clamping is fixed and locked: `apps/web/src/lib/data.ts:910-928` and `apps/web/src/lib/data.ts:1442-1481` normalize page size before `+ 1`; targeted smart-collection tests passed.
- CLIP inference slot ownership is fixed and source-locked: `apps/web/src/lib/clip-model.ts:147-170`, `apps/web/src/__tests__/clip-model-contract.test.ts:42-57`.
- Feed settings-only stale 304 regression is fixed for ETag clients: root and topic feeds hash rendered XML before returning 304 (`apps/web/src/app/feed.xml/route.ts:151-179`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:158-185`).
- Bulk tag edits now reject invalid tag changes before mutation in the current cycle; no new cross-boundary finding was promoted from that region.

## Final Sweep

Searched and inspected around: `GET_LOCK`, advisory locks, restore maintenance, upload tracker, public selectors, privacy guards, `reconcileLegacySchema`, migration journal, Dockerfile native pins, Dependabot/workspace lockfile, public route rate-limit exemptions, semantic scan limits, load-more cursors, Atom feed validators, CLIP queue ownership, and recent cycle-32/33 review plans.

No critical/high defect was found in the current HEAD during this lane. The remaining actionable items are medium/low operational and scaling risks, not immediate source regressions. Full lint/typecheck/build/e2e were not rerun because this lane only wrote a review artifact; the targeted scanner/tests above passed.

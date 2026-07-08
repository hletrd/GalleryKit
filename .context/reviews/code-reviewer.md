# Cycle 38 Code Reviewer Report

Date: 2026-07-08 KST
Role: cycle-38 code-reviewer
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `54083a2c` on `master`
Scope: whole-repository code quality, logic, SOLID/maintainability, and correctness review. No production-code edits.

## Provenance And Inventory

Read first, per instruction: `AGENTS.md`, `CLAUDE.md`, and `/Users/hletrd/.agents/skills/code-review/SKILL.md`.

Inventory built before reviewing:

- `rg --files` inventory excluding ignored build/runtime output reported 939 repository files.
- Review-relevant tracked implementation inventory: 708 tracked files under `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`.
- App Router surface reviewed: localized public pages, admin pages, server actions, public/admin route handlers, upload fallbacks, OG/search APIs, health/live routes, sitemap/robots/manifest.
- Core cross-file clusters reviewed: auth/session/PAT wrappers, same-origin/action barriers, public route rate-limit scanners, restore-maintenance fences, upload/processing/delete cleanup, image queue, admin and sidecar backfills, semantic search/CLIP, migrations/reconcile, privacy projections, map/GPS exposure, config/settings, service worker/cache, Docker/nginx/deploy scripts, tests and static gates.
- Prior-cycle context checked to avoid duplicate stale findings: existing `.context/reviews/code-reviewer.md`, `.context/reviews/_aggregate.md`, recent `git log`, and recent cycle-37 fix history.

Ignored or non-relevant files not reviewed as code: `node_modules`, `.next`, build/cache/runtime output, historical `.omx`/`.omc` orchestration state, binary fixtures/screenshots/media, and old `.context` archives except where used as prior-review context. No tracked review-relevant app/script/migration/test/config category was intentionally skipped. Two ignored local residue files exist under the app tree (`find` count 710 vs tracked count 708); they were not treated as repository findings because `git status` is clean and `.gitignore` covers them.

## Confirmed Issues

### CR38-01 - Upload queue and in-app color backfill independently reserve the same DB pool

- Severity: High
- Confidence: High
- Classification: confirmed design/resource-budget issue
- Region: `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/instrumentation.ts:7-10`
- Failure scenario: the image queue caps itself against the 10-connection pool by reserving half for live traffic, while the admin backfill runner applies a separate half-pool reservation to the same pool. Both are started by the same web process. If uploads are processing while an in-app re-encode backfill runs, the two locally valid budgets can overlap and consume most of the shared MySQL pool and Sharp/libvips CPU, making foreground pages queue behind background work.
- Concrete fix: introduce one process-wide background resource coordinator/weighted semaphore for queue workers, in-app color backfill, semantic embedding work, maintenance, and async analytics writes. Gate long-running DB/CPU background lanes through that shared budget, and add an overlap regression proving queue + backfill still leaves a foreground DB acquisition within the reserved live budget.

### CR38-02 - The tracked production `site-config.json` can ship Atik metadata in another operator's build

- Severity: Medium
- Confidence: High
- Classification: confirmed config/distribution correctness issue
- Region: `apps/web/src/site-config.json:2-10`; `apps/web/src/site-config.example.json:2-12`; `apps/web/scripts/ensure-site-config.mjs:23-42`; `README.md:60-77`
- Failure scenario: `site-config.json` is tracked with `https://gallery.atik.kr`, `Atik Gallery`, and `Atik` author/footer values. The production guard rejects placeholders but accepts these real values. A self-hosting operator who clones/builds without replacing the file can emit canonical URLs, OpenGraph metadata, sitemap origins, and footer text for the demo owner. README warns users to check the file, but the build still silently accepts the wrong real origin.
- Concrete fix: stop tracking the real deployment config; track only the example/placeholder file and require a generated/local `site-config.json`, or add a production guard that rejects the Atik demo origin unless an explicit Atik deployment opt-in env var is set. Keep `BASE_URL` as the intended production override path.

## Likely Issues / Design Risks

### CR38-03 - Public map still builds up to 10,000 markers plus a 10,000-item fallback list in one render

- Severity: Medium
- Confidence: High
- Classification: likely performance/UX correctness risk
- Region: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-111`; `apps/web/src/components/map/map-client.tsx:88-142`
- Failure scenario: a large public-GPS gallery opens `/map` on a mid-range phone. The server serializes up to 10,000 marker rows, React renders a Leaflet marker/popup tree for each one, and the page also renders a 10,000-link accessible fallback list. `FitBounds` also allocates separate latitude/longitude arrays and spreads them. The cap prevents unbounded results, but the capped path is still large enough to freeze mobile interaction or inflate SSR/RSC payloads.
- Concrete fix: switch to clustering or viewport/bbox paging, lower the initial render budget substantially, and compute bounds in a single loop. Keep the accessible list, but paginate/virtualize it or scope it to the visible/clustered subset.

### CR38-04 - Public map query filters GPS visibility without a map-specific index

- Severity: Medium
- Confidence: Medium
- Classification: likely DB-performance risk needing production-cardinality validation
- Region: `apps/web/src/lib/data.ts:1784-1802`; `apps/web/src/db/schema.ts:123-132`; `apps/web/drizzle/meta/_journal.json:1-188`
- Failure scenario: `getMapImages()` filters `images.processed = true`, `topics.map_visible = true`, and `images.latitude/longitude IS NOT NULL`, then orders by capture/created/id. Current `images` indexes cover processed/topic/feed patterns, but none starts with the GPS non-null predicates or map visibility route shape. On a large gallery where most processed rows lack public GPS, MySQL may scan many processed rows for every uncached `/map` request before rejecting them.
- Concrete fix: collect `EXPLAIN ANALYZE` on production-like cardinality. If confirmed, add a map-specific index, mirror it in a new migration, update `reconcileLegacySchema`, and add an index-contract test.

### CR38-05 - Live semantic embedding bootstrap does not observe the sidecar backfill lock

- Severity: Medium
- Confidence: High
- Classification: likely capacity/ownership risk
- Region: `apps/web/src/lib/image-queue.ts:501-539`; `apps/web/src/lib/image-queue.ts:542-637`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-130`; `apps/web/src/lib/clip-model.ts:53-173`
- Failure scenario: the semantic sidecar and admin action coordinate with `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, but live upload embedding and `bootstrapMissingActiveEmbeddings()` do not check that lock. The upsert/model-version contract prevents duplicate-row corruption, so this is not data loss. The failure mode is duplicated ONNX inference and DB work during a large sidecar run, filling the CLIP inference queue and delaying public semantic requests or live upload side effects.
- Concrete fix: make live embedding paths skip/defer while the semantic backfill advisory lock is held, or centralize all embedding writers behind one lease/queue with a shared admission limit. Add an overlap test proving sidecar backfill and live bootstrap cannot run unbounded inference concurrently.

## Manual-Validation Risks

### RISK38-01 - Single-writer guard is warn-only and starts after process-local schedulers

- Severity: Medium
- Confidence: High
- Classification: manual topology risk
- Region: `apps/web/src/instrumentation.ts:7-10`; `apps/web/src/instrumentation.ts:22-31`; `apps/web/src/lib/single-writer-guard.ts:6-21`; `apps/web/src/lib/single-writer-guard.ts:218-235`; `apps/web/src/lib/single-writer-guard.ts:277-310`
- Failure scenario: a second web process can start the maintenance scheduler and bootstrap image queue before the singleton guard logs. If the guard detects another holder, it explicitly continues startup. That is consistent with current docs, but it means restore fences, in-memory upload quotas, buffered view counts, rate-limit fast paths, and process-local background state are still unsafe under accidental scale-out.
- Concrete fix: for production, acquire/await the singleton guard before process-local schedulers start and fail closed on persistent contention, or move the affected coordination state to shared storage and keep the guard explicitly informational.

### RISK38-02 - Edge/client-IP limiter correctness still requires live proxy proof

- Severity: Medium
- Confidence: High
- Classification: manual deployment validation risk
- Region: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:274-307`; `scripts/check-proxy-topology.mjs:7-16`; `scripts/check-proxy-topology.mjs:102-134`; `CLAUDE.md:248-260`
- Failure scenario: the committed nginx template rate-limits dynamic public pages at the edge, but deploys do not apply host nginx config. In LB/CDN-fronted deployments, `$binary_remote_addr` can also be the proxy address unless real-IP/PROXY protocol is configured, collapsing visitors into one limiter bucket. The provided proxy check proves forwarded host/proto spoof resistance, and explicitly does not prove effective client-IP bucketing.
- Concrete fix: record live `nginx -t`, reload, burst-429 proof, normal-page non-429 proof, and effective-client-IP evidence from edge logs or a diagnostic endpoint for every production proxy topology.

## Positive Checks

- Admin API auth scanner passed for both admin route handlers.
- Server-action same-origin and restore-mutation barrier scanner passed across action files and `db-actions.ts`.
- Public route rate-limit scanner passed across public route handlers.
- Previous cycle's Lightroom restore-drain issue appears fixed: `apps/web/src/app/api/admin/lr/upload/route.ts:255-289` now acquires the mutation slot after multipart parsing and re-checks restore state before the mutation window.
- Previous cycle's Map/Timeline discovery split is mostly fixed: nav, footer, and sitemap now read `showTimelineNav` / `showMapNav`; targeted sitemap/settings tests pass.
- Previously tracked Playwright run-state issue is not present in `git ls-files`.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm run audit:prod` - passed, 0 vulnerabilities.
- `npm test --workspace=apps/web -- --run src/__tests__/sitemap-robots.test.ts src/__tests__/settings-hash.test.ts src/__tests__/settings-semantic-mode-action.test.ts src/__tests__/map-privacy.test.ts src/__tests__/map-get-images-behavior.test.ts src/__tests__/image-queue-concurrency-cap.test.ts src/__tests__/admin-backfill-concurrency-cap.test.ts src/__tests__/lr-upload-route-behavior.test.ts src/__tests__/restore-upload-lock.test.ts` - 9 files passed, 84 tests passed.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts` - 7 files passed, 331 tests passed.
- `git diff --check` - passed before writing this file.
- `npm run check:proxy-topology` - not runnable without `--url`; exited with "Missing --url".

Not run: full `npm test`, `npm run build`, Playwright e2e, production deploy, live nginx reload/probes, production CLIP preflight, production-sized map `EXPLAIN ANALYZE`, or upload/backfill overlap load tests.

## Final Sweep

Swept issue classes: auth wrapper drift, server-action origin/barrier drift, public route rate-limit gaps, privacy projection leaks, tracked secrets/runtime artifacts, migration journal monotonicity and reconcile coverage, raw SQL/file-IO hazards, restore/upload races, queue/backfill resource overlap, semantic-search ownership, map/GPS exposure, config distribution, service worker/cache contracts, Docker/nginx deploy assumptions, and recent cycle-37 regression areas.

No additional high-confidence blocking defects surfaced beyond the confirmed issues above. Remaining risk is concentrated in production topology/load behavior rather than local type/lint/unit correctness.

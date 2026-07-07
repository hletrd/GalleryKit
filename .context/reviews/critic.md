# Cycle 20 Critic Review

Date: 2026-07-08 KST
Role lane: critic
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: review-only. No source fixes, commits, pushes, deploys, or unrelated file edits performed.

## Inventory

Authority and context read first: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, the cycle-20 plan/deferred files, current peer review files, and the `code-review` skill instructions.

Tracked inventory was built from `git ls-files`, `rg --files`, package/config inspection, and targeted line-number reads. The tracked repository currently contains 3,511 files, including 543 `.ts`, 111 `.tsx`, 30 SQL migrations, 9 `.mjs`, 6 `.js`, 22 `.json`, 4 workflow YAML files, Docker/Compose/nginx/deploy assets, 363 unit-test files under `apps/web/src/__tests__`, and Playwright specs under `apps/web/e2e`.

Review-relevant surfaces examined:

- Product/public routes: home, topic, photo, share/group, smart collection, map, timeline/year, search, uploads, OG, feed, sitemap, manifest, service worker.
- Admin routes/actions: dashboard, image manager, topics/tags/settings/SEO/users/tokens/password, backup/restore, browser upload, PAT upload.
- Core architecture: schema/migrations/reconcile, auth/session/origin/rate-limit gates, restore maintenance, advisory locks, upload tracker, image queue/backfills, CLIP embeddings/search, privacy selects, CSP/proxy behavior.
- Operations/release: `Dockerfile`, `docker-compose.yml`, `deploy.sh`, remote deploy wrapper, nginx template, CI workflows, Playwright config, migration and one-off scripts.
- Tests/docs: lint gates, type/build/unit/e2e scripts, source-contract tests, touch-target audit, docs and historical plan/review records where they could overstate current behavior.

Skipped as non-review source: `node_modules`, generated build outputs, runtime media/data directories, ignored local secrets, binary fixture/media content except where referenced by tests.

The worktree already had concurrent modified review artifacts, including `.context/reviews/critic.md`; I treated this file as my assigned write scope and did not touch other modified files.

## Confirmed Issues

### CRIT20-01 - Browser and PAT upload paths still duplicate the same ingest contract

- Severity: High
- Confidence: High
- File/region: `apps/web/src/app/actions/images.ts:129-653`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-633`
- Failure scenario: A future upload-time invariant, privacy rule, queue field, metadata column, or cleanup step is added to one path and missed in the other. Browser uploads pass while external publish-client uploads bypass the new behavior or write incomplete metadata.
- Concrete fix: Extract a shared ingest service that owns config snapshot, quota claim/settlement, topic validation, original save, GPS/HDR/color normalization, DB insert, queue payload, audit, revalidation, and cleanup. Keep only auth/request parsing in the Server Action and PAT route adapters. Add parity tests against the shared service.

### CRIT20-02 - Upload quota settlement depends on comments and local discipline after a synchronous preclaim

- Severity: Medium
- Confidence: Medium-High
- File/region: `apps/web/src/app/actions/images.ts:259-269`, `apps/web/src/app/actions/images.ts:563-578`; `apps/web/src/app/api/admin/lr/upload/route.ts:160-188`; `apps/web/src/lib/upload-tracker.ts:19-33`; `apps/web/src/lib/upload-tracker-state.ts:70-78`
- Failure scenario: A cleanup helper starts throwing, or a new awaited branch is inserted after the preclaim without calling the settlement closure. The process-local tracker leaks count/bytes until the window resets, causing false upload lockouts.
- Concrete fix: Replace ad hoc closures with a `withUploadQuotaClaim(...)` helper or claim object whose `finally` reconciles exactly once from final success counters. Make tests cover thrown cleanup and mid-claim validation failures for both upload entry points.

### CRIT20-03 - Normal public photo pages remain eligible for offline HTML caching after delete/unpublish

- Severity: Medium
- Confidence: High
- File/region: `apps/web/public/sw.template.js:31-34`, `apps/web/public/sw.template.js:59-63`, `apps/web/public/sw.template.js:445-480`, `apps/web/public/sw.template.js:554-558`; `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:185-302`
- Failure scenario: A photo is deleted, hidden, or removed for privacy/client reasons. A visitor who viewed it earlier can go offline and still load the cached photo page for up to 24 hours, including serialized metadata and derivative URLs.
- Concrete fix: Exclude `/p/:id` from the offline HTML fallback, or implement a deletion/version tombstone that invalidates cached photo pages. Add a service-worker regression proving deleted photo pages are not served offline.

### CRIT20-04 - Public map hydrates a large exact-coordinate snapshot

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`; `apps/web/src/db/schema.ts:123-131`
- Failure scenario: A location-rich gallery opts many topics into the map. `/map` fetches and serializes up to 10,000 exact coordinates plus a full fallback list, then mounts all markers client-side. Mobile browsers can stall, and every visitor receives the full opted-in coordinate set.
- Concrete fix: Replace all-at-once hydration with viewport/bbox fetching, clustering, pagination, and a lower initial payload budget. Add a suitable spatial/geohash/index strategy and a mobile performance test around high marker counts.

### CRIT20-05 - Semantic and similar search still do request-local O(n) embedding scans

- Severity: Medium when production semantic search is enabled
- Confidence: High
- File/region: `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/lib/clip-embeddings.ts:36-48`; `apps/web/src/db/schema.ts:292-304`
- Failure scenario: With a large corpus or raised `SEMANTIC_SCAN_LIMIT`, admitted public requests pull thousands of 2 KB blobs from MySQL, decode and score them in the Next request process, and compete with page rendering/image work.
- Concrete fix: Move search to a vector index, sidecar service, or generation-owned cached matrix with explicit memory budget and invalidation. At minimum add a shared semantic-search concurrency budget so route-level rate limits are not the only cost control.

### CRIT20-06 - Public keyword search remains a leading-wildcard multi-query scan

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1574-1745`
- Failure scenario: A crawler or curious visitor sends varied two-character-plus queries within the allowed budget. Each accepted query can force non-sargable `%term%` scans across image/topic fields and extra tag/alias grouped queries, slowing normal browsing.
- Concrete fix: Add a maintained search-document table or MySQL full-text indexes. If fuzzy/caption search is desired, route that work through the semantic-search infrastructure rather than stacking wildcard SQL scans.

### CRIT20-07 - Topic slug remains a mutable natural key with manual fan-out

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/db/schema.ts:10-23`, `apps/web/src/db/schema.ts:25-40`; `apps/web/src/app/actions/topics.ts:287-372`
- Failure scenario: A future table or JSON setting stores a topic slug and is not added to the rename transaction. Renaming a topic leaves that feature pointing at the deleted slug, causing empty views or lost associations while current tests pass.
- Concrete fix: Move topic identity to an immutable surrogate ID with slug as mutable route/display state, or centralize slug-bearing stores in a registry that tests rename fan-out coverage whenever a new slug persistence site is added.

### CRIT20-08 - Single-instance topology is warn-only even though correctness state is process-local

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/lib/restore-maintenance.ts:1-60`; `apps/web/src/lib/upload-tracker-state.ts:7-78`; `apps/web/src/instrumentation.ts:22-31`; `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:277-310`; `apps/web/deploy.sh:51-55`
- Failure scenario: An operator accidentally starts a second web process during manual recovery, scaling, or deploy overlap. Restore flags, upload quotas, fast-path rate limits, queue state, and buffered counters split per process. The singleton guard warns but traffic still flows through both.
- Concrete fix: Fail the supported deploy path on multiple live app containers or persistent singleton-lock contention, or move the process-local coordination state to shared storage before permitting scale-out.

### CRIT20-09 - Nginx protections are committed templates, not deploy-verified runtime state

- Severity: Medium
- Confidence: High
- File/region: `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:274-306`; `apps/web/deploy.sh:51-107`; `scripts/deploy-remote.sh:31-93`
- Failure scenario: The repo tightens public SSR/image/body limits and `npm run deploy` succeeds, but the host keeps an older nginx config because deploy only rebuilds the app container. Operators believe edge protection is live when it is not.
- Concrete fix: Add a deploy preflight that checks a live nginx config version/hash marker and fails or loudly warns on drift. Alternatively split nginx apply into an explicit release command that runs `nginx -t`, reloads, and records verification evidence.

### CRIT20-10 - E2E and visual coverage can pass without browser-matrix or screenshot-regression proof

- Severity: Medium
- Confidence: High
- File/region: `apps/web/playwright.config.ts:72-77`; `.github/workflows/quality.yml:75-80`; `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Failure scenario: Mobile WebKit, Firefox, true touch dispatch, or visual nav regressions ship because the configured matrix is desktop Chromium only and nav screenshots are saved as artifacts rather than compared against baselines.
- Concrete fix: Add at least mobile WebKit plus one Firefox/Chromium-mobile smoke project for critical public flows. Convert visual smoke screenshots that matter into `expect(page).toHaveScreenshot(...)` baselines, or rename them as non-blocking artifact captures.

### CRIT20-11 - Source-string tests overstate behavioral protection for critical paths

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:8-82`; `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`; representative source-contract pattern in `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-29`
- Failure scenario: A refactor leaves the expected string in a dead branch/comment/helper while active behavior regresses. The suite stays green even though watchdog cleanup, photo-view recording, scan limits, import boundaries, or UI state handling no longer execute as intended.
- Concrete fix: Keep source contracts only for mechanical import/boundary checks. Promote safety-critical assertions to behavior tests with mocks/fakes that execute the branch order, cleanup, rate-limit charging, and query limits.

### CRIT20-12 - Admin image management is still a wide table on narrow screens

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/components/image-manager.tsx:427-452`, `apps/web/src/components/image-manager.tsx:474-609`, `apps/web/src/components/image-manager.tsx:613-621`
- Failure scenario: An admin on a phone/tablet at an event needs to retag or delete a mistaken upload. Horizontal scrolling separates preview, identity, tags, and destructive actions, increasing the chance of editing the wrong row.
- Concrete fix: Add a responsive card/list management surface below a breakpoint with row identity, tag editing, selection, and destructive confirmations. Keep the dense table for desktop.

## Likely Issues

### CRIT20-13 - Desktop photo information still flashes hidden and can stay hidden by prior session state

- Severity: Low-Medium
- Confidence: Medium
- File/region: `apps/web/src/components/photo-viewer.tsx:111-135`, `apps/web/src/components/photo-viewer.tsx:757-811`, `apps/web/src/components/photo-viewer.tsx:975-1020`
- Failure scenario: The first render intentionally hides the info sidebar for hydration safety, then restores desktop default or prior session state after mount. A visitor with a stored false pin, or a slow hydration path, may miss color disclosure, similar photos, and download controls.
- Concrete fix: Surface at least download and compact color/metadata signals outside the collapsible sidebar, or persist a visible affordance that is not dependent on post-mount sidebar state. Validate with desktop/mobile screenshots.

### CRIT20-14 - Fresh-install/product identity is still coupled to a tracked production `site-config.json`

- Severity: Low-Medium
- Confidence: Medium
- File/region: `apps/web/src/site-config.json:1-12`; `apps/web/src/site-config.example.json:1-12`; `apps/web/scripts/ensure-site-config.mjs:12-40`; `README.md:60-72`
- Failure scenario: A copied worktree or fork builds with the tracked production config and publishes `gallery.atik.kr` metadata/canonical URLs until the operator notices. Docs warn about this, and the production deploy needs the tracked config, so this is a packaging/distribution risk rather than a current production bug.
- Concrete fix: Before distributing as a template, require an untracked local `site-config.json` or make build fail unless `BASE_URL` is explicitly set outside the known deployment.

## Manual-Validation Risks

### CRIT20-MV-01 - Backfill/search capacity boundaries need production measurements

- Severity: Medium
- Confidence: High that code is bounded; Low on live headroom without runtime data
- File/region: `apps/web/src/lib/clip-embeddings.ts:36-48`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`; `CLAUDE.md:375-381`
- Failure scenario: The documented caps may be acceptable for the current corpus but fail under real traffic, larger galleries, or simultaneous backfill/upload/search windows.
- Concrete fix: Capture production `EXPLAIN`, CPU/RSS, request latency, and DB pool metrics under representative semantic search, map, upload, and backfill load before raising limits or calling the architecture scalable.

### CRIT20-MV-02 - Host nginx state cannot be proven from the repository

- Severity: Medium
- Confidence: High as a validation gap
- File/region: `apps/web/nginx/default.conf:290-293`; `CLAUDE.md:505-523`
- Failure scenario: The repo contains correct rate-limit/body-cap templates, but the host may not have applied them.
- Concrete fix: Run the documented host-side `nginx -t`, reload, and burst verification, then record date/config hash/result in the release ledger.

### CRIT20-MV-03 - CI gates do not prove deploy completion or live behavior

- Severity: Low-Medium
- Confidence: High
- File/region: `.github/workflows/quality.yml:54-83`; `package.json:17-30`; `.context/plans/cycle-20-plan.md:69-76`
- Failure scenario: Lint/type/unit/e2e/build pass, but cycle plan commit/push/deploy evidence remains incomplete or production still runs an older image/config.
- Concrete fix: Keep CI as code-quality evidence, but require an explicit deploy record with commit SHA, image/container status, health response, nginx status when relevant, and post-deploy smoke results.

## Refuted Or Stale Suspicions

- The Cycle 19 Lightroom multipart parse-slot leak is fixed in the current route: the parse slot is released in `finally` at `apps/web/src/app/api/admin/lr/upload/route.ts:174-188`, and `markAdminAuthTokenUsed` moved post-commit at `apps/web/src/app/api/admin/lr/upload/route.ts:539-548`.
- Mobile nav utility clipping from earlier cycle material is fixed in current `NavClient`: controls remain in the collapsed mobile bar and topics move to the expanded panel at `apps/web/src/components/nav-client.tsx:145-191`.
- Desktop photo info is not simply "always hidden by default" anymore; it restores open on desktop when no stored state exists at `apps/web/src/components/photo-viewer.tsx:122-133`. The remaining concern is discoverability/flash/session-state, not a hard default-hidden bug.
- The public map GPS exposure is topic opt-in with SQL and runtime guards at `apps/web/src/lib/data.ts:1777-1816`; the finding is payload/precision/performance, not accidental non-opt-in leakage.
- Admin API auth, same-origin action origin, mutation-barrier, and public-route rate-limit lint gates are wired in CI at `.github/workflows/quality.yml:60-64`.

## Final Sweep

Final sweep rechecked source routes, privacy selects, upload/restore/search paths, service-worker caching, schema/migrations, deploy/nginx, CI/e2e, source-contract tests, and current cycle plans. I dropped stale cycle-20 concerns already fixed in the worktree and kept risks still evidenced by current code.

No tests were run; this was a static critic lane with a single requested deliverable. The only file intentionally modified by this review is `.context/reviews/critic.md`.

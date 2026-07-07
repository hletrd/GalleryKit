# Review-Plan-Fix Cycle 19 Code Review

Role lane: code-reviewer  
Date: 2026-07-08 KST  
Repository: `/Users/hletrd/flash-shared/gallery`  
Write scope: `.context/reviews/code-reviewer.md`

## Scope and Inventory

Read first, per repo policy:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- root `package.json`, `apps/web/package.json`, and quality-gate scripts
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- prior `.context/reviews/code-reviewer.md`

Inventory was built before reviewing. Tracked repository files: 3,494. Review-relevant tracked code/config/docs/migrations matched by `*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`, `*.json`, `*.sql`, `*.md`, `*.css`, `*.sh`, `*.yml`, `*.yaml`: 3,340. Non-generated tracked `apps/web` review files, excluding `.next`, `node_modules`, runtime uploads, and runtime resources: 735.

Main `apps/web` surfaces inventoried and reviewed:

- `src/app`: 81 files, including public/admin pages, server actions, API routes, upload/share/search/map/feed/OG routes.
- `src/components`: 61 files, including map, search, viewer/lightbox, admin UI, forms, layout primitives.
- `src/lib`: 114 files, including auth/session/rate-limit, data access, upload/image pipeline/queue, smart collections, CLIP/search, analytics, security/origin/CSP, config, sharing, restore barriers.
- `src/db`: 3 files, schema and database connection/init behavior.
- `src/__tests__`: 361 files, including behavioral tests, source-contract tests, privacy/touch-target/security guards.
- `e2e`: 12 files, Playwright public/admin coverage.
- `scripts`: 29 files, migration/deploy/backfill/gate scripts.
- `drizzle`: 33 SQL/meta files.
- `messages`: 2 locale files.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - PASS.
- `npm run lint:action-origin --workspace=apps/web` - PASS.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - PASS.
- `npm run typecheck --workspace=apps/web` - PASS.

Not run: full ESLint, `npm run build`, full Vitest, Playwright, live DB restore, production deploy, or browser/manual QA. This lane is a read-only code review plus report write.

Existing unrelated worktree state was left untouched: `?? .context/reviews/cycle-9-2026-07-08/`.

## Findings Summary

- Confirmed issues: 5
- Likely issues: 0
- Risks needing manual validation: 1

## Findings

### CR-19-01 - Large upload ingress still relies on fully parsed `FormData` / `File` objects

Severity: High  
Confidence: High  
Status: Confirmed issue

Evidence:

- `apps/web/next.config.ts:111-119` raises the Server Action/proxy body cap to the upload/restore transport limit.
- `apps/web/src/lib/upload-limits.ts:1-6` sets defaults of 200 MiB per file, 250 MiB restore, 2 GiB rolling batch budget, plus multipart overhead; `apps/web/src/lib/upload-limits.ts:19-33` exposes the framework body cap.
- Browser upload enters `uploadImages(formData: FormData)` and immediately works from `formData.getAll('files')` in `apps/web/src/app/actions/images.ts:129-148`; the app-level quota claim happens later in `apps/web/src/app/actions/images.ts:239-263`.
- Lightroom upload is a route handler, but still acquires only one parse slot and then calls `await request.formData()` in `apps/web/src/app/api/admin/lr/upload/route.ts:152-187`.

Why this is a problem:

The code has good post-parse quotas, filename checks, parse-slot throttling, and quota settlement, but the high-risk boundary is still the framework multipart parser. A single accepted 200 MiB image or restore-sized body must be parsed into `FormData` / `File` before the application can stream to disk or apply most domain checks. The LR route caps concurrent parser work to one, but that still leaves one large body resident under Node/Next. The browser Server Action path has no equivalent route-level streaming parser boundary.

Concrete failure scenario:

An admin or compromised admin session submits a near-limit upload while image processing or restore work is already memory-heavy. The request passes content-length limits and reaches the framework parser; memory spikes before the app can hand the bytes to its own disk/quota pipeline. On a disk- or memory-constrained deploy host, this can kill the process or force unrelated requests to fail even though all later application checks are correct.

Suggested fix:

Move large binary ingestion off Server Actions and off `request.formData()` for LR uploads. Use a route-handler streaming multipart parser with hard per-part byte limits, direct temp-file writes, a shared ingress semaphore, and a common upload service that receives validated temp files plus metadata. Keep Server Actions for metadata and small forms only.

### CR-19-02 - Cached shared-group lookup owns view-count side effects

Severity: Medium  
Confidence: Medium  
Status: Risk needing manual validation

Evidence:

- `getSharedGroup()` fetches data and buffers a denormalized view-count side effect in the same function at `apps/web/src/lib/data.ts:1402-1407`.
- `getSharedGroupCached = cache(getSharedGroup)` wraps that side-effecting function, with a local warning not to call the cached wrapper twice with different count semantics in `apps/web/src/lib/data.ts:1830-1834`.
- The public shared-group page calls `getSharedGroupCached(key, { selectedPhotoId: photoId })` and separately fires durable view recording after resolving the selected image in `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`.

Why this is a problem:

React `cache()` is safest around pure data reads. Here the cached read can also mutate buffered counters, and the caller separately decides whether to record the durable counter. The current page keeps those decisions aligned, but the abstraction is fragile: a future metadata generator, preload, analytics wrapper, or refactor that calls `getSharedGroupCached()` with `incrementViewCount:false`, a different object identity, or a selected-photo option can change whether the denormalized counter is skipped, deduped, or duplicated.

Concrete failure scenario:

A later change adds an OG/metadata lookup for `/g/[key]` using `getSharedGroupCached(key, { incrementViewCount: false })`, then the page calls the cached wrapper again with selection semantics. Depending on call order and argument identity, the data fetch and the view-count mutation no longer have a single obvious owner. Counters can drift while tests keep passing because both effects are hidden behind the same data accessor.

Suggested fix:

Split the public shared-group accessor into a pure cached read and explicit view-recording functions. The page should fetch the group once, resolve the selected image, then call denormalized and durable view-count paths from one small, non-cached orchestration point.

### CR-19-03 - `/map` still materializes and renders up to 10,000 markers plus a duplicate list

Severity: Medium  
Confidence: High  
Status: Confirmed issue

Evidence:

- `MAP_MAX_MARKERS` is 10,000 in `apps/web/src/lib/data.ts:1766-1775`.
- `getMapImages()` queries `MAP_MAX_MARKERS + 1`, slices to 10,000, and returns all rows in `apps/web/src/lib/data.ts:1784-1816`.
- `MapClient` computes bounds by mapping all latitudes/longitudes and renders every marker with a popup in `apps/web/src/components/map/map-client.tsx:77-94` and `apps/web/src/components/map/map-client.tsx:120-139`.
- The page also renders every marker again as a linked list in `apps/web/src/app/[locale]/(public)/map/page.tsx:98-109`.

Why this is a problem:

The cap prevents an unbounded SQL result, but 10,000 Leaflet markers plus 10,000 list items is still a large client payload and DOM/rendering workload. The implementation acknowledges that clustering or viewport filtering would be needed beyond the cap, but the current code still ships the cap to the browser.

Concrete failure scenario:

A gallery grows to several thousand GPS-enabled public photos. A mobile visitor opens `/map`; SSR serializes thousands of marker records, hydration builds thousands of React/Leaflet nodes, the bounds calculation allocates full latitude/longitude arrays, and the fallback list duplicates the DOM work. The page can become slow or unresponsive without violating any server limit.

Suggested fix:

Lower the initial cap and add either server-side bbox pagination or marker clustering. Keep the accessible list paginated or virtualized separately from marker rendering. Treat `truncated` as a prompt to narrow the viewport rather than as permission to render thousands of nodes.

### CR-19-04 - Critical invariants are often protected by source-string tests instead of behavior tests

Severity: Medium  
Confidence: High  
Status: Confirmed issue

Evidence:

- `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-17` explicitly says mock-based route tests would not catch removing the scan limit, then asserts import/source text at `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:43-57` and `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:60-76`.
- `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:42-50` checks Lightroom quota settlement by reading source text around `await ensureUploadDirectories()`.
- `apps/web/src/__tests__/load-more-source-contracts.test.ts:5-29` checks load-more backoff and announcement behavior via regexes over component source.
- A repo-wide search found 165 unit-test files containing `readFileSync`, `source contract`, or similar source-contract patterns under `apps/web/src/__tests__`.

Why this is a problem:

Source-contract tests are useful as guardrails, but many of these invariants are logic and cross-file behavior: scan limits, quota settlement, advisory-lock cleanup, UI backoff, accessibility announcements. String/regex tests can pass when the code still contains the expected words but no longer executes them in the right branch, order, or error path.

Concrete failure scenario:

A refactor keeps `.limit(SEMANTIC_SCAN_LIMIT)` in a helper or dead branch, so the source test passes, while the route’s active query path scans too many rows. Similarly, a quota-settlement string can remain near an error handler while an early return before it leaks the tracker claim.

Suggested fix:

Keep source contracts only for mechanical import/boundary assertions. For high-risk invariants, add behavior tests that execute the route/action/component with mocked DB/parser/timer dependencies and assert the actual call sequence, returned status, cleanup, and UI state. Prioritize semantic search limits, LR/browser upload quota settlement, restore/advisory-lock cleanup, and load-more retry/backoff behavior.

### CR-19-05 - Playwright only runs one desktop Chromium project

Severity: Medium  
Confidence: High  
Status: Confirmed issue

Evidence:

- `apps/web/playwright.config.ts:72-77` defines a single project: `name: 'chromium'` using `devices['Desktop Chrome']`.

Why this is a problem:

The app has mobile/touch-target requirements, photo viewer interactions, responsive admin layouts, service worker behavior, map interactions, and color/HDR presentation concerns. A single desktop Chromium project cannot catch WebKit-specific media/rendering regressions, mobile viewport layout breakage, or Firefox interaction differences.

Concrete failure scenario:

A change passes unit tests and desktop Chromium E2E but breaks iOS Safari lightbox gestures, mobile admin navigation wrapping, or WebKit image rendering. The required `npm run test:e2e` gate stays green because the failing browser/viewport never runs.

Suggested fix:

Add a small scheduled or opt-in Playwright matrix: mobile WebKit for public viewer/search/map flows, desktop Firefox for navigation/search/share smoke, and a mobile Chromium admin smoke if credentials are available. Keep the default local project fast if needed, but make broader browser coverage a CI or nightly gate.

### CR-19-06 - Admin E2E workflows are easy to skip in normal local/non-CI runs

Severity: Low  
Confidence: High  
Status: Confirmed issue

Evidence:

- `apps/web/e2e/admin.spec.ts:6-13` only enforces admin credentials in CI; the actual admin workflow describe is skipped when `adminE2EEnabled` is false.
- `apps/web/e2e/helpers.ts:28-45` auto-enables admin E2E only for local non-production origins with `E2E_ADMIN_PASSWORD` or plaintext `ADMIN_PASSWORD`; hashed admin passwords or missing plaintext credentials disable the workflows.

Why this is a problem:

This is safer than accidentally hitting remote admin systems, but it means `npm run test:e2e` can appear green locally while every admin workflow is skipped. Several recently fixed issues were admin-path regressions, so local green E2E has weaker meaning than the script name suggests.

Concrete failure scenario:

A developer changes topic creation, upload, token, or settings UI with only hashed local admin credentials configured. Playwright skips admin workflows, the run exits green, and the regression is discovered only after CI with seeded plaintext credentials or after deployment.

Suggested fix:

Emit an explicit local skip summary or add a separate `test:e2e:admin` script that fails closed unless credentials are available. For admin-touching PRs, require the admin project in CI and document the env setup in the gate output.

## Final Sweep

Examined file categories:

- Repo instructions and project context: `AGENTS.md`, `CLAUDE.md`, README, `.context` planning/review conventions.
- Package/build/config: root and app package scripts, Next config, Playwright config, TypeScript/script checks, custom lint gates, deploy/migration helpers.
- Source routes/actions/pages: public routes, admin routes, API routes, Server Actions, upload/share/search/map/feed/OG surfaces.
- Shared libraries: DB connection/schema/data selectors, auth/session/PAT, rate limiting, origin/CSP, upload limits/tracker, image processing/queue, restore barriers, smart collections, analytics, CLIP/search, sharing, locale/path helpers.
- Components: map, search/load-more, viewer/lightbox/photo card, admin workflows, UI primitives relevant to interaction and cross-file data contracts.
- Scripts and migrations: Drizzle SQL/meta/journal, migration reconciliation, backfills, deploy and validation scripts.
- Tests: unit, source-contract, privacy/touch-target/security guard tests, Playwright public/admin flows.
- Locales/public source assets: messages and service-worker/template/config surfaces as relevant to code contracts.

Skipped or intentionally excluded:

- Generated/build output: `.next`, coverage artifacts, Playwright reports, screenshots, gate logs, test result artifacts.
- Vendored/dependency trees: `node_modules`.
- Runtime/user data and binary assets: uploaded photos, runtime `public/uploads`, runtime `public/resources`, image fixtures beyond their test-contract relevance.
- Historical `.context` archives were not fully re-reviewed as source; current aggregate/planning conventions were read for carry-forward context.

No fixes were implemented and no commit was made.

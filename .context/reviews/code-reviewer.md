# Cycle 12 Code-Reviewer + Critic Report

Date: 2026-07-07
Reviewer: code-reviewer + critic lane
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `173668ea0a0bb5f57a64cef581ac7b0f5abaef20`

## Scope And Inventory

I reviewed the repository as a whole, not only diffs, and wrote only this review file. I read `AGENTS.md`, `CLAUDE.md`, `.context/plan/plan-c12.md`, `.context/reviews/_aggregate.md`, the prior `.context/reviews/code-reviewer.md`, and the current `.context/reviews/critic.md`.

Inventory built before inspection:

- Source inventory from `rg --files`: app source, configs, migrations, scripts, e2e tests, unit tests, docs, deploy helpers, and review/plan context.
- `apps/web/src`: 615 files total, including 81 app route/action files, 111 library files, and 353 unit test files.
- Operational surfaces reviewed: `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, Docker/Next/Vitest/Playwright config, `package.json`, `package-lock.json`, and `.github/workflows/quality.yml`.
- Application surfaces reviewed: public pages, admin pages, server actions, API routes, auth/session/rate-limit/origin wrappers, data layer, image queue/backfill, semantic search, migrations, tests, and deployment helpers.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate --json` failed with 2 moderate findings through `next -> postcss`.

I did not run full lint/typecheck/build/unit/e2e because the task is review-only and those broader gates are already represented in the repo workflow; the targeted guard checks and audit were enough to validate the specific security contracts inspected here.

## Confirmed Findings

### CR-C12-01 - Production dependency audit remains red through Next's nested PostCSS

Severity: Medium
Confidence: High
Status: Confirmed issue
Duplicate/planned status: Duplicate of `.context/reviews/_aggregate.md` `AGG-C11-14`; still present at this HEAD.
Exact file/region: `apps/web/package.json:59`, root `package.json:7-9`, `package-lock.json:9194-9204`, `package-lock.json:9334-9337`.

Failure scenario:

The workspace override pins top-level `postcss` to `8.5.16`, but `next@16.2.10` still installs nested `postcss@8.4.31`. The production audit still reports GHSA-qx2v-qp2m-jg93 through `node_modules/next/node_modules/postcss`. If a current or future path feeds attacker-influenced CSS into Next's bundled PostCSS stringify path and embeds it into a page, the known `</style>` escaping issue can become XSS. I did not confirm an arbitrary-CSS input today, so the exploit path is conditional, but the production audit gate is red now.

Suggested fix:

Upgrade to a stable Next release that removes the vulnerable nested dependency, or prove a lockfile-effective override replaces `next/node_modules/postcss` without breaking the full gate suite. Do not take the audit suggestion to downgrade Next to 9.3.3.

### CR-C12-02 - Dynamic public archive/home queries still use date functions on indexed columns

Severity: Medium
Confidence: High
Status: Confirmed issue
Duplicate/planned status: Duplicate of `AGG-C11-06`; partially fixed only for `getTimelineImages`, not for these paths.
Exact file/region: `apps/web/src/lib/data-timeline.ts:111-130`, `apps/web/src/lib/data-timeline.ts:143-155`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`, `apps/web/src/components/on-this-day-widget.tsx:15-22`.

Failure scenario:

`getOnThisDayImages()` filters with `MONTH(capture_date)` and `DAY(capture_date)`, and `getTimelineYears()` selects/orders by `YEAR(capture_date)`. Both feed dynamic public SSR surfaces (`revalidate = 0` pages and the home page widget). On a larger archive, visitors or crawlers repeatedly force MySQL to evaluate date functions across the processed dated image set instead of using the `(processed, capture_date, created_at)` index as a tight seek.

Suggested fix:

Add generated/indexed date keys such as `capture_year` and `capture_mmdd`, or cache year and on-this-day rollups invalidated by image metadata changes. Update tests so they no longer pin `MONTH()`/`DAY()`/`YEAR()` as the expected query shape.

### CR-C12-03 - Public map can still ship and hydrate up to 10,000 markers plus a duplicate list

Severity: Medium
Confidence: High
Status: Risk with source-confirmed scale shape
Duplicate/planned status: Duplicate of `AGG-C11-09`; still present.
Exact file/region: `apps/web/src/lib/data.ts:1750-1777`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:87-90`, `apps/web/src/components/map/map-client.tsx:120-139`.

Failure scenario:

`getMapImages()` returns `MAP_MAX_MARKERS + 1`, with `MAP_MAX_MARKERS = 10000`. The page serializes those markers, renders an accessible `<ul>` entry for each, and the Leaflet client creates one `<Marker>` per row. `FitBounds` also allocates latitude/longitude arrays and spreads them into `Math.min`/`Math.max`. A GPS-heavy gallery or crawler traffic can create a large RSC/client payload and stall mobile hydration/main-thread work before the map is usable.

Suggested fix:

Switch map loading to viewport/bounds queries with clustering or a canvas/WebGL marker layer. Virtualize or paginate the accessible list. Compute bounds in one pass rather than allocating two arrays and spreading them.

### CR-C12-04 - Public listing queries aggregate tags before limiting the page

Severity: Medium
Confidence: Medium
Status: Likely performance issue
Duplicate/planned status: Duplicate of `AGG-C11-07`; still present.
Exact file/region: `apps/web/src/lib/data.ts:806-828`, `apps/web/src/lib/data.ts:937-940`.

Failure scenario:

`getImagesLite()` joins `image_tags` and `tags`, groups by `images.id`, orders, then applies the page limit/offset or cursor. That query shape does more tag aggregation work than needed for a 30-photo page, especially on broad public pages. The paged `getImages()` path likewise executes the grouped listing query and a count in parallel. As archives and tag fan-out grow, public page requests can spend time sorting/grouping rows that will not be returned.

Suggested fix:

First select the page image ids through image-table indexes and cursor predicates, then aggregate tags only for those ids. Keep the existing privacy select shape, but split pagination from tag enrichment.

### CR-C12-05 - Semantic and similar search still brute-force embedding blobs on the request path

Severity: Medium
Confidence: Medium
Status: Risk with source-confirmed cost shape
Duplicate/planned status: Duplicate of `AGG-C11-08`; still present.
Exact file/region: `apps/web/src/app/api/search/semantic/route.ts:270-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:181-214`.

Failure scenario:

Both routes scan up to `SEMANTIC_SCAN_LIMIT` embedding rows, transfer MEDIUMBLOB vectors into Node, decode them, score them, and run `topK` on the request path. The semantic route does this after the CLIP text embedding has already consumed inference capacity. Even with rate limiting, concurrent public searches can compete with normal SSR and upload/background work on the same Node process and MySQL pool.

Suggested fix:

Move production scoring to a vector index, worker thread, or bounded cached embedding matrix with explicit invalidation. If keeping brute force for now, set production limits based on measured CPU/RSS/tail latency and make expensive-work admission account for the scan size.

### CR-C12-06 - Single-writer correctness remains warn-only while process-local state is correctness-relevant

Severity: Medium
Confidence: High
Status: Confirmed operational risk
Duplicate/planned status: Duplicate of `AGG-C11-19`; still present.
Exact file/region: `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/single-writer-guard.ts:271-304`, `apps/web/src/instrumentation.ts:22-31`.

Failure scenario:

The singleton guard detects advisory-lock contention and emits a loud warning, but startup continues. The app still has process-local state for restore fences, upload quota tracking, queue status, and several fast-path rate limits. If two `gallerykit-web` instances point at one database, both serve traffic and split those states, so users can see inconsistent mutation fences, quota behavior, and status surfaces before anyone sees logs.

Suggested fix:

Add an opt-in production enforcement mode, for example `GALLERYKIT_ENFORCE_SINGLE_WRITER=true`, that fails readiness or exits after persistent contention. Longer term, move correctness-critical coordination to DB/advisory-lock-backed state rather than process memory.

## Maintainability And Validation Risks

### CR-C12-07 - Legacy schema reconcile remains a second schema authority with mostly source-only parity coverage

Severity: Medium
Confidence: High
Status: Confirmed maintainability risk
Duplicate/planned status: Duplicate of `AGG-C11-16`; still present.
Exact file/region: `apps/web/scripts/migrate.js:348-420`, `apps/web/scripts/migrate.js:684-725`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-179`.

Failure scenario:

`reconcileLegacySchema()` hand-writes current schema DDL. The tests mostly assert that table/column/index names appear in source and explicitly state they cannot verify types/defaults. A future migration can change a column type, nullability, default, index column order, uniqueness, or FK action while keeping the same names. CI can pass, but a DB repaired through reconcile diverges from one built by normal migrations.

Suggested fix:

Add a parity gate that creates two disposable MySQL schemas: one by committed migrations and one by reconcile/baseline, then diffs `information_schema.columns`, `statistics`, and FK rules. If too heavy for every PR, run it scheduled and require it for migration changes.

### CR-C12-08 - Real CLIP production activation remains outside required CI gates

Severity: Medium
Confidence: High
Status: Confirmed release-risk gap
Duplicate/planned status: Duplicate of `AGG-C11-17`; still present.
Exact file/region: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/package.json:21-23`, `.github/workflows/quality.yml:66-80`.

Failure scenario:

The real-model tests skip unless model weights and env flags are present. The quality workflow runs ordinary unit/e2e/build gates but does not seed weights or run `test:clip:preflight`. A dependency upgrade, model layout change, native runtime change, or `CLIP_MODELS_ROOT` mismatch can break production semantic search while default CI stays green.

Suggested fix:

Add a scheduled or manually triggered CI job that seeds/caches the pinned weights and runs `npm run test:clip:preflight --workspace=apps/web`. Consider requiring a recent preflight artifact before production mode is enabled.

### CR-C12-09 - Critical browser behaviors are still protected by source-string tests

Severity: Medium
Confidence: High
Status: Confirmed test-oracle gap
Duplicate/planned status: Duplicates `AGG-C11-20`, `AGG-C11-21`, and part of `AGG-C11-28`; still present.
Exact file/region: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, implementation at `apps/web/src/components/info-bottom-sheet.tsx:562-575`, touch-target exception at `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`, fixture at `apps/web/src/__tests__/touch-target-audit.test.ts:1053-1059`, Playwright browser scope at `apps/web/playwright.config.ts:72-77`.

Failure scenario:

The bottom-sheet dropdown test asserts that certain strings exist, but it does not open the dropdown in a mobile browser, prove it renders above the sheet, or verify focus/escape behavior. The touch-target scanner intentionally lets bare text links pass, which is right for prose but can miss future control-like links. Playwright only runs desktop Chromium, so mobile/WebKit regressions in these areas can ship while source-string checks stay green.

Suggested fix:

Add targeted Playwright behavior tests for mobile info-sheet dropdown visibility/focus, and add a DOM-level or explicit-allowlist touch-target check for representative pages. Keep source-string tests only as secondary tripwires.

### CR-C12-10 - Shared-group data reader still owns a hidden view-count side effect

Severity: Low
Confidence: High
Status: Confirmed maintainability issue
Duplicate/planned status: Duplicate of prior code-review finding `CR-C11-02` and aggregate `AGG-C11-02`; still present.
Exact file/region: `apps/web/src/lib/data.ts:1322-1407`, cached wrapper warning at `apps/web/src/lib/data.ts:1805-1809`, public caller at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-112`.

Failure scenario:

`getSharedGroup()` looks like a read helper but buffers a view-count write unless callers pass `incrementViewCount:false` or a valid selected photo id. A future metadata, preview, moderation, or API path can call `getSharedGroupCached(key)` just to read the group and silently increment analytics. React `cache()` also makes call-order part of side-effect semantics if two callers use different count options in one render.

Suggested fix:

Split pure shared-group reads from explicit view-count recording. If the current behavior remains temporarily, export separately named helpers for read-only and count-capable access so accidental side effects are harder to introduce.

## Already Fixed During This Pass

I rechecked several cycle-11 findings and did not carry them forward:

- Topic route advisory-lock release cleanup is fixed: `apps/web/src/app/actions/topics.ts:69-99` now destroys the pooled connection on `RELEASE_LOCK` failure.
- Drizzle Kit TLS CA handling is fixed: `apps/web/drizzle.config.ts:10-17` now requires and reads `DB_SSL_CA` for non-local hosts unless `DB_SSL=false`.
- Raw `IMAGE_BASE_URL` leakage is fixed: `apps/web/src/lib/constants.ts:6-19`, `apps/web/src/lib/image-url.ts:26-37`, and `apps/web/src/app/[locale]/layout.tsx:110-117` sanitize the value before public exposure.
- Restore background-write drain is bounded: `apps/web/src/lib/background-db-writes.ts:93-112` and `apps/web/src/app/[locale]/admin/db-actions.ts:540-557`.
- Settings-hash mapper drift is fixed: `apps/web/src/lib/settings-hash.ts:79-107` uses an exhaustive typed mapper.
- `logout` is now same-origin and restore-barrier aware: `apps/web/src/app/actions/auth.ts:268-294`.

## Final Missed-Issue Sweep

Final sweep areas: auth/API wrappers, mutating server actions, public rate limits, advisory locks, restore drains, DB TLS, CDN URL sanitization, migration/reconcile, public query shapes, semantic search, map/timeline scale, source-string tests, deploy/nginx boundary, and dependency audit.

No Critical or High production defect was confirmed in this pass. The main residual risks are scale/operational/test-oracle risks already represented in the cycle-11 aggregate and still present in source. Guard evidence is good for admin API auth, server-action origin checks, and public expensive-route rate-limit checks. The production dependency audit remains red and should stay visible until the nested Next/PostCSS path is actually removed.

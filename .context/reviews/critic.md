# Cycle 9 Critic Review

Date: 2026-07-07 KST
Reviewer: critic
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: PROMPT 1 skeptical multi-perspective review. Application code was not modified.

## Inventory And Method

I read `AGENTS.md` and `CLAUDE.md` first. I then inventoried the review surface from the tracked repository and current working tree:

- Tracked source/docs: 3,392 tracked files; 372 non-test `apps/web` files, 347 app unit-test files, 2,473 committed `.context` review/plan artifacts, and 200 root/other files.
- Current dirty tree before my write: `.context/reviews/code-reviewer.md`, `.context/reviews/security-reviewer.md`, and `.context/reviews/test-engineer.md` were already modified by other lanes. I did not edit them.
- First-party review scope: app routes/actions, data layer, DB schema/migrations, image processing/queue/backfill, semantic search, service worker, deploy/Docker/nginx, lint/test harnesses, root/app package manifests, and current cycle reports.
- Exclusions as non-authoritative source: `node_modules`, `.next`, runtime upload/data directories, binary fixtures, screenshots, generated logs, and historical `.context` artifacts except where they claimed current behavior or unresolved risk.

Validation evidence:

- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` failed with the production Next/PostCSS advisory.
- `npm audit --workspace=apps/web --audit-level=moderate` failed with production PostCSS plus dev-only esbuild/`@esbuild-kit` advisories.
- Static searches checked skipped/focused tests, deferred markers, TODO/FIXME/HACK, route/auth/rate-limit comments, privacy select shapes, migration/schema/runbook claims, and large-result public paths.
- I did not run full lint/typecheck/build/test/e2e because this was a report-only review and no app code changed.

## Findings Summary

- Critical: 0
- High: 2
- Medium: 6
- Low: 0

## Findings

### C9-CRIT-01 - Semantic embedding version ownership contradicts the schema

Severity: Medium
Confidence: High
Status: Confirmed

Code/doc regions:

- `apps/web/src/db/schema.ts:286-300`
- `apps/web/drizzle/0012_image_embeddings.sql:5-11`
- `apps/web/scripts/backfill-clip-embeddings.ts:212-223`
- `apps/web/src/app/actions/embeddings.ts:175-186`
- `apps/web/src/lib/image-queue.ts:512-523`
- `apps/web/README.md:70-82`
- `CLAUDE.md:160`

Why this matters:

The physical table has `PRIMARY KEY (image_id)`, and every writer uses `onDuplicateKeyUpdate` on that key while replacing `modelVersion`. The docs say embedding writes store one row per `(image_id, model_version)`. Those are different product contracts: one supports side-by-side model versions; the other destructively rewrites the active row.

Concrete failure scenario:

Production rows exist for `jina-clip-v2-d512-q8`. An operator runs a stub or future-model backfill against the same DB, overwriting rows image by image. Rolling back the active model can then only see images not overwritten yet, so public semantic search silently loses coverage until a full production re-embed finishes.

Suggested fix:

Choose and encode one invariant. If rollback/side-by-side evaluation is required, migrate to a composite key such as `(image_id, model_version)` and update writers, cleanup, scans, and tests. If only one active embedding is intended, update `README.md`/`CLAUDE.md` to say model changes destructively replace rows, and guard production DBs against accidental stub overwrites.

### C9-CRIT-02 - Public privacy guards can be bypassed by aliasing sensitive columns

Severity: Medium
Confidence: High
Status: Risk, confirmed guard-shape gap

Code regions:

- `apps/web/src/lib/data.ts:368-475`
- `apps/web/src/lib/data.ts:409-488`
- `apps/web/src/lib/search-enrichment-fields.ts:29-47`
- `apps/web/src/lib/data-timeline.ts:35-67`
- `apps/web/src/lib/data.ts:1599-1617`

Why this matters:

The project’s privacy boundary is key-name based. Guards check whether selected result object keys overlap `PrivacySensitiveKeys`; they do not prove that the underlying Drizzle columns are public-safe. A future public select can expose `images.latitude` as `lat`, `images.user_filename` as `displayName`, or `images.pipeline_version` as `version`, and the current type guard will pass because the alias key is not sensitive.

Concrete failure scenario:

A contributor adds a public map/search/filter feature and selects `{ cameraPlace: images.latitude }` or `{ sourceName: images.user_filename }` to avoid a TypeScript error. Unit privacy tests that compare public keys still pass, but GPS or original filenames reach unauthenticated JSON.

Suggested fix:

Move public selects behind source-column allowlists, not result-key denylists. Add a lint/source-contract test that rejects direct `images.<sensitiveColumn>` use in public select modules unless the call site is the audited map-visible latitude/longitude path.

### C9-CRIT-03 - Authenticated admin/security e2e coverage is optional in the default gate

Severity: High
Confidence: High
Status: Confirmed verification gap

Code regions:

- `apps/web/e2e/admin.spec.ts:6-13`
- `apps/web/e2e/origin-guard.spec.ts:27-73`
- `apps/web/e2e/helpers.ts:28-45`
- `apps/web/playwright.config.ts:48-87`

Why this matters:

Admin Playwright coverage only runs when `adminE2EEnabled` is true. Local `npm run test:e2e` can skip authenticated admin workflows, and the strongest origin-guard e2e assertion skips without credentials. The unauthenticated origin smoke allows `401`, which proves the route exists but does not prove the authenticated CSRF branch rejects spoofed origins.

Concrete failure scenario:

A refactor breaks authenticated admin navigation, the token/admin wrapper, or the same-origin rejection branch after a valid session cookie. A standard local e2e run without plaintext e2e credentials passes because all authenticated admin specs are skipped.

Suggested fix:

Seed a disposable local admin account/password inside the e2e harness and fail the default local e2e command if authenticated admin coverage cannot run. Keep remote admin testing opt-in, but make local authenticated origin-guard coverage deterministic.

### C9-CRIT-04 - Production CLIP activation relies on skipped manual real-model tests

Severity: High
Confidence: High
Status: Confirmed release/activation proof gap

Code/doc regions:

- `CLAUDE.md:587-596`
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`
- `apps/web/src/lib/gallery-config.ts:123-126`
- `apps/web/src/app/api/search/semantic/route.ts:247-289`

Why this matters:

The docs correctly say the real CLIP pre-activation suites are skipped in default CI and are the only verification that offline model loading and ranking work. Runtime production activation remains possible with `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` plus the DB row. Default route tests mock the encoder, so they do not prove the native ONNX/model-weight path.

Concrete failure scenario:

A package, model layout, CPU runtime, or seeded path change breaks `embedTextReal`. Default gates stay green. The operator enables production semantic search and public semantic queries return `503` from the real inference catch path.

Suggested fix:

Turn the CLIP activation proof into an executable gate: for example, add `npm run test:clip:preflight` and require a recent preflight marker/artifact before production mode can be enabled, or run the real-model tests in a seeded CI job. Keep fast route tests mocked, but make production activation fail closed without real-model proof.

### C9-CRIT-05 - Public map can hydrate 10,000 markers plus a duplicate list

Severity: Medium
Confidence: High
Status: Confirmed scale/product risk

Code regions:

- `apps/web/src/lib/data.ts:1732-1782`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`
- `apps/web/src/components/map/map-client.tsx:77-140`

Why this matters:

The `/map` page is dynamic (`revalidate = 0`) and fetches up to `MAP_MAX_MARKERS + 1`, where `MAP_MAX_MARKERS` is 10,000. It then serializes all markers into a client component, renders one Leaflet marker per image, computes bounds with spread arrays, and renders a second accessible `<ul>` over the same marker set.

Concrete failure scenario:

A travel gallery makes thousands of GPS photos map-visible. A mobile visitor loads `/map`; the server ships a huge RSC/client payload, React hydrates thousands of Leaflet markers and links, and the main thread stalls before the map is usable.

Suggested fix:

Use viewport/bounds loading plus clustering or a canvas/WebGL marker layer. Lower the initial SSR marker cap and virtualize/paginate the accessible list. Compute bounds in one pass without allocating and spreading two full coordinate arrays.

### C9-CRIT-06 - Hourly maintenance sweeps can overlap with themselves

Severity: Medium
Confidence: High
Status: Confirmed concurrency risk

Code regions:

- `apps/web/src/lib/maintenance-scheduler.ts:32-45`
- `apps/web/src/lib/maintenance-scheduler.ts:61-69`
- `apps/web/src/lib/view-retention.ts:64-87`

Why this matters:

`runMaintenanceSweep()` tracks active promises for restore draining, but it does not single-flight the sweep body. `startMaintenanceScheduler()` runs one sweep at startup and another every hour. `purgeOldViewEvents()` can execute up to 200 delete batches per table across three view tables.

Concrete failure scenario:

After a traffic spike or long retention gap, the first retention purge runs longer than an hour. The interval starts a second sweep before the first finishes, doubling DELETE pressure and index churn on the single MySQL writer while public page views and analytics writes continue.

Suggested fix:

Add a module-level in-flight guard or promise reuse. If a sweep is already running, skip/log the interval tick while preserving `activeMaintenanceSweeps` for restore draining.

### C9-CRIT-07 - Production dependency audit still fails despite the PostCSS override

Severity: Medium
Confidence: High
Status: Confirmed dependency advisory / future exploit risk

Code/package regions:

- `package.json:7-9`
- `apps/web/package.json:57`
- `apps/web/package.json:80`
- `package-lock.json:9194-9205`

Why this matters:

The root override pins top-level PostCSS to `8.5.16`, but `package-lock.json` still installs `next@16.2.10` with nested `postcss@8.4.31`. `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` fails on GHSA-qx2v-qp2m-jg93 through `node_modules/next/node_modules/postcss`.

Concrete failure scenario:

Today I did not find a public arbitrary-CSS input. The risk becomes exploitable if a future theme/custom-CSS feature or build/runtime style generator stringifies attacker-controlled CSS into an HTML `<style>` context through the vulnerable nested PostCSS.

Suggested fix:

Upgrade to a stable Next release that removes the vulnerable nested PostCSS, or validate a lockfile/package-manager override that actually replaces `node_modules/next/node_modules/postcss`. Add an audit/lockfile contract so the nested vulnerable copy cannot silently reappear.

### C9-CRIT-08 - Upload derivative route claims range handling it does not implement

Severity: Medium
Confidence: High
Status: Confirmed docs/code drift

Code regions:

- `apps/web/src/app/uploads/[...path]/route.ts:4-15`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-15`
- `apps/web/src/lib/serve-upload.ts:287-369`

Why this matters:

Both public upload route twins exempt derivative serving from rate-limit lint partly because it is bounded by "range handling". The route never forwards `Range`, and `serveUploadFile()` always returns full `200` bodies for GET with full `Content-Length`; there is no `206 Partial Content`, `Content-Range`, `Accept-Ranges`, or `416` path.

Concrete failure scenario:

A client/CDN/browser retrying a large derivative with `Range: bytes=...` hits the route-handler fallback instead of Next static serving. It receives a full-body `200`, breaking resume semantics and wasting bandwidth. Reviewers may also continue to treat "range handling" as a mitigation that does not exist.

Suggested fix:

Either implement single-range support and pass `request.headers.get('range')` from both routes, or remove the range claim from the lint exemption and docs. If implemented, add tests for satisfiable, suffix, invalid/multiple range, HEAD+range, conditional precedence, and abort cleanup.

## Final Sweep

Checked commonly missed areas:

- Auth/session/origin boundaries: current source uses centralized `withAdminAuth`, same-origin action gates, token scopes, no-store admin responses, and restore mutation barriers. I did not find a current app-code auth bypass in this critic pass.
- Upload/storage privacy: private original storage, derivative realpath/symlink containment, GPS strip fail-closed paths, public derivative ETag/HEAD handling, and Lightroom upload constraints were inspected. The remaining derivative-serving issue is range drift, not path traversal.
- Backup/restore/migration: restore locking, durable maintenance, child-process restore scanner, migration post-condition checks, DML-baseline guards, and deploy/runbook constraints were reviewed. I did not identify a new destructive restore or migration skip path beyond maintenance-overlap pressure.
- Public privacy/data: field omit lists are broad and tested, but alias-based sensitive-column selection remains the key structural gap.
- Performance/product constraints: map hydration, smart collections/listing aggregation, maintenance sweeps, and backfill/index surfaces remain scale-sensitive. I elevated the map and maintenance cases because they are concrete and user-visible.
- Test harness: no focused `.only(` usage found in app tests/e2e/config. Skips are intentional but leave admin e2e and real CLIP activation under-proven.
- Dependency surface: production audit fails on nested PostCSS; full audit also reports dev-only esbuild through deprecated `@esbuild-kit`/Drizzle tooling. I reported the production advisory as the cross-cutting critic finding; the dev advisory is lower priority and already covered by the security lane.

Skipped intentionally: local secret contents, production deployment commands, destructive DB/service operations, generated/vendor source, and full gate execution. No application code was modified.

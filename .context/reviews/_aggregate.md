# Aggregate Review - review-plan-fix Cycle 3

Date: 2026-06-29
Scope: current HEAD after review-artifact commits (`8be5a132`); application source unchanged from `3f24038b`.

## Reviewer Roster

All discovered/required review roles returned and wrote provenance files:

- `code-reviewer` -> `.context/reviews/code-reviewer.md`
- `perf-reviewer` -> `.context/reviews/perf-reviewer.md`
- `security-reviewer` -> `.context/reviews/security-reviewer.md`
- `critic` -> `.context/reviews/critic.md`
- `verifier` -> `.context/reviews/verifier.md`
- `test-engineer` -> `.context/reviews/test-engineer.md`
- `tracer` -> `.context/reviews/tracer.md`
- `architect` -> `.context/reviews/architect.md`
- `debugger` -> `.context/reviews/debugger.md`
- `document-specialist` -> `.context/reviews/document-specialist.md`
- `designer` -> `.context/reviews/designer.md`
- registered custom reviewer `product-marketer-reviewer` -> `.context/reviews/product-marketer-reviewer.md`

UI/UX was included because the repo contains a Next.js frontend. The designer used browser automation against a local dev server on `127.0.0.1:3013`; DB-backed pages showed localized error shells because local MySQL was unavailable.

## Agent Failures

None. Two spawn attempts hit the active child-thread limit and were retried after other reviewers completed.

## Deduped Findings

### C3-AGG-01 - `bulkUpdateImages` can mutate image/tag state during DB restore maintenance

Severity: High
Confidence: High
Status: Confirmed
Agreement: tracer

Evidence:
- `apps/web/src/app/actions/images.ts:928-933` checks same-origin/admin but does not call `getRestoreMaintenanceMessage(...)`.
- The same file guards sibling mutating image actions at `:109`, `:597`, `:693`, `:852`, and `:1128`.
- `bulkUpdateImages` mutates `images` and `imageTags` in the transaction around `apps/web/src/app/actions/images.ts:1008-1102`.

Failure scenario: an admin starts a DB restore in one tab and submits a bulk edit from another tab. The action can write against a table being reloaded, or against stale IDs from the pre-restore selection.

Fix: add the standard restore-maintenance early return before any DB read/write and add a regression/source-contract test for mutating exports in `images.ts`.

### C3-AGG-02 - Lightroom token create/revoke actions can race DB restore

Severity: Medium
Confidence: High
Status: Confirmed
Agreement: tracer

Evidence:
- `apps/web/src/app/actions/lr-tokens.ts:27-99` creates tokens without a restore-maintenance guard.
- `apps/web/src/app/actions/lr-tokens.ts:102-118` revokes tokens without a restore-maintenance guard.
- Real credential writes happen through `apps/web/src/lib/admin-tokens.ts:216-231`.

Failure scenario: an admin creates a token during restore, receives plaintext, and then the restored DB drops the hash; or revokes a token during restore and the restored backup reintroduces it.

Fix: import `getRestoreMaintenanceMessage`, guard create/revoke before mutation, keep list read-only, and add focused tests.

### C3-AGG-03 - Public analytics inserts bypass restore-maintenance quiescence

Severity: Low
Confidence: Medium
Status: Likely/manual-validation risk
Agreement: tracer

Evidence:
- `apps/web/src/app/actions/public.ts:357-408` records photo/topic/shared-group views without checking `isRestoreMaintenanceActive()`.
- `apps/web/src/lib/data.ts:48-51` already skips buffered shared-group view-count writes during maintenance.

Failure scenario: a fire-and-forget analytics write races a restore reload and inserts stale analytics data against a pre-restore ID. Most failures are swallowed, but this violates the quiescence pattern.

Fix: return early from the three view recorders when restore maintenance is active and add a source-contract test.

### C3-AGG-04 - Upload UI advertises formats the runtime pipeline rejects

Severity: Medium
Confidence: High
Status: Confirmed
Agreement: product-marketer-reviewer

Evidence:
- `apps/web/src/components/upload-dropzone.tsx:175-177` accepts `image/*` plus extensions including `.arw`, `.heic`, `.heif`, and `.bmp`.
- `apps/web/src/lib/process-image.ts:385-461` treats RAW inputs as unsupported and relies on Sharp for other decode support.
- Runtime Sharp capability evidence from the review shows HEIF suffix support only for `.avif`, no `dcraw`, no RAW file input, and no BMP suffix input.

Failure scenario: users select iPhone HEIC, BMP, or ARW files because the picker allows them, then see post-submit processing failures.

Fix: align the picker and copy with runtime-supported inputs, or add runtime capability detection plus explicit unsupported-format messaging before advertising those formats.

### C3-AGG-05 - README upload-serving guidance describes a removed nginx static-root path

Severity: Low
Confidence: High
Status: Confirmed
Agreement: document-specialist

Evidence:
- `README.md:186` and `apps/web/README.md:49` still describe checked-in nginx static serving from `/app/apps/web/public`.
- `apps/web/nginx/default.conf:167-175` now proxies uploads to Next.
- `apps/web/src/__tests__/nginx-config.test.ts:32-35` locks proxying and rejects `root /app/apps/web/public`.

Failure scenario: operators copy stale guidance and recreate an obsolete static-root deployment shape.

Fix: update both README sections to say the checked-in config proxies uploads to Next; keep host-static notes only as an optional custom-deploy caveat.

### C3-AGG-06 - README body-size guidance omits the Lightroom upload exception

Severity: Medium
Confidence: High
Status: Confirmed
Agreement: document-specialist

Evidence:
- `README.md:148` and `apps/web/README.md:46` omit `/api/admin/lr/upload`.
- `apps/web/nginx/default.conf:122-143` implements a dedicated 216 MiB longest-prefix Lightroom upload route before the generic `/api/admin/` 2 MiB cap.

Failure scenario: an operator recreates nginx body caps from README; dashboard uploads work, but Lightroom publish uploads 413 at the proxy.

Fix: document the LR 216 MiB exception in both README files and consider adding a test assertion for that route.

### C3-AGG-07 - Feed attribution docs/comments overclaim per-entry public authors

Severity: Low
Confidence: High
Status: Confirmed
Agreement: document-specialist

Evidence:
- `CLAUDE.md:170`, `apps/web/src/db/schema.ts:87-90`, and `apps/web/src/__tests__/privacy-fields.test.ts:28-30` say `uploaded_by` drives public Atom per-entry authors.
- `apps/web/src/lib/data.ts:827-839` returns `author_name: NULL`, so feed routes fall back to feed-level author.

Failure scenario: future work assumes safe per-entry authors already exist and closes the wrong gap.

Fix: update comments/docs to state `uploaded_by` is admin-only/future input; public feed per-entry authors are blocked on a safe public display name.

### C3-AGG-08 - Timeline, map, and year page titles double-append the site name

Severity: Medium
Confidence: High
Status: Confirmed
Agreement: designer

Evidence:
- Browser checks saw `Timeline | GalleryKit | GalleryKit`, `Map | GalleryKit | GalleryKit`, and `2024 in Review | GalleryKit | GalleryKit`.
- `apps/web/src/app/[locale]/layout.tsx:24-27` already applies `%s | ${seo.title}`.
- Timeline/map/year metadata also append `| ${seo.title}` manually.

Failure scenario: browser tabs and screen-reader title announcements stutter the site name on archive/map routes.

Fix: return bare route titles and let the layout template append the site title, or use absolute titles intentionally.

### C3-AGG-09 - Theme toggle accessible name does not expose current/next state

Severity: Low
Confidence: High
Status: Confirmed
Agreement: designer

Evidence:
- `apps/web/src/components/nav-client.tsx:155-160` cycles four theme states.
- The button always uses `aria-label={t('aria.toggleTheme')}`.

Failure scenario: screen-reader and keyboard users cannot tell whether the current theme is System, Light, Dark, or OLED, nor what the next activation will do.

Fix: localize a stateful label such as `Theme: {current}. Switch to {next}`, or replace the cycle with an option menu/segmented control exposing selected state.

### C3-AGG-10 - Map client chunk has no loading fallback

Severity: Low
Confidence: High
Status: Confirmed
Agreement: designer

Evidence:
- `apps/web/src/components/map/map-loader.tsx:8-10` uses `dynamic(..., { ssr: false })` without a `loading` component.
- `apps/web/src/components/map/map-client.tsx:108-112` eventually renders a 70vh map.

Failure scenario: on slow devices, users see a blank area while Leaflet loads and assistive tech gets no loading status.

Fix: add a same-size localized `role="status"` fallback/skeleton to `MapLoader`.

### C3-AGG-11 - Public analytics view-recording rate limits lack behavior tests

Severity: Medium
Confidence: High
Status: Confirmed coverage gap
Agreement: test-engineer

Evidence:
- `apps/web/src/app/actions/public.ts:316-408` implements per-IP view-recording limits and three recorders.
- `apps/web/src/__tests__/public-actions.test.ts` covers load-more/search but not `recordPhotoView`, `recordTopicView`, or `recordSharedGroupView`.

Failure scenario: a refactor moves or removes a view-record limiter; tests still pass while bots can flood analytics tables.

Fix: add tests that assert valid under-limit writes, invalid inputs do not write, over-limit calls do not write, and reset-window behavior.

### C3-AGG-12 - Public route rate-limit lint can be fooled by unreachable/nested helper calls

Severity: Medium
Confidence: High
Status: Confirmed gate blind spot
Agreement: test-engineer

Evidence:
- `apps/web/scripts/check-public-route-rate-limit.ts:107-126` walks handler ASTs and treats any pre-mutation helper call as sufficient.
- Existing fixtures do not cover unreachable branches or nested never-called local functions.

Failure scenario: a public mutating route places a limiter call in `if (false)` or in an uncalled helper, mutates uncharged, and passes the lint gate.

Fix: add failing fixtures, then make the scanner statement/control-flow aware and fail closed.

### C3-AGG-13 - Admin metadata regression test uses a static allowlist

Severity: Low
Confidence: High
Status: Confirmed test fragility
Agreement: test-engineer

Evidence:
- `apps/web/src/__tests__/client-source-contracts.test.ts:35-53` checks a hard-coded route list.
- New future admin routes can be omitted from the list.

Failure scenario: a new admin route lacks localized metadata but the static test remains green.

Fix: derive routable admin pages from the filesystem and require route or ancestor metadata coverage, with explicit exemptions.

### C3-AGG-14 - Nav visual checks capture screenshots without visual assertions

Severity: Low
Confidence: High
Status: Manual-validation risk
Agreement: critic, test-engineer

Evidence:
- `apps/web/e2e/nav-visual-check.spec.ts` asserts geometry but still writes screenshots without `toHaveScreenshot(...)`.

Failure scenario: contrast, clipping, or hierarchy regressions pass unless a human manually compares PNG artifacts.

Fix: either rename/scope as manual artifact capture or add automated visual snapshots/CSS assertions for intended invariants.

### C3-AGG-15 - Runtime `public` bind mount can mask build-generated service-worker assets

Severity: Medium
Confidence: High
Status: Confirmed production/deploy risk
Agreement: verifier, debugger

Evidence:
- `apps/web/package.json:10-11` runs `build-sw.ts` during `prebuild`.
- `apps/web/Dockerfile:71-75` runs `npm run build`.
- `apps/web/docker-compose.yml:23-26` bind-mounts host `./public` over `/app/apps/web/public`.
- Current `apps/web/public/sw.js` stamp lags current HEAD in review evidence.

Failure scenario: the image contains a freshly generated SW, but the running container serves the host-mounted committed artifact, keeping stale cache namespaces after SW logic/cache changes.

Fix: mount only mutable public data such as `./public/uploads`, or regenerate `sw.js` on the host during deploy and add a stamp consistency check.

### C3-AGG-16 - Timeline and On-This-Day queries are non-sargable, with misleading comments

Severity: Medium
Confidence: High
Status: Confirmed
Agreement: perf-reviewer, critic, debugger

Evidence:
- `apps/web/src/lib/data-timeline.ts:95-114` filters with `MONTH()`/`DAY()`.
- `apps/web/src/lib/data-timeline.ts:127-140` uses `YEAR()`.
- `apps/web/src/lib/data-timeline.ts:184-205` filters year/month pages with `YEAR()`/`MONTH()`.
- Comments at `apps/web/src/lib/data-timeline.ts:88-94` claim the On-This-Day shape stays index-friendly.

Failure scenario: larger galleries evaluate date functions over the processed image set on every dynamic render; comments make the risk easier to miss.

Fix: fix the comment immediately, use range predicates for year/month pages, and add generated date-part columns/indexes for On-This-Day/year discovery if scaling demands it.

### C3-AGG-17 - Semantic and similar search scan newest-first windows, missing older relevant embeddings

Severity: Medium
Confidence: High
Status: Confirmed scaling/product-quality risk
Agreement: code-reviewer, perf-reviewer, critic, architect, debugger

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:240-281` scans and ranks only `SEMANTIC_SCAN_LIMIT` newest embeddings.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` uses the same shape.
- `apps/web/src/lib/clip-embeddings.ts:32-40` allows a cap up to 1,000,000.

Failure scenario: older relevant photos outside the newest window cannot be returned; raising the cap shifts DB transfer and vector scoring onto the Node request path.

Fix: add operator honesty when eligible embeddings exceed the cap, keep strict production caps, replace full sort with bounded selection if caps grow, and plan a real vector/ANN or worker-backed retrieval boundary.

### C3-AGG-18 - Production CLIP embedding work escapes image-queue backpressure

Severity: Medium
Confidence: High
Status: Confirmed concurrency risk
Agreement: code-reviewer, perf-reviewer, architect, debugger

Evidence:
- `apps/web/src/lib/image-queue.ts:204-212` bounds main processing with `QUEUE_CONCURRENCY`.
- `apps/web/src/lib/image-queue.ts:512-567` starts embedding generation in a detached `void` task after the main job.
- `apps/web/src/lib/clip-model.ts:151-186` performs Sharp decode/resize, raw pixel packing, and model inference.

Failure scenario: bulk uploads with production semantic mode can run CLIP inference concurrently with subsequent Sharp processing despite `QUEUE_CONCURRENCY=1`.

Fix: introduce a bounded embedding queue or await production embeddings inside the existing queue; longer term persist embedding jobs with metrics.

### C3-AGG-19 - Process-local state is an unenforced single-instance topology boundary

Severity: Medium
Confidence: High
Status: Manual-validation/topology risk
Agreement: security-reviewer, critic, architect, debugger, code-reviewer

Evidence:
- Restore maintenance, upload tracker, public rate-limit buckets, queue state, and shared-group view-count buffers are process-local.
- `apps/web/docker-compose.yml` documents a single web instance but the app does not enforce it.

Failure scenario: accidental scale-out splits maintenance, quota, rate-limit, queue, and view-count state across processes.

Fix: add an executable single-instance guard/DB advisory lease, or move those state machines to shared storage before replica support.

### C3-AGG-20 - Loopback/direct-exposure hardening lacks regression coverage

Severity: Medium
Confidence: High
Status: Confirmed test gap
Agreement: critic

Evidence:
- Dockerfile/compose now bind to `127.0.0.1`.
- Existing nginx tests do not assert Docker/Compose loopback binding.

Failure scenario: a future config edit re-exposes the app directly on host networking, bypassing nginx limits/headers, while nginx tests still pass.

Fix: add static tests for Dockerfile and compose loopback binding.

### C3-AGG-21 - Browser upload quota settlement relies on hand-maintained rollback invariants

Severity: Medium
Confidence: High
Status: Confirmed maintainability risk
Agreement: critic, architect, debugger

Evidence:
- `apps/web/src/app/actions/images.ts:224-279` pre-claims quota and manually rolls back early branches.
- `apps/web/src/app/actions/images.ts:540-564` settles at the end.
- `apps/web/src/app/actions/images.ts:590-592` outer `finally` releases only the upload contract lock.

Failure scenario: a future awaited operation added between claim and final settlement throws without rollback, inflating quota for the tracking window.

Fix: use a scoped claim object or single `try/finally` with exactly-once settle/rollback semantics and tests for injected post-claim failure.

### C3-AGG-22 - Client search imports server-oriented CLIP env/vector module

Severity: Low
Confidence: High
Status: Confirmed boundary smell
Agreement: critic, architect

Evidence:
- `apps/web/src/components/search.tsx:19` imports `SEMANTIC_TOP_K_DEFAULT` from `@/lib/clip-embeddings`.
- `apps/web/src/lib/clip-embeddings.ts:18-40` reads server env at module scope and contains Buffer/vector helpers.

Failure scenario: future client imports from the same module pull server-only policy or heavy helpers into the browser bundle, or expose defaults that disagree with server env.

Fix: move client-safe constants to a pure shared module and add an import-boundary test.

### C3-AGG-23 - Calendar features depend on implicit server/runtime timezone semantics

Severity: Low
Confidence: Medium
Status: Likely/manual-validation risk
Agreement: critic, debugger

Evidence:
- On-This-Day and year grouping use `new Date()` / MySQL `MONTH()`/`DAY()` against timezone-less capture dates.
- `process-image.ts` intentionally stores EXIF local timestamps as `YYYY-MM-DD HH:mm:ss`.

Failure scenario: server timezone changes or runtime parsing differs; anniversaries or months shift near boundaries.

Fix: define the calendar contract and parse stored date parts directly when only year/month/day are needed.

### C3-AGG-24 - Public map loads up to 10k unclustered markers without a map-specific index

Severity: Medium
Confidence: High
Status: Confirmed scaling risk
Agreement: code-reviewer, perf-reviewer

Evidence:
- `apps/web/src/lib/data.ts:1624-1660` caps map rows at 10,000 while filtering GPS/map-visible state.
- `apps/web/src/components/map/map-client.tsx:76-143` fits and renders every marker.
- Schema lacks GPS/map-specific covering indexes.

Failure scenario: large GPS galleries cause slow SSR, large payloads, and Leaflet marker jank.

Fix: add map access-path indexes and move toward viewport/bounds loading with clustering.

### C3-AGG-25 - Smart-collection cursor pages compute `COUNT(*) OVER()` that callers discard

Severity: Low
Confidence: High
Status: Confirmed
Agreement: perf-reviewer

Evidence:
- `apps/web/src/lib/data.ts:1388-1428` always selects a window total.
- Cursor load-more callers use only images/hasMore.

Failure scenario: broad smart collections waste DB CPU on every cursor page.

Fix: fork cursor query shape to omit total count while retaining `limit + 1` lookahead.

### C3-AGG-26 - Color-pipeline backfill discovery filters on unindexed `pipeline_version`

Severity: Low
Confidence: Medium
Status: Confirmed admin-path scaling risk
Agreement: perf-reviewer

Evidence:
- `apps/web/src/lib/admin-backfill-runner.ts:370-410` filters stale rows by `processed` and nullable/versioned `pipeline_version`.
- Schema image indexes do not include `pipeline_version`.

Failure scenario: large galleries after a pipeline bump scan processed rows just to discover stale work.

Fix: add `(processed, pipeline_version, id)` if recurring backfills justify the index, or drop eager exact counts.

### C3-AGG-27 - Topic slug is a mutable natural key with manual rename fan-out

Severity: Medium
Confidence: High
Status: Confirmed design risk, currently test-fenced
Agreement: architect

Evidence:
- `topics.slug` is the primary key and multiple tables/JSON predicates reference slugs.
- `apps/web/src/app/actions/topics.ts` renames by insert/repoint/delete and JSON remap.
- A source registry test fences known FK siblings.

Failure scenario: a future slug-referencing table or JSON store is not added to the rename fan-out, causing orphaned rows or stale collection behavior.

Fix: long term introduce immutable topic IDs; short term keep registry tests strict and maintain explicit non-FK rename registries.

### C3-AGG-28 - Public image field contracts are split across manual selector mirrors

Severity: Low-Medium
Confidence: High
Status: Confirmed architecture risk, no current leak
Agreement: architect

Evidence:
- `publicSelectFields`, timeline select fields, and search enrichment selects are separate manual shapes with separate guards.

Failure scenario: a new public image path creates another manual selector and misses privacy guard updates.

Fix: extract canonical public image select modules and derive specialized subsets.

### C3-AGG-29 - `lib/api-auth.ts` depends upward on a server-action module

Severity: Low-Medium
Confidence: Medium
Status: Confirmed layering smell
Agreement: architect

Evidence:
- `apps/web/src/lib/api-auth.ts` imports `isAdmin` from `@/app/actions/auth`.
- `app/actions/auth.ts` mixes pure session helpers with action mutations.

Failure scenario: future auth refactors create circular pressure or API auth inherits action-only dependencies.

Fix: move current-user/session helpers to a server-only lib module and re-export for action compatibility.

### C3-AGG-30 - Dormant storage abstraction is quarantined but still easy to misuse

Severity: Low
Confidence: High
Status: Likely future-coupling risk
Agreement: architect

Evidence:
- `apps/web/src/lib/storage/index.ts` exposes backend APIs while comments say the abstraction is not wired.
- `storage-quarantine.test.ts` prevents non-test imports today.

Failure scenario: a future feature bypasses canonical upload/process/serve boundaries and diverges on containment, GPS stripping, and cache invalidation.

Fix: keep quarantine until a deliberate storage-backend design lands, or delete the abstraction if not planned.

## Non-Findings / Closed Current Checks

- No confirmed critical/high code-level security vulnerability beyond the high restore-maintenance mutation gap.
- Admin API auth, server-action origin, public mutating route rate-limit gates passed in multiple reviewer lanes.
- Full lint/typecheck/unit/build evidence was produced by reviewer lanes; exact lifecycle build was intentionally avoided in one lane to avoid regenerating `sw.js`, but other lanes reported build success.
- Cycle-2 Docker context leakage and direct standalone exposure default are fixed in source.
- Payment/Stripe, S3/MinIO support claims, and semantic-search production gating are source-backed and not re-filed.

## Summary Counts

- Deduped findings: 30
- Critical: 0
- High: 1
- Medium / Low-Medium: 18
- Low: 11
- Agent failures: 0

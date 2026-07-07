# Cycle 11 Critic Review

Date: 2026-07-07 KST
Reviewer: critic
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: whole-repository skeptical review. I did not edit source or plans; this file is the only assigned write.

## Inventory And Method

Read first: `AGENTS.md`, `CLAUDE.md`, latest root/cycle review artifacts, latest deferred register, and current git history through `b965e3bf`.

Inspected broadly:

- Product/public routes: home, timeline/year, map, photo/share pages, search/semantic/similar, feed/OG/upload routes.
- Admin/security/ops surfaces: server actions, admin APIs, auth/origin/rate-limit lint gates, restore, deploy script, nginx template, Dockerfile, CI.
- Data/architecture surfaces: `data.ts`, `data-timeline.ts`, Drizzle schema/migrations, `migrate.js`, queue/backfill, CLIP embeddings, maintenance scheduler, single-writer guard.
- UX/test surfaces: Playwright specs, touch-target audit, bottom sheet/dropdown tests, visual screenshot checks.
- Prior drift: compared Cycle 10 findings against the follow-up commits now on `master`.

Validation evidence collected:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- Focused Vitest passed: `data-timeline`, `semantic-embedding-storage-contract`, `maintenance-scheduler-source`, `background-db-writes`, `topics-actions`, `touch-target-audit` = 6 files / 64 tests.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate --json` failed with 2 moderate vulnerabilities via Next's nested PostCSS.
- `npm view next version` returned `16.2.10`; `npm view postcss version` returned `8.5.16`; `npm ls postcss next --workspace=apps/web` shows top-level `postcss@8.5.16` plus `next/node_modules/postcss@8.4.31`.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 8
- Low: 1

Confirmed issues are source- or command-proven. Risks needing validation are real repository risk shapes whose production impact depends on live scale/topology/operator state.

## Findings

### C11-CRIT-01 - Production audit remains red on Next's nested PostCSS

Severity: Medium
Confidence: High
Status: Confirmed issue

Locations: `apps/web/package.json:59`, `package.json:7-9`, `package-lock.json:9194`, `package-lock.json:9204`, `package-lock.json:9334`, `package-lock.json:9850`.

Why: the repo pins/overrides top-level PostCSS to `8.5.16`, but `next@16.2.10` still declares and installs nested `postcss@8.4.31`. `npm audit --omit=dev` reports GHSA-qx2v-qp2m-jg93 through `node_modules/next/node_modules/postcss`.

Failure scenario: if any current or future path feeds attacker-influenced CSS through Next's bundled PostCSS stringify path and embeds it into a page, the known `</style>` escaping bug can become XSS. I did not confirm an arbitrary-CSS input today, so exposure is conditional, but the production dependency gate is failing now.

Fix: upgrade to a stable Next release that removes the vulnerable nested dependency, or prove a targeted npm override/resolution replaces `next/node_modules/postcss` without breaking the full gate suite. Do not take `npm audit fix --force`; audit suggests a bad major downgrade.

### C11-CRIT-02 - Date-function scans remain on dynamic public archive/home paths

Severity: Medium
Confidence: High
Status: Confirmed issue

Locations: `apps/web/src/lib/data-timeline.ts:111`, `apps/web/src/lib/data-timeline.ts:124`, `apps/web/src/lib/data-timeline.ts:125`, `apps/web/src/lib/data-timeline.ts:143`, `apps/web/src/lib/data-timeline.ts:146`, `apps/web/src/lib/data-timeline.ts:155`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:77`, `apps/web/src/app/[locale]/(public)/page.tsx:232`, `apps/web/src/app/[locale]/(public)/page.tsx:234`, `apps/web/src/components/on-this-day-widget.tsx:15`, `apps/web/src/components/on-this-day-widget.tsx:21`.

Why: Cycle 10 fixed `getTimelineImages()` to use sargable date ranges, but `getTimelineYears()` still uses `YEAR(capture_date)` for `SELECT DISTINCT` and ordering, while `getOnThisDayImages()` still uses `MONTH()` and `DAY()`. Both feed `revalidate = 0` public SSR paths.

Failure scenario: as the gallery grows, homepage and `/timeline` requests from visitors or crawlers repeatedly force MySQL to scan/evaluate the processed dated image set instead of seeking fully through the `(processed, capture_date, created_at)` index. That competes with uploads, admin work, and normal public gallery reads on the single writer.

Fix: for the year list, maintain a generated/indexed capture year or cached year rollup invalidated on image metadata changes. For On This Day, add generated/indexed `capture_mmdd` or `(capture_month, capture_day)` columns, or cache the daily result. Update `data-timeline.test.ts:50` so tests stop locking the non-sargable `MONTH()`/`DAY()` shape as expected behavior.

### C11-CRIT-03 - Public map still ships a 10k-marker corpus and duplicate list

Severity: Medium
Confidence: Medium-High
Status: Risk needing scale validation

Locations: `apps/web/src/lib/data.ts:1750`, `apps/web/src/lib/data.ts:1759`, `apps/web/src/lib/data.ts:1768`, `apps/web/src/lib/data.ts:1776`, `apps/web/src/lib/data.ts:1777`, `apps/web/src/app/[locale]/(public)/map/page.tsx:14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42`, `apps/web/src/app/[locale]/(public)/map/page.tsx:45`, `apps/web/src/app/[locale]/(public)/map/page.tsx:98`, `apps/web/src/app/[locale]/(public)/map/page.tsx:99`, `apps/web/src/components/map/map-client.tsx:87`, `apps/web/src/components/map/map-client.tsx:90`, `apps/web/src/components/map/map-client.tsx:120`.

Why: `/map` is dynamic and `getMapImages()` can return `MAP_MAX_MARKERS + 1` rows. The server serializes up to 10,000 markers to the client, renders a fallback `<ul>` for each marker, and Leaflet renders one `<Marker>` per image. `FitBounds` allocates two full coordinate arrays and spreads them into `Math.min/max`.

Failure scenario: a GPS-heavy archive or crawler traffic loads `/map` on mobile. The server emits a huge RSC/client payload, React hydrates thousands of links, Leaflet instantiates thousands of markers, and the main thread stalls before the map is usable.

Fix: validate with `EXPLAIN ANALYZE` on sparse/dense GPS data. Add a map-oriented access path, then switch to viewport/bounds loading with clustering or a canvas/WebGL marker layer. Virtualize or paginate the accessible list and compute bounds in one pass.

### C11-CRIT-04 - Legacy reconcile is still a second schema authority with mostly source-only coverage

Severity: Medium
Confidence: High
Status: Confirmed maintainability risk

Locations: `apps/web/scripts/migrate.js:348`, `apps/web/scripts/migrate.js:397`, `apps/web/scripts/migrate.js:684`, `apps/web/scripts/migrate.js:702`, `apps/web/scripts/migrate.js:717`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:15`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:100`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175`.

Why: `reconcileLegacySchema()` hand-writes the current schema. The tests explicitly say they are source tripwires and cannot verify types/defaults, then mostly assert table/column/index/FK name presence. A small binary/vector structural pin was added, but most schema attributes remain unchecked.

Failure scenario: a future migration changes a column type/default/nullability, index column order, uniqueness, or FK action while keeping the same names. CI passes because the names appear in `migrate.js`; a DB repaired through reconcile diverges from one built through normal migrations.

Fix: add an integration parity gate using two disposable MySQL schemas: one built by committed migrations and one through reconcile/baseline, then diff `information_schema.columns`, `statistics`, and FK rules. If that is too heavy for every PR, run it in scheduled CI and require it for migration changes.

### C11-CRIT-05 - Real CLIP activation proof is manual and skipped by default CI

Severity: Medium
Confidence: High
Status: Confirmed release-risk gap

Locations: `apps/web/src/__tests__/clip-offline-load.test.ts:15`, `apps/web/src/__tests__/clip-offline-load.test.ts:41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30`, `apps/web/package.json:21`, `apps/web/package.json:23`, `.github/workflows/quality.yml:66`, `.github/workflows/quality.yml:76`, `.github/workflows/quality.yml:79`.

Why: the real model suites only run when seeded weights and env vars are present. The normal CI workflow runs unit/e2e/build gates but not `test:clip:preflight`. Route tests can pass with mocks/stubs while the offline ONNX/model-weight path is broken.

Failure scenario: a dependency upgrade, model layout change, `CLIP_MODELS_ROOT` mismatch, or native runtime change breaks `embedTextReal`/`embedImageReal`. Default CI stays green; an operator enables production semantic search and public queries return 503 or bad rankings.

Fix: add a scheduled or opt-in CI job that seeds/caches the pinned weights and runs `npm run test:clip:preflight --workspace=apps/web`, especially on CLIP/dependency changes. Alternatively make production activation require a recent preflight marker produced by the exact sidecar/runbook path.

### C11-CRIT-06 - Nginx security/performance controls remain outside deploy visibility

Severity: Medium
Confidence: High
Status: Risk needing live-host validation

Locations: `CLAUDE.md:485`, `apps/web/deploy.sh:51`, `apps/web/deploy.sh:55`, `apps/web/nginx/default.conf:1`, `apps/web/nginx/default.conf:10`, `apps/web/nginx/default.conf:19`, `apps/web/nginx/default.conf:46`, `apps/web/nginx/default.conf:59`, `apps/web/nginx/default.conf:69`.

Why: docs correctly state that deploys rebuild/restart Docker only; the committed nginx template is operator-applied. That template contains important public/admin rate limits, connection limits, body-size caps, HSTS, and proxy IP attribution caveats.

Failure scenario: a future edge-rate-limit/body-size/proxy-header fix lands, all repo gates pass, and `npm run deploy` succeeds. Production keeps running the old host nginx config, so the issue is marked closed in source while live traffic remains exposed.

Fix: make nginx drift visible. Add a deployed-template hash/version check to deploy output, or make nginx apply/reload an explicit gated deploy step with `nginx -t`, reload, and live limiter/body-size smoke evidence recorded in the cycle ledger.

### C11-CRIT-07 - Single-writer correctness remains warn-only

Severity: Medium
Confidence: High
Status: Confirmed operational risk

Locations: `CLAUDE.md:236`, `CLAUDE.md:237`, `apps/web/src/instrumentation.ts:22`, `apps/web/src/instrumentation.ts:27`, `apps/web/src/lib/single-writer-guard.ts:7`, `apps/web/src/lib/single-writer-guard.ts:12`, `apps/web/src/lib/single-writer-guard.ts:218`, `apps/web/src/lib/single-writer-guard.ts:234`.

Why: the app has correctness-relevant process-local state and a documented single-web-instance topology, but lock contention only logs a loud warning and startup continues.

Failure scenario: a deploy system or manual operator starts two `gallerykit-web` containers against one DB. Both serve traffic. Upload quota tracking, restore fences, image queue state, in-memory fast-path rate limits, and status surfaces split across processes; users see inconsistent behavior before anyone notices logs.

Fix: add an opt-in production enforcement mode, for example `GALLERYKIT_ENFORCE_SINGLE_WRITER=true`, that fails readiness or exits after persistent advisory-lock contention. Longer term, move correctness-critical coordination to DB/advisory-lock-backed state.

### C11-CRIT-08 - Mobile bottom-sheet dropdown regression lock is source-string only

Severity: Medium
Confidence: High
Status: Confirmed test-oracle gap

Locations: `apps/web/src/components/info-bottom-sheet.tsx:562`, `apps/web/src/components/info-bottom-sheet.tsx:570`, `apps/web/src/components/info-bottom-sheet.tsx:573`, `apps/web/src/components/info-bottom-sheet.tsx:575`, `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14`, `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:20`, `apps/web/e2e/test-fixes.spec.ts:56`, `apps/web/e2e/test-fixes.spec.ts:64`, `apps/web/e2e/focus-restore.spec.ts:49`, `apps/web/e2e/focus-restore.spec.ts:52`.

Why: the unit test asserts that source strings contain the portal container/ref wiring. Existing Playwright coverage opens/closes the sheet, but does not open the dropdown, assert it is visible inside the dialog stacking context, or verify focus/escape behavior.

Failure scenario: a Radix, portal, ref, CSS, or focus-trap change leaves `container={sheetElement ?? undefined}` in source but renders the menu behind the overlay, outside the focus trap, clipped by the sheet, or unfocusable on mobile. Tests still pass.

Fix: add a Playwright mobile behavior test that opens a photo, opens the info sheet, opens the download dropdown on a seeded wide-gamut/P3 photo, verifies menu visibility and dialog containment, selects/closes it, and checks focus return.

### C11-CRIT-09 - Touch-target gate intentionally lets bare text links pass

Severity: Low
Confidence: High
Status: Confirmed test-oracle gap

Locations: `apps/web/src/__tests__/touch-target-audit.test.ts:457`, `apps/web/src/__tests__/touch-target-audit.test.ts:464`, `apps/web/src/__tests__/touch-target-audit.test.ts:1053`, `apps/web/src/__tests__/touch-target-audit.test.ts:1059`.

Why: the repo policy says every interactive element should meet 44 px, but the source scanner explicitly lets plain text links with no sizing token pass. This is intentional for inline prose links, but it also allows future control-like links to bypass the gate.

Failure scenario: a developer implements a mobile control as `<Link className="text-sm hover:underline">Delete</Link>` or a small nav/action link. The regex audit stays green while the rendered target is below the 44 px floor.

Fix: add a DOM-level Playwright touch-target audit over representative pages, or require an explicit inline-text allowlist for bare links while keeping control-like links under the 44 px scanner.

## Prior Drift Disposition

Closed since Cycle 10:

- Docker native pins now match the lockfile: `apps/web/Dockerfile:55-60` aligns with `package-lock.json:9216-9219` and `package-lock.json:9304-9310`.
- Binary CLIP embedding schema is now `mediumblob`: `apps/web/src/db/schema.ts:292-295`.
- `getTimelineImages()` now uses range predicates: `apps/web/src/lib/data-timeline.ts:195-215`.
- Maintenance scheduler shutdown/drain is now wired: `apps/web/src/lib/maintenance-scheduler.ts:41-75`, `apps/web/src/instrumentation.ts:53-60`.
- Analytics view params and rate-limit admission are captured before queueing: `apps/web/src/app/actions/public.ts:446-455`, `apps/web/src/app/actions/public.ts:486-495`, `apps/web/src/app/actions/public.ts:523-532`.
- Topic deletion now fails closed on malformed smart collection predicates: `apps/web/src/app/actions/topics.ts:475-482`.
- Search result labels now use title/tag/description fallback: `apps/web/src/components/search.tsx:71`, `apps/web/src/lib/photo-title.ts:85-105`.

Still open or partially open:

- PostCSS audit risk, map scale, reconcile structural parity, CLIP preflight, bottom-sheet behavior coverage, touch-target bare links, nginx deploy visibility, and single-writer enforcement remain valid.
- The Cycle 10 date-query finding is partially closed only: `getTimelineImages()` is fixed, but `getTimelineYears()` and On This Day still use date functions on dynamic public paths.

## Final Missed-Issue Sweep

I re-scanned route/action exemptions, skipped tests, TODO/FIXME/HACK/manual markers, dependency/version drift, sensitive-field projection tests, migration/reconcile coverage, and generated-vs-source claims after drafting. I did not find a current admin auth bypass, public original-file exposure, focused `.only` test, migration journal omission, or failed type/lint gate. Remaining blind spots are production cardinality, live host nginx state, real CLIP weights, and real mobile/browser interaction behavior for the bottom-sheet dropdown and touch targets.

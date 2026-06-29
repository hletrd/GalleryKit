# Code Reviewer — review-plan-fix cycle 3

**Date:** 2026-06-29
**HEAD:** `3f24038b04f48c73f5dac079cd3276fecbd48282`
**Role:** code-reviewer
**Scope:** current HEAD only; repository-wide code quality, logic, SOLID/maintainability, edge cases, error handling, cross-file interaction, and regression-risk review. No application code edited.

## Inventory Coverage

Built inventory before review from `AGENTS.md`, `CLAUDE.md`, current `.context/reviews/*`, current `.context/plans/*`, recent `run9-cycle8` review history, `git status`, `git log -20`, current HEAD diff since cycle 2 review (`3d138704..HEAD`), package/config files, source-tree enumeration, tests/scripts/migrations, and direct source reads.

Review-relevant inventory covered:

- Instructions/context: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, previous `.context/reviews/code-reviewer.md`, security/perf/test top-level reviews, `.context/plans/cycle-2-2026-06-29-{plan,deferred}.md`, `.context/plans/cycle-3-plan.md`, and latest `run9-cycle8` aggregate/code-reviewer artifacts to avoid stale fixed claims.
- Current HEAD delta after cycle 2 review: `.dockerignore`, `AGENTS.md`, `apps/web/Dockerfile`, `apps/web/README.md`, `apps/web/scripts/backfill-clip-embeddings.ts`, admin metadata helpers/pages, timeline/year metadata and card labeling, nav e2e assertions, browser upload enqueue test coverage, and committed review/plan docs.
- Runtime source inventory: 476 TypeScript/TSX files under `apps/web/src`, including app routes/actions, components, libs, DB schema, proxy, and instrumentation.
- Guard/test inventory: 245 unit test files under `apps/web/src/__tests__`, 8 e2e/helper/fixture files under `apps/web/e2e`, 27 scripts, and 28 Drizzle SQL/meta files.
- Focus sweeps: admin API wrappers, server-action origin gates, public route rate-limit gates, public privacy selectors, map GPS exposure, upload enqueue settings flow, semantic search and embedding paths, restore/backfill locks, raw SQL/process execution, JSON parsing, generated Docker/build context, and hidden local runtime directories.

## Validation Evidence

- `npm run lint --workspace=apps/web` — pass.
- `npm run lint:api-auth --workspace=apps/web` — pass; 2 admin API routes wrapped.
- `npm run lint:action-origin --workspace=apps/web` — pass; mutating actions enforce same-origin provenance or documented exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — pass; semantic route is rate-limited and public mutating route scan passes.
- `npm run typecheck --workspace=apps/web` — pass.
- `npm test --workspace=apps/web -- client-source-contracts images-actions nginx-config sw-template-contract semantic-search-route` — pass, 5 files / 55 tests.
- `npm test --workspace=apps/web` — pass, 243 files passed / 2 skipped, 2238 tests passed / 4 skipped.
- `npm run build --workspace=apps/web` — pass on rerun. The first attempt stopped at Next's transient "Another next build process is already running" guard after prebuild; process/lock inspection found no live build, and the immediate rerun completed successfully. Local DB was unavailable, and sitemap fell back to homepage-only as designed.

## Confirmed Issues

None found.

The cycle-2 confirmed fixes are present at current HEAD:

- `.claude/` is now excluded from the root Docker context (`.dockerignore:8-9`), closing AGG-C2-01.
- The standalone Docker image defaults to localhost binding (`apps/web/Dockerfile:83-85`), reducing direct-exposure footguns.
- The CLIP pre-enable production backfill examples now use `--production --force` (`apps/web/README.md:35-37`, `apps/web/scripts/backfill-clip-embeddings.ts:6-21`).
- Admin routes now export localized metadata helpers (`apps/web/src/app/[locale]/admin/admin-metadata.ts:16-31` plus the route exports), and typecheck/build validated the App Router signatures.
- Timeline/year cards use localized fallback labels and action-oriented aria labels (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:214-233`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:175-191`).
- Browser upload enqueue tests now assert the full processing/settings payload (`apps/web/src/__tests__/images-actions.test.ts:222-259`), matching the runtime forwarding in `apps/web/src/app/actions/images.ts:466-502`.

## Likely Issues

None at actionable confidence. Candidate regressions around route metadata signatures, timeline/year i18n, build/Docker context, upload settings forwarding, and nav e2e assertions were checked against source plus lint/type/build/tests and did not hold.

## Risks Needing Manual Validation

### RISK-C3-01 — Production CLIP embeddings can overlap Sharp queue work

**Severity:** Medium  
**Confidence:** High  
**Status:** Current scaling/concurrency risk; already deferred as DEF-C2-03, not a new regression  
**Location:** `apps/web/src/lib/image-queue.ts:490-567`, `apps/web/src/lib/clip-model.ts:151-186`

Failure scenario: after `processImageFormats()` finishes, the queue commits `processed=true` and starts embedding in a detached async IIFE. A batch upload in production semantic mode can leave CLIP inference running while the next Sharp job begins, so CPU/RSS can exceed what `QUEUE_CONCURRENCY` alone suggests.

Concrete fix: add a bounded embedding queue (`EMBEDDING_CONCURRENCY=1` by default) or await production embeddings inside the existing image-processing queue when immediate search availability is required. Add queue-depth/duration logging before increasing upload/semantic throughput.

### RISK-C3-02 — Semantic and similar search remain bounded brute-force scans

**Severity:** Medium  
**Confidence:** High  
**Status:** Current scaling/relevance risk; already deferred as DEF-C2-04  
**Location:** `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, `apps/web/src/lib/clip-embeddings.ts:32-40`

Failure scenario: both routes read the newest `SEMANTIC_SCAN_LIMIT` embedding blobs and score them synchronously in the request path. At the default 2000 rows this is bounded, but larger operator overrides can block the event loop, and newest-first scanning can omit older relevant images.

Concrete fix: keep production scan limits conservative, emit an operator warning when embedding count exceeds the cap, use a heap/partial selection instead of full sorting if the cap grows, and move to a worker/vector-index boundary before raising limits materially.

### RISK-C3-03 — Public map still loads up to 10,000 unclustered markers

**Severity:** Medium  
**Confidence:** High  
**Status:** Current map scalability risk; already deferred as DEF-C2-02  
**Location:** `apps/web/src/lib/data.ts:1628-1660`, `apps/web/src/components/map/map-client.tsx:80-143`, `apps/web/src/db/schema.ts:111-117`

Failure scenario: a GPS-heavy gallery can request and hydrate thousands of markers, compute bounds over all points, and mount one Leaflet marker per photo. The query has no latitude/longitude or map-visibility-specific index in the current image index set.

Concrete fix: validate the query with `EXPLAIN`, add an index or denormalized map-visibility query shape if needed, and switch the UI to viewport/bounds loading or clustering before large GPS collections approach the 10k cap.

### RISK-C3-04 — Restore maintenance is process-local by design

**Severity:** Medium  
**Confidence:** High  
**Status:** Current topology risk only under unsupported horizontal scaling; already deferred as DEF-C2-07  
**Location:** `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:266-354`, `CLAUDE.md:224-227`

Failure scenario: the DB restore advisory lock is DB-wide, but the maintenance flag that blocks uploads and other mutating actions is held in `globalThis`. In a multi-instance deployment, another process can miss maintenance mode and accept writes during restore.

Concrete fix: keep the documented single-instance topology enforced, or move restore maintenance and other process-local coordination state into DB/shared storage before scaling horizontally.

## Non-Findings / Stale Claims Avoided

- The prior `.claude/` Docker context issue is fixed; root `.dockerignore` now includes both `.claude` and `.claude/`.
- The prior direct-container default exposure risk was reduced; `HOSTNAME` now defaults to `127.0.0.1` in the Dockerfile.
- The prior CLIP operator-flow doc issue is fixed; current script and README examples include `--production --force` for pre-enable backfills.
- The prior browser-upload settings coverage gap is fixed; `images-actions.test.ts` asserts all queued settings and targeted tests pass.
- The prior admin route title/i18n timeline/year issues are fixed in current source and validated by typecheck/build/source-contract tests.
- The build script still rewrites `apps/web/public/sw.js` to the current commit stamp during `prebuild`. This is existing project behavior and was treated as validation side effect, not a product defect.

## Final Missed-Issues Sweep

Final sweep covered: changed files since cycle 2, public/admin route handlers, server-action guards, route metadata signatures, i18n key usage, privacy projections, GPS/map exposure, raw SQL and process execution, restore/advisory-lock release paths, upload queue/settings propagation, semantic search request paths, CLIP embedding hooks, Docker/build context, hidden local runtime directories, focused tests, full unit suite, lint, typecheck, and build.

Verdict: **0 confirmed issues, 0 likely issues, 4 current risks needing manual/operational validation.**

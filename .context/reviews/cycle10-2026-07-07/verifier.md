# Cycle 10 Verifier Review - 2026-07-07

Persona: verifier  
Repository: `/Users/hletrd/flash-shared/gallery`  
Mode: evidence-based correctness check. I did not edit application source.

## Inventory First

I built the repository inventory before selecting review targets.

- Branch: `master`
- Tracked files: 3401 from `git ls-files`
- Route/page files under `apps/web/src/app`: 34 matching `route.ts`, `route.tsx`, or `page.tsx`
- Library modules under `apps/web/src/lib`: 111 files
- Unit test files under `apps/web/src/__tests__`: 351 files
- E2E files under `apps/web/e2e`: 12 files
- Main gate definitions inspected: root `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`
- Project rules inspected: prompt-provided `AGENTS.md` rules and `CLAUDE.md`
- Cycle 10 specialist reports inspected: `architect.md`, `security-reviewer.md`, `test-engineer.md`, `perf-reviewer.md`, and the pre-existing untracked `code-reviewer.md`

## Verification Run

Passing checks:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- Focused Vitest subset:
  - `src/__tests__/data-timeline.test.ts`
  - `src/__tests__/data-timeline-truncation.test.ts`
  - `src/__tests__/map-get-images-behavior.test.ts`
  - `src/__tests__/map-privacy.test.ts`
  - `src/__tests__/migrate-reconcile-coverage.test.ts`
  - `src/__tests__/clip-offline-load.test.ts`
  - `src/__tests__/clip-semantic-integration.test.ts`
  - Result: 5 files passed, 2 skipped; 117 tests passed, 4 skipped.

Failing check:

- `npm audit --workspace=apps/web --omit=dev`
  - Fails with 2 moderate vulnerabilities for `postcss <8.5.10` through `next`'s nested dependency path.

## Findings

### VER-C10-01 - Nested Next PostCSS remains audit-vulnerable

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/package.json:59`
  - `package.json:7-9`
  - `package-lock.json:9194-9205`
  - `package-lock.json:9334-9337`
  - `package-lock.json:9850-9853`
- Evidence: app depends on `next` `^16.2.10`; root override pins top-level `postcss` to `8.5.16`, but the lockfile still installs `node_modules/next/node_modules/postcss@8.4.31`. `npm audit --workspace=apps/web --omit=dev` fails on GHSA-qx2v-qp2m-jg93 and suggests `npm audit fix --force`, which would install `next@9.3.3`.
- Failure scenario: if attacker-influenced CSS reaches Next's bundled PostCSS stringify path and is later embedded in an HTML style context, the known `</style>` escaping issue can become script execution. I did not find a direct arbitrary-CSS public input path, so practical exposure appears limited, but the production dependency is still audit-failing.
- Concrete fix: upgrade to the first stable Next release that removes the vulnerable nested PostCSS dependency, then regenerate the lockfile and rerun lint/typecheck/build/test. If upstream is not available, evaluate a targeted npm override for Next's nested PostCSS only if the full gates pass. Do not use `npm audit fix --force` because it proposes a major downgrade.

### VER-C10-02 - Drizzle schema models binary embeddings as text

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/src/db/schema.ts:271-291`
  - `apps/web/drizzle/0012_image_embeddings.sql:5-8`
  - `apps/web/scripts/migrate.js:684-692`
- Evidence: the TypeScript schema declares `imageEmbeddings.embedding` as `text("embedding")`, while committed SQL and `reconcileLegacySchema` create `embedding mediumblob NOT NULL`. Source comments acknowledge that mysql2 returns `Buffer` at runtime and the Drizzle type is only an approximation.
- Failure scenario: future schema generation, diffing, or type-driven refactoring can treat `text` as authoritative and propose/apply a text conversion for a binary vector column. That risks charset corruption, bad migrations, and continued casts around embedding reads/writes.
- Concrete fix: replace the schema approximation with a Drizzle MySQL `customType` or local binary-column helper that emits `mediumblob` and exposes a `Buffer`-typed runtime value. Keep decode validation at API boundaries, and add a regression test that fails if the Drizzle schema says `text("embedding")` while migration/reconcile SQL says `mediumblob`.

### VER-C10-03 - Legacy reconcile is still a second schema authority with name-only coverage

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/scripts/migrate.js:348-730`
  - `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`
  - `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-102`
  - `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-171`
- Evidence: `reconcileLegacySchema` hand-writes the schema. The test explicitly says it is a source tripwire, not a structural validator, and the assertions check only table/column/index/FK name presence in source.
- Failure scenario: a future migration changes a column type, default, nullability, `ON UPDATE`, index column order, uniqueness, or FK action while `migrate.js` still mentions the same names. The source tripwire passes, but fresh or rebaselined databases can diverge from databases that applied migrations normally.
- Concrete fix: add a structural schema parity gate. Prefer two disposable MySQL schemas, one built from committed migrations and one from the reconcile/baseline path, then compare `information_schema.columns`, `statistics`, and `referential_constraints`. If that is too heavy for every PR, run it in CI/integration and add parser checks for high-risk tables.

### VER-C10-04 - Real CLIP semantic-search coverage is skipped by default gates

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`
  - `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`
  - `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`
  - `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`
  - `apps/web/package.json:21-24`
  - `.github/workflows/quality.yml:66-80`
- Evidence: both real-model CLIP suites use `describe.skip` unless env/model weights are present. The quality workflow runs normal unit tests, DB init, e2e, and build, but does not run `test:clip:preflight`. The focused verifier test run reported 2 skipped files and 4 skipped tests from these suites.
- Failure scenario: a model layout change, transformer/ONNX runtime change, or production `CLIP_MODELS_ROOT` mismatch breaks offline model loading or semantic ranking while all required default gates stay green.
- Concrete fix: add an opt-in or scheduled CI job that caches/seeds the pinned weights and runs `npm run test:clip:preflight --workspace=apps/web`, especially on dependency/model changes. If full weights are too heavy, add a hermetic loader contract that exercises the same offline path, revision layout, `allowRemoteModels=false`, and output-key handling.

### VER-C10-05 - Dynamic timeline/year/home queries use non-sargable date predicates

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/src/lib/data-timeline.ts:97-116`
  - `apps/web/src/lib/data-timeline.ts:129-141`
  - `apps/web/src/lib/data-timeline.ts:186-207`
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:92-103`
  - `apps/web/src/app/[locale]/(public)/page.tsx:17-19`
  - `apps/web/src/app/[locale]/(public)/page.tsx:232-234`
- Evidence: `getOnThisDayImages` filters with `MONTH(capture_date)` and `DAY(capture_date)`. `getTimelineYears` and `getTimelineImages` use `YEAR(capture_date)` and optional `MONTH(capture_date)`. The public consumers are `revalidate = 0`, so these are fresh SSR queries. The current `data-timeline.test.ts` source tests also lock in the non-sargable function shape rather than rejecting it.
- Failure scenario: as the image table grows, homepage, timeline, and year pages scan/evaluate the processed dated image set per request instead of seeking into the `(processed, capture_date, created_at)` index. Crawlers or bursts on public dynamic pages can consume DB CPU and pool budget needed by normal gallery/photo requests.
- Concrete fix: replace year/month filters with date ranges where possible, e.g. `capture_date >= 'YYYY-01-01 00:00:00' AND capture_date < 'YYYY+1-01-01 00:00:00'`, and month ranges for month filters. For cross-year On This Day, add generated/indexed month/day or `MMDD` columns, or cache per local day and invalidate on metadata changes. Update the source tests to reject `YEAR(`, `MONTH(`, and `DAY(` on `images.capture_date`.

### VER-C10-06 - Public map query/render path is capped but still expensive at scale

- Severity: Medium
- Confidence: Medium
- Location:
  - `apps/web/src/lib/data.ts:1741-1768`
  - `apps/web/src/lib/data.ts:1779-1781`
  - `apps/web/src/db/schema.ts:43-44`
  - `apps/web/src/db/schema.ts:117-125`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:42-46`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:98-109`
  - `apps/web/src/components/map/map-client.tsx:120-139`
- Evidence: `getMapImages` filters by `processed`, `topics.map_visible`, and non-null latitude/longitude, then orders and returns up to `MAP_MAX_MARKERS + 1`. The schema has latitude/longitude columns and image indexes, but no dedicated GPS/map-visible access path. The client renders each marker and the page also renders a fallback list for every marker up to the 10,000 cap.
- Failure scenario: with many processed images and sparse GPS/map-visible rows, each `/map` request can walk a large image range to find qualifying rows. With dense GPS data near the cap, the response serializes and hydrates thousands of Leaflet markers and list links on a dynamic public page.
- Concrete fix: validate with `EXPLAIN ANALYZE` on sparse and dense production-like data, then add an access path such as prefetching map-visible topic slugs plus topic-indexed image lookup, a generated `has_gps` column/index, or a purpose-built `(topic, processed, latitude, longitude, capture_date, created_at, id)` index. Add clustering or viewport/bounds pagination before marker counts approach the current cap.

### VER-C10-07 - Touch-target gate intentionally lets bare text links pass

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`
  - `apps/web/src/__tests__/touch-target-audit.test.ts:1053-1059`
- Evidence: the scanner comments state that plain text links never trip the anchor touch-target pattern, and fixtures explicitly include a plain text `<Link>` with no sizing token as a non-failing case.
- Failure scenario: a future public/admin control implemented as a plain `<Link className="text-sm ...">` can render below the 44 px mobile touch-target requirement while the source scanner stays green. This conflicts with the repo rule that every interactive element must meet the 44 px minimum.
- Concrete fix: add a DOM-level Playwright audit over representative public and admin pages that measures visible anchors/buttons/inputs/selects/role controls, or extend the source scanner to require an explicit inline-text allowlist for bare links. Keep the current regex audit as a fast prefilter, but make visible page measurements authoritative.

### VER-C10-08 - Maintenance scheduler starts in production but is not owned by shutdown

- Severity: Low
- Confidence: High
- Location:
  - `apps/web/src/instrumentation.ts:7-10`
  - `apps/web/src/instrumentation.ts:49-59`
  - `apps/web/src/lib/maintenance-scheduler.ts:56-88`
- Evidence: startup calls `startMaintenanceScheduler()`. Shutdown drains the image queue, shared-group view-count buffer, background DB writes, and single-writer guard, but it does not stop the maintenance interval or await active maintenance sweeps. The scheduler exposes restore/test drain helpers, not a production shutdown owner.
- Failure scenario: current sweeps are cleanup-oriented, so immediate risk is low. Still, SIGTERM can be reported as clean while scheduler DB work is still in flight or about to be cut off by `process.exit()`. Future non-idempotent maintenance work would inherit this asymmetric lifecycle.
- Concrete fix: add a production `stopMaintenanceScheduler({ timeoutMs })` API that clears the interval and awaits active sweeps using the existing drain logic. Include it in the `Promise.all` shutdown block and add a source-contract test that startup and shutdown ownership remain paired.

### VER-C10-09 - Host nginx fixes can be mistaken as deployed when only committed

- Severity: Medium
- Confidence: High
- Location:
  - `CLAUDE.md:483-495`
  - `apps/web/deploy.sh:51-55`
  - `apps/web/nginx/default.conf:1-29`
- Evidence: docs state `apps/web/nginx/default.conf` is a committed template and deploys do not touch host nginx. `deploy.sh` rebuilds/starts Docker Compose only. The template contains material security/performance controls such as `zone=public`, `zone=nextimage`, and real-IP caveats.
- Failure scenario: a rate-limit/body-size/proxy fix lands in the committed nginx template, `npm run deploy` succeeds, and the issue is marked closed. Production still runs the previous host nginx config until an operator applies and verifies it manually.
- Concrete fix: make nginx drift visible. Add a CI or deploy-time check that compares the committed template version/hash to a recorded deployed hash and fails or prints a blocking "prod-apply pending" warning when they differ. If nginx should remain manual, require ledger evidence for `nginx -t`, reload, and live limiter/body-size verification before closing nginx findings.

### VER-C10-10 - Nav visual check saves screenshots but has no visual oracle

- Severity: Low
- Confidence: High
- Location:
  - `apps/web/e2e/nav-visual-check.spec.ts:40-87`
  - `apps/web/e2e/nav-visual-check.spec.ts:58`
  - `apps/web/e2e/nav-visual-check.spec.ts:72`
  - `apps/web/e2e/nav-visual-check.spec.ts:85`
- Evidence: the spec writes mobile/desktop screenshots to `test-results/`, but it never compares them with `toHaveScreenshot` or any other baseline. It only asserts visibility and target stability.
- Failure scenario: nav visual hierarchy, color, spacing, wrapping, or density can regress while screenshots are merely overwritten as artifacts and CI remains green.
- Concrete fix: either convert these checks to Playwright screenshot assertions with committed baselines, or rename the spec to make it clear it is layout/target smoke only. If visual regression is required, stabilize fonts/theme/viewport and commit baselines.

## Final Missed-Issues Sweep

- Re-ran custom auth/origin/rate-limit gates and treated their passing output as evidence against broad route/action exposure defects.
- Searched for `YEAR(`, `MONTH(`, `DAY(`, `text("embedding")`, `mediumblob`, `describe.skip`, `screenshot(`, and visual assertion patterns across source/tests/gates.
- Searched TODO/FIXME/HACK/temporary/workaround/manual-apply/skip markers across app source, scripts, migrations, e2e, and CI files.
- Checked current specialist findings against exact source lines instead of carrying them forward blindly.
- Checked that the focused source-contract tests pass and that the CLIP integration tests are skipped under default env.

## Residual Risk

- I did not run the full `npm test`, `npm run build`, or Playwright e2e suite in this verifier pass; the pre-existing cycle 10 code-reviewer artifact reports full lint/typecheck/test/build success, but I did not independently repeat the longest gates.
- I did not use a live MySQL instance for `EXPLAIN ANALYZE`, schema-parity testing, or fresh DB initialization.
- I did not verify the deployed production host or host nginx state.
- This was a review-only pass; no application source edits were made.

# Cycle 10 Aggregate Review

Date: 2026-07-07

## Agent Coverage

Callable native subagent roles available in this environment were `default`, `explorer`, and `worker`; the requested reviewer perspectives were run as role-scoped native `default` subagents. The project child-agent cap prevented a literal all-at-once launch of every requested role, so reviewers ran in bounded parallel waves without dropping any required perspective.

Review files for this cycle:

- `.context/reviews/cycle10-2026-07-07/code-reviewer.md`
- `.context/reviews/cycle10-2026-07-07/perf-reviewer.md`
- `.context/reviews/cycle10-2026-07-07/security-reviewer.md`
- `.context/reviews/cycle10-2026-07-07/test-engineer.md`
- `.context/reviews/cycle10-2026-07-07/architect.md`
- `.context/reviews/cycle10-2026-07-07/designer.md`
- `.context/reviews/cycle10-2026-07-07/critic.md`
- `.context/reviews/cycle10-2026-07-07/verifier.md`
- `.context/reviews/cycle10-2026-07-07/tracer.md`
- `.context/reviews/cycle10-2026-07-07/debugger.md`
- `.context/reviews/cycle10-2026-07-07/document-specialist.md`
- `.context/reviews/cycle10-2026-07-07/ui-ux-designer-reviewer.md`
- `.context/reviews/cycle10-2026-07-07/product-marketer-reviewer.md`

Agent failures: none. Several artifact commits were blocked by a tool-level co-author hook that conflicts with the repository rule forbidding `Co-Authored-By`; those files were left in the worktree for leader-owned signed commits.

Raw findings before dedupe: 40.
Deduped findings below: 20.

## Validation Evidence From Review Lanes

- `npm run lint --workspace=apps/web`: passed in code-reviewer lane.
- `npm run lint:api-auth --workspace=apps/web`: passed in code-reviewer, security, verifier, and tracer lanes.
- `npm run lint:action-origin --workspace=apps/web`: passed in code-reviewer, security, verifier, and tracer lanes.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed in code-reviewer, security, verifier, and tracer lanes.
- `npm run typecheck --workspace=apps/web`: passed in code-reviewer, security, and verifier lanes.
- `npm test --workspace=apps/web`: passed in code-reviewer lane.
- `npm run build --workspace=apps/web`: passed in code-reviewer lane; sitemap logged a DB fallback because local MySQL was unavailable.
- Designer and UI/UX lanes used live browser evidence on `https://gallery.atik.kr`.
- `npm audit --workspace=apps/web --omit=dev`: failed on nested Next/PostCSS.

## Deduped Findings

### AGG-C10-01 - Next bundles vulnerable nested PostCSS

- Original findings: `security-reviewer #1`, `VER-C10-01`, `C10-CRIT-02`
- Cross-agent agreement: security-reviewer + verifier + critic
- Severity: Medium
- Confidence: High
- Citations: `apps/web/package.json:59`, `package.json:7-9`, `package-lock.json:9194-9205`, `package-lock.json:9334-9337`, `package-lock.json:9850-9853`
- Scenario: the top-level PostCSS override is `8.5.16`, but `next@16.2.10` still installs `next/node_modules/postcss@8.4.31`, leaving `npm audit --omit=dev` red for GHSA-qx2v-qp2m-jg93.
- Suggested fix: validate a targeted override or upgrade to a Next release that removes the vulnerable nested dependency. Do not use `npm audit fix --force`.

### AGG-C10-02 - Docker native SWC package pins drift from the lockfile

- Original findings: `C10-CRIT-01`
- Severity: Medium
- Confidence: High
- Citations: `apps/web/Dockerfile:55-60`, `package-lock.json:9214-9219`, `package-lock.json:9301-9310`, `apps/web/src/__tests__/deploy-script-contract.test.ts:255-282`
- Scenario: the Docker build manually installs `@next/swc-linux-${npm_arch}-gnu@16.2.9` and `@swc/core-linux-${npm_arch}-gnu@1.15.41`, while the lockfile resolves `16.2.10` and `1.15.43`.
- Suggested fix: update the Dockerfile or derive native package versions from `package-lock.json`; strengthen the deploy contract test to compare exact locked versions.

### AGG-C10-03 - Timeline/year archive queries use non-sargable date predicates

- Original findings: `PERF-C10-01`, `VER-C10-05`, `C10-CRIT-03`
- Cross-agent agreement: perf-reviewer + verifier + critic
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/lib/data-timeline.ts:129-141`, `apps/web/src/lib/data-timeline.ts:186-207`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`
- Scenario: dynamic public routes filter indexed `capture_date` with `YEAR()` and `MONTH()`, forcing MySQL to evaluate date functions across processed rows.
- Suggested fix: replace year/month filters with sargable date ranges and update tests to reject date functions on public hot-path predicates.

### AGG-C10-04 - On This Day homepage widget scans by non-sargable month/day

- Original findings: `PERF-C10-02`, `VER-C10-05`, `C10-CRIT-03`
- Cross-agent agreement: perf-reviewer + verifier + critic
- Severity: Low
- Confidence: High
- Citations: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/app/[locale]/(public)/page.tsx:234`
- Scenario: the hottest public page calls `getOnThisDayImages()` with `MONTH(capture_date)` and `DAY(capture_date)` on each render.
- Suggested fix: add indexed/generated month-day fields or cache the per-day widget with clear invalidation on image metadata changes.

### AGG-C10-05 - Public map can scan and render a large marker corpus

- Original findings: `PERF-C10-03`, `VER-C10-06`, `C10-CRIT-04`
- Cross-agent agreement: perf-reviewer + verifier + critic
- Severity: Medium
- Confidence: Medium
- Citations: `apps/web/src/lib/data.ts:1741-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/components/map/map-client.tsx:120-139`
- Scenario: `/map` filters by processed/map-visible/GPS without a dedicated access path and can serialize/hydrate up to 10,000 markers plus fallback links.
- Suggested fix: validate `EXPLAIN ANALYZE`, add a map/GPS-oriented access path, and add clustering or viewport/bounds pagination before marker counts approach the cap.

### AGG-C10-06 - Drizzle schema models binary embeddings as text

- Original findings: `ARCH-C10-01`, `VER-C10-02`, `C10-CRIT-06`
- Cross-agent agreement: architect + verifier + critic
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/db/schema.ts:271-291`, `apps/web/drizzle/0012_image_embeddings.sql:5-8`, `apps/web/scripts/migrate.js:684-692`
- Scenario: the physical column is `MEDIUMBLOB`, but the Drizzle schema declares `text("embedding")`, which can mislead future schema generation or refactors.
- Suggested fix: replace the approximation with a Drizzle MySQL `customType` or local binary helper that emits `mediumblob` and exposes `Buffer`/binary values.

### AGG-C10-07 - Legacy reconcile remains a second schema authority with name-only coverage

- Original findings: `ARCH-C10-02`, `TE-02`, `VER-C10-03`, `C10-CRIT-05`
- Cross-agent agreement: architect + test-engineer + verifier + critic
- Severity: Medium
- Confidence: High
- Citations: `apps/web/scripts/migrate.js:348-730`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-171`
- Scenario: a future migration can change column type/default/nullability, index order, or FK behavior while the source tripwire still passes because it checks only names.
- Suggested fix: add a structural parity gate comparing migration-built and reconcile-built MySQL schemas via `information_schema`, at least in CI/integration.

### AGG-C10-08 - Real CLIP semantic-search coverage is skipped by default gates

- Original findings: `TE-01`, `VER-C10-04`, `C10-CRIT-08`
- Cross-agent agreement: test-engineer + verifier + critic
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/package.json:21-24`, `.github/workflows/quality.yml:66-80`
- Scenario: model layout, tokenizer/runtime, or `CLIP_MODELS_ROOT` regressions can pass default CI because real-model suites are skipped unless env/model weights are present.
- Suggested fix: add scheduled or opt-in CI for `npm run test:clip:preflight --workspace=apps/web`, or a lighter hermetic loader contract.

### AGG-C10-09 - Bottom-sheet dropdown regression lock is source-string only

- Original findings: `TE-03`, `C10-CRIT-09`
- Cross-agent agreement: test-engineer + critic
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, `apps/web/src/components/info-bottom-sheet.tsx:558-595`, `apps/web/e2e/test-fixes.spec.ts:56-65`
- Scenario: Radix portal/focus/stacking behavior can regress while the source still contains the expected `container` prop strings.
- Suggested fix: add a Playwright mobile behavior test that opens the sheet and dropdown, verifies visibility/focus containment, and closes it.

### AGG-C10-10 - Touch-target audit intentionally allows bare text links

- Original findings: `TE-04`, `VER-C10-07`
- Cross-agent agreement: test-engineer + verifier
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`, `apps/web/src/__tests__/touch-target-audit.test.ts:1053-1059`
- Scenario: a future control implemented as a plain small `<Link>` can violate the 44 px repo rule while the regex scanner stays green.
- Suggested fix: add DOM-level Playwright touch-target measurement or require explicit inline-text allowlisting for bare interactive links.

### AGG-C10-11 - Nav visual check writes screenshots without a visual oracle

- Original findings: `TE-05`, `VER-C10-10`
- Cross-agent agreement: test-engineer + verifier
- Severity: Low
- Confidence: High
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-87`
- Scenario: nav color/spacing/wrapping regressions can pass because screenshots are artifacts only, not baseline assertions.
- Suggested fix: either convert to `toHaveScreenshot` with stable baselines or rename/scope the spec as metric-only layout smoke.

### AGG-C10-12 - Maintenance scheduler startup lacks production shutdown ownership

- Original findings: `ARCH-C10-03`, `VER-C10-08`
- Cross-agent agreement: architect + verifier
- Severity: Low
- Confidence: High
- Citations: `apps/web/src/instrumentation.ts:7-10`, `apps/web/src/instrumentation.ts:49-59`, `apps/web/src/lib/maintenance-scheduler.ts:56-88`
- Scenario: SIGTERM can be reported as clean while scheduler DB work is active or about to be cut off, and future non-idempotent sweeps would inherit the asymmetric lifecycle.
- Suggested fix: add production `stopMaintenanceScheduler({ timeoutMs })`, await active sweeps, and wire it into instrumentation shutdown.

### AGG-C10-13 - Shared-group view-count buffering lives inside the broad data layer

- Original findings: `ARCH-C10-04`
- Severity: Low
- Confidence: High
- Citations: `apps/web/src/lib/data.ts:13-249`, `apps/web/src/instrumentation.ts:49-57`
- Scenario: query-layer refactors can accidentally affect process-lifetime timer/retry/write-buffer state hidden in `data.ts`.
- Suggested fix: extract the buffer into a lifecycle-named module and re-export only the narrow public API from `data.ts`.

### AGG-C10-14 - Host nginx changes remain outside deploy visibility

- Original findings: `ARCH-C10-05`, `VER-C10-09`, `C10-CRIT-07`
- Cross-agent agreement: architect + verifier + critic
- Severity: Medium
- Confidence: High
- Citations: `CLAUDE.md:483-495`, `apps/web/deploy.sh:51-55`, `apps/web/nginx/default.conf:1-29`
- Scenario: a committed nginx rate-limit/body-size/proxy fix can be followed by `npm run deploy` while production still runs stale host nginx.
- Suggested fix: make template drift visible via deploy/CI hash/version checks or add explicit nginx apply verification to the operational ledger.

### AGG-C10-15 - Timeline/year archive photo links have repeated accessible names

- Original findings: `DSGN10-MED-01`
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:227-252`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:190-212`, `apps/web/src/components/masonry-card.tsx:47-64`
- Scenario: event galleries can render dozens of links with identical labels like `View photo: #Color in Music Festival #JIHOON`, making keyboard/screen-reader navigation ambiguous.
- Suggested fix: reuse the masonry accessible-title helper or append a stable `#id`/localized photo identifier to timeline/year archive link labels.

### AGG-C10-16 - Search result labels hide tag-match context

- Original findings: `UIUX-C10-01`
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/lib/data.ts:1556-1569`, `apps/web/src/lib/data.ts:1599-1605`, `apps/web/src/lib/data.ts:1673-1695`, `apps/web/src/components/search.tsx:71`, `apps/web/src/lib/photo-title.ts:85-99`
- Scenario: searches that match tags can show generic rows like `Photo 348`, forcing users to open results to see why they matched.
- Suggested fix: return public-safe tag display context with search results and use the same display-title fallback as masonry cards.

### AGG-C10-17 - Analytics view recording reads request-scoped data inside queued callbacks

- Original findings: `D10-DBG-01`
- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/actions/public.ts:436-462`, `apps/web/src/app/actions/public.ts:465-496`, `apps/web/src/app/actions/public.ts:499-534`, `apps/web/src/lib/background-db-writes.ts:34-65`
- Scenario: queued analytics callbacks call `headers()` and rate-limit after queueing; if they run after the request context is gone or from another callback's pump, view records can drop or use wrong request metadata. Over-limit callers can also consume the global analytics queue before rejection.
- Suggested fix: capture headers/build params and run an admission guard before queueing; queued callbacks should receive plain data and never call `headers()`.

### AGG-C10-18 - Topic deletion fails open on malformed smart collection predicates

- Original findings: `D10-DBG-02`
- Severity: Low
- Confidence: Medium
- Citations: `apps/web/src/app/actions/topics.ts:451-484`, `apps/web/src/app/actions/topics.ts:472-478`, `apps/web/src/__tests__/topics-actions.test.ts:575-625`
- Scenario: if `smart_collections.query_json` is malformed, `deleteTopic` logs and proceeds, possibly deleting a topic that an intended predicate referenced.
- Suggested fix: fail closed when a smart collection query cannot be parsed; add a localized error and regression test.

### AGG-C10-19 - Wiki migration lesson describes an old no-SQL-apply failure mode as current behavior

- Original findings: `DOC-C10-01`
- Severity: Medium
- Confidence: High
- Citations: `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md:19-27`, `CLAUDE.md:446-450`, `apps/web/scripts/migrate.js:791-830`, `apps/web/src/__tests__/migrate-pending-migrations.test.ts:1-16`
- Scenario: contributors can follow stale wiki guidance and wrongly assume pending new Drizzle SQL never runs on existing DBs.
- Suggested fix: rewrite the lesson to describe the current pending-vs-drift split and link to the canonical runbook/tests.

### AGG-C10-20 - Wiki pages overclaim CLIP semantic search is live in production

- Original findings: `DOC-C10-02`
- Severity: Low
- Confidence: High
- Citations: `.omc/wiki/clip-semantic-search-us-p51.md:13-17`, `.omc/wiki/gallerykit-architecture-overview.md:30-33`, `README.md:47-48`, `apps/web/README.md:65-82`, `CLAUDE.md:160`
- Scenario: operators can treat wiki headlines as live-state evidence and skip activation/preflight checks for an operator-enabled feature.
- Suggested fix: replace `LIVE in production` wording with `operator-enabled` wording and link to the activation runbook.

## No-Finding Reports

- `code-reviewer`: no reportable code-quality findings after full lint/typecheck/test/build.
- `tracer`: no reportable causal flow defects after upload/auth/search/migration/deploy/privacy traces.
- `product-marketer-reviewer`: no confirmed market-facing claim mismatch beyond documentation issues already captured by document-specialist.

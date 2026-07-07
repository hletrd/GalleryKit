# Cycle 9 Aggregate Review

Date: 2026-07-07

## Agent Coverage

Callable native subagent roles available here were `default`, `explorer`, and `worker`; named reviewer perspectives were run as role-scoped native subagents. The workspace hard cap on concurrent child agents prevented a literal all-at-once launch of every requested role, so lanes were run in bounded waves while preserving every requested reviewer perspective plus the local `product-marketer-reviewer`.

Review files written or refreshed:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/architect.md`
- `.context/reviews/designer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/tracer.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/product-marketer-reviewer.md`

Agent failures: none.

Raw findings before dedupe: 44.
Deduped findings below: 26.

## Validation Evidence From Review Lanes

- `npm run lint --workspace=apps/web`: passed in code-reviewer and verifier lanes.
- `npm run lint:api-auth --workspace=apps/web`: passed in code-reviewer, security, verifier, and tracer lanes.
- `npm run lint:action-origin --workspace=apps/web`: passed in code-reviewer, security, verifier, and tracer lanes.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed in code-reviewer, security, verifier, and tracer lanes.
- `npm run typecheck --workspace=apps/web`: passed in code-reviewer lane.
- `npm test --workspace=apps/web`: passed in code-reviewer lane.
- `npm run build --workspace=apps/web`: passed in code-reviewer lane.
- Targeted security/privacy Vitest suite passed in security lane: 24 files, 448 tests.
- Targeted verifier Vitest suite passed: 4 files, 43 tests.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: failed on Next's nested vulnerable PostCSS.
- Full `npm audit --workspace=apps/web --audit-level=moderate`: failed on nested PostCSS plus dev-only esbuild through deprecated tooling.
- Designer lane used browser evidence on the public deployed UI and source/test evidence for protected admin areas where authenticated runtime access was unavailable.

## Deduped Findings

### AGG-C9-01 - Failed-image columns are missing from the journaled migration path

- Original findings: `DBG-C9-01`
- Severity: High
- Confidence: High
- Status: confirmed correctness/deploy bug
- Citations: `apps/web/src/db/schema.ts:104-111`, `apps/web/src/lib/image-queue.ts:1020-1031`, `apps/web/scripts/migrate.js:477-483`, `apps/web/scripts/migrate.js:886-895`, `apps/web/drizzle/0025_processing_settings_snapshot.sql:1-2`, `apps/web/drizzle/meta/_journal.json:180-186`
- Scenario: a healthy DB at the `0024` cursor takes the normal pending-tail path, bypasses reconcile, then MySQL rejects `0025_processing_settings_snapshot.sql` because it says `AFTER failed_at` before any journaled migration has created `failed_at`.
- Suggested fix: add a compatibility preflight before Drizzle applies the bad historical pending tail, or otherwise ensure `processing_error` and `failed_at` exist before `0025` can reference them. Add a migration regression that proves an `0024 -> 0025` incremental DB cannot fail on those columns.

### AGG-C9-02 - Semantic embedding version ownership contradicts the schema

- Original findings: `CR-C9-01`, `ARCH-C9-01`, `C9-CRIT-01`, `TRC9-01`, `DOC-C9-01`
- Cross-agent agreement: code-reviewer + architect + critic + tracer + document-specialist
- Severity: Medium
- Confidence: High
- Status: confirmed architecture/docs drift
- Citations: `apps/web/src/db/schema.ts:286-300`, `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/scripts/backfill-clip-embeddings.ts:212-223`, `apps/web/src/app/actions/embeddings.ts:175-186`, `apps/web/src/lib/image-queue.ts:512-523`, `apps/web/README.md:70-82`, `CLAUDE.md:160`
- Scenario: docs say embeddings are stored per `(image_id, model_version)`, but the table primary key is `image_id` only and every writer overwrites the single row. Stub, production, or future-model backfills can destructively replace each other and make rollback/search coverage assumptions wrong.
- Suggested fix: choose one invariant. Either migrate to composite `(image_id, model_version)` storage, or document and test the current one-active-row-per-image destructive replacement contract.

### AGG-C9-03 - Public privacy guards can be bypassed by aliasing sensitive columns

- Original findings: `CR-C9-02`, `ARCH-C9-02`, `C9-CRIT-02`
- Cross-agent agreement: code-reviewer + architect + critic
- Severity: Medium
- Confidence: High
- Status: confirmed guard-shape privacy risk
- Citations: `apps/web/src/lib/data.ts:368-475`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/lib/data-timeline.ts:35-67`, `apps/web/src/lib/data.ts:1599-1617`
- Scenario: a public select can expose `images.latitude`, `images.user_filename`, or another admin-only column under a harmless alias, and the current key-name guard passes because it checks result keys rather than source columns.
- Suggested fix: add a column-level public allowlist or lint/source-contract test that rejects sensitive `images` column references in public select modules except for explicitly audited public map coordinates.

### AGG-C9-04 - Authenticated admin/security e2e coverage is optional in the default gate

- Original findings: `TE-C9-01`, `C9-CRIT-03`, `VER-C9-04`
- Cross-agent agreement: test-engineer + critic + verifier
- Severity: High
- Confidence: High
- Status: confirmed verification gap
- Citations: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:27-73`, `apps/web/e2e/helpers.ts:28-45`, `apps/web/playwright.config.ts:48-87`, `apps/web/scripts/run-e2e-server.mjs:80-90`
- Scenario: a standard local e2e run can skip authenticated admin workflows and the authenticated same-origin rejection path when plaintext e2e credentials are unavailable, while still reporting green on unauthenticated/public flows.
- Suggested fix: provide a deterministic local disposable admin e2e project or make the default e2e command fail clearly when browser-flow coverage is requested but authenticated admin proof was skipped.

### AGG-C9-05 - Production CLIP activation relies on manual skipped real-model suites

- Original findings: `TE-C9-02`, `C9-CRIT-04`, `VER-C9-02`
- Cross-agent agreement: test-engineer + critic + verifier
- Severity: High
- Confidence: High
- Status: confirmed release/activation proof gap
- Citations: `CLAUDE.md:587-596`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/lib/gallery-config.ts:123-126`, `apps/web/src/app/api/search/semantic/route.ts:247-289`
- Scenario: package, model-cache, container-mount, or ONNX runtime drift breaks `embedTextReal`; default gates stay green because real CLIP suites skip/mock the encoder, then production semantic search returns `503` after operator activation.
- Suggested fix: add an explicit `test:clip:preflight`/activation artifact flow or seeded CI job, and require fresh real-model proof before production mode can be enabled.

### AGG-C9-06 - Production dependency audit still fails on Next's nested PostCSS

- Original findings: `C9-SEC-01`, `C9-CRIT-07`, `VER-C9-01`
- Cross-agent agreement: security-reviewer + critic + verifier
- Severity: Medium
- Confidence: High
- Status: confirmed dependency advisory
- Citations: `package.json:7-9`, `apps/web/package.json:57`, `apps/web/package.json:80`, `package-lock.json:9194-9205`
- Scenario: the root override pins top-level PostCSS, but `next@16.2.10` still vendors `postcss@8.4.31`, so production audit fails on GHSA-qx2v-qp2m-jg93.
- Suggested fix: upgrade to a stable Next release that removes the vulnerable nested copy, or add and validate a lockfile/package-manager override that actually replaces `node_modules/next/node_modules/postcss`.

### AGG-C9-07 - Deprecated esbuild-kit chain carries vulnerable esbuild in the dev graph

- Original findings: `C9-SEC-02`
- Severity: Low
- Confidence: High
- Status: confirmed dev dependency advisory
- Citations: `apps/web/package.json:80`, full `npm audit --workspace=apps/web --audit-level=moderate`
- Scenario: dev-only Drizzle tooling still pulls deprecated `@esbuild-kit/*` packages and vulnerable `esbuild@0.18.20`. This is not a production runtime exposure, but it keeps full audit red and can affect local dev servers.
- Suggested fix: upgrade or replace the Drizzle tooling chain when upstream exposes a compatible path.

### AGG-C9-08 - Batch image deletion repeats full derivative-directory scans

- Original findings: `PERF-C9-01`
- Severity: Medium
- Confidence: High
- Status: confirmed performance risk
- Citations: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:759-884`, `apps/web/src/lib/process-image.ts:575-664`
- Scenario: deleting 100 photos on a NAS-backed gallery with many derivatives can perform up to 300 full directory walks, contending with serving and encoder writes.
- Suggested fix: add a batch cleanup helper that scans each derivative directory once and deletes all matching selected-image variants.

### AGG-C9-09 - Hourly maintenance sweeps can overlap with themselves

- Original findings: `PERF-C9-02`, `C9-CRIT-06`
- Cross-agent agreement: perf-reviewer + critic
- Severity: Medium
- Confidence: High
- Status: confirmed concurrency risk
- Citations: `apps/web/src/lib/maintenance-scheduler.ts:32-45`, `apps/web/src/lib/maintenance-scheduler.ts:61-69`, `apps/web/src/lib/view-retention.ts:64-87`
- Scenario: a slow retention purge runs longer than an hour; the interval starts another sweep, doubling DELETE pressure and index churn on the single MySQL writer.
- Suggested fix: add a module-level in-flight guard or promise reuse so interval ticks skip/log while a sweep body is already active.

### AGG-C9-10 - Color-pipeline backfill stale-candidate scans lack a supporting index

- Original findings: `PERF-C9-03`
- Severity: Medium
- Confidence: Medium
- Status: likely performance risk
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:390-428`, `apps/web/scripts/backfill-color-pipeline.ts:372-417`, `apps/web/src/db/schema.ts:117-125`
- Scenario: after a pipeline bump, stale-candidate scans over processed images add DB CPU and latency while encoders and live requests share the same host.
- Suggested fix: measure with `EXPLAIN ANALYZE`, then add a migration-backed index such as `(processed, pipeline_version, id)` or `(processed, id, pipeline_version)` and mirror it in reconcile.

### AGG-C9-11 - Fresh public listing pages still aggregate tags before limiting rows

- Original findings: `PERF-C9-04`
- Severity: Medium
- Confidence: Medium
- Status: risk
- Citations: `apps/web/src/lib/data.ts:786-829`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/actions/public.ts:132-164`
- Scenario: broad home/topic listings join and aggregate tags before `LIMIT 31`, so tag-heavy large galleries spend DB work on rows outside the returned page.
- Suggested fix: use a two-phase listing query: select page IDs through the covering image index first, then aggregate tags for those IDs only.

### AGG-C9-12 - Public smart collections can publish expensive uncached predicates

- Original findings: `PERF-C9-05`
- Severity: Medium
- Confidence: High
- Status: likely performance/product risk
- Citations: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/data.ts:1488-1550`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-111`
- Scenario: admins can publish broad `contains` or unindexed EXIF predicates to dynamic public collection pages, causing repeated broad scans, grouping, and exact counts.
- Suggested fix: classify predicates at save/publish time, warn/block expensive public shapes, add targeted indexes, or materialize collection membership.

### AGG-C9-13 - Public map hydrates up to 10,000 markers plus a duplicate list

- Original findings: `PERF-C9-06`, `C9-CRIT-05`
- Cross-agent agreement: perf-reviewer + critic
- Severity: Medium
- Confidence: High
- Status: confirmed scale/product risk
- Citations: `apps/web/src/lib/data.ts:1732-1782`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`
- Scenario: a travel gallery with thousands of GPS photos ships a large RSC/client payload, hydrates thousands of Leaflet markers and links, and stalls the main thread on mobile.
- Suggested fix: use viewport/bounds loading with clustering or canvas/WebGL markers, lower initial SSR marker cap, and virtualize/paginate the accessible list.

### AGG-C9-14 - Load-more cursor tests duplicate a permissive mock normalizer

- Original findings: `TE-C9-03`, `VER-C9-03`
- Cross-agent agreement: test-engineer + verifier
- Severity: Medium
- Confidence: High
- Status: confirmed test correctness gap
- Citations: `apps/web/src/lib/data.ts:701-759`, `apps/web/src/app/actions/public.ts:132-245`, `apps/web/src/__tests__/public-actions.test.ts:39-56`, `apps/web/src/__tests__/smart-collection-pagination.test.ts:56-75`, `apps/web/src/__tests__/load-more-rate-limit.test.ts:30-45`
- Scenario: action tests accept cursor shapes that production rejects, or miss future production normalizer relaxations, because they duplicate a simpler mock instead of exercising `normalizeImageListCursor`.
- Suggested fix: add direct normalizer tests and import the actual normalizer in action tests while mocking only DB fetches.

### AGG-C9-15 - Behavior-critical UI regressions are locked by brittle source contracts

- Original findings: `TE-C9-04`
- Severity: Medium
- Confidence: Medium
- Status: risk
- Citations: `apps/web/src/__tests__` source-contract-heavy tests, especially UI behavior contracts around focus, popovers, and component state
- Scenario: source-shape assertions pass while a runtime behavior regression ships because no DOM/browser behavior test exercised the branch.
- Suggested fix: convert the riskiest source contracts to behavior tests with React Testing Library or Playwright while keeping source contracts only for true architecture invariants.

### AGG-C9-16 - The unit gate has no coverage threshold or changed-file ratchet

- Original findings: `TE-C9-05`, `VER-C9-05`
- Cross-agent agreement: test-engineer + verifier
- Severity: Medium
- Confidence: High
- Status: confirmed test strategy gap
- Citations: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`
- Scenario: new action/API/lib branches can land with zero runtime coverage while existing source-contract and unrelated unit tests keep the gate green.
- Suggested fix: add a non-blocking coverage report first, then ratchet changed files or critical directories.

### AGG-C9-17 - Browser/device matrix is too narrow for photo UI risks

- Original findings: `TE-C9-06`
- Severity: Medium
- Confidence: High
- Status: confirmed matrix gap
- Citations: `apps/web/playwright.config.ts:48-77`, `apps/web/e2e/test-fixes.spec.ts:16-82`, `apps/web/e2e/focus-restore.spec.ts:34-60`
- Scenario: Safari/iOS/touch/focus behavior can regress while Chromium-only desktop e2e remains green.
- Suggested fix: add a small Mobile Safari/WebKit smoke project for the most important touch/photo flows.

### AGG-C9-18 - Admin save failures are toast-only in category, tag, and SEO forms

- Original findings: `DES-C9-01`
- Severity: Medium
- Confidence: High
- Status: confirmed UX/accessibility risk
- Citations: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, category/tag/SEO save form error surfaces cited in `.context/reviews/designer.md`
- Scenario: a keyboard or screen-reader admin misses a transient toast after a failed save and the form has no persistent inline error or focus target.
- Suggested fix: add persistent inline error regions with focus/ARIA behavior for these save failures.

### AGG-C9-19 - Tag autocomplete popovers can be clipped inside the admin image table scroller

- Original findings: `DES-C9-02`
- Severity: Medium
- Confidence: Medium
- Status: likely UI risk
- Citations: admin image table/tag autocomplete components cited in `.context/reviews/designer.md`
- Scenario: autocomplete options render inside an overflow scroller and become partially inaccessible near table edges.
- Suggested fix: portal the popover or otherwise ensure it escapes the scroll clipping context with tested keyboard/pointer access.

### AGG-C9-20 - Byte-impacting settings commit before static derivatives are invalidated

- Original findings: `ARCH-C9-03`
- Severity: Medium
- Confidence: High
- Status: confirmed behavior/product risk
- Citations: `apps/web/next.config.ts:56-73`, `apps/web/src/lib/serve-upload.ts:240-258`, `apps/web/src/lib/settings-hash.ts:14-19`, `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/src/lib/revalidation.ts:59-64`, `CLAUDE.md:317`
- Scenario: an admin changes color/quality/size settings, UI state updates immediately, but existing static derivatives keep serving old bytes until a re-encode.
- Suggested fix: move derivatives behind version-aware route serving, use content-addressed paths, or make the pending backfill state explicit before presenting settings as fully applied.

### AGG-C9-21 - Single-writer topology is warned, not enforced

- Original findings: `ARCH-C9-04`
- Severity: Medium
- Confidence: High
- Status: confirmed operational risk
- Citations: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/image-queue.ts:373-455`, `apps/web/src/lib/rate-limit.ts:393-415`
- Scenario: two web instances against one writable DB continue serving despite process-local restore/upload/rate-limit/queue assumptions.
- Suggested fix: add an enforceable production option or move correctness-relevant state to shared coordination.

### AGG-C9-22 - Shared-group reads own a view-count write side effect

- Original findings: `CR-C9-03`, `ARCH-C9-05`
- Cross-agent agreement: code-reviewer + architect
- Severity: Low
- Confidence: High
- Status: confirmed design/coupling risk
- Citations: `apps/web/src/lib/data.ts:1322-1407`, `apps/web/src/lib/data.ts:1796-1800`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- Scenario: a future read-only metadata/admin/preview caller of `getSharedGroupCached()` increments denormalized public view count.
- Suggested fix: make the read helper pure and move counter buffering to an explicit route-owned view service.

### AGG-C9-23 - Experimental storage abstraction does not preserve live file-pipeline invariants

- Original findings: `ARCH-C9-06`
- Severity: Low
- Confidence: Medium
- Status: likely future-integration risk
- Citations: `apps/web/src/lib/storage/index.ts:1-12`, `apps/web/src/lib/storage/types.ts:44-100`, `apps/web/src/lib/storage/local.ts:76-108`, `apps/web/src/lib/storage/local.ts:142-156`, `apps/web/src/lib/process-image.ts:1164-1224`
- Scenario: future storage integration could replace temp-file/rename/rollback derivative writes with direct final-path writes and let readers observe partial files.
- Suggested fix: keep the abstraction quarantined or add atomic replace/rollback/symlink-safe write semantics before production integration.

### AGG-C9-24 - Drizzle tooling TLS config drifts from runtime DB CA behavior

- Original findings: `CR-C9-04`, `ARCH-C9-07`
- Cross-agent agreement: code-reviewer + architect
- Severity: Low
- Confidence: High
- Status: confirmed tooling/config drift
- Citations: `apps/web/src/db/index.ts:12-18`, `apps/web/scripts/mysql-connection-options.js:13-29`, `apps/web/drizzle.config.ts:6-22`
- Scenario: runtime and operational scripts can use `DB_SSL_CA`, while Drizzle Kit uses a separate TLS shape and can fail or tempt unsafe local overrides against private-CA MySQL.
- Suggested fix: reuse a shared CA loader in `drizzle.config.ts`, or make Drizzle Kit explicitly local-only for non-local DB URLs unless a supported CA path is loaded.

### AGG-C9-25 - Smart-collection delete guidance points admins to a nonexistent UI path

- Original findings: `PMR-C9-01`
- Severity: Medium
- Confidence: High
- Status: confirmed user-facing guidance drift
- Citations: smart-collection delete copy/source cited in `.context/reviews/product-marketer-reviewer.md`, `CLAUDE.md` smart-collection admin UI notes
- Scenario: admins are told they can remediate smart-collection deletion from an admin UI that does not exist yet, causing confusion during destructive collection cleanup.
- Suggested fix: change the guidance to match current reality: smart collections are public-read wired but authoring/remediation remains direct-DB/operator-only until an admin UI ships.

### AGG-C9-26 - Upload derivative route claims range handling it does not implement

- Original findings: `C9-CRIT-08`
- Severity: Medium
- Confidence: High
- Status: confirmed docs/code drift
- Citations: `apps/web/src/app/uploads/[...path]/route.ts:4-15`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-15`, `apps/web/src/lib/serve-upload.ts:287-369`
- Scenario: a route-handler fallback request with `Range: bytes=...` receives a full-body `200` response, while comments/exemptions imply range handling exists as a mitigation.
- Suggested fix: either implement and test single-range support, or remove the range-handling claim from comments/exemptions and docs.

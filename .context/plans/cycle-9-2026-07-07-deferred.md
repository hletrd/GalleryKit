# Run-10 Cycle 9/100 Deferred Findings

Date: 2026-07-07
Aggregate source: `.context/reviews/_aggregate.md`

Deferred items preserve original severity/confidence. Security, correctness, and data-loss issues are not deferred unless an explicit repo rule or current upstream/operator blocker is recorded.

## Deferred Items

### DEF-C9-04-RESIDUAL - Authenticated admin e2e still depends on local credentials

- Aggregate: AGG-C9-04
- Citation: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:27-73`, `apps/web/e2e/helpers.ts:28-45`, `apps/web/playwright.config.ts:48-87`
- Original severity/confidence: High / High
- Reason for deferral: WP7 schedules explicit runnable proof commands and docs, but making every default local `npm run test:e2e` run provision credentials is deferred because repo policy allows conditional e2e only "when browser-flow coverage is required" and local destructive DB/service setup is constrained. `AGENTS.md` lists `npm run test:e2e --workspace=apps/web` as required "when browser-flow coverage is required"; this cycle must not stop/remove/mutate the leftover cycle-7 MySQL container.
- Exit criterion: admin browser flows are modified, CI is configured with disposable admin credentials, or the repo changes policy to require authenticated admin Playwright coverage on every e2e invocation.

### DEF-C9-05-RESIDUAL - CLIP production preflight cannot be made default without model weights

- Aggregate: AGG-C9-05
- Citation: `CLAUDE.md:587-596`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`
- Original severity/confidence: High / High
- Reason for deferral: WP7 schedules explicit preflight commands/docs. Full default enforcement is deferred under the repo's CLIP runbook, which states these tests "are permanently skipped in CI (CI has no model weights), so this manual pre-flight is the ONLY verification that the real encoder loads offline and ranks semantically." Requiring seeded weights in default gates would contradict that repo rule and fail ordinary local/CI runs.
- Exit criterion: CLIP model weights become available in CI, production activation code changes, or product decides to require a runtime preflight marker before serving production semantic search.

### DEF-C9-06-UPSTREAM - Nested PostCSS audit if current stable Next cannot remove it

- Aggregate: AGG-C9-06
- Citation: `package.json:7-9`, `apps/web/package.json:57`, `apps/web/package.json:80`, `package-lock.json:9194-9205`
- Original severity/confidence: Medium / High
- Reason for deferral: upstream-blocked after WP8 evidence. On 2026-07-07, `npm view next version` returned `16.2.10` and `npm view next@latest dependencies.postcss version` returned `8.4.31`; `eslint-config-next` and `@next/env` were also `16.2.10`. `npm audit --workspace=apps/web --omit=dev --audit-level=moderate --json` still reports GHSA-qx2v-qp2m-jg93 through `node_modules/next/node_modules/postcss` and offers only an invalid semver-major downgrade to `next@9.3.3`. Forcing that downgrade would violate the repo's Next 16 architecture and current-version policy.
- Exit criterion: Next or npm override support provides a stable patched nested PostCSS path that passes the full gate suite.

### DEF-C9-07 - Dev-only esbuild-kit advisory remains upstream-transitive

- Aggregate: AGG-C9-07
- Citation: `apps/web/package.json:80`, full `npm audit --workspace=apps/web --audit-level=moderate`
- Original severity/confidence: Low / High
- Reason for deferral: dev dependency advisory, not production runtime exposure. Prior cycle evidence showed current `drizzle-kit` still owns the deprecated `@esbuild-kit/*` chain. A forced nested override is not scheduled without upstream compatibility evidence.
- Exit criterion: `drizzle-kit` or its transitive graph ships a patched dependency path, or a tested override passes all gates.

### DEF-C9-08 - Batch image deletion directory-scan optimization

- Aggregate: AGG-C9-08
- Citation: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:759-884`, `apps/web/src/lib/process-image.ts:575-664`
- Original severity/confidence: Medium / High
- Reason for deferral: performance optimization requiring a new batch cleanup helper and broad file-deletion regression coverage. No current correctness/data-loss bug was confirmed, and this cycle prioritizes the migration correctness and guard/test fixes.
- Exit criterion: deletion latency is observed on production/NAS, image-size changes create large historical variant sets, or a future deletion refactor touches `deleteImageVariantsStrict`.

### DEF-C9-10 - Color-pipeline backfill stale-candidate index

- Aggregate: AGG-C9-10
- Citation: `apps/web/src/lib/admin-backfill-runner.ts:390-428`, `apps/web/scripts/backfill-color-pipeline.ts:372-417`, `apps/web/src/db/schema.ts:117-125`
- Original severity/confidence: Medium / Medium
- Reason for deferral: performance/index change needs production-like `EXPLAIN` evidence and migration planning. Adding an index without measurement risks write overhead on a personal-gallery workload.
- Exit criterion: pipeline backfill scans appear in slow-query logs, a pipeline bump causes user-visible latency, or `EXPLAIN ANALYZE` validates a concrete index shape.

### DEF-C9-11 - Two-phase public listing tag aggregation

- Aggregate: AGG-C9-11
- Citation: `apps/web/src/lib/data.ts:786-829`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/actions/public.ts:132-164`
- Original severity/confidence: Medium / Medium
- Reason for deferral: query-shape optimization requiring careful pagination/order/tag contract tests. No current slow-query evidence was produced in this cycle.
- Exit criterion: home/topic listing latency or `EXPLAIN` evidence shows tag aggregation before `LIMIT` is hot, or listing query code is otherwise refactored.

### DEF-C9-12 - Public smart-collection expensive predicate controls

- Aggregate: AGG-C9-12
- Citation: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/data.ts:1488-1550`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-111`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/product policy decision. `CLAUDE.md` states no admin UI invokes smart-collection authoring yet, so broad predicate publication currently requires direct DB/operator action.
- Exit criterion: a smart-collection admin UI ships, public docs advertise collection authoring, or production logs show expensive smart-collection page scans.

### DEF-C9-13 - Public map large-marker hydration

- Aggregate: AGG-C9-13
- Citation: `apps/web/src/lib/data.ts:1732-1782`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`
- Original severity/confidence: Medium / High
- Reason for deferral: substantial UI/performance redesign requiring clustering or viewport loading and browser performance evidence. Current cap is bounded and no production CWV trace was supplied.
- Exit criterion: galleries approach thousands of map-visible photos, mobile map traces show main-thread stalls, or map UI is redesigned.

### DEF-C9-15 - Source-contract UI coverage remains broader than behavior coverage

- Aggregate: AGG-C9-15
- Citation: source-contract-heavy UI tests under `apps/web/src/__tests__`
- Original severity/confidence: Medium / Medium
- Reason for deferral: broad test strategy work. This cycle schedules the narrower cursor normalizer behavior gap; converting many UI source contracts to behavior tests needs per-flow prioritization.
- Exit criterion: a source-contract-only UI invariant regresses at runtime, or a future UI change touches one of the covered focus/popover/component-state flows.

### DEF-C9-16 - Coverage threshold / changed-file ratchet

- Aggregate: AGG-C9-16
- Citation: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`
- Original severity/confidence: Medium / High
- Reason for deferral: repository-wide policy/tooling change that can make many unrelated files fail. Needs a baseline/ratchet rollout plan, not a drive-by fix.
- Exit criterion: CI policy work is requested, or a new critical path lands without behavior coverage and motivates a changed-file ratchet.

### DEF-C9-17 - Playwright browser/device matrix expansion

- Aggregate: AGG-C9-17
- Citation: `apps/web/playwright.config.ts:48-77`, `apps/web/e2e/test-fixes.spec.ts:16-82`, `apps/web/e2e/focus-restore.spec.ts:34-60`
- Original severity/confidence: Medium / High
- Reason for deferral: browser-matrix expansion increases runtime and can require additional browser installation/host support. No Safari/WebKit-specific regression was confirmed this cycle.
- Exit criterion: mobile/touch/photo-viewer code changes, Safari/iOS bug reports, or CI capacity is allocated for a small WebKit project.

### DEF-C9-18 - Admin save failure inline errors

- Aggregate: AGG-C9-18
- Citation: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, related category/tag/SEO admin save forms
- Original severity/confidence: Medium / High
- Reason for deferral: admin UI behavior change requiring authenticated UI verification. This cycle does not otherwise modify those admin forms, and e2e admin credential setup remains conditional.
- Exit criterion: admin settings/category/tag/SEO forms are modified, authenticated admin e2e is available, or an accessibility review prioritizes persistent inline error regions.

### DEF-C9-19 - Tag autocomplete popover clipping

- Aggregate: AGG-C9-19
- Citation: admin image table/tag autocomplete components cited in `.context/reviews/designer.md`
- Original severity/confidence: Medium / Medium
- Reason for deferral: likely UI risk needing authenticated admin browser reproduction. No source-only fix is scheduled without verifying current clipping behavior.
- Exit criterion: admin image-table/tag UI changes, authenticated admin Playwright coverage is available, or manual/browser evidence confirms clipping.

### DEF-C9-20 - Static derivative setting changes remain stale until backfill

- Aggregate: AGG-C9-20
- Citation: `apps/web/next.config.ts:56-73`, `apps/web/src/lib/serve-upload.ts:240-258`, `apps/web/src/lib/settings-hash.ts:14-19`, `apps/web/src/app/actions/settings.ts:168-239`, `CLAUDE.md:317`
- Original severity/confidence: Medium / High
- Reason for deferral: explicit current product/ops contract. `CLAUDE.md` states flipping byte-impacting settings requires a backfill pass and documents the static-path invalidation gotcha. Changing this requires a derivative storage/versioning design.
- Exit criterion: settings UI/backfill workflow changes, operator confusion is reported, or product chooses versioned/content-addressed derivative paths.

### DEF-C9-21 - Single-writer topology enforcement

- Aggregate: AGG-C9-21
- Citation: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`
- Original severity/confidence: Medium / High
- Reason for deferral: topology/product decision. `CLAUDE.md` documents the shipped single web-instance topology and warn-only guard; failing startup on contention could make rolling deploys brittle without an operator decision.
- Exit criterion: scale-out/blue-green deployment is introduced, operator requests fail-closed singleton behavior, or process-local coordination moves to shared storage.

### DEF-C9-22 - Shared-group read side effect

- Aggregate: AGG-C9-22
- Citation: `apps/web/src/lib/data.ts:1322-1407`, `apps/web/src/lib/data.ts:1796-1800`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity design cleanup. No current caller misuse was found; changing it touches public share analytics semantics.
- Exit criterion: a new read-only shared-group caller is added, analytics/counter semantics change, or share page data loading is refactored.

### DEF-C9-23 - Experimental storage abstraction atomicity

- Aggregate: AGG-C9-23
- Citation: `apps/web/src/lib/storage/index.ts:1-12`, `apps/web/src/lib/storage/types.ts:44-100`, `apps/web/src/lib/storage/local.ts:76-108`, `apps/web/src/lib/process-image.ts:1164-1224`
- Original severity/confidence: Low / Medium
- Reason for deferral: future-integration risk. `CLAUDE.md` says local filesystem storage is the only supported backend and the storage abstraction is not yet integrated end-to-end.
- Exit criterion: storage abstraction is wired into upload/processing/serving, or a new backend is added.

### DEF-C9-24 - Drizzle Kit TLS CA drift

- Aggregate: AGG-C9-24
- Citation: `apps/web/src/db/index.ts:12-18`, `apps/web/scripts/mysql-connection-options.js:13-29`, `apps/web/drizzle.config.ts:6-22`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity tooling/config drift. Production migrations use `scripts/migrate.js` and shared mysql connection helpers; `db:push` is documented as local throwaway only.
- Exit criterion: Drizzle Kit is used against non-local/private-CA DBs, or tooling config is refactored.

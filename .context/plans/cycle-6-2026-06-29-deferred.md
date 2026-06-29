# Cycle 6/100 Deferred Findings

Date: 2026-06-29  
Source review: `.context/reviews/_aggregate.md`  
Status: TODO / deferred

Repo rules checked before deferral:
- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`

No project `.cursorrules`, `CONTRIBUTING.md`, `.context/project/**`, `.context/development/**`, or style/policy markdown files were present.

Deferred work remains bound by the repo workflow: GPG-signed conventional commits with gitmoji, `git pull --rebase` before push, required gates, no destructive actions without explicit confirmation beyond requested deploy flow, and `npm run deploy` from repo root when deployment policy requires it.

## Deferred Items

### C6-07 - Initial public listing queries aggregate tags and `COUNT(*) OVER()` across the full matched set

Original severity/confidence: High / High  
Citation: `apps/web/src/lib/data.ts:872-900`, `apps/web/src/lib/data.ts:1403-1447`, `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

Deferral reason: Performance-only query-shape work, not a current correctness, security, or data-loss bug. It needs query-plan validation and careful public pagination/count contract review before changing a hot public data path.

Exit criterion: Production-like gallery row counts or `EXPLAIN` evidence show slow first-page queries, or a future cycle explicitly takes on public listing query refactor.

### C6-08 - Topic and shared-group analytics lack indexes matching time-window filters

Original severity/confidence: Medium / High  
Citation: `apps/web/src/lib/analytics-data.ts:62-79`, `apps/web/src/lib/analytics-data.ts:161-180`, `apps/web/src/db/schema.ts:221-254`.

Deferral reason: Performance-only index work that requires a migration, journal update, reconcile mirror, and query-plan validation. No current correctness, security, or data-loss failure is reported.

Exit criterion: Analytics table size/latency shows time-window scans are slow, or a migration-focused cycle batches analytics index additions with schema validation.

### C6-10 - Semantic search ignores stale responses but does not abort stale expensive requests

Original severity/confidence: Low / Medium  
Citation: `apps/web/src/components/search.tsx:152-197`, `apps/web/src/app/api/search/semantic/route.ts:228-279`.

Deferral reason: Low-severity performance efficiency issue. The stale response guard already preserves UI correctness; aborting requests is an optimization that can be handled after correctness/security items.

Exit criterion: Search interaction profiling shows excessive in-flight semantic requests, or semantic search UI work resumes.

### C6-11 - Timeline and on-this-day queries use non-sargable date functions

Original severity/confidence: Low / Low for harm, High for pattern  
Citation: `apps/web/src/lib/data-timeline.ts`.

Deferral reason: Manual-validation performance risk only. Requires production-like table size and query plans before changing date-query semantics.

Exit criterion: Timeline/on-this-day latency degrades or query plans prove index-blocking function predicates on meaningful row counts.

### C6-12 - Warm service-worker image loads still put a synchronous HEAD probe on display path

Original severity/confidence: Low / Medium  
Citation: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`.

Deferral reason: Manual-validation perceived-performance risk. Current behavior favors freshness and cache correctness; changing it requires browser profiling and cache-policy tradeoff review.

Exit criterion: Browser performance traces show HEAD validation materially harms image display latency.

### C6-13 - Semantic and similar-photo search remain brute-force scans by design

Original severity/confidence: Low / Medium  
Citation: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.

Deferral reason: Manual-validation scalability risk, not current correctness. Existing scan limits bound current behavior.

Exit criterion: Embedding count or latency exceeds documented bounds, or a vector-index project is approved.

### C6-15 - TLS and HSTS rely on an external edge

Original severity/confidence: High if misdeployed / Medium  
Citation: `apps/web/nginx/default.conf:21-28`, `apps/web/nginx/default.conf:47-53`.

Deferral reason: Manual deployment-topology validation risk. Current repo deploy policy explicitly keeps deploy host/SSH credentials config-driven in gitignored `.env.deploy`, and `CLAUDE.md`/AGENTS deployment guidance treats this repository's nginx as part of a configured remote deploy path rather than the full public edge. No current source-code security bug was reported for the selected gallery.atik.kr deployment.

Exit criterion: The nginx config is used directly as a public edge, TLS termination changes, or an operator asks for production edge validation.

### C6-16 - Client-IP trust depends on exact proxy-chain topology

Original severity/confidence: Medium if misconfigured / Medium  
Citation: `apps/web/docker-compose.yml:14-21`, `apps/web/nginx/default.conf`, `apps/web/src/lib/rate-limit.ts:152-180`.

Deferral reason: Manual deployment-topology validation risk. It depends on live proxy-chain configuration outside the repository and is not a confirmed current code defect under the documented single-target deploy.

Exit criterion: Proxy/CDN/LB topology changes, rate-limit attribution anomalies appear, or production edge validation is requested.

### C6-17 - Security controls are process-local under the documented single-instance topology

Original severity/confidence: Medium if scaled out / High  
Citation: `apps/web/docker-compose.yml:11-21`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/restore-maintenance.ts`.

Deferral reason: Manual topology risk. The repo documents and deploys a single web instance; scaling out would be a scope-changing architecture project requiring shared leases/stores.

Exit criterion: Replica count can exceed one, deploy topology changes, or a shared-state scaling project is approved.

### C6-22 - Migration reconcile coverage checks global tokens rather than table-local structure

Original severity/confidence: Medium / High  
Citation: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-101`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-170`, `apps/web/scripts/migrate.js:293-418`, `apps/web/src/db/schema.ts:19-117`, `apps/web/src/db/schema.ts:221-286`.

Deferral reason: Test-strength gap for future schema changes, not a reported current schema mismatch. Structural reconcile validation should be handled in a schema-focused cycle to avoid destabilizing migration gates while higher-priority correctness work is active.

Exit criterion: Any new migration/schema change is planned, or a cycle is dedicated to migration reconcile test hardening.

### C6-24 - Real CLIP model suites skip in normal CI

Original severity/confidence: Medium / Medium  
Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:37-43`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-31`, `.github/workflows/quality.yml:27-80`.

Deferral reason: CI coverage gap requiring model-weight availability and likely CI storage/runtime decisions. The immediate cycle addresses local semantic lifecycle/query bounds without changing CI infrastructure.

Exit criterion: CI can provision model fixtures, a scheduled/manual CLIP validation job is approved, or production semantic incidents indicate model-load drift.

### C6-26 - Semantic model-version regression coverage is source-string based

Original severity/confidence: Low / High  
Citation: `apps/web/src/__tests__/semantic-search-route.test.ts`, semantic model-version filtering code.

Deferral reason: Low-severity test-depth gap. No current stale-model behavior failure was reported; immediate semantic work focuses on runtime lifecycle and request bounds.

Exit criterion: Semantic route test suite is extended or model-version filtering changes.

### C6-27 - Lightroom topic-lookup quota rollback is pinned only by regex over source text

Original severity/confidence: Low / Medium  
Citation: `apps/web/src/__tests__`, `apps/web/src/app/api/admin/lr/upload/route.ts`.

Deferral reason: Low-severity test-depth gap. The route behavior was already fixed in a prior cycle; this item asks for stronger behavioral coverage.

Exit criterion: Lightroom upload route tests are expanded or quota accounting changes.

### GATE-C6-WARN-01 - Build without a local MySQL server falls back to homepage-only sitemap during prerender

Original severity/confidence: Low warning / High  
Citation: `npm run build --workspace=apps/web` output on 2026-06-29; `sitemap` query failed with `ECONNREFUSED 127.0.0.1:3306` and then continued successfully.

Deferral reason: Non-blocking build-time warning caused by the local validation environment having no MySQL server. The build completed successfully, and the sitemap code intentionally falls back instead of failing the build. This is an environment validation warning, not a source correctness/security/data-loss finding.

Exit criterion: Build environments are expected to have DB access for sitemap prerendering, or sitemap fallback becomes user-visible in a deployed build.

## Scheduled Elsewhere In Cycle 6 Plan

The following aggregate findings are not deferred and are scheduled in `.context/plans/cycle-6-2026-06-29-plan.md`: C6-01, C6-02, C6-03, C6-04, C6-05, C6-06, C6-09, C6-14, C6-18, C6-19, C6-20, C6-21, C6-23, C6-25, C6-28, C6-29, C6-30, C6-31, C6-32, C6-33, C6-34.

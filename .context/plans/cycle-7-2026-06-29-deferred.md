# Cycle 7/100 Deferred Findings

Date: 2026-06-29
Source review: `.context/reviews/_aggregate.md`
Status: TODO / deferred

Repo rules checked before deferral:
- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- `.context/**` markdown inventory

No project `.cursorrules`, `CONTRIBUTING.md`, `.context/project/**`, `.context/development/**`, or additional `docs/` style/policy files were present beyond the docs inspected for CLIP semantic-search context.

Deferred work remains bound by the repo workflow: GPG-signed conventional commits with gitmoji, `git pull --rebase` before push, required gates, no destructive actions without explicit confirmation beyond the requested per-cycle deploy flow, and `npm run deploy` from repo root when deployment policy requires it.

## Deferred Items

### C7-04 - Initial public listing queries aggregate tags and count across the full matched set

Original severity/confidence: Medium / High
Citation: `apps/web/src/lib/data.ts:872-900`, `apps/web/src/lib/data.ts:1403-1447`, `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

Deferral reason: Performance-only query-shape work, not a current correctness, security, or data-loss defect. It needs production-like row counts, `EXPLAIN` evidence, and public pagination/count contract review before changing a hot public data path.

Exit criterion: Production/public-listing latency degrades, query plans confirm unacceptable first-page scans, or a future cycle explicitly takes on the public listing query refactor.

### C7-05 - Analytics top tables lack bot/time/entity indexes

Original severity/confidence: Medium / High
Citation: `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-79`, `apps/web/src/lib/analytics-data.ts:161-180`, `apps/web/src/db/schema.ts:221-254`.

Deferral reason: Performance-only index work requiring migration, journal, reconcile, and production-like query-plan validation. No current correctness, security, or data-loss failure is reported.

Exit criterion: Analytics table size or latency shows slow time-window scans, `EXPLAIN` confirms missing index harm, or a migration-focused cycle batches analytics index additions.

### C7-06 - View-event retention deletes lack viewed_at-leading indexes on topic/share tables

Original severity/confidence: Medium / Medium
Citation: `apps/web/src/lib/view-retention.ts:64-81`, `apps/web/src/db/schema.ts:228-253`.

Deferral reason: Performance/operability risk tied to table growth. It is not a current data-loss defect because retention still deletes by cutoff; the risk is scan cost as event tables grow. It should be batched with other view-event index migrations after query-plan sizing.

Exit criterion: Retention runtime grows materially, event-table row counts exceed operational thresholds, or a future migration cycle takes analytics/retention indexes together.

### C7-08 follow-up - Upload preview visible-window cap or virtualization

Original severity/confidence: Medium / High
Citation: `apps/web/src/components/upload-dropzone.tsx:45-49`, `apps/web/src/components/upload-dropzone.tsx:95-123`, `apps/web/src/components/upload-dropzone.tsx:451-489`.

Deferral reason: The immediate low-risk fix, lazy loading and async decoding, is scheduled in the Cycle 7 implementation plan. A hard preview cap or virtualization changes uploader interaction and needs UX review so operators can still inspect selected files.

Exit criterion: Large-batch upload profiling still shows excessive memory or decode work after the immediate fix, or an uploader UX cycle is opened.

### C7-12 - CLIP search silently searches only the newest capped embedding window

Original severity/confidence: Low / High
Citation: `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/app/api/search/semantic/route.ts:242-251`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`, `apps/web/README.md:53-62`, `CLAUDE.md:534-538`.

Deferral reason: Product disclosure/vector-index strategy risk, not a current broken route. The bounded scan is already documented in operator docs; UI wording or vector-index design should be handled as a product/search scope decision.

Exit criterion: Corpus size exceeds the configured scan limit in production, users report missing older matches, or a semantic search UX/vector-index project is approved.

### C7-20 - TLS/HSTS deployment assumptions require live validation

Original severity/confidence: High if misdeployed / Medium
Citation: `apps/web/nginx/default.conf:21-28`, `apps/web/nginx/default.conf:47-53`.

Deferral reason: Manual deployment-topology validation risk. Current repo deploy policy keeps deploy host and SSH credentials config-driven in gitignored `.env.deploy`, and this cycle is authorized only for the selected `gallery.atik.kr` per-cycle deploy path rather than external edge reconfiguration.

Exit criterion: TLS termination changes, nginx becomes the direct public edge, port-80 behavior changes, or an operator asks for production edge validation.

### C7-21 - Client-IP trust depends on exact proxy-chain topology

Original severity/confidence: Medium if misconfigured / Medium
Citation: `apps/web/docker-compose.yml:14-21`, `apps/web/nginx/default.conf`, `apps/web/src/lib/rate-limit.ts:152-180`.

Deferral reason: Manual deployment-topology validation risk outside the repository's source-only change surface. It depends on the live proxy/CDN/load-balancer chain and forwarded-header normalization, not a confirmed code defect under the documented deploy target.

Exit criterion: Proxy/CDN/LB topology changes, rate-limit attribution anomalies appear, or production edge validation is requested.

### C7-22 - Process-local security/coordination controls would weaken under scale-out

Original severity/confidence: Medium if scaled out / High
Citation: `apps/web/docker-compose.yml:11-21`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/restore-maintenance.ts`.

Deferral reason: Manual topology risk. The repo documents and deploys a single web-instance topology; moving rate limits, restore flags, and upload accounting to shared coordination would be a scope-changing scale-out architecture project.

Exit criterion: Replica count can exceed one, deployment topology changes, or a shared-state scaling project is approved.

### GATE-C7-WARN-01 - Build without a local MySQL server falls back to homepage-only sitemap during prerender

Original severity/confidence: Low warning / High
Citation: `npm run build --workspace=apps/web` output on 2026-06-29; `sitemap` query failed with `ECONNREFUSED 127.0.0.1:3306` and then continued successfully.

Deferral reason: Non-blocking build-time warning caused by the local validation environment having no MySQL server. The build completed successfully, and the sitemap code intentionally falls back instead of failing the build. This is an environment validation warning, not a source correctness/security/data-loss finding.

Exit criterion: Build environments are expected to have DB access for sitemap prerendering, or sitemap fallback becomes user-visible in a deployed build.

## Scheduled Elsewhere In Cycle 7 Plan

The following aggregate findings are not deferred and are scheduled in `.context/plans/cycle-7-2026-06-29-plan.md`: C7-01, C7-02, C7-03, C7-07, C7-08 immediate lazy/async decode, C7-09, C7-10, C7-11, C7-13, C7-14, C7-15, C7-16, C7-17, C7-18, C7-19.

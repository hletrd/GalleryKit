# Cycle 30/100 Deferred Findings

Date: 2026-06-30 KST
Review source: `.context/reviews/_aggregate.md`
Status: deferred carry-forward

Deferral rules applied: each item preserves original severity/confidence and cites the aggregate finding plus source regions. Security, correctness, and data-loss findings are not deferred unless they are operational/manual-validation risks with no safe local-code action this cycle. Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, `git pull --rebase` before push, required gates, no force-push, no `--no-verify`, and current toolchain/package policy.

## Deferred Items

### D30-01 - Live keyword search root cause

- Finding/citation: `AGG-C30-05`; live browser symptom plus `apps/web/src/components/search.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`
- Original severity/confidence: High / High for symptom, Medium for root cause
- Reason for deferral: this cycle safely improves the user-facing failure copy, but root cause requires production logs/live request traces for the deployed database/search path. The repo rules do not authorize speculative production debugging beyond the requested deploy path.
- Exit criterion: reopen when production logs or a reproducible local fixture identifies whether the failure is DB connectivity, query path, rate limit, restore maintenance, or action serialization.

### D30-02 - Storage abstraction atomicity/read-safety before live adoption

- Finding/citation: `AGG-C30-07`; `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`
- Original severity/confidence: Medium / Medium
- Reason for deferral: the storage abstraction is documented as dormant/future-facing and not wired into the live image pipeline. Hardening it is architectural integration work rather than an active production correctness defect.
- Exit criterion: reopen before routing originals, derivatives, resources, or public file serving through `StorageBackend`.

### D30-03 - Service worker LRU metadata lost-update race

- Finding/citation: `AGG-C30-08`; `apps/web/public/sw.template.js`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/cache-consistency issue requiring service-worker concurrency design and browser validation. Not a security, correctness, or data-loss finding for source-of-truth data.
- Exit criterion: reopen when SW cache strategy is edited, offline image cache metrics drift, or cache storage growth/eviction bugs are reported.

### D30-04 - Color pipeline sidecar all-candidate scheduling

- Finding/citation: `AGG-C30-09`; `scripts/backfill-color-pipeline.ts`
- Original severity/confidence: Medium / High
- Reason for deferral: operator-side performance redesign requiring bounded pagination/progress semantics. No active public correctness or security issue was found.
- Exit criterion: reopen before large color backfills, when memory pressure appears, or when sidecar batching work is scheduled.

### D30-05 - Public map marker/list scale and accessibility

- Finding/citation: `AGG-C30-10`; `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/map-client.tsx`
- Original severity/confidence: Medium / High
- Reason for deferral: full fix requires product/UX work: clustering, viewport loading, accessible pagination/virtualization, and likely API changes. It is not a data-loss/security issue.
- Exit criterion: reopen when map-visible photo counts grow, map metrics show slow hydration, or map UX/API work is prioritized.

### D30-06 - Semantic/similar request-thread brute-force scan

- Finding/citation: `AGG-C30-11`; `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Original severity/confidence: Medium / High
- Reason for deferral: architectural performance/relevance work requiring vector-index, worker, or materialized-candidate design. Current behavior is bounded and operator-gated.
- Exit criterion: reopen when semantic corpus approaches scan limits, semantic latency is measured, or search architecture work is scheduled.

### D30-07 - Public exact counts on dynamic pages

- Finding/citation: `AGG-C30-12`; `apps/web/src/lib/data.ts`
- Original severity/confidence: Medium / High
- Reason for deferral: product/performance tradeoff. Counts are currently correct, and changing visible count semantics needs design agreement.
- Exit criterion: reopen when listing/smart-collection TTFB is implicated or count display semantics are redesigned.

### D30-08 - Leading-wildcard public search scans

- Finding/citation: `AGG-C30-13`; `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`
- Original severity/confidence: Medium / Medium
- Reason for deferral: search-index work outside this cycle. The route is bounded by limits/rate limiting and no security/correctness defect was proven.
- Exit criterion: reopen when search traffic/corpus grows, full-text/ngram index work is scheduled, or slow-query logs implicate keyword search.

### D30-09 - Real CLIP activation tests skipped in default CI

- Finding/citation: `AGG-C30-14`; `apps/web/src/__tests__/clip-offline-load.test.ts`, `apps/web/src/__tests__/clip-semantic-integration.test.ts`, CI workflow
- Original severity/confidence: Medium / High
- Reason for deferral: requires model-weight cache and longer CI lane. This cycle did not change CLIP dependencies or activation code.
- Exit criterion: reopen before CLIP/model upgrades, production semantic release validation, or when CI cache capacity is approved.

### D30-10 - Missing browser smoke coverage for public pages

- Finding/citation: `AGG-C30-15`; `apps/web/e2e/**`, public routes under `apps/web/src/app/[locale]/(public)`
- Original severity/confidence: Medium / High
- Reason for deferral: test-suite expansion requiring seeded fixtures/browser time. Current configured gate list for this cycle does not include Playwright.
- Exit criterion: reopen when browser-flow coverage is required for map/timeline/year/smart collections or E2E gate scope changes.

### D30-11 - Nav visual tests lack screenshot baselines

- Finding/citation: `AGG-C30-16`; `apps/web/e2e/nav-visual-check.spec.ts`
- Original severity/confidence: Low / High
- Reason for deferral: visual-baseline policy/anti-flake work. Existing tests still assert geometry/touch targets.
- Exit criterion: reopen when adopting screenshot baselines or renaming/refactoring visual checks.

### D30-12 - E2E browser matrix is desktop Chromium only

- Finding/citation: `AGG-C30-17`; `apps/web/playwright.config.ts`, CI workflow
- Original severity/confidence: Medium / High
- Reason for deferral: CI/runtime matrix expansion with added flake/time cost. Not a current source correctness issue.
- Exit criterion: reopen before Safari/P3/HDR release validation or when mobile/WebKit bugs are reported.

### D30-13 - Share links lack list/revoke UI

- Finding/citation: `AGG-C30-18`; share creation actions/UI and missing admin lifecycle UI
- Original severity/confidence: Medium / High
- Reason for deferral: feature work requiring admin IA, UI, permissions/copy, and E2E coverage. Existing actions remain available for future UI.
- Exit criterion: reopen when admin share management is prioritized or leaked-share operational need is reported.

### D30-14 - Generic public error shell lacks product context

- Finding/citation: `AGG-C30-20`; `apps/web/src/app/[locale]/error.tsx`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: public error-boundary design work. This cycle only changed search-specific generic failure copy.
- Exit criterion: reopen when public error states, outage UX, or first-run empty/error design is edited.

### D30-15 - Semantic-search copy prominence relative to maturity

- Finding/citation: `AGG-C30-21`; README/search UI copy and semantic ops state
- Original severity/confidence: Medium / High
- Reason for deferral: product messaging/design decision requiring live search validation and semantic ops status. This cycle mitigates only generic search failure wording.
- Exit criterion: reopen when public demo/marketing copy is edited, search status UI is added, or production semantic status is validated.

### D30-16 - Backup completeness wording

- Finding/citation: `AGG-C30-22`; `README.md`, `CLAUDE.md`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: existing docs already state SQL dumps cover DB rows only and filesystem stores must be backed up for complete rollback (`README.md` backup paragraph and `CLAUDE.md` security model). No additional code/doc change was needed this cycle.
- Exit criterion: reopen when backup/restore docs are rewritten or an operator still misreads SQL backup as full rollback.

### D30-17 - Public TLS/header-trust topology live validation

- Finding/citation: `AGG-C30-23`; `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, nginx/deploy topology
- Original severity/confidence: Medium / Medium
- Reason for deferral: operational validation of production networking. Repo rules prohibit unapproved production network/security changes; the requested deploy path does not include topology changes.
- Exit criterion: reopen if proxy topology changes, direct app exposure is suspected, or deployed forwarded-header validation is requested.

### D30-18 - Admin DB restore dump provenance/grants trust boundary

- Finding/citation: `AGG-C30-24`; `apps/web/src/app/[locale]/admin/db-actions.ts`
- Original severity/confidence: Medium / Medium
- Reason for deferral: manual security validation of dump provenance and DB grants, not a local source defect. The restore path is admin-only and already scanned/guarded.
- Exit criterion: reopen when restore trust model, admin roles, or DB grants are changed.

### D30-19 - Exact GPS publication operator intent

- Finding/citation: `AGG-C30-25`; `apps/web/src/lib/data.ts`, topic map-visible UI/copy
- Original severity/confidence: Low / High
- Reason for deferral: current code already gates GPS map publication by explicit map-visible topic state and prior cycles added GPS confirmation/copy. This is remaining manual UX validation.
- Exit criterion: reopen when category map visibility UI/copy changes or when an operator confusion report appears.

### D30-20 - Timeline archive date-function scale validation

- Finding/citation: `AGG-C30-26`; `apps/web/src/lib/data-timeline.ts`
- Original severity/confidence: Low / Medium
- Reason for deferral: requires production `EXPLAIN`/slow-query validation or schema/index redesign. Not a current correctness/security issue.
- Exit criterion: reopen when archive routes become hot or timeline schema/index work is scheduled.

### D30-21 - Queue/deploy shutdown budget validation

- Finding/citation: `AGG-C30-27`; queue/deploy shutdown paths
- Original severity/confidence: Low / Low
- Reason for deferral: manual stress validation. No confirmed failure was produced by review.
- Exit criterion: reopen when deploy shutdown truncation is observed or when queue shutdown budgets are changed.

## Gate Warnings

### GATE-WARN-30-01 - Local build sitemap DB fallback log

- Finding/citation: `npm run build --workspace=apps/web` log; `apps/web/src/app/sitemap.ts` logs `[sitemap] falling back to homepage-only sitemap` when local MySQL at `127.0.0.1:3306` is unavailable during static generation.
- Original severity/confidence: Low / High
- Reason for deferral: the build completed successfully and the fallback is intentional for build environments without a local database. Fixing it requires provisioning local MySQL for local gates or changing sitemap static generation behavior, which is outside this cycle's review findings.
- Exit criterion: reopen if production/deploy builds run without database access, the fallback becomes a build failure, or sitemap completeness during local builds becomes a release requirement.

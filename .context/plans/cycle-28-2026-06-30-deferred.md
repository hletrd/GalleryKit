# Cycle 28/100 Deferred Findings

Date: 2026-06-30 KST  
Review source: `.context/reviews/_aggregate.md`  
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate item and source files. Security, privacy, correctness, and data-loss findings are scheduled in `cycle-28-2026-06-30-plan.md` unless they are operational/manual-validation items with no code action in this cycle. Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, pull-rebase before push, required gates, no force-push, no `--no-verify`, and current toolchain/package policy.

## Deferred Items

### GATE-WARN-28-01 - Local build sitemap DB fallback log

- Finding/citation: `npm run build --workspace=apps/web` log; `apps/web/src/app/sitemap.ts` emits `[sitemap] falling back to homepage-only sitemap` when local MySQL at `127.0.0.1:3306` is unavailable during static generation.
- Original severity/confidence: Low / High
- Reason for deferral: the build completed successfully and the fallback is intentional for build environments without a local database. Fixing it would require either provisioning local MySQL for gates or redesigning sitemap static generation behavior, which is outside this cycle's review findings.
- Exit criterion: reopen if production/deploy builds run without database access, if the fallback becomes a build failure, or if sitemap completeness during local builds becomes a release requirement.

### D28-01 - Semantic/similar search synchronous vector scoring

- Finding/citation: `AGG-C28-06`; `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, `apps/web/src/lib/clip-embeddings.ts:36-44`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/scale architecture work requiring worker-thread or vector-index design. Not a security, correctness, or data-loss finding at current documented gallery scale.
- Exit criterion: reopen when production semantic corpus approaches the scan limit, semantic latency/event-loop delay is measured, or vector-index/worker work is scheduled.

### D28-02 - Public map can render 10,000 markers/list rows

- Finding/citation: `AGG-C28-07`; `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-140`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/UX map redesign requiring clustering, viewport APIs, and accessibility design. Not data-loss/security.
- Exit criterion: reopen when map-visible photo counts grow materially, map route metrics show latency, or map UI/API work is scheduled.

### D28-03 - Rate-limit bucket GC index/chunking

- Finding/citation: `AGG-C28-08`; `apps/web/src/db/schema.ts:212-219`, `apps/web/src/lib/rate-limit.ts:515-517`, `apps/web/src/lib/image-queue.ts:1019-1047`
- Original severity/confidence: Medium / High
- Reason for deferral: performance-only schema/index change needing migration/reconcile updates and production-like `EXPLAIN` validation. Current gate work does not show a failing purge.
- Exit criterion: reopen before rate-limit table growth work, when bot traffic increases bucket cardinality, or during planned index tuning.

### D28-04 - Public keyword search leading-wildcard scans

- Finding/citation: `AGG-C28-09`; `apps/web/src/lib/sql-like.ts:9-10`, `apps/web/src/lib/data.ts:1545-1621`, `apps/web/src/app/actions/public.ts:235-317`
- Original severity/confidence: Medium / High
- Reason for deferral: search-index/product design work. Current route is bounded by rate limits and result caps; no correctness/security issue was found.
- Exit criterion: reopen when gallery size/search traffic grows, when search relevance is redesigned, or when adding full-text/ngram/vector search infrastructure.

### D28-05 - Timeline/year/On This Day non-sargable date functions

- Finding/citation: `AGG-C28-10`; `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:178-207`, `apps/web/src/db/schema.ts:116-118`
- Original severity/confidence: Medium / High
- Reason for deferral: performance-only query/index redesign that may require generated columns/migration. No user-visible failure or data-loss was confirmed.
- Exit criterion: reopen when timeline/year routes become hot, when archive schema/index work is scheduled, or when slow-query logs implicate these functions.

### D28-06 - Feed/sitemap freshness index

- Finding/citation: `AGG-C28-11`; `apps/web/src/lib/data.ts:828-853`, `apps/web/src/lib/data.ts:1635-1647`, `apps/web/src/db/schema.ts:116-121`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity performance migration requiring index-cost validation.
- Exit criterion: reopen when feed/sitemap queries are slow, crawler traffic increases, or index tuning is already underway.

### D28-07 - First-page gallery exact total count

- Finding/citation: `AGG-C28-12`; `apps/web/src/lib/data.ts:878-907`, `apps/web/src/app/[locale]/(public)/page.tsx:149-168`, `apps/web/src/components/home-client.tsx:267-269`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/product-copy tradeoff around exact counts. Existing behavior is correct, and changing it affects visible metadata.
- Exit criterion: reopen when listing TTFB/DB cost is measured, exact counts are redesigned, or pagination/count display changes.

### D28-08 - Serial tag resolution

- Finding/citation: `AGG-C28-13`; `apps/web/src/app/actions/images.ts:301-329`, `apps/web/src/lib/tag-records.ts:29-68`, `apps/web/src/app/actions/images.ts:1131-1144`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity admin throughput optimization; current serial path favors simple correctness and no data-loss/security issue was shown.
- Exit criterion: reopen when bulk tag/upload latency is observed, when tag-record helpers are refactored, or when high-volume import workflows are prioritized.

### D28-09 - Service worker synchronous per-image HEAD probes

- Finding/citation: `AGG-C28-14`; `apps/web/public/sw.template.js:31-38`, `apps/web/public/sw.template.js:184-286`, `apps/web/src/lib/serve-upload.ts:245-260`
- Original severity/confidence: Low / Medium
- Reason for deferral: requires browser trace validation under throttled network and cache states. Current finding is a risk needing manual validation.
- Exit criterion: reopen if traces show cached image delays, if service-worker cache strategy is revised, or if mobile/offline performance becomes a release gate.

### D28-10 - Real CLIP offline-load/integration tests skipped by default CI

- Finding/citation: `AGG-C28-18`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`
- Original severity/confidence: Medium / High
- Reason for deferral: CI/model-cache infrastructure work requiring external weights and longer-running jobs. This cycle schedules sidecar/runtime safety and behavior-level stub ranking tests instead.
- Exit criterion: reopen before CLIP dependency/model upgrades, before production semantic-search release validation, or when scheduled CI cache capacity is available.

### D28-11 - Public GET rate-limit gate blind spot

- Finding/citation: `AGG-C28-19`; `apps/web/scripts/check-public-route-rate-limit.ts:36`, `apps/web/scripts/check-public-route-rate-limit.ts:344-346`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:47-74`, `apps/web/src/__tests__/similar-route.test.ts:236-244`
- Original severity/confidence: Medium / High
- Reason for deferral: future-risk gate expansion; existing known expensive GET routes have bespoke rate-limit tests. No current unbounded GET route was identified.
- Exit criterion: reopen when adding public GET APIs that import DB/ImageResponse/Sharp/embedding helpers, or when extending lint gates.

### D28-12 - E2E coverage is Chromium-only

- Finding/citation: `AGG-C28-20`; `apps/web/playwright.config.ts:48-77`
- Original severity/confidence: Medium / High
- Reason for deferral: QA matrix expansion requiring browser/runtime stability and extra CI time. Not a current code correctness finding.
- Exit criterion: reopen before Safari/P3/HDR release validation, when Playwright matrix work is scheduled, or if Safari/WebKit bugs are reported.

### D28-13 - Nav screenshots are artifact-only

- Finding/citation: `AGG-C28-21`; `apps/web/e2e/nav-visual-check.spec.ts:40-79`
- Original severity/confidence: Low / High
- Reason for deferral: visual-baseline policy/anti-flake work. Existing tests still assert geometry and target sizes.
- Exit criterion: reopen when adopting screenshot baselines or when nav styling is redesigned.

### D28-14 - `OptimisticImage` fallback retry fragility

- Finding/citation: `AGG-C28-27`; `apps/web/src/components/optimistic-image.tsx:18-54`, `apps/web/src/components/home-client.tsx:365-380`, `apps/web/src/components/image-manager.tsx:467-475`, `apps/web/src/components/on-this-day-widget.tsx:65-74`
- Original severity/confidence: Low / Medium
- Reason for deferral: current call sites do not pass `fallbackSrc`, so this is a future-risk component hardening item rather than a live defect.
- Exit criterion: reopen before introducing any `fallbackSrc` call site or when touching `OptimisticImage` retry behavior.

### D28-15 - Public data failures use generic error shell

- Finding/citation: `AGG-C28-30`; `apps/web/src/app/[locale]/error.tsx:22-57`, `apps/web/src/app/[locale]/(public)/layout.tsx:7-17`, `apps/web/src/app/[locale]/(public)/page.tsx:151-167`, `apps/web/src/components/nav-client.tsx:160-184`
- Original severity/confidence: Medium / High
- Reason for deferral: broader public error-boundary/layout design. P28-01 schedules the restore-maintenance public-page consistency issue; this generic DB-outage shell polish is availability UX, not security/correctness/data-loss.
- Exit criterion: reopen when public error boundaries, first-run empty/error states, or DB outage handling are edited.

### D28-16 - Proxy/header trust and TLS edge assumptions

- Finding/citation: `AGG-C28-R01`; `apps/web/src/lib/request-origin.ts:5-107`, `apps/web/nginx/default.conf:25-197`
- Original severity/confidence: Medium / Medium
- Reason for deferral: operational deployment validation, not a source defect.
- Exit criterion: reopen if `TRUST_PROXY=true` is used without proven forwarded-header overwrite or if TLS/proxy topology changes.

### D28-17 - MySQL restore least-privilege validation

- Finding/citation: `AGG-C28-R02`; `apps/web/src/lib/sql-restore-scan.ts:12-59`, `apps/web/src/lib/sql-restore-scan.ts:210-251`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-678`
- Original severity/confidence: Medium / Medium
- Reason for deferral: operational DB grant validation. No cycle-28 scanner bypass was confirmed in code.
- Exit criterion: reopen if production DB user has sibling-schema/global/routine/file/user grants or restore grammar changes.

### D28-18 - Gitignored runtime secret files were not inspected

- Finding/citation: `AGG-C28-R03`; `apps/web/src/lib/session.ts:19-35`, `README.md:134-143`, `CLAUDE.md:79-86`, `apps/web/deploy.sh:18`, `.env.deploy.example:1-14`
- Original severity/confidence: Low / High
- Reason for deferral: secret-store inspection/rotation is operational and this cycle must not read or commit gitignored secrets.
- Exit criterion: reopen if secrets were shared in logs/tickets, copied from historical examples, or rotation work is explicitly requested.

# Cycle 29/100 Deferred Findings

Date: 2026-06-30 KST  
Review source: `.context/reviews/_aggregate.md`  
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate item and source files. Security, privacy, correctness, and data-loss findings are scheduled in `cycle-29-2026-06-30-plan.md` unless they are operational/manual-validation items with no safe repo-code action in this cycle. Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, `git pull --rebase` before push, required gates, no force-push, no `--no-verify`, and current toolchain/package policy.

## Deferred Items

### GATE-WARN-29-01 - Local build sitemap DB fallback log

- Finding/citation: `npm run build --workspace=apps/web` log; `apps/web/src/app/sitemap.ts` emits `[sitemap] falling back to homepage-only sitemap` when local MySQL at `127.0.0.1:3306` is unavailable during static generation.
- Original severity/confidence: Low / High
- Reason for deferral: the build completed successfully and the fallback is intentional for build environments without a local database. Fixing it requires either provisioning local MySQL for gates or redesigning sitemap static generation behavior, which is outside this cycle's review findings.
- Exit criterion: reopen if production/deploy builds run without database access, if the fallback becomes a build failure, or if sitemap completeness during local builds becomes a release requirement.

### D29-01 - Request-thread semantic/similar vector scoring

- Finding/citation: `AGG-C29-02`; `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, `apps/web/src/lib/clip-embeddings.ts:36-44`
- Original severity/confidence: Medium / High
- Reason for deferral: performance architecture work requiring worker-thread/vector-index design. Not a security, correctness, or data-loss finding at current documented gallery scale.
- Exit criterion: reopen when semantic corpus approaches scan limits, semantic latency/event-loop delay is measured, or vector-index/worker work is scheduled.

### D29-02 - Public map marker/list scale

- Finding/citation: `AGG-C29-03`; `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:37-95`, `apps/web/src/components/map/map-client.tsx:76-140`
- Original severity/confidence: Medium / High
- Reason for deferral: full fix needs clustering/viewport loading and accessible pagination/virtualization design. It is a performance/UX scale issue, not data-loss/security.
- Exit criterion: reopen when map-visible photo counts grow materially, map route metrics show latency, or map UI/API work is scheduled.

### D29-03 - Public leading-wildcard LIKE scans

- Finding/citation: `AGG-C29-04`; `apps/web/src/lib/data.ts:1545-1621`, `apps/web/src/app/actions/public.ts:236-306`
- Original severity/confidence: Medium / High
- Reason for deferral: search-index/product design work. Current route is bounded by rate limits and result caps; no correctness/security issue was found.
- Exit criterion: reopen when gallery size/search traffic grows, when search relevance is redesigned, or when adding full-text/ngram/vector search infrastructure.

### D29-04 - Timeline/year/On This Day non-sargable predicates

- Finding/citation: `AGG-C29-05`; `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-141`, `apps/web/src/lib/data-timeline.ts:186-207`
- Original severity/confidence: Medium / High
- Reason for deferral: performance-only query/index redesign likely requiring generated columns/migration. No user-visible failure or data-loss was confirmed.
- Exit criterion: reopen when archive routes become hot, when archive schema/index work is scheduled, or when slow-query logs implicate these functions.

### D29-05 - Feed/sitemap freshness index

- Finding/citation: `AGG-C29-06`; `apps/web/src/lib/data.ts:828-853`, `apps/web/src/lib/data.ts:1635-1646`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity performance migration requiring index-cost validation.
- Exit criterion: reopen when feed/sitemap queries are slow, crawler traffic increases, or index tuning is already underway.

### D29-06 - Hot-path exact total counts

- Finding/citation: `AGG-C29-07`; `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1325-1364`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/product-copy tradeoff around exact counts. Existing behavior is correct and changing it affects visible metadata.
- Exit criterion: reopen when listing TTFB/DB cost is measured, exact counts are redesigned, or pagination/count display changes.

### D29-07 - Serial upload/bulk tag resolution

- Finding/citation: `AGG-C29-08`; `apps/web/src/app/actions/images.ts:301-329`, `apps/web/src/app/actions/images.ts:1132-1156`, `apps/web/src/lib/tag-records.ts:29-68`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity admin throughput optimization; current serial path favors simple correctness and no data-loss/security issue was shown.
- Exit criterion: reopen when bulk tag/upload latency is observed, when tag-record helpers are refactored, or when high-volume import workflows are prioritized.

### D29-08 - Service worker synchronous HEAD probes

- Finding/citation: `AGG-C29-09`; `apps/web/public/sw.template.js:34-38`, `apps/web/public/sw.template.js:184-287`
- Original severity/confidence: Low / Medium
- Reason for deferral: browser trace validation under throttled network/cache states is required before changing SW caching behavior.
- Exit criterion: reopen if traces show cached-image delays, if service-worker cache strategy is revised, or if mobile/offline performance becomes a release gate.

### D29-09 - Real CLIP activation tests skipped by default CI

- Finding/citation: `AGG-C29-12`; `apps/web/src/__tests__/clip-offline-load.test.ts`, `apps/web/src/__tests__/clip-semantic-integration.test.ts`, `.github/workflows/quality.yml`
- Original severity/confidence: Medium / High
- Reason for deferral: CI/model-cache infrastructure work requiring external weights and longer-running jobs. This cycle schedules sidecar/runtime safety and behavior-level semantic ranking coverage instead.
- Exit criterion: reopen before CLIP dependency/model upgrades, before production semantic-search release validation, or when scheduled CI cache capacity is available.

### D29-10 - E2E browser matrix is Chromium-only

- Finding/citation: `AGG-C29-14`; `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:72-77`
- Original severity/confidence: Medium / High
- Reason for deferral: QA matrix expansion requiring browser/runtime stability and extra CI time. Not a current code correctness finding.
- Exit criterion: reopen before Safari/P3/HDR release validation, when Playwright matrix work is scheduled, or if Safari/WebKit bugs are reported.

### D29-11 - Missing E2E smoke routes for map/timeline/year/smart collections

- Finding/citation: `AGG-C29-15`; routes under `apps/web/src/app/[locale]/(public)/map`, `timeline`, `year`, and `c`
- Original severity/confidence: Low / High
- Reason for deferral: browser-fixture coverage expansion. Existing unit/source gates cover route contracts; no current production break was proven.
- Exit criterion: reopen when browser-flow coverage is required for archive/map releases or seeded fixtures are refreshed.

### D29-12 - Nav visual tests are artifact-only

- Finding/citation: `AGG-C29-16`; `apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, `apps/web/e2e/nav-visual-check.spec.ts:78`
- Original severity/confidence: Low / High
- Reason for deferral: visual-baseline policy/anti-flake work. Existing tests still assert geometry and target sizes.
- Exit criterion: reopen when adopting screenshot baselines or when nav styling is redesigned.

### D29-13 - Proxy/header trust production validation

- Finding/citation: `AGG-C29-18`; `TRUST_PROXY=true` compose posture, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, nginx forwarding headers
- Original severity/confidence: Medium if misconfigured / Medium
- Reason for deferral: operational deployment validation, not a source defect. No repo rule permits bypassing confirmation for production network changes.
- Exit criterion: reopen if proxy topology changes, direct Next access is exposed, or deployed forwarded-header chain validation is requested.

### D29-14 - Tracked runtime/transient artifacts

- Finding/citation: `AGG-C29-20`; tracked `.omc` files and review `.log`/`.pid` artifacts
- Original severity/confidence: Low / High
- Reason for deferral: cleanup may involve removing tracked files and policy decisions about historical artifacts; destructive filesystem/git cleanup requires explicit scope.
- Exit criterion: reopen when artifact-retention policy is approved or a targeted cleanup plan identifies exact removable files.

### D29-15 - Color sidecar per-image processing claims

- Finding/citation: `AGG-C29-28`; `scripts/backfill-color-pipeline.ts` global lock only versus queue/in-app per-image locks
- Original severity/confidence: Low / Medium
- Reason for deferral: manual concurrency validation/sidecar design work; no current overlapping production flow was proven.
- Exit criterion: reopen before sidecar and in-app color processing are run concurrently or when color pipeline locking is redesigned.

### D29-16 - Deploy success liveness versus DB readiness

- Finding/citation: `AGG-C29-29`; `apps/web/deploy.sh` accepts `/api/live`; `/api/health` has optional DB readiness
- Original severity/confidence: Low / High
- Reason for deferral: deploy readiness semantics are operationally sensitive and may require changing production deploy behavior beyond this cycle's requested exact command.
- Exit criterion: reopen when deploy-readiness policy changes, DB-backed readiness becomes required, or deploys report success during DB outage.

### D29-17 - Lightroom multipart body size validation

- Finding/citation: `AGG-C29-31`; `apps/web/src/app/api/admin/lr/upload/route.ts:85-112`, `apps/web/src/app/api/admin/lr/upload/route.ts:153-172`
- Original severity/confidence: Medium if route is exposed to untrusted PAT clients / Medium
- Reason for deferral: authenticated admin/PAT route hardening that requires validating Next/proxy buffering limits or streaming parser changes. No current untrusted exposure was established.
- Exit criterion: reopen if PAT clients become less trusted, if large-body abuse is observed, or when upload streaming/proxy caps are redesigned.

### D29-18 - Unwired CLIP action failure semantics

- Finding/citation: `AGG-C29-32`; `apps/web/src/app/actions/embeddings.ts:53-55`, `apps/web/src/app/actions/embeddings.ts:145-188`
- Original severity/confidence: Low while unwired / Medium
- Reason for deferral: no production call sites were found; changing action semantics before wiring is lower priority than sidecar/runtime consistency scheduled this cycle.
- Exit criterion: reopen before exposing the action in UI/API or when embedding admin workflows are edited.

### D29-19 - Generic public DB error shell

- Finding/citation: `AGG-C29-35`; `apps/web/src/app/[locale]/error.tsx:22-57` and DB-down browser evidence
- Original severity/confidence: Medium / High
- Reason for deferral: broader public error-boundary/layout design. This cycle schedules restore-maintenance metadata safety; generic DB-outage UX needs product copy and layout decisions.
- Exit criterion: reopen when public error boundaries, first-run empty/error states, or DB outage handling are edited.

### D29-20 - Share links lack list/revoke UI

- Finding/citation: `AGG-C29-39`; share create actions/UI exist, revoke/delete actions exist, no production UI call sites for revocation
- Original severity/confidence: Medium / High
- Reason for deferral: medium-sized admin feature requiring information architecture, permissions, UI, and E2E coverage. Existing revoke actions remain available for future UI.
- Exit criterion: reopen when admin sharing management is prioritized or a leaked-share operational need is reported.

### D29-21 - Semantic-search/demo claims depend on deployed operator state

- Finding/citation: `AGG-C29-41`; README claims plus runtime dependency on DB row, env opt-in, weights, and embeddings
- Original severity/confidence: Low-Medium / High
- Reason for deferral: requires deployed host-state validation before changing external public claims. This cycle updates local operator docs and sidecar mode consistency.
- Exit criterion: reopen when public demo/marketing copy is edited, when production semantic-search status is validated, or when adding an operator status readout.

### D29-22 - Production sitemap and Playwright runtime validation gaps

- Finding/citation: `AGG-C29-42`; `apps/web/src/app/sitemap.ts` local DB fallback and Playwright not fully run by one reviewer
- Original severity/confidence: Low / Medium
- Reason for deferral: runtime validation gap, not a confirmed source defect. Full gate list for this cycle does not include Playwright; deploy smoke remains governed by `npm run deploy`.
- Exit criterion: reopen when browser-flow evidence is required, production sitemap completeness is questioned, or E2E gate scope changes.

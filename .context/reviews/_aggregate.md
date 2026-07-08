# Run-10 Cycle 37 Aggregate Review

Date: 2026-07-08 KST
Repo: `/Users/hletrd/flash-shared/gallery`
Scope: Prompt 1 aggregate over all cycle-37 review lanes.

## Agent Coverage

Completed review files:

- `cycle37/code-reviewer.md`
- `cycle37/security-reviewer.md`
- `cycle37/perf-reviewer.md`
- `cycle37/critic.md`
- `cycle37/verifier.md`
- `cycle37/test-engineer.md`
- `cycle37/tracer.md`
- `cycle37/architect.md`
- `cycle37/debugger.md`
- `cycle37/document-specialist.md`
- `cycle37/designer.md`
- `cycle37/product-marketer-reviewer.md`

Registered reviewer-style agents discovered and included: `ui-ux-designer-reviewer` (covered through `designer.md` against GalleryKit) and `product-marketer-reviewer`.

AGENT FAILURES: none. The native child-agent service exposed only `default`, `explorer`, and `worker` role types; required specialist perspectives were run as bounded default subagents with explicit reviewer personas. The service accepted five concurrent agents, so review fan-out ran in bounded waves after the initial thread-limit rejection.

## Deduplicated Findings

### AGG-C37-01 - New `GalleryConfig` fields currently break the blocking typecheck

- Severity: High
- Confidence: High
- Status: Confirmed
- Cross-agent agreement: debugger, designer
- Source findings: `DBG37-01`, designer validation note
- Regions: `apps/web/src/lib/gallery-config.ts:92-94`, `apps/web/src/lib/gallery-config.ts:146-154`, `apps/web/src/__tests__/settings-hash.test.ts:153-169`, `apps/web/src/__tests__/settings-hash.test.ts:187-203`, `apps/web/src/__tests__/settings-hash.test.ts:229-240`
- Failure scenario: `npm run typecheck --workspace=apps/web` fails because `settings-hash.test.ts` constructs `GalleryConfig` fixtures without `showTimelineNav` and `showMapNav`. CI and the required cycle gates cannot pass.
- Suggested fix: add the two non-byte-impacting fields to every full `GalleryConfig` fixture or introduce a shared complete test helper. Keep them out of derivative settings hash mappers.

### AGG-C37-02 - Timeline/Map visibility settings hide only part of public discovery

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Cross-agent agreement: architect, debugger, designer, document-specialist
- Source findings: `C37-ARCH-01`, `DBG37-02`, `DES37-01`, `C37-DOC-01`
- Regions: `apps/web/src/lib/gallery-config-shared.ts:68-70`, `apps/web/src/lib/gallery-config.ts:92-95`, `apps/web/src/components/nav.tsx:14-30`, `apps/web/src/components/nav-client.tsx:35-49`, `apps/web/src/components/footer.tsx:45-50`, `apps/web/src/app/sitemap.ts:25`, `apps/web/src/app/sitemap.ts:100-107`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:878-920`, `apps/web/messages/en.json:789-794`, `apps/web/messages/ko.json:789-794`
- Failure scenario: an admin disables the Map or Timeline visitor link. The header link disappears, but the footer and sitemap still advertise the route, and docs do not describe the DB-backed visibility controls. The UI copy implies a broader hide contract than the source currently enforces.
- Suggested fix: choose one contract. If these switches control first-party discovery, apply the flags to header, footer, sitemap, and docs/tests. If they are header-only, rename the setting/copy to say so.

### AGG-C37-03 - Upload queue and in-app re-encode backfill oversubscribe the same DB/CPU budget

- Severity: High
- Confidence: High
- Status: Confirmed
- Cross-agent agreement: perf-reviewer, tracer, architect
- Source findings: `PERF37-01`, `TRC37-02`, `C37-ARCH-03`
- Regions: `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/image-queue.ts:447-456`, `apps/web/src/lib/image-queue.ts:883-898`, `apps/web/src/lib/admin-backfill-runner.ts:23-44`, `apps/web/src/lib/admin-backfill-runner.ts:120-143`, `apps/web/src/lib/admin-backfill-runner.ts:722-733`, `apps/web/src/lib/process-image.ts:1411-1418`
- Failure scenario: with the shipped 10-connection pool, upload processing can run two jobs while in-app color backfill runs two more. Each subsystem believes it preserved foreground headroom, but together they can pin most of the DB pool and launch many Sharp/libvips format encoders, slowing live requests during upload plus re-encode overlap.
- Suggested fix: introduce one process-wide background resource budget or weighted semaphore for image encode/backfill work. A narrower interim fix is to pause/refuse in-app backfill while upload processing is active and add overlap regression coverage.

### AGG-C37-04 - Lightroom upload holds the restore foreground mutation slot during multipart parsing

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Cross-agent agreement: perf-reviewer, tracer, critic
- Source findings: `PERF37-02`, `TRC37-01`, `C37-CRIT-01`
- Regions: `apps/web/src/app/api/admin/lr/upload/route.ts:85-105`, `apps/web/src/app/api/admin/lr/upload/route.ts:165-201`, `apps/web/src/app/api/admin/lr/upload/route.ts:267-294`, `apps/web/src/lib/admin-mutation-barrier.ts:94-117`, `apps/web/src/app/[locale]/admin/db-actions.ts:625-669`
- Failure scenario: a slow valid 200 MB Lightroom upload acquires an admin mutation slot before `request.formData()`. A restore started during parsing waits up to the 30 s mutation-drain budget and can abort even though the upload has not reached the DB/file mutation window.
- Suggested fix: move `acquireAdminMutationSlot()` to just before the fenced mutation window, after pure request parsing/validation, then immediately re-check restore maintenance before DB/storage mutation and before the upload-processing contract lock.

### AGG-C37-05 - Public map can mount up to 10k markers and a 10k fallback list in one render

- Severity: Medium
- Confidence: High
- Status: Confirmed performance/UX risk
- Cross-agent agreement: perf-reviewer, designer
- Source findings: `PERF37-03`, `DES37-03`
- Regions: `apps/web/src/lib/data.ts:1766-1816`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-111`, `apps/web/src/components/map/map-client.tsx:78-95`, `apps/web/src/components/map/map-client.tsx:109-143`
- Failure scenario: a large GPS-visible archive opens `/map` on a mid-range phone. The server serializes thousands of marker rows, React builds the map and a large accessible list, and Leaflet mounts thousands of marker/popup trees before the user can interact.
- Suggested fix: add clustering or viewport/bbox paging, lower the initial render budget, and compute bounds in a single loop rather than spreading large coordinate arrays.

### AGG-C37-06 - Public map query has GPS predicates without a map-specific index

- Severity: Medium
- Confidence: Medium
- Status: Likely risk needing production-sized `EXPLAIN`
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF37-04`
- Regions: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-15`, `apps/web/src/lib/data.ts:1784-1802`, `apps/web/src/db/schema.ts:49-50`, `apps/web/src/db/schema.ts:123-132`
- Failure scenario: on a large gallery where most processed images lack public GPS coordinates, MySQL may scan many processed rows and reject them on `latitude` / `longitude` / topic visibility for every fresh `/map` request.
- Suggested fix: collect `EXPLAIN ANALYZE` on production-like cardinality before changing schema; if confirmed, add a map-specific index and mirror it in migrations/reconcile.

### AGG-C37-07 - Photo-page offline fallback is documented but test-pinned off

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Cross-agent agreement: verifier
- Source findings: `VER37-01`
- Regions: `CLAUDE.md:458-465`, `apps/web/public/sw.template.js:7-17`, `apps/web/public/sw.template.js:59-64`, `apps/web/public/sw.template.js:555-563`, `apps/web/src/__tests__/sw-template-contract.test.ts:102-147`
- Failure scenario: a visitor opens `/p/123` while online, then loses network. Docs say the dynamic public photo page has a 24 h offline HTML fallback, but the service worker classifies `/p/:id` as bypassed and never caches or serves that fallback.
- Suggested fix: pick the contract and align docs, `sw.template.js`, generated `sw.js`, and tests. Either allow public photo pages through `networkFirstHtml`, or document them as revocation-sensitive bypasses.

### AGG-C37-08 - Single-writer guard is advisory and starts after process-local schedulers

- Severity: Medium
- Confidence: High
- Status: Confirmed topology risk
- Cross-agent agreement: architect
- Source findings: `C37-ARCH-02`
- Regions: `apps/web/src/instrumentation.ts:7-30`, `apps/web/src/lib/single-writer-guard.ts:7-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/single-writer-guard.ts:294-302`
- Failure scenario: a second web process can start process-local maintenance and image queue work before the singleton guard logs, and both continue after the warning. That weakens assumptions behind in-memory queues, rate limits, buffered view counts, and restore fences.
- Suggested fix: either enforce single-instance before starting process-local schedulers in production, or move the affected state to shared storage and make the guard explicitly informational.

### AGG-C37-09 - OpenStreetMap tile dependency is under-documented for a self-hosted/privacy product

- Severity: Medium
- Confidence: High
- Status: Confirmed docs/product-contract drift
- Cross-agent agreement: critic
- Source findings: `C37-CRIT-02`
- Regions: `apps/web/src/components/map/map-client.tsx`, `README.md`, `CLAUDE.md`
- Failure scenario: an operator choosing GalleryKit for self-hosting/privacy enables Map, but public visitors fetch third-party OpenStreetMap tiles without that dependency being clearly documented alongside other operational privacy tradeoffs.
- Suggested fix: document the OSM tile dependency and privacy implication, or add an operator-configurable tile provider/proxy story.

### AGG-C37-10 - Photo prev/next navigation loses source collection context

- Severity: Medium
- Confidence: Medium
- Status: Likely UX issue
- Cross-agent agreement: critic
- Source findings: `C37-CRIT-03`
- Regions: `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/lib/data.ts`, public topic/share/smart-collection photo routes
- Failure scenario: a visitor enters a photo from a filtered collection, but prev/next uses global adjacency instead of the source set, so navigation exits the collection unexpectedly.
- Suggested fix: carry source context into adjacency queries or make global navigation explicit in UI copy.

### AGG-C37-11 - Proxy-topology diagnostic consumes semantic-search rate-limit budget

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed
- Cross-agent agreement: critic, test-engineer
- Source findings: `C37-CRIT-04`, `TE-C37-06`
- Regions: `scripts/check-proxy-topology.mjs:7-16`, `scripts/check-proxy-topology.mjs:106-134`, `apps/web/src/app/api/search/semantic/route.ts:173-200`, `apps/web/src/lib/rate-limit.ts:415-433`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:29-47`
- Failure scenario: an operator runs the supposedly read-only proxy diagnostic repeatedly and burns semantic-search rate-limit budget because the probe hits the real semantic endpoint.
- Suggested fix: use a cheap diagnostic endpoint or document and test that the semantic probe is rate-budgeting work.

### AGG-C37-12 - Proxy client-IP rate limits can collapse if deployment topology drifts

- Severity: Medium
- Confidence: Medium
- Status: Risk needing deployment validation
- Cross-agent agreement: security-reviewer
- Source findings: `SR37-R1`
- Regions: `apps/web/src/lib/rate-limit.ts:175-217`, `CLAUDE.md:97-98`, `CLAUDE.md:753`, `apps/web/nginx/default.conf:59-71`, `scripts/check-proxy-topology.mjs:7-16`, `scripts/check-proxy-topology.mjs:131-134`
- Failure scenario: an operator adds a CDN/LB in front of nginx without matching `TRUST_PROXY` / hop config. App-level per-IP buckets collapse into shared buckets, enabling denial of service against login and public route budgets.
- Suggested fix: add a deploy/runbook proof for effective client-IP bucketing, or a non-sensitive diagnostic route/check for custom proxy chains.

### AGG-C37-13 - Dynamic public page flood protection is edge-only in direct/custom proxy deployments

- Severity: Low
- Confidence: Medium
- Status: Risk needing deployment validation
- Cross-agent agreement: security-reviewer
- Source findings: `SR37-R2`
- Regions: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:155-178`, `apps/web/nginx/default.conf:1-10`, `apps/web/nginx/default.conf:274-296`, `README.md:175-177`, `scripts/check-proxy-topology.mjs:79-91`
- Failure scenario: a direct app exposure or custom proxy without the shipped public catch-all limiter allows repeated dynamic page renders to consume DB/SSR work outside app-level route/action limiters.
- Suggested fix: make the public page limiter deploy-verifiable or add an optional app-layer page limiter for unsupported topologies.

### AGG-C37-14 - Checked-in Atik deployment config can ship as another operator's metadata

- Severity: Medium
- Confidence: High
- Status: Confirmed distribution risk
- Cross-agent agreement: product-marketer-reviewer
- Source findings: `PMR-C37-01`
- Regions: `apps/web/src/site-config.json:2-10`, `apps/web/src/site-config.example.json:2-11`, `apps/web/scripts/ensure-site-config.mjs:11-42`, `README.md:60-77`, `README.md:118-122`, `README.md:171-172`, `apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/sitemap.ts:70-107`
- Failure scenario: a fresh self-hosting operator skips replacing `site-config.json` because it already exists, then builds a production gallery whose canonical URL, title, author, footer, OpenGraph, and sitemap origin point to Atik.
- Suggested fix: track only the example config, use production-rejected placeholders, or reject the Atik production URL without an explicit Atik deployment opt-in.

### AGG-C37-15 - Public footer hardwires product/vendor surfaces into every gallery

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed product/UX risk
- Cross-agent agreement: product-marketer-reviewer
- Source findings: `PMR-C37-02`
- Regions: `apps/web/src/components/footer.tsx:32-68`, `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`, `apps/web/messages/en.json:838-846`, `apps/web/src/app/sitemap.ts:25`, `apps/web/src/app/sitemap.ts:100-107`
- Failure scenario: a client viewing a photographer's gallery sees GitHub/Admin/GalleryKit product links in the public footer. This may be right for the demo but can dilute a production portfolio's brand and expose operator-focused copy to end viewers.
- Suggested fix: make public attribution/utility links configurable; keep OSS attribution default but provide a portfolio-safe operator path.

### AGG-C37-16 - Search is a core claim but remains easy to miss below large desktop

- Severity: Low
- Confidence: Medium-High
- Status: Likely UX/product-discovery issue
- Cross-agent agreement: product-marketer-reviewer
- Source findings: `PMR-C37-03`
- Regions: `README.md:38-50`, `apps/web/src/components/nav-client.tsx:170-175`, `apps/web/src/components/search.tsx:381-398`, `apps/web/messages/en.json:420-436`
- Failure scenario: visitor search is advertised as a product capability, but on mobile/tablet the trigger is icon-only unless semantic search is production-enabled, making the feature easier to miss in normal installs.
- Suggested fix: make search labeling/discovery stronger on smaller breakpoints, or adjust product copy to match the visible affordance.

### AGG-C37-17 - Admin navigation is a flat wrapping strip across unrelated work areas

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed UX/IA risk
- Cross-agent agreement: designer
- Source findings: `DES37-02`
- Regions: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Failure scenario: ten admin links wrap differently across viewport/language and mix daily publishing, access control, analytics, and database operations at one hierarchy, weakening spatial memory and risk affordance.
- Suggested fix: group admin navigation into stable sections or a sectioned drawer/menu on narrow widths while preserving 44 px targets and `aria-current`.

### AGG-C37-18 - No coverage metric or changed-code ratchet exists

- Severity: Medium
- Confidence: High
- Status: Confirmed test-gap
- Cross-agent agreement: test-engineer
- Source findings: `TE-C37-01`
- Regions: `package.json:17-30`, `apps/web/package.json:8-30`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`
- Failure scenario: broad tests can pass while new or changed logic lands with no coverage threshold or ratchet, relying entirely on reviewer judgment.
- Suggested fix: add a coverage report and changed-code or risk-targeted ratchet, tuned to avoid blocking historical low-coverage areas initially.

### AGG-C37-19 - Browser-flow CI is still desktop Chromium only

- Severity: Medium
- Confidence: High
- Status: Confirmed risk
- Cross-agent agreement: test-engineer
- Source findings: `TE-C37-02`
- Regions: `apps/web/playwright.config.ts:48-86`, `.github/workflows/quality.yml:75-80`, `CLAUDE.md:708-721`
- Failure scenario: responsive/mobile/WebKit regressions can ship even though local review history repeatedly finds mobile and visual issues.
- Suggested fix: add at least mobile Chromium and WebKit smoke projects for core public/admin flows, or document why they remain manual.

### AGG-C37-20 - Nav visual E2E captures screenshots without a visual oracle

- Severity: Medium
- Confidence: High
- Status: Confirmed false-confidence test gap
- Cross-agent agreement: test-engineer
- Source findings: `TE-C37-03`
- Regions: `apps/web/e2e/nav-visual-check.spec.ts:40-87`, `apps/web/playwright.config.ts:63-77`
- Failure scenario: the test emits screenshots but cannot fail on overlap, missing labels, or layout drift unless a human manually inspects artifacts.
- Suggested fix: add screenshot assertions or convert the test to structural/accessibility assertions that fail automatically.

### AGG-C37-21 - CLIP production preflight is not required for CLIP-touching changes

- Severity: Medium
- Confidence: High
- Status: Confirmed test-gap
- Cross-agent agreement: test-engineer
- Source findings: `TE-C37-04`
- Regions: `apps/web/package.json:21-23`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-65`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-80`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:56-65`
- Failure scenario: CLIP implementation changes can pass normal CI without seeded model proof, leaving offline production-load breakage to be found manually.
- Suggested fix: trigger the existing preflight workflow or an explicit required manual gate for CLIP-touching changes.

### AGG-C37-22 - Operator sidecars still rely mostly on source-contract tests

- Severity: Medium
- Confidence: Medium-High
- Status: Likely test-gap
- Cross-agent agreement: test-engineer
- Source findings: `TE-C37-05`
- Regions: `apps/web/scripts/backfill-alt-text.ts:47-160`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`, `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:18-34`
- Failure scenario: source-string tests can pass while sidecar behavior regresses at runtime, especially around restore guards, batching, and advisory-lock release.
- Suggested fix: extract sidecar runners into testable modules and add behavior tests around locks, restore maintenance, batching, and failure cleanup.

### AGG-C37-23 - Hydration E2E uses `networkidle` as completion oracle

- Severity: Low-Medium
- Confidence: Medium
- Status: Risk
- Cross-agent agreement: test-engineer
- Source findings: `TE-C37-07`
- Regions: `apps/web/e2e/hydration-photo-page.spec.ts:20-50`, `apps/web/playwright.config.ts:59-67`
- Failure scenario: `networkidle` can be flaky or insufficiently tied to app readiness, causing both false failures and false confidence on hydrated interactions.
- Suggested fix: replace with explicit UI readiness markers or targeted element/event waits.

## Non-Findings / Confirmed Guardrails

- Code-reviewer found no confirmed product-code issue after full lint, typecheck, build, unit, e2e, audit, and static security lint evidence.
- Security reviewer found no confirmed auth bypass, CSRF, upload traversal, secret, SQL injection, or privacy leak in the inspected current source.
- Privacy field guards, migration post-conditions, restore barriers, rate-limit scanners, deploy helper pruning guarantees, and color/HDR public honesty guards remained aligned in the reviewed source.

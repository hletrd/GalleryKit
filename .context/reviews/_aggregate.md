# Cycle 17 Aggregate Review

Date: 2026-06-30 KST
HEAD reviewed: `5e054f80f646cbcd16c7aae5412aa29424e05032`
Scope: Prompt 1 deep multi-agent review, current HEAD only.

## Agents

All requested/available reviewer lanes returned and wrote provenance artifacts:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`
- `ui-ux-designer-reviewer.md`
- `product-marketer-reviewer.md`

Additional browser/test evidence:

- Designer used agent-browser against `http://localhost:3001`; MySQL was unavailable, so public data-backed flows rendered the error shell. Screenshot artifact: `.context/reviews/ui-ux-artifacts-cycle17/admin-login-mobile.png`.
- UI/UX reviewer used Playwright against `127.0.0.1:3100`; MySQL was unavailable for public data-backed flows; admin login rendered in English/Korean.
- UI/UX targeted tests passed: `npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-rings-cycle20.test.ts info-bottom-sheet-ia.test.ts a11y-us-p15.test.ts` (35 tests).
- Security/tracer/critic ran the custom scanner gates; reported passes for `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit`.
- Security ran `npm audit --workspace=apps/web --audit-level=moderate`; reported 0 vulnerabilities.

No agent failures were reported.

## High-Signal Cross-Agent Findings

### AGG-C17-01 - Tag rename/delete can change public tag-derived content without advancing image freshness

- Severity/confidence: Medium / High
- Status: Confirmed / likely confirmed by causal trace
- Source agents: code-reviewer, tracer
- Citations: `apps/web/src/app/actions/tags.ts:42-130`, `apps/web/src/app/feed.xml/route.ts:60-154`, `apps/web/src/app/sitemap.ts:57-108`
- Failure scenario: a tag rename/delete changes tag-derived photo titles/feed entries, but affected `images.updated_at`, feed `Last-Modified`, and sitemap `lastmod` remain stale.
- Suggested fix: collect affected image IDs in tag rename/delete transactions and bump `images.updated_at` when public tag-derived content changes.

### AGG-C17-02 - Tag relation mutations and parent `images.updated_at` touch are not atomic

- Severity/confidence: Medium / High
- Status: Confirmed
- Source agents: verifier, architect
- Citations: `apps/web/src/app/actions/tags.ts:175-199`, `apps/web/src/app/actions/tags.ts:238-262`, `apps/web/src/app/actions/tags.ts:323-339`, `apps/web/src/app/actions/tags.ts:396-483`
- Failure scenario: an `image_tags` insert/delete commits, then the separate parent freshness update fails; public content changes without the freshness postcondition.
- Suggested fix: wrap tag link mutation and parent timestamp update in the same DB transaction and add rollback tests.

### AGG-C17-03 - Public route rate-limit scanner can pass local-helper false negatives

- Severity/confidence: Medium / High
- Status: Confirmed with probes
- Source agents: code-reviewer, verifier, test-engineer
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:124-276`, `apps/web/scripts/check-public-route-rate-limit.ts:345-349`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:326-361`
- Failure scenario: a public mutating route hides a write in a local helper before the limiter, or inverts a local helper's boolean, and the blocking lint gate still passes.
- Suggested fix: treat local mutator helpers as mutations while scanning helper bodies and avoid accepting arbitrary local helper semantics as a rate-limit gate. Add negative fixtures.

### AGG-C17-04 - Action-origin public-action scanner is not control-flow accurate for `try/catch/finally`

- Severity/confidence: Medium / High
- Status: Confirmed with probes
- Source agents: code-reviewer, test-engineer
- Citations: `apps/web/scripts/check-action-origin.ts:342-405`, `apps/web/src/__tests__/check-action-origin.test.ts:184-203`, `apps/web/src/__tests__/check-action-origin.test.ts:613-626`
- Failure scenario: a public exempt action has a throwing statement before a limiter and a catch/finally mutation; the scanner sees the later try-block limiter first and blesses an unrate-limited exceptional write.
- Suggested fix: evaluate catch/finally as independent branches that need their own dominating limiter, or fail closed on catch/finally mutations. Add fixtures.

### AGG-C17-05 - `strip_gps_on_upload` can silently retain GPS metadata in private originals

- Severity/confidence: Medium / High
- Status: Confirmed
- Source agents: security-reviewer, debugger
- Citations: `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-380`, `apps/web/src/lib/process-image.ts:1733-1820`
- Failure scenario: DB latitude/longitude are nulled and public UI appears stripped, but a malformed/unsupported original remains on disk with GPS metadata after best-effort strip failure.
- Suggested fix: make GPS stripping mandatory when enabled, or persist and surface a durable strip-failed state that blocks future original export/download paths.

### AGG-C17-06 - Public home/gallery DB failures can render misleading success or weak recovery UI

- Severity/confidence: High in UX, Medium in code/critic / High
- Status: Confirmed
- Source agents: code-reviewer, critic, designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/app/[locale]/(public)/page.tsx:151-176`, `apps/web/src/app/[locale]/error.tsx:22-53`, `apps/web/src/app/[locale]/not-found.tsx:18-48`
- Failure scenario: image-list failure can become an empty successful gallery; broader public DB failures render a generic error shell with limited recovery/navigation.
- Suggested fix: distinguish true empty state from degraded DB/query failures, throw or render explicit temporary-unavailable UI, and preserve public nav/recovery affordances in error boundaries.

### AGG-C17-07 - Topic slug reservation misses existing public route segments

- Severity/confidence: Medium / High
- Status: Confirmed
- Source agents: critic
- Citations: `apps/web/src/lib/validation.ts:4-21`, `apps/web/src/app/actions/topics.ts:115-120`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- Failure scenario: admins can create a topic slug like `timeline`, `privacy`, `year`, or `c`; links route to concrete app routes instead of the topic.
- Suggested fix: centralize reserved public route segments and test against concrete siblings of `[topic]`.

### AGG-C17-08 - Reverse-proxy/client-IP topology can collapse or spoof client identity

- Severity/confidence: Medium / High for nginx chain collapse; Medium / Medium for direct exposure
- Status: Confirmed/risk
- Source agents: architect, security-reviewer
- Citations: `apps/web/nginx/default.conf:25-29`, `apps/web/nginx/default.conf:67-70`, `apps/web/docker-compose.yml:14-21`, `apps/web/src/lib/rate-limit.ts:163-185`, `apps/web/src/lib/request-origin.ts:45-68`
- Failure scenario: in a behind-edge deployment nginx replaces the forwarded chain with the edge IP, so app rate limits collapse users to the edge; if the app is directly exposed with `TRUST_PROXY=true`, clients can spoof forwarded identity.
- Suggested fix: make one layer own client-IP normalization via trusted edge ranges or preserved chain, document unsupported topologies, and add diagnostics/tests.

### AGG-C17-09 - Service worker can serve deleted/changed photo pages offline

- Severity/confidence: Medium / High
- Status: Confirmed
- Source agents: debugger
- Citations: `apps/web/public/sw.template.js:58-63`, `apps/web/public/sw.template.js:293-332`, `apps/web/public/sw.template.js:388-394`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:36-38`, `apps/web/src/__tests__/sw-template-contract.test.ts:71-80`
- Failure scenario: a visitor who cached `/p/:id` can later see deleted or changed photo metadata offline for up to 24h.
- Suggested fix: treat `/p/:id` as revocable HTML and bypass offline HTML caching, or cache only a redacted shell.

### AGG-C17-10 - In-app re-encode copy over-promises settings-only backfills

- Severity/confidence: High / High
- Status: Confirmed
- Source agents: product-marketer-reviewer
- Citations: `apps/web/messages/en.json:757-759`, `apps/web/messages/ko.json:757-759`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:253-280`, `apps/web/src/lib/admin-backfill-runner.ts:45-51`, `apps/web/src/lib/admin-backfill-runner.ts:383-418`, `apps/web/scripts/backfill-color-pipeline.ts:331-340`
- Failure scenario: operator changes color/HDR settings while all photos are at current pipeline version; UI suggests the in-app backfill applies changes, but runner selects zero rows unless a pipeline version bump is pending.
- Suggested fix: add explicit force re-encode mode or narrow copy to direct settings-only re-encodes to sidecar `--force-reencode`.

## Additional Confirmed Findings And Risks

### AGG-C17-11 - `WithAdminAuthOptions` still documents a token argument the wrapper never passes

- Severity/confidence: Low / High
- Source agents: code-reviewer
- Citations: `apps/web/src/lib/api-auth.ts:22-35`, `apps/web/src/lib/api-auth.ts:82-90`, `apps/web/src/app/api/admin/lr/upload/route.ts:68-75`

### AGG-C17-12 - Backup download reopens a validated path by pathname

- Severity/confidence: Low / Medium
- Source agents: verifier
- Citations: `apps/web/src/app/api/admin/db/download/route.ts:43-75`

### AGG-C17-13 - CLIP inference admission has an unbounded, abort-insensitive wait queue

- Severity/confidence: High / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/clip-model.ts:53-71`, `apps/web/src/app/api/search/semantic/route.ts:248-255`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`

### AGG-C17-14 - Initial gallery/smart-collection pages use `COUNT(*) OVER()` after tag joins/grouping

- Severity/confidence: Medium-High / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1409-1453`

### AGG-C17-15 - Batch image deletion repeats full derivative-directory scans per image and format

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/app/actions/images.ts:807-845`, `apps/web/src/lib/process-image.ts:575-664`

### AGG-C17-16 - GPS stripping materializes large originals in memory

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/process-image.ts:1738-1822`, `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-381`

### AGG-C17-17 - Public keyword search can run multiple leading-wildcard scans per admitted query

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/app/actions/public.ts:236-318`, `apps/web/src/lib/data.ts:1537-1613`

### AGG-C17-18 - Service worker performs synchronous HEAD revalidation on cached-image display path

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/public/sw.template.js:34-38`, `apps/web/public/sw.template.js:223-285`

### AGG-C17-19 - Gallery client accumulates every loaded image in React state and DOM

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-421`, `apps/web/src/components/load-more.tsx:41-133`

### AGG-C17-20 - Lightroom upload materializes large multipart bodies before streaming work begins

- Severity/confidence: Medium / Medium-High
- Source agents: perf-reviewer
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:93-155`, `apps/web/src/lib/upload-limits.ts:1-6`

### AGG-C17-21 - Public map can send/hydrate up to 10,000 markers and fallback links

- Severity/confidence: Medium / Medium-High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/data.ts:1648-1677`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-143`

### AGG-C17-22 - Timeline/archive date predicates are non-sargable

- Severity/confidence: Low-Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/data-timeline.ts:97-145`, `apps/web/src/lib/data-timeline.ts:186-207`

### AGG-C17-23 - Admin dashboard/analytics DB fanout can consume the small pool

- Severity/confidence: Low-Medium / Medium
- Source agents: perf-reviewer
- Citations: `apps/web/src/db/index.ts:23-38`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`, `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36`

### AGG-C17-24 - Semantic/similar search scans and full-sorts selected embeddings in-process

- Severity/confidence: Low-Medium / Medium
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`

### AGG-C17-25 - Touch-target audit can miss replacement violations in files with allowances

- Severity/confidence: Low / High
- Source agents: test-engineer, ui-ux-designer-reviewer
- Citations: `apps/web/src/__tests__/touch-target-audit.test.ts:151-238`, `apps/web/src/__tests__/touch-target-audit.test.ts:764-788`

### AGG-C17-26 - Reconcile migration tests are source tripwires, not schema equivalence tests

- Severity/confidence: Medium / High
- Source agents: test-engineer
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/scripts/migrate.js:307-702`

### AGG-C17-27 - Real CLIP production behavior is skipped in default test runs

- Severity/confidence: Medium validation risk / High
- Source agents: test-engineer
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/lib/clip-model.ts:98-118`

### AGG-C17-28 - Docker base images and apt packages are not digest/version pinned

- Severity/confidence: Low / High
- Source agents: security-reviewer
- Citations: `apps/web/Dockerfile:1-16`

### AGG-C17-29 - Historical checked-in secrets remain an operational rotation requirement

- Severity/confidence: Medium / Medium
- Source agents: security-reviewer
- Citations: `CLAUDE.md:84-86`, `README.md:144-146`

### AGG-C17-30 - Semantic search rate-limit comments disagree about short-query refunds

- Severity/confidence: Low / High
- Source agents: debugger
- Citations: `apps/web/src/lib/rate-limit.ts:24-30`, `apps/web/src/lib/rate-limit.ts:374-377`, `apps/web/src/app/api/search/semantic/route.ts:194-246`

### AGG-C17-31 - Settings-hash comments overclaim cache invalidation for static upload files

- Severity/confidence: Medium / High
- Source agents: document-specialist
- Citations: `apps/web/src/lib/settings-hash.ts:14-24`, `apps/web/src/lib/serve-upload.ts:197-215`, `apps/web/next.config.ts:56-63`, `CLAUDE.md:296-298`

### AGG-C17-32 - `serve-upload` cache comment says one day, but headers are one hour

- Severity/confidence: Low / High
- Source agents: document-specialist, critic
- Citations: `apps/web/src/lib/serve-upload.ts:245-252`, `apps/web/next.config.ts:69-72`, `apps/web/nginx/default.conf:173-176`

### AGG-C17-33 - CLAUDE analytics index runbook omits current analytics indexes

- Severity/confidence: Low / High
- Source agents: document-specialist
- Citations: `CLAUDE.md:232-245`, `apps/web/src/db/schema.ts:232-262`, `apps/web/drizzle/0026_analytics_top_view_indexes.sql`, `apps/web/drizzle/0027_analytics_retention_indexes.sql`

### AGG-C17-34 - Deploy helper's default secrets path is not documented in user-facing deploy docs

- Severity/confidence: Low / High
- Source agents: document-specialist
- Citations: `scripts/deploy-remote.sh:4-29`, `apps/web/src/__tests__/deploy-script-contract.test.ts:46-52`, `README.md:108-119`, `CLAUDE.md:653-660`

### AGG-C17-35 - HDR copy promises "SDR tone-mapped" derivatives without a tested tone-map contract

- Severity/confidence: Medium / Medium
- Source agents: document-specialist
- Citations: `apps/web/messages/en.json:162`, `apps/web/messages/en.json:740`, `apps/web/messages/ko.json:162`, `apps/web/messages/ko.json:740`, `apps/web/src/lib/process-image.ts:1251-1315`

### AGG-C17-36 - `process-image` pipeline-version history omits current v7

- Severity/confidence: Low / High
- Source agents: document-specialist
- Citations: `apps/web/src/lib/process-image.ts:371-397`, `apps/web/src/lib/gallery-config-shared.ts:10-21`

### AGG-C17-37 - Semantic embeddings are one-row-per-image, making model transitions destructive

- Severity/confidence: Medium / High
- Source agents: architect
- Citations: `apps/web/src/db/schema.ts:280-295`, `apps/web/scripts/backfill-clip-embeddings.ts:80-183`

### AGG-C17-38 - Process-local coordination assumes one active web process

- Severity/confidence: High if scaled / High; Low under current topology
- Source agents: architect, tracer
- Citations: `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/image-queue.ts:76-325`, `apps/web/src/lib/data.ts:13-63`

### AGG-C17-39 - Container startup can recursively walk persistent photo data on deploy/restart

- Severity/confidence: Low / Medium
- Source agents: architect
- Citations: `apps/web/scripts/entrypoint.sh:4-13`, `apps/web/docker-compose.yml:23-27`

### AGG-C17-40 - Reusable deployment artifacts carry live demo/domain defaults

- Severity/confidence: High from product trust / High; Low architecture risk / High
- Source agents: architect, critic, product-marketer-reviewer
- Citations: `apps/web/src/site-config.json:1-10`, `apps/web/src/site-config.example.json:4`, `apps/web/nginx/default.conf:21-29`, `README.md:148-149`

### AGG-C17-41 - Timeline/year mobile cards hide photo titles before open

- Severity/confidence: Medium / High
- Source agents: designer
- Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:238-267`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:196-225`

### AGG-C17-42 - Admin category/tag validation is toast-only and not field-associated

- Severity/confidence: Medium / Medium-High
- Source agents: designer
- Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:81-104`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-66`

### AGG-C17-43 - RTL direction helper is hardcoded LTR despite future-proofing comments

- Severity/confidence: Low / High
- Source agents: designer
- Citations: `apps/web/src/lib/locale-path.ts:33-39`, `apps/web/src/app/[locale]/layout.tsx:93-100`

### AGG-C17-44 - Semantic-search UI omits bounded-scan recall caveat in production

- Severity/confidence: Medium / High
- Source agents: product-marketer-reviewer
- Citations: `README.md:37`, `apps/web/src/components/search.tsx:491-499`, `apps/web/src/app/api/search/semantic/route.ts:261-273`, `apps/web/src/lib/clip-embeddings.ts:43-44`

### AGG-C17-45 - Semantic setup failures are surfaced as generic maintenance

- Severity/confidence: Medium / High
- Source agents: product-marketer-reviewer
- Citations: `apps/web/src/app/api/search/semantic/route.ts:180-184`, `apps/web/src/app/api/search/semantic/route.ts:279-283`, `apps/web/src/components/search.tsx:193-199`, `apps/web/messages/en.json:410`

### AGG-C17-46 - HDR compact labels can imply HDR output

- Severity/confidence: Medium / Medium
- Source agents: product-marketer-reviewer
- Citations: `apps/web/messages/en.json:366`, `apps/web/messages/ko.json:366`, `apps/web/src/components/lightbox-color-pip.tsx:167-189`, `apps/web/src/components/info-bottom-sheet.tsx:272-275`

### AGG-C17-47 - Upload API token copy undersells bearer-token risk

- Severity/confidence: Medium / High
- Source agents: product-marketer-reviewer
- Citations: `apps/web/messages/en.json:818-834`, `apps/web/messages/ko.json:868-884`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`

### AGG-C17-48 - Photo-page swipe navigation is attached to `window`

- Severity/confidence: Medium / High
- Source agents: ui-ux-designer-reviewer
- Citations: `apps/web/src/components/photo-navigation.tsx:47-133`, `apps/web/src/components/photo-viewer.tsx:687-694`

### AGG-C17-49 - Primary photo surface is exposed as generic zoom button

- Severity/confidence: Medium / High
- Source agents: ui-ux-designer-reviewer
- Citations: `apps/web/src/components/image-zoom.tsx:343-362`, `apps/web/src/components/photo-viewer.tsx:467-531`, `apps/web/src/components/photo-viewer.tsx:720-723`

### AGG-C17-50 - First-time desktop photo pages hide info/download/color details by default

- Severity/confidence: Medium / Medium
- Source agents: ui-ux-designer-reviewer
- Citations: `apps/web/src/components/photo-viewer.tsx:103-108`, `apps/web/src/components/photo-viewer.tsx:736-999`

### AGG-C17-51 - Admin image management is a wide table on mobile

- Severity/confidence: Medium / High
- Source agents: ui-ux-designer-reviewer
- Citations: `apps/web/src/components/image-manager.tsx:421-579`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`

### AGG-C17-52 - Local public browser validation is blocked by missing seeded MySQL

- Severity/confidence: Medium review risk / High
- Source agents: designer, ui-ux-designer-reviewer
- Citations: local browser runs against `/en`, `/en/map`; dev logs `ECONNREFUSED 127.0.0.1:3306`

### AGG-C17-53 - Deploy command override is arbitrary shell from gitignored env

- Severity/confidence: Low / Medium
- Source agents: critic
- Citations: `scripts/deploy-remote.sh:61-72`, `.env.deploy.example:13-14`

### AGG-C17-54 - Action-origin scanner advertises TSX/JSX coverage but parses as TypeScript

- Severity/confidence: Low / Medium
- Source agents: critic
- Citations: `apps/web/scripts/check-action-origin.ts:47-77`, `apps/web/scripts/check-action-origin.ts:476-479`

### AGG-C17-55 - Analytics are intentionally best-effort and can undercount

- Severity/confidence: Low-Medium / High
- Source agents: tracer
- Citations: `apps/web/src/app/actions/public.ts:363-461`, `apps/web/src/lib/data.ts:49-145`, `apps/web/src/lib/data.ts:222-248`

## Required Next Step

Prompt 2 must create or update plan artifacts so every aggregate finding above is either scheduled for implementation or explicitly deferred with the required citation, original severity/confidence, reason, and exit criterion. Security, correctness, and data-loss findings should not be deferred unless a repo rule explicitly permits deferral.

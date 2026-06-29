# Cycle 15 Aggregate Review

Date: 2026-06-30 KST
Cycle: 15/100
Reviewed HEADs: `e87d1bc2`, `d401dd68`, `3efa0c0e` review-artifact commits

## Review Agents

Completed and preserved as provenance:

- `code-reviewer` - `.context/reviews/code-reviewer.md`
- `perf-reviewer` - `.context/reviews/perf-reviewer.md`
- `security-reviewer` - `.context/reviews/security-reviewer.md`
- `critic` - `.context/reviews/critic.md`
- `verifier` - `.context/reviews/verifier.md`
- `test-engineer` - `.context/reviews/test-engineer.md`
- `tracer` - `.context/reviews/tracer.md`
- `architect` - `.context/reviews/architect.md`
- `debugger` - `.context/reviews/debugger.md`
- `document-specialist` - `.context/reviews/document-specialist.md`
- `designer` - `.context/reviews/designer.md`
- `ui-ux-designer-reviewer` - `.context/reviews/ui-ux-designer-reviewer.md`
- `product-marketer-reviewer` - `.context/reviews/product-marketer-reviewer.md`

Agent failures: none.

## Summary

Deduplicated findings this cycle: 40.

Highest-signal implementation items are the failed-restore recovery dead-end, duplicate semantic-search requests, upload metadata latest-wins UI mismatch, custom gate false-pass cases, analytics `BASE_URL` self-referrer drift, locale-prefixed service-worker cache mismatch, and documentation/index drift. Recurring scale and operational findings remain valid but are deferred where they require schema, production data, CI, or larger UX decisions.

## Merged Findings

### AGG-C15-01 - Failed restore maintenance blocks the next in-process restore attempt

- Severity: High
- Confidence: High
- Status: Confirmed
- Sources: `architect`
- Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:288-293`, `:393-405`, `:560-568`, `:600-615`; `apps/web/src/lib/restore-maintenance.ts:1-55`.
- Failure scenario: a bad import or post-restore migration failure intentionally leaves maintenance active, but the next corrective restore is rejected before it can acquire the restore advisory lock.
- Fix direction: allow authenticated restore retries while maintenance is active after lock acquisition, while keeping unrelated writers blocked.

### AGG-C15-02 - Semantic toggle performs duplicate searches and can double-charge rate limits

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `debugger`
- Evidence: `apps/web/src/components/search.tsx:264-277`, `:472-479`.
- Failure scenario: toggling semantic search with a non-empty query sends an immediate search and another debounced search for the same mode.
- Fix direction: make the effect the single mode-change search path and test that the handler does not call `performSearch` directly.

### AGG-C15-03 - Upload metadata latest-wins contract is unreachable during upload

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `debugger`
- Evidence: `apps/web/src/components/upload-dropzone.tsx:76-82`, `:224-236`, `:373-399`; `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:8-18`.
- Failure scenario: an admin cannot correct topic or global tags for later files in a long sequential upload because metadata controls are disabled while the upload loop is explicitly latest-wins.
- Fix direction: keep metadata controls interactive during upload and extend source tests.

### AGG-C15-04 - Public rate-limit gates accept ignored pre-increment results

- Severity: Medium
- Confidence: High
- Status: Confirmed test-gate gap
- Sources: `test-engineer`
- Evidence: `apps/web/scripts/check-public-route-rate-limit.ts:129-139`, `:305-306`; `apps/web/scripts/check-action-origin.ts:283-314`.
- Failure scenario: a route can call `preIncrementShareAttempt()` then mutate without returning on over-limit, yet the gate passes.
- Fix direction: require the rate-limit helper result to dominate mutation via an early return.

### AGG-C15-05 - Action-origin scanner misses same-file helper mutations before the guard

- Severity: Medium
- Confidence: High
- Status: Confirmed scanner blind spot
- Sources: `test-engineer`
- Evidence: `apps/web/scripts/check-action-origin.ts:234-253`, `:332-337`.
- Failure scenario: an exported action calls a local helper that mutates before `requireSameOriginAdmin()`, and the scanner sees only a benign identifier call.
- Fix direction: fail closed on local helper calls before origin validation or build a same-file call graph.

### AGG-C15-06 - Semantic search success tests do not pin enriched result shape

- Severity: Medium
- Confidence: High
- Status: Confirmed missing regression test
- Sources: `test-engineer`
- Evidence: `apps/web/src/app/api/search/semantic/route.ts:331-345`; `apps/web/src/__tests__/semantic-search-route.test.ts:356-364`.
- Failure scenario: `lens_model` or `capture_date` can be dropped from semantic result JSON while tests still pass.
- Fix direction: mirror similar-route enriched-result assertions in semantic route tests.

### AGG-C15-07 - Custom API route scanner CLIs fail open when route discovery returns zero files

- Severity: Low
- Confidence: Medium
- Status: Likely gate robustness issue
- Sources: `test-engineer`
- Evidence: `apps/web/scripts/check-api-auth.ts:188-191`; `apps/web/scripts/check-public-route-rate-limit.ts:327-330`.
- Failure scenario: a route-layout or extension regression makes discovery return `[]`, and blocking lint gates skip enforcement.
- Fix direction: fail closed when the expected route root exists but discovery finds zero files.

### AGG-C15-08 - Semantic rollback helper docs mention a non-refunded branch

- Severity: Low
- Confidence: Medium
- Status: Likely documentation drift
- Sources: `code-reviewer`
- Evidence: `apps/web/src/lib/rate-limit.ts:374-377`; `apps/web/src/app/api/search/semantic/route.ts:194-205`, `:239-242`.
- Failure scenario: a maintainer re-adds short-query refunds after body parsing, weakening the current charge-before-body posture.
- Fix direction: remove "too-short query" from refundable examples or change route policy and tests.

### AGG-C15-09 - Display capability comments still claim canvas-P3 detection

- Severity: Low
- Confidence: High
- Status: Confirmed docs/source-comment drift
- Sources: `document-specialist`
- Evidence: `apps/web/src/components/wide-gamut-hint.tsx:68-73`; `apps/web/src/components/photo-viewer.tsx:353-356`; `apps/web/src/components/histogram.tsx:497-504`; `apps/web/src/__tests__/use-display-capability.test.ts:4-6`, `:73`, `:188-190`; `apps/web/src/lib/use-display-capability.ts:49-75`.
- Failure scenario: maintainers reintroduce canvas capability as display-gamut detection.
- Fix direction: update comments/tests to the actual screen/media-query/conservative fallback contract.

### AGG-C15-10 - Sidecar `BACKFILL_CONCURRENCY` docs say uncapped but code clamps to 8

- Severity: Low
- Confidence: High
- Status: Confirmed operational-doc drift
- Sources: `document-specialist`
- Evidence: `CLAUDE.md:108`, `:333`; `apps/web/scripts/backfill-color-pipeline.ts:27-28`, `:367-370`; `apps/web/src/lib/env.ts:18-23`.
- Failure scenario: operators set values above 8 expecting uncapped concurrency or maintainers remove the cap to match docs.
- Fix direction: document default 2, max 8, separate pool, not live-pool-budget-capped.

### AGG-C15-11 - Plan index marks implemented plans as active TODO

- Severity: Low
- Confidence: High
- Status: Confirmed plan-index drift
- Sources: `document-specialist`
- Evidence: `.context/plans/README.md:7`, `:15`; `.context/plans/cycle-12-2026-06-29-plan.md:5`, `:13-31`; `.context/plans/cycle-3-2026-06-29-plan.md:5`, `:13-83`.
- Failure scenario: future cycles reopen already implemented work from the active plan index.
- Fix direction: archive or relabel completed implementation plans in the index.

### AGG-C15-12 - Analytics self-referrer classification ignores `BASE_URL`

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `product-marketer-reviewer`
- Evidence: `README.md:122-149`; `apps/web/src/lib/constants.ts:21-24`; `apps/web/src/lib/analytics.ts:140-143`; `apps/web/src/app/actions/public.ts:345-352`; `apps/web/src/lib/analytics-data.ts:192-212`.
- Failure scenario: metadata uses `BASE_URL=https://photos.example.com`, but analytics classifies same-site referrals from that host as external because `siteConfig.url` differs.
- Fix direction: use the same effective URL contract as metadata and add a test.

### AGG-C15-13 - Checked-in demo canonical URL can become self-hosted deploy identity

- Severity: High
- Confidence: High
- Status: Confirmed product/config risk
- Sources: `product-marketer-reviewer`
- Evidence: `README.md:8`, `:148`; `apps/web/src/site-config.json:4`; `apps/web/scripts/ensure-site-config.mjs:12-40`; `apps/web/src/lib/constants.ts:21-24`; `apps/web/src/app/sitemap.ts:18-103`.
- Failure scenario: a self-hosted operator without `BASE_URL` publishes `gallery.atik.kr` as canonical identity.
- Fix direction: replace the tracked default with a rejected placeholder or forbid demo hostnames when packaging for generic self-hosting.

### AGG-C15-14 - README overstates albums as a primary product model

- Severity: Low
- Confidence: High
- Status: Confirmed product-copy mismatch
- Sources: `product-marketer-reviewer`
- Evidence: `README.md:34`; `apps/web/messages/en.json:4`, `:76-109`, `:140`, `:154-156`.
- Failure scenario: evaluators expect a separate albums model when the product exposes categories and shared groups.
- Fix direction: change the README headline to categories/sharing.

### AGG-C15-15 - README Lightroom wording can imply a bundled plugin

- Severity: Low
- Confidence: Medium-High
- Status: Likely product-copy mismatch
- Sources: `product-marketer-reviewer`
- Evidence: `README.md:40`; `apps/web/src/app/api/admin/lr/upload/route.ts:4-9`; `apps/web/messages/en.json:805-807`; `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`.
- Failure scenario: users expect a ready Lightroom Classic publish plugin, but the repo ships the server API only.
- Fix direction: clarify that no Lightroom Classic plugin is bundled.

### AGG-C15-16 - Locale-prefixed upload derivatives bypass the service-worker image cache policy

- Severity: Medium
- Confidence: Medium
- Status: Likely issue
- Sources: `architect`
- Evidence: `apps/web/src/lib/sw-cache.ts:73-81`; `apps/web/public/sw.template.js:50-55`, `:386-389`; `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-12`; `apps/web/nginx/default.conf:173-184`.
- Failure scenario: `/ko/uploads/jpeg/...` serves bytes but skips stale-while-revalidate image caching and freshness checks.
- Fix direction: add optional locale-prefix support to the shared predicate and template/generated service worker contract tests.

### AGG-C15-17 - Public map lacks accessible named structure and list labeling

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `ui-ux-designer-reviewer`
- Evidence: `apps/web/src/app/[locale]/(public)/map/page.tsx:52-79`; `apps/web/src/components/map/map-client.tsx:107-144`.
- Failure scenario: screen-reader and keyboard users get a large third-party map without a named region, help text, or dedicated fallback-list label.
- Fix direction: add a labeled map section, skip link, instructions, and dedicated list label.

### AGG-C15-18 - Root layout hard-codes `dir="ltr"`

- Severity: Low
- Confidence: High
- Status: Risk, not current en/ko defect
- Sources: `designer`, `ui-ux-designer-reviewer`
- Evidence: `apps/web/src/app/[locale]/layout.tsx:94-100`.
- Failure scenario: future RTL locale work silently renders with LTR document direction.
- Fix direction: derive direction from locale metadata, even if current locales return `ltr`.

### AGG-C15-19 - Settings switch rows can squeeze long Korean/help copy on mobile

- Severity: Low
- Confidence: Medium-High
- Status: Confirmed responsive pattern issue
- Sources: `ui-ux-designer-reviewer`
- Evidence: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:407-421`, `:423-437`, `:439-453`, `:553-568`, `:614-628`.
- Failure scenario: long explanatory copy shares a tight horizontal row with switches on narrow Korean admin screens.
- Fix direction: reuse the existing responsive `flex-col sm:flex-row` pattern.

### AGG-C15-20 - Fresh-gallery empty state is descriptive but not operational

- Severity: Low
- Confidence: High
- Status: Confirmed UX issue
- Sources: `ui-ux-designer-reviewer`
- Evidence: `apps/web/src/components/home-client.tsx:424-440`.
- Failure scenario: a new self-hosted gallery has no path from empty public state toward upload/configuration.
- Fix direction: improve copy or add owner-only affordance when admin session state is available.

### AGG-C15-21 - Photo-page swipe navigation is attached globally to `window`

- Severity: Medium
- Confidence: High
- Status: Likely user-facing defect
- Sources: `ui-ux-designer-reviewer`
- Evidence: `apps/web/src/components/photo-navigation.tsx:43-60`, `:96-133`; `apps/web/src/components/photo-viewer.tsx:688-695`.
- Failure scenario: a horizontal gesture that starts outside the image can navigate photos or prevent default page behavior.
- Fix direction: scope gesture capture to the media surface or ignore gestures that start outside it.

### AGG-C15-22 - Public-route browser validation was blocked by local DB/schema failures

- Severity: Medium as review risk
- Confidence: High
- Status: Validation blocker
- Sources: `designer`, `ui-ux-designer-reviewer`
- Evidence: local `/en` browser run stayed in loading shell; public page depends on data queries before `HomeClient`.
- Failure scenario: runtime-only public masonry/photo/search/map focus or layout issues remain unverified locally.
- Fix direction: keep a seeded local/e2e fixture or deterministic fixture mode for public UI review.

### AGG-C15-23 - Public map can serialize and render up to 10k markers and links

- Severity: High
- Confidence: High
- Status: Confirmed recurring scale risk
- Sources: `perf-reviewer`, `critic`
- Evidence: `apps/web/src/lib/data.ts:1640-1676`; `apps/web/src/app/[locale]/(public)/map/page.tsx:31-79`; `apps/web/src/components/map/map-client.tsx:76-143`; `apps/web/src/db/schema.ts:114-120`.
- Failure scenario: a GPS-heavy gallery ships a huge dynamic payload and mounts thousands of Leaflet markers on mobile.
- Fix direction: bounds-based fetching, clustering, indexed query support, and a smaller SSR fallback list.

### AGG-C15-24 - Aborted semantic searches still occupy CLIP inference and scoring

- Severity: Medium
- Confidence: High
- Status: Confirmed performance risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/components/search.tsx:181-190`; `apps/web/src/app/api/search/semantic/route.ts:248-305`; `apps/web/src/lib/clip-model.ts:53-160`.
- Failure scenario: stale aborted requests stay queued/running through unabortable CLIP inference and scoring.
- Fix direction: thread `AbortSignal` through CLIP slots and chunk scoring with abort checks.

### AGG-C15-25 - Upload-processing contract lock pins a DB connection across slow work

- Severity: Medium
- Confidence: High
- Status: Likely performance/concurrency issue
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/lib/upload-processing-contract-lock.ts:9-55`; `apps/web/src/app/actions/images.ts:175-613`; `apps/web/src/app/api/admin/lr/upload/route.ts:240-545`.
- Failure scenario: large uploads or GPS stripping hold a shared pool connection and serialize sibling uploads/settings.
- Fix direction: narrow the lock or move to reader/writer/lease semantics.

### AGG-C15-26 - Image queue can pin most of the shared DB pool during Sharp work

- Severity: Medium
- Confidence: High
- Status: Likely performance/concurrency issue
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/db/index.ts:23-33`; `apps/web/src/lib/image-queue.ts:87-90`, `:446-657`, `:812-815`.
- Failure scenario: high queue concurrency holds most pool connections while CPU/disk work runs.
- Fix direction: release shared-pool connections after row lease/claim or reserve live-traffic pool budget.

### AGG-C15-27 - GPS stripping re-materializes whole originals after streaming save

- Severity: Medium
- Confidence: High
- Status: Confirmed memory risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/lib/process-image.ts:887-910`, `:1738-1786`; upload call sites in browser and Lightroom paths.
- Failure scenario: large originals are read into memory after streaming save, increasing GC/OOM risk.
- Fix direction: add a memory semaphore or streaming/container-aware scrub path.

### AGG-C15-28 - Public view analytics can consume DB pool/write capacity on every page view

- Severity: Medium
- Confidence: Medium
- Status: Likely performance risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/app/actions/public.ts:324-451`; public render call sites.
- Failure scenario: anonymous traffic or bots generate validation reads and durable inserts in the same DB pool as live pages/admin work.
- Fix direction: buffer/batch events and cache/dedupe visibility checks where safe.

### AGG-C15-29 - Sidecar backfill scripts materialize and enqueue the full candidate set

- Severity: Medium
- Confidence: High
- Status: Confirmed performance risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/scripts/backfill-color-pipeline.ts:342-357`, `:474-511`; `apps/web/scripts/backfill-cicp-recheck.ts:57-93`, `:144`.
- Failure scenario: large libraries allocate every candidate row plus queued closure state before processing drains.
- Fix direction: keyset-batch candidate fetch and drain only the current batch.

### AGG-C15-30 - Publication-time feed ordering lacks matching indexes

- Severity: Medium
- Confidence: Medium
- Status: Likely query risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/lib/data.ts:828-853`; `apps/web/src/db/schema.ts:114-120`.
- Failure scenario: feed hits scan/sort far more rows than returned on large galleries.
- Fix direction: add feed-shaped indexes after `EXPLAIN` validation.

### AGG-C15-31 - Dynamic first listing pages still do count-window work on hot requests

- Severity: Medium
- Confidence: Medium
- Status: Risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/lib/data.ts:878-907`, `:1438-1453`; `CLAUDE.md:400`.
- Failure scenario: dynamic SSR pages repeat broad `COUNT(*) OVER()` work for anonymous traffic.
- Fix direction: avoid exact hot-path counts or compute/cache them separately.

### AGG-C15-32 - Admin failed-image recovery can become unbounded and unindexed

- Severity: Medium
- Confidence: High
- Status: Confirmed recurring recovery risk
- Sources: `critic`
- Evidence: `apps/web/src/lib/data.ts:999-1013`; `apps/web/src/db/schema.ts:114-120`; dashboard call/render sites.
- Failure scenario: thousands of failures make the recovery dashboard slow or unusable.
- Fix direction: cap/paginate failed images and add a supporting index.

### AGG-C15-33 - Batch delete repeats derivative-directory scans per image and format

- Severity: Medium
- Confidence: High
- Status: Confirmed admin I/O risk
- Sources: `critic`
- Evidence: `apps/web/src/lib/process-image.ts:586-643`; `apps/web/src/app/actions/images.ts:688-698`, `:807-845`.
- Failure scenario: deleting many images causes O(selected images * derivative directory size) scans.
- Fix direction: scan each derivative directory once per batch and unlink matched prefixes.

### AGG-C15-34 - Production semantic search silently searches newest capped embedding window

- Severity: Medium
- Confidence: High
- Status: Risk
- Sources: `critic`, `perf-reviewer`
- Evidence: `apps/web/src/lib/clip-embeddings.ts:36-44`; `apps/web/src/app/api/search/semantic/route.ts:261-273`; `apps/web/src/components/search.tsx:460-494`; `apps/web/messages/en.json:401-416`.
- Failure scenario: older embedded photos outside the scan window are impossible to return, with no production UI signal.
- Fix direction: return/display partial-scope metadata or move to a full-corpus vector index.

### AGG-C15-35 - Real CLIP/offline-load tests are skipped by default

- Severity: Medium
- Confidence: High
- Status: Risk requiring periodic validation
- Sources: `test-engineer`
- Evidence: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`.
- Failure scenario: model/dependency/cache regressions break production semantic search while default CI remains green.
- Fix direction: add a scheduled or conditional CI workflow with seeded model weights.

### AGG-C15-36 - Nav visual e2e tests save screenshots but do not compare them

- Severity: Low
- Confidence: High
- Status: Confirmed false-confidence test issue
- Sources: `test-engineer`
- Evidence: `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, `:78`.
- Failure scenario: spacing/color/stacking regressions pass because screenshots are only artifacts.
- Fix direction: use `toHaveScreenshot` or rename the spec to layout-metric checks.

### AGG-C15-37 - Production must preserve documented single-instance trusted-proxy topology

- Severity: High if scaled or directly exposed behind untrusted forwarded headers
- Confidence: High for repo assumption, medium for live state
- Status: Manual-validation risk
- Sources: `security-reviewer`
- Evidence: `CLAUDE.md:228`; `apps/web/docker-compose.yml:21`; `apps/web/nginx/default.conf:67-70`, `:192-196`; `apps/web/src/lib/request-origin.ts`; `apps/web/src/lib/rate-limit.ts:164-191`.
- Failure scenario: horizontal scale or direct `TRUST_PROXY=true` exposure weakens rate limits/origin/correctness.
- Fix direction: validate topology; move process-local state to shared storage before scale-out.

### AGG-C15-38 - SQL backups are plaintext and DB-only by design

- Severity: Low to Medium depending on host/storage controls
- Confidence: High
- Status: Manual-validation risk
- Sources: `security-reviewer`
- Evidence: `CLAUDE.md:209`; backup/restore code paths.
- Failure scenario: exposed host storage reveals sensitive DB contents; DB-only restore leaves file rows mismatched.
- Fix direction: confirm encrypted storage/access controls and pair DB dumps with filesystem snapshots.

### AGG-C15-39 - Admin authorization is all-root by product decision

- Severity: Medium if admins are not equally trusted
- Confidence: High
- Status: Manual-validation risk
- Sources: `security-reviewer`
- Evidence: `CLAUDE.md:5`, `:229`; representative admin actions.
- Failure scenario: any compromised/lower-trust admin can manage users, tokens, backups, settings, uploads, and restores.
- Fix direction: validate trust model or add roles/step-up controls.

### AGG-C15-40 - Historical secrets still require operator rotation validation

- Severity: Medium if production secrets came from historical examples
- Confidence: High current HEAD clean, unknown production provenance
- Status: Manual-validation risk
- Sources: `security-reviewer`
- Evidence: `CLAUDE.md:80-85`; `README.md:122-145`; `apps/web/.env.local.example:20-30`; `apps/web/src/lib/session.ts:19-35`.
- Failure scenario: copied historical secrets remain in production.
- Fix direction: validate/rotate secrets with uncertain provenance.

## Zero-Finding Lanes

`verifier` and `tracer` reported no confirmed findings after their current-HEAD sweeps. Their reports remain preserved for validation provenance.

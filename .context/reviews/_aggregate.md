# Cycle 11 Aggregate Review

Date: 2026-06-29
Repository: `/Users/hletrd/flash-shared/gallery`
Review surface: current `master` after Cycle 10 fixes plus Cycle 11 review-only commits.

## Agent Coverage

All required and registered review lanes returned. No agent failures.

Artifacts included:

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

Additional registered reviewer-style agents found and included:

- `product-marketer-reviewer`
- `ui-ux-designer-reviewer`

## Finding Summary

Distinct findings after dedupe: 39

High confidence / cross-agent agreement:

- Missing-embedding bootstrap side effects are unbounded. Reported by critic, debugger, perf, and test/architecture-adjacent lanes.
- Sidecar backfill concurrency parsing is unbounded/non-integer. Reported by code-reviewer and architect.
- Same-origin checks exist but many mutating admin actions run auth/session work first. Reported by code-reviewer and architect.
- UI/privacy copy around GPS and "AI" wording can mislead users. Reported by product-marketer and related doc/UI checks.
- Archive/photo-viewer UI contracts lag behind main gallery contracts. Reported by designer and UI/UX reviewer.

## Scheduled Findings

### AGG-C11-01 - Post-restore migration setup failure can hang restore cleanup

Severity: High
Confidence: Medium
Status: Likely issue
Sources: `debugger.md` (`DBG11-02`)
Files: `apps/web/src/app/[locale]/admin/db-actions.ts:559-620`

If `runPostRestoreMigrations()` throws inside the async `mysql` close handler, the restore promise may never resolve, so outer cleanup may not end maintenance, resume the queue, or release locks. Schedule a fix that catches migration setup/runtime exceptions inside the close handler and resolves a failed restore result so the outer cleanup path always runs.

### AGG-C11-02 - Missing-embedding bootstrap schedules unbounded side effects

Severity: High
Confidence: High
Status: Confirmed
Sources: `critic.md` (`C11-CRIT-01`), `debugger.md` (`DBG11-01`), `perf-reviewer.md` (`PERF-C11-03` related), `test-engineer.md`
Files: `apps/web/src/lib/image-queue.ts:370-421`, `apps/web/src/lib/clip-model.ts:53-70`

`bootstrapMissingActiveEmbeddings()` pages rows in batches but launches every row as an unawaited tracked side effect before fetching the next batch. On a large missing-embedding set this can create thousands of promises and DB writes. Schedule bounded, awaited batch processing and a regression that proves the next page is not selected before the prior batch settles.

### AGG-C11-03 - Sidecar backfill scripts accept unbounded/non-integer concurrency

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `code-reviewer.md` (`C11-CQ-02`), `architect.md` (`ARCH-C11-02`)
Files: `apps/web/scripts/backfill-color-pipeline.ts:370-371`, `apps/web/scripts/backfill-cicp-recheck.ts:80-81`, `apps/web/src/lib/env.ts:1-24`

`BACKFILL_CONCURRENCY=Infinity`, `1e309`, or very large values can bypass intended sidecar queue bounds. Schedule finite integer parsing with an explicit cap and tests/source contracts for invalid values.

### AGG-C11-04 - Image queue can starve the shared DB pool while holding locks across Sharp work

Severity: Medium
Confidence: High
Status: Likely issue
Sources: `perf-reviewer.md` (`PERF-C11-01`)
Files: `apps/web/src/lib/image-queue.ts:86-89`, `apps/web/src/lib/image-queue.ts:440-456`, `apps/web/src/lib/image-queue.ts:616-631`, `apps/web/src/db/index.ts:23-33`

`QUEUE_CONCURRENCY` can be raised to 8 while jobs hold pooled advisory-lock connections across expensive image processing. Schedule a pool-budget clamp or a dedicated lock-pool design. If not fully fixed this cycle, preserve severity in deferred work.

### AGG-C11-05 - GPS stripping reintroduces whole-file heap pressure

Severity: Medium
Confidence: High
Status: Likely issue
Sources: `perf-reviewer.md` (`PERF-C11-02`)
Files: `apps/web/src/lib/process-image.ts:887-910`, `apps/web/src/lib/process-image.ts:1738-1786`, `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:139-145`

Uploads stream originals to disk, but `stripGpsFromOriginal()` reads the entire saved file and can allocate a second full output buffer. Schedule a memory budget/serialization guard or a streaming/container rewrite plan. This is reliability-related and may be deferred only with an explicit operational reason and exit criterion.

### AGG-C11-06 - CLIP inference has no global backlog cap or timeout

Severity: Medium
Confidence: Medium-High
Status: Risk
Sources: `perf-reviewer.md` (`PERF-C11-03`)
Files: `apps/web/src/lib/clip-model.ts:53-70`, `apps/web/src/app/api/search/semantic/route.ts:243-300`

`inferenceWaiters` is unbounded. Schedule a bounded queue/timeout/backpressure design or defer with an exit criterion tied to production semantic traffic/backfill concurrency.

### AGG-C11-07 - Pre-body semantic aborts consume rate-limit budget

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `critic.md` (`C11-CRIT-02`)
Files: `apps/web/src/app/api/search/semantic/route.ts:186-200`, `apps/web/src/lib/rate-limit.ts:340-343`

The route pre-increments before the first abort check, so an already-aborted request can return 499 before body/CPU/scan work while still consuming one of 30/min attempts. Schedule moving the abort check before pre-increment or rolling back this specific pre-body abort branch.

### AGG-C11-08 - Same-origin checks run after auth/session work in many admin actions

Severity: Low
Confidence: High
Status: Confirmed
Sources: `code-reviewer.md` (`C11-CQ-01`), `architect.md` (`ARCH-C11-01`)
Files: `apps/web/src/app/actions/settings.ts:40-47`, `apps/web/src/app/actions/seo.ts:54-61`, `apps/web/src/app/actions/topics.ts:85-92`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`

The CSRF guard exists, but session/auth work often happens before provenance rejection. Schedule prologue normalization and scanner strengthening.

### AGG-C11-09 - PAT auth reaches DB before app-level rate limiting

Severity: Low
Confidence: High
Status: Confirmed
Sources: `security-reviewer.md`
Files: `apps/web/src/lib/api-auth.ts:64-72`, `apps/web/src/lib/admin-tokens.ts:137-148`

Syntactically valid bogus `gk_` tokens trigger indexed DB lookup before app-level throttling. Schedule a lightweight pre-auth token-attempt limiter or defer with nginx/direct-app exposure assumptions recorded.

### AGG-C11-10 - Public LIKE escaping depends on MySQL backslash semantics

Severity: Low
Confidence: High
Status: Risk
Sources: `security-reviewer.md`
Files: `apps/web/src/lib/data.ts:1491-1499`, `apps/web/src/lib/smart-collections.ts:217-221`

Escaped `%` and `_` rely on MySQL's default backslash LIKE escape behavior. Schedule an explicit `ESCAPE '\\'` helper or an SQL-mode fail-closed check.

### AGG-C11-11 - Quarantined storage backend maps private originals under public upload root

Severity: Medium
Confidence: High
Status: Risk
Sources: `architect.md` (`ARCH-C11-RISK-01`)
Files: `apps/web/src/lib/storage/local.ts:14-20`, `apps/web/src/lib/storage/local.ts:40-84`, `apps/web/src/lib/storage/types.ts:11-14`

The storage abstraction is quarantined, but if integrated as-is `original/*` writes land under `public/uploads/original`. Schedule either a storage-domain fix/test or an explicit deferral quoting the repo rule that storage is not integrated.

### AGG-C11-12 - Browser and Lightroom upload ingest logic is duplicated

Severity: Medium
Confidence: High
Status: Risk
Sources: `architect.md` (`ARCH-C11-RISK-02`), `test-engineer.md` (`C11-TE-04`)
Files: `apps/web/src/app/actions/images.ts:114-612`, `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`

The two ingest paths duplicate quota, locks, HDR/GPS, DB insert, enqueue, audit, and cleanup logic. Schedule behavior tests and/or extraction of a shared service. A full extraction may be deferred if this cycle adds targeted route behavior tests.

### AGG-C11-13 - Semantic search recall is bounded to most-recent embeddings

Severity: Medium
Confidence: High
Status: Risk
Sources: `tracer.md` (`TRC11-RISK-01`)
Files: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:256-268`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`

The route scans only up to `SEMANTIC_SCAN_LIMIT` rows ordered by `updated_at DESC`, so older photos outside the cap are never candidates. Schedule an admin/user disclosure or vector-index/full-scan roadmap; defer only with the bounded-recall exit criterion.

### AGG-C11-14 - Dark in-app CLIP backfill can report success after one capped candidate set

Severity: Low
Confidence: Medium
Status: Risk
Sources: `tracer.md` (`TRC11-RISK-02`), `test-engineer.md` (`C11-TE-05`)
Files: `apps/web/src/app/actions/embeddings.ts:79-80`, `apps/web/src/app/actions/embeddings.ts:103-172`

The currently unwired action processes one `SEMANTIC_SCAN_LIMIT`-bounded candidate set and returns `ok` without `hasMore`. Schedule removal, pagination, or a guard against future UI treating it as complete.

### AGG-C11-15 - Correctness guards depend on single web-instance topology

Severity: Medium
Confidence: High
Status: Risk
Sources: `tracer.md` (`TRC11-RISK-03`)
Files: `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/image-queue.ts:250-323`, `apps/web/src/lib/upload-tracker-state.ts:7-79`, `apps/web/src/app/actions/public.ts:323-341`

This is documented but still a scale-out risk. Defer unless changing deployment topology; exit criterion is any move beyond single web instance.

### AGG-C11-16 - Upload tag records can be created before any image is accepted

Severity: Low
Confidence: Medium
Status: Risk
Sources: `critic.md` (`C11-CRIT-03`)
Files: `apps/web/src/app/actions/images.ts:295-323`, `apps/web/src/lib/tag-records.ts:66-68`

New tags may persist with zero images if all files are rejected before insert. Schedule a regression or defer as low-impact admin data hygiene.

### AGG-C11-17 - Infinite masonry keeps all loaded cards mounted

Severity: Low-Medium
Confidence: Medium-High
Status: Risk
Sources: `perf-reviewer.md` (`PERF-C11-04`)
Files: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-360`, `apps/web/src/components/load-more.tsx:41-132`

Long browse sessions can accumulate thousands of DOM nodes. Defer unless large-gallery UI traces become a priority; exit criterion is gallery size/trace evidence or user-reported jank.

### AGG-C11-18 - Public archive and smart-collection predicates can become CPU scan paths

Severity: Low-Medium
Confidence: High
Status: Risk
Sources: `perf-reviewer.md` (`PERF-C11-05`)
Files: `apps/web/src/lib/data-timeline.ts:92-207`, `apps/web/src/lib/smart-collections.ts:217-266`

Function predicates and `%LIKE%` are acceptable at personal-gallery scale but can become expensive. Defer unless data size/crawl traffic crosses an operational threshold.

### AGG-C11-19 - Base-URL docs/guard allow split-brain OG configuration

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `document-specialist.md`
Files: `CLAUDE.md:214`, `CLAUDE.md:633-636`, `apps/web/scripts/ensure-site-config.mjs:11-40`, `apps/web/src/app/api/og/photo/[id]/route.tsx:51-131`

`BASE_URL` can override build validation while per-photo OG fetches still use `siteConfig.url`. Schedule aligning docs, guard, and route URL source.

### AGG-C11-20 - Service-worker docs overstate public-page `revalidate = 0`

Severity: Low
Confidence: High
Status: Confirmed docs mismatch
Sources: `document-specialist.md`
Files: `CLAUDE.md:399-410`, `apps/web/public/sw.template.js:7-15`, `apps/web/public/sw.js:7-15`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx:1-15`

Privacy is a public static route without `revalidate = 0`. Schedule doc/template/test comment correction or add `revalidate = 0` if the broad contract is desired.

### AGG-C11-21 - Atom feed comments imply per-entry admin authors

Severity: Low
Confidence: High
Status: Confirmed docs/comment mismatch
Sources: `document-specialist.md`
Files: `CLAUDE.md:171`, `apps/web/src/lib/data.ts:827-845`, `apps/web/src/app/feed.xml/route.ts:76-83`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`

Data intentionally emits `author_name: NULL`, but route comments still discuss per-entry admin authors. Schedule comment correction.

### AGG-C11-22 - Privacy page falsely says public pages exclude GPS coordinates

Severity: High
Confidence: High
Status: Confirmed
Sources: `product-marketer-reviewer.md` (`PMR-C11-01`)
Files: `apps/web/messages/en.json:773-781`, `apps/web/messages/ko.json:773-781`, `apps/web/src/app/[locale]/(public)/map/page.tsx:38-50`, `apps/web/src/lib/data.ts:1658-1684`

Public standard pages omit GPS, but the public map route intentionally exposes opted-in coordinates. Schedule privacy-copy correction in both locales.

### AGG-C11-23 - Footer hides Privacy link unless Google Analytics is configured

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `product-marketer-reviewer.md` (`PMR-C11-02`)
Files: `apps/web/src/components/footer.tsx:6-48`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx:21-28`

Privacy covers metadata/GPS behavior, not only analytics. Schedule always rendering the Privacy link.

### AGG-C11-24 - Bulk editor claims AI-suggested alt text though generator is EXIF stub

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `product-marketer-reviewer.md` (`PMR-C11-03`)
Files: `apps/web/messages/en.json:233-234`, `apps/web/messages/ko.json:233-234`, `apps/web/src/lib/caption-generator.ts:1-64`, `apps/web/src/components/bulk-edit-dialog.tsx:241-257`

Schedule copy change to EXIF-derived suggested alt text until real model inference ships.

### AGG-C11-25 - README "batch editing" can imply photo editing

Severity: Medium
Confidence: Medium
Status: Risk
Sources: `product-marketer-reviewer.md` (`PMR-C11-RISK-01`)
Files: `README.md:40`, `apps/web/src/lib/bulk-edit-types.ts:1-19`

Schedule README wording change to "batch metadata editing" and reinforce that GalleryKit is a publishing/gallery tool, not an editor/culler/scorer.

### AGG-C11-26 - Playwright visual nav checks only write screenshots

Severity: Medium
Confidence: High
Status: Confirmed test gap
Sources: `test-engineer.md` (`C11-TE-01`)
Files: `apps/web/e2e/nav-visual-check.spec.ts:40-79`

Schedule real `toHaveScreenshot` baselines or rename/move manual screenshots out of pass/fail e2e.

### AGG-C11-27 - No coverage report/threshold gate exists

Severity: Low
Confidence: High
Status: Confirmed test gap
Sources: `test-engineer.md` (`C11-TE-02`)
Files: `package.json:11-22`, `apps/web/package.json:8-26`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-80`

Defer unless adding coverage infrastructure this cycle; exit criterion is changed security/privacy/upload/migration critical surface without coverage signal.

### AGG-C11-28 - Backup download chmod test can flake under root

Severity: Low
Confidence: Medium-High
Status: Confirmed flaky-test risk
Sources: `test-engineer.md` (`C11-TE-03`)
Files: `apps/web/src/__tests__/backup-download-route.test.ts:142-160`

Schedule replacing chmod oracle with mocked filesystem error.

### AGG-C11-29 - Lightroom upload route lacks behavior tests

Severity: Medium
Confidence: High
Status: Likely TDD gap
Sources: `test-engineer.md` (`C11-TE-04`), `architect.md` (`ARCH-C11-RISK-02`)
Files: `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`

Schedule route-level behavior tests or defer only if shared ingest extraction is scheduled first.

### AGG-C11-30 - `backfillClipEmbeddings` action has only source-order coverage

Severity: Low
Confidence: Medium
Status: Likely TDD gap
Sources: `test-engineer.md` (`C11-TE-05`), `tracer.md` (`TRC11-RISK-02`)
Files: `apps/web/src/app/actions/embeddings.ts:55-180`

Schedule behavior tests before UI wiring, or remove/guard the unwired action.

### AGG-C11-31 - Atom feed route behavior lacks route-level tests

Severity: Low
Confidence: Medium
Status: Likely TDD gap
Sources: `test-engineer.md` (`C11-TE-06`)
Files: `apps/web/src/app/feed.xml/route.ts:29-166`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:28-165`

Schedule route-level tests for 200/304/404/header wiring or defer as helper-covered low risk.

### AGG-C11-32 - Production CLIP/offline tests are gated out of default CI

Severity: Medium
Confidence: High
Status: Risk
Sources: `test-engineer.md` (`C11-TE-07`)
Files: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `.github/workflows/quality.yml:27-80`

Defer unless CI/model-weight caching is in scope; exit criterion is CLIP dependency/model-path change or semantic production rollout change.

### AGG-C11-33 - Browser E2E is Chromium-only

Severity: Low
Confidence: High
Status: Risk
Sources: `test-engineer.md` (`C11-TE-08`)
Files: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:72-74`

Defer unless adding cross-browser CI; exit criterion is browser-specific color/HDR/UI release work.

### AGG-C11-34 - Timeline/year grids lazy-load first visible photos

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `ui-ux-designer-reviewer.md` (`UIUX-C11-01`)
Files: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:238-258`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:196-215`

Schedule above-the-fold `loading="eager"` / `fetchPriority="high"` parity with home/shared grids.

### AGG-C11-35 - Timeline/year card geometry lacks dimension guard

Severity: Low
Confidence: Medium
Status: Risk
Sources: `ui-ux-designer-reviewer.md` (`UIUX-C11-02`)
Files: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:225-231`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:183-189`

Schedule valid-dimension fallback parity with home/shared grids.

### AGG-C11-36 - Map dynamic-loading fallback is visually blank

Severity: Low
Confidence: High
Status: Confirmed
Sources: `ui-ux-designer-reviewer.md` (`UIUX-C11-03`)
Files: `apps/web/src/components/map/map-loader.tsx:24-31`

Schedule visible loading copy/spinner while preserving `role="status"`.

### AGG-C11-37 - Primary photo/lightbox images expose generic alt text

Severity: High
Confidence: High
Status: Confirmed
Sources: `designer.md` (`DES-C11-01`)
Files: `apps/web/src/lib/photo-title.ts:85-121`, `apps/web/src/components/photo-viewer.tsx:443-528`, `apps/web/src/components/lightbox.tsx:496-505`

Schedule alt helper/viewer update so tags/display title feed the primary image alt path when no authored alt text exists.

### AGG-C11-38 - Photo page advertises Space slideshow shortcut where Space scrolls

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `designer.md` (`DES-C11-02`)
Files: `apps/web/messages/en.json:344`, `apps/web/messages/ko.json:344`, `apps/web/src/components/photo-viewer.tsx:575-576`, `apps/web/src/components/photo-viewer.tsx:388-419`

Schedule implementing Space behavior on the page or scoping the copy to lightbox mode.

### AGG-C11-39 - Window-level swipe navigation fires while mobile info sheet is open

Severity: Medium
Confidence: High
Status: Confirmed
Sources: `designer.md` (`DES-C11-03`)
Files: `apps/web/src/components/photo-navigation.tsx:43-140`, `apps/web/src/components/photo-viewer.tsx:688-695`, `apps/web/src/components/info-bottom-sheet.tsx:184-210`

Schedule disabling photo swipe navigation while the mobile info sheet/dialog is open or ignoring swipes that originate inside dialogs/interactive overlays.

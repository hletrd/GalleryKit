# Cycle 11 Aggregate Review

Date: 2026-07-07
Repo: `/Users/hletrd/flash-shared/gallery`
Cycle: 11/100

## Review Coverage

Prompt 1 fan-out completed across the requested reviewer perspectives and the two registered custom reviewer prompts found in `/Users/hletrd/.codex/agents`.

Native child-agent concurrency was limited to five live threads in this environment, so the review fan-out ran in waves rather than one physical batch. No reviewer was silently dropped.

Per-agent provenance files:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/architect.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/product-marketer-reviewer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`

## Agent Failures

None.

## Deduped Findings

### AGG-C11-01 - Topic route advisory lock release failure can leak a pooled MySQL lock

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer
- Citation: `apps/web/src/app/actions/topics.ts:69-89`
- Summary: `RELEASE_LOCK` errors are swallowed and the MySQL connection is returned to the pool, so a live session can retain `gallerykit_topic_route_segments` and cause later topic mutations to time out.
- Fix: log and destroy the connection on release failure, returning it to the pool only after confirmed unlock; add a focused regression test.

### AGG-C11-02 - Shared-group read helper owns view-count mutation

- Severity: Low
- Confidence: High
- Source agents: code-reviewer, architect
- Citation: `apps/web/src/lib/data.ts:1318-1407`
- Summary: `getSharedGroup()` looks like a read helper but can buffer a view-count write, making cache/call order part of analytics correctness.
- Fix: split pure shared-group reads from explicit view-count recording.

### AGG-C11-03 - Drizzle Kit TLS CA handling diverges from runtime/scripts

- Severity: Low
- Confidence: High
- Source agents: code-reviewer, architect
- Citation: `apps/web/drizzle.config.ts:1-22`
- Summary: runtime and scripts honor `DB_SSL_CA`, while Drizzle Kit enables TLS without loading the configured CA.
- Fix: centralize or mirror DB SSL option construction and fail closed for non-local DBs without supported CA configuration.

### AGG-C11-04 - Load-more tests duplicate a looser cursor normalizer

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer
- Citation: `apps/web/src/__tests__/public-actions.test.ts:39-56`
- Summary: action tests reimplement cursor parsing instead of importing the real strict helper, allowing production/test contract drift.
- Fix: import the real helper through `vi.importActual` and add direct edge-case coverage.

### AGG-C11-05 - Batch image deletion scans derivative directories repeatedly

- Severity: Medium
- Confidence: High
- Source agents: perf-reviewer
- Citation: `apps/web/src/app/actions/images.ts:735-744`
- Summary: deleting up to 100 images can rescan WebP/AVIF/JPEG derivative directories once per image.
- Fix: batch-index derivative directories once per delete batch.

### AGG-C11-06 - Dynamic date archive/home paths still use non-sargable date functions

- Severity: Medium
- Confidence: High
- Source agents: perf-reviewer, critic
- Citation: `apps/web/src/lib/data-timeline.ts:102-130`
- Summary: On This Day and timeline-year queries use `MONTH()`, `DAY()`, or `YEAR()` on dynamic public paths.
- Fix: add generated/indexed date keys or cached rollups and update tests away from non-sargable expectations.

### AGG-C11-07 - Public listing queries aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Source agents: perf-reviewer
- Citation: `apps/web/src/lib/data.ts:786-828`
- Summary: broad listing queries group tag joins before applying page limits.
- Fix: first select page image IDs through image-table indexes, then aggregate tags only for those IDs.

### AGG-C11-08 - Semantic search/similar routes brute-force embedding blobs per request

- Severity: Medium
- Confidence: Medium
- Source agents: perf-reviewer
- Citation: `apps/web/src/app/api/search/semantic/route.ts:263-311`
- Summary: production semantic paths can decode and score large embedding scans on the Node request path.
- Fix: move scoring to a vector index, worker thread, or bounded cached matrix; tighten expensive-work limiting.

### AGG-C11-09 - Public map can ship and hydrate up to 10,000 markers plus a duplicate list

- Severity: Medium
- Confidence: High
- Source agents: perf-reviewer, critic
- Citation: `apps/web/src/lib/data.ts:1741-1777`
- Summary: `/map` serializes thousands of markers and renders both Leaflet markers and an accessible list.
- Fix: use viewport/bounds loading, clustering/canvas/WebGL, list virtualization, and one-pass bounds calculation.

### AGG-C11-10 - Public smart collections can expose expensive predicates on dynamic routes

- Severity: Medium
- Confidence: Medium
- Source agents: perf-reviewer
- Citation: `apps/web/src/lib/smart-collections.ts:221-267`
- Summary: broad `contains` predicates and tag subqueries can make public `/c/[slug]` pages expensive.
- Fix: classify/index/materialize public collection predicates or block expensive published shapes.

### AGG-C11-11 - Admin photo page duplicates image fan-out for authenticated viewers

- Severity: Low
- Confidence: High
- Source agents: perf-reviewer
- Citation: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`
- Summary: admins can trigger public and admin image fetch paths for one page body.
- Fix: resolve admin status before fetching and call exactly one body image reader.

### AGG-C11-12 - Startup orphan-temp cleanup uses unbounded filesystem fan-out

- Severity: Low
- Confidence: High
- Source agents: perf-reviewer
- Citation: `apps/web/src/lib/image-queue.ts:40-96`
- Summary: crash residue cleanup can run `stat`/`unlink` over many temp files at once.
- Fix: add bounded concurrency or fixed-size batches.

### AGG-C11-13 - Raw `IMAGE_BASE_URL` can leak credential/query-bearing CDN config

- Severity: Medium
- Confidence: High
- Source agents: security-reviewer
- Citation: `apps/web/src/lib/constants.ts:17`, `apps/web/src/app/[locale]/layout.tsx:117`
- Summary: CSP rejects credential/query CDN URLs, but layout and image URL construction still expose the raw env value publicly.
- Fix: share one validator/sanitizer across CSP, layout, and image URL helpers; reject credentials/query/hash.

### AGG-C11-14 - Production dependency audit remains red on Next nested PostCSS

- Severity: Medium
- Confidence: High
- Source agents: security-reviewer, critic, verifier
- Citation: `package-lock.json:9334`
- Summary: `next@16.2.10` still installs nested `postcss@8.4.31`, failing production audit.
- Fix: upgrade Next when fixed or prove a lockfile-effective nested override without downgrade.

### AGG-C11-15 - Dev dependency audit remains red on deprecated esbuild chain

- Severity: Low
- Confidence: High
- Source agents: security-reviewer
- Citation: `package-lock.json:378-386`
- Summary: Drizzle tooling pulls deprecated `@esbuild-kit/*` with vulnerable dev-only esbuild.
- Fix: upgrade/override the tooling chain or document localhost-only dev-tool exposure until upstream resolves it.

### AGG-C11-16 - Legacy reconcile remains a second schema authority with source-only parity coverage

- Severity: Medium
- Confidence: High
- Source agents: critic
- Citation: `apps/web/scripts/migrate.js:348-717`
- Summary: `reconcileLegacySchema()` mirrors schema by hand; tests mostly tripwire names rather than structural parity.
- Fix: add disposable-MySQL migration-vs-reconcile parity diff over columns, indexes, and FKs.

### AGG-C11-17 - Real CLIP production activation is outside required gates

- Severity: High
- Confidence: High
- Source agents: critic, test-engineer
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`
- Summary: real-model tests are skipped without weights/env, so CI can pass while production CLIP loading is broken.
- Fix: add scheduled/opt-in CI preflight with seeded weights or require a recent preflight marker before production activation.

### AGG-C11-18 - Nginx security/performance controls remain outside deploy visibility

- Severity: Medium
- Confidence: High
- Source agents: critic, architect
- Citation: `apps/web/deploy.sh:51-56`, `apps/web/nginx/default.conf:1-69`
- Summary: important public/admin rate limits and proxy controls are in a host nginx template that normal deploys do not apply or verify.
- Fix: make nginx config hash/apply/reload visible in deploy output or add an app-layer fallback.

### AGG-C11-19 - Single-writer topology is warn-only

- Severity: Medium
- Confidence: High
- Source agents: critic, architect
- Citation: `apps/web/src/lib/single-writer-guard.ts:218-235`
- Summary: persistent DB advisory-lock contention only logs, while correctness-relevant state remains process-local.
- Fix: add production enforcement/readiness failure mode or move coordination state to DB-backed primitives.

### AGG-C11-20 - Mobile bottom-sheet dropdown regression lock is source-string only

- Severity: Medium
- Confidence: High
- Source agents: critic, test-engineer
- Citation: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`
- Summary: tests assert portal wiring strings rather than mobile menu visibility/focus behavior.
- Fix: add a mobile Playwright behavior test for the info-sheet download dropdown.

### AGG-C11-21 - Touch-target gate lets bare text links pass

- Severity: Low
- Confidence: High
- Source agents: critic
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:457-464`
- Summary: the 44 px target gate has a broad bare-link exception that can let control-like links through.
- Fix: add DOM-level touch auditing or an explicit inline-text allowlist.

### AGG-C11-22 - Restore can hang indefinitely while draining background DB writes

- Severity: Medium
- Confidence: High
- Source agents: verifier
- Citation: `apps/web/src/lib/background-db-writes.ts:77`, `apps/web/src/app/[locale]/admin/db-actions.ts:545`
- Summary: restore waits for background DB writes with no timeout, so a never-settling write can hold maintenance indefinitely.
- Fix: add bounded restore drain semantics and regression coverage for a never-resolving write.

### AGG-C11-23 - Settings hash normalization and mapper coverage can drift

- Severity: Medium
- Confidence: High
- Source agents: verifier
- Citation: `apps/web/src/lib/settings-hash.ts:79-103`
- Summary: comments/tests overstate invalid-value normalization and `buildHashFromConfig()` hand-maps color-impacting keys.
- Fix: normalize through the same config resolver and make the mapper exhaustive over `COLOR_IMPACTING_KEYS`.

### AGG-C11-24 - Canonical index docs omit feed/sitemap `updated_at` indexes

- Severity: Low
- Confidence: High
- Source agents: verifier
- Citation: `CLAUDE.md:242-244`, `apps/web/drizzle/0029_feed_updated_indexes.sql:1`
- Summary: schema and migrations include `updated_at` indexes absent from the canonical index list.
- Fix: document the feed/sitemap indexes in `CLAUDE.md`.

### AGG-C11-25 - DB restore child-process failure cleanup is source-only

- Severity: Medium
- Confidence: High
- Source agents: test-engineer
- Citation: `apps/web/src/__tests__/db-restore.test.ts:47-75`
- Summary: restore import failure cleanup is mostly asserted by source snippets rather than child-process behavior.
- Fix: add mocked child-process behavior tests for spawn/stdin/stream/watchdog cleanup.

### AGG-C11-26 - Lightroom upload route behavior harness covers too few branches

- Severity: Medium
- Confidence: High
- Source agents: test-engineer
- Citation: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:178-278`
- Summary: many early/late LR upload failure branches are source-locked or untested at handler level.
- Fix: extend table-driven route tests for 503/411/429/409/507/422/topic/settings branches.

### AGG-C11-27 - First-class admin UI surfaces remain e2e-shallow

- Severity: Medium
- Confidence: High
- Source agents: test-engineer
- Citation: `apps/web/e2e/admin.spec.ts:20-165`
- Summary: admin e2e navigates/mutates a subset and misses Tokens, SEO, Tags, Users, DB backup list, and Settings behavior.
- Fix: add focused admin Playwright flows, starting with Lightroom token create/ack/revoke.

### AGG-C11-28 - Client interaction regressions are often locked by source strings

- Severity: Medium
- Confidence: High
- Source agents: test-engineer
- Citation: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:8-21`
- Summary: auto-lightbox, zoom, and sheet dropdown behavior have source-string tests where DOM/browser behavior is needed.
- Fix: replace critical source-string locks with jsdom or Playwright behavior checks.

### AGG-C11-29 - Browser/device/visual regression gates are too narrow

- Severity: Medium
- Confidence: High
- Source agents: test-engineer
- Citation: `apps/web/playwright.config.ts:72-77`
- Summary: CI runs only desktop Chromium, and nav visual screenshots are not compared as baselines.
- Fix: add narrow mobile WebKit/alternate-browser smoke and convert visual checks to `toHaveScreenshot` or rename them.

### AGG-C11-30 - No coverage report, threshold, or changed-file ratchet exists

- Severity: Medium
- Confidence: High
- Source agents: test-engineer
- Citation: `apps/web/vitest.config.ts:16-39`
- Summary: new critical source can land unexercised while source-contract tests stay green.
- Fix: add a non-blocking coverage baseline, then enforce changed-file ratchets for critical directories.

### AGG-C11-31 - `logout` can bypass restore mutation barrier

- Severity: Medium
- Confidence: High
- Source agents: tracer
- Citation: `apps/web/src/app/actions/auth.ts:268-288`
- Summary: `logout` deletes a session without restore maintenance check or admin mutation slot, so it can mutate restored session rows after import starts.
- Fix: fence `logout` with restore maintenance and `acquireAdminMutationSlot()` before verification/delete.

### AGG-C11-32 - Byte-impacting settings commit before static derivatives are regenerated

- Severity: Medium
- Confidence: High
- Source agents: architect
- Citation: `apps/web/src/app/actions/settings.ts:168-239`
- Summary: image-byte-impacting settings save immediately while existing static derivative files still serve old bytes until backfill.
- Fix: make derivative settings a generation workflow with pending version state or versioned derivative URLs.

### AGG-C11-33 - Experimental storage abstraction is weaker than live file-pipeline contract

- Severity: Low
- Confidence: Medium
- Source agents: architect
- Citation: `apps/web/src/lib/storage/types.ts:44-100`
- Summary: storage abstraction lacks atomic replace/rollback/cleanup guarantees required by current derivative serving.
- Fix: keep quarantined or extend contract before integration.

### AGG-C11-34 - Ignored migration wiki contradicts current migration behavior

- Severity: Medium
- Confidence: High
- Source agents: document-specialist
- Citation: `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md:19-27`
- Summary: ignored local wiki says new migrations do not execute on existing DBs, contradicting current pending-tail behavior.
- Fix: retire/rewrite the wiki or mark ignored wiki pages non-authoritative.

### AGG-C11-35 - Ignored CLIP wiki overclaims production live state

- Severity: Low
- Confidence: High
- Source agents: document-specialist
- Citation: `.omc/wiki/clip-semantic-search-us-p51.md:15-17`
- Summary: ignored wiki says CLIP is live in production, while canonical docs require host-state verification.
- Fix: rewrite to operator-enabled language or mark ignored wiki non-authoritative.

### AGG-C11-36 - Active carry-forward still treats site-config contract ambiguity as open

- Severity: Low
- Confidence: Medium-High
- Source agents: document-specialist
- Citation: `.context/plans/deferred-carry-forward.md:24-26`
- Summary: carry-forward backlog still frames build-time `site-config.json` behavior as ambiguous after docs clarified it.
- Fix: close/reword the row as a product decision if runtime editability remains desired.

### AGG-C11-37 - Admin category/tag/SEO save failures are toast-only

- Severity: Medium
- Confidence: High
- Source agents: designer
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-108`
- Summary: admin form errors are transient toasts without field state, persistent alert, invalid focus, or `aria-invalid`.
- Fix: reuse login/settings form error patterns with persistent alerts and invalid-field focus.

### AGG-C11-38 - Tag autocomplete popovers can be clipped inside admin image table scroller

- Severity: Medium
- Confidence: Medium
- Source agents: designer
- Citation: `apps/web/src/components/image-manager.tsx:427`, `apps/web/src/components/tag-input.tsx:231-232`
- Summary: `TagInput` suggestions are absolutely positioned under an overflow table container.
- Fix: render suggestions through a portal/popover layer and add a clipping regression.

### AGG-C11-39 - Map/timeline routes are working but not discoverable from public nav

- Severity: Medium
- Confidence: High
- Source agents: product-marketer-reviewer
- Citation: `apps/web/src/components/nav-client.tsx:128-191`
- Summary: README/demo claims map/timeline browsing, but live home navigation lacks links to `/map` and `/timeline`.
- Fix: add persistent footer/nav/about affordances and clarify map visibility constraints.

### AGG-C11-40 - Production semantic-search differentiator is hidden behind an icon-only control

- Severity: Medium
- Confidence: High
- Source agents: product-marketer-reviewer
- Citation: `apps/web/src/components/search.tsx:369-383`
- Summary: live semantic search works, but the visible UI only exposes an icon until the modal opens.
- Fix: show visible search text/hints when production semantic search is enabled.

### AGG-C11-41 - Similar photos are documented but missing from mobile photo surface

- Severity: Medium
- Confidence: High
- Source agents: product-marketer-reviewer
- Citation: `apps/web/src/components/photo-viewer.tsx:747-800`, `apps/web/src/components/info-bottom-sheet.tsx:353-560`
- Summary: `<SimilarPhotos>` is desktop-sidebar only and absent from the mobile info sheet.
- Fix: render similar photos in `InfoBottomSheet` or document the feature as desktop-only.

### AGG-C11-42 - Smart-collection delete guidance points admins to non-existent UI

- Severity: Medium
- Confidence: High
- Source agents: product-marketer-reviewer
- Citation: `apps/web/messages/en.json:506-507`
- Summary: category deletion tells admins to update a collection query even though there is no collections admin UI.
- Fix: return collection ids/names and make the operator-level DB remediation explicit until UI ships.

### AGG-C11-43 - Search results can expose many identical options for near-duplicate event photos

- Severity: Medium
- Confidence: High
- Source agents: ui-ux-designer-reviewer
- Citation: `apps/web/src/components/search.tsx:71-109`
- Summary: live search can return 20 rows with identical visible/accessibility labels and different hrefs.
- Fix: add a stable differentiator such as id, result ordinal, capture time, or sequence label.

### AGG-C11-44 - Mobile home puts a tag-filter wall before the first photo

- Severity: Medium
- Confidence: High
- Source agents: ui-ux-designer-reviewer
- Citation: `apps/web/src/components/tag-filter.tsx:62-123`, `apps/web/src/components/home-client.tsx:303-330`
- Summary: tag chips occupy much of the first mobile viewport before any photo.
- Fix: collapse, horizontally scroll, or sheet the full tag list on mobile while keeping 44 px targets.

### AGG-C11-45 - Normal photo viewer arrow controls omit structured shortcut metadata

- Severity: Low
- Confidence: High
- Source agents: ui-ux-designer-reviewer
- Citation: `apps/web/src/components/photo-navigation.tsx:306-328`
- Summary: normal viewer handles arrow keys but prev/next buttons lack `aria-keyshortcuts`; lightbox already has it.
- Fix: add `aria-keyshortcuts` and regression coverage.

### AGG-C11-46 - Admin image management is table-first rather than photo-workbench-first

- Severity: Medium
- Confidence: Medium-High
- Source agents: ui-ux-designer-reviewer
- Citation: `apps/web/src/components/image-manager.tsx:427-603`
- Summary: image management uses a dense horizontal table for photo metadata work.
- Fix: add a photo workbench layout with inspector and keep dense table as optional.

### AGG-C11-47 - Admin navigation is a flat ten-link wrap

- Severity: Low-Medium
- Confidence: High
- Source agents: ui-ux-designer-reviewer
- Citation: `apps/web/src/components/admin-nav.tsx:15-49`
- Summary: all admin destinations wrap at the same hierarchy level, weakening repeat-work spatial memory.
- Fix: group destinations into stable sections and use a sectioned narrow-width menu.

## Non-Findings / Closed Items

- Debugger found no active severity-rated latent bug after targeted guard and migration tests.
- Prior migration 0025 pending-tail failure is no longer active.
- Several cycle-10 items were verified closed: Docker native pins, binary embedding storage, `getTimelineImages()` range predicates, maintenance scheduler shutdown wiring, public analytics request capture, topic deletion fail-closed behavior, and search/archive label improvements.

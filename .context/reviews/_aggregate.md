# Cycle 17 Aggregate Review

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Cycle: review-plan-fix 17/100

## Agent Coverage

Prompt 1 completed all available requested reviewer lanes. The environment exposed only generic native subagent types, so role-specialist reviewers were run as role-specific prompts through the available default agent surface. Active-thread limits required wave execution, but every spawned reviewer returned.

Reports ingested:

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
- `.context/reviews/ui-ux-designer-reviewer-cycle17.md`

Agent failures: none.

Validation limitations noted by agents:

- Designer browser review used live/local browser probes where feasible, but local DB-backed authenticated pages could not be fully browsed without a local DB/session.
- Several security/operator findings require live host validation for proxy topology, backup storage, demo parity, CLIP activation, and production deployment state.

## Summary

- Unique deduped findings: 62
- Confirmed or likely source/product/doc issues: 48
- Manual-validation risks and test/CI gaps: 14
- Highest-severity confirmed issue: `AGG-C17-05`, the sidecar color backfill settings snapshot race that can stamp stale derivative bytes as current.
- Strongest cross-agent agreement: stale Cycle 16 ledger state, advisory-lock acquisition ambiguity, proxy/single-writer topology risks, source-contract-heavy tests, admin/UI information architecture, and broad background-work DB budgeting.

## Findings

### AGG-C17-01 - DB backup and restore actions can throw outside typed action results

- Severity: Medium
- Confidence: High
- Source findings: code-reviewer #1
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:163-175`, `apps/web/src/app/[locale]/admin/db-actions.ts:349-389`
- Problem: `dumpDatabase()` and `restoreDatabase()` perform setup/connection acquisition before the guarded result path.
- Failure scenario: pool exhaustion or backup-directory setup failure rejects the server action instead of returning localized `{ success: false, error }`.
- Suggested fix: guard acquisition/setup with nullable connection state, structured fallback results, logging, and rejected-acquisition tests.

### AGG-C17-02 - Cycle 16 release ledger is stale and deploy completion is unproven

- Severity: Medium
- Confidence: High
- Source findings: code-reviewer #2, `C17-CRIT-01`, `VER-17-01`, `C17-DOC-01`, `C17-DOC-MV-01`
- Cross-agent agreement: code-reviewer, critic, verifier, document-specialist
- Citations: `.context/plans/README.md:34-37`, `.context/plans/cycle-16-2026-07-08-plan.md:3`, `.context/plans/cycle-16-2026-07-08-plan.md:131-150`
- Problem: plans still advertise Cycle 16 as active/pending even though its commits are on `origin/master`; deploy evidence remains absent.
- Failure scenario: later agents repeat already-pushed work or assume production is current without deploy proof.
- Suggested fix: update the Cycle 16 plan/index with commit, push, gate, deploy, and supersession evidence.

### AGG-C17-03 - A tracked `.omc` runtime artifact remains in source control

- Severity: Low
- Confidence: High
- Source findings: code-reviewer #3, `C17-CRIT-02`
- Cross-agent agreement: code-reviewer, critic
- Citations: `.omc/plans/plan-cycle12-fixes.md:1`
- Problem: ignored runtime/planning state remains tracked.
- Failure scenario: agents or source scans treat stale runtime state as current project context.
- Suggested fix: remove tracked `.omc` artifacts only with explicit cleanup authorization, and add a source-hygiene check.

### AGG-C17-04 - Settings/backfill comments and tests describe obsolete soft-warning-only behavior

- Severity: Low
- Confidence: High
- Source findings: `C17-CRIT-03`, `VER-17-02`
- Cross-agent agreement: critic, verifier
- Citations: `apps/web/src/app/actions/settings.ts:190-200`, `apps/web/src/__tests__/settings-backfill-required-action.test.ts:1-8`
- Problem: comments/test narrative say settings changes have no hard fence, but current code uses `LOCK_COLOR_PIPELINE_BACKFILL`.
- Failure scenario: a maintainer trusts stale comments and removes the lock added to prevent stale derivative bytes.
- Suggested fix: update comments and test prose to describe the current soft `requiresBackfill` signal plus hard coordination fence.

### AGG-C17-05 - CLI color backfill snapshots settings before acquiring the backfill lock

- Severity: High
- Confidence: High
- Source findings: `T17-TRC-01`
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:317-365`, `apps/web/scripts/backfill-color-pipeline.ts:453-480`, `apps/web/src/app/actions/settings.ts:227-282`
- Problem: the sidecar script builds byte-impacting `backfillSettings` before it owns the shared backfill lock.
- Failure scenario: an admin saves new color settings between snapshot and lock acquisition; the script writes old-setting derivatives and marks them current.
- Suggested fix: read config and construct settings only after acquiring the lock and after post-lock restore-maintenance assertion; add an ordering regression.

### AGG-C17-06 - Lightroom upload can leak quota claims when upload-directory creation fails

- Severity: Medium
- Confidence: High
- Source findings: `DBG17-01`
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:272-312`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:74`
- Problem: `ensureUploadDirectories()` can throw after the upload tracker preclaim, outside local settlement.
- Failure scenario: an unwritable upload mount causes repeated 500s while quota remains charged.
- Suggested fix: catch setup failure, settle the tracker, return no-store JSON, and test the branch.

### AGG-C17-07 - Sidecar CLIP backfill can starve later images behind a failed prefix

- Severity: Medium
- Confidence: High
- Source findings: `DBG17-02`
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:151-202`, `apps/web/scripts/backfill-clip-embeddings.ts:234-246`
- Problem: failed low-ID candidates remain eligible on every run because cursor state is process-local and failures do not create durable progress.
- Failure scenario: missing originals in the first `SEMANTIC_SCAN_LIMIT` rows prevent later valid images from ever receiving embeddings across retries.
- Suggested fix: make progress across failed rows durable or continue scanning past failed rows while bounding inference work; add a regression.

### AGG-C17-08 - Advisory-lock acquisition errors can return tainted pooled sessions

- Severity: High
- Confidence: Medium
- Source findings: `C17-CRIT-04`, `DBG17-03`
- Cross-agent agreement: critic, debugger
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:324-379`, `apps/web/src/lib/upload-processing-contract-lock.ts:27-75`, `apps/web/src/lib/image-queue.ts:668-684`, `apps/web/src/app/[locale]/admin/db-actions.ts:173-581`
- Problem: several `GET_LOCK` paths call `release()` when the query throws before the client can prove whether the server granted the lock.
- Failure scenario: a mid-round-trip failure leaves a pooled session holding a lock and poisons future borrowers.
- Suggested fix: destroy or provably release connections on acquisition-query errors; add focused fault-injection tests.

### AGG-C17-09 - App icon metadata routes are intercepted by locale routing

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-01`
- Citations: `apps/web/src/app/icon.tsx:4`, `apps/web/src/app/apple-icon.tsx:4`, `apps/web/src/proxy.ts:127`, `apps/web/src/app/manifest.ts:24-30`
- Problem: `/icon` and `/apple-icon` redirect to localized topic routes.
- Failure scenario: browser/PWA icons fail during a DB incident because localized icon paths hit app topic lookup.
- Suggested fix: exclude root metadata assets from the locale proxy and add a route regression.

### AGG-C17-10 - Semantic-search Settings copy implies production activation

- Severity: Low
- Confidence: High
- Source findings: product-marketer #1
- Citations: `apps/web/messages/en.json:767-770`, `apps/web/messages/ko.json:767-770`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:813-875`
- Problem: copy says "Enable" even though production CLIP search cannot be enabled from Settings.
- Failure scenario: an operator selects Stub mode and expects real semantic ranking.
- Suggested fix: reword the panel as visibility/stub wiring configuration and state production is runbook-only.

### AGG-C17-11 - Similar-photos availability is not explained in semantic-search Settings

- Severity: Low
- Confidence: High
- Source findings: product-marketer #2
- Citations: `README.md:48`, `apps/web/messages/en.json:827-835`, `apps/web/src/components/similar-photos.tsx:138-141`, `apps/web/src/app/api/search/similar/[id]/route.ts:115-130`
- Problem: Settings explain Stub versus Production search but not that similar photos are production-only.
- Failure scenario: an operator tests Stub mode and cannot distinguish hidden similar photos from a bug.
- Suggested fix: add English/Korean operator copy saying Stub only tests text-search wiring.

### AGG-C17-12 - Public config examples omit the implemented feed `copyright` key

- Severity: Low
- Confidence: High
- Source findings: `C17-DOC-02`
- Citations: `CLAUDE.md:732-743`, `README.md:58-72`, `apps/web/src/site-config.example.json:1-11`, `apps/web/src/app/feed.xml/route.ts:125-131`
- Problem: docs mention the optional Atom rights field, but copied examples omit it.
- Failure scenario: operators ship fallback feed rights text unintentionally.
- Suggested fix: add `copyright` to the example config and README snippet.

### AGG-C17-13 - Token revoke confirmation does not identify the selected token

- Severity: Medium
- Confidence: High
- Source findings: `UIUX-C17-04`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:34`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:303-324`, `apps/web/messages/en.json:890-891`
- Problem: the destructive dialog loses row-specific token context.
- Failure scenario: an interrupted admin confirms revocation without knowing which external client token is affected.
- Suggested fix: store selected token metadata and interpolate label/scope/last-used context without exposing plaintext.

### AGG-C17-14 - Category alias deletion confirmation omits the alias and category

- Severity: Medium
- Confidence: High
- Source findings: `UIUX-C17-05`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:389-458`, `apps/web/messages/en.json:95-97`
- Problem: destructive alias confirmation is generic even though aliases preserve shared URL compatibility.
- Failure scenario: an admin deletes the wrong legacy slug.
- Suggested fix: interpolate alias and category label into title/description.

### AGG-C17-15 - Analytics countries render raw region codes only

- Severity: Low
- Confidence: Medium-High
- Source findings: `UIUX-C17-06`
- Citations: `apps/web/src/lib/analytics-data.ts:88-132`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:169-198`
- Problem: country values are not localized.
- Failure scenario: Korean admins mentally translate `KR`, `US`, or empty codes while comparing traffic.
- Suggested fix: use `Intl.DisplayNames` with localized unknown fallback and optional raw code diagnostics.

### AGG-C17-16 - Admin create/edit validation relies on transient toasts

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-02`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-363`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-176`, `apps/web/src/components/admin-user-manager.tsx:51-125`
- Problem: server validation failures are not persistently associated with fields.
- Failure scenario: screen-reader or interrupted admins miss a duplicate-slug or validation error.
- Suggested fix: add persistent form alerts, field-level messages, `aria-invalid`, and focus management.

### AGG-C17-17 - Oversized DB restore rejection clears state with toast-only feedback

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-03`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:76-81`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:190-209`
- Problem: a rejected oversized file disappears and only a toast explains why.
- Failure scenario: admins using assistive tech miss the reason the selected backup vanished.
- Suggested fix: keep a persistent rejected-file error near the input with `aria-describedby` and `aria-invalid`.

### AGG-C17-18 - Zoomed photos can be entered by keyboard but not panned by keyboard

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-04`
- Citations: `apps/web/src/components/image-zoom.tsx:118-368`, `apps/web/src/__tests__/image-zoom-source-contracts.test.ts`
- Problem: keyboard users can zoom but cannot inspect off-center regions.
- Failure scenario: keyboard-only viewers cannot pan a zoomed image.
- Suggested fix: support Arrow/Shift+Arrow and reset keys with localized instructions and tests.

### AGG-C17-19 - Upload progress is not fully announced to assistive tech

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `DES-C17-07`
- Citations: `apps/web/src/components/upload-dropzone.tsx:469-485`
- Problem: the live region announces filenames but not count/percent progress.
- Failure scenario: screen-reader admins cannot tell whether large uploads are advancing or stalled.
- Suggested fix: add localized `role="status"` progress text with count, percent, and current file.

### AGG-C17-20 - Home page filters can push photos below first-screen priority

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-08`, `UIUX-C17-01`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:63-122`
- Problem: full wrapping tag controls render before the first photo.
- Failure scenario: mobile visitors land on controls rather than finished photography, especially with many tags.
- Suggested fix: collapse secondary filters or move them to a sheet while keeping first photos visible.

### AGG-C17-21 - Admin image management remains table-first on narrow layouts

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-05`, `UIUX-C17-02`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143`, `apps/web/src/components/image-manager.tsx:427-590`
- Problem: dense horizontal-scroll tables make visual review and tag editing difficult.
- Failure scenario: admins on small screens lose row context while editing topics/tags/actions.
- Suggested fix: add responsive card/inspector workbench or viewport-positioned popovers.

### AGG-C17-22 - Mobile admin navigation is a flat wrapping link cloud

- Severity: Medium
- Confidence: High
- Source findings: `DES-C17-10`, `UIUX-C17-03`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Problem: ten peer links wrap unpredictably and mix routine, access, operations, and analytics tasks.
- Failure scenario: mobile/tablet admins tab through a noisy multi-row header before content.
- Suggested fix: group destinations and use a mobile drawer/disclosure/segmented admin menu.

### AGG-C17-23 - Truncated technical values rely on native `title` tooltips

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C17-06`
- Citations: `apps/web/src/components/info-bottom-sheet.tsx:413-420`, `apps/web/src/components/photo-viewer.tsx:803-810`, `apps/web/src/components/upload-dropzone.tsx:535`, `apps/web/src/components/image-manager.tsx:498`
- Problem: native `title` is unreliable on touch and keyboard paths.
- Failure scenario: viewers/admins cannot inspect exact lens names or filenames on mobile.
- Suggested fix: provide wrapping, copy, details drawers, or accessible popovers.

### AGG-C17-24 - Token management shares one pending/focus state across independent operations

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `DES-C17-09`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:28-303`
- Problem: create, retry, and revoke operations share pending and focus restoration.
- Failure scenario: one slow operation disables unrelated token controls or restores focus incorrectly.
- Suggested fix: split state by operation and by token row.

### AGG-C17-25 - Zoomed mobile pan may conflict with ancestor swipe navigation

- Severity: Medium
- Confidence: Low-Medium
- Source findings: `DES-C17-11`
- Citations: `apps/web/src/components/photo-viewer.tsx:697`, `apps/web/src/components/photo-navigation.tsx:134-221`, `apps/web/src/components/image-zoom.tsx:230-307`
- Problem: zoom pan and photo swipe handlers may compete on touch devices.
- Failure scenario: users trying to inspect a zoomed edge accidentally navigate to another photo.
- Suggested fix: disable photo swipe while zoom scale is above 1 and add touch validation.

### AGG-C17-26 - Large uploads/restores materialize multipart bodies before app streaming

- Severity: High
- Confidence: High
- Source findings: `C17-PERF-01`
- Citations: `apps/web/src/lib/upload-limits.ts:1-5`, `apps/web/next.config.ts:111-119`, `apps/web/src/app/actions/images.ts:129-249`, `apps/web/src/app/[locale]/admin/db-actions.ts:369-631`, `apps/web/src/app/api/admin/lr/upload/route.ts:152-180`
- Problem: framework parsing creates `File` objects before application streaming and byte checks.
- Failure scenario: accepted 200-250 MiB bodies spike RSS and stall or OOM the web process.
- Suggested fix: move large ingestion to streaming route handlers with backpressure and shared ingress semaphores.

### AGG-C17-27 - Background DB connection budgeting is independent across subsystems

- Severity: High
- Confidence: High
- Source findings: `C17-PERF-02`, `A2`
- Cross-agent agreement: perf-reviewer, architect
- Citations: `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:121-141`, `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `CLAUDE.md:261-283`
- Problem: image queue and admin backfill each reserve live headroom as if the other were idle.
- Failure scenario: concurrent upload processing and backfill consume most pool slots and public requests fail.
- Suggested fix: introduce one shared background DB budget/semaphore or split background workers with explicit capacity.

### AGG-C17-28 - Batch image deletion repeats full derivative-directory scans

- Severity: Medium
- Confidence: High
- Source findings: `C17-PERF-03`
- Citations: `apps/web/src/app/actions/images.ts:759-884`, `apps/web/src/lib/process-image.ts:575-663`
- Problem: deleting up to 100 images scans the same derivative directories once per image/format.
- Failure scenario: a batch cleanup on NAS-backed storage performs hundreds of full directory walks.
- Suggested fix: scan each derivative directory once per batch and index by selected base filename.

### AGG-C17-29 - Public map can serialize and hydrate up to 10,000 markers plus list rows

- Severity: Medium
- Confidence: High
- Source findings: `C17-PERF-04`
- Citations: `apps/web/src/lib/data.ts:1766-1816`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-139`
- Problem: large GPS galleries ship thousands of markers/list links to the first render.
- Failure scenario: mobile `/map` stalls while hydrating Leaflet markers and fallback links.
- Suggested fix: viewport/zoom loading, clustering/canvas markers, lower initial caps, and virtualized lists.

### AGG-C17-30 - Semantic and similar APIs brute-force embedding BLOB scans in request handlers

- Severity: Medium
- Confidence: High
- Source findings: `C17-PERF-05`
- Citations: `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/app/api/search/semantic/route.ts:173-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:98-214`
- Problem: each admitted request can fetch/decode/score thousands of embedding rows in the web process.
- Failure scenario: bursts of semantic/similar requests consume DB bandwidth and event-loop/GC budget.
- Suggested fix: global semantic scan/scoring limiter, conservative public limits, cached/vector-index plan.

### AGG-C17-31 - Color backfill candidate discovery lacks a stale-pipeline index

- Severity: Medium
- Confidence: High
- Source findings: `C17-PERF-06`
- Citations: `apps/web/src/db/schema.ts:123-131`, `apps/web/src/lib/admin-backfill-runner.ts:393-431`, `apps/web/scripts/backfill-color-pipeline.ts:409-417`
- Problem: stale candidate count/page queries can broadly scan processed images.
- Failure scenario: mostly-current large galleries still pay broad scans to find zero/few stale rows.
- Suggested fix: add a migration/reconcile update and validate an index or generated needs-reencode key with `EXPLAIN`.

### AGG-C17-32 - Startup temp cleanup uses unbounded stat/unlink fan-out

- Severity: Low
- Confidence: High
- Source findings: `C17-PERF-07`
- Citations: `apps/web/src/lib/image-queue.ts:41-97`, `apps/web/src/lib/process-topic-image.ts:146-168`
- Problem: startup can launch thousands of filesystem operations concurrently.
- Failure scenario: stale temp files after an interrupted re-encode delay readiness or hit `EMFILE`.
- Suggested fix: use bounded concurrency or fixed-size batches.

### AGG-C17-33 - Authenticated photo pages duplicate public image fan-out

- Severity: Low
- Confidence: High
- Source findings: `C17-PERF-08`
- Citations: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`, `apps/web/src/lib/data.ts:1057-1198`
- Problem: admin photo browsing starts the public image lookup before repeating viewer/admin fan-out.
- Failure scenario: admin review sessions do redundant DB work on every photo page.
- Suggested fix: resolve admin state first and perform one lookup with the needed select shape.

### AGG-C17-34 - Public listing queries aggregate tags before applying page limits

- Severity: Medium
- Confidence: Medium
- Source findings: `C17-PERF-09`
- Citations: `apps/web/src/lib/data.ts:786-940`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`
- Problem: broad pages can group tag joins for rows discarded by `LIMIT`.
- Failure scenario: crawler traffic burns CPU on tag aggregation for large galleries.
- Suggested fix: two-phase listing query: select ordered IDs first, then aggregate tags only for those IDs.

### AGG-C17-35 - Homepage always runs a non-sargable On This Day query

- Severity: Medium
- Confidence: Medium
- Source findings: `C17-PERF-10`
- Citations: `apps/web/src/app/[locale]/(public)/page.tsx:155-234`, `apps/web/src/lib/data-timeline.ts:102-130`
- Problem: home traffic repeatedly filters with `MONTH()` and `DAY()` over capture dates.
- Failure scenario: large archives scan processed rows every visit for a daily-changing widget.
- Suggested fix: generated/indexed month-day key or daily materialized/cache table.

### AGG-C17-36 - Smart collections can publish expensive dynamic predicates to uncached pages

- Severity: Medium
- Confidence: Medium
- Source findings: `C17-PERF-11`
- Citations: `apps/web/src/lib/smart-collections.ts:142-267`, `apps/web/src/lib/data.ts:1488-1544`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-112`
- Problem: AST size/depth is bounded, but predicate cost is not.
- Failure scenario: public smart collection pages run leading-wildcard and tag-subquery scans.
- Suggested fix: classify indexability before publishing, warn/block costly shapes, or materialize memberships.

### AGG-C17-37 - Public keyword search remains a leading-wildcard DB CPU surface

- Severity: Medium
- Confidence: Medium
- Source findings: `C17-PERF-12`
- Citations: `apps/web/src/lib/sql-like.ts:5-10`, `apps/web/src/lib/data.ts:1574-1737`, `apps/web/src/app/actions/public.ts:247-317`
- Problem: admitted `%term%` searches can force non-indexable scans.
- Failure scenario: crawlers or broad terms consume shared MySQL CPU despite rate limits.
- Suggested fix: use full-text/search index or a precomputed searchable document table.

### AGG-C17-38 - Timeline/year pages can render 500 photo cards in one response

- Severity: Low
- Confidence: Medium
- Source findings: `C17-PERF-13`
- Citations: `.context/reviews/perf-reviewer.md:332-355`
- Problem: route caps are bounded but still heavy for first render and mobile.
- Failure scenario: large year/timeline pages ship and hydrate hundreds of cards at once.
- Suggested fix: paginate, virtualize, or lazy-stream below-the-fold content after live measurement.

### AGG-C17-39 - Shutdown/drain budgets need host measurement

- Severity: Low
- Confidence: Low
- Source findings: `C17-PERF-15`
- Citations: `.context/reviews/perf-reviewer.md:383-405`
- Problem: worst-case image work and drain timing are host-dependent.
- Failure scenario: deploy/restart stops before sharp/DB cleanup finishes on slow storage or CPUs.
- Suggested fix: measure production drain behavior and tune budgets or quiescence controls.

### AGG-C17-40 - Single-writer topology is correctness-critical but warning-enforced

- Severity: High
- Confidence: High
- Source findings: `A1`, `C17-SEC-RISK-03`
- Cross-agent agreement: architect, security-reviewer
- Citations: `apps/web/src/lib/single-writer-guard.ts:6-235`, `apps/web/src/instrumentation.ts:22-31`, `CLAUDE.md:244-246`
- Problem: process-local restore, quotas, queues, and rate-limit assumptions only warn on multi-writer detection.
- Failure scenario: a second process accepts writes during another process's restore/import window.
- Suggested fix: fail closed in production unless explicitly overridden, or move coordination to shared durable state.

### AGG-C17-41 - Advisory lock names are partly DB-scoped and partly server-global

- Severity: Medium
- Confidence: High
- Source findings: `A3`
- Citations: `apps/web/src/lib/advisory-locks.ts:10-71`
- Problem: singleton lock is DB-scoped, but restore/upload/topic/delete/backfill/image locks collide across DBs on one MySQL server.
- Failure scenario: two separate GalleryKit DBs block each other's unrelated maintenance work.
- Suggested fix: prefix every lock with a stable instance key or document/fail one-GalleryKit-per-MySQL-server as a hard invariant.

### AGG-C17-42 - Restore quiescence relies on a manual registry of process-local writers

- Severity: Medium
- Confidence: Medium
- Source findings: `A4`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:497-536`, `apps/web/src/lib/admin-mutation-barrier.ts:1-33`, `apps/web/src/lib/background-db-writes.ts:11-112`
- Problem: future detached DB writers must remember to join the restore drain checklist.
- Failure scenario: an untracked background writer mutates DB after SQL import.
- Suggested fix: centralize background DB-write scheduling or add lint/source-contract detection for untracked writers.

### AGG-C17-43 - DB backup/restore does not own filesystem consistency

- Severity: Medium
- Confidence: High
- Source findings: `A5`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:192-199`, `apps/web/src/app/[locale]/admin/db-actions.ts:759-829`, `apps/web/docker-compose.yml:24-32`
- Problem: SQL backup/restore does not snapshot or reconcile uploads/resources/derivatives.
- Failure scenario: restored DB references missing files or omits existing files.
- Suggested fix: label SQL restore as DB-only and add file manifest/reconciliation or full bundle backups.

### AGG-C17-44 - `IMAGE_BASE_URL` ownership is split between build and runtime

- Severity: Medium
- Confidence: High
- Source findings: `A6`
- Citations: `apps/web/next.config.ts:32-38`, `apps/web/next.config.ts:121-125`, `apps/web/src/lib/content-security-policy.ts:139-143`, `apps/web/docker-compose.yml:7-23`
- Problem: runtime env can diverge from Next image remote patterns baked at build time.
- Failure scenario: CSP and generated URLs use a new image host while image optimization still rejects it.
- Suggested fix: add startup/build-value assertion or require rebuilds for the setting.

### AGG-C17-45 - Semantic embedding work lacks host-wide coordination

- Severity: Low
- Confidence: Medium
- Source findings: `A7`
- Citations: `apps/web/src/lib/image-queue.ts:527-622`, `apps/web/scripts/backfill-clip-embeddings.ts:120-130`, `apps/web/src/lib/clip-model.ts:53-173`
- Problem: sidecar and in-app embedding work can load/run CLIP concurrently with process-local limits only.
- Failure scenario: CLIP sidecar plus app bootstrap infer at the same time and spike CPU/RSS.
- Suggested fix: have in-app bootstrap respect the semantic backfill lock or move inference to a dedicated host-wide worker.

### AGG-C17-46 - Sidecar color backfill can bypass app pool-aware concurrency

- Severity: Low
- Confidence: Medium
- Source findings: `A8`
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:383-387`, `apps/web/src/lib/admin-backfill-runner.ts:130-143`, `apps/web/src/db/index.ts:31-42`
- Problem: operator-set sidecar concurrency opens a separate pool outside the web process's budget.
- Failure scenario: `BACKFILL_CONCURRENCY=8` saturates MySQL/CPU during live traffic.
- Suggested fix: document/enforce sidecar capacity or share a DB/host budget.

### AGG-C17-47 - Plaintext SQL backups rely on host/storage controls

- Severity: Medium
- Confidence: Medium
- Source findings: `C17-SEC-RISK-02`
- Citations: `CLAUDE.md:226-228`, `apps/web/src/app/[locale]/admin/db-actions.ts:128-316`, `apps/web/src/app/api/admin/db/download/route.ts:21-90`
- Problem: web routes are guarded, but dump files remain plaintext secrets at rest.
- Failure scenario: host backup/sync/support paths expose metadata, token/session hashes, or share keys.
- Suggested fix: validate permissions/retention and use encrypted host backup storage where needed.

### AGG-C17-48 - Per-IP limiter correctness depends on live proxy topology

- Severity: Medium
- Confidence: High
- Source findings: `C17-SEC-RISK-01`, `C17-PERF-14`, `T17-TRC-R01`
- Cross-agent agreement: security-reviewer, perf-reviewer, tracer
- Citations: `apps/web/src/lib/rate-limit.ts:175-206`, `apps/web/nginx/default.conf:20-71`, `scripts/check-proxy-topology.mjs:12-134`
- Problem: trusted proxy and nginx real-IP assumptions must match the actual edge.
- Failure scenario: adding CDN/LB collapses rate limits to proxy or unknown buckets.
- Suggested fix: validate `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, nginx real-IP, and effective client key after topology changes.

### AGG-C17-49 - No coverage report, threshold, or changed-file ratchet

- Severity: Medium
- Confidence: High
- Source findings: `TE17-01`
- Citations: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:69-70`
- Problem: extensive source-contract tests do not reveal unexecuted changed branches.
- Failure scenario: a high-risk route branch loses behavior coverage while `npm test` stays green.
- Suggested fix: add non-blocking V8 coverage first, then a reviewed changed-file ratchet for high-risk areas.

### AGG-C17-50 - DB restore mysql child cleanup is source-pinned, not behavior-tested

- Severity: Medium
- Confidence: High
- Source findings: `TE17-02`
- Citations: `apps/web/src/__tests__/db-restore.test.ts:47-74`, `apps/web/src/__tests__/restore-upload-lock.test.ts:84-91`, `apps/web/src/app/[locale]/admin/db-actions.ts:767-840`
- Problem: restore child/stream cleanup is guarded by string snippets rather than fake-event behavior.
- Failure scenario: close/error/timeout races regress while strings remain present.
- Suggested fix: extract/inject the restore runner and test fake `spawn`, streams, timers, cleanup, and migration outcomes.

### AGG-C17-51 - Lightroom upload route has an incomplete failure-branch matrix

- Severity: Medium
- Confidence: High
- Source findings: `TE17-03`
- Citations: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-509`
- Problem: many external-ingest failure outcomes lack behavior assertions for status, settlement, cleanup, audit, and queue side effects.
- Failure scenario: an untested branch leaks quota/originals or returns the wrong JSON shape.
- Suggested fix: add table-driven route cases, starting with setup-directory failure from `AGG-C17-06`.

### AGG-C17-52 - Admin token management UI is not browser-tested

- Severity: Medium
- Confidence: High
- Source findings: `TE17-04`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:10-22`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-325`, `apps/web/e2e/admin.spec.ts:20-165`
- Problem: one-time plaintext display, copy acknowledgement, and revoke targeting are only server/source tested.
- Failure scenario: hydrated UI drops the secret or targets the wrong revoke row while e2e still passes.
- Suggested fix: add authenticated Playwright create/copy/done/revoke flow.

### AGG-C17-53 - Migration reconcile parity is mostly name/source-based

- Severity: Medium
- Confidence: Medium
- Source findings: `TE17-05`
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-225`, `apps/web/scripts/migrate.js:348-740`
- Problem: tests do not structurally diff type/null/default/collation/index/FK parity.
- Failure scenario: reconcile-baselined databases drift from normally migrated databases.
- Suggested fix: add disposable-MySQL parity test against `information_schema`.

### AGG-C17-54 - Nav "visual" e2e writes screenshots without visual assertions

- Severity: Low
- Confidence: High
- Source findings: `TE17-06`
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:58-85`, `apps/web/playwright.config.ts:63-77`
- Problem: spec name/artifacts imply visual regression, but only geometry/visibility is asserted.
- Failure scenario: spacing, color, truncation, or panel composition regresses without CI failure.
- Suggested fix: rename as geometry/artifact-only or add controlled `toHaveScreenshot` assertions.

### AGG-C17-55 - Required Playwright coverage is single-engine Desktop Chrome

- Severity: Medium
- Confidence: High
- Source findings: `TE17-07`
- Citations: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`
- Problem: mobile/WebKit/Firefox-specific behaviors are not required in CI.
- Failure scenario: iOS/WebKit focus, viewport, touch, or fixed overlay regressions pass Desktop Chrome.
- Suggested fix: add small mobile WebKit and Firefox/WebKit smoke coverage.

### AGG-C17-56 - Real CLIP proof is scheduled/manual, not a PR gate

- Severity: Medium
- Confidence: High
- Source findings: `TE17-08`
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `.github/workflows/clip-preflight.yml:3-45`
- Problem: normal PR quality can merge semantic-production regressions before manual/weekly CLIP proof runs.
- Failure scenario: dependency/model layout changes break offline CLIP activation after merge.
- Suggested fix: require path-filtered CLIP preflight for semantic/model/dependency changes.

### AGG-C17-57 - Hydration e2e uses `networkidle` and permissive restored-state assertions

- Severity: Low
- Confidence: Medium
- Source findings: `TE17-09`
- Citations: `apps/web/e2e/hydration-photo-page.spec.ts:36-49`
- Problem: `networkidle` is brittle and the assertion can pass on a fallback control.
- Failure scenario: restored desktop pinned-state regresses while `Info` remains visible, or harmless background requests cause flakes.
- Suggested fix: wait on deterministic UI readiness and assert exact restored state.

### AGG-C17-58 - High-risk flows rely on source-contract tests rather than behavior/concurrency tests

- Severity: High for regression detection
- Confidence: High
- Source findings: `C17-RISK-01`
- Citations: `.context/plans/cycle-16-2026-07-08-deferred.md:28-30`, `apps/web/src/__tests__/pending-session-revocations.test.ts:88-112`, `apps/web/src/__tests__/images-action-toctou-claim.test.ts:17-56`, `apps/web/src/__tests__/data-tag-names-sql.test.ts:234-248`
- Problem: source snippets guard races/privacy/query shape but do not execute failure/concurrency behavior.
- Failure scenario: refactors preserve strings while reordering awaits or changing actual DB behavior.
- Suggested fix: add mocked DB/pool behavior tests and concurrency harnesses for the named flows.

### AGG-C17-59 - Production Docker image correctness remains deploy-time, not CI-time

- Severity: Medium
- Confidence: High
- Source findings: `C17-RISK-02`
- Citations: `.github/workflows/quality.yml:48-83`, `apps/web/Dockerfile:50-85`
- Problem: CI runs `next build` but does not validate the production Dockerfile/native package overlay.
- Failure scenario: native package pin drift passes CI and fails only at deploy/runtime.
- Suggested fix: add a Docker build gate or lockfile-vs-Dockerfile native package checker.

### AGG-C17-60 - "Photographer-grade color management" remains a subjective superlative

- Severity: Low
- Confidence: Medium
- Source findings: product-marketer risk A
- Citations: `README.md:42-44`, `README.md:29`, `CLAUDE.md:302-335`
- Problem: heading can imply reference-grade/HDR public delivery beyond documented browser/codec limits.
- Failure scenario: photographers expect end-to-end HDR or reference-grade output where public HDR is not yet shipped.
- Suggested fix: soften heading or add limits directly in the line.

### AGG-C17-61 - Live Demo parity with current repository HEAD is not validated

- Severity: Low
- Confidence: Medium
- Source findings: product-marketer risk B
- Citations: `README.md:21-24`
- Problem: demo reachability does not prove deployed config, feature state, or commit parity.
- Failure scenario: prospective operators treat Atik production state as exact OSS default behavior.
- Suggested fix: document the demo as representative and record commit/config parity when making demo claims.

### AGG-C17-62 - Live operator claims depend on host state outside the repository

- Severity: Low
- Confidence: High
- Source findings: `C17-DOC-MV-02`
- Citations: `README.md:48`, `apps/web/README.md:65-91`, `CLAUDE.md:553-631`, `README.md:171-174`, `CLAUDE.md:509-521`
- Problem: repo source agrees on CLIP/proxy runbooks, but live weights/env/nginx/header state is external.
- Failure scenario: operators infer production semantic search or rate limiting is active without host evidence.
- Suggested fix: require live `test:clip:preflight`, semantic/similar smoke, proxy-topology check, nginx validation, and burst-limit evidence for activation claims.

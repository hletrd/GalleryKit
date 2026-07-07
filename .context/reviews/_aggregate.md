# Cycle 16 Aggregate Review

Date: 2026-07-08 KST  
Reviewed HEAD range: `78778dd8` through review-only commits `d71a3534` / `4b237f7e`  
Repository: `/Users/hletrd/flash-shared/gallery`

## Agent Coverage

Prompt 1 fanned out across every requested reviewer lane that was available in this environment, plus the two local reviewer-style prompt files found under `~/.codex/agents`.

Reports ingested:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/architect.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`
- `.context/reviews/product-marketer-reviewer.md`

Agent failures: none. Two reviewer lanes unexpectedly committed review-only artifacts during Prompt 1; those commits are preserved and counted later rather than rewritten.

## Summary

- Unique deduped findings: 49
- Confirmed or likely source/product/doc issues: 34
- Manual-validation risks: 15
- Highest-severity issue: `AGG-C16-01`, a confirmed color-settings/backfill race that can stamp stale derivative bytes as current.
- Strongest cross-agent agreement: admin advisory-lock connection-acquisition gaps, single-writer/proxy topology risks, source-string-heavy test proof gaps, migration structural parity risk, and mobile/admin UI information architecture.

## Findings

### AGG-C16-01 - Color settings can change during color backfill, stamping stale bytes as current

- Severity: Major
- Confidence: High
- Source findings: `T16-TRC-01`, related `A16-ARCH-02`
- Cross-agent agreement: tracer, architect
- Citations: `apps/web/src/app/actions/settings.ts:168-234`, `apps/web/src/lib/admin-backfill-runner.ts:615-756`, `apps/web/scripts/backfill-color-pipeline.ts:325-492`
- Problem: byte-impacting settings can commit while in-app or sidecar color backfill keeps using an older settings snapshot and then writes current `pipeline_version`.
- Failure scenario: an admin changes gamut/quality settings during a running backfill; rows processed after the change no longer match current settings but are no longer selected by normal pipeline-version backfill.
- Suggested fix: coordinate byte-impacting settings writes with the color-backfill advisory lock, or persist a settings hash/version per image and compare that in candidate selection.

### AGG-C16-02 - Admin user deletion can throw outside structured error handling on connection acquisition failure

- Severity: Medium
- Confidence: High
- Source findings: code-reviewer #1, `C16-CRIT-01`, `VER-16-01`
- Cross-agent agreement: code-reviewer, critic, verifier
- Citations: `apps/web/src/app/actions/admin-users.ts:220-314`
- Problem: `deleteAdminUser()` calls `connection.getConnection()` before the `try/catch/finally` that maps failures to localized action results.
- Failure scenario: DB pool saturation or restart makes the server action reject with an unstructured framework error instead of `{ error: failedToDeleteUser }`.
- Suggested fix: acquire the connection inside a guarded nullable-connection `try`, and add a regression test for rejected acquisition.

### AGG-C16-03 - CLIP embedding backfill can throw outside structured error handling on connection acquisition failure

- Severity: Medium
- Confidence: High
- Source findings: code-reviewer #2, `C16-CRIT-02`, `VER-16-02`
- Cross-agent agreement: code-reviewer, critic, verifier
- Citations: `apps/web/src/app/actions/embeddings.ts:59-213`
- Problem: `backfillClipEmbeddings()` calls `connection.getConnection()` before its typed `BackfillEmbeddingsResult` error path.
- Failure scenario: DB pool saturation during semantic rollout produces a raw server-action exception instead of `{ status: "error", message: embeddingBackfillFailed }`.
- Suggested fix: move lock connection acquisition inside the existing `try`, guard release with `if (lockConn)`, and add a rejected-acquisition test.

### AGG-C16-04 - Active plan index still points agents at stale cycle work

- Severity: Medium
- Confidence: High
- Source findings: `DOC-C16-01`, `C16-CRIT-03`
- Cross-agent agreement: document-specialist, critic
- Citations: `.context/plans/README.md:34-40`, `.context/plans/cycle-15-2026-07-08-plan.md:1-5`
- Problem: current plan index still advertises older cycle-15 / loop-B cycle-7 entries as active.
- Failure scenario: a later agent resumes stale work or assumes cycle-15 push/deploy is still pending.
- Suggested fix: update/archive plan index entries so cycle 16 is the single active current-cycle pointer.

### AGG-C16-05 - CLIP sidecar script comment omits the required production env gate

- Severity: Medium
- Confidence: High
- Source findings: `DOC-C16-02`
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:14-21`, `apps/web/scripts/backfill-clip-embeddings.ts:115-118`, `CLAUDE.md` CLIP runbook
- Problem: the inline production `docker run` example omits `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, while the script refuses `--production` without it.
- Failure scenario: an operator copies the header command, the sidecar exits non-zero, and production embeddings are not written.
- Suggested fix: make the script comment match the canonical runbook or point only to the canonical runbook.

### AGG-C16-06 - Storage backend method comments imply live pipeline integration

- Severity: Low
- Confidence: High
- Source findings: `DOC-C16-03`, related `A16-ARCH-03`
- Cross-agent agreement: document-specialist, architect
- Citations: `apps/web/src/lib/storage/types.ts:4-16`, `apps/web/src/lib/storage/types.ts:51-72`, `apps/web/src/lib/storage/local.ts:55-67`, `apps/web/src/lib/process-topic-image.ts:11-28`
- Problem: storage interface comments say upload/Sharp/serve-upload use the abstraction, but source and docs say it remains quarantined and filesystem-only.
- Failure scenario: a maintainer implements a backend expecting live usage and exposes remote storage that does nothing for actual uploads/derivatives/resources.
- Suggested fix: rewrite comments as intended/future use and keep the quarantine boundary explicit.

### AGG-C16-07 - Semantic-search Settings copy implies production CLIP activation from UI

- Severity: Medium
- Confidence: High
- Source findings: product-marketer #1
- Citations: `apps/web/messages/en.json:766-769`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:845-852`, `apps/web/src/lib/gallery-config-shared.ts:223-228`
- Problem: Settings copy says to enable CLIP search and run backfill, but the UI only lets admins choose disabled/stub; production requires the operator runbook.
- Failure scenario: an admin enables stub mode and believes meaningful CLIP search is active on the public gallery.
- Suggested fix: clarify that stub is a wiring test and production activation is runbook-only; update Korean copy too.

### AGG-C16-08 - Upload-token copy promises expiry behavior the admin UI does not expose

- Severity: Medium
- Confidence: High
- Source findings: product-marketer #2
- Citations: `apps/web/messages/en.json:870-880`, `apps/web/messages/ko.json:920-930`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-103`, `apps/web/src/app/actions/lr-tokens.ts:29-33`
- Problem: server supports optional `expiresAt`, but the admin UI creates no-expiry tokens while copy says tokens last until expiry or revocation.
- Failure scenario: an operator creates a temporary token assuming expiry will happen automatically; the token remains valid until revoked.
- Suggested fix: either add an expiry selector or make copy explicit that UI-created tokens do not expire by default.

### AGG-C16-09 - Image delete confirmation does not name the target image

- Severity: Medium
- Confidence: High
- Source findings: `UIUX-C16-02`
- Citations: `apps/web/src/components/image-manager.tsx:562-570`, `apps/web/messages/en.json:201-202`, `apps/web/messages/ko.json:201-202`
- Problem: individual image deletion uses generic confirmation copy even though row delete labels and tag/category dialogs name their targets.
- Failure scenario: an admin confirms a stale generic dialog from a dense table and deletes the wrong image.
- Suggested fix: track the selected image for deletion and interpolate a title/id/filename fallback in the dialog title/description.

### AGG-C16-10 - Mobile home places full tag-filter wall before photos

- Severity: Medium
- Confidence: High
- Source findings: `DES-C16-01`, `UIUX-C16-01`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:62-122`
- Problem: on mobile the full wrapping tag filter appears before the first photo.
- Failure scenario: visitors and keyboard/switch users must scroll or traverse many chips before reaching gallery content.
- Suggested fix: collapse or rail the mobile taxonomy, keeping active/current tags and a full filter sheet.

### AGG-C16-11 - Admin create/edit validation is mostly toast-only

- Severity: Medium
- Confidence: High
- Source findings: `DES-C16-02`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-126`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-68`, `apps/web/src/components/admin-user-manager.tsx:51-60`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72`
- Problem: server validation failures are transient toasts rather than persistent field-linked errors.
- Failure scenario: an admin misses a duplicate slug toast and has no persistent indication of which field failed.
- Suggested fix: add form-level alerts, per-field error text, `aria-invalid`, `aria-describedby`, and focus movement to first invalid field.

### AGG-C16-12 - Admin image management is table-first rather than photo-workbench-first

- Severity: Medium
- Confidence: Medium-High
- Source findings: `DES-C16-03`, `UIUX-C16-03`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/image-manager.tsx:427-603`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143`
- Problem: repeat photo metadata work is forced through a dense horizontally scrollable table.
- Failure scenario: admins cleaning up a shoot must scan small thumbnails and row controls instead of a photo-first workbench with inspector.
- Suggested fix: add a grid/list + inspector workbench mode and keep the table as a dense optional mode.

### AGG-C16-13 - Truncated technical values rely on mouse-only native `title`

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C16-04`
- Citations: `apps/web/src/components/info-bottom-sheet.tsx:413-423`, `apps/web/src/components/photo-viewer.tsx:803-812`, `apps/web/src/components/upload-dropzone.tsx:535-538`, `apps/web/src/components/image-manager.tsx:497-499`
- Problem: full camera/lens/filename values are only exposed through `title`, which is weak on touch, keyboard, and assistive tech.
- Failure scenario: a tablet admin cannot disambiguate two truncated filenames.
- Suggested fix: use focus/touch accessible disclosure, wrapping detail drawer, copy affordance, or accessible tooltip/popover.

### AGG-C16-14 - Upload progress changes are not fully announced

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `DES-C16-05`
- Citations: `apps/web/src/components/upload-dropzone.tsx:469-488`
- Problem: live region announces current filename but not combined count/percent progress.
- Failure scenario: screen-reader admins hear changing filenames without knowing progress or remaining count.
- Suggested fix: add `role="status" aria-live="polite" aria-atomic="true"` containing localized count, total, percent, and current filename.

### AGG-C16-15 - Tag autocomplete may be clipped inside admin table scrollport

- Severity: Medium
- Confidence: Medium
- Source findings: `DES-C16-06`
- Citations: `apps/web/src/components/image-manager.tsx:427-534`, `apps/web/src/components/tag-input.tsx:184-233`
- Problem: suggestions are absolutely positioned under a row inside an overflow scroll table.
- Failure scenario: suggestions near the scrollport edge are hidden or unreachable.
- Suggested fix: portal/popover suggestions outside the scroll container, or move metadata editing into an inspector.

### AGG-C16-16 - Lightroom token page uses one pending state for independent jobs

- Severity: Low-Medium
- Confidence: Medium
- Source findings: `DES-C16-07`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:28-117`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-321`
- Problem: list refresh, create, and revoke share one pending state and focus-restoration path.
- Failure scenario: an unrelated refresh disables dialog controls or restores focus to the wrong control.
- Suggested fix: split `isLoadingList`, `isCreating`, and `isRevoking` with local status and focus behavior.

### AGG-C16-17 - Timeline/year archive photo links re-enable viewport prefetch

- Severity: Low
- Confidence: High
- Source findings: `DES-C16-08`
- Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:250-253`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:210-213`, `apps/web/src/components/masonry-card.tsx:78-81`
- Problem: archive grids omit `prefetch={false}` while main/shared grids deliberately disable detail-page prefetch.
- Failure scenario: scrolling a large archive schedules many RSC prefetches that compete with thumbnail loading.
- Suggested fix: add `prefetch={false}` to archive photo links.

### AGG-C16-18 - Admin navigation is a flat ten-link wrap

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C16-10`, `UIUX-C16-04`
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Problem: unrelated admin workflows wrap as one flat cluster, reducing spatial stability.
- Failure scenario: Korean/narrow layouts move links between rows, forcing repeated scanning.
- Suggested fix: group navigation into stable sections and use a sectioned drawer/menu on narrow screens.

### AGG-C16-19 - Desktop info-sidebar animation is slow for a frequent viewer toggle

- Severity: Low
- Confidence: Medium
- Source findings: `UIUX-C16-05`
- Citations: `apps/web/src/components/photo-viewer.tsx:410-418`, `apps/web/src/components/photo-viewer.tsx:747-756`
- Problem: the `I` shortcut toggles a 500 ms sidebar animation.
- Failure scenario: repeated metadata inspection feels sluggish.
- Suggested fix: shorten normal-mode transition to roughly 150-200 ms while retaining reduced-motion override.

### AGG-C16-20 - Logout skipped-revocation behavior is source-pinned, not behavior-tested

- Severity: High
- Confidence: High
- Source findings: `TE16-01`, related critic/verifier proof risks
- Citations: `apps/web/src/app/actions/auth.ts:286-312`, `apps/web/src/__tests__/pending-session-revocations.test.ts:88-99`, `apps/web/src/__tests__/auth-actions-behavior.test.ts:231-239`
- Problem: tests prove source ordering and queue helper behavior, but not blocked-branch `logout()` behavior.
- Failure scenario: refactor leaves searched strings but stops enqueuing revocation during maintenance/barrier blocked branches.
- Suggested fix: add behavior tests for restore-maintenance and mutation-slot-unavailable logout paths.

### AGG-C16-21 - Browser upload quota TOCTOU protection lacks concurrent behavior test

- Severity: High
- Confidence: High
- Source findings: `TE16-02`, `C16-CRIT-04`
- Citations: `apps/web/src/app/actions/images.ts:232-319`, `apps/web/src/__tests__/images-action-toctou-claim.test.ts:17-56`
- Problem: source-order test would not catch an awaited dependency inserted between quota validation and claim unless it matches known needles.
- Failure scenario: overlapping uploads both pass before either claims quota.
- Suggested fix: add a concurrent `uploadImages()` behavior test around a controlled post-claim dependency.

### AGG-C16-22 - Search `tag_names` full-tag aggregation is only source-sliced

- Severity: High
- Confidence: High
- Source findings: `TE16-03`, `C16-CRIT-04`
- Citations: `apps/web/src/lib/data.ts:1682-1729`, `apps/web/src/__tests__/data-tag-names-sql.test.ts:234-248`
- Problem: current tests check query-source tokens rather than returned behavior for a multi-tag result.
- Failure scenario: tag search again drops non-matching tags while source strings remain.
- Suggested fix: add a behavior-level data test or generated SQL test proving tag filtering is in `EXISTS` and aggregation keeps all tags.

### AGG-C16-23 - GPS fail-closed cleanup is not behavior-asserted on both upload paths

- Severity: Medium
- Confidence: High
- Source findings: `TE16-04`, `VER-16-RISK-04`
- Citations: `apps/web/src/app/actions/images.ts:409-422`, `apps/web/src/app/api/admin/lr/upload/route.ts:407-424`, source tests
- Problem: implementation currently deletes saved originals on GPS-strip failure, but tests assert source text rather than full upload rollback behavior.
- Failure scenario: future refactor preserves strings but removes cleanup from the false-return path.
- Suggested fix: add browser and Lightroom upload behavior tests that mock `stripGpsFromOriginal=false` and assert cleanup/no insert/quota settlement.

### AGG-C16-24 - No coverage report, threshold, or changed-file ratchet

- Severity: Medium
- Confidence: High
- Source findings: `TE16-05`
- Citations: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `.github/workflows/quality.yml`
- Problem: a large source-contract-heavy suite has no coverage reporting or changed-file execution ratchet.
- Failure scenario: new critical branches land with only source-string assertions or no behavior tests.
- Suggested fix: add a non-blocking coverage command first, then ratchet high-risk changed files.

### AGG-C16-25 - Nav visual e2e screenshots are artifacts, not assertions

- Severity: Medium
- Confidence: High
- Source findings: `TE16-06`
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-85`
- Problem: spec captures screenshots but does not use `toHaveScreenshot` baselines.
- Failure scenario: nav visual regressions pass as long as geometry remains visible/non-overlapping.
- Suggested fix: either add baselines or rename to geometry smoke and add a real visual-regression job.

### AGG-C16-26 - Semantic scan caps are not behavior-asserted by route tests

- Severity: Medium
- Confidence: Medium
- Source findings: `TE16-07`
- Citations: semantic/similar route tests and `apps/web/src/app/api/search/*`
- Problem: route tests do not assert the scan `.limit(SEMANTIC_SCAN_LIMIT)` calls.
- Failure scenario: a refactor scans `topK` or all rows while source token remains.
- Suggested fix: spy on the embedding-scan `limit` call in semantic and similar route tests.

### AGG-C16-27 - Migration reconcile tests do not prove structural schema parity

- Severity: Medium
- Confidence: High
- Source findings: `TE16-08`, `A16-ARCH-06`, `VER-16-RISK-03`
- Cross-agent agreement: test-engineer, architect, verifier
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/scripts/migrate.js:858-947`
- Problem: tests mostly prove source name presence, not MySQL column/index/FK structural equivalence.
- Failure scenario: fresh reconcile-baselined DB differs from normally migrated DB in defaults, nullability, indexes, or FK actions.
- Suggested fix: add an integration structural diff against disposable MySQL databases for migration PRs.

### AGG-C16-28 - Password-change UI submit path lacks browser-level regression test

- Severity: Medium
- Confidence: High
- Source findings: `TE16-09`
- Citations: `apps/web/e2e/admin.spec.ts:36-38`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:36-120`
- Problem: e2e visits the page but does not exercise mismatch validation, form action handoff, pending state, or ARIA error state.
- Failure scenario: client-only mismatch guard breaks while page-presence e2e still passes.
- Suggested fix: add non-destructive admin e2e for mismatched new/confirm password.

### AGG-C16-29 - Touch-target audit lets unsized plain text links pass

- Severity: Low
- Confidence: Medium
- Source findings: `TE16-10`
- Citations: `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`, `apps/web/src/__tests__/touch-target-audit.test.ts:1053-1060`
- Problem: source scanner intentionally accepts unsized plain text links.
- Failure scenario: a future action/navigation link ships below 44 px and no rendered DOM audit catches it.
- Suggested fix: tighten source allowlists or add Playwright DOM touch-target measurements.

### AGG-C16-30 - Image queue and in-app backfill reserve DB pool headroom independently

- Severity: High
- Confidence: High
- Source findings: `PERF-C16-01`
- Citations: `apps/web/src/db/index.ts:31-41`, `apps/web/src/lib/image-queue.ts:121-441`, `apps/web/src/lib/admin-backfill-runner.ts:97-565`
- Problem: queue and in-app backfill each budget against the DB pool independently.
- Failure scenario: uploads and backfill overlap and starve live SSR/admin work.
- Suggested fix: create one shared in-process background DB budget for image work, or reduce/pause queue concurrency while backfill is active.

### AGG-C16-31 - Browser upload and DB restore stream only after framework multipart buffering

- Severity: High
- Confidence: High
- Source findings: `PERF-C16-02`
- Citations: `apps/web/src/lib/upload-limits.ts:1-35`, `apps/web/next.config.ts:112-119`, `apps/web/src/app/actions/images.ts:129-249`, `apps/web/src/app/[locale]/admin/db-actions.ts:369-631`
- Problem: Server Actions and `request.formData()` materialize large multipart payloads before app streaming begins.
- Failure scenario: large uploads/restores spike Node memory before validation/storage streaming can apply backpressure.
- Suggested fix: move large browser upload/restore to streaming route handlers with byte counters and process-wide ingress semaphore.

### AGG-C16-32 - Public semantic/similar search performs per-request brute-force BLOB scans and vector math

- Severity: Medium
- Confidence: High
- Source findings: `PERF-C16-03`
- Citations: `apps/web/src/app/api/search/semantic/route.ts:250-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:137-214`, `apps/web/src/lib/clip-embeddings.ts:36-48`
- Problem: each request reads many embedding BLOBs and scores vectors in Node; per-IP limits do not bound global work.
- Failure scenario: concurrent public searches consume MySQL bandwidth and CPU.
- Suggested fix: add global concurrency, cache embedding matrices with invalidation, or adopt a vector index.

### AGG-C16-33 - Color-pipeline backfill candidate scans lack a dedicated `pipeline_version` index

- Severity: Medium
- Confidence: High
- Source findings: `PERF-C16-04`
- Citations: `apps/web/src/db/schema.ts:123-131`, `apps/web/src/lib/admin-backfill-runner.ts:393-431`, `apps/web/scripts/backfill-color-pipeline.ts:409-417`
- Problem: stale candidate discovery can broadly scan processed rows.
- Failure scenario: rerunning backfill on a mostly-current large gallery still adds DB latency.
- Suggested fix: add a candidate index or generated bucket after validating `EXPLAIN` plans.

### AGG-C16-34 - Public map can serialize/render up to 10,000 markers plus list items

- Severity: Medium-High
- Confidence: High
- Source findings: `PERF-C16-05`, `C16-RISK-01`
- Cross-agent agreement: perf-reviewer, critic
- Citations: `apps/web/src/lib/data.ts:1766-1817`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`
- Problem: large GPS galleries send, hydrate, and render thousands of markers plus thousands of fallback links.
- Failure scenario: mobile map page stalls or crashes.
- Suggested fix: lower initial cap, add clustering/viewport fetching, virtualize/paginate accessible list, and compute bounds in one pass.

### AGG-C16-35 - Batch image deletion repeats derivative-directory scans per image

- Severity: Medium
- Confidence: High
- Source findings: `PERF-C16-06`
- Citations: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:575-663`
- Problem: batch delete scans each derivative directory once per image per format.
- Failure scenario: deleting 100 images from a large NAS-backed gallery performs hundreds of full directory scans.
- Suggested fix: add a batch cleanup helper that scans each derivative directory once and groups by base filename prefix.

### AGG-C16-36 - Home page always runs non-sargable On This Day query

- Severity: Medium
- Confidence: Medium
- Source findings: `PERF-C16-07`
- Citations: `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:102-130`, `apps/web/src/db/schema.ts:123-130`
- Problem: dynamic home SSR always runs `MONTH(capture_date)` / `DAY(capture_date)` predicates.
- Failure scenario: large archive home traffic repeatedly scans processed dated rows.
- Suggested fix: add indexed generated month/day data or a daily cache/materialized table.

### AGG-C16-37 - Public smart collections can expose expensive dynamic predicates

- Severity: Medium
- Confidence: Medium
- Source findings: `PERF-C16-08`
- Citations: `apps/web/src/lib/smart-collections.ts:142-268`, `apps/web/src/lib/data.ts:1488-1548`
- Problem: structural AST caps do not bound predicate cost for public dynamic collection pages.
- Failure scenario: crawlers repeatedly hit collection pages backed by broad `contains`/tag subqueries and counts.
- Suggested fix: restrict public predicates to indexed fields, precompute membership, or add cost guards.

### AGG-C16-38 - Timeline/year pages render up to 500 photo cards in one response

- Severity: Low
- Confidence: Medium
- Source findings: `PERF-C16-09`
- Citations: `apps/web/src/lib/data-timeline.ts:166-267`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-265`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:92-226`
- Problem: archive pages can produce very large SSR/RSC/HTML responses.
- Failure scenario: mobile year/timeline browsing delays first input.
- Suggested fix: add month/page pagination or lazy cursor loading.

### AGG-C16-39 - Admin CSV export materializes up to 50,000 rows and final CSV string in memory

- Severity: Low
- Confidence: High
- Source findings: `PERF-C16-10`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:45-118`
- Problem: bounded but large admin export allocates rows, line array, and final string in one process.
- Failure scenario: export during background work causes GC stalls.
- Suggested fix: move CSV export to streaming admin route with batched query.

### AGG-C16-40 - Single-writer/process-local correctness remains warning-only

- Severity: High if multi-instance occurs
- Confidence: High
- Source findings: `C16-SEC-RISK-03`, `PERF-C16-12`, `A16-ARCH-01`, `C16-RISK-03`
- Cross-agent agreement: security, performance, architecture, critic
- Citations: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/rate-limit.ts`
- Problem: the app documents single-web-instance topology, but persistent singleton-lock contention logs and startup continues.
- Failure scenario: two containers split restore fences, upload tracking, rate-limit buckets, queue state, and buffered analytics.
- Suggested fix: fail production readiness/startup on contention or move correctness-bearing state to shared storage.

### AGG-C16-41 - Live proxy/nginx topology must be validated outside repo code

- Severity: High if misconfigured
- Confidence: High for repo contract, Low/Medium for live host state
- Source findings: `C16-SEC-RISK-01`, `PERF-C16-13`, `A16-ARCH-05`, `C16-RISK-02`, `VER-16-RISK-01`, `T16-TRC-02`, `DOC-C16-MV-02`
- Cross-agent agreement: security, performance, architect, critic, verifier, tracer, document-specialist
- Citations: `apps/web/nginx/default.conf:20-71`, `apps/web/nginx/default.conf:290-306`, `apps/web/src/lib/rate-limit.ts:175-205`, `apps/web/deploy.sh:51-108`, `scripts/check-proxy-topology.mjs`
- Problem: route/body/rate-limit and client-IP correctness depend on host nginx/CDN/LB state that `npm run deploy` does not apply or prove.
- Failure scenario: live config drifts or an upstream LB collapses client IPs, causing over/under-throttling.
- Suggested fix: add deploy/topology drift diagnostics and run proxy-topology checks after edge changes.

### AGG-C16-42 - Plaintext SQL backups rely on host/storage controls

- Severity: Medium
- Confidence: Medium
- Source findings: `C16-SEC-RISK-02`
- Citations: `CLAUDE.md` backup notes, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Problem: web paths are authenticated, but SQL dumps are plaintext at rest by documented operator boundary.
- Failure scenario: host backup/sync/support process exposes DB dumps with session/token hashes and metadata.
- Suggested fix: validate host permissions/backup destinations and encrypt backups where the host boundary is not fully trusted.

### AGG-C16-43 - CLIP production activation remains env/preflight/live-state dependent

- Severity: Medium
- Confidence: High
- Source findings: `TE16-12`, `VER-16-RISK-02`, `DOC-C16-MV-01`, product-marketer risk B
- Cross-agent agreement: test-engineer, verifier, document-specialist, product-marketer
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts`, `.github/workflows/clip-preflight.yml`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/download-clip-models.ts`
- Problem: normal gates prove code gates, not live model weights/env/embedding rows; privacy docs should distinguish one-time model download from offline runtime inference.
- Failure scenario: operator enables production mode without seeded weights or embeddings and public search returns setup/503 states.
- Suggested fix: require documented preflight and live smoke before activation; clarify one-time model download wording.

### AGG-C16-44 - CLIP embedding table destructively replaces prior model rows

- Severity: Medium
- Confidence: Medium
- Source findings: `A16-ARCH-04`
- Citations: `apps/web/src/db/schema.ts:277-304`, `apps/web/src/lib/image-queue.ts:486-524`, semantic/similar routes
- Problem: one row per image means stub/model transitions overwrite prior embeddings.
- Failure scenario: a stub/demo run replaces production vectors and production search appears empty until full re-backfill.
- Suggested fix: use `(image_id, model_version)` history or make overwrites explicit with row-count preview/confirmation.

### AGG-C16-45 - Docker production image correctness is mostly deploy-time, not CI-time

- Severity: Medium
- Confidence: High
- Source findings: `C16-CRIT-06`
- Citations: `.github/workflows/quality.yml:48-83`, `apps/web/Dockerfile:50-85`, `apps/web/deploy.sh:51-56`
- Problem: CI builds the app but not the production Docker image with Linux native package overlays.
- Failure scenario: lockfile/native package mismatch passes CI and fails during remote deploy.
- Suggested fix: add a Docker build gate or lockfile-vs-Dockerfile native package pin checker.

### AGG-C16-46 - Playwright coverage is single-engine Desktop Chrome and hydration waits on `networkidle`

- Severity: Medium/Low
- Confidence: High/Medium
- Source findings: `TE16-11`, `TE16-13`
- Citations: `apps/web/playwright.config.ts:48-77`, `apps/web/e2e/hydration-photo-page.spec.ts:29-42`
- Problem: mobile/WebKit/Firefox-specific regressions are not covered, and one hydration test depends on a brittle network-idle signal.
- Failure scenario: mobile WebKit focus/bottom-sheet bugs or harmless background requests break real users or tests while Desktop Chrome gates pass.
- Suggested fix: add minimal mobile WebKit/Firefox smoke and replace `networkidle` with deterministic UI readiness/error observation.

### AGG-C16-47 - Tracked/nested OMC runtime artifacts pollute source inventories

- Severity: Low
- Confidence: High
- Source findings: code-reviewer #3, `C16-CRIT-05`
- Cross-agent agreement: code-reviewer, critic
- Citations: `.gitignore:16-17`, `.omc/plans/plan-cycle12-fixes.md`, `apps/web/src/__tests__/.omc/state/sessions/.../pre-tool-advisory-throttle.json`
- Problem: ignored runtime/planning artifacts remain tracked or nested under source/test tree.
- Failure scenario: agents/static scans treat stale runtime state as source or live plan context.
- Suggested fix: remove tracked `.omc` artifacts, clean nested runtime state, and add a source-hygiene check for tracked `.omc`/`.omx`.

### AGG-C16-48 - Local ignored site config contains production-looking Atik metadata

- Severity: Low
- Confidence: Medium
- Source findings: product-marketer risk A
- Citations: `apps/web/src/site-config.json`, `apps/web/.gitignore:48-53`, `apps/web/src/site-config.example.json`
- Problem: ignored deploy-local config in this workspace is valid and production-looking, so copied working trees can inherit Atik metadata.
- Failure scenario: a new deployer copies the working tree and launches with the wrong canonical URL/title.
- Suggested fix: clarify deploy-local config in setup docs or add an opt-in prebuild warning for reused Atik metadata.

### AGG-C16-49 - RTL support is structural only and not design-validated

- Severity: Low
- Confidence: Medium
- Source findings: `UIUX-C16-06`
- Citations: `apps/web/src/app/[locale]/layout.tsx:101-107`, `apps/web/src/lib/constants.ts:1-4`, `apps/web/src/lib/locale-path.ts:37-40`
- Problem: `dir` infrastructure exists, but no RTL locale is shipped and many physical left/right classes/icons remain.
- Failure scenario: future Arabic/Hebrew locale flips text direction while controls, icons, and focus order remain LTR.
- Suggested fix: treat RTL enablement as a future design task with logical layout classes and Playwright screenshots.

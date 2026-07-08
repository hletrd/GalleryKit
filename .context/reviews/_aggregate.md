# Cycle 23 Aggregate Review

Date: 2026-07-08 KST
Cycle: 23/100
Reviewed start HEAD: `57c1ae33c0b9a0dd483cfdf58750b81d42a7d775`
Latest review-artifact HEAD during aggregation: `66a2ec6f0797d4c7a3a12bab6d610a2dbae21013`

## Fan-out Coverage

Native named reviewer roles were not registered in this session; the callable agent surface exposed `default`, `explorer`, and `worker`. To preserve the requested review breadth under the AGENTS.md six-child concurrency cap, six parallel/default reviewer lanes were assigned specialist personas:

- `code-reviewer` + `critic`
- `security-reviewer`
- `perf-reviewer` + `tracer`
- `verifier` + `test-engineer`
- `architect` + `debugger`
- `document-specialist` + `designer`

The initial `document-specialist`/`designer` spawn hit the active agent limit, then succeeded after a completed lane was closed. No lane failed after retry.

## Deduped Findings

Total deduped findings: 26

### AGG-C23-01 - Mutation-barrier scanner accepts nested slots that do not dominate later mutations

- Severity: High
- Confidence: High
- Status: Confirmed
- Agreement: `code-reviewer`, `critic`
- Citations: `apps/web/scripts/check-action-origin.ts:687-735`; `apps/web/src/__tests__/check-action-origin.test.ts:624-675`; `CLAUDE.md:434`
- Problem: the action-origin scanner still treats an approved `acquireAdminMutationSlot()` anywhere in a nested block as proof that the whole exported mutating action is restore-fenced.
- Failure scenario: an action can acquire a slot only inside an `if`, `for`, or `try` branch, then run an outer `db.update(...).set(...)` path without a slot while lint passes.
- Suggested fix: make the scanner reason about the protected lexical/control-flow region for each mutation, or require the slot/gate at the exported action body level. Add negative fixtures for nested branch/loop/try slots followed by outer mutations.

### AGG-C23-02 - Restore clears maintenance before queued logout revocations are proven flushed

- Severity: High
- Confidence: High
- Status: Confirmed source-ordering bug
- Agreement: `architect`, `debugger`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:650-679`; `apps/web/src/lib/pending-session-revocations.ts:62-86`; `apps/web/src/app/actions/auth.ts:286-315`; `apps/web/src/lib/session.ts:136-150`; `apps/web/src/__tests__/pending-session-revocations.test.ts:101-110`
- Problem: restore `finally` clears durable/process maintenance before flushing queued session revocations, and the flush cannot distinguish empty from failed.
- Failure scenario: logout during restore queues a session hash; restore imports a backup containing that row; maintenance opens before the queued delete succeeds, so a copied/stale token can authenticate during the gap or after a silent flush failure.
- Suggested fix: flush pending session revocations after import and before `endDurableRestoreMaintenance()`. Make non-empty flush failures observable/fail-closed in the restore path, and update ordering tests.

### AGG-C23-03 - Protected admin SSR reads are not restore-maintenance gated

- Severity: Medium
- Confidence: High
- Status: Confirmed source gap
- Agreement: `architect`, `debugger`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17`; `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`; `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:13-17`; `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-35`; `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:11-13`
- Problem: protected admin layout authenticates but does not check restore maintenance before rendering children that query application tables.
- Failure scenario: an authenticated admin opens dashboard/settings/analytics during restore import and sees 500s, mixed pre/post-restore state, or additional DB pressure.
- Suggested fix: gate protected admin SSR pages on `isRestoreMaintenanceActive()` and render a non-querying maintenance shell, with explicit exceptions only where required for restore UI.

### AGG-C23-04 - Browser/PAT/restore large multipart ingress still materializes bodies before full app backpressure

- Severity: High
- Confidence: High for source shape; Medium to Medium-high for live RSS impact
- Status: Confirmed source condition; load validation needed
- Agreement: `security-reviewer`, `perf-reviewer`, `tracer`
- Citations: `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:87-106`; `apps/web/src/app/api/admin/lr/upload/route.ts:174-181`; `apps/web/src/app/[locale]/admin/db-actions.ts:421-427`, `725-745`
- Problem: large Server Action and `request.formData()` paths can parse/upload large bodies before route-specific quota, lock, or streaming controls fully apply.
- Failure scenario: concurrent valid uploads/restores near 200-250 MiB can spike RSS/GC before the domain code serializes processing, restarting the single web process.
- Suggested fix: move high-volume upload/restore to streaming route handlers with pre-parse `Content-Length`, per-part/aggregate caps, temp-file handoff, and a shared large-body admission semaphore.

### AGG-C23-05 - Browser and PAT upload paths duplicate the ingest security contract

- Severity: High
- Confidence: High
- Status: Confirmed cross-file invariant risk
- Agreement: `security-reviewer`; recurring cycle context
- Citations: `apps/web/src/app/actions/images.ts:87-230`, `325-455`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-190`, `254-520`
- Problem: browser and PAT upload adapters independently implement the same GPS/HDR/audit/quota/queue/cleanup invariants.
- Failure scenario: a future privacy/color/audit fix lands in only one adapter, creating a reachable admin/PAT invariant bypass.
- Suggested fix: extract a shared ingest service after adapter-specific auth/body parsing, and add parity tests over DB rows, audit, GPS/HDR behavior, queue payloads, quota, and cleanup.

### AGG-C23-06 - Background DB/CPU budgets are local and can collectively over-admit work

- Severity: High
- Confidence: High
- Status: Confirmed source shape; load validation needed
- Agreement: `perf-reviewer`, `tracer`
- Citations: `apps/web/src/db/index.ts:31-41`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `716-727`; `apps/web/src/lib/background-db-writes.ts:3-10`, `42-64`; `apps/web/src/lib/clip-model.ts:53-72`, `156-173`
- Problem: image queue, admin backfill, analytics writes, semantic scans, and CLIP inference each budget independently against one small pool/CPU envelope.
- Failure scenario: each subsystem is within its own cap while aggregate background work exhausts DB/CPU, causing foreground gallery/photo requests to queue or fail.
- Suggested fix: introduce process-wide background DB/CPU semaphores with foreground reserve semantics and metrics.

### AGG-C23-07 - Pending file-deletion recovery lacks executable coverage for restore suppression, missing files, and transient retry

- Severity: Medium
- Confidence: High
- Status: Confirmed test/evidence gap
- Agreement: `code-reviewer`, `verifier`, `test-engineer`, `document-specialist`
- Citations: `.context/plans/cycle-22-2026-07-08-plan.md:51-64`; `apps/web/src/__tests__/pending-file-deletions.test.ts:111-158`; `apps/web/src/lib/maintenance-scheduler.ts:26-49`; `apps/web/src/app/[locale]/admin/db-actions.ts:655-678`; `apps/web/src/lib/pending-file-deletions.ts:105-139`
- Problem: Cycle 22 claimed behavior coverage for restore suppression, missing-file idempotency, and retry, but tests cover success, persistent failure, and limit clamping mostly with mocks.
- Failure scenario: future code can drain during restore, mishandle already-missing files, or fail to retry after transient errors while current behavior tests remain green.
- Suggested fix: add executable tests for restore-active scheduler skip, post-marker restore ordering, temp-dir missing-file cleanup through strict helpers, and transient failure followed by success.

### AGG-C23-08 - Successful full-scan derivative cleanup emits false debug noise

- Severity: Low
- Confidence: High
- Status: Confirmed
- Agreement: `verifier`, `test-engineer`
- Citations: `apps/web/src/lib/process-image.ts:576-588`, `118-127`; `apps/web/src/lib/pending-file-deletions.ts:82-88`
- Problem: `deleteImageVariantsStrict(..., [])` iterates a directory with `for await`, then explicitly closes a handle Node may already have closed; `ERR_DIR_CLOSED` is logged as a debug failure.
- Failure scenario: ordinary successful cleanup emits misleading debug noise that obscures real cleanup failures.
- Suggested fix: ignore `ERR_DIR_CLOSED` in `safeCloseDirHandle()` or remove the redundant close after async directory iteration. Add a no-debug regression test.

### AGG-C23-09 - Cycle 22 release ledger is stale relative to pushed recovery state

- Severity: Medium
- Confidence: High
- Status: Confirmed provenance mismatch
- Agreement: `critic`, `verifier`, `test-engineer`, `document-specialist`
- Citations: `.context/plans/cycle-22-2026-07-08-plan.md:1-6`, `135-175`; `.context/plans/README.md:34-37`; commit `57c1ae33`
- Problem: Cycle 22 plan still says gates/commit/push/deploy are pending even though commit history records the pushed recovery commit and its local gate evidence.
- Failure scenario: future cycles cannot tell whether Cycle 22 was source-complete, deployed, superseded, or still pending.
- Suggested fix: append terminal evidence with exact commit hash, push state, deploy result or supersession, and smoke result; move Cycle 22 out of active plans.

### AGG-C23-10 - Review artifacts contain trailing whitespace

- Severity: Low
- Confidence: High
- Status: Confirmed
- Agreement: `code-reviewer`
- Citations: `.context/reviews/_aggregate.md:3-5`; `.context/reviews/designer.md:3-5`, `26-27`, `52-53`, `78-79`, `111-118`; related older review artifacts
- Problem: changed Markdown review artifacts fail `git diff --check`.
- Failure scenario: patch hygiene checks or reviewers fail/noise on docs-only changes.
- Suggested fix: trim trailing whitespace in changed review artifacts.

### AGG-C23-11 - Public SSR page limiter remains an operator-applied nginx template

- Severity: Medium
- Confidence: Medium
- Status: Manual-validation required
- Agreement: `security-reviewer`
- Citations: `apps/web/nginx/default.conf:1-10`, `274-310`; `apps/web/deploy.sh:51-58`; `CLAUDE.md:511-523`
- Problem: committed nginx public-page limiter is inert unless live host config has been applied/reloaded.
- Failure scenario: unauthenticated dynamic public pages remain outside app-layer API/action limiters if host nginx predates the template.
- Suggested fix: record live `nginx -T` and burst-test evidence, or add deploy validation/app-layer fallback.

### AGG-C23-12 - IP-based controls depend on exact live proxy topology

- Severity: Medium
- Confidence: Medium
- Status: Manual-validation required
- Agreement: `security-reviewer`
- Citations: `apps/web/nginx/default.conf:20-32`, `59-72`; `apps/web/src/lib/rate-limit.ts:175-216`; `apps/web/src/lib/request-origin.ts:81-107`
- Problem: rate limits and origin normalization depend on trusted proxy hop and real-IP behavior matching production topology.
- Failure scenario: adding a CDN/tunnel/LB without matching config buckets all users under one IP or trusts spoofable forwarding headers.
- Suggested fix: capture live header/topology evidence and add a startup/health diagnostic for ambiguous forwarded chains.

### AGG-C23-13 - Multi-instance deployment remains warn-only while security state is process-local

- Severity: Medium
- Confidence: High
- Status: Confirmed accepted topology risk
- Agreement: `security-reviewer`
- Citations: `CLAUDE.md:244-247`; `apps/web/src/lib/single-writer-guard.ts:6-18`, `218-235`
- Problem: singleton guard warns but does not fail when a second instance appears, while restore/queue/quota/rate-limit state remains partly process-local.
- Failure scenario: accidental scale-out weakens or splits control state.
- Suggested fix: preserve and monitor single-instance operations, or migrate state to durable shared storage before scaling.

### AGG-C23-14 - Backup confidentiality and full rollback are operator boundaries

- Severity: Low
- Confidence: High
- Status: Confirmed residual risk
- Agreement: `security-reviewer`
- Citations: `CLAUDE.md:223-228`; `apps/web/src/app/[locale]/admin/db-actions.ts:228-243`; `apps/web/src/app/api/admin/db/download/route.ts:21-89`
- Problem: SQL dumps are plaintext at rest and DB restore does not roll back host filesystem state.
- Failure scenario: host/storage compromise exposes dumps, or DB/file state diverges after restore.
- Suggested fix: keep documented as operator boundary, or add encrypted backups/filesystem snapshots/reconciliation.

### AGG-C23-15 - Admin authentication is password-only and root-admin-only

- Severity: Low
- Confidence: High
- Status: Confirmed accepted product decision
- Agreement: `security-reviewer`
- Citations: `apps/web/src/db/schema.ts:193-200`, `225-241`; `apps/web/src/app/actions/auth.ts:79-150`, `217-253`; `CLAUDE.md:248`; `CLAUDE.md` permanently deferred 2FA/WebAuthn note
- Problem: no second factor or role boundary for browser admins.
- Failure scenario: a stolen password/session has full admin capability.
- Suggested fix: only if the product decision changes, add optional WebAuthn/TOTP, recovery codes, sensitive-action reauth, and coarse roles.

### AGG-C23-16 - Public keyword search and smart-collection contains predicates can force leading-wildcard scans

- Severity: Medium
- Confidence: High
- Status: Confirmed source condition; impact depends corpus size
- Agreement: `security-reviewer`
- Citations: `apps/web/src/app/actions/public.ts:247-317`; `apps/web/src/lib/sql-like.ts:5-10`; `apps/web/src/lib/data.ts:1574-1655`, `1693-1737`; `apps/web/src/lib/smart-collections.ts:221-267`
- Problem: public search and contains predicates use `%term%` shapes that are not index-friendly.
- Failure scenario: bots staying inside rate limits can drive disproportionate DB CPU as corpus grows.
- Suggested fix: move search to indexed full-text/ngram/search-table primitives or add cost-aware limits/selectivity rules.

### AGG-C23-17 - Public semantic/similar routes synchronously scan embeddings per request

- Severity: Medium
- Confidence: High
- Status: Confirmed bounded availability/recall risk
- Agreement: `security-reviewer`, `perf-reviewer`, `tracer`
- Citations: `apps/web/src/app/api/search/semantic/route.ts:1-17`, `263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:1-29`, `177-214`; `apps/web/src/lib/clip-embeddings.ts:36-48`; `apps/web/src/db/schema.ts:314-326`
- Problem: semantic/similar search scans recent embedding blobs and scores them in JS in the request path.
- Failure scenario: higher scan limits or traffic increase CPU/DB pressure; recency-capped candidates can miss older relevant images.
- Suggested fix: keep caps conservative, instrument scan/decode/score latency and result age, then move larger corpora to vector index/ANN or precomputed nearest-neighbor structures.

### AGG-C23-18 - Safety-critical coverage still relies heavily on source-contract tests

- Severity: Medium
- Confidence: High
- Status: Confirmed recurring test gap
- Agreement: `test-engineer`, `verifier`
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:28-37`; `apps/web/src/__tests__/db-restore.test.ts:12-136`; `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:19-77`; `apps/web/src/__tests__/search-stale-response.test.ts:13-35`; `apps/web/src/__tests__/pending-file-deletions-source.test.ts:5-45`
- Problem: several high-risk migration/restore/semantic/stale-response/delete-ledger contracts are pinned by source text or shape checks rather than behavior.
- Failure scenario: a refactor preserves expected strings/imports while changing runtime behavior.
- Suggested fix: keep source tripwires but add behavior harnesses for disposable MySQL reconcile, fake child-process restore, route-level semantic caps, and jsdom/RTL stale-search cancellation.

### AGG-C23-19 - Browser-flow verification remains Chromium-only with screenshot artifacts

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk
- Agreement: `verifier`, `test-engineer`
- Citations: `apps/web/playwright.config.ts:72-77`; `.github/workflows/quality.yml:75-80`; `apps/web/e2e/nav-visual-check.spec.ts:40-86`; `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Problem: CI runs only Chromium; visual checks write screenshots without assertions; hydration waits on `networkidle`.
- Failure scenario: mobile WebKit, Firefox gamut behavior, PWA/offline, visual spacing, or hydration flakes escape automation.
- Suggested fix: add small tagged mobile WebKit/mobile Chromium/PWA smoke projects, convert stable screenshots to `toHaveScreenshot()`, and use app-level readiness instead of `networkidle`.

### AGG-C23-20 - Public map can render 10k markers plus duplicate list

- Severity: Medium
- Confidence: High
- Status: Likely/manual-validation
- Agreement: `perf-reviewer`, `tracer`
- Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:50-66`, `98-110`; `apps/web/src/components/map/map-client.tsx:77-94`, `120-141`
- Problem: map SSR/client code can hydrate/render thousands of Leaflet markers plus a full below-map list.
- Failure scenario: large GPS galleries cause main-thread jank and heavy DOM/Leaflet work on mobile.
- Suggested fix: cluster or viewport-page markers and virtualize/paginate the list.

### AGG-C23-21 - On-this-day query remains non-sargable on `capture_date`

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed source shape; scale-dependent
- Agreement: `perf-reviewer`, `tracer`
- Citations: `apps/web/src/lib/data-timeline.ts:103-110`, `121-131`; `apps/web/src/db/schema.ts:123-132`
- Problem: `MONTH(capture_date)` and `DAY(capture_date)` prevent direct index seek.
- Failure scenario: larger galleries scan broad processed capture-date ranges before applying `limit(6)`.
- Suggested fix: add generated month/day columns or a compact calendar index table.

### AGG-C23-22 - HTML service-worker eviction reads every cached HTML response over cap

- Severity: Low
- Confidence: High
- Status: Confirmed bounded issue
- Agreement: `perf-reviewer`, `tracer`
- Citations: `apps/web/public/sw.template.js:31-39`, `147-164`
- Problem: over-cap HTML eviction does `keys()`, `match()` for each response, sorts, then deletes overflow.
- Failure scenario: on slow mobile storage, the 51st HTML cache write can produce service-worker maintenance noise.
- Suggested fix: store HTML recency metadata separately, mirroring the image LRU path.

### AGG-C23-23 - Historical `cycle-23-2026-06-30-*` plans are not disambiguated from current Cycle 23

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed docs ambiguity
- Agreement: `document-specialist`
- Citations: `.context/plans/cycle-23-2026-06-30-plan.md:1-5`; `.context/plans/cycle-23-2026-06-30-deferred.md:1-7`; `.context/plans/README.md:39-43`
- Problem: old pre-run-10 Cycle 23 plan/deferred files can be mistaken for the current run-10 Cycle 23.
- Failure scenario: agents grep `cycle-23` and import stale aggregate IDs or completed/pending state.
- Suggested fix: archive or explicitly disambiguate the 2026-06-30 pair in the plans README.

### AGG-C23-24 - Search dialog opens while focused combobox reports `aria-expanded="false"`

- Severity: Medium
- Confidence: High
- Status: Confirmed live accessibility defect
- Agreement: `designer`
- Citations: `apps/web/src/components/search.tsx:434-456`
- Problem: the modal search UI is visible and focused but the combobox state reports collapsed until results appear, with no `aria-controls` in the open-empty state.
- Failure scenario: screen-reader users get contradictory open/collapsed state while interacting with search.
- Suggested fix: bind `aria-expanded` to the actual popup/dialog/listbox state or separate dialog and listbox semantics; add an accessibility test for open-empty search.

### AGG-C23-25 - Admin narrow-screen image management remains table-first

- Severity: Medium
- Confidence: High
- Status: Source-confirmed carry-forward
- Agreement: `designer`
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `apps/web/src/components/image-manager.tsx:427-450`, `472-488`, `500-552`, `571-607`; `.context/plans/cycle-22-2026-07-08-deferred.md`
- Problem: narrow screens still use a wide 9-column image table with horizontal scrolling.
- Failure scenario: admins lose row context before reaching tags/actions, increasing editing/destructive-action friction.
- Suggested fix: keep wide desktop table, add responsive card/list workbench below large desktop widths.

### AGG-C23-26 - Admin nav hierarchy and mobile masonry overlay remain product/UI carry-forwards

- Severity: Low-Medium
- Confidence: High
- Status: Source/live-confirmed carry-forward
- Agreement: `designer`
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`; `apps/web/src/components/masonry-card.tsx:149-154`
- Problem: admin workflows remain a flat nav strip, and mobile masonry permanently overlays metadata over finished photos.
- Failure scenario: sensitive admin operations appear as equal peers to routine publishing, and mobile photo detail near the top can be obscured by chrome.
- Suggested fix: group admin IA into sections/drawer at narrow widths; move mobile metadata below the image or make overlay opt-in/focus/open only.

## Agent Failures

None after retry. The first `document-specialist`/`designer` spawn attempt failed with `agent thread limit reached`, then succeeded after a completed review agent was closed.

## Final Sweep

The aggregate deduped repeated reports across scanner dominance, restore/session ordering, admin restore gating, pending-deletion coverage, release-ledger provenance, upload/body admission, background budgets, search/vector/map performance, operator topology, browser/test coverage, and UI/accessibility. Historical carry-forward items were preserved as findings when a Cycle 23 lane revalidated them; Prompt 2 must either schedule or explicitly defer every finding above under repo policy.

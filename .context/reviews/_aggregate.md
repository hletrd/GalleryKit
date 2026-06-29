# Cycle 6/100 Aggregate Review

Date: 2026-06-29
Repo: `/Users/hletrd/flash-shared/gallery`
Cycle scope: current `HEAD`; early lanes reviewed `e6db9241`, later lanes reviewed `5443009e`. The only intervening commit was a review artifact, so application code was unchanged across the split.

## Agent Coverage

Completed review artifacts:
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

Implementation caveat: the native subagent surface exposed generic `worker`/`explorer` roles, so requested reviewer roles were run as bounded worker personas. One code-reviewer lane accidentally committed and pushed its review artifact as `5443009e docs(review): 📝 record cycle 6 code review` and ran a successful deploy during Prompt 1; no application code was changed by that commit.

## AGENT FAILURES

None. Every spawned reviewer returned an artifact. The code-reviewer process violated the intended report-only phase by committing/pushing/deploying; the artifact is retained for provenance and the accidental side effect is recorded here.

## Merged Findings

### C6-01 - Restore setup can leak advisory/upload locks before maintenance begins

Severity: High
Confidence: High
Status: Confirmed
Sources: code-reviewer

Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:279-324`, `apps/web/src/app/[locale]/admin/db-actions.ts:363-388`, `apps/web/src/lib/upload-processing-contract-lock.ts:9-73`, `apps/web/src/__tests__/restore-upload-lock.test.ts:46-66`.

The restore flow acquires the DB restore lock and upload-processing contract lock before the protected inner cleanup window starts. If the backfill-lock acquisition query throws, the outer `finally` releases only the pooled connection and can leave advisory/upload locks held. Fix by making the entire acquisition phase cleanup-owned and adding a setup-failure regression test.

### C6-02 - Restore resumes traffic and queue work after post-restore migration failure

Severity: High
Confidence: High
Status: Confirmed
Sources: architect

Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:362-366`, `apps/web/src/app/[locale]/admin/db-actions.ts:521-540`, `CLAUDE.md:209`.

`runRestore` can report post-import migration failure, but the outer `finally` always ends restore maintenance and resumes the image queue. That exposes current app code to an unverified restored schema. Fix by only ending maintenance/resuming queue after import and post-restore migrations both succeed, while still releasing advisory locks.

### C6-03 - Restore can remain wedged if final app revalidation throws

Severity: High
Confidence: High
Status: Confirmed
Sources: debugger

Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:521-540`, `apps/web/src/lib/revalidation.ts:59-61`.

On the successful restore path, `revalidateAllAppData()` can throw before the async `close` handler resolves the restore promise. That prevents the caller from reaching cleanup, leaving maintenance/locks/queue state wedged. Make global revalidation best-effort or locally catch it in restore, then test restore cleanup with a thrown revalidation.

### C6-04 - Production CLIP embeddings run outside queue, restore, shutdown, and retry control

Severity: High
Confidence: High
Status: Confirmed
Sources: code-reviewer, debugger

Evidence: `apps/web/src/lib/image-queue.ts:470-567`, `apps/web/src/lib/image-queue.ts:847-888`, `apps/web/src/lib/queue-shutdown.ts:15-42`, `apps/web/src/lib/clip-model.ts:151-186`, `apps/web/src/app/actions/embeddings.ts:103-172`, `apps/web/src/app/api/search/semantic/route.ts:238-257`.

Embedding generation starts in detached fire-and-forget work after an image is marked processed. Restore quiesce and shutdown wait on the image PQueue, not these embedding side effects, and transient embedding failures are only logged. Fix with a tracked embedding lifecycle, bounded concurrency, drain hooks, and missing-embedding retry/backfill coverage.

### C6-05 - Public semantic search accepts multi-kilobyte queries despite the 200-code-point contract

Severity: Medium
Confidence: High
Status: Confirmed
Sources: architect

Evidence: `apps/web/src/app/api/search/semantic/route.ts:93-95`, `apps/web/src/app/api/search/semantic/route.ts:204-231`, `apps/web/src/app/actions/public.ts:237-243`, `apps/web/src/lib/data.ts:1476-1483`, `apps/web/src/__tests__/semantic-search-route.test.ts:177-214`.

The route comment and regular search stack assume short queries, but semantic search only rejects queries under three code points and otherwise allows any query fitting the 8 KiB body cap. Add a shared 200-code-point semantic limit and route tests.

### C6-06 - CLIP sidecar backfill can no-op forever when `SEMANTIC_SCAN_LIMIT < 50`

Severity: Medium
Confidence: High
Status: Confirmed
Sources: tracer

Evidence: `apps/web/scripts/backfill-clip-embeddings.ts`.

The script fetches up to the fixed batch size of 50 rows, then breaks before processing if `processed + failed + rows.length > SEMANTIC_SCAN_LIMIT`. A small scan limit can therefore process zero rows repeatedly. Limit the query by remaining scan budget or process a sliced subset.

### C6-07 - Initial public listing queries aggregate tags and `COUNT(*) OVER()` across the full matched set

Severity: High
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/lib/data.ts:872-900`, `apps/web/src/lib/data.ts:1403-1447`, `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

The first-page home/topic/smart-collection queries join tags, group by image, and compute a window count before limiting. Large galleries can pay full-set temp-table work for a 30-card render. Split count and bounded ID/tag hydration queries, or remove exact count from public first pages.

### C6-08 - Topic and shared-group analytics lack indexes matching time-window filters

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/lib/analytics-data.ts:62-79`, `apps/web/src/lib/analytics-data.ts:161-180`, `apps/web/src/db/schema.ts:221-254`.

Analytics filter by `bot=false` and `viewed_at >= ?`, but topic/shared indexes lead with entity columns. Add `(bot, viewed_at, topic)` and `(bot, viewed_at, group_id)` indexes and migrations, keeping entity-first indexes if still needed.

### C6-09 - Sized derivative re-encodes overwrite public image files non-atomically

Severity: Medium
Confidence: High
Status: Confirmed
Sources: perf-reviewer

Evidence: `apps/web/src/lib/process-image.ts:1133-1292`, `apps/web/public/sw.template.js:176-205`, `apps/web/public/sw.template.js:237-254`.

Backfill/color re-encodes write public sized derivatives directly while the service worker can cache successful image responses by URL. A request during a rewrite can cache truncated bytes. Write every sized derivative to a temp file in the same directory and atomically rename.

### C6-10 - Semantic search ignores stale responses but does not abort stale expensive requests

Severity: Low
Confidence: Medium
Status: Likely
Sources: perf-reviewer

Evidence: `apps/web/src/components/search.tsx:152-197`, `apps/web/src/app/api/search/semantic/route.ts:228-279`.

The client ignores stale responses after fetch completion but does not abort superseded semantic requests. Rapid typing can leave unnecessary CLIP/token scan work in flight. Use `AbortController` where feasible.

### C6-11 - Timeline and on-this-day queries use non-sargable date functions

Severity: Low
Confidence: Low for current harm, High that pattern exists
Status: Risk needing manual validation
Sources: perf-reviewer

Evidence: `apps/web/src/lib/data-timeline.ts`.

Date-function predicates may block index use. Validate with production-like row counts before refactoring.

### C6-12 - Warm service-worker image loads still put a synchronous HEAD probe on display path

Severity: Low
Confidence: Medium
Status: Risk needing manual validation
Sources: perf-reviewer

Evidence: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`.

Cached image hits still perform HEAD validation before returning bytes. Measure perceived latency and decide whether stale-while-revalidate fits better.

### C6-13 - Semantic and similar-photo search remain brute-force scans by design

Severity: Low
Confidence: Medium
Status: Risk needing manual validation
Sources: perf-reviewer

Evidence: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.

The current scan approach is acceptable for bounded galleries but will degrade with embedding count. Re-open when gallery size or latency exceeds documented limits.

### C6-14 - Docker build bypasses the committed lockfile for native packages

Severity: Medium
Confidence: High
Status: Confirmed
Sources: security-reviewer

Evidence: `apps/web/Dockerfile:44-51`, `package-lock.json` entries for native optional packages.

After `npm ci`, the Dockerfile runs unversioned `npm install --no-save` for native packages. Deploys can silently pull newer native code than the reviewed lockfile. Pin exact lockfile versions or materialize optional dependencies through a lockfile-enforced install path, and add a Dockerfile contract test.

### C6-15 - TLS and HSTS rely on an external edge

Severity if misdeployed: High
Confidence: Medium
Status: Risk needing manual validation
Sources: security-reviewer

Evidence: `apps/web/nginx/default.conf:21-28`, `apps/web/nginx/default.conf:47-53`.

The checked-in nginx listens on cleartext port 80 and assumes an external TLS terminator. Validate the production edge or add deployment assertions/redirect config before topology changes.

### C6-16 - Client-IP trust depends on exact proxy-chain topology

Severity if misconfigured: Medium
Confidence: Medium
Status: Risk needing manual validation
Sources: security-reviewer

Evidence: `apps/web/docker-compose.yml:14-21`, `apps/web/nginx/default.conf`, `apps/web/src/lib/rate-limit.ts:152-180`.

`TRUST_PROXY=true` makes rate limits depend on correct forwarded IP topology. Validate nginx/edge `real_ip` behavior and `TRUSTED_PROXY_HOPS` before proxy-chain changes.

### C6-17 - Security controls are process-local under the documented single-instance topology

Severity if scaled out: Medium
Confidence: High
Status: Risk needing manual validation
Sources: security-reviewer

Evidence: `apps/web/docker-compose.yml:11-21`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/restore-maintenance.ts`.

Restore maintenance, upload tracking, and in-memory limiter fast paths are single-process controls. Keep single-instance deployment explicit or move these controls to shared leases/stores before adding replicas.

### C6-18 - Production CSP blocks the public map tile layer

Severity: Medium
Confidence: High
Status: Confirmed
Sources: critic

Evidence: `apps/web/src/components/map/map-client.tsx:114-117`, `apps/web/src/lib/content-security-policy.ts:28-34`, `apps/web/src/lib/content-security-policy.ts:74-79`, `apps/web/src/proxy.ts:36-49`, `apps/web/src/__tests__/content-security-policy.test.ts:23-45`.

The map uses OpenStreetMap tile URLs, but `img-src` omits the OSM tile hosts in production CSP. Add the exact tile origins or a tile proxy and test the CSP contract.

### C6-19 - Concurrent topic cover updates can orphan resource files

Severity: Medium
Confidence: High
Status: Confirmed
Sources: critic, tracer

Evidence: `apps/web/src/app/actions/topics.ts:232-362`, `apps/web/src/lib/process-topic-image.ts:59-102`, `apps/web/src/__tests__/topics-actions.test.ts:431-486`.

`updateTopic` reads the previous image before acquiring the route mutation lock, but cleanup after the locked DB update deletes that stale filename. Concurrent cover changes can leave the replaced locked-row image orphaned. Capture the replaced filename inside the lock and delete that file after commit.

### C6-20 - Public mutating server actions are outside both mutation lint gates

Severity: High
Confidence: High
Status: Confirmed
Sources: test-engineer

Evidence: `apps/web/scripts/check-action-origin.ts:13-21`, `apps/web/scripts/check-action-origin.ts:49`, `apps/web/scripts/check-action-origin.ts:86-105`, `apps/web/scripts/check-public-route-rate-limit.ts:25-26`, `apps/web/scripts/check-public-route-rate-limit.ts:296-305`, `apps/web/src/app/actions/public.ts:349-411`, `apps/web/src/__tests__/public-actions.test.ts:227-270`.

`app/actions/public.ts` now contains public DB-writing analytics actions, but action-origin lint excludes `public` and public route rate-limit lint scans only API routes. Add a public-action mutation/rate-limit scanner or extend existing gates.

### C6-21 - Public route rate-limit scanner trusts helper names without verifying source

Severity: Medium
Confidence: High
Status: Confirmed
Sources: test-engineer

Evidence: `apps/web/scripts/check-public-route-rate-limit.ts:38-45`, `apps/web/scripts/check-public-route-rate-limit.ts:96-100`, `apps/web/scripts/check-public-route-rate-limit.ts:140-187`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:277-288`.

The scanner accepts any callee starting with `preIncrement` or `checkAndIncrement`, even if it is local/noop or imported from a non-rate-limit module. Track imports/local definitions and only accept approved helper sources.

### C6-22 - Migration reconcile coverage checks global tokens rather than table-local structure

Severity: Medium
Confidence: High
Status: Confirmed
Sources: test-engineer

Evidence: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-101`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-170`, `apps/web/scripts/migrate.js:293-418`, `apps/web/src/db/schema.ts:19-117`, `apps/web/src/db/schema.ts:221-286`.

The reconcile tripwire can pass when a column/index token appears for the wrong table. Make coverage structural by matching table-local `CREATE TABLE`, `ensureColumn`, and `ensureIndex` calls or by diffing a disposable reconciled schema.

### C6-23 - E2E seed can destructively target a non-disposable database

Severity: Medium
Confidence: Medium
Status: Confirmed
Sources: test-engineer

Evidence: `apps/web/playwright.config.ts:18-24`, `apps/web/playwright.config.ts:76-82`, `apps/web/scripts/run-e2e-server.mjs:75-83`, `apps/web/scripts/seed-e2e.ts:9`, `apps/web/scripts/seed-e2e.ts:156-160`, `apps/web/scripts/seed-e2e.ts:183-204`, `apps/web/scripts/seed-e2e.ts:250-254`.

The E2E seed refuses only `NODE_ENV=production` before deleting seeded rows/files. Require an explicit destructive seed opt-in and/or disposable DB allowlist before any delete/fs cleanup.

### C6-24 - Real CLIP model suites skip in normal CI

Severity: Medium
Confidence: Medium
Status: Likely
Sources: test-engineer

Evidence: `apps/web/src/__tests__/clip-offline-load.test.ts:37-43`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-31`, `.github/workflows/quality.yml:27-80`.

Production semantic behavior is mostly mocked unless local model weights are present. Add a scheduled/manual CI or preflight gate for real model manifest/loading.

### C6-25 - Backup/restore docs name the wrong original-upload directory

Severity: Medium
Confidence: High
Status: Confirmed
Sources: verifier, document-specialist

Evidence: `CLAUDE.md`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/local.ts`.

Docs refer to `data/originals`, but the current original upload path is `data/uploads/original`. Correct the runbook text to avoid failed operator audits/backups.

### C6-26 - Semantic model-version regression coverage is source-string based

Severity: Low
Confidence: High
Status: Confirmed test gap
Sources: verifier

Evidence: `apps/web/src/__tests__/semantic-search-route.test.ts`, semantic model-version filtering code.

The current guard proves code contains a filter string, not that stale-model rows are excluded behaviorally. Add a route-level behavior test.

### C6-27 - Lightroom topic-lookup quota rollback is pinned only by regex over source text

Severity: Low
Confidence: Medium
Status: Confirmed test gap
Sources: verifier

Evidence: `apps/web/src/__tests__`, `apps/web/src/app/api/admin/lr/upload/route.ts`.

Quota rollback after topic lookup failure should be verified at route behavior level, not only with source regex.

### C6-28 - Collapsed mobile photo info sheet keeps a modal focus trap around hidden controls

Severity: Medium
Confidence: High
Status: Confirmed
Sources: designer

Evidence: `apps/web/src/components/info-bottom-sheet.tsx`.

The collapsed mobile sheet leaves a modal focus trap active while most controls are visually hidden behind `overflow-hidden`. Remove the collapsed modal state or make it non-modal/inert with correct focus behavior.

### C6-29 - Upload queue looks disabled during upload but remains keyboard-operable

Severity: Medium
Confidence: High
Status: Confirmed
Sources: designer

Evidence: `apps/web/src/components/upload-dropzone.tsx`.

The queue uses `opacity-50 pointer-events-none` while uploading, but nested controls remain focusable and keyboard-operable. Disable/remove controls and TagInput interaction consistently during upload.

### C6-30 - Mobile photo-viewer toolbar can overflow with long localized topic names

Severity: Medium
Confidence: High
Status: Confirmed
Sources: ui-ux-designer-reviewer

Evidence: `apps/web/src/components/photo-viewer.tsx:578-640`, `apps/web/src/components/ui/button.tsx:8`.

The back button text is no-wrap and shares a single toolbar row with fixed action buttons. Long Korean/localized topic names can overflow narrow screens. Add truncation, responsive icon-only behavior, or a two-row mobile toolbar.

### C6-31 - DB admin page uses one pending state for backup, restore, and export

Severity: Low
Confidence: High
Status: Confirmed
Sources: ui-ux-designer-reviewer

Evidence: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:28`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:143-245`.

One `useTransition` pending state drives all DB operation labels. Clicking Backup can make Restore/Export display false processing labels. Track the active operation explicitly.

### C6-32 - README promises 10-bit AVIF for wide-gamut too absolutely

Severity: Low
Confidence: High
Status: Confirmed
Sources: product-marketer-reviewer

Evidence: `README.md:31-33`, `CLAUDE.md:283-285`, `apps/web/src/lib/process-image.ts:1194-1235`, `apps/web/src/components/color-details-section.tsx:471-497`, `apps/web/messages/en.json:324-325`, `apps/web/messages/ko.json:324-325`.

The top-level README says wide-gamut images get 10-bit AVIF, while code and in-app copy correctly disclose Sharp/libheif-dependent 8-bit fallback. Reword the feature claim.

### C6-33 - Archived CLIP plan has stale production activation wording

Severity: Low
Confidence: Medium
Status: Risk needing manual validation
Sources: product-marketer-reviewer

Evidence: `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:955`, `apps/web/README.md:64-71`, `apps/web/src/lib/gallery-config.ts:126-145`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:651-678`.

The archived plan tells operators to enable production semantic search through Admin Settings, but the active path is env + DB row gated. Mark the plan historical or update the stale instruction if maintainers still use it.

### C6-34 - Post-commit global revalidation failures can create false mutation failures

Severity: Low
Confidence: Medium
Status: Risk needing manual validation
Sources: debugger

Evidence: `apps/web/src/app/actions/collections.ts:45-130`, `apps/web/src/app/actions/settings.ts:136-164`, `apps/web/src/app/actions/seo.ts:140-164`, `apps/web/src/lib/revalidation.ts:59-61`.

Several actions mutate DB state before calling `revalidateAllAppData()` inside the same action `try` block. If global revalidation can throw in production, the action may return failure after the mutation committed. Validate runtime behavior; if possible, make global revalidation best-effort.

## Prompt 1 Status

Total unique findings: 34.
Cross-agent agreement:
- Restore lifecycle/cleanup: code-reviewer, architect, debugger.
- Semantic embedding lifecycle: code-reviewer, debugger, architect, tracer, test-engineer.
- Topic cover cleanup race: critic and tracer.
- Backup/restore docs path mismatch: verifier and document-specialist.

All per-agent files are retained for provenance.

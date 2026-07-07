# Cycle 19 Aggregate Review

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Cycle: review-plan-fix 19/100
Reviewed HEAD: `6efd737b3ad5791c662fded4801701992684e54d`

## Agent Coverage

Native agent roles exposed here were `default`, `explorer`, and `worker`, so the requested specialist lanes were run as role-specific worker prompts. The active agent limit required bounded batches, but every required lane returned and wrote its report.

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

Agent failures: none.

Raw findings before dedupe: 58.
Unique deduped findings: 34.
Strongest cross-agent agreement: large multipart memory boundary, request-local semantic vector scans, public map scale, source-contract test debt, Playwright/browser matrix gaps, and stale cycle/deploy ledgers.

## Findings

### AGG-C19-01 - LR multipart parse slot can leak if PAT usage marking throws

- Severity: High
- Confidence: High
- Source findings: `DBG-C19-01`
- Cross-agent agreement: debugger
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:152-188`, `apps/web/src/lib/api-auth.ts:23-28`
- Problem: the LR upload route acquires the singleton multipart parse slot, then awaits `markAdminAuthTokenUsed(request)` before entering the `try/finally` that releases the slot.
- Failure scenario: a transient DB/token-store failure during `markTokenUsed()` exits the handler with `lrMultipartParseInFlight` stuck at `1`, causing every later Lightroom upload in that process to return 429 until restart.
- Suggested fix: start the release-protected region immediately after slot acquisition, or move token-use marking before slot acquisition, and add a regression proving a following upload can pass the gate after token-use failure.

### AGG-C19-02 - CLIP embedding backfill can stop quietly before later embeddable rows

- Severity: Medium
- Confidence: High
- Source findings: `TRC19-01`, `DOC-C19-01`
- Cross-agent agreement: tracer, document-specialist
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts:159-189`, `apps/web/scripts/backfill-clip-embeddings.ts:201-244`, `apps/web/src/app/actions/embeddings.ts:141-211`, `CLAUDE.md:597-600`, `apps/web/README.md:84-85`
- Problem: the backfill reduces SQL page size by remaining embedding-attempt budget, but still treats `rows.length < BATCH_SIZE` as end-of-backlog. A skip-heavy short page can exit without the scan-limit continuation message.
- Failure scenario: near the scan limit, the next limited page contains only missing-original rows; attempts do not increase, the script logs done, and valid later rows remain unembedded while the operator stops per runbook.
- Suggested fix: decouple scan page size from attempt budget or compare to the actual fetch limit, continue past skipped rows while budget remains, emit continuation when budget is exhausted, and add sidecar/action behavior tests.

### AGG-C19-03 - Large multipart ingest still materializes request bodies before app-level streaming

- Severity: High
- Confidence: High
- Source findings: `CR-19-01`, `C19-PERF-02`, `ARCH19-01`, `DOC-C19-05`
- Cross-agent agreement: code-reviewer, perf-reviewer, architect, document-specialist
- Citations: `apps/web/next.config.ts:111-119`, `apps/web/src/lib/upload-limits.ts:1-35`, `apps/web/src/app/actions/images.ts:129-260`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-188`, `apps/web/src/app/[locale]/admin/db-actions.ts:378-684`, `apps/web/src/lib/process-image.ts:882-887`
- Problem: browser uploads and restore are Server Action/FormData surfaces, and LR upload still calls `request.formData()`. The helper streams an already-received `File`, but the framework parser has already accepted/materialized large bodies.
- Failure scenario: large admin uploads or restores pin hundreds of MiB in the web process before app quota/disk streaming can relieve pressure, risking RSS spikes or OOM on the single host.
- Suggested fix: migrate large binary ingress to streaming route handlers with per-part limits, direct temp-file writes, and a shared ingress semaphore. Reword helper comments so they do not imply end-to-end heap safety.

### AGG-C19-04 - Foreground queue and admin backfill can over-reserve the same DB pool

- Severity: High
- Confidence: High
- Source findings: `C19-PERF-01`
- Cross-agent agreement: perf-reviewer
- Citations: `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:121-142`, `apps/web/src/lib/image-queue.ts:805-903`, `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `apps/web/src/lib/admin-backfill-runner.ts:520-727`
- Problem: image queue and admin backfill each independently reserve "live traffic" pool headroom, but their workers can run simultaneously under different locks and pin most of the 10-connection pool.
- Failure scenario: active upload processing plus a color backfill leaves only one pool slot for public/admin requests, causing live routes to queue behind encode-duration holds and hit `queueLimit`.
- Suggested fix: add one process-wide background DB budget shared by queue, backfills, semantic backfill, and side effects, or pause/drain foreground queue work before large admin backfills.

### AGG-C19-05 - Semantic and similar-photo routes do request-local vector scans

- Severity: High
- Confidence: High
- Source findings: `C19-PERF-04`, `SEC-19-01`, `ARCH19-02`, `C19-CRIT-06`
- Cross-agent agreement: perf-reviewer, security-reviewer, architect, critic
- Citations: `apps/web/src/app/api/search/semantic/route.ts:247-368`, `apps/web/src/app/api/search/similar/[id]/route.ts:137-285`, `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/db/schema.ts:292-304`
- Problem: every admitted semantic/similar request can load embedding blobs, decode vectors, score them in Node, and enrich results inside the Next request process.
- Failure scenario: production semantic traffic or direct clients with valid origin headers burn DB bandwidth, CPU, and heap concurrently with page rendering and image processing.
- Suggested fix: move vector search to an ANN/vector index, sidecar, or cached generation-owned matrix with concurrency/backpressure; at minimum add a shared semantic-search budget and stronger shared/edge rate limiting.

### AGG-C19-06 - Public map can ship thousands of markers and sub-44 px Leaflet controls

- Severity: Medium
- Confidence: High
- Source findings: `CR-19-03`, `C19-PERF-05`, `ARCH19-03`, `C19-CRIT-08`, `DES-C19-01`
- Cross-agent agreement: code-reviewer, perf-reviewer, architect, critic, designer
- Citations: `apps/web/src/lib/data.ts:1766-1816`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`, `apps/web/src/__tests__/touch-target-audit.test.ts:9-15`
- Problem: `/map` can load 10,000 rows, render one Leaflet marker per row and a duplicate fallback list, while default Leaflet zoom/marker/attribution controls are below the repo's 44 px interactive target policy.
- Failure scenario: large GPS archives freeze mobile browsers and visible map controls remain hard to use for touch or motor-impaired visitors.
- Suggested fix: add viewport-bounded clustering/pagination for scale. Separately, render or style Leaflet controls so visible hit targets meet 44 px.

### AGG-C19-07 - Migration reconcile coverage does not prove structural schema equivalence

- Severity: High
- Confidence: High
- Source findings: `VER-C19-03`, `TEST-C19-01`
- Cross-agent agreement: verifier, test-engineer
- Citations: `CLAUDE.md:479-485`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-102`, `apps/web/scripts/migrate.js:277-284`
- Problem: the reconcile coverage is mainly a source/name-presence tripwire and explicitly cannot verify column types, defaults, nullability, index order, or FK actions.
- Failure scenario: future schema drift mentions the right names in `migrate.js` but applies structurally wrong DDL; tests pass while fresh/legacy baselines diverge from migrated DBs.
- Suggested fix: add a DB-backed schema-convergence gate or explicit CI/nightly/schema-change command that introspects `information_schema` after reconcile/baseline.

### AGG-C19-08 - High-risk invariants still rely on source-string tests

- Severity: Medium
- Confidence: High
- Source findings: `CR-19-04`, `C19-CRIT-12`, `TEST-C19-05`
- Cross-agent agreement: code-reviewer, critic, test-engineer
- Citations: `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-76`, `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:42-50`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:5-30`, `apps/web/src/__tests__/search-status-source.test.ts:15-69`
- Problem: several behavior-sensitive contracts are guarded by source text or regex presence rather than executed branch/order/cleanup tests.
- Failure scenario: a refactor keeps the expected string in a helper or dead branch while active behavior drops scan limits, leaks quota, commits stale search results, or fails fallback transitions.
- Suggested fix: keep source contracts for mechanical import/boundary checks, but add focused behavior tests for semantic scan limits, LR/browser upload cleanup, restore/advisory cleanup, load-more retry/status, search stale-response, and image fallback.

### AGG-C19-09 - Playwright browser coverage is desktop Chromium only

- Severity: Medium
- Confidence: High
- Source findings: `CR-19-05`, `TEST-C19-02`, `C19-CRIT-12`
- Cross-agent agreement: code-reviewer, test-engineer, critic
- Citations: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-49`
- Problem: the standard E2E matrix runs only Desktop Chrome; touch behavior is synthetic rather than executed in a true mobile/touch device context.
- Failure scenario: mobile Safari/WebKit, Firefox, real touch dispatch, responsive nav, and lightbox/photo rendering regressions pass the normal e2e gate.
- Suggested fix: add opt-in or scheduled mobile WebKit, desktop Firefox, and mobile Chromium smoke projects for critical public flows.

### AGG-C19-10 - Admin E2E workflows are credential-gated and shallow

- Severity: Medium
- Confidence: High
- Source findings: `CR-19-06`, `TEST-C19-06`
- Cross-agent agreement: code-reviewer, test-engineer
- Citations: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/helpers.ts:28-45`, `apps/web/e2e/admin.spec.ts:20-165`
- Problem: local `npm run test:e2e` can pass with admin workflows skipped, and existing admin browser coverage does not exercise many high-risk protected flows.
- Failure scenario: settings, token, backup/restore, sharing, semantic setup, or destructive confirmation UI breaks in hydration while unit/source tests remain green.
- Suggested fix: split admin Playwright into tagged flows with explicit skip reporting and require relevant tags for touched admin areas.

### AGG-C19-11 - Public page/semantic availability controls depend on documented topology and manual nginx state

- Severity: Medium
- Confidence: High for repo state; Medium for live exposure
- Source findings: `SEC-19-02`, `MV-C19-PERF-01`, `C19-CRIT-02`
- Cross-agent agreement: security-reviewer, perf-reviewer, critic
- Citations: `CLAUDE.md:245-247`, `CLAUDE.md:521-548`, `apps/web/nginx/default.conf:274-306`, `apps/web/deploy.sh:51-55`, `apps/web/src/lib/rate-limit.ts:124-133`, `apps/web/src/lib/restore-maintenance.ts:1-60`
- Problem: public SSR page throttling is edge-only and deploy does not apply host nginx; several safety buckets remain process-local under the documented single-web-instance topology.
- Failure scenario: stale/bypassed nginx or accidental scale-out removes the intended availability backstop for dynamic public pages and weakens process-local quotas/maintenance flags.
- Suggested fix: add deploy/live nginx verification or app-layer fallback limits, and fail-loud before unsupported scale-out unless coordination state is moved to shared storage.

### AGG-C19-12 - Production CSP still allows inline styles

- Severity: Low
- Confidence: High
- Source findings: `SEC-19-03`
- Cross-agent agreement: security-reviewer
- Citations: `apps/web/src/lib/content-security-policy.ts:182-190`
- Problem: production `style-src` includes `'unsafe-inline'`.
- Failure scenario: a future HTML/style injection bug cannot run scripts due to nonce gating, but can still manipulate layout, hide warnings, or create phishing overlays.
- Suggested fix: track as CSP debt and test framework-supported style nonces/hashes or extracted styles before removing the allowance.

### AGG-C19-13 - Public smart collections can compile expensive dynamic predicates on every fresh hit

- Severity: Medium
- Confidence: Medium
- Source findings: `C19-PERF-07`
- Cross-agent agreement: perf-reviewer
- Citations: `apps/web/src/lib/smart-collections.ts:142-352`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/lib/data.ts:1488-1544`
- Problem: public smart collections are dynamic and can include broad `%LIKE%`/tag predicates within a large bounded AST.
- Failure scenario: an admin-published broad collection causes expensive image/tag scans for every public hit even though only the first page is rendered.
- Suggested fix: classify public smart-collection query cost, restrict non-sargable predicates for public collections, or materialize membership.

### AGG-C19-14 - Public keyword search still uses multi-query leading-wildcard scans

- Severity: Medium
- Confidence: Medium
- Source findings: `C19-PERF-08`, `C19-CRIT-07`
- Cross-agent agreement: perf-reviewer, critic
- Citations: `apps/web/src/lib/sql-like.ts:9-10`, `apps/web/src/lib/data.ts:1574-1738`, `apps/web/src/app/actions/public.ts:266-317`
- Problem: accepted searches can run `%term%` scans across image, topic, tag, alias, camera, and lens fields.
- Failure scenario: varied short searches within allowed rate limits consume DB CPU and increase browsing latency.
- Suggested fix: add full-text/search document indexing, raise minimum query length, cache popular searches, or gather `EXPLAIN ANALYZE` and add plan regression fixtures.

### AGG-C19-15 - Admin CSV export materializes up to 50k rows and one full CSV string

- Severity: Low
- Confidence: High
- Source findings: `C19-PERF-06`
- Cross-agent agreement: perf-reviewer
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:45-120`
- Problem: CSV export builds an array of up to 50,000 rows/lines and returns one full string through a Server Action.
- Failure scenario: near-cap export adds avoidable heap/GC pressure while upload/backfill/public requests share the same process.
- Suggested fix: stream rows through an authenticated route handler instead of returning a full Server Action string.

### AGG-C19-16 - Cached shared-group lookup owns view-count side effects

- Severity: Medium
- Confidence: Medium
- Source findings: `CR-19-02`
- Cross-agent agreement: code-reviewer
- Citations: `apps/web/src/lib/data.ts:1402-1407`, `apps/web/src/lib/data.ts:1830-1834`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`
- Problem: a React-cached shared-group read can also buffer denormalized view-count side effects while the page separately owns durable view recording.
- Failure scenario: a future metadata/preload/refactor call changes cache call order or increment options and silently skips or duplicates counters.
- Suggested fix: split pure cached reads from explicit view-recording orchestration.

### AGG-C19-17 - Restore quiescence does not clearly own public rate-limit DB writes

- Severity: Medium
- Confidence: Medium
- Source findings: `ARCH19-04`
- Cross-agent agreement: architect
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:547-584`, `apps/web/src/app/actions/public.ts:132-293`, `apps/web/src/lib/rate-limit.ts:480`, `apps/web/src/lib/background-db-writes.ts:42`
- Problem: restore drains known writers, but public actions can pass maintenance checks before restore flips and later perform persistent rate-limit writes outside the tracked background-writer boundary.
- Failure scenario: rate-limit DB writes race a restore/import window, causing noisy DB errors or state written against a transient/restored schema snapshot.
- Suggested fix: make persistent rate-limit storage restore-aware or participate in a foreground/public DB activity tracker.

### AGG-C19-18 - Docker native optional dependency pins are only partially lockfile-guarded

- Severity: Low
- Confidence: High
- Source findings: `ARCH19-05`
- Cross-agent agreement: architect
- Citations: `apps/web/Dockerfile:50`, `apps/web/Dockerfile:76`, `apps/web/src/__tests__/deploy-script-contract.test.ts:258-286`
- Problem: deploy contract tests only partially compare manually installed native package pins against `package-lock.json`.
- Failure scenario: a dependency upgrade leaves stale Dockerfile native pins that pass tests but fail container build or native binding runtime.
- Suggested fix: parse all manually installed native package tokens and compare versions to `package-lock.json` for both build and production stages.

### AGG-C19-19 - Cycle 18 release ledger is stale after the pushed commit

- Severity: Medium
- Confidence: High
- Source findings: `VER-C19-01`, `C19-CRIT-01`, `DOC-C19-02`
- Cross-agent agreement: verifier, critic, document-specialist
- Citations: `.context/plans/README.md:34-43`, `.context/plans/cycle-18-2026-07-08-plan.md:3-6`, `.context/plans/cycle-18-2026-07-08-plan.md:133-157`, `package.json:17-30`
- Problem: current HEAD is pushed Cycle 18 commit `6efd737b`, but the Cycle 18 plan/index still say commit/push/deploy finalization is in progress from older HEAD `a1863405`.
- Failure scenario: later agents cannot tell whether production is stale, repeat already-pushed work, or skip explicit deploy evidence.
- Suggested fix: mark commit/push complete and record deploy evidence or explicit deploy gap/supersession separately.

### AGG-C19-20 - Carry-forward register still has stale r10c4 age labels

- Severity: Medium
- Confidence: High
- Source findings: `VER-C19-02`, `DOC-C19-03`
- Cross-agent agreement: verifier, document-specialist
- Citations: `.context/plans/deferred-carry-forward.md:19-27`, `.context/plans/deferred-carry-forward.md:36-80`, `.context/plans/cycle-18-2026-07-08-plan.md:27-37`
- Problem: the carry-forward prose says run-10 c18, but the table header and some row ages remain keyed to run-10 c4.
- Failure scenario: old Medium/High rows can miss required 16-cycle or 8-cycle re-review because the register undercounts current age.
- Suggested fix: update labels/ages for the current cycle or split historical/current age columns.

### AGG-C19-21 - Old unindexed Cycle 19 plan files collide with the current cycle name

- Severity: Low-Medium
- Confidence: High
- Source findings: `DOC-C19-04`
- Cross-agent agreement: document-specialist
- Citations: `.context/plans/cycle-19-plan.md:1-58`, `.context/plans/cycle-19-deferred.md:1-26`, `.context/plans/README.md:34-43`, `.context/reviews/_aggregate.md:1-7`
- Problem: old `.context/plans/cycle-19-*` files from a different HEAD are unindexed and easy to mistake for the current Cycle 19 work.
- Failure scenario: a planner opens the stale file and uses wrong review provenance or deferred scope.
- Suggested fix: archive/rename with run/date prefix or add index entries marking the files historical.

### AGG-C19-22 - Admin photo management remains a horizontal table on narrow screens

- Severity: Medium
- Confidence: High
- Source findings: `C19-CRIT-11`, `DES-C19-02`
- Cross-agent agreement: critic, designer
- Citations: `apps/web/src/components/image-manager.tsx:427-604`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`
- Problem: the recent uploads manager is a wide table with horizontally separated preview, metadata, tags, and actions.
- Failure scenario: phone/tablet/split-screen admins lose row context and risk editing/deleting the wrong image.
- Suggested fix: add a responsive card/list workbench below wide desktop while keeping the table for dense desktop use.

### AGG-C19-23 - Admin navigation is one flat wrapping strip

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C19-03`
- Cross-agent agreement: designer
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-26`
- Problem: ten unrelated admin destinations render as peers in one wrapping strip.
- Failure scenario: translated/tablet layouts reshuffle high-risk operations and routine publishing links, breaking muscle memory.
- Suggested fix: group admin IA into stable sections and use a drawer/menu on smaller viewports.

### AGG-C19-24 - SEO settings validation is toast-only and not field-addressable

- Severity: Low-Medium
- Confidence: High
- Source findings: `DES-C19-04`, legacy `C96-09` lineage
- Cross-agent agreement: designer plus carry-forward register
- Citations: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-184`, `apps/web/src/app/actions/seo.ts:111-140`
- Problem: server-side field validation returns one toast message; fields do not get `aria-invalid`, persistent error text, or focus routing.
- Failure scenario: keyboard/screen-reader admins must infer and manually locate the invalid field after a transient toast.
- Suggested fix: return/map error codes to field keys and render field-level errors with focus on first invalid input.

### AGG-C19-25 - Password mismatch validation does not move focus to the invalid field

- Severity: Low
- Confidence: Medium-High
- Source findings: `DES-C19-05`
- Cross-agent agreement: designer
- Citations: `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:36-45`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:96-114`, `apps/web/src/__tests__/password-form-a11y.test.ts:10-18`
- Problem: mismatch sets an alert and `aria-invalid`, but focus remains on the submit/current control.
- Failure scenario: keyboard admins must manually locate the confirm field after the local validation error.
- Suggested fix: focus/select the confirm field on mismatch and extend the a11y test.

### AGG-C19-26 - Desktop photo metadata, color details, similar photos, and downloads are hidden by default

- Severity: Medium
- Confidence: High
- Source findings: `C19-CRIT-10`
- Cross-agent agreement: critic
- Citations: `apps/web/src/components/photo-viewer.tsx:111-115`, `apps/web/src/components/photo-viewer.tsx:747-800`, `apps/web/src/components/photo-viewer.tsx:965-1010`
- Problem: important trust/utility details sit behind a hidden info sidebar by default on desktop.
- Failure scenario: visitors miss download or color-management context and assume those features are unavailable.
- Suggested fix: revisit photo-page IA and consider a compact always-visible metadata/download rail or better default-open/first-use behavior.

### AGG-C19-27 - Topic slug is a mutable natural key with manual fan-out

- Severity: Medium
- Confidence: High
- Source findings: `C19-CRIT-05`
- Cross-agent agreement: critic
- Citations: `apps/web/src/db/schema.ts:10-39`, `apps/web/src/app/actions/topics.ts:287-372`
- Problem: topic identity is route slug and FK/JSON/analytics key; rename manually updates every known reference.
- Failure scenario: a new slug-bearing table or JSON field is missed and silently points to a deleted old slug.
- Suggested fix: move to surrogate topic IDs or add database-level cascades/central slug-reference registry tests.

### AGG-C19-28 - Browser and Lightroom upload paths duplicate one ingest transaction contract

- Severity: High
- Confidence: High
- Source findings: `C19-CRIT-03`
- Cross-agent agreement: critic
- Citations: `apps/web/src/app/actions/images.ts:129-620`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-620`
- Problem: two ingestion paths must preserve the same privacy/color/topic/quota/disk/restore/audit/queue invariants by duplicated code.
- Failure scenario: a new upload-time column or setting is added to one path and missed in the other, bypassing a privacy or processing invariant.
- Suggested fix: extract a shared ingest service with adapter-specific auth/parsing only.

### AGG-C19-29 - Upload quota settlement remains fragile control flow

- Severity: Medium
- Confidence: Medium-High
- Source findings: `C19-CRIT-04`
- Cross-agent agreement: critic
- Citations: `apps/web/src/app/actions/images.ts:259-269`, `apps/web/src/app/actions/images.ts:563-578`, `apps/web/src/lib/upload-tracker.ts:19-33`
- Problem: quota claim settlement depends on comments and hand-maintained early-exit cleanup paths.
- Failure scenario: a future throwing cleanup or new awaited branch leaks count/bytes for the one-hour upload window.
- Suggested fix: use an owned claim object or `try/finally` wrapper that settles exactly once from final success counters.

### AGG-C19-30 - IPv6 public clients can rotate rate-limit buckets

- Severity: Low-Medium
- Confidence: High
- Source findings: `C19-CRIT-09`
- Cross-agent agreement: critic
- Citations: `apps/web/src/lib/rate-limit.ts:135-205`
- Problem: full IPv6 addresses are used as rate-limit keys rather than configurable prefix coalescing.
- Failure scenario: an attacker rotates privacy addresses inside a delegated range to multiply public expensive-route budgets.
- Suggested fix: normalize IPv6 clients to an operator-configurable prefix, usually `/64`, or use stable edge-provided client identity.

### AGG-C19-31 - Production service-worker/PWA behavior lacks real browser install/offline coverage

- Severity: Medium
- Confidence: High
- Source findings: `TEST-C19-03`
- Cross-agent agreement: test-engineer
- Citations: `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`, `apps/web/src/__tests__/sw-cache.test.ts:1-14`
- Problem: service worker registration/cache/offline behavior is covered by unit/source contracts, not a production browser install/offline test.
- Failure scenario: generated `sw.js`, scope, cache headers, or offline route eligibility breaks while source/unit tests still pass.
- Suggested fix: add a production Playwright PWA spec with service-worker ready, CacheStorage assertions, offline toggle, and sensitive-route cache exclusions.

### AGG-C19-32 - Custom gate CLI discovery/exit wiring is mostly source-pinned

- Severity: Medium
- Confidence: Medium
- Source findings: `TEST-C19-04`
- Cross-agent agreement: test-engineer
- Citations: `apps/web/src/__tests__/check-api-auth.test.ts:127-132`, `apps/web/scripts/check-api-auth.ts:30-40`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:1317-1330`, `apps/web/scripts/check-public-route-rate-limit.ts:986-998`, `apps/web/src/__tests__/check-js-scripts-contract.test.ts:10-19`
- Problem: scanner fixture logic is strong, but CLI discovery/zero-file/exit-code paths are mainly checked by reading source.
- Failure scenario: a path constant, extension filter, or exit branch changes and skips real files while source-string tests still pass.
- Suggested fix: add fixture-root or injectable discovery helpers and spawn the CLIs against temp trees, asserting pass/fail output and exit codes.

### AGG-C19-33 - Visual E2E captures screenshots without comparing them

- Severity: Low
- Confidence: High
- Source findings: `TEST-C19-07`
- Cross-agent agreement: test-engineer
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Problem: visual-check screenshots are manual artifacts; no baseline or semantic visual assertion fails on visual regressions.
- Failure scenario: nav/header spacing or icon placement regresses while visibility, overlap, and touch target checks pass.
- Suggested fix: rename/report as smoke artifacts or add stable screenshot baselines for narrow header/nav states.

### AGG-C19-34 - Older broad deferred architecture issues remain live

- Severity: Mixed, up to High
- Confidence: High
- Source findings: repeated by critic and carry-forward register
- Cross-agent agreement: critic plus current `.context/plans/deferred-carry-forward.md`
- Citations: `.context/plans/deferred-carry-forward.md:36-170`, `plan/plan-377-cycle19-deferred.md:18-166`
- Problem: several broad items are known and still present: upload service extraction, source-contract retirement, admin redesign, schema/migration infrastructure, map clustering, semantic vector indexing, mobile/admin/browser coverage, and live-host validation.
- Failure scenario: repeated review cycles rediscover the same broad risks and either over-schedule too much at once or silently drop them.
- Suggested fix: preserve each item in the cycle deferred register with original severity/confidence, reason for deferral, exit criterion, and carry-forward lineage.

## Final Sweep

The aggregate ingested every requested per-agent file and deduped overlaps by behavior cluster. No agent failures occurred. Generated build output, `node_modules`, runtime upload/resource data, local secrets, and the unrelated untracked `.context/reviews/cycle-9-2026-07-08/` directory were not used as review sources.

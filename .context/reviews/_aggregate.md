# Cycle 15 Aggregate Review

Date: 2026-07-08 KST
Reviewed HEAD: `6256a988`
Repository: `/Users/hletrd/flash-shared/gallery`

## Recovery / Agent Coverage

This aggregate ingests the recovered partial Prompt 1 artifacts left by the stalled cycle 15 subagent. I preserved the existing review files and treated them as current-cycle inputs when they cited HEAD `6256a988` or cycle 15/current 2026-07-07 evidence.

Current recovered top-level reports:

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

Additional recovered current-cycle reports:

- `.context/reviews/cycle-8-2026-07-07/architect.md`
- `.context/reviews/cycle-8-2026-07-07/code-reviewer.md`
- `.context/reviews/cycle-8-2026-07-07/critic.md`
- `.context/reviews/cycle-8-2026-07-07/debugger.md`
- `.context/reviews/cycle-8-2026-07-07/designer.md`
- `.context/reviews/cycle-8-2026-07-07/document-specialist.md`
- `.context/reviews/cycle-8-2026-07-07/security-reviewer.md`
- `.context/reviews/cycle-8-2026-07-07/test-engineer.md`
- `.context/reviews/cycle-8-2026-07-07/tracer.md`
- `.context/reviews/cycle-8-2026-07-07/verifier.md`

Notes:

- The stale `_aggregate.md` previously pointed at Cycle 14 and is superseded by this file.
- Top-level `designer.md`, `product-marketer-reviewer.md`, and `ui-ux-designer-reviewer.md` predate this aggregate or cite older cycle numbers. Their already-recorded findings were considered for duplicate context, but the current designer lane is the recovered `cycle-8-2026-07-07/designer.md`.
- Native callable agent types in this session are `default`, `explorer`, and `worker`; specialty lanes were represented by recovered explicit reviewer briefs. Global BurstPick-specific reviewer prompt files exist under `~/.codex/agents`, but their mandatory source paths do not match this GalleryKit repo, so they were not treated as additional GalleryKit-registered reviewer roles.

## Summary

- Unique deduped findings: 58
- Confirmed issues or confirmed coverage/doc gaps: 42
- Likely issues: 8
- Risks requiring manual validation: 8
- Highest severity: High security/correctness/performance findings
- Cross-agent agreement is strongest on restore/auth mutation barriers, pending session revocation, single-writer/process-local topology, background capacity/backfill contention, Docker/native dependency gate gaps, and source-string-heavy test coverage.

## Confirmed Findings

### AGG-C15-01 - `login` is not covered by the restore-window admin mutation barrier

- Severity: High
- Confidence: High
- Cross-agent agreement: verifier; related to debugger/tracer restore-barrier findings
- Source findings: `VER-15-01`
- Citations: `CLAUDE.md:432-433`, `apps/web/src/lib/admin-mutation-barrier.ts:5-25`, `apps/web/src/app/[locale]/admin/db-actions.ts:520-531`, `apps/web/src/app/actions/auth.ts:79-84`, `apps/web/src/app/actions/auth.ts:131-143`, `apps/web/src/app/actions/auth.ts:193-232`, `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:13-47`
- Problem: `login` checks restore maintenance only at entry and then performs rate-limit, audit, session delete, and session insert writes without holding the foreground admin mutation slot drained by DB restore.
- Failure scenario: A login passes the initial maintenance check, restore starts and drains only slotted actions, then the login writes session/rate-limit rows into the restored database window.
- Suggested fix: Acquire an admin mutation slot before the first DB mutation in `login`, hold it through the session transaction, and add source/behavior coverage proving the ordering.

### AGG-C15-02 - Token-authenticated admin API requests can update `last_used_at` during DB restore

- Severity: High
- Confidence: High
- Cross-agent agreement: tracer; related restore-barrier class to verifier/debugger
- Source findings: tracer finding 1
- Citations: `apps/web/src/lib/api-auth.ts`, admin API route maintenance guards
- Problem: PAT/token auth can write token usage metadata before route-level restore maintenance checks run.
- Failure scenario: A token-authenticated admin API call during restore updates `admin_tokens.last_used_at` while the restore window is supposed to be drained of foreground writes.
- Suggested fix: Move restore admission/slot handling around token usage writes or defer `last_used_at` tracking through a restore-safe background write path.

### AGG-C15-03 - In-app color backfill trigger bypasses the restore foreground-mutation barrier

- Severity: High
- Confidence: High
- Cross-agent agreement: debugger; related to perf/architect background-capacity findings
- Source findings: `DBG15-01`
- Citations: `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/admin-backfill-runner.ts`
- Problem: Admin-triggered in-app color backfill is a mutating admin action path without the same foreground mutation-slot protection restore drains before import.
- Failure scenario: A backfill trigger admitted just before restore can enqueue/start writes while restore believes foreground admin mutations are drained.
- Suggested fix: Guard the action with `acquireAdminMutationSlot()` or move trigger state changes into a restore-aware background-write contract.

### AGG-C15-04 - `logout()` silently drops queued server-side revocation on genuine DB delete failure

- Severity: High
- Confidence: High
- Cross-agent agreement: cycle-8 code-reviewer, critic, test-engineer
- Source findings: `CR8-01`, `CRIT8-01`, `TEST8-01`
- Citations: `apps/web/src/app/actions/auth.ts:280-303`, `apps/web/src/lib/pending-session-revocations.ts`
- Problem: `logout` catches DB delete errors and still sets `revoked = true`, so the pending-session revocation queue is skipped after a transient DB failure.
- Failure scenario: A user logs out during a DB blip. The browser cookie is cleared, but the DB session row remains and the token stays server-verifiable until natural expiry.
- Suggested fix: Set `revoked = true` only after the DB delete actually succeeds; otherwise enqueue the hash for retry and add a behavior/source test.

### AGG-C15-05 - Restore image-queue quiesce has no bounded timeout

- Severity: High
- Confidence: High
- Cross-agent agreement: cycle-8 debugger; related restore-drain coverage gaps
- Source findings: `DBG8-02`
- Citations: `apps/web/src/lib/image-queue.ts:1255-1302`, `apps/web/src/app/[locale]/admin/db-actions.ts:497-509`, `apps/web/src/lib/background-db-writes.ts:90-110`, `apps/web/src/lib/maintenance-scheduler.ts:62-73`, `apps/web/src/lib/admin-mutation-barrier.ts:99-122`
- Problem: Restore waits on `queue.onIdle()` and side effects without a timeout, unlike sibling drains that abort restore on timeout.
- Failure scenario: A hung Sharp or CLIP inference job leaves restore awaiting forever with maintenance marker and locks active.
- Suggested fix: Add a bounded timeout to image-queue quiesce/drain and return a failure signal so restore aborts instead of hanging.

### AGG-C15-06 - Truncated ISOBMFF `iinf` boxes can make GPS stripping report "clean" instead of failing closed

- Severity: High
- Confidence: High
- Cross-agent agreement: cycle-8 debugger, test-engineer coverage gap
- Source findings: `DBG8-03`, `TEST8-04`
- Citations: `apps/web/src/lib/gps-exif-strip.ts:430-459`, GPS upload fail-closed paths
- Problem: The `iinf` parser computes entries start without validating enough bytes for the entry count, so a truncated item-info box can yield zero entries without setting the abort flag.
- Failure scenario: A structurally anomalous HEIC/HEIF/AVIF upload with GPS metadata is accepted as if it had no GPS, preserving the original file contrary to the fail-closed privacy contract.
- Suggested fix: Validate `iinf` content length before walking entries; set the partial-walk abort path on malformed lengths and add tests for truncated `iinf`.

### AGG-C15-07 - DB restore SQL scanner can skip bytes on short file reads

- Severity: High
- Confidence: Medium
- Cross-agent agreement: cycle-8 verifier, test-engineer related coverage gap
- Source findings: `VER8-02`, `TEST8-05`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:694-716`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`
- Problem: The restore scan loop advances by fixed `CHUNK_SIZE` even when `fd.read()` returns fewer bytes, so bytes between `off + bytesRead` and `off + CHUNK_SIZE` are never scanned.
- Failure scenario: A dangerous SQL statement entirely inside the skipped span bypasses the defense-in-depth scanner before import.
- Suggested fix: Advance by actual bytes consumed or loop until the requested chunk window is fully read; add a file-loop-level short-read regression test.

### AGG-C15-08 - Legitimate app-schema `DROP TABLE` can false-positive when split inside a table name

- Severity: Medium-High
- Confidence: High
- Cross-agent agreement: cycle-8 debugger, SQL scanner coverage findings
- Source findings: `DBG8-01`
- Citations: `apps/web/src/lib/sql-restore-scan.ts:35-38`, `apps/web/src/lib/sql-restore-scan.ts:279-315`, `apps/web/src/app/[locale]/admin/db-actions.ts:684-719`
- Problem: The synthetic newline inserted between rolling chunks can split an allowed app table name, preventing the allowlist mask from matching while the raw `DROP TABLE` detector still fires.
- Failure scenario: A valid own-schema dump with a chunk boundary inside a table identifier is rejected as disallowed SQL during disaster recovery.
- Suggested fix: Run masking over bridge-reconstructed text or make allowed app-table masking tolerant of one injected boundary separator.

### AGG-C15-09 - `deleteTopicAlias()` bypasses the topic route advisory lock

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: tracer
- Source findings: tracer finding 2
- Citations: `apps/web/src/app/actions/topics.ts`
- Problem: The delete-alias mutation appears to be the only route-segment mutation outside the topic-route advisory lock that protects create/update/delete/alias-create.
- Failure scenario: Concurrent alias deletion and topic/alias mutation can produce route revalidation or uniqueness/routing inconsistencies that sibling mutations serialize away.
- Suggested fix: Put `deleteTopicAlias()` under the same route-segment lock or document and test why it is safe without it.

### AGG-C15-10 - Byte-impacting settings commit before existing derivative bytes are regenerated

- Severity: Medium
- Confidence: High
- Cross-agent agreement: architect; previous cycle history
- Source findings: architect confirmed issue 1
- Citations: `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/src/lib/settings-hash.ts:1-20`, `apps/web/src/lib/settings-hash.ts:44-48`, `apps/web/src/lib/serve-upload.ts:240-258`, `apps/web/next.config.ts:60-72`, `apps/web/src/lib/process-image.ts:1187-1198`
- Problem: Settings that alter derivative bytes become persisted application truth before existing static files under `public/uploads` are regenerated.
- Failure scenario: New uploads reflect new color/quality policy while existing files keep old bytes, giving visitors mixed rendering after a successful settings save.
- Suggested fix: Introduce derivative generations/versioned paths or durable pending-regeneration state before presenting the policy as fully applied.

### AGG-C15-11 - Single-writer invariant is warn-only while correctness state is process-local

- Severity: High if scale-out occurs
- Confidence: High
- Cross-agent agreement: architect, critic, security-reviewer
- Source findings: architect confirmed issue 2, `C15-RISK-04`, `C15-SEC-RISK-03`
- Citations: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/rate-limit.ts`
- Problem: Multiple process-local correctness and limiter mechanisms assume one web instance, but the guard only logs on violation.
- Failure scenario: Two web containers split restore barriers, upload trackers, image-queue state, and memory-backed limiter budgets.
- Suggested fix: Make production readiness/startup fail on single-writer contention or move correctness-bearing state into shared durable coordination.

### AGG-C15-12 - Background image queue, in-app backfill, and sidecar backfill reserve capacity independently

- Severity: High
- Confidence: High
- Cross-agent agreement: perf-reviewer, architect
- Source findings: `PERF-C15-01`, `PERF-C15-02`, architect confirmed issue 3
- Citations: `apps/web/src/db/index.ts:21-41`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/admin-backfill-runner.ts:720-728`, `apps/web/scripts/backfill-color-pipeline.ts:383-387`, `apps/web/scripts/backfill-color-pipeline.ts:523-570`
- Problem: Each background subsystem reserves live DB headroom as if it is the only heavy background workload.
- Failure scenario: Upload processing, admin backfill, and sidecar backfill overlap and consume enough DB/CPU/disk capacity to starve live requests.
- Suggested fix: Centralize background capacity accounting and require an explicit maintenance/lease model for sidecar-heavy work.

### AGG-C15-13 - Sidecar color backfill bypasses the web pool budget

- Severity: High
- Confidence: High
- Cross-agent agreement: perf-reviewer; overlaps AGG-C15-12
- Source findings: `PERF-C15-02`
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:383-387`, `apps/web/scripts/backfill-color-pipeline.ts:523-570`, `apps/web/src/db/index.ts`
- Problem: The sidecar backfill opens its own workload outside the web process concurrency budget.
- Failure scenario: Operator runs the sidecar at default/raised concurrency during live traffic and competes with production requests for MySQL, CPU, and disk.
- Suggested fix: Add sidecar coordination with web backfill/queue leases and clearer safe-mode defaults.

### AGG-C15-14 - Public map can materialize and hydrate up to 10,000 markers plus duplicate accessible list rows

- Severity: High
- Confidence: High
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-03`
- Citations: public map route and map client/list rendering
- Problem: The map page sends and hydrates a large broad marker set plus a separate accessible list.
- Failure scenario: A large gallery map page becomes slow or memory-heavy on mobile/low-end devices.
- Suggested fix: Cluster/page markers, server-window by viewport or zoom, and virtualize the accessible list.

### AGG-C15-15 - Public dynamic route flood protection depends on live host nginx state not proven by deploy

- Severity: High if host config is stale
- Confidence: Medium
- Cross-agent agreement: architect, critic, security-reviewer
- Source findings: architect risk 1, `C15-RISK-01`, `C15-SEC-RISK-01`
- Citations: `apps/web/nginx/default.conf`, deploy helper docs, public dynamic routes
- Problem: Public SSR/image optimizer protection depends on the external nginx configuration being applied correctly; repo gates/deploy do not prove that live state.
- Failure scenario: Host nginx drifts or is bypassed and expensive public routes depend only on app-level controls.
- Suggested fix: Add a deploy/topology verification probe or health diagnostic that proves current edge behavior.

### AGG-C15-16 - Nginx multi-hop proxy comments contradict the tested client-IP contract

- Severity: Medium
- Confidence: High
- Cross-agent agreement: critic; related security risk
- Source findings: `C15-CRIT-01`
- Citations: `apps/web/nginx/default.conf`, rate-limit/client-IP docs
- Problem: Nginx comments still imply a multi-hop/append-mode model while the app/tests expect overwrite/normalized client IP behavior.
- Failure scenario: Operator follows stale comments and deploys a spoofable or collapsed rate-limit key topology.
- Suggested fix: Align comments and docs with the overwrite/real-IP contract.

### AGG-C15-17 - Production Docker image is not built by normal quality workflow

- Severity: Medium
- Confidence: High
- Cross-agent agreement: architect, critic
- Source findings: architect risk 2, `C15-CRIT-02`
- Citations: `.github/workflows/quality.yml`, `apps/web/Dockerfile`
- Problem: CI runs Next build but does not exercise the Dockerfile path that manually materializes Linux native packages.
- Failure scenario: Native dependency/version drift reaches production deploy despite green gates.
- Suggested fix: Add a non-publishing Docker build gate or derive Docker native package pins from the lockfile.

### AGG-C15-18 - Docker native-package pins duplicate lockfile versions and can drift

- Severity: Medium
- Confidence: High
- Cross-agent agreement: critic; overlaps AGG-C15-17
- Source findings: `C15-CRIT-02`
- Citations: `apps/web/Dockerfile`, `package-lock.json`
- Problem: Manual native package install pins in Dockerfile repeat package-lock state.
- Failure scenario: Dependency update changes Next/SWC/Sharp/Lightning CSS requirements but Dockerfile keeps stale pins.
- Suggested fix: Lock-test the pins or compute them from `package-lock.json` during Docker build.

### AGG-C15-19 - Public shared-group read helpers still have view-count write side effects

- Severity: Medium
- Confidence: High
- Cross-agent agreement: architect
- Source findings: architect confirmed issue 4
- Citations: shared-group data/view-count helpers
- Problem: A read helper path still performs view-count writes, crossing the read/write boundary and duplicating explicit analytics actions.
- Failure scenario: SSR/data fetches unexpectedly mutate state or race with analytics buffering.
- Suggested fix: Separate pure shared-group reads from explicit view-write actions.

### AGG-C15-20 - Public listing and smart-collection pages aggregate tags before applying the page limit

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-07`
- Citations: public listing/smart collection query paths
- Problem: Tag aggregation work is performed before page bounding.
- Failure scenario: Large galleries pay unnecessary aggregation cost for off-page rows.
- Suggested fix: Page IDs first, then aggregate tags for the bounded result set.

### AGG-C15-21 - Home page On This Day query is non-sargable on every dynamic render

- Severity: Medium
- Confidence: High
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-04`
- Citations: `apps/web/src/components/on-this-day-widget.tsx:15-22`, `getOnThisDayImages(...)`
- Problem: Home SSR uses month/day extraction over capture dates instead of an index-friendly lookup.
- Failure scenario: Gallery growth makes every dynamic home render scan more rows than needed.
- Suggested fix: Add indexed generated columns or precomputed month/day fields.

### AGG-C15-22 - Color-pipeline backfill candidate scans lack an index for `pipeline_version`

- Severity: Medium
- Confidence: High
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-05`
- Citations: color-pipeline backfill candidate query and schema/indexes
- Problem: Candidate selection is not indexed around the backfill filter.
- Failure scenario: Large galleries perform slow table scans to find backfill work.
- Suggested fix: Add an index appropriate to the backfill predicate and migration coverage.

### AGG-C15-23 - Batch deletion performs repeated full derivative-directory scans per image

- Severity: Medium
- Confidence: High
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-06`
- Citations: batch delete derivative cleanup helpers
- Problem: Bulk deletion repeats derivative directory scans for each image.
- Failure scenario: Large batch deletes become O(images * derivative-directory-size).
- Suggested fix: Batch/index cleanup by directory and filename prefix once per operation.

### AGG-C15-24 - Admin analytics fires five aggregation queries concurrently against the shared DB pool

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-08`
- Citations: admin analytics query path
- Problem: Admin analytics fans out concurrent heavy aggregate queries without shared pool budgeting.
- Failure scenario: Loading analytics competes with live requests and background jobs.
- Suggested fix: Sequence/cache aggregates or account them in a shared DB workload budget.

### AGG-C15-25 - Timeline year discovery uses `YEAR(capture_date)` on dynamic renders

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-09`
- Citations: timeline year query path
- Problem: Year extraction can defeat index usage.
- Failure scenario: Timeline navigation slows as rows grow.
- Suggested fix: Store/index capture year or use range scans.

### AGG-C15-26 - Public text search and smart-collection `contains` predicates remain scan-oriented

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-10`
- Citations: public search/smart collection query paths
- Problem: Bounded contains predicates still rely on scan-style matching.
- Failure scenario: Search latency grows with corpus size.
- Suggested fix: Add full-text/indexed search strategy or explicit operator limits/diagnostics.

### AGG-C15-27 - Semantic search brute-forces embedding blobs inside the web process

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: perf-reviewer, critic
- Source findings: `PERF-C15-11`, `C15-RISK-02`
- Citations: semantic search and similar-photo routes
- Problem: Routes read newest embedding blobs and score in the web process within a recency window.
- Failure scenario: Older relevant photos are missed and large candidate windows create request-time CPU/GC pressure.
- Suggested fix: Introduce vector indexing/ANN or expose the bounded-recall operational limitation.

### AGG-C15-28 - Large multipart uploads are constrained but still parsed through framework `FormData`

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: perf-reviewer
- Source findings: `PERF-C15-12`
- Citations: Lightroom/PAT upload route
- Problem: Large accepted uploads rely on framework multipart parsing rather than streaming.
- Failure scenario: Memory/latency spikes under concurrent large uploads.
- Suggested fix: Use a streaming multipart parser or keep strict admission and document memory envelope.

### AGG-C15-29 - Semantic embedding mode changes are not coordinated with long-running embedding writers

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: tracer; related semantic/perf findings
- Source findings: tracer finding 3
- Citations: embedding writer paths and settings/mode changes
- Problem: Long-running embedding writers can overwrite the single active row per image while semantic mode/model settings change.
- Failure scenario: Operators change semantic mode during a backfill and get mixed-version active embeddings.
- Suggested fix: Coordinate mode changes with backfill leases or versioned active-row transitions.

### AGG-C15-30 - Image queue claim-retry counter is not reset after a claimed job fails processing

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 code-reviewer
- Source findings: `CR8-02`
- Citations: `apps/web/src/lib/image-queue.ts:660-1065`
- Problem: Stale claim retry counts can carry into later processing retries after a successful claim followed by a processing failure.
- Failure scenario: Later claim-contention retries start at inflated backoff levels.
- Suggested fix: Clear claim retry counts once a claim succeeds, independent of processing retry scheduling.

### AGG-C15-31 - Upload route duplicates browser upload orchestration and has proven drift risk

- Severity: Medium
- Confidence: High
- Cross-agent agreement: cycle-8 architect
- Source findings: `ARCH8-01`
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/images.ts`
- Problem: Browser and PAT/Lightroom upload paths hand-mirror validation, locks, quota, metadata, GPS/HDR, DB insert, enqueue, audit, and revalidate behavior.
- Failure scenario: A future fix lands in one upload path but not the other, reopening privacy/quota/processing inconsistencies.
- Suggested fix: Extract shared upload orchestration or contract tests that compare both paths branch-for-branch.

### AGG-C15-32 - `quiesceImageProcessingQueueForRestore` resets embedding cursor id without paired model version

- Severity: Medium
- Confidence: High
- Cross-agent agreement: cycle-8 architect
- Source findings: `ARCH8-02`
- Citations: `apps/web/src/lib/image-queue.ts`
- Problem: Restore quiesce resets `embeddingScanCursorId` but not its paired `embeddingScanModelVersion`.
- Failure scenario: Post-restore embedding scans resume with mismatched cursor/model semantics.
- Suggested fix: Reset paired cursor and model-version state together.

### AGG-C15-33 - Single-writer guard boot-time reprobe does not re-arm itself

- Severity: Low-Medium
- Confidence: High
- Cross-agent agreement: cycle-8 debugger
- Source findings: `DBG8-04`
- Citations: `apps/web/src/lib/single-writer-guard.ts:238-269`, `apps/web/src/lib/single-writer-guard.ts:175-216`, `apps/web/src/lib/single-writer-guard.ts:99-112`
- Problem: Initial failed boot-time reprobe has no repeated retry path, unlike the lapse-recovery loop, and shared warning text overstates retry behavior.
- Failure scenario: A transient conflict or DB blip at the one reprobe point leaves diagnostics inert for process lifetime.
- Suggested fix: Reuse the reacquire scheduling path after reprobe contention/error and adjust warning text.

### AGG-C15-34 - Two `conn.release()` paths in upload-processing lock differ from the shared release discipline

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 critic/tracer evidence
- Source findings: `CRIT8-03`
- Citations: `apps/web/src/lib/upload-processing-contract-lock.ts:40`, `apps/web/src/lib/upload-processing-contract-lock.ts:68-72`
- Problem: Release/error handling is inconsistent inside one lock helper.
- Failure scenario: A rare release failure can return or dispose a connection differently from sibling advisory-lock helpers.
- Suggested fix: Normalize both paths through the shared pooled advisory-lock releaser.

### AGG-C15-35 - Restore scan FS read/stat/open errors can escape typed restore-result handling

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 debugger minor finding
- Source findings: `DBG8-05`
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:684-719`
- Problem: Some file-system errors in the SQL scan loop propagate as raw server-action failures instead of translated `RestoreResult` errors.
- Failure scenario: Rare backup file IO failure surfaces an inconsistent/ungraceful client error.
- Suggested fix: Catch scan file IO errors and return the same typed restore failure shape used by sibling branches.

### AGG-C15-36 - `restore-maintenance-durable` dirname helper mishandles a bare root path

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 debugger minor finding
- Source findings: `DBG8-05`
- Citations: `apps/web/src/lib/restore-maintenance-durable.ts`
- Problem: A path like `/marker.json` falls back to `'.'` instead of `'/'` in the test-only override branch.
- Failure scenario: A bare-root test marker path creates/reads in the wrong directory.
- Suggested fix: Treat slash index `0` as root directory.

### AGG-C15-37 - Service-worker LRU can record a zero-size entry through `recordAndEvict`

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 verifier
- Source findings: `VER8-03`
- Citations: `apps/web/src/lib/sw-cache.ts`, `apps/web/public/sw.template.js`
- Problem: `touchMeta` skips zero-size entries, but `recordAndEvict` can write `size: 0`.
- Failure scenario: A zero-byte cached derivative undercounts the LRU size cap.
- Suggested fix: Add the same zero-size guard to `recordAndEvict` in the reference and template.

### AGG-C15-38 - Legacy public-original startup guard only checks direct files

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: verifier
- Source findings: `VER-15-02`
- Citations: `CLAUDE.md:220`, `apps/web/src/lib/upload-paths.ts:173-188`, `apps/web/src/__tests__/upload-paths.test.ts:137-167`, `apps/web/nginx/default.conf:206-208`
- Problem: The guard proves no direct regular files under `public/uploads/original`, not recursive absence of content or symlinks.
- Failure scenario: Nested legacy originals remain in the public tree and are missed by startup validation.
- Suggested fix: Recursively `lstat` and reject any regular files/symlinks/non-empty legacy content, or document the narrower contract.

### AGG-C15-39 - Cycle 15 plan/review provenance pointed at a stale Cycle 14 aggregate

- Severity: Medium
- Confidence: High
- Cross-agent agreement: document-specialist; this aggregate fixes the primary stale file
- Source findings: `DOC-15-01`
- Citations: `.context/plans/cycle-15-plan.md:1-6`, `.context/plans/cycle-15-2026-06-30-deferred.md:1-16`, previous `.context/reviews/_aggregate.md:1-5`, `.context/plans/README.md:34-39`
- Problem: Cycle 15 planning/deferred files cited findings not present in the active aggregate.
- Failure scenario: Future cycles cannot trace `AGG-C15-*` IDs and may drop or duplicate findings.
- Suggested fix: Publish the Cycle 15 aggregate and update plan indexes/provenance.

### AGG-C15-40 - CLIP backfill script embedded production sidecar example is incomplete/stale

- Severity: Medium
- Confidence: High
- Cross-agent agreement: document-specialist
- Source findings: `DOC-15-02`
- Citations: `apps/web/scripts/backfill-clip-embeddings.ts`
- Problem: Embedded operator example does not fully match current production sidecar/env expectations.
- Failure scenario: Operator copies stale instructions and runs an incomplete CLIP backfill.
- Suggested fix: Update the script header/example to the current production runbook.

### AGG-C15-41 - Alt-text backfill header overstates inference cost and operator tunability

- Severity: Low
- Confidence: High
- Cross-agent agreement: document-specialist
- Source findings: `DOC-15-03`
- Citations: `apps/web/scripts/backfill-alt-text.ts`
- Problem: Script prose no longer accurately describes current inference cost/control.
- Failure scenario: Operator makes scheduling decisions from stale cost/tunability notes.
- Suggested fix: Align header comments with current implementation and knobs.

### AGG-C15-42 - Migrations 0028/0029 are undocumented in architecture docs

- Severity: Low
- Confidence: High
- Cross-agent agreement: cycle-8 document-specialist
- Source findings: `DOC8-01`
- Citations: migrations `0028`, `0029`, docs/CLAUDE schema sections
- Problem: New rate-limit/feed-ordering indexes are not reflected in relevant docs.
- Failure scenario: Maintainers miss why indexes exist or whether they are required.
- Suggested fix: Add concise docs for these migrations/indexes.

### AGG-C15-43 - Restore-window logout session-revocation queue is undocumented

- Severity: Low
- Confidence: High
- Cross-agent agreement: cycle-8 document-specialist; overlaps AGG-C15-04 behavior
- Source findings: `DOC8-02`
- Citations: `CLAUDE.md`, `apps/web/src/lib/pending-session-revocations.ts`, `apps/web/src/app/actions/auth.ts`
- Problem: Security/race-condition docs omit the pending session revocation queue.
- Failure scenario: Future maintainers do not know queued revocation is part of restore-window hygiene.
- Suggested fix: Document the queue and flush paths after behavioral fix.

### AGG-C15-44 - `site-config.json` supports undocumented `copyright`

- Severity: Low
- Confidence: High
- Cross-agent agreement: cycle-8 document-specialist
- Source findings: `DOC8-03`
- Citations: site config schema/usage and docs
- Problem: A supported config field is not documented.
- Failure scenario: Operators cannot discover Atom `<rights>`/copyright configuration.
- Suggested fix: Document the field in config examples/docs.

### AGG-C15-45 - `migrate.js` comment misstates the journal non-monotonic example date

- Severity: Low
- Confidence: High
- Cross-agent agreement: cycle-8 verifier
- Source findings: `VER8-01`
- Citations: `apps/web/scripts/migrate.js:769-770`, `apps/web/drizzle/meta/_journal.json`
- Problem: Comment says the example lands in 2026-04 while current journal timestamps land in 2026-05.
- Failure scenario: Maintainer doubts the migration explanation while debugging baseline behavior.
- Suggested fix: Correct the month or remove the specific month.

### AGG-C15-46 - CLAUDE.md omits this cycle's new subsystems

- Severity: Low
- Confidence: High
- Cross-agent agreement: cycle-8 critic
- Source findings: `CRIT8-05`
- Citations: `CLAUDE.md`, new advisory-lock release/pending-session revocation/watchdog subsystems
- Problem: Main architecture docs document comparable mechanisms but omit newly added subsystems.
- Failure scenario: Future changes miss required invariants for those helpers.
- Suggested fix: Add concise architecture notes after code fixes land.

### AGG-C15-47 - Nav visual E2E writes screenshots but cannot fail visual regressions

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Source findings: `TE15-01`
- Citations: `apps/web/e2e/nav-visual-check.spec.ts`
- Problem: The test captures screenshots as artifacts without assertions.
- Failure scenario: Navigation visual regressions produce different images but still pass.
- Suggested fix: Convert to screenshot assertions with baselines or rename as artifact-only.

### AGG-C15-48 - No coverage report, threshold, or changed-file coverage ratchet exists

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer; cycle-8 test-engineer related
- Source findings: `TE15-02`
- Citations: `apps/web/package.json`, `apps/web/vitest.config.ts`, `.github/workflows/quality.yml`
- Problem: The repo has no quantitative coverage signal for critical changed code.
- Failure scenario: High-risk branches land with only source-string tests or no behavior coverage.
- Suggested fix: Add non-blocking coverage first, then ratchet critical directories.

### AGG-C15-49 - Semantic scan caps are source-pinned instead of behavior-asserted

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: test-engineer
- Source findings: `TE15-03`
- Citations: semantic scan source tests and routes
- Problem: Tests pin source text rather than asserting behavior under saturated candidate windows.
- Failure scenario: Recall/cap semantics drift while source string checks pass or fail for the wrong reason.
- Suggested fix: Add route/behavior tests for cap saturation and diagnostics.

### AGG-C15-50 - High-value client interactions are still tested mostly through source strings

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Source findings: `TE15-04`, `TEST8-02`, `TEST8-03`, `TEST8-05`, `TEST8-06`, `TEST8-07`
- Citations: search status, load-more, map thumb wiring, upload quota, SW template, advisory-lock release tests
- Problem: Several UI/security/concurrency contracts are asserted by source text rather than runtime behavior.
- Failure scenario: Control flow breaks while copied strings remain.
- Suggested fix: Replace source-string tests with targeted behavior tests for each high-risk invariant.

### AGG-C15-51 - Password-change UI has no browser-level submit regression test

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Source findings: `TE15-05`
- Citations: password form/page and e2e suite
- Problem: Password-change behavior is not driven in a hydrated browser test.
- Failure scenario: Client validation/focus/submit flow breaks despite server/unit tests passing.
- Suggested fix: Add an admin Playwright flow for password change validation and submission.

### AGG-C15-52 - Service-worker registration is source-pinned, not browser-proven

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: test-engineer
- Source findings: `TE15-06`
- Citations: service-worker registration tests/source
- Problem: Registration behavior is not proven in a browser context.
- Failure scenario: PWA/service-worker wiring breaks while source tests pass.
- Suggested fix: Add a small browser smoke for registration/offline-cache eligibility.

### AGG-C15-53 - Playwright runs only Desktop Chrome

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Source findings: `TE15-07`
- Citations: `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`
- Problem: Required browser coverage does not include mobile WebKit or non-Chromium desktop smoke.
- Failure scenario: Safari/mobile or Firefox behavior regresses under green Chromium-only E2E.
- Suggested fix: Add a small required WebKit mobile and non-Chromium smoke matrix.

### AGG-C15-54 - Real CLIP encoder proof is manual/env-gated

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer
- Source findings: `TE15-08`
- Citations: `apps/web/src/__tests__/clip-offline-load.test.ts`, `apps/web/src/__tests__/clip-semantic-integration.test.ts`, `apps/web/package.json`
- Problem: Real production CLIP loading is skipped unless manual env/weights are present.
- Failure scenario: Model cache/layout or ONNX runtime break is not caught by normal gates.
- Suggested fix: Add scheduled/dependency-change preflight or marker policy for production semantic activation.

### AGG-C15-55 - DB child watchdog cleanup-after-timeout listener detachment lacks real call-site tests

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 critic/test-engineer
- Source findings: `CRIT8-04`, `TEST8-05`
- Citations: `apps/web/src/lib/db-child-watchdog.ts:57-62`, db action call sites
- Problem: Timeout cleanup/listener behavior is tested weakly relative to restore/backup call sites.
- Failure scenario: Watchdog event cleanup regresses and source-oriented tests miss the call-site behavior.
- Suggested fix: Add call-site/injected child-process tests.

### AGG-C15-56 - `createPooledAdvisoryLockReleaser` staged partial-failure path is untested

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: cycle-8 test-engineer
- Source findings: `TEST8-07`
- Citations: `apps/web/src/lib/advisory-lock-release.ts`
- Problem: Multi-lock partial release failure behavior lacks a direct behavior test.
- Failure scenario: A future staged release refactor mishandles destroy/release on partial failures.
- Suggested fix: Add unit tests for staged multi-lock partial failure.

### AGG-C15-57 - Admin image management table and tag autocomplete still have photo-workbench UX issues

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: stale top-level designer/UI prompt context; current designer lane did not add a new defect
- Source findings: prior top-level `designer.md`, `ui-ux-designer-reviewer.md`
- Citations: `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/tag-input.tsx`, admin dashboard/table layout
- Problem: Existing UI review artifacts still document table-first admin photo management and potential tag autocomplete clipping.
- Failure scenario: Admin batch metadata cleanup remains inefficient on constrained viewports.
- Suggested fix: Treat as existing UX backlog unless a current browser-admin lane reconfirms it with authenticated runtime evidence.

### AGG-C15-58 - Process/documentation overhead has grown large relative to product scope

- Severity: Informational
- Confidence: n/a
- Cross-agent agreement: cycle-8 critic
- Source findings: `CRIT8-06`
- Citations: `.context/reviews/**`, `.context/plans/**`
- Problem: Review/plan artifact volume is high and can make current state hard to navigate.
- Failure scenario: Future agents waste time reconciling stale artifacts or re-open fixed work.
- Suggested fix: Keep indexes current and archive completed plans/reviews in a consistent cycle closure step.

## Risks / Manual Validation Notes

The following findings above require live or operator validation before claiming production impact, but they are still recorded with original severity/confidence and must not be silently dropped: AGG-C15-15, AGG-C15-26, AGG-C15-27, AGG-C15-28, AGG-C15-29, AGG-C15-38, AGG-C15-53, AGG-C15-54.

## AGENT FAILURES / DEVIATIONS

- The prior cycle 15 subagent stalled after writing partial artifacts; this aggregate completes the missing merge step from recovered files.
- Native callable subagent roles are only `default`, `explorer`, and `worker`; no separately callable `code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, or `designer` agent types were exposed by `multi_agent_v1`.
- The installed global `product-marketer-reviewer` and `ui-ux-designer-reviewer` prompt files are BurstPick-specific and not repo-local GalleryKit agents. Existing GalleryKit-adapted artifacts from those prompts were considered for stale-context duplicate detection, but they were not re-run as current GalleryKit-specific registered agents.

## Disposition Guidance For Prompt 2

Security, correctness, privacy, restore/data-loss, and auth/session findings should be scheduled unless a repo rule explicitly permits deferral. Performance, UX, documentation, coverage, and operator-validation risks may be deferred only with preserved severity/confidence, file+line citation, reason, and reopen criterion.

# Cycle 21 Aggregate Review

Review HEAD: `45b32d1db373e03d82a29511f53832051c770880`

## Review Lanes

All requested and registered reviewer lanes returned and wrote provenance files:

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

No agent failures were reported. The native subagent surface only exposed generic/default worker types rather than named reviewer types, so the named lanes were run as role-scoped default agents. The registered reviewer-style files in `~/.codex/agents` were stale for another project and were adapted only as review perspectives.

## Consolidated Findings

### AGG-C21-01 - Mutation-barrier lint accepts the acquired check after a mutation

- Severity: High
- Confidence: High
- Sources: `verifier`
- Cross-agent signal: single high-confidence lane with executable reproduction.
- Regions: `apps/web/scripts/check-action-origin.ts:628-678`; `apps/web/src/__tests__/check-action-origin.test.ts:624-738`; `.context/plans/cycle-20-2026-07-08-plan.md:49-54`
- Problem: `bodyAcquiresAdminMutationSlot()` accepts any later `mutationSlot.acquired` check after the `using` declaration. It does not prove the acquired early-return check happens before the first DB/server mutation.
- Failure scenario: a future admin action mutates the DB while restore maintenance is active, checks `!mutationSlot.acquired` afterward, and still passes `npm run lint:action-origin`.
- Suggested fix: make the scanner reason about statement order. Require the early-return acquired check immediately after the `using` declaration before any mutation marker/protected call, or require all mutations to be lexically contained in an acquired branch. Add a negative fixture with mutation before the acquired check.

### AGG-C21-02 - Image deletion can leave public files orphaned after returning success

- Severity: High
- Confidence: High
- Sources: `architect`
- Cross-agent signal: single high-confidence lane; data-loss/privacy-adjacent correctness issue.
- Regions: `apps/web/src/app/actions/images.ts:719-756`; `apps/web/src/lib/upload-paths.ts:101-117`; `apps/web/src/lib/process-image.ts:621-640`; `apps/web/next.config.ts:60-77`; `apps/web/nginx/default.conf:210-226`
- Problem: `deleteImage` removes DB rows first and logs cleanup failures after success. Once the row is gone, there is no durable cleanup ledger or retry path for originals or public derivatives.
- Failure scenario: a transient filesystem permission or read-only error leaves an original or derivative on disk. The UI reports success, paths are revalidated, and a known public derivative URL can keep serving bytes from `public/uploads`.
- Suggested fix: add a durable deletion outbox/tombstone or mark rows as deleting before cleanup. Retry until all file deletion succeeds, and make admin success reflect the durable deletion state. Consider moving derivatives behind app-controlled serving or checking tombstones before static bytes can be returned.

### AGG-C21-03 - Browser and PAT upload paths duplicate one ingest transaction contract

- Severity: High
- Confidence: High
- Sources: `code-reviewer`, `critic`
- Cross-agent signal: 2 lanes agree.
- Regions: `apps/web/src/app/actions/images.ts:129-270`; `apps/web/src/app/actions/images.ts:377-560`; `apps/web/src/app/actions/images.ts:540-578`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`; `apps/web/src/app/api/admin/lr/upload/route.ts:254-630`
- Problem: Browser uploads and Lightroom/PAT uploads separately implement config snapshotting, quota settlement, topic/tag validation, original persistence, GPS/HDR handling, DB insert, queue payloads, audit, revalidation, and cleanup.
- Failure scenario: a new upload-time invariant lands in one adapter only, silently diverging privacy, color/HDR, alt-text, audit, queue, or cleanup behavior.
- Suggested fix: extract a shared authenticated ingest service that owns the transaction-level contract, leaving only transport/auth/response shaping in the Server Action and Route Handler. Add parity tests that assert identical inserted columns and queue jobs for the same synthetic image metadata.

### AGG-C21-04 - Large binary ingress materializes framework multipart bodies before streaming checks

- Severity: High
- Confidence: High for source shape; Medium for live impact without RSS traces
- Sources: `code-reviewer`, `critic`, `perf-reviewer`, `debugger`
- Cross-agent signal: 4 lanes agree.
- Regions: `apps/web/src/app/actions/images.ts:129-149`; `apps/web/src/app/api/admin/lr/upload/route.ts:174-188`; `apps/web/src/app/[locale]/admin/db-actions.ts:407-420`; `apps/web/src/app/[locale]/admin/db-actions.ts:717-729`; `apps/web/next.config.ts:111-119`; `apps/web/src/lib/upload-limits.ts:1-35`; `apps/web/src/components/upload-dropzone.tsx:243-260`
- Problem: large browser uploads, PAT uploads, and DB restores enter app logic as parsed `FormData`/`File` objects. App caps and stream-to-disk logic run after framework multipart parsing/materialization.
- Failure scenario: near-limit 200-250 MiB uploads/restores can spike RSS, GC, temp usage, or OOM on the single web process before domain-level streaming and quota checks get control.
- Suggested fix: move large payload paths to streaming Route Handlers with auth/origin checks, `Content-Length` prechecks, per-part and total caps, a shared large-body semaphore, temp-file handoff, and shared ingest/restore services. Add production-like RSS smoke coverage.

### AGG-C21-05 - Image queue and admin backfill can overcommit the shared DB/CPU pool

- Severity: High
- Confidence: High
- Sources: `perf-reviewer`, `critic`, `architect`, `code-reviewer`
- Cross-agent signal: 4 lanes agree.
- Regions: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/image-queue.ts:746-883`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`; `apps/web/src/lib/admin-backfill-runner.ts:393-431`; `apps/web/src/lib/admin-backfill-runner.ts:520-565`; `apps/web/src/lib/admin-backfill-runner.ts:716-820`; `apps/web/src/lib/process-image.ts:36-57`; `apps/web/src/lib/process-image.ts:1205-1418`
- Problem: the upload image queue and in-app admin backfill each compute safe concurrency against the same 10-connection pool and native CPU budget, but neither subtracts the other background consumer.
- Failure scenario: active upload processing plus an admin re-encode can pin most pool connections and oversubscribe Sharp/libvips work. Public SSR/search/admin requests queue behind background maintenance despite each lane looking locally bounded.
- Suggested fix: introduce one process-wide background resource budget shared by queue processing, admin backfill, embedding bootstrap, and heavyweight side effects, or make admin backfill pause/refuse while queue workers are active. Add a combined-budget contract test.

### AGG-C21-06 - Claim-exhausted image jobs bypass the permanent-failure cap

- Severity: Medium
- Confidence: High
- Sources: `code-reviewer`, `critic`
- Cross-agent signal: 2 lanes agree.
- Regions: `apps/web/src/lib/image-queue.ts:112-113`; `apps/web/src/lib/image-queue.ts:320-326`; `apps/web/src/lib/image-queue.ts:756-768`; `apps/web/src/lib/image-queue.ts:1025-1042`; `apps/web/src/lib/image-queue.ts:1155-1157`
- Problem: the normal permanent-failure path enforces FIFO eviction and retry-map cleanup, but claim exhaustion directly calls `state.permanentlyFailedIds.add(job.id)` without the cap/cleanup logic.
- Failure scenario: lock anomalies or repeated claim contention can grow the process-local set beyond `MAX_PERMANENTLY_FAILED_IDS` and make bootstrap build an ever-growing `NOT IN (...)` predicate.
- Suggested fix: route every permanent-failure add through one helper such as `markPermanentlyFailed(state, id)` that enforces the cap and cleans retry maps. Add a behavior test for claim exhaustion past the cap.

### AGG-C21-07 - Safety-critical tests overfit source text instead of runtime behavior

- Severity: High
- Confidence: High
- Sources: `critic`, `test-engineer`
- Cross-agent signal: 2 lanes agree.
- Regions: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`; `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:31-63`; `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`; `apps/web/scripts/migrate.js:348-493`
- Problem: migration reconcile, semantic scan, and other high-risk invariants are pinned mainly by source-string tests. They do not prove SQL shape, type/default equivalence, execution ordering, or runtime failure behavior.
- Failure scenario: a refactor preserves strings/imports while changing behavior; source tripwires stay green while fresh installs, migrations, or routes fail at runtime.
- Suggested fix: keep source tripwires as cheap lint-like checks, but add DB-backed reconcile/schema tests, behavioral route tests for scan caps, and executable child-process tests for backup/restore failure paths.

### AGG-C21-08 - Reconcile schema coverage is name-presence only

- Severity: High
- Confidence: High
- Sources: `test-engineer`, `critic`
- Cross-agent signal: 2 lanes agree; subset of AGG-C21-07 but kept separately because it targets a historically production-breaking path.
- Regions: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`; `apps/web/scripts/migrate.js:348-493`
- Problem: the reconcile coverage test explicitly cannot verify column types, nullability, defaults, FK actions, index column order, charset, or collation.
- Failure scenario: a migration changes schema semantics while names remain present in `migrate.js`, so a reconcile-baselined DB diverges from Drizzle and fails later.
- Suggested fix: add a disposable-MySQL integration gate that runs reconcile/baseline, then diffs `INFORMATION_SCHEMA.COLUMNS`, `STATISTICS`, and FK metadata against the current schema/migration contract.

### AGG-C21-09 - Backup/restore child-process paths are source-pinned, not execution-tested

- Severity: High
- Confidence: Medium
- Sources: `test-engineer`, `critic`
- Cross-agent signal: 2 lanes agree as test-risk/hardening.
- Regions: `apps/web/src/__tests__/db-restore.test.ts:47-136`; `apps/web/src/app/[locale]/admin/db-actions.ts:157-405`; `apps/web/src/app/[locale]/admin/db-actions.ts:740-860`
- Problem: critical guarantees around `mysqldump`/`mysql` spawn ordering, temp-file finalization, trailer validation, timeout cleanup, post-restore failure handling, and advisory-lock release are mainly source-position assertions.
- Failure scenario: a refactor preserves expected strings while breaking stream settlement, child close/error ordering, cleanup, or migration failure handling.
- Suggested fix: add a stub-binary integration harness with fake `mysqldump`/`mysql` on `PATH`, covering success, nonzero exit, timeout, bad header/trailer, write/stdin errors, post-restore migration failure, and release failure.

### AGG-C21-10 - Public dynamic surfaces concentrate request-local DB/CPU/client work

- Severity: Medium
- Confidence: High
- Sources: `critic`, `perf-reviewer`, `code-reviewer`
- Cross-agent signal: 3 lanes agree; overlaps detailed map/search/vector findings below.
- Regions: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1488-1551`; `apps/web/src/lib/data.ts:1574-1749`; `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/app/[locale]/(public)/map/page.tsx:13-111`; `apps/web/src/lib/smart-collections.ts:221-267`
- Problem: keyword search, vector scoring, map marker rendering, and smart-collection predicates all perform bounded but potentially heavy work inside public request paths.
- Failure scenario: corpus growth or a small public traffic burst within rate limits consumes MySQL CPU, Node heap/CPU, and mobile client resources on the same single process that serves normal traffic and background work.
- Suggested fix: move keyword search to an indexed surface, isolate vector search behind ANN/cache/worker resources, make map viewport/bbox-clustered, and classify or materialize expensive public smart collections.

### AGG-C21-11 - Public map can ship and hydrate 10,000 markers and fallback links

- Severity: Medium
- Confidence: High
- Sources: `perf-reviewer`, `code-reviewer`, `critic`
- Cross-agent signal: 3 lanes agree.
- Regions: `apps/web/src/lib/data.ts:1766-1817`; `apps/web/src/db/schema.ts:49-50`; `apps/web/src/db/schema.ts:123-131`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`; `apps/web/src/components/map/map-client.tsx:77-140`
- Problem: `/map` can serialize 10,000 markers, SSR 10,000 accessible list links, compute array bounds, and render one Leaflet marker per row, with no latitude/longitude-specific index.
- Failure scenario: a location-rich gallery creates a large RSC/HTML payload and main-thread Leaflet work that causes slow first interaction and mobile jank.
- Suggested fix: lower initial cap, serve map data by viewport/bbox/tile endpoint, add clustering, virtualize/paginate the accessible list, and add an index matching public map filters if the full-map endpoint remains.

### AGG-C21-12 - Home on-this-day widget runs a non-sargable date scan on every dynamic home render

- Severity: Medium
- Confidence: High
- Sources: `perf-reviewer`
- Cross-agent signal: single lane.
- Regions: `apps/web/src/components/on-this-day-widget.tsx:10-22`; `apps/web/src/app/[locale]/(public)/page.tsx:232-235`; `apps/web/src/lib/data-timeline.ts:102-130`; `apps/web/src/db/schema.ts:123-131`
- Problem: `getOnThisDayImages()` filters with `MONTH(images.capture_date)` and `DAY(images.capture_date)`, so the existing `processed, capture_date, created_at` index cannot seek the date.
- Failure scenario: every dynamic home render over a large dated corpus scans processed rows, aggregates tags, groups, orders, and returns only six photos.
- Suggested fix: add generated/stored `capture_month` and `capture_day` columns plus an index, or use a daily cache/materialized table invalidated by metadata changes.

### AGG-C21-13 - Public keyword search uses leading-wildcard scans

- Severity: Medium
- Confidence: High
- Sources: `perf-reviewer`, `critic`
- Cross-agent signal: 2 lanes agree.
- Regions: `apps/web/src/app/actions/public.ts:248-317`; `apps/web/src/lib/data.ts:1574-1655`; `apps/web/src/lib/data.ts:1693-1737`; `apps/web/src/lib/smart-collections.ts:221-223`; `apps/web/src/lib/smart-collections.ts:261-267`
- Problem: public search and smart-collection `contains` predicates use `%term%` predicates across multiple fields and relationships.
- Failure scenario: accepted common substring searches can scan large portions of `images`, `topics`, `tags`, and `image_tags`, competing with dynamic SSR and background work.
- Suggested fix: move to MySQL FULLTEXT/ngram, a materialized token/search-document table, or a dedicated search index. Short-term: raise minimum keyword length, cache hot queries, add statement timeouts, and warn/reject expensive public smart-collection predicates.

### AGG-C21-14 - Semantic and similar-photo routes score embedding scans synchronously in Node

- Severity: Low
- Confidence: High
- Sources: `perf-reviewer`, `code-reviewer`, `critic`
- Cross-agent signal: 3 lanes agree as bounded residual risk.
- Regions: `apps/web/src/lib/clip-embeddings.ts:36-48`; `apps/web/src/lib/clip-embeddings.ts:80-87`; `apps/web/src/lib/clip-embeddings.ts:188-235`; `apps/web/src/db/schema.ts:292-304`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:178-214`
- Problem: vector routes load embedding blobs from MySQL, decode them in JS, compute dot products synchronously, and top-k locally in the same Node process.
- Failure scenario: accepted semantic/similar requests consume DB bandwidth, heap, and event-loop CPU while uploads/backfills/SSR are active.
- Suggested fix: add a process-wide semantic scoring semaphore and telemetry. For larger galleries, move to ANN/index/service or a process-owned preloaded matrix with explicit invalidation; otherwise chunk/yield or use worker threads.

### AGG-C21-15 - Pipeline backfill selection has no supporting index

- Severity: Medium
- Confidence: High
- Sources: `architect`
- Cross-agent signal: single lane.
- Regions: `apps/web/src/db/schema.ts:82-131`; `apps/web/src/lib/admin-backfill-runner.ts:393-431`; `apps/web/scripts/backfill-color-pipeline.ts:373-379`
- Problem: both in-app and sidecar backfills select `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT)` without an index including `pipeline_version`.
- Failure scenario: a large gallery upgrade repeatedly scans many processed rows during an already CPU-heavy maintenance operation.
- Suggested fix: add a migration for an index such as `(processed, pipeline_version, id)` or a generated candidate marker, and include EXPLAIN/source-contract coverage that backfill predicates remain indexable.

### AGG-C21-16 - Cached shared-group reader owns a view-count side effect

- Severity: Medium
- Confidence: Medium
- Sources: `code-reviewer`, `critic`
- Cross-agent signal: 2 lanes agree.
- Regions: `apps/web/src/lib/data.ts:49-63`; `apps/web/src/lib/data.ts:1392-1407`; `apps/web/src/lib/data.ts:1830-1834`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`; `apps/web/src/app/actions/public.ts:517-559`
- Problem: `getSharedGroupCached = cache(getSharedGroup)` wraps a function that can buffer `view_count` mutations depending on options, while durable analytics are recorded elsewhere.
- Failure scenario: future render/preload calls with different option shapes cause React cache call-order and argument semantics to decide whether the denormalized count side effect runs.
- Suggested fix: split `getSharedGroup` into a pure cached reader plus explicit page/action orchestration for `bufferSharedGroupViewCount`. Add a test that cached reads are side-effect-free.

### AGG-C21-17 - Current Cycle 20 ledger still records final docs/deploy step as pending

- Severity: Medium
- Confidence: High
- Sources: `critic`, `verifier`
- Cross-agent signal: 2 lanes agree.
- Regions: `.context/plans/cycle-20-2026-07-08-plan.md:3`; `.context/plans/cycle-20-2026-07-08-plan.md:131-163`; `.context/plans/README.md:36-37`; commit `45b32d1d`
- Problem: the active Cycle 20 plan records the source-fix commit as deployed, but the terminal docs-ledger commit `45b32d1d` remains unchecked/pending and its commit trailer says post-docs deploy runs after the commit.
- Failure scenario: future cycles treat Cycle 20 as fully deployed from the index while the authoritative plan still has an unfinished deploy/smoke item.
- Suggested fix: update the Cycle 20 plan with explicit `45b32d1d` push/deploy/smoke evidence, or state the docs commit was not deployed and this cycle's deploy supersedes it. Add a ledger check that current HEAD appears in terminal deploy evidence before marking a cycle complete.

### AGG-C21-18 - Carry-forward age accounting is stale enough to disable age-budget policy

- Severity: Medium
- Confidence: High
- Sources: `critic`
- Cross-agent signal: single lane.
- Regions: `.context/plans/README.md:16-32`; `.context/plans/deferred-carry-forward.md:19-27`; `.context/plans/deferred-carry-forward.md:56-84`; `.context/plans/deferred-carry-forward.md:140-220`
- Problem: the carry-forward register lists older run-10 deferred rows with ages that do not match the current active cycle, undermining the 8-cycle High and 16-cycle Medium checkpoint policy.
- Failure scenario: old High/Medium findings can be repeatedly re-listed without tripping the checkpoint because the mechanical table says they are below threshold.
- Suggested fix: recompute ages from first-deferred cycle to current active cycle, derive age mechanically where possible, and re-run checkpoint decisions for rows crossing thresholds.

### AGG-C21-19 - Public SSR and image flood protection depends on manually applied nginx config

- Severity: Medium
- Confidence: High for repo/deploy mismatch; Medium for live exposure
- Sources: `security-reviewer`, `critic`, `architect`, `code-reviewer`
- Cross-agent signal: 4 lanes agree.
- Regions: `CLAUDE.md:247`; `CLAUDE.md:510-522`; `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:246-306`; `apps/web/deploy.sh:51-108`; `scripts/deploy-remote.sh:31-93`
- Problem: public page and image-optimizer protection is in the committed nginx template, but normal `npm run deploy` rebuilds the app container and does not validate/reload host nginx.
- Failure scenario: production host nginx is stale or replaced by another proxy, so dynamic public routes and `/_next/image` receive flood traffic without the expected edge limiter.
- Suggested fix: add deploy-time read-only nginx config/version probes or a required operator verification artifact, and consider a cheap app-layer fallback limiter where edge state cannot be proven.

### AGG-C21-20 - Client-IP security controls depend on proxy topology and X-Forwarded-For correctness

- Severity: Medium
- Confidence: High for code property; Medium for exploitability until production is validated
- Sources: `security-reviewer`
- Cross-agent signal: single lane.
- Regions: `apps/web/docker-compose.yml:15-23`; `apps/web/src/lib/rate-limit.ts:175-214`; `apps/web/nginx/default.conf:20-28`; `apps/web/nginx/default.conf:59-71`; `CLAUDE.md:97-98`; `CLAUDE.md:748`
- Problem: app and edge rate limits depend on proxy trust and right-anchored `X-Forwarded-For` matching the deployed topology.
- Failure scenario: a CDN/LB in front of nginx can collapse all visitors into one address or make telemetry/rate budgets misleading, causing collateral 429s or weakened throttling.
- Suggested fix: verify live request traces from edge through nginx to `getClientIp`; configure `real_ip`/PROXY protocol or append-mode XFF and set `TRUSTED_PROXY_HOPS` correctly. Add a startup/health diagnostic for suspicious shared proxy addresses.

### AGG-C21-21 - Multi-instance deployments weaken process-local coordination while singleton guard is warn-only

- Severity: Medium
- Confidence: High for code behavior; Medium for exploitability under documented single-instance topology
- Sources: `security-reviewer`, `architect`
- Cross-agent signal: 2 lanes agree.
- Regions: `CLAUDE.md:244-248`; `apps/web/src/lib/single-writer-guard.ts:6-21`; `apps/web/src/lib/single-writer-guard.ts:218-235`; `apps/web/src/lib/rate-limit.ts:299-427`; `apps/web/src/lib/pending-session-revocations.ts:17-24`; `apps/web/src/lib/admin-mutation-barrier.ts:6-31`; `apps/web/src/lib/restore-drain-checklist.ts:10-17`; `apps/web/src/app/[locale]/admin/db-actions.ts:580-635`
- Problem: the guard detects multi-instance contention but continues startup. Several correctness and throttling mechanisms are process-local.
- Failure scenario: accidental scale-out or overlapping deploys multiply in-memory rate budgets and can leave restore drains/session revocations/upload quota tracking inconsistent.
- Suggested fix: keep production single-instance. For current product, consider failing closed in production on confirmed singleton-lock contention unless an explicit emergency override is set; for multi-instance, move controls to shared durable state.

### AGG-C21-22 - DB backups are plaintext SQL at rest and restores are DB-only

- Severity: Low for plaintext-at-rest boundary; High as DB-only restore product/operator risk
- Confidence: High
- Sources: `security-reviewer`, `architect`
- Cross-agent signal: 2 lanes agree.
- Regions: `CLAUDE.md:226-227`; `apps/web/src/app/api/admin/db/download/route.ts:21-89`; `apps/web/src/app/[locale]/admin/db-actions.ts:420-955`; `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:177-245`; `apps/web/messages/en.json:21-26`; `apps/web/docker-compose.yml:24-32`; `apps/web/src/app/actions/images.ts:377-527`
- Problem: DB dumps are plaintext SQL on disk by design, and app restore covers database rows but not originals, derivatives, or resources in bind mounts.
- Failure scenario: host/storage compromise exposes SQL contents. DB-only restore can reintroduce rows for missing files or leave orphan files uploaded after the dump.
- Suggested fix: encrypt backup artifacts at rest and define retention/rotation. Decide whether backup/restore remains DB-only with paired host-level filesystem restore runbooks, or add an application-level file manifest/snapshot/reconciliation verifier.

### AGG-C21-23 - Multiple root admins remain single-factor and root-equivalent

- Severity: Low
- Confidence: High
- Sources: `security-reviewer`
- Cross-agent signal: single lane.
- Regions: `CLAUDE.md:248`; `CLAUDE.md:649-650`; `apps/web/src/app/actions/auth.ts:79-160`; `apps/web/src/app/actions/auth.ts:226-253`; `apps/web/src/lib/api-auth.ts:66-152`
- Problem: every admin browser session is root-equivalent, with no second factor, step-up prompt, or role boundary for backup/restore/settings/user management.
- Failure scenario: a compromised admin password, session, or browser can perform destructive root operations.
- Suggested fix: preserve the current documented model unless product scope changes; if risk appetite changes, add 2FA/WebAuthn and step-up auth for high-impact actions.

### AGG-C21-24 - Advisory lock names are server-scoped and can collide across co-located galleries

- Severity: Medium
- Confidence: High
- Sources: `architect`
- Cross-agent signal: single lane.
- Regions: `apps/web/src/lib/advisory-locks.ts:10-72`; `apps/web/src/lib/image-queue.ts:752-780`
- Problem: most advisory lock names are global constants in MySQL's server-wide lock namespace; only the single-writer liveness lock is DB-scoped.
- Failure scenario: two GalleryKit databases on one MySQL server serialize restores/backfills/upload-contract operations, and per-image locks collide by image ID across databases.
- Suggested fix: either enforce one GalleryKit per MySQL server, or prefix non-liveness advisory locks with a stable per-instance/DB hash.

### AGG-C21-25 - Archive/timeline/on-this-day rendering parses MySQL datetimes with JavaScript `Date`

- Severity: Low
- Confidence: Medium
- Sources: `debugger`
- Cross-agent signal: single lane.
- Regions: `apps/web/src/lib/data-timeline.ts:247-256`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:99-108`; `apps/web/src/components/on-this-day-widget.tsx:50-52`; `apps/web/src/__tests__/data-timeline.test.ts:127-138`; `apps/web/src/__tests__/data-timeline.test.ts:195-199`
- Problem: grouping/labeling uses `new Date()` on MySQL-style `YYYY-MM-DD HH:mm:ss`, which is not a strict ECMAScript interchange format.
- Failure scenario: runtime differences, future Edge migration, or malformed imports can drop photos from month sections or render invalid years.
- Suggested fix: add a shared persisted-EXIF/MySQL datetime parser using regex/string slicing and reuse it in timeline/year/on-this-day code, with invalid-string tests.

### AGG-C21-26 - High-risk client behavior still relies on source contracts rather than component behavior tests

- Severity: Medium
- Confidence: High
- Sources: `test-engineer`, `critic`
- Cross-agent signal: 2 lanes agree.
- Regions: `apps/web/src/__tests__/search-stale-response.test.ts:1-35`; `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-30`; `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`; `apps/web/src/components/search.tsx:163-281`; `apps/web/src/components/load-more.tsx:43-111`
- Problem: stale semantic responses, cooldowns, live regions, and load-more race contracts are tested by source text instead of component behavior.
- Failure scenario: stale results overwrite newer queries or load-more double-fires while strings/order still satisfy source tests.
- Suggested fix: extract small state-machine helpers or add jsdom/React Testing Library tests for stale response ordering, aborts, cooldowns, load-more double-fire, and live-region rendering.

### AGG-C21-27 - Playwright coverage is single-project Desktop Chromium despite browser/touch/PWA-specific code

- Severity: Medium
- Confidence: High
- Sources: `test-engineer`
- Cross-agent signal: single lane.
- Regions: `apps/web/playwright.config.ts:72-77`; `.github/workflows/quality.yml:75-80`; `apps/web/src/components/register-service-worker.tsx:13-23`; `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`
- Problem: the only Playwright project is Desktop Chromium; mobile, WebKit, Firefox, and installed service-worker behavior are mostly unit/source-tested.
- Failure scenario: touch, iOS viewport, Firefox color/HDR, service-worker registration scope, or offline-cache bypass behavior breaks while CI remains green.
- Suggested fix: add a small tagged matrix: mobile WebKit smoke, mobile Chromium touch smoke, and production PWA offline/bypass spec.

### AGG-C21-28 - Nav visual E2E writes screenshots but never compares them

- Severity: Low-Medium
- Confidence: High
- Sources: `test-engineer`
- Cross-agent signal: single lane.
- Regions: `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Problem: the spec captures PNGs but lacks `toHaveScreenshot` or another baseline comparison.
- Failure scenario: spacing, icon alignment, density, contrast, or responsive hierarchy regressions pass as long as targets remain visible and non-overlapping.
- Suggested fix: rename as manual screenshot capture or add stable screenshot baselines for collapsed mobile, expanded mobile, and desktop nav states.

### AGG-C21-29 - Hydration E2E waits for `networkidle`

- Severity: Low-Medium
- Confidence: Medium
- Sources: `test-engineer`
- Cross-agent signal: single lane.
- Regions: `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Problem: `networkidle` is a timing heuristic that becomes flaky as service workers, analytics, image probes, or background requests grow.
- Failure scenario: the hydration test fails due to runner timing rather than a hydration regression.
- Suggested fix: wait for app-specific readiness such as the photo viewer root/control plus deterministic microtask/RAF or a test-only hydration sentinel.

### AGG-C21-30 - Root proxy topology checker is outside the JS syntax/CI quality path

- Severity: Low
- Confidence: High
- Sources: `test-engineer`
- Cross-agent signal: single lane.
- Regions: `scripts/check-proxy-topology.mjs:1-131`; `apps/web/scripts/check-js-scripts.mjs:6-9`; `package.json:28`; `.github/workflows/quality.yml:54-83`
- Problem: root `scripts/check-proxy-topology.mjs` is exposed by npm but not syntax-checked by the app script gate or CI quality workflow.
- Failure scenario: a syntax or argument-parsing regression ships and the operator checker fails during a proxy incident.
- Suggested fix: extend the JS-script syntax check or add root-level syntax/fixture tests for `scripts/*.mjs`, including `--help`, missing `--url`, malformed URL, and mocked fetch classification.

### AGG-C21-31 - Root README narrows `DB_SSL_CA` to CLI TLS

- Severity: Low-Medium
- Confidence: High
- Sources: `document-specialist`
- Cross-agent signal: single lane.
- Regions: `README.md:146-158`; `README.md:173`; `CLAUDE.md:94`; `apps/web/.env.local.example:9`; `apps/web/src/db/index.ts:7-18`; `apps/web/scripts/mysql-connection-options.js:13-29`; `apps/web/drizzle.config.ts:7-16`
- Problem: the README env snippet describes `DB_SSL_CA` as CLI TLS only, while runtime imports, Drizzle Kit, and backup/restore CLI helpers all require it for non-local DB hosts unless `DB_SSL=false`.
- Failure scenario: an operator copies the quick block, treats the CA as backup-only, and the app fails at runtime import or migrations fail.
- Suggested fix: update the README snippet to match `.env.local.example`: required for verified runtime, Drizzle Kit, and backup/restore CLI TLS to non-local DB hosts.

### AGG-C21-32 - Public route rate-limit docs understate scanner scope

- Severity: Low-Medium
- Confidence: High
- Sources: `document-specialist`
- Cross-agent signal: single lane.
- Regions: `AGENTS.md:34`; `CLAUDE.md:696-700`; `apps/web/scripts/check-public-route-rate-limit.ts:25-35`; `apps/web/scripts/check-public-route-rate-limit.ts:119-138`; `apps/web/scripts/check-public-route-rate-limit.ts:986-998`; `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:1317-1330`
- Problem: docs say the gate scans public API routes under `app/api/**`, but the scanner covers public App Router `src/app/**/route.*` handlers outside admin/private segments.
- Failure scenario: contributors misunderstand why feed/upload/OG route handlers are scanned or reviewers miss that non-API handlers are in scope.
- Suggested fix: reword docs to public App Router route handlers under `apps/web/src/app/**/route.*`, excluding admin/private segments.

### AGG-C21-33 - Per-photo OG docs overstate the 1 MB cap as final output size

- Severity: Low
- Confidence: High
- Sources: `document-specialist`
- Cross-agent signal: single lane.
- Regions: `CLAUDE.md:147-150`; `apps/web/src/lib/og-photo-fetch.ts:30-31`; `apps/web/src/lib/og-photo-fetch.ts:56-87`; `apps/web/src/app/api/og/photo/[id]/route.tsx:197-310`; `apps/web/src/__tests__/og-photo-fallback.test.ts:126-132`
- Problem: docs correctly describe `OG_PHOTO_MAX_BYTES` as a source derivative fetch cap, but also imply the final generated Satori/JPEG card is capped at 1 MB. The route does not check final `jpegBuffer.length`.
- Failure scenario: operators/reviewers may believe crawler output-size limits are impossible to exceed when only input fetch bytes are bounded.
- Suggested fix: clarify docs or add an explicit final output byte check if that is the intended contract.

### AGG-C21-34 - Token/settings dialogs reference missing common translation keys

- Severity: Medium
- Confidence: High
- Sources: `designer`
- Cross-agent signal: browser-backed lane.
- Regions: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:460-482`; `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:157-169`; `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:242-248`; `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:314-317`; `apps/web/messages/en.json:697-706`; `apps/web/messages/ko.json:697-706`; `apps/web/messages/en.json:725-731`; `apps/web/messages/ko.json:725-731`
- Problem: admin settings/token UI calls `t('common.cancel')` and `t('common.tryAgain')`, but those message keys are absent in both locale files.
- Failure scenario: admins see literal fallback keys or runtime `MISSING_MESSAGE` errors in dialog/error states.
- Suggested fix: add `common.cancel` and `common.tryAgain` to both locales, or switch call sites to existing scoped keys. Add parity coverage for missing client message references.

### AGG-C21-35 - Map markers are announced only as generic "Marker"

- Severity: Low-Medium
- Confidence: High
- Sources: `designer`
- Cross-agent signal: browser accessibility snapshot evidence.
- Regions: `apps/web/src/components/map/map-client.tsx:120-138`
- Problem: Leaflet markers render as buttons named `"Marker"` with no unique accessible name; the popup is labeled only after opening.
- Failure scenario: keyboard/screen-reader users tab through indistinguishable map controls and must open each popup or use the fallback list.
- Suggested fix: pass useful `title`/`alt` labels through markers or sync accessible attributes onto `.leaflet-marker-icon` after render.

### AGG-C21-36 - Dashboard checkbox cells duplicate accessible text

- Severity: Low
- Confidence: High
- Sources: `designer`
- Cross-agent signal: browser accessibility snapshot evidence.
- Regions: `apps/web/src/components/image-manager.tsx:431-442`; `apps/web/src/components/image-manager.tsx:462-472`
- Problem: each checkbox wrapper has an `sr-only` label while the nested checkbox repeats the same text via `aria-label`, causing duplicate announcements.
- Failure scenario: screen-reader users hear `Select all images Select all images` or duplicated row labels.
- Suggested fix: keep either the `sr-only` label text associated with the input or the input `aria-label`, but not both.

### AGG-C21-37 - Admin image management is table-first with horizontal scrolling

- Severity: Medium
- Confidence: High
- Sources: `ui-ux-designer-reviewer`
- Cross-agent signal: single UI review lane.
- Regions: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `apps/web/src/components/image-manager.tsx:427-591`
- Problem: recent uploads are shown in a constrained horizontally scrolling 9-column table; thumbnails, tags, and actions can be separated across the scroll axis.
- Failure scenario: on tablet/small laptop, admins reviewing new uploads lose row context while panning to tags/actions.
- Suggested fix: keep wide-desktop table mode but add a responsive card/list workbench below large desktop widths with image, metadata, status, tags, and actions grouped together.

### AGG-C21-38 - Admin navigation is a flat ten-link strip

- Severity: Low-Medium
- Confidence: High
- Sources: `ui-ux-designer-reviewer`
- Cross-agent signal: single UI review lane.
- Regions: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`
- Problem: publishing, taxonomy, SEO, settings, tokens, password, users, DB, and analytics are one peer wrapping nav with no workflow grouping.
- Failure scenario: common publishing tasks and high-risk operational pages require more scanning and feel visually equivalent.
- Suggested fix: group the admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights; use a drawer or section menu on mobile/tablet.

### AGG-C21-39 - Mobile masonry cards permanently overlay metadata on photos

- Severity: Low
- Confidence: Medium
- Sources: `ui-ux-designer-reviewer`
- Cross-agent signal: single UI review lane.
- Regions: `apps/web/src/components/masonry-card.tsx:149-155`
- Problem: mobile cards always render a top gradient with title/topic over the finished photo, while desktop hides metadata until hover/focus.
- Failure scenario: top subject detail in the photographer's crop is partially covered during browsing.
- Suggested fix: make mobile metadata opt-in or move it below the thumbnail/into a less occluding affordance while preserving tap targets and labels.

### AGG-C21-40 - Committed site config can publish Atik branding/canonicals for fresh self-hosted deploys

- Severity: Medium
- Confidence: High
- Sources: `product-marketer-reviewer`
- Cross-agent signal: single product/docs lane.
- Regions: `apps/web/src/site-config.json:2-10`; `README.md:60-77`; `README.md:121-122`; `apps/web/README.md:15-20`; `apps/web/scripts/ensure-site-config.mjs:12-42`; `apps/web/src/app/sitemap.ts:14-18`; `apps/web/src/app/[locale]/layout.tsx:15-26`; `apps/web/src/__tests__/seo-settings-fallback.test.ts:89-117`; `apps/web/src/__tests__/ensure-site-config.test.ts:53-76`
- Problem: the repo contains production Atik defaults in `site-config.json`, and production validation rejects placeholders but accepts the committed Atik URL/branding.
- Failure scenario: a self-hosting operator clones and builds without overriding `BASE_URL` or `site-config.json`, producing Atik canonicals, sitemap URLs, manifest/default branding, footer text, and fallback SEO.
- Suggested fix: track only generic/placeholders and require local production config or `BASE_URL`, or denylist the committed Atik URL for generic builds unless an explicit primary-deploy flag is set.

## Notes

- `tracer.md` reported no confirmed defects and recorded retired hypotheses/residual risks already represented above.
- Several lower-risk findings overlap known long-tail deferred items. Prompt 2 must explicitly schedule or defer each aggregate row; no row may be silently dropped.

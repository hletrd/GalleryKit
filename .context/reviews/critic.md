# Cycle 21 Critic Review

Date: 2026-07-08 KST
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Role: cycle-21 critic lane

Required docs read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`. Review protocol loaded from the `code-review` skill.

## Review-Relevant Inventory

- Current HEAD/worktree: `git rev-parse HEAD` matched `45b32d1db373e03d82a29511f53832051c770880`; worktree was clean before writing this file.
- Source inventory sampled: `apps/web/src` (626 files), `apps/web/src/__tests__` (362 files), `apps/web/e2e` (12 files), `apps/web/scripts` (29 files), `apps/web/drizzle` + meta (33 files), `apps/web/messages` (2 files), root/app docs, deploy helpers, and nginx template.
- Review/plan lineage inspected: top-level `.context/reviews/_aggregate.md`, top-level per-lane reports, `.context/plans/cycle-20-2026-07-08-{plan,deferred}.md`, `.context/plans/deferred-carry-forward.md`, Cycle 19 dated pair, loop-B Cycle 9 pair, and `.context/plans/README.md`.
- Code paths sampled in detail: browser upload, Lightroom/PAT upload, restore/backup, image queue, admin backfill, shared-group data/cache, public search, semantic/similar search, map, smart collections, migration reconcile, source-contract tests, Playwright/CI, deploy scripts, and nginx edge limits.

## Findings

### C21-CRIT-01 - Carry-forward age accounting is stale enough to disable the age-budget policy

- Severity: Medium
- Confidence: High
- Region: `.context/plans/README.md:16-32`; `.context/plans/deferred-carry-forward.md:19-27`; `.context/plans/deferred-carry-forward.md:56-84`; `.context/plans/deferred-carry-forward.md:140-198`; `.context/plans/deferred-carry-forward.md:200-220`
- Problem: The README says deferred High rows crossing 8 cycles must be scheduled/reclassified and Medium rows crossing 16 cycles need explicit re-justification. The carry-forward register claims to make that mechanical, but at r10c20 it still lists run-10 cycle-1 rows as age `3`, run-10 cycle-2 as `2`, cycle-3 as `1`, cycle-4/6/7b/8b as `0`, while newer cycle-18/19/20 rows are also partially aged from a different frame. The prose says Cycle 19 is one cycle old, but older rows are not advanced from their actual first-deferred cycles.
- Failure scenario: An old Medium/High or High row can be repeatedly re-listed without hitting the README checkpoint because the mechanical table says it is below threshold. That undermines the main policy intended to prevent indefinite deferral.
- Suggested fix: Recompute ages from `First deferred` to the current active cycle, either with a small script/test that parses the table or by replacing the hand-maintained age column with derived cycle groups. Then re-run the 8-cycle/16-cycle checkpoint against the corrected ages and either re-justify or schedule rows that cross the line.

### C21-CRIT-02 - Cycle 20 release ledger still has the HEAD docs deploy/push step unchecked

- Severity: Medium
- Confidence: High
- Region: `.context/plans/cycle-20-2026-07-08-plan.md:3`; `.context/plans/cycle-20-2026-07-08-plan.md:135-163`; commit `45b32d1d` message `Not-tested: ... post-docs deploy runs after this commit`
- Problem: The active plan says source commit `d8e604ef` was pushed/deployed, but the final docs-ledger commit/deploy is still unchecked. Current HEAD is exactly that docs-ledger commit (`45b32d1d`), and the commit trailer says post-docs deploy runs after the commit, but the plan has no evidence that it happened.
- Failure scenario: Future review-plan-fix cycles treat Cycle 20 as fully deployed because the plan index says “gates, push, and per-cycle deploy,” while the authoritative plan still records the terminal HEAD deploy as pending. This repeats the older ledger pattern where missing deploy evidence had to be superseded by later cycles.
- Suggested fix: Update the Cycle 20 plan with explicit `45b32d1d` push/deploy/smoke evidence, or explicitly state the docs commit was not deployed and what later deploy superseded it. Add a release-ledger check that the current HEAD appears in terminal deploy evidence before a cycle is marked complete.

### C21-CRIT-03 - Browser and PAT upload paths still duplicate the same ingest transaction contract

- Severity: High
- Confidence: High
- Region: `apps/web/src/app/actions/images.ts:129-269`; `apps/web/src/app/actions/images.ts:540-578`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`; `apps/web/src/app/api/admin/lr/upload/route.ts:560-630`
- Problem: Browser uploads and Lightroom/PAT uploads independently implement config snapshotting, quota settlement, file parsing, topic/tag validation, original save, EXIF/color forwarding, queue job payloads, audit/revalidation, and cleanup. The LR route comments explicitly document prior parity misses in forwarded processing settings and EXIF caption inputs.
- Failure scenario: The next upload-time invariant, such as a new privacy scrub, color/HDR field, alt-text field, queue setting, or cleanup rule, lands in one adapter and silently misses the other. The product then has two upload entry points with different bytes/metadata/audit behavior.
- Suggested fix: Extract a shared authenticated ingest service that owns validation, quota claim settlement, original persistence, DB insert, queue payload creation, cleanup, and audit hooks. Leave only transport/auth/response shaping in the server action and LR route. Add parity tests that assert both adapters call the same service contract.

### C21-CRIT-04 - Large binary ingress still materializes framework `FormData` before streaming handoff

- Severity: High
- Confidence: High
- Region: `apps/web/src/app/actions/images.ts:148`; `apps/web/src/app/api/admin/lr/upload/route.ts:174-188`; `apps/web/src/app/[locale]/admin/db-actions.ts:407-420`; `apps/web/src/app/[locale]/admin/db-actions.ts:717-720`; `apps/web/next.config.ts:111-119`; `apps/web/src/lib/upload-limits.ts:1-35`
- Problem: Browser uploads, PAT uploads, and DB restore all accept large multipart bodies after framework parsing into `FormData`/`File`. App-level caps exist, but near-limit requests still transiently allocate large request bodies before the domain code can stream to disk.
- Failure scenario: A valid 200 MiB photo upload, 250 MiB restore, or concurrent upload batch spikes RSS/temp usage in the single web process that is also serving public dynamic pages and running Sharp/CLIP/background work.
- Suggested fix: Move large ingress to streaming Route Handlers with pre-parse `Content-Length` checks, per-part caps, a shared large-body semaphore, temp-file handoff, and the shared ingest/restore services. Keep Server Actions for small form mutations.

### C21-CRIT-05 - Queue and admin backfill each reserve the same DB/CPU headroom

- Severity: High
- Confidence: High
- Region: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`; `apps/web/src/lib/admin-backfill-runner.ts:716-727`
- Problem: The image queue and in-app admin backfill each calculate safe concurrency from the same 10-connection pool and each reserves roughly half for live traffic. They do not subtract the other background consumer. The documented per-lane math is locally true but globally optimistic.
- Failure scenario: Fresh uploads plus an admin re-encode can run together and pin most of the pool while Sharp/libvips also consumes CPU. Public page/search requests then queue behind encode-duration connection holds despite each lane individually “leaving room.”
- Suggested fix: Introduce a process-wide background-work budget shared by queue, color backfill, semantic/bootstrap work, and other heavyweight side effects. Acquire DB and CPU tokens before advisory locks and Sharp work; expose current token usage in admin status/logs.

### C21-CRIT-06 - Claim-exhausted image jobs bypass the permanent-failure cap helper

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/lib/image-queue.ts:112-113`; `apps/web/src/lib/image-queue.ts:320-326`; `apps/web/src/lib/image-queue.ts:756-768`; `apps/web/src/lib/image-queue.ts:1025-1042`; `apps/web/src/lib/image-queue.ts:1155-1157`
- Problem: Normal permanent failures add to `permanentlyFailedIds` and enforce FIFO eviction plus retry-map cleanup. The claim-exhaustion branch directly calls `state.permanentlyFailedIds.add(job.id)` without the cap/cleanup logic.
- Failure scenario: A lock anomaly or stuck competing worker causes many jobs to exhaust claim retries. The process-local set grows beyond the documented `MAX_PERMANENTLY_FAILED_IDS`, and bootstrap builds an ever-growing `NOT IN (...)` predicate from it.
- Suggested fix: Route every permanent-failure add through one helper, e.g. `markPermanentlyFailed(state, id)`, that enforces the cap and cleans `claimRetryCounts`, `retryCounts`, and `lastErrors`. Add a behavior test that drives the claim-exhaustion path past the cap.

### C21-CRIT-07 - Safety-critical tests still overfit source text instead of behavior

- Severity: High
- Confidence: High
- Region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`; `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:31-63`; `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`; `apps/web/scripts/migrate.js:348-493`
- Problem: Several high-risk contracts are pinned by source scans: migration reconcile coverage checks that column/index names appear in code, semantic/similar scan tests check import and `.limit(...)` substrings, and other cycle contracts assert text shapes. These tests are useful tripwires, but they do not prove runtime behavior, SQL shape, type/default equivalence, or failure ordering.
- Failure scenario: A refactor preserves a string or import while changing the actual behavior, or a migration mirror names a column but gives it the wrong type/default. The source contract stays green while fresh installs or production migrations fail later.
- Suggested fix: Keep source tripwires as cheap lint-like guards, but add DB-backed structural tests for `reconcileLegacySchema` against disposable MySQL/information_schema, behavioral route tests for semantic/similar caps, and executable tests for backup/restore child-process failure paths.

### C21-CRIT-08 - Public dynamic surfaces still concentrate request-local DB/CPU/client work

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1574-1749`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-111`; `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/lib/smart-collections.ts:221-267`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96-112`; `apps/web/src/lib/data.ts:1488-1551`
- Problem: Keyword search uses leading-wildcard `containsLike` scans across multiple fields and follow-up tag/alias queries. Semantic/similar routes load and score embedding blobs inside the request process. `/map` serializes up to 10,000 exact GPS markers and hydrates marker plus fallback-list UI. Public smart collections compile and execute dynamic predicates, including `contains`, on every uncached request.
- Failure scenario: A corpus growth or small public traffic burst stays within rate limits but burns MySQL CPU, Node heap/CPU, and mobile client resources, degrading the same single process serving normal pages and background work.
- Suggested fix: Move keyword search to full-text/ngram or a maintained search-document table, isolate vector search behind an ANN/index/cache or sidecar, make `/map` viewport/bbox-clustered with a smaller first payload, and classify/materialize expensive public smart collections.

### C21-CRIT-09 - Committed nginx edge protections are not applied or verified by deploy

- Severity: Medium
- Confidence: High for repo/deploy mismatch; Medium for live exposure
- Region: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:274-306`; `apps/web/deploy.sh:51-107`; `scripts/deploy-remote.sh:31-93`
- Problem: The nginx template defines public and image-optimizer rate-limit zones, but the file itself says the operator must apply and reload it manually. The deploy helper SSHes to the host and runs `apps/web/deploy.sh`, which rebuilds/health-checks/prunes Docker but does not validate host nginx config hash or limiter status.
- Failure scenario: A release notes “edge rate limit shipped,” but production host nginx is still running an older config. Dynamic public SSR pages then hit Next/MySQL without the expected page limiter.
- Suggested fix: Add a deploy-time read-only nginx config/version probe, or a required operator verification artifact, that records the live limiter config hash and burst test result. Consider a cheap app-layer fallback limiter for public page data loaders where edge state cannot be proven.

### C21-CRIT-10 - Cached shared-group reads still own view-count side effects

- Severity: Medium
- Confidence: Medium
- Region: `apps/web/src/lib/data.ts:49-63`; `apps/web/src/lib/data.ts:1392-1407`; `apps/web/src/lib/data.ts:1830-1834`; `apps/web/src/app/actions/public.ts:517-558`
- Problem: `getSharedGroupCached = cache(getSharedGroup)` wraps a function that can buffer a shared-group view-count increment unless callers pass `incrementViewCount:false` or a selected-photo state suppresses counting. The comment warns not to call the cached wrapper with different count semantics, which is a sign the API boundary is already carrying hidden behavior.
- Failure scenario: A layout, metadata path, preload, or future component calls the cached reader before the page call with different options. React cache deduplication can then decide whether the denormalized buffer increments, while the durable analytics action follows a separate path.
- Suggested fix: Split pure shared-group reads from explicit view-recording orchestration. Make cached data access side-effect-free and let the page/action layer call a named view recorder exactly once.

## Final Sweep / Gaps

- I did not inspect every one of the 626 source files or 2,267 committed review artifacts line-by-line; I sampled high-risk source, tests, migrations, deploy scripts, docs, and active lineage ledgers.
- I did not run the full gate suite; this is a review-only artifact. Cycle 20 recorded gate evidence at `d8e604ef`, not at the current docs HEAD `45b32d1d`.
- I could not verify live host state: nginx config actually loaded, deploy status for `45b32d1d`, CLIP weights, production DB row counts, or real traffic/RSS behavior.
- I did not inspect binary/image fixture contents beyond repository inventory.

# Run-10 Cycle 36 Code Reviewer Report

Date: 2026-07-08 KST
Role: cycle-36 code-reviewer review worker
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `c62c8c1e` on `master` / `origin/master`
Mode: whole-repository review only; no production-code edits.

## Inventory And Scope

Required context read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions.

Inventory built before retaining findings:

- 939 tracked source/docs/config files from `rg --files` excluding ignored runtime/build output.
- 741 files under `apps/web`, including 633 under `apps/web/src`, 29 scripts, 34 migration/meta files, 12 e2e files, Docker/nginx/Next/Vitest/Playwright config, and package manifests.
- App Router surface: localized public pages, admin pages, 13 server-action files, 12 route-handler files, upload fallbacks, OG/search APIs, health/live routes.
- Core cross-file clusters inspected: auth/session/PAT wrappers, same-origin and restore-mutation barriers, public route rate limits, topic route mutations, upload/processing/delete cleanup, image queue, admin and sidecar backfills, semantic search/CLIP, migrations/reconcile, privacy projections, service worker cache behavior, deploy/nginx/Docker, CI and test infrastructure.
- Prior-cycle context read to avoid duplicate filing: `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/_aggregate.md`, `.context/plans/run10-cycle35/{plan,deferred}.md`, and `.context/plans/README.md`.

Concurrent review artifacts outside this assignment were observed in the worktree and left untouched. Final status should be read from `git status` because other review workers may still be updating their files.

## Confirmed Issues

### CR36-01 - Root Playwright run state is tracked instead of ignored

- Severity: Low
- Confidence: High
- Classification: confirmed repository hygiene / maintainability issue
- Region: `test-results/.last-run.json:1-4`; `.gitignore:126-127`; `apps/web/playwright.config.ts:63-67`; `apps/web/e2e/nav-visual-check.spec.ts:58-85`
- Failure scenario: `test-results/.last-run.json` is a tracked Playwright runner state file whose current committed content says `"status": "failed"` with no failed tests. `.gitignore` ignores only `apps/web/test-results/` and `apps/web/playwright-report/`, not root `test-results/`. A root-level Playwright invocation or tooling that writes the default root `test-results` directory can dirty the worktree with machine-local run state, and reviewers can misread the committed JSON as authoritative e2e evidence.
- Suggested fix: remove the file from version control and ignore root `test-results/` / `playwright-report/` as runtime artifacts. Keep intentional visual artifacts under `.context/reviews/...` or another committed provenance path, not Playwright's mutable default output directory.

## Likely Issues / Design Risks

### CR36-02 - Background workers independently budget the same DB pool

- Severity: High
- Confidence: High
- Classification: likely operational correctness/performance issue
- Region: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/lib/background-db-writes.ts:8-75`
- Failure scenario: the shipped pool is 10 connections. The image queue caps itself by reserving half the pool for live traffic, and admin color backfill uses a separate formula that also reserves half the same pool. If uploads are processing while an admin color backfill runs, the queue can use about four claim/update connections and the backfill can use one run lock plus four worker/update connections, leaving little or no room for foreground photo-page fan-out. Analytics writes can still consume two more async DB slots. Each formula is locally reasonable, but they do not subtract the other active background owners.
- Suggested fix: introduce one shared background resource coordinator or semaphore for image processing, admin backfill, semantic embedding work, maintenance, and analytics. Gate all long-running DB/CPU background lanes through it, expose current reservations, and add a regression that overlaps queue + backfill + analytics while proving a foreground DB acquisition stays within the reserved budget.

### CR36-03 - Semantic embedding work has multiple active owners without one admission gate

- Severity: Medium
- Confidence: High
- Classification: likely resource-ownership risk
- Region: `apps/web/src/lib/image-queue.ts:501-539`; `apps/web/src/lib/image-queue.ts:542-637`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-134`; `apps/web/src/lib/clip-model.ts:53-173`
- Failure scenario: the sidecar CLIP backfill holds `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, but live upload embedding and `bootstrapMissingActiveEmbeddings()` do not observe that lock before embedding and upserting rows. The upsert/model-version contract prevents duplicate-row corruption, so this is not a data-loss bug. The likely failure is capacity contention: a large sidecar run and live bootstrap can duplicate ONNX inference and compete for the same CLIP queue, DB pool, and CPU, causing public semantic requests to hit queue-full/timeout or slowing production activation.
- Suggested fix: either make live embedding paths skip/defer while the semantic backfill advisory lock is held, or centralize all embedding writes behind a queue/lease table with shared admission limits. Add tests proving a sidecar backfill and live bootstrap do not run unbounded inference concurrently.

### CR36-04 - Sidecar color backfill uses global batches that can persist another worker's claimed image

- Severity: Low-Medium
- Confidence: Medium
- Classification: likely ownership-invariant risk
- Region: `apps/web/scripts/backfill-color-pipeline.ts:471-527`; `apps/web/scripts/backfill-color-pipeline.ts:557-603`
- Failure scenario: each sidecar worker claims one image, re-encodes it, pushes row data into global `updateBatch` / `derivativeBatch`, then calls `flushBatch()`. Because the batches are global, worker A can splice and persist worker B's queued image while B still owns the per-image claim. B can then release its claim after finding no pending row in its own flush, even though A's transaction is the one that actually committed B's update. Current global color-backfill locking keeps this low-risk, but the code no longer strictly ties a claim holder to that image's DB persistence.
- Suggested fix: make batches caller-owned or track per-item completion promises so an image claim is released only after the transaction containing that image has committed. Add a two-worker regression where one worker flushes another worker's queued item and assert claim release waits for commit.

## Manually Validated / Operator Risks

### RISK36-01 - Host nginx limiter and real-IP behavior remain manual production proofs

- Severity: Medium
- Confidence: High
- Classification: manually validated risk still requiring live evidence
- Region: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:254-306`; `scripts/check-proxy-topology.mjs:7-16`; `CLAUDE.md:248`; `CLAUDE.md:514-526`
- Failure scenario: committed nginx changes are inert until copied into the operator-owned host config and reloaded. In an LB-fronted topology, `$binary_remote_addr` can also be the LB IP unless `realip`/PROXY protocol is configured, collapsing every visitor into one edge limiter bucket.
- Suggested fix: keep source changes separate from production-apply status. For each nginx/topology change, record `nginx -t`, reload, burst 429 proof, normal-page non-429 proof, and an effective-client-IP validation from edge logs or a diagnostic.

### RISK36-02 - Large browser upload memory envelope is documented but not host-measured

- Severity: Medium
- Confidence: Medium
- Classification: manual capacity risk
- Region: `CLAUDE.md:657-663`; `apps/web/nginx/default.conf:132-147`; `apps/web/src/lib/upload-limits.ts:1-21`; `apps/web/src/app/actions/images.ts:87-160`
- Failure scenario: the app enforces 200 MiB per file and a batch window, while framework multipart parsing can still transiently hold large bodies in memory before disk save and Sharp processing. Concurrent uploads on the constrained host can exceed RSS expectations even though every app-level size check passes.
- Suggested fix: run an on-host RSS measurement for the largest supported concurrent browser upload batch, then tune container memory, upload concurrency, or upload limits from that evidence.

### RISK36-03 - Real CLIP production readiness depends on external weights and a separate preflight

- Severity: Medium
- Confidence: High
- Classification: manual validation risk
- Region: `apps/web/package.json:21-23`; `.github/workflows/clip-preflight.yml:3-46`; `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`; `CLAUDE.md:558-636`
- Failure scenario: normal unit gates skip real model-weight tests. If production semantic mode is enabled without seeded weights or without running the preflight against the deployed volume, semantic routes can 503 or fail real inference despite green standard CI.
- Suggested fix: require `CLIP_MODELS_ROOT=<seeded-host-path> npm run test:clip:preflight --workspace=apps/web` before flipping `admin_settings.semantic_search_mode='production'`, and consider path-filtered CI/manual checks whenever CLIP/model files change.

## Positive Checks

- Cycle 35 topic-map fix is present: `updateTopic` carries `map_visible` through slug rename at `apps/web/src/app/actions/topics.ts:299-323`, and `setTopicMapVisible` now runs under the topic route lock at `apps/web/src/app/actions/topics.ts:709-723`.
- Public semantic/similar routes hard-cap scans with `SEMANTIC_SCAN_LIMIT` at `apps/web/src/app/api/search/semantic/route.ts:263-279` and `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`.
- Public search result enrichment uses one privacy-guarded select at `apps/web/src/lib/search-enrichment-fields.ts:29-46`.
- Admin API wrappers, server-action same-origin/mutation barriers, and public route rate-limit scanners all passed in this review.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- --run src/__tests__/topics-actions.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/tracked-secrets.test.ts` - 4 files passed, 69 tests passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `git diff --check` - passed.

Not run: full `npm test`, `npm run build`, Playwright e2e, production deploy, live nginx reload/probes, production CLIP preflight, or upload RSS measurement.

## Final Sweep

Swept issue classes: auth bypass, admin API wrapper drift, server-action origin/barrier drift, public route limiter gaps, privacy projection leaks, topic slug/alias route locking, upload/restore races, filesystem cleanup/orphan risks, migration journal drift, raw SQL/shell/file deletion hazards, tracked secrets/runtime artifacts, skipped/focused tests, CI gate coverage, Docker/nginx/deploy contracts, service-worker freshness, semantic search capacity, and prior deferred registers.

Skipped or sampled only: historical `.context` archives, `.omx`/`.omc` runtime state, ignored `.claude` worktrees, binary screenshots/media fixtures, `node_modules`, `.next`, and live production state.

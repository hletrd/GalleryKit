# Run-10 Cycle 36 Critic Review

Date: 2026-07-08 KST
Role: cycle-36 critic review worker
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `c62c8c1e` on `master` / `origin/master`
Mode: whole-surface critique only; no production-code edits.

## Inventory And Method

Required context read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions.

I inventoried the repo before judging issues:

- Source/config/test/docs surface: root manifests and scripts, `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, Docker/nginx/deploy config, `.github/workflows`, `.context/plans`, and current `.context/reviews`.
- Cross-file interaction paths inspected: request provenance -> auth/session/PAT -> mutation barriers; public routes -> rate limits -> DB/CPU work; upload -> original save -> queue -> processing -> serving -> delete cleanup; restore marker/locks -> drains -> import -> migration postconditions; semantic search -> CLIP model gate -> embedding writers; topic route slug/alias/map-visible mutations; deploy -> build -> health -> prune; CI -> lint/typecheck/test/e2e/build.
- Prior-cycle baseline read: Cycle 35 code-reviewer/critic reports, `_aggregate.md`, and `run10-cycle35/deferred.md`.

Concurrent review artifacts outside this assignment were observed in the worktree and were not touched. Final status should be read from `git status` because other review workers may still be updating their files.

## Confirmed Issues

### CRT36-01 - Mutable Playwright runner state is committed at the repository root

- Severity: Low
- Confidence: High
- Classification: confirmed maintainability/provenance issue
- Region: `test-results/.last-run.json:1-4`; `.gitignore:126-127`; `apps/web/e2e/nav-visual-check.spec.ts:58-85`
- Concrete failure scenario: the repo commits Playwright's `.last-run.json` with `"status": "failed"` while the actual current focused tests pass. The ignore file only covers `apps/web/test-results/`, so root runner state remains tracked. Future review or CI triage can confuse this stale local runner artifact with current validation evidence, and root-level Playwright runs can create noisy diffs unrelated to source behavior.
- Suggested fix: untrack `test-results/.last-run.json`, ignore root `test-results/`, and keep committed screenshots/results only in explicit review artifact directories with names that encode purpose and date.

## Likely Issues

### CRT36-02 - The app has several local "safe" queues but no system-level backpressure model

- Severity: High
- Confidence: High
- Classification: likely architecture issue
- Region: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/lib/background-db-writes.ts:8-75`; `apps/web/scripts/backfill-color-pipeline.ts:416-420`; `apps/web/src/lib/clip-model.ts:53-173`
- Concrete failure scenario: each subsystem protects itself: image queue clamps to the DB pool, admin backfill clamps to the DB pool, analytics caps pending writes, and CLIP caps inference. The system still has no single admission decision across those queues. A realistic maintenance window can run browser uploads, image processing, admin color backfill, analytics writes, semantic bootstrap, and public search at once. The result is not a single code exception; it is foreground starvation, queue-limit timeouts, and operator confusion because every local module can say it respected its own limit.
- Suggested fix: treat background resource use as one product-level contract. Add a shared scheduler with named budgets for DB connections, Sharp/libvips work, CLIP inference, and low-priority analytics. Encode priority: foreground request DB work and restore drains should outrank discretionary backfill and bootstrap work.

### CRT36-03 - Semantic search activation has convergent data semantics but fragmented ownership

- Severity: Medium
- Confidence: High
- Classification: likely maintainability / operational issue
- Region: `apps/web/src/lib/image-queue.ts:501-637`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-134`; `apps/web/src/lib/clip-model.ts:117-173`; `apps/web/src/app/api/search/semantic/route.ts:247-260`
- Concrete failure scenario: upload-time embedding, queue bootstrap embedding, admin action embedding, and sidecar embedding all know how to write embeddings. The row upsert makes this converge, but there is no single owner for "production activation is running." If a visitor triggers semantic search while an operator sidecar and live bootstrap are both embedding, the public route shares the same CLIP inference queue and can fail with server/503 posture even though the database rows are not corrupt.
- Suggested fix: centralize embedding ownership into a durable task table or one backfill service. Live upload can enqueue work; sidecar/admin can drive the queue; public search can reserve separate inference capacity or bypass inference when activation is busy.

### CRT36-04 - Distribution defaults are still deployment-branded

- Severity: Medium
- Confidence: High
- Classification: likely product/distribution risk
- Region: `apps/web/src/site-config.json:1-10`; `apps/web/src/site-config.example.json:1-12`; `apps/web/scripts/ensure-site-config.mjs:11-42`; `README.md:60-77`
- Concrete failure scenario: a fresh self-hosted production build that forgets to replace `apps/web/src/site-config.json` ships `Atik Gallery` and `https://gallery.atik.kr` as fallback canonical/OG/nav/footer metadata. The example file is generic, but the tracked real file is deployment-specific and `ensure-site-config` accepts it as valid production config.
- Suggested fix: for public distribution, stop tracking deployment-specific `site-config.json` or require an explicit allow flag for known deployment config. Keep the active deployment's config in a deploy-secret/local path and copy it during deploy, or add a build-time check that rejects the Atik URL unless the target is the Atik deployment.

### CRT36-05 - Test strategy is broad but still lacks a risk-based coverage ratchet

- Severity: Medium
- Confidence: High
- Classification: likely quality-system issue
- Region: `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`; `apps/web/package.json:8-30`; `.context/plans/run10-cycle35/deferred.md:81-86`
- Concrete failure scenario: the project has many source-contract tests and strong lint gates, but no coverage report or ratchet for high-risk modules. A future refactor can remove behavioral tests around restore, migration, or upload flows while leaving source-contract/string tests green. CI would still pass lint/typecheck/unit/e2e without showing that executable coverage on the risky path dropped.
- Suggested fix: add non-blocking coverage reporting first, classify high-risk modules, then ratchet branch/function coverage only for those modules. Keep source-contract tests, but do not let them inflate confidence in behavioral coverage.

## Manually Validated Risks

### MAN36-01 - Public edge behavior is source-documented but not source-provable

- Severity: Medium
- Confidence: High
- Classification: manual validation risk
- Region: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:274-307`; `scripts/check-proxy-topology.mjs:7-16`; `CLAUDE.md:514-526`
- Concrete failure scenario: deploys do not apply host nginx templates. Even if the committed config is correct, production can still run stale limiter/body-size/real-IP behavior. The topology checker explicitly cannot prove the effective client-IP bucket.
- Suggested fix: require an operator evidence record after nginx/topology changes: config copy, `nginx -t`, reload, burst limiter proof, normal page proof, and real-IP bucket proof from logs or a temporary diagnostic.

### MAN36-02 - Browser upload capacity remains an empirical host limit

- Severity: Medium
- Confidence: Medium
- Classification: manual validation risk
- Region: `CLAUDE.md:657-663`; `apps/web/nginx/default.conf:132-147`; `apps/web/src/app/actions/images.ts:87-160`
- Concrete failure scenario: app and nginx caps can be correct while actual RSS still spikes during framework multipart buffering plus Sharp fan-out. A user uploading several near-limit photos can exhaust memory before the system's documented logical limits feel unsafe.
- Suggested fix: measure RSS on the production-sized host for the largest supported concurrent upload batch and tune `UPLOAD_MAX_TOTAL_BYTES`, queue concurrency, and container/host memory from that measurement.

### MAN36-03 - Real CLIP readiness is outside the standard push gate

- Severity: Medium
- Confidence: High
- Classification: manual validation risk
- Region: `apps/web/package.json:21-23`; `.github/workflows/clip-preflight.yml:3-46`; `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`
- Concrete failure scenario: standard CI can be green while production semantic search would fail because weights are absent, stale, or not validated on the target volume. The separate scheduled/manual workflow helps, but it is not a mandatory gate on every semantic-search-related push.
- Suggested fix: require the preflight workflow or local host-volume preflight before production mode changes, and add path-filtered enforcement when CLIP model/loading/semantic route files change.

### MAN36-04 - Browser-flow confidence is narrower than the supported UX surface

- Severity: Medium
- Confidence: High
- Classification: manual/test-infra risk
- Region: `apps/web/playwright.config.ts:48-77`; `.github/workflows/quality.yml:75-80`; `apps/web/e2e/nav-visual-check.spec.ts:40-86`; `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Concrete failure scenario: e2e runs one Desktop Chrome project. The nav visual spec captures screenshots but does not compare baselines, and hydration detection waits on `networkidle` rather than an app-owned hydrated marker. Mobile/Safari/display-gamut regressions can pass the standard browser gate unless unit/source contracts happen to catch them.
- Suggested fix: add a small cross-browser/mobile smoke matrix for the public gallery/photo/search surfaces, introduce real screenshot comparison with masks, and expose a deterministic hydration-ready marker for hydration tests.

## No-Finding Areas With Evidence

- Admin API auth wrappers: scanner passed for both admin API routes.
- Server action same-origin and restore-mutation barriers: scanner passed for all mutating actions, including `setTopicMapVisible`.
- Public route rate-limit posture: scanner passed for public route handlers; upload serving and health/live exemptions are explicit.
- Topic route mutation regression from Cycle 35: current source carries `map_visible` during rename and serializes the map-visible toggle behind the shared topic route lock.
- Privacy-sensitive search enrichment: shared select has a type-only privacy guard and the focused search route tests passed.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- --run src/__tests__/topics-actions.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/tracked-secrets.test.ts` - 4 files passed, 69 tests passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `git diff --check` - passed.

Not run: full unit suite, production build, Playwright e2e, deploy, live nginx probes, live CLIP preflight, upload RSS measurement.

## Final Sweep

Missed-issue classes swept: stale root artifacts, tracked secrets/runtime output, auth and origin guard drift, public route limiter gaps, upload/restore races, route slug/alias/map mutation races, DB pool contention, CLIP ownership, migration/reconcile drift, privacy projection drift, service-worker blocking behavior, Docker prune persistence, nginx route matching, CI gate shape, skipped/focused tests, and prior deferred issue carry-forward.

Skipped or sampled only: historical archived plans/reviews, ignored runtime caches, `.omx`/`.omc` state, `.claude` worktrees, binary screenshot fixtures, `node_modules`, `.next`, and any live production host state.

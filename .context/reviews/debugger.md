# Debugger Review - Cycle 18

Date: 2026-07-08 KST
Reviewer lane: debugger
Scope: whole-repository latent bug and failure-mode review, focused on exception paths, stuck states, boundary conditions, races, regressions, and recovery behavior.

Constraints honored: review-only; no source edits, no commits, no pushes, no deploys. The pre-existing untracked `.context/reviews/cycle-8-2026-07-07/perf-reviewer.md` was not touched. New dirty files created by other lanes were observed but left alone.

## Inventory And Coverage

Required policy and planning context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-17-2026-07-08-plan.md`
- `.context/plans/cycle-17-2026-07-08-deferred.md`

Repository inventory was built with `rg --files` before findings. Debugger-relevant surfaces reviewed directly or by targeted sweeps:

- Server actions/API routes: upload, Lightroom upload, settings, topics, admin users, embeddings, public search/load-more, semantic/similar search, restore/backup actions, feed/sitemap/OG routes.
- Runtime libraries: DB pool/schema selectors, advisory locks/release helpers, upload-processing lock, admin mutation barrier, restore maintenance, image queue/bootstrap/shutdown, background writes, CLIP model/inference/embeddings, image/color/HDR processing, rate limits, cache/revalidation, service worker.
- Operator scripts: migrations, deploy helpers, color-pipeline backfill, CLIP model download/preflight/backfill, restore/import support, source-contract lint scripts.
- Config/deploy/schema: package manifests/lockfile, Next/TS/Vitest/Playwright config, Docker/nginx/deploy scripts, Drizzle migrations/journal.
- Tests-as-regression evidence: source-contract tests for Cycle 17 fixes, upload/quota tests, restore/lock tests, semantic/backfill tests, queue/backfill failure tests, privacy/rate-limit/action-origin guards.

Final sweeps included `GET_LOCK`/`RELEASE_LOCK`, `backfillClipEmbeddings`, `SEMANTIC_SCAN_LIMIT`, queue bootstrap, upload quota settlement, restore-maintenance gates, and missing-original CLIP branches. I did not treat comments/tests as proof when source behavior disagreed.

## Confirmed Active Issues

No confirmed active debugger issues were found in the currently wired runtime paths.

Evidence: the Cycle 17 Lightroom setup failure is now pinned by `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:42-50`; the live missing-embedding queue uses a persisted cursor and scan budget at `apps/web/src/lib/image-queue.ts:554-621`; the canonical CLIP sidecar uses keyset pagination plus attempted-embedding budgeting at `apps/web/scripts/backfill-clip-embeddings.ts:152-190` and `apps/web/scripts/backfill-clip-embeddings.ts:199-239`; pooled app advisory-lock paths use the shared destroy-on-ambiguous-acquire/release helper at `apps/web/src/lib/advisory-lock-release.ts:41-108` with app call sites routed through it.

## Likely Issues

### DBG-C18-01 - Unwired CLIP server action still has the old skipped-prefix starvation shape

Severity: Low
Confidence: High
Status: Likely latent issue, not confirmed active because the action is not imported by app code outside tests.

Files/regions:

- `apps/web/src/app/actions/embeddings.ts:89-90`
- `apps/web/src/app/actions/embeddings.ts:136-156`
- `apps/web/src/app/actions/embeddings.ts:161-202`
- Reachability sweep: `rg backfillClipEmbeddings` found only the export and tests, no production UI/import caller.

Why this is a real problem:

`backfillClipEmbeddings` is still exported as a server action and its own comment says it is kept honest "if it is ever surfaced." Unlike the repaired sidecar and live queue bootstrap, it selects one `SEMANTIC_SCAN_LIMIT` window once, skips production rows with missing/unresolvable originals, returns `{ status: 'ok', processed, skipped }`, and creates no marker/cursor for skipped rows. If the first window is dominated by permanently skipped images, later valid rows remain unvisited on every invocation.

Concrete failure scenario:

1. A future admin UI wires this existing action instead of the sidecar.
2. Production mode is enabled and the first `SEMANTIC_SCAN_LIMIT` processed rows lack `filename_original` or their original files are gone.
3. Lines `172-174` increment `skipped` and return for those rows without writing embeddings.
4. The action reports OK with skipped rows. The next run re-selects the same missing rows at `136-156`, so newer valid images never get embeddings through that control.

Suggested fix:

Either delete/unexport this action if the sidecar is the only supported backfill path, or port the sidecar's keyset cursor and attempted-embedding budget into the action. Add a behavior/source-contract test with missing-original rows before a valid row to prove later rows are reachable across repeated action calls.

## Manual-Validation Risks

### DBG-C18-MV-01 - Live host state remains outside static repo proof

Severity: Low
Confidence: High
Status: Manual-validation risk.

Files/regions:

- Semantic activation docs and gates: `README.md:48`, `apps/web/README.md:80-88`, `CLAUDE.md:553-631`
- Proxy/deploy docs and scripts: `CLAUDE.md:509-521`, `apps/web/nginx/default.conf:59-71`, `apps/web/deploy.sh:1-108`

Why this matters:

The repo code gates semantic production mode, proxy headers, backup/restore, and deploy behavior defensively, but a static review cannot prove the live host has current env files, seeded CLIP weights, current nginx config, successful post-push deploy, or a healthy MySQL/uploads mount.

Concrete failure scenario:

An operator assumes semantic search or proxy-rate-limit behavior is active because the repo docs/code are correct, while the running container lacks `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, model weights, or the checked-in nginx template.

Suggested fix:

Keep requiring live evidence in implementation cycles: deploy transcript, health smoke, `npm run test:clip:preflight`, semantic/similar search smoke when enabled, and proxy topology verification against the deployed URL.

## Final Sweep

No skipped file class changed the result. The principal active paths for uploads, restore locks, image processing retries, background embedding catch-up, canonical sidecars, service worker cache rules, migrations, and deploy disk hygiene were inspected against source behavior. Historical findings already present in Cycle 17 deferred were not re-filed as new debugger issues.

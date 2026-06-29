# Tracer Review - Review-Plan-Fix Cycle 2

**Date:** 2026-06-29
**HEAD:** `3d1387045e0d7f1e06fb48756e412228bbdaf08d` (`build(sw): 🔨 update post-build service worker stamp`)
**Role:** tracer lane, with suspicious-flow tracing across data/auth/upload/queue/deploy paths.
**Edit boundary:** Review artifact only; no application code edited.

## Inventory Coverage

Review-relevant inventory was built before findings were selected:

- Authoritative docs and current context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/reviews/run9-cycle8/_aggregate.md`, `.context/reviews/run9-cycle8/tracer.md`, `.context/reviews/run9-cycle8/document-specialist.md`, `.context/plans/plan-347-run10-cycle2-convergence.md`, `.context/plans/plan-365-run10-cycle2-semantic-similarity-selector-test.md`, `.context/plans/plan-366-run10-cycle2-deferred-register.md`.
- Package/config/deploy metadata: `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/.env.local.example`.
- Source tree focus: `apps/web/src/app/actions/**`, `apps/web/src/app/api/**`, `apps/web/src/app/[locale]/admin/**`, `apps/web/src/lib/**`, `apps/web/src/db/schema.ts`, `apps/web/src/proxy.ts`.
- Script/migration focus: `apps/web/scripts/migrate.js`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/drizzle/**`.
- Test inventory: `apps/web/src/__tests__/**` with particular attention to auth, action-origin, upload limits, queue behavior, restore/migration, privacy guards, touch targets, and semantic-search tests.

## Competing Hypotheses

| Hypothesis | Result | Confidence | Notes |
| --- | --- | --- | --- |
| Core auth, upload, queue, restore, migration, and deploy flows remain internally consistent at HEAD. | Mostly confirmed | High | Traced code paths and recent cycle-8 review baselines found no new confirmed break in these flows. |
| CLIP semantic-search production enablement has an operator-flow no-op caused by stale command examples. | Confirmed issue | High | The documented command can exit `0` before creating embeddings when DB mode is disabled. |
| Bounded newest-first semantic scans can miss older relevant images as the gallery grows. | Risk, not current confirmed outage | High | Code and docs agree on the bounded scan; risk becomes concrete once embeddings exceed the scan cap. |

## Findings

### TRC-C2-01 - CLIP pre-enable backfill examples can exit successfully without creating production embeddings

**Status:** Confirmed issue
**Severity:** High
**Confidence:** High

**Evidence:**

- `apps/web/README.md:35-37` lists `npx tsx scripts/backfill-clip-embeddings.ts --production` as the regenerate-embeddings command.
- `apps/web/scripts/backfill-clip-embeddings.ts:4-22` repeats production sidecar examples without `--force`.
- `apps/web/scripts/backfill-clip-embeddings.ts:90-95` exits `0` without processing when semantic search mode is disabled/unset and `--force` is absent.
- `apps/web/src/app/api/search/semantic/route.ts:255-259` returns 503 in production mode when no production embeddings are available.
- The newer go-live docs already show the correct pre-enable command with `--force` at `apps/web/README.md:68-70` and `CLAUDE.md:506-527`, so the repo contains conflicting operational instructions.

**Failure scenario:** An operator follows the script table or script header on a default install: seed weights, run `--production`, then enable production mode. The backfill exits successfully because the DB row is still disabled, but creates no production embeddings. After production mode is enabled, semantic search has weights but no usable rows and returns 503 until the backfill is rerun with `--force`.

**Suggested fix:** Update the app README script table and the script header sidecar examples to use `--production --force` for pre-enable production backfills. Keep a separate note that `--force` is optional only after the DB mode has already been switched to `stub` or `production`.

### TRC-C2-RISK-01 - Newest-first semantic scan can omit older relevant photos once embeddings exceed the scan cap

**Status:** Risk, not a confirmed current defect
**Severity:** Medium
**Confidence:** High

**Evidence:**

- `apps/web/src/app/api/search/semantic/route.ts:240-249` scans embeddings ordered by newest `updatedAt` and limits the candidate set to `SEMANTIC_SCAN_LIMIT`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-150` uses the same newest-first bounded candidate pattern for similar-photo search.
- `apps/web/src/lib/clip-embeddings.ts:18-40` makes `SEMANTIC_SCAN_LIMIT` configurable but still bounded.
- `apps/web/README.md:61` documents the limitation: large galleries may not surface relevant older photos until a vector index is added.

**Concrete risk scenario:** A gallery grows beyond `SEMANTIC_SCAN_LIMIT`. A highly relevant older image falls outside the newest candidate window, so semantic search or similar-photo search ranks only newer candidates and may omit the true nearest match. This is not a current contradiction between docs and code; it is a known product/quality risk that should remain tracked if gallery size grows.

**Suggested fix:** Add an operational warning or health check when production embedding count exceeds `SEMANTIC_SCAN_LIMIT`, and plan a vector index or batched full-corpus scoring path before the production corpus routinely exceeds the cap.

## Confirmed-Correct Flow Notes

- **Admin auth/API guard flow:** `apps/web/src/lib/api-auth.ts:49-121` separates scoped bearer-token access from cookie-backed same-origin admin access. `apps/web/src/proxy.ts:76-116` remains a coarse admin-route cookie/token presence guard, with API routes intentionally excluded at `apps/web/src/proxy.ts:135-140`.
- **Server-action origin flow:** mutating actions inspected route through `requireSameOriginAdmin()` and user/admin checks; the lint gate remains the enforcement surface described in `AGENTS.md`.
- **Browser upload and Lightroom upload flow:** browser uploads claim the process-local upload tracker before the first file write in `apps/web/src/app/actions/images.ts:170-250`; Lightroom uploads share the `saveOriginalAndGetMetadata()` path, and the 200 MiB per-file cap is enforced in `apps/web/src/lib/process-image.ts:844-847`.
- **Queue flow:** `apps/web/src/lib/image-queue.ts:238-265` takes a per-image advisory lock before processing; the row-exists/processed=false check happens after the lock at `apps/web/src/lib/image-queue.ts:346-352`.
- **Restore flow:** `apps/web/src/app/[locale]/admin/db-actions.ts:266-360` combines admin/origin checks, DB restore lock, upload contract lock, maintenance mode, queue quiescence, restore execution, and cleanup in a single guarded flow.
- **Migration/deploy flow:** `apps/web/scripts/migrate.js:686-746` reconciles/baselines legacy schemas and checks every committed journal hash after migration. `apps/web/deploy.sh:51-56` prunes containers/images/build cache and only dangling volumes after `up -d`.

## Final Missed-Issues Sweep

I rechecked the previous stale findings against current code/docs: upload body defaults, `siteConfig.url` build validation, per-photo OG fallback, `smart_collections.query_json`, and `avifEffort` are now aligned with current authoritative docs/code. I also traced the high-risk flow classes requested by the prompt: data/auth/upload/queue/deploy plus CLIP semantic-search activation.

**Disposition:** 1 confirmed tracer finding, 1 tracked risk, no application-code edits.

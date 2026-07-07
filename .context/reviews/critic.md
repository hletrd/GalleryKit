# Critic Review - Cycle 8

Reviewer: critic. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `eca55414677676462ae54a5579d9c35bfdf16d3c`.

Mode: skeptical source/document review. I did not implement fixes, commit, push, deploy, stop services, remove files, or touch the temporary MySQL container `gallerykit-e2e-mysql-cycle7-47691` on `127.0.0.1:33307`.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then built this inventory before filing findings:

- Repository/docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, latest `.context/reviews/run9-cycle8/*`, current `.context/reviews/critic.md`, and run-10 convergence/deferred plans.
- Package/gate surface: root and app `package.json`, quality-gate scripts, lint scanners, Playwright/Vitest config, migration journal/tests.
- Deployment/ops: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`.
- Schema/migrations: `apps/web/src/db/schema.ts`, every `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- High-risk app code: admin auth/session/rate-limit helpers, admin API wrappers, public actions, upload/delete/share actions, DB backup/restore, restore-maintenance barrier, image queue, process-image/color/HDR/GPS paths, semantic search/CLIP code, smart collections, privacy select fields, service-worker cache contract, public routes, admin settings/tokens UI.

No full gate run was executed because this lane is review-only and the task requested exactly one written artifact. Validation was source-backed via `rg`, `nl -ba`, `git status --short`, `git diff --stat`, targeted line reads, and a read-only journal monotonicity check. The worktree was clean at start.

## Findings

### CRIT-C8-01 - `image_embeddings` is model-version filtered at read time but cannot retain more than one model version

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Perspectives: architecture, semantic-search correctness, rollback safety, operator runbook
- Evidence:
  - `apps/web/drizzle/0012_image_embeddings.sql:5-11` creates `image_embeddings` with `PRIMARY KEY (image_id)` only.
  - `apps/web/src/db/schema.ts:286-300` mirrors that: `imageId` is the primary key; `modelVersion` is only a normal indexed column.
  - `apps/web/scripts/backfill-clip-embeddings.ts:212-223`, `apps/web/src/app/actions/embeddings.ts:175-186`, and `apps/web/src/lib/image-queue.ts:512-523` all upsert on that single-image key and overwrite `embedding` plus `modelVersion`.
  - Reads are version-gated: semantic search filters `modelVersion` in `apps/web/src/app/api/search/semantic/route.ts:270-279`; similar search requires production rows in `apps/web/src/app/api/search/similar/[id]/route.ts:137-190`.
  - `apps/web/src/lib/clip-embeddings.ts:233-235` says the production model-version string should be bumped whenever the model or dimension changes.
  - `apps/web/README.md:70-74` documents production serving only matching `model_version` rows, but not that backfill overwrites prior versions instead of retaining them.
- Concrete failure scenario: An operator rolls from model/version `A` to `B`. The `B` backfill overwrites rows image by image. During a partial rollout, production `B` search sees only the overwritten subset; untouched images remain filtered out. If the operator rolls the app setting back to `A`, rows already overwritten to `B` no longer have `A` embeddings, so rollback also has partial recall. This is not just a storage optimization; it conflicts with the read-side version gate's implied rollback boundary.
- Suggested fix: Migrate `image_embeddings` to retain versions, e.g. composite primary/unique key `(image_id, model_version)` or a surrogate key plus unique `(image_id, model_version)`. Update Drizzle schema, `reconcileLegacySchema`, all upsert conflict targets, search/similar queries, cleanup/retention policy for obsolete versions, and tests. If single-version storage is intentional, downgrade the architecture: document production upgrades as destructive single-active-version rewrites and add an operator rollback warning.

### CRIT-C8-02 - Production CLIP sidecar can repeatedly spend the whole scan budget on the same failing low-id prefix

- Severity: Medium
- Confidence: Medium
- Status: Likely
- Perspectives: operations, data integrity of search coverage, previous-plan challenge
- Evidence:
  - `apps/web/scripts/backfill-clip-embeddings.ts:150-188` initializes `cursor = 0` per process, advances by ascending `images.id`, and selects rows missing the target `modelVersion`.
  - The same script decrements remaining budget by `processed + failed` at `apps/web/scripts/backfill-clip-embeddings.ts:155-158` and stops when that reaches `SEMANTIC_SCAN_LIMIT`.
  - Per-image failures such as missing `filenameOriginal`, missing original path, or encoder errors increment `failed` but do not mark the image as skipped for later runs: see `apps/web/scripts/backfill-clip-embeddings.ts:193-204` and the catch at `apps/web/scripts/backfill-clip-embeddings.ts:228-232`.
  - When the cap is reached, the script logs and exits non-zero if any failures occurred (`apps/web/scripts/backfill-clip-embeddings.ts:236-248`).
  - The README tells operators to repeat the same sidecar command when `SEMANTIC_SCAN_LIMIT` is reached (`apps/web/README.md:80-82`).
  - The in-process queue explicitly fixed this exact class with a persistent process-local cursor (`apps/web/src/lib/image-queue.ts:340-356`), but the sidecar still restarts from zero every invocation.
- Concrete failure scenario: A production gallery has an old prefix of 2,000 processed images whose originals are missing or unreadable, followed by thousands of valid images. `backfill-clip-embeddings.ts --production --force` retries that prefix, reaches `SEMANTIC_SCAN_LIMIT`, prints failed IDs, and exits. Re-running the documented command starts at `cursor = 0` and retries the same prefix again, so valid newer rows are never embedded until the operator manually repairs or removes every low-id failure. Production semantic search then has incomplete or empty recall despite following the runbook.
- Suggested fix: Give the sidecar a durable or operator-visible skip/resume mechanism. Options: persist a failed-at/model-version marker, accept `--start-after-id`, write a sidecar checkpoint under the data volume, or process a bounded failing prefix but continue scanning past it while reporting failures separately. Update the README runbook to say that repeated runs cannot progress past a saturated failing prefix until the failed IDs are addressed.

## Final Sweep

- Auth/session/origin: middleware only does coarse cookie-format screening, but server actions and API wrappers perform actual auth; admin API exports use `withAdminAuth`; mutating server actions checked by scanner patterns.
- Restore/deploy: DB restore holds restore, upload-contract, color-backfill, and semantic-backfill locks; durable maintenance and admin mutation drains are present. Deploy auto-prune runs only after health success and persistent app data is bind-mounted. Host nginx changes remain operator-applied, which is clearly documented.
- Migration safety: the journal still contains historical non-monotonic entries, but `migrate.js` has hash/postcondition and DML-baseline guards. Latest entries are above the current max and the authoring rule is documented.
- Privacy/public routes: `publicSelectFields` and `publicMapSelectFields` have compile-time guards; shared photo/group metadata avoids unthrottled existence lookups; smart collection page/layout/load-more all check `is_public` before rendering rows.
- Product boundary: no current Stripe/payment route or dependency surfaced; storage abstraction remains quarantined from live upload/serve paths; edit/cull/score language is scoped to metadata edits.

Residual risk: this was source review, not a live production or browser-flow audit. I did not verify real CLIP weights, production DB contents, applied host nginx config, or e2e behavior against the temporary MySQL container.

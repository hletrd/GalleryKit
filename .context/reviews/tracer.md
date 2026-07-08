# Run-10 Cycle 36 Tracer Review

Date: 2026-07-08 KST
Role: cycle-36 tracer + causal/data-flow review worker
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `c62c8c1e` on `master` / `origin/master`
Mode: review-only; no production-code edits

## Inventory

Required instructions read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions.

Relevant repo surfaces inventoried before tracing:

- Operating docs and provenance: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/plans/README.md`, `.context/plans/run10-cycle35/{plan,deferred}.md`, previous root `tracer.md` and `document-specialist.md`.
- Runtime/deploy/schema: root `package.json`, `apps/web/package.json`, `.github/workflows/*`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`.
- Causal/data-flow source clusters: admin/server actions under `apps/web/src/app/actions/`, admin restore in `apps/web/src/app/[locale]/admin/db-actions.ts`, public routes under `apps/web/src/app/api/**` and `apps/web/src/app/[locale]/(public)/**`, data/privacy selectors in `apps/web/src/lib/data.ts`, upload/delete/processing in `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, sidecar and in-app backfills, semantic search/CLIP modules, restore drains, rate limiters, and service-worker caching.

## Findings

### TRC-C36-01 - Independent background capacity budgets can over-subscribe the shared DB pool

- Classification: confirmed
- Severity: High
- Confidence: High
- Region: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/lib/background-db-writes.ts:8-75`
- Failure scenario: the image queue and in-app color backfill each reserve roughly half of the same 10-connection pool as if they were the only background owner. With `QUEUE_CONCURRENCY` effectively 2 and admin color backfill effectively 2, the queue can pin about four processing/claim connections while the backfill pins one whole-run advisory connection plus four worker/update connections. Analytics writes can also run two DB writes. Foreground photo routes that fan out DB reads then queue behind encode-duration work despite each subsystem's local "leave live headroom" proof.
- Suggested fix: add a process-wide background resource coordinator shared by image processing, in-app color backfill, semantic embedding work, maintenance, and analytics. The coordinator should admit work against one pool/CPU budget and expose current reservations. Add a small-pool regression that starts queue processing plus admin backfill plus analytics writes and proves foreground DB acquisition still has reserved headroom or that one background lane is refused/throttled.

### TRC-C36-02 - Semantic embeddings have multiple active writers that do not share one ownership gate

- Classification: likely
- Severity: Medium
- Confidence: High
- Region: `apps/web/src/lib/image-queue.ts:501-539`; `apps/web/src/lib/image-queue.ts:542-637`; `apps/web/src/lib/image-queue.ts:981-1008`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-134`; `apps/web/src/lib/clip-model.ts:53-173`
- Failure scenario: a production CLIP sidecar holds `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, but live upload side effects and `bootstrapMissingActiveEmbeddings()` do not observe that lock before scanning, embedding, and upserting rows. The DB upsert/model-version design prevents duplicate rows, so this is not a data-corruption finding. The failure mode is resource contention and duplicate ONNX inference: live bootstrap or post-upload embedding can consume the same in-process CLIP queue and DB pool while the operator backfill is trying to converge production rows, causing visitor semantic searches to hit queue-full/timeout or extending activation backfill time.
- Suggested fix: have live semantic bootstrap/upload embedding observe the semantic backfill advisory lock, or move all embedding writes through one durable queue/lease table. If live uploads must keep embedding during backfill, make the policy explicit with shared admission limits and tests proving visitor query slots remain available.

### TRC-C36-03 - Color sidecar batch flushing weakens per-image claim ownership

- Classification: risk
- Severity: Low-Medium
- Confidence: Medium
- Region: `apps/web/scripts/backfill-color-pipeline.ts:471-527`; `apps/web/scripts/backfill-color-pipeline.ts:557-603`
- Failure scenario: each sidecar worker acquires a per-image processing claim, re-encodes, pushes its row into global `updateBatch` / `derivativeBatch`, then calls `flushBatch()` before releasing its claim. Because those batches are process-global, worker A can splice and persist worker B's queued row. Worker B can then see no pending update in its own `flushBatch()`, return, and release B's per-image claim while worker A's transaction is still updating B. Current global color-backfill locking and processed-row filters make the practical blast radius low, but the code no longer strictly guarantees that the worker holding an image's claim also holds it until that image's DB persistence is complete.
- Suggested fix: make `flushBatch()` operate on caller-owned items, or attach per-item completion/release callbacks so a row's claim cannot be released until the transaction that includes that row has committed and deleted-mid-reencode cleanup has been scheduled. Add a concurrency regression with two workers where one flushes the other's item and assert the second claim remains held through commit.

## Cross-File Interactions Cleared

- Restore/import path: `restoreDatabase()` acquires restore, upload-contract, color-backfill, semantic-backfill, and alt-text locks before setting durable maintenance; it then drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutation slots before import. No new restore-over-live-write defect was found.
- Migration path: `migrate.js` still separates pending migrations from drift, refuses unsafe DML baselining, reconciles fresh DBs, and asserts all journal hashes after Drizzle migrate. No new schema cursor/hash defect was found.
- Public rate-limit path: public search, similar search, OG, feed, load-more, and view-recording flows pre-increment or check rate limits before expensive DB/processing work in the inspected routes/actions.
- Privacy selectors: public data, map data, search enrichment, and semantic/similar enrichment continue to use explicit sensitive-field omissions plus compile/source tests. No new GPS/original filename leak was found.
- Upload/delete path: browser upload, LR upload, queue processing, delete, deleted-mid-processing cleanup, and pending file deletions remain fenced by restore checks/locks and durable retry rows in the inspected source.

## Validation Evidence

Fresh commands run:

```bash
git status --short
git log --oneline --decorate -8
git show --show-signature -s --format='%h %G? %GS%n%B' HEAD
rg --files ...
rg -n "withAdminAuth|requireSameOriginAdmin|preIncrement|isRestoreMaintenanceActive|..." apps/web/src apps/web/scripts scripts apps/web/nginx
```

Observed:

- Worktree was clean before this report edit.
- `HEAD` and `origin/master` both pointed at signed commit `c62c8c1e`.
- The previous C35 nginx public-limiter documentation mismatch is fixed in `CLAUDE.md:248` and `apps/web/nginx/default.conf:274-295`.

## Final Missed-Issue Sweep

Explicitly swept: restore races, untracked background writes, upload/LR restore admission, delete/processing orphan windows, migration drift/baseline hazards, public API rate-limit order, admin action origin/mutation barriers, semantic-search activation gates, CLIP model-version reads/writes, service-worker cached-image freshness, Docker deploy/prune guarantees, nginx catch-all routing, and public privacy field leakage.

Skipped or sampled: historical archive reviews/plans, binary fixtures/assets, runtime upload/resource/backups directories, `.next`, `node_modules`, and live production host state. No browser, deployment, production DB, nginx reload, or CLIP real-weight smoke was performed in this review-only lane.

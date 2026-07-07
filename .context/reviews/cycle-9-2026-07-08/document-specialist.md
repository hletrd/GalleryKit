# Document-Specialist Review - Cycle 19 Prompt 1

Date: 2026-07-08 KST
Reviewer lane: document-specialist
Scope: comprehensive docs/code mismatch review against authoritative repo sources.

Constraints honored: review-only; no implementation fixes, no commits, no pushes, no deploys. The only file written by this lane is `.context/reviews/document-specialist.md`. Other review-lane worktree edits were left untouched.

## Inventory And Coverage

Required context read:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.context/plans/README.md`
- Current `.context/plans/*cycle-18*`, `.context/plans/*cycle-19*`, deferred carry-forward, root `plan/plan-374-cycle18-fixes.md`, `plan/plan-375-cycle18-deferred.md`, `plan/done/plan-376-cycle19-fixes.md`, `plan/plan-377-cycle19-deferred.md`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `apps/web/__test_fixtures__/color/README.md`

Code/test surfaces reviewed against those docs:

- Package scripts and workspace commands: root `package.json`, `apps/web/package.json`
- Remote/local deploy helpers: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, Dockerfile, Compose, nginx config, health/live routes
- Migration/schema contracts: `apps/web/scripts/migrate.js`, Drizzle journal, schema, reconcile logic, migration tests
- Security gates: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, admin/public API routes
- Auth/origin/rate-limit/proxy contracts: `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, nginx edge comments
- CLIP semantic search activation/backfill: model path/model loader, sidecar scripts, semantic/similar routes, server action, CLIP tests
- Storage/upload/image pipeline: upload actions, LR upload route, upload paths, original privacy guard, GPS stripping, color/HDR pipeline comments/tests
- Public/admin route behavior, i18n, privacy selectors, search enrichment privacy guard, touch-target/focus/i18n source tests
- `.context` review, aggregate, plan, deferred, and carry-forward ledgers

Skipped: live production host state, secret env files, runtime upload/data directories, binary screenshots/assets, build output, `node_modules`, and historical archive files unless current docs linked or conflicted with them. No external web lookup was needed because every finding is repo-local.

## Findings

### DOC-C19-01 - CLIP backfill can exit "complete" while the documented embedding-attempt budget remains

Severity: Medium
Confidence: High
Status: Confirmed docs/code mismatch.

Files/regions:

- `CLAUDE.md:597-600`
- `apps/web/README.md:84-85`
- `apps/web/scripts/backfill-clip-embeddings.ts:159-189`
- `apps/web/scripts/backfill-clip-embeddings.ts:201-205`
- `apps/web/scripts/backfill-clip-embeddings.ts:239-244`
- `apps/web/src/app/actions/embeddings.ts:141-168`
- `apps/web/src/app/actions/embeddings.ts:179-183`
- `apps/web/src/app/actions/embeddings.ts:211`

Mismatch:

The runbook says `SEMANTIC_SCAN_LIMIT` is an embedding-attempt budget, missing-original candidates can be scanned/skipped without consuming it, and operators should repeat the sidecar command until it finishes without the "Reached SEMANTIC_SCAN_LIMIT" message. The sidecar and the unwired server action both fetch `limit(Math.min(BATCH_SIZE, remainingEmbeddingBudget))`, but then decide "no more rows" with `rows.length < BATCH_SIZE` / `pending.length < BACKFILL_BATCH_SIZE`. When the remaining attempt budget is smaller than the batch size, a partial fetch can satisfy the SQL limit, skip missing-original rows without incrementing `attemptedEmbeddings`, and still break as if the backlog ended.

Concrete failure scenario:

After 950 successful embeddings in a run, `remainingEmbeddingBudget` is 50. The next 50 candidate rows are missing originals, so they are skipped and do not consume budget. Because `rows.length` is 50 and `BATCH_SIZE` is 100, the sidecar exits without the scan-limit message even if valid later rows still lack embeddings. An operator following the docs can stop after a "complete" run and enable production search with older valid photos still unembedded.

Suggested fix:

In both backfill paths, compare the fetched row count to the actual fetch limit, not the fixed batch size, and continue when skipped rows leave attempt budget available. For example, store `const fetchLimit = Math.min(BATCH_SIZE, remainingEmbeddingBudget)` and break only on `rows.length < fetchLimit`. Add a regression where a budget-limited partial batch contains only skipped rows followed by valid rows. Keep the docs' embedding-attempt-budget wording if that behavior is preserved.

### DOC-C19-02 - Current-cycle release ledger still says Cycle 18 commit/push is pending after the signed Cycle 18 commit is current HEAD

Severity: Medium
Confidence: High
Status: Confirmed provenance mismatch.

Files/regions:

- `.context/plans/cycle-18-2026-07-08-plan.md:133-140`
- `.context/plans/cycle-18-2026-07-08-plan.md:142-157`
- `.context/plans/README.md:34-43`
- Current git evidence: `git log -1` reports `6efd737b fix(cycle18): harden review-plan-fix findings` at `HEAD`, `origin/master`, and `origin/HEAD`; that commit includes the Cycle 18 plan/index/review files.

Mismatch:

The Cycle 18 plan records all work packages and local gates as done, but still leaves "WP5 signed commit/push and per-cycle deploy finalization" unchecked. The index still calls Cycle 18 the active current-cycle plan "from Cycle 18 aggregate at HEAD `a1863405`", while the repository's current tracked HEAD is the pushed Cycle 18 fix commit `6efd737b`.

Concrete failure scenario:

A later lane reads `.context/plans/README.md` and believes Cycle 18 is still active from `a1863405`, then re-plans already-committed work or misses the real remaining gap. The commit message says live deploy was not tested and "per-cycle deploy runs after push", so the accurate state is not "commit/push pending"; it is "commit/push complete, deploy evidence still absent unless another ledger records it."

Suggested fix:

Update the Cycle 18 plan and plan index to record `6efd737b` as committed/pushed. If no deploy transcript exists, keep that as an explicit deployment evidence gap instead of leaving commit/push and deploy conflated in one unchecked item.

### DOC-C19-03 - Carry-forward register says the current check is run-10 c18 but its table still labels ages as run-10 c4

Severity: Low-Medium
Confidence: High
Status: Confirmed ledger mismatch.

Files/regions:

- `.context/plans/deferred-carry-forward.md:19-27`
- `.context/plans/deferred-carry-forward.md:36-40`
- `.context/plans/deferred-carry-forward.md:122-138`
- `.context/plans/cycle-18-2026-07-08-plan.md:16-37`

Mismatch:

Cycle 18 WP1 explicitly required the carry-forward register to remain mechanically auditable, and the prose now says "Age-budget check (run-10 c18)." The table header still says `Age @ r10c4` even though the table includes `C17-register`, `C18-*`, and loop-B rows with later-cycle ages.

Concrete failure scenario:

The age-budget policy in `.context/plans/README.md` depends on this register for High/Medium re-review. A maintainer or agent reading the table header can undercount aged deferred findings by 14 cycles, skip the 8-cycle High rule or 16-cycle Medium checkpoint, and keep carrying stale items without the required re-justification.

Suggested fix:

Refresh the table label and age values to the current cycle basis, or split historical rows from current-cycle rows with explicit "age as of" columns. Add a short note when dual review loops share the register so loop-B rows do not obscure run-10 cycle age accounting.

### DOC-C19-04 - Unindexed root-level Cycle 19 plan/deferred files collide with the current Cycle 19 review context

Severity: Low-Medium
Confidence: High
Status: Confirmed provenance risk.

Files/regions:

- `.context/plans/cycle-19-plan.md:1-5`
- `.context/plans/cycle-19-plan.md:52-58`
- `.context/plans/cycle-19-deferred.md:1-6`
- `.context/plans/cycle-19-deferred.md:24-26`
- `.context/plans/README.md:34-43`
- `.context/reviews/_aggregate.md:1-7`

Mismatch:

`.context/plans/cycle-19-plan.md` is a completed "Cycle 19" plan from planning HEAD `5c559a0f` and claims its source is `.context/reviews/_aggregate.md`. The current `_aggregate.md` is Cycle 18 at reviewed HEAD `a1863405`, and the plan index does not list these `cycle-19-*` files as active, recently completed, or archived. In the current prompt, "cycle 19" refers to this new review cycle, so these unindexed older files are easy to mistake for current instructions.

Concrete failure scenario:

A current Cycle 19 lane searches for `cycle-19-plan.md`, finds the old completed plan, and treats its deferred/security/a11y scope as the current cycle's source of truth. That can hide the actual current aggregate state and produce duplicate or wrong scheduling.

Suggested fix:

Archive or rename the older files with a run/date prefix that cannot collide with run-10 cycle numbering, and add an index entry marking them historical. If they should remain current, update `_aggregate.md` provenance and the plan index so the source/HEAD references are true.

### DOC-C19-05 - Upload pipeline comment overstates heap-safety compared with the actual entrypoints

Severity: Low
Confidence: High
Status: Confirmed source-comment mismatch.

Files/regions:

- `apps/web/src/lib/process-image.ts:882-887`
- `apps/web/src/app/api/admin/lr/upload/route.ts:180-183`
- `apps/web/src/app/actions/images.ts:184-260`
- `CLAUDE.md:655-658`
- `.context/reviews/_aggregate.md:67-75`

Mismatch:

`saveOriginalAndGetMetadata` says it streams to disk first "to avoid materializing up to 200MB on the heap." Within that helper it does avoid an additional `arrayBuffer()` copy, but the actual upload entrypoints already receive materialized `File`/`FormData` objects: LR upload calls `request.formData()`, and the dashboard server action receives `File[]` from the framework. `CLAUDE.md` correctly documents that multipart uploads are buffered on the heap before the disk-streaming step.

Concrete failure scenario:

A future reviewer sees the helper comment, concludes the upload path is end-to-end streaming, and deprioritizes the documented RSS/multipart risk or rejects a streaming route-handler migration as unnecessary. The mismatch is not that the helper is wrong to stream; it is that the comment makes the memory boundary sound broader than it is.

Suggested fix:

Reword the comment to say the helper streams the already-received `File` to disk to avoid an additional full-size buffer/copy, while framework multipart parsing remains the outer memory boundary documented in `CLAUDE.md`.

## Validated Matches

- Package scripts: README/AGENTS command names match root and app `package.json` for lint, typecheck, build, unit/e2e tests, CLIP preflight, and deploy.
- Deploy helper: env precedence, SSH derivation, `DEPLOY_REMOTE_SCRIPT`/`DEPLOY_CMD`, deploy-host `git pull --ff-only`, health check, and post-up Docker prune match README/CLAUDE/AGENTS. The only unverified part is live deploy execution evidence.
- Schema/migrations: migration journal, `when` warning, hash postcondition, and `reconcileLegacySchema` contract match `migrate.js`, schema, and migration tests.
- Security gates: admin API auth, mutating action origin, and public route rate-limit scanner docs match scanner behavior and current route posture.
- Auth/proxy/rate-limit docs: `TRUST_PROXY`, forwarded host/proto, same-origin fail-closed, nginx public/nextimage/admin/login limits, and health/live endpoint docs match code/config.
- Storage/upload/privacy: private-original path, legacy public-original production guard, LR upload contract, response shape, PAT route admission, GPS fail-closed policy, and privacy selector guards match current code, except for DOC-C19-05's helper comment wording.
- CLIP activation: model path, offline weights, env opt-in, production/stub/disabled gates, `model_version` honesty, public same-origin/rate-limit posture, and scan/top-K route limits match current code, except for DOC-C19-01's backfill-loop completion condition.
- i18n/privacy: EN/KO key parity, Korean plural convention, privacy-sensitive key guards, search-enrichment field guard, and public/admin selector split match current tests and code.
- Historical docs under `docs/superpowers/` are clearly labeled as historical design/implementation records and point readers back to current CLAUDE/app README runbooks.

## Manual-Validation Risks

No new manual-validation-only mismatch was promoted. Static repo review still cannot prove live host deploy state, nginx/proxy application, CLIP weights, production DB mode, or runtime env. That risk is already documented in `.context/plans/cycle-18-2026-07-08-deferred.md:30` and remains the correct operator boundary: require deploy transcripts, health smokes, CLIP preflight, semantic/similar smoke when enabled, and proxy topology checks before making live-state claims.

## Final Sweep

Examined categories: README/app README/CLAUDE/AGENTS, `.context` plans/deferred/aggregate/current plans, docs/runbooks, package scripts, deploy helpers, migrations/journal/reconcile, lint gates, auth/origin/rate-limit/proxy, CLIP semantic search activation/backfill, storage/upload/image pipeline, public/admin routes, i18n/privacy tests, and contract-heavy comments.

Skipped categories: live production state, secrets, runtime data/uploads, binary screenshots/assets, build artifacts, `node_modules`, and unrelated historical archives not referenced by current docs.

## Spot-verification note (this pass)

Before landing this file in the cycle-9-2026-07-08 folder, DOC-C19-01's core claim was re-checked directly against `apps/web/scripts/backfill-clip-embeddings.ts` current source: the loop fetches `limit(Math.min(BATCH_SIZE, remainingEmbeddingBudget))` but the loop-continuation check is `if (rows.length < BATCH_SIZE) break;` — confirmed still present verbatim, so the finding holds against current HEAD.

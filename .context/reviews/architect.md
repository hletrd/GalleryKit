# Architect Review - Cycle 6/100

Review target: current `HEAD` only, `5443009e411113bf97fe2d8fcb166b2ac78625fb`.

I read `AGENTS.md` and `CLAUDE.md` first, then exported `HEAD` to `/tmp/gallery-head-review.AEgK4R` and performed the review from that snapshot so unrelated worktree edits were not part of the inspection.

## Inventory Built Before Findings

Scope inventory from `HEAD`:

- Repository/docs: `AGENTS.md`, `CLAUDE.md`, root/app package files, deployment docs embedded in config/scripts, existing `.context/reviews/architect.md`, `.context/reviews/_aggregate.md`, and relevant current/deferred plan notes.
- App structure: `apps/web/src/app` public pages, admin pages/actions, API routes, route handlers, i18n-aware public routes, and server actions.
- Data/schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, all `apps/web/drizzle/0000` through `0024` SQL files, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration monotonicity/reconcile tests.
- Core data ownership and privacy boundaries: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, public/admin select fields, privacy guard tests, map/shared/photo/search read paths.
- Runtime/deploy architecture: `apps/web/Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/entrypoint.sh`, `next.config.ts`, `nginx/default.conf`, `instrumentation.ts`, queue bootstrap/shutdown.
- Cross-feature invariants: upload pipeline, Lightroom upload parity, restore maintenance, advisory locks, image queue, smart collections/topic rename, semantic search, rate limits, service worker/cache, analytics, backup/restore.
- Tests and static gates: `src/__tests__` contracts for privacy fields, migration journal/reconcile, restore/upload locks, semantic search/similar search, LR upload, action-origin, API auth, public-route rate limits, client/server boundaries, upload limits, and relevant source-contract tests.

The inspection was not a random sample: I used file inventories plus targeted cross-file reads around every architecture-sensitive surface above, then a final `rg` sweep for route exports, auth/origin/rate-limit calls, sensitive field references, migration/reconcile terms, advisory locks, and restore/queue interactions.

## Confirmed Issues

### ARCH-C6-01 - Restore resumes traffic and queue work after post-restore migration failure

Severity: High
Confidence: High
Area: runtime restore lifecycle, schema/migration contract, queue ownership

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:521-540` runs `runPostRestoreMigrations(t)` after a successful `mysql` import and resolves `{ success: false }` if migrations fail.
- `apps/web/src/app/[locale]/admin/db-actions.ts:362-366` wraps `runRestore(...)` in a `finally` that always calls `endRestoreMaintenance()` and `resumeImageProcessingQueueAfterRestore()`, regardless of whether `runRestore` failed because post-restore migrations failed.
- `CLAUDE.md:209` documents the intended restore contract: database restore runs committed migration/reconcile postconditions after import. The operational invariant only holds if the app stays in maintenance and queues remain stopped when that postcondition fails.

Why this is a problem:

The restore flow correctly added a post-import migration step, but failure handling is still coupled to the generic cleanup `finally`. A restored dump can be imported successfully, fail the current migration/reconcile/post-condition step, and then the app immediately leaves restore maintenance and resumes image-processing work. That recreates the exact schema/runtime split the migration postcondition is supposed to prevent.

Concrete failure scenario:

An admin restores an older SQL dump that lacks a current column or has stale `__drizzle_migrations` state. The `mysql` import exits `0`, then `scripts/migrate.js` fails because `reconcileLegacySchema`, journal hash validation, or admin seeding cannot complete. The restore action returns an error to the admin, but the `finally` still ends maintenance and resumes the queue. Public requests and queue workers can now execute current code against the partially restored or stale schema, causing unknown-column errors, failed image jobs, or writes made against an unverified database state.

Suggested fix:

Make the restore lifecycle conditional on the migration result. Keep restore maintenance active and keep the queue quiesced when post-restore migrations fail. One clean shape is for `runRestore` to return a structured status such as `{ success, migrationVerified }`; only call `endRestoreMaintenance()` and `resumeImageProcessingQueueAfterRestore()` when the import and post-restore migrations both succeeded. On failure, release advisory locks as needed but leave the process in an explicit maintenance/error state that requires a successful retry, restart, or operator intervention. Add a test that simulates `runPostRestoreMigrations` failure and asserts `endRestoreMaintenance` and queue resume are not called.

### ARCH-C6-02 - Public semantic search accepts multi-kilobyte queries despite the documented short-query contract

Severity: Medium
Confidence: High
Area: public API resource bounds, semantic-search architecture, cross-feature validation invariants

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:93-95` says semantic queries are short strings under 200 code points and uses that assumption to justify an 8 KiB body cap.
- `apps/web/src/app/api/search/semantic/route.ts:204-231` parses `body.query`, trims it, checks only `countCodePoints(query) < 3`, then calls `embedTextReal(query)` or `embedTextStub(query)`.
- The ordinary public text-search action enforces the 200-code-point invariant at `apps/web/src/app/actions/public.ts:237-243`, and `apps/web/src/lib/data.ts:1476-1483` repeats the same max-length guard for SQL-backed search.
- `apps/web/src/__tests__/semantic-search-route.test.ts:177-187` covers oversized byte bodies and `apps/web/src/__tests__/semantic-search-route.test.ts:209-214` covers too-short queries, but there is no test for over-200-code-point semantic queries.

Why this is a problem:

The semantic endpoint is the expensive search surface: in production it loads/runs the CLIP text encoder and scans up to `SEMANTIC_SCAN_LIMIT` embeddings. Its own design comments and the rest of the public search stack assume short user queries, but the route permits any query that fits in the 8 KiB JSON body. That makes the actual API contract broader than the documented/resource-budgeted contract.

Concrete failure scenario:

A same-origin client script or compromised page path sends repeated semantic-search requests with 7-8 KiB query strings. Each accepted request consumes a semantic rate-limit token only after mode/config checks, then invokes tokenizer/model work and the embedding scan. Even at 30 requests/min/IP, this is materially more CPU/memory work than the intended short-query path and may surface tokenizer/model latency or errors that normal search validation prevents.

Suggested fix:

Define a shared semantic query limit constant, likely 200 code points to match `searchImagesAction` and the route comment, and enforce it immediately after trimming and before `embedTextReal` / `embedTextStub`. Return `400` for over-limit queries. Add a route test for a 201-code-point query and a client/source-contract test if the frontend has a separate semantic input guard.

## Likely Issues

None filed. I found several historically risky areas, but current `HEAD` has explicit contracts or tests around them: topic slug rename fan-out, public selector privacy guards, migration journal non-monotonicity, shared-link metadata enumeration, Lightroom upload parity, and map GPS visibility.

## Risks Needing Manual Validation

No new manual-validation-only risks filed as findings. Existing deferred risks, especially single-instance/process-local state if the deployment topology changes, remain documented elsewhere and were not re-filed because this review focused on current `HEAD` behavior.

## Missed-Issues Sweep

Final sweep performed:

- Re-checked all API route files under `apps/web/src/app/api/**/route.*` for auth, origin, runtime pinning, and rate-limit ownership.
- Re-checked mutating server actions for `requireSameOriginAdmin()` and restore-maintenance boundaries.
- Re-checked public data selectors and sensitive field references for accidental latitude/original/admin-only leakage.
- Re-checked topic rename, smart collections, image queue, LR upload, and backfill locks for cross-feature ownership.
- Re-checked migration journal/reconcile contracts, including the current restore migration fix that closed the older cycle-5 restore issue except for the failure-resume gap filed above.
- Re-checked runtime/deploy files for bind-mount/data ownership, migration-before-start, Docker pruning safety, native runtime assumptions, and signal handling.

Relevant files intentionally not inspected line-by-line:

- Historical `.context/reviews/**` and `.context/plans/**` archives beyond the current architect report, aggregate notes, and relevant restore/migration/deferred references. They are review history, not executable current `HEAD` behavior.
- Binary/static assets, generated screenshots, icons, image fixtures, and test-result artifacts.
- Generated Drizzle snapshot JSON files were not fully line-read; the authoritative migration SQL, journal, schema, and reconcile tests were inspected instead.
- `package-lock.json` was not audited dependency-by-dependency; this was an architecture/design review rather than a dependency/security audit.

No fixes were implemented.

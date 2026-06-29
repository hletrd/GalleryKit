# Debugger Review - Cycle 6/100

Scope: deep latent bug/failure-mode review of current `HEAD` only in `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read `AGENTS.md` and `CLAUDE.md` from `HEAD` before reviewing code.
- No fixes implemented, no commit, no push, no deploy.
- Existing unrelated review-file worktree changes were not reverted or overwritten.

## Inventory Before Findings

Tracked HEAD inventory reviewed for bug-relevant surfaces:
- Total tracked files: 2504
- Config/docs roots: `AGENTS.md`, `CLAUDE.md`, root/workspace package files, Next/Vitest/TS/Drizzle/site config: 11 config-like files counted
- App routes/actions: 76 files under `apps/web/src/app`
- Components: 55 files under `apps/web/src/components`
- Shared library/runtime code: 94 files under `apps/web/src/lib`
- DB schema/index: 3 files under `apps/web/src/db`
- Tests: 253 files under `apps/web/src/__tests__`
- Scripts: 27 files under `apps/web/scripts`
- Migrations/meta: 28 files under `apps/web/drizzle`
- E2E: 8 files under `apps/web/e2e`

Review-relevant areas inspected:
- Upload and processing: browser uploads, Lightroom upload API, disk quota checks, original-file handling, GPS strip, queue retry/permanent-failure behavior, delete-mid-processing cleanup, restore quiesce/resume.
- Database and migrations: Drizzle schema, migration journal, `scripts/migrate.js`, legacy reconcile, restore post-condition, SQL restore scanner.
- Public surfaces: photo/topic/share pages, upload serving, OG routes, semantic/similar search APIs, public server actions, sitemap/feed.
- Admin surfaces: DB backup/restore, settings/SEO/collections/topics/tags/sharing/users, auth/origin/rate-limit guards.
- Tests/linters: guard linters and targeted tests listed under validation.

## Confirmed Issues

### DBG-C6-01 - Restore can wedge maintenance/locks if final revalidation throws

Severity: High
Confidence: High

Code region:
- `apps/web/src/app/[locale]/admin/db-actions.ts:521-540`
- `apps/web/src/lib/revalidation.ts:59-61`

Problem:
`runRestore()` resolves its Promise from an async `restore.on('close', async ...)` handler. On the successful mysql-import path it awaits migrations, logs audit, calls `revalidateAllAppData()`, then resolves success:

```ts
const migrationResult = await runPostRestoreMigrations(t);
...
revalidateAllAppData();
resolve({ success: true });
```

`revalidateAllAppData()` is a bare wrapper around `revalidatePath('/', 'layout')` with no local `try/catch`. Other revalidation helper code explicitly catches `revalidatePath` failures, so this is not treated as an impossible operation elsewhere.

Failure scenario:
1. Admin restore succeeds and post-restore migrations pass.
2. `revalidatePath('/', 'layout')` throws due to a Next runtime/cache-store failure.
3. The async event handler rejects before `resolve({ success: true })`.
4. The Promise returned by `runRestore()` never settles.
5. `restoreDatabase()` never reaches its inner `finally`, so `endRestoreMaintenance()`, queue resume, `LOCK_DB_RESTORE` release, backfill-lock release, and upload-contract-lock release do not run.
6. Uploads, image processing, health checks, and future restores remain wedged until process/container restart.

Suggested fix:
Wrap final revalidation in a non-fatal error boundary before resolving restore success, or make `revalidateAllAppData()` internally match `revalidateLocalizedPaths()` by catching/logging `revalidatePath` failures. Add a restore regression test where `revalidateAllAppData` throws and assert restore still resolves and cleanup paths execute.

## Likely Issues

### DBG-C6-02 - Semantic indexing is outside the queue retry contract

Severity: Medium
Confidence: High

Code region:
- `apps/web/src/lib/image-queue.ts:490-567`
- `apps/web/src/app/actions/embeddings.ts:103-172`
- `apps/web/src/app/api/search/semantic/route.ts:238-257`

Problem:
After image processing marks an image `processed=true`, semantic embedding generation/storage runs in a fire-and-forget IIFE. Failures are logged and swallowed:

```ts
void (async () => {
  ...
  await db.insert(imageEmbeddings)...
})().catch-equivalent via local catch;
```

This means queue retry state, `processing_error`, `failed_at`, bootstrap retry, and permanent-failure tracking never see an embedding failure. The canonical repair path is a manual/admin backfill action or script, not an automatic retry.

Failure scenario:
1. Semantic mode is `production` or `stub`.
2. Sharp processing succeeds; the image row is committed as processed.
3. CLIP model loading, original-file access, or the `image_embeddings` upsert fails transiently.
4. The queue logs `[Queue] Failed to store embedding...` but still logs job complete.
5. Production semantic search only scans existing rows for the active `model_version`; if at least one embedding exists, the route does not surface "not fully configured" and silently omits the failed image from search results.

Suggested fix:
Move embedding work into a durable retry contract. Practical options: add a separate embedding queue/table with status + retry count, persist an embedding failure marker on the image, or have bootstrap/backfill automatically select processed images missing the active `model_version`. Keep the Sharp processing success path non-blocking if desired, but do not make missing embeddings depend on humans noticing logs.

## Risks Needing Manual Validation

### DBG-C6-RISK-01 - Post-commit `revalidateAllAppData()` failures can create false mutation failures

Severity: Low
Confidence: Medium

Code regions:
- `apps/web/src/app/actions/collections.ts:45-60`, `95-108`, `122-130`
- `apps/web/src/app/actions/settings.ts:136-164`
- `apps/web/src/app/actions/seo.ts:140-164`
- `apps/web/src/lib/revalidation.ts:59-61`

Risk:
Several admin actions call `revalidateAllAppData()` after the database mutation/audit work but still inside the action `try` block. If `revalidatePath('/', 'layout')` throws, the mutation has already committed, but the action returns a generic failure. For create actions this can encourage a retry that hits duplicate-key behavior; for update actions it can make the UI report failure despite persisted changes.

Manual validation needed:
Confirm whether `revalidatePath('/', 'layout')` can throw in the deployed Next.js runtime outside test mocks. If it can, make app-wide revalidation best-effort like localized revalidation and add tests for "DB write succeeded, revalidation failed" behavior.

## Non-Findings / Ruled Out

- Admin API routes are covered by `withAdminAuth(...)`; `lint:api-auth` passed.
- Mutating admin server actions enforce `requireSameOriginAdmin()` or carry explicit read/public exemptions; `lint:action-origin` passed.
- Public mutating API routes are rate-limited; `lint:public-route-rate-limit` passed.
- Public analytics recorders looked suspicious at first, but current HEAD imports them only from server-rendered public pages after the entity has already been validated (`getImage`, `getSharedGroupCached`, topic lookup). They are not re-exported through the client action barrel.
- SQL restore scanning was checked against current schema/migration tests. Known app-table `DROP TABLE IF EXISTS` statements are intentionally allowed for own-backup restores and covered by tests.
- Upload original serving was checked: public download links use generated JPEG/AVIF derivatives, not private originals.

## Validation Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web` - passed
- `npm run lint:action-origin --workspace=apps/web` - passed
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed
- `npm test --workspace=apps/web -- --run src/__tests__/restore-upload-lock.test.ts src/__tests__/revalidation.test.ts src/__tests__/semantic-search-route.test.ts` - passed, 3 files / 25 tests

Static sweeps run:
- Route exports and handler guards.
- Server action origin exemptions.
- Public action imports/callers.
- `TODO` / `FIXME` / `CAVEAT` / deferred-risk comments.
- Fire-and-forget `void` async work.
- Restore/queue lock lifecycle and migration order.
- Semantic embedding writers/readers/backfill tests.

## Missed-Issues Sweep

Final sweep result: no additional confirmed access-control, upload-cleanup, restore-lock, migration-journal, or public-route rate-limit bugs found beyond the issues above.

Intentionally not inspected line-by-line:
- Binary/static assets, screenshots, generated reports, and visual fixtures.
- Historical archived reviews/plans except where grep surfaced relevant prior-risk context.
- All 253 tests in full prose detail; test inventory was complete and targeted contract tests were inspected/run for the reviewed failure modes.

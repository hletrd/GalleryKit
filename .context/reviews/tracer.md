# Tracer Review — review-plan-fix cycle 1 prompt 1

Date: 2026-06-22

Scope: causal tracing review of upload -> process -> queue -> public serve; admin auth -> mutation -> audit -> revalidation; DB backup/restore; semantic-search mode -> embedding generation -> query serving; shared links/groups; migration journal -> migrate script -> deploy.

Constraints honored: source code was not modified; no commit, push, or deploy was run. This review artifact is the only intended write.

## Inventory

Upload/process/serve:
- Browser upload action: `apps/web/src/app/actions/images.ts:107-553`
- Lightroom token upload route: `apps/web/src/app/api/admin/lr/upload/route.ts:57-499`
- Queue claim/encode/update/bootstrap: `apps/web/src/lib/image-queue.ts:243-579`, `apps/web/src/lib/image-queue.ts:628-751`
- Upload path roots and legacy original handling: `apps/web/src/lib/upload-paths.ts:11-80`
- Public derivative route helper: `apps/web/src/lib/serve-upload.ts:127-260`

Admin auth/mutation/audit/revalidation:
- API wrapper and origin checks: `apps/web/src/lib/api-auth.ts:49-121`, `apps/web/src/lib/action-guards.ts:37-44`, `apps/web/src/lib/request-origin.ts:79-107`
- Auth/session actions: `apps/web/src/app/actions/auth.ts:72-257`, `apps/web/src/app/actions/auth.ts:282-420`
- Audit/revalidation helpers: `apps/web/src/lib/audit.ts:8-51`, `apps/web/src/lib/revalidation.ts:30-56`
- Representative mutations: `apps/web/src/app/actions/settings.ts:40-167`, `apps/web/src/app/actions/sharing.ts:78-380`, `apps/web/src/app/actions/images.ts:555-887`

DB backup/restore:
- Admin DB actions: `apps/web/src/app/[locale]/admin/db-actions.ts:119-257`, `apps/web/src/app/[locale]/admin/db-actions.ts:266-520`
- Restore helpers/scanner: `apps/web/src/lib/db-restore.ts:21-33`, `apps/web/src/lib/sql-restore-scan.ts:12-150`
- Backup download route: `apps/web/src/app/api/admin/db/download/route.ts:22-101`

Semantic search:
- Embedding writers: `apps/web/src/lib/image-queue.ts:432-498`, `apps/web/src/app/actions/embeddings.ts:48-171`, `apps/web/scripts/backfill-clip-embeddings.ts:75-191`
- Embedding schema/helpers: `apps/web/src/db/schema.ts:256-286`, `apps/web/src/lib/clip-embeddings.ts:8-181`
- Query routes: `apps/web/src/app/api/search/semantic/route.ts:98-340`, `apps/web/src/app/api/search/similar/[id]/route.ts:57-240`
- Mode resolver/UI: `apps/web/src/lib/gallery-config.ts:126-145`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:649-680`

Shared links/groups:
- Share mutations: `apps/web/src/app/actions/sharing.ts:78-380`
- Public reads/pages: `apps/web/src/lib/data.ts:1115-1271`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:79-132`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:82-180`
- Analytics recording: `apps/web/src/app/actions/public.ts:353-405`, `apps/web/src/lib/data.ts:43-150`

Migration/deploy:
- Migrator/reconcile/baseline: `apps/web/scripts/migrate.js:144-160`, `apps/web/scripts/migrate.js:267-629`, `apps/web/scripts/migrate.js:636-778`
- Journal: `apps/web/drizzle/meta/_journal.json:1-174`
- Container startup/deploy: `apps/web/scripts/entrypoint.sh:1-39`, `apps/web/deploy.sh:1-60`

## Findings

### T1 — Confirmed issue: restore accepts DROP-only or incomplete app-table dumps

Severity: High
Confidence: High

Code region:
- `apps/web/src/lib/db-restore.ts:21-25` treats input beginning with `DROP` as a plausible SQL dump header.
- `apps/web/src/lib/sql-restore-scan.ts:33-37` whitelists `DROP TABLE IF EXISTS` for every app table.
- `apps/web/src/lib/sql-restore-scan.ts:120-137` masks those app-table drops before applying the dangerous-SQL patterns, including the general `DROP TABLE` detector.
- `apps/web/src/app/[locale]/admin/db-actions.ts:385-437` validates only header plausibility plus dangerous-pattern scan, then `apps/web/src/app/[locale]/admin/db-actions.ts:454-459` streams the file directly into `mysql --one-database`; `apps/web/src/app/[locale]/admin/db-actions.ts:493-507` treats exit code 0 as restore success.

Why this is a problem:
The scanner needs to allow `mysqldump`'s normal `DROP TABLE IF EXISTS <app_table>;` preambles, but it does not validate that an allowed app-table drop is paired with a corresponding `CREATE TABLE` and data section. A short or crafted restore file can therefore be considered safe while still destructively dropping core app tables.

Concrete failure scenario:
An admin accidentally uploads a truncated dump, or a malicious dump, whose body is only:

```sql
DROP TABLE IF EXISTS `images`;
```

The header is plausible because `DROP` is allowed. The app-table drop is masked before dangerous-SQL scanning. MySQL executes the drop and exits 0. The action returns success and revalidates the app, but the `images` table is gone and the gallery is broken until manual DB recovery.

Suggested fix:
Treat allowed app-table drops as valid only within a complete app-backup shape. At minimum, track each masked `DROP TABLE IF EXISTS <table>` and require a later `CREATE TABLE <same table>` before the next app-table drop or EOF. Stronger fix: restore into a temporary database/schema, assert required tables and minimal schema postconditions, then swap/import only after validation. If direct in-place restore remains necessary, reject DROP-only/incomplete dumps before launching `mysql`.

### T2 — Likely issue: stub and production semantic embeddings overwrite each other

Severity: Medium
Confidence: High

Code region:
- `apps/web/src/db/schema.ts:271-285` defines `image_embeddings` with `imageId` as the sole primary key; `modelVersion` is only part of a secondary index.
- `apps/web/scripts/backfill-clip-embeddings.ts:25-28` documents that the primary key is `image_id` and that upsert replaces any existing row in place.
- `apps/web/scripts/backfill-clip-embeddings.ts:165-176`, `apps/web/src/app/actions/embeddings.ts:142-153`, and `apps/web/src/lib/image-queue.ts:482-493` all upsert by `imageId` and set `modelVersion` to the active target.
- Query serving filters by model version at `apps/web/src/app/api/search/semantic/route.ts:234-256` and `apps/web/src/app/api/search/similar/[id]/route.ts:112-118`.

Why this is a problem:
The serving routes correctly filter on `model_version`, but the storage model keeps only one embedding row per image. Running any writer in a different mode replaces the existing vector and version. That makes `stub` and `production` mutually destructive operational states instead of independent partitions.

Concrete failure scenario:
Production has real `jina-clip-v2-d512-q8` embeddings. An admin or operator switches semantic search to `stub` for testing, or runs `scripts/backfill-clip-embeddings.ts` without `--production` while semantic search is enabled. The script selects rows that lack a stub-version row, but because the PK is only `image_id`, each insert hits duplicate key and overwrites the production vector with `stub-sha256-v1`. When production is re-enabled, the production routes ignore those rows and search/similar results disappear or become partial until an expensive production backfill is rerun.

Suggested fix:
Store embeddings by `(image_id, model_version)` with a composite primary or unique key, and update all upserts to target that pair. If keeping one row per image is intentional, add an explicit downgrade guard: refuse stub writes over a production row unless a clearly named `--force-downgrade`/admin action is used, and surface that production embeddings will be discarded.

### T3 — Risk needing manual validation: legacy public original-upload symlinks survive production startup

Severity: Medium
Confidence: Medium

Code region:
- `apps/web/src/lib/upload-paths.ts:24-27` defines the legacy original upload root under the public upload tree and the current private original root under `data/uploads/original`.
- `apps/web/scripts/migrate.js:58-95` migrates only `Dirent.isFile()` entries out of `public/uploads/original`; symlinks and directories are skipped.
- `apps/web/scripts/migrate.js:97-110` production startup assertion also counts only `entry.isFile()`, so a symlink in the legacy public original directory does not block startup.

Why this is a problem:
The product invariant is that originals are private and only processed derivatives are public. The route helper rejects `original/`, but files under `public/` can be served by Next's static file layer before the upload route helper participates. The migration/startup guard is meant to prevent old public originals from remaining, yet it ignores symlinks.

Concrete failure scenario:
A legacy deploy has `apps/web/public/uploads/original/photo.jpg` as a symlink to a private original, or to another readable file. The migration skip leaves it in place; the production assertion sees zero regular files and allows the app to boot. If the static server follows that symlink, `/uploads/original/photo.jpg` can expose content that the application-level derivative route would never serve.

Suggested fix:
Treat any entry in `public/uploads/original` as unsafe in production unless it is an empty directory structure explicitly allowed by policy. Use `lstat()`/Dirent checks to fail on symlinks, regular files, and unexpected directories, and consider deleting only after an explicit operator migration path. Add a regression test around the production assertion with a symlink fixture. Manually validate whether the deployed Next static server follows symlinks from `public/`; even if it does not today, failing closed here preserves the privacy invariant.

## Clean Traces

Upload -> queue -> public serve:
- Browser and Lightroom uploads both validate auth/origin or PAT scope, snapshot gallery config, check disk/quota, save the original, persist a pending image row, enqueue a bounded queue job, and revalidate public/admin surfaces.
- Queue jobs acquire a per-image MySQL advisory lock, verify the row is still pending, encode AVIF/WebP/JPEG, verify non-zero output files, then conditionally mark `processed=true`. Delete-mid-processing cleanup uses full derivative directory scans.
- Public derivative serving restricts top-level dirs to `jpeg`, `webp`, `avif`, checks extension-to-dir consistency, rejects symlinks/non-files, resolves realpaths under `UPLOAD_ROOT`, emits nosniff and revalidation-aware cache headers.

Admin auth -> mutation -> audit -> revalidation:
- `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit` all passed.
- Admin API routes are wrapped with `withAdminAuth`; mutating server actions return early on `requireSameOriginAdmin`; representative mutations log audit events and revalidate the affected public/admin paths.
- Audit writes are mostly fire-and-forget. That is an explicit availability tradeoff, not a confirmed correctness bug in this pass.

Shared links/groups:
- Share creation requires admin auth and same-origin, only permits processed images, rate-limits key creation, retries key collisions, logs fingerprints rather than raw keys, and public reads validate Base56 keys plus `processed=true`.
- Metadata generation intentionally avoids unthrottled share-key DB lookups; the page body performs the rate-limited lookup.

Migration journal -> migrate script -> deploy:
- The journal has non-monotonic `when` values, but `migrate.js` compensates by reconciling fresh/legacy schemas and inserting per-entry baseline hashes before Drizzle runs. The postcondition asserts every journal hash is recorded.
- `deploy.sh` runs `git pull --ff-only`, `docker compose ... up -d --build`, then Docker prune commands after the live container is up.

## Missed-Issues Sweep

Read/reviewed relevant files:
- `AGENTS.md`, `CLAUDE.md`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts` was searched for producer/variant references, but not exhaustively line-read because queue/process boundaries were enough for this tracer pass.
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-inference.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/db/schema.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/deploy.sh`

Read-only validation run:
- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed.

Not run:
- Full `npm test`, `npm run typecheck`, `npm run build`, and deploy were not run because the task requested a review artifact only and explicitly prohibited source-code changes, commits, pushes, and deploys.

Residual risks:
- T3 depends on deployed static-server symlink behavior and should be manually validated or locked with a fixture test.
- I did not exhaustively review every UI component, visual state, or all admin CRUD forms; this tracer pass stayed on the requested causal flows.

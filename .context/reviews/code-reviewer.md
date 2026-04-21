# Cycle 10 code-quality / logic / maintainability review

## Scope and inventory

### Inventory method
I first inventoried the repository, then focused review time on the non-generated code paths that actually participate in request handling, persistence, image processing, and cross-file routing behavior.

### Relevant files reviewed
- **Core server actions:**
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/topics.ts`
  - `apps/web/src/app/actions/tags.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/actions/seo.ts`
- **Admin DB / recovery paths:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/lib/sql-restore-scan.ts`
  - `apps/web/src/lib/db-restore.ts`
- **Data / persistence / routing helpers:**
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/revalidation.ts`
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/auth-rate-limit.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/validation.ts`
  - `apps/web/src/lib/restore-maintenance.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/gallery-config.ts`
  - `apps/web/src/lib/gallery-config-shared.ts`
  - `apps/web/src/lib/tag-slugs.ts`
- **Image pipeline / storage:**
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/process-topic-image.ts`
  - `apps/web/src/lib/storage/index.ts`
  - `apps/web/src/lib/storage/local.ts`
  - `apps/web/src/lib/storage/s3.ts`
  - `apps/web/src/lib/upload-tracker.ts`
- **Schema / route interaction:**
  - `apps/web/src/db/schema.ts`
  - `apps/web/drizzle/0001_sync_current_schema.sql`
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/proxy.ts`
- **High-logic client components checked for cross-file assumptions:**
  - `apps/web/src/components/home-client.tsx`
  - `apps/web/src/components/load-more.tsx`
  - `apps/web/src/components/search.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/components/lightbox.tsx`
  - `apps/web/src/components/image-manager.tsx`

### Explicitly excluded from deep review
- Generated/build artifacts: `.next/`, `test-results/`
- Installed dependencies: `node_modules/`
- Uploaded binary assets under `data/uploads/` and `public/uploads/`
- UI primitive wrappers under `src/components/ui/` except for spot checks where needed

## Verification performed
- `npm test` ✅ (23 files / 137 tests passed)
- `npx tsc --noEmit -p tsconfig.json` ✅
- `npx eslint src scripts e2e next.config.ts drizzle.config.ts playwright.config.ts vitest.config.ts --ext .ts,.tsx,.js,.mjs` ✅
- `npm run build` ✅
- Repo-wide pattern sweep for suspicious constructs (`console.log`, empty catch, hardcoded credentials, TODO/FIXME)
- Final targeted sweep for topic-route collisions, FK rename paths, and tag-linking edge cases

---

## Confirmed issues

### 1) New topic creation can silently shadow an existing alias route
- **Severity:** High
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/app/actions/topics.ts:34-104`
  - `apps/web/src/lib/data.ts:612-644`
- **Problem:**
  - `createTopic()` validates slug format and reserved route segments, but it never calls `topicRouteSegmentExists()` before inserting the new topic.
  - `getTopicBySlug()` resolves **direct topic slugs first** and only falls back to aliases second.
  - That means a new topic slug can legally reuse an existing alias string, and the new direct slug will then take precedence over the old alias route.
- **Concrete failure scenario:**
  1. Topic `landscape` has alias `travel`.
  2. An admin creates a new topic with slug `travel`.
  3. `/en/travel` now resolves to the new topic, not the alias target.
  4. Existing links/bookmarks that used the alias silently switch to the wrong content.
- **Suggested fix:**
  - In `createTopic()`, run the same collision guard already used by `updateTopic()` / `createTopicAlias()`:
    - reject creation when `await topicRouteSegmentExists(slug)` is true.
  - Keep the DB insert as the race-safe final authority, but block alias collisions before the insert.

### 2) Topic slug renames are ordered incompatibly with the schema’s foreign keys
- **Severity:** High
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/app/actions/topics.ts:176-190`
  - `apps/web/src/db/schema.ts:13,30`
  - `apps/web/drizzle/0001_sync_current_schema.sql:71,75`
- **Problem:**
  - On slug change, `updateTopic()` updates `images.topic` and `topicAliases.topicSlug` **before** updating `topics.slug`.
  - The schema/migration defines both foreign keys with **`ON UPDATE no action`**.
  - In MySQL, that means the child rows cannot point at the new slug until the parent row already exists with that slug.
- **Concrete failure scenario:**
  1. Topic `landscape` already has images or aliases.
  2. Admin renames it to `travel`.
  3. The first child update (`images.topic = 'travel'` or `topic_aliases.topic_slug = 'travel'`) violates the FK because `topics.slug='travel'` does not exist yet.
  4. The rename fails for any populated topic.
- **Suggested fix:**
  - Prefer one of these approaches:
    1. Change the foreign keys to `ON UPDATE CASCADE`, then update `topics.slug` only.
    2. Or insert a new topic row / migrate children / delete old row in a carefully designed migration flow.
  - The current “children first, parent last” transaction is not compatible with the shipped schema.

### 3) Tag slug-collision handling mutates data differently from the admin’s request
- **Severity:** High
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/app/actions/tags.ts:148-180`
  - `apps/web/src/app/actions/tags.ts:261-316`
  - `apps/web/src/app/actions/tags.ts:363-378`
  - `apps/web/src/app/actions/images.ts:252-289`
- **Problem:**
  - When a requested tag name slugifies to an existing tag’s slug, the code falls back from exact-name lookup to slug lookup and then proceeds with the returned record.
  - The action warns about the collision, but it still links the **existing different tag** instead of rejecting the request.
  - This affects single-image tagging, batch tagging, batch tag updates, and upload-time tag creation.
- **Concrete failure scenario:**
  1. A gallery already has tag `c` (slug `c`).
  2. Admin tries to add tag `C++`.
  3. The insert is ignored because slug `c` already exists.
  4. The fallback lookup finds tag `c`, links that record, and returns success-with-warning.
  5. The image ends up tagged `c`, not `C++`.
- **Suggested fix:**
  - Treat slug collisions as validation failures, not recoverable warnings.
  - After exact-name lookup fails, if a slug match exists for a different tag name, return an explicit collision error and do **not** link any tag.
  - Centralize this in one helper so all four call sites share the same behavior.

### 4) Single-image tag actions can report success even when the target image no longer exists
- **Severity:** Medium
- **Confidence:** High
- **Files / regions:**
  - `apps/web/src/app/actions/tags.ts:128-180`
  - `apps/web/src/app/actions/tags.ts:323-413`
  - `apps/web/src/app/actions/tags.ts:278-296` (internal evidence from the batch path)
- **Problem:**
  - `addTagToImage()` and the add/remove work inside `batchUpdateImageTags()` do not verify that the target image still exists before using `INSERT IGNORE` / delete operations.
  - The same file explicitly documents in the batch-add path that `INSERT IGNORE` can silently drop rows that violate FK constraints.
  - So the single-image paths can return success even when nothing was actually changed.
- **Concrete failure scenario:**
  1. Admin A opens the image manager for image `42`.
  2. Admin B deletes image `42`.
  3. Admin A adds a tag.
  4. `INSERT IGNORE` produces no tag link, but the action still logs success, revalidates, and returns success.
  5. The UI tells the admin the tag was added even though the image is gone.
- **Suggested fix:**
  - Mirror the batch-add guard in the single-image paths:
    - fetch/verify the target image before mutating,
    - or inspect `affectedRows`/existing image presence and return `imageNotFound` when no mutation occurred.
  - Do the same before `batchUpdateImageTags()` returns success.

## Likely issues

### 5) Restore maintenance mode is process-local, so multi-process deployments can still accept writes during restore
- **Severity:** Medium
- **Confidence:** Medium
- **Files / regions:**
  - `apps/web/src/lib/restore-maintenance.ts:1-56`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:243-284`
- **Problem:**
  - `beginRestoreMaintenance()` / `isRestoreMaintenanceActive()` store the maintenance flag on `globalThis`.
  - `restoreDatabase()` acquires a DB advisory lock and then flips that in-process flag.
  - All the write actions check the flag, but only within the current Node process.
- **Concrete failure scenario:**
  1. Production runs multiple Node workers/containers behind the proxy.
  2. Admin starts a restore through worker A.
  3. Worker B never sees the in-memory flag, so uploads/admin mutations hitting worker B still proceed during the restore window.
  4. The DB advisory lock prevents a second restore, but it does not stop unrelated writes from other workers.
- **Suggested fix:**
  - Move maintenance state to a shared source of truth (DB row, Redis, or repeated advisory-lock check in the action guard).
  - Keep the in-process fast flag only as a cache, not as the primary coordination mechanism.

## Manual-validation risks

### 6) Backup/restore correctness depends on external binaries and production MySQL behavior that the repo’s automated checks do not exercise
- **Severity:** Medium
- **Confidence:** Medium
- **Files / regions:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:102-233`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:290-430`
- **Why this needs manual validation:**
  - The backup and restore paths shell out to `mysqldump` / `mysql`, require those binaries to exist in the runtime image, and rely on the target MySQL server accepting the chosen SSL/options.
  - The repo’s current automated verification (`test`/`tsc`/`eslint`/`build`) never runs those disaster-recovery flows end to end.
- **Concrete failure scenario:**
  - The app ships successfully, but the deployment image is missing one client binary, or the target DB rejects the CLI flags/SSL mode; the first time anyone notices is during an actual restore incident.
- **Suggested fix / validation step:**
  - Add a deployment smoke test that verifies `mysqldump --version`, `mysql --version`, and a non-destructive round-trip backup/restore check against a disposable DB.
  - If full automation is too heavy, make this a required release checklist item.

---

## Missed-issues sweep
I did one final sweep specifically for:
- topic slug / alias collision guards,
- FK-sensitive rename flows,
- tag-linking paths that use `INSERT IGNORE`,
- restore-mode coordination assumptions,
- deployment-only backup/restore paths.

I did not find additional grounded issues beyond the findings above.

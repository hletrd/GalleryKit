# Tracer Compatibility Lane — Deep Causal Code Review (2026-04-24)

## Scope and method

Default-agent tracer review for `/Users/hletrd/flash-shared/gallery`. I traced the requested flows end-to-end and read the relevant source files fully rather than sampling isolated snippets:

- upload -> DB row -> queue -> processing -> public visibility/revalidation -> upload serving
- auth/session -> proxy -> server actions/API
- backup/restore -> maintenance -> health/actions
- share/group view flows
- config -> metadata/sitemap/robots

I did not change application code and did not commit.

## Inventory: causal edges inspected

| Flow | Files/regions inspected |
| --- | --- |
| Upload, queue, processing, public visibility | `apps/web/src/app/actions/images.ts`; `apps/web/src/components/upload-dropzone.tsx`; `apps/web/src/components/image-manager.tsx`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/process-image.ts`; `apps/web/src/lib/process-topic-image.ts`; `apps/web/src/lib/upload-paths.ts`; `apps/web/src/lib/upload-limits.ts`; `apps/web/src/lib/upload-tracker.ts`; `apps/web/src/lib/revalidation.ts`; `apps/web/src/lib/data.ts`; `apps/web/src/db/schema.ts`; `apps/web/src/instrumentation.ts`; `apps/web/src/lib/queue-shutdown.ts`. |
| Upload serving | `apps/web/src/lib/serve-upload.ts`; `apps/web/src/app/uploads/[...path]/route.ts`; `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`; `apps/web/src/lib/image-url.ts`; `apps/web/next.config.ts`; `apps/web/nginx/default.conf`; `apps/web/docker-compose.yml`; README deploy notes. |
| Auth/session/proxy/actions/API | `apps/web/src/app/actions/auth.ts`; `apps/web/src/lib/session.ts`; `apps/web/src/proxy.ts`; `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`; `apps/web/src/app/[locale]/admin/layout.tsx`; `apps/web/src/app/[locale]/admin/page.tsx`; `apps/web/src/lib/action-guards.ts`; `apps/web/src/lib/request-origin.ts`; `apps/web/src/lib/api-auth.ts`; `apps/web/src/app/api/admin/db/download/route.ts`; `apps/web/src/lib/rate-limit.ts`; `apps/web/src/lib/auth-rate-limit.ts`; action barrel `apps/web/src/app/actions.ts`. |
| Backup/restore/maintenance/health | `apps/web/src/app/[locale]/admin/db-actions.ts`; `apps/web/src/lib/db-restore.ts`; `apps/web/src/lib/sql-restore-scan.ts`; `apps/web/src/lib/restore-maintenance.ts`; `apps/web/src/app/api/health/route.ts`; `apps/web/src/app/api/live/route.ts`; `apps/web/src/lib/backup-filename.ts`; selected backup/health/restore tests for behavioral intent. |
| Share/group views | `apps/web/src/app/actions/sharing.ts`; `apps/web/src/lib/data.ts` share queries; `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`; `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`; `apps/web/src/db/schema.ts`; `apps/web/src/lib/base56.ts`. |
| Config/metadata/sitemap/robots | `apps/web/src/app/[locale]/layout.tsx`; public home/topic/photo/share/group pages' metadata; `apps/web/src/app/robots.ts`; `apps/web/src/app/sitemap.ts`; `apps/web/src/app/manifest.ts`; `apps/web/src/app/api/og/route.tsx`; `apps/web/src/lib/constants.ts`; `apps/web/src/lib/gallery-config.ts`; `apps/web/src/lib/gallery-config-shared.ts`; `apps/web/src/lib/seo-og-url.ts`; `apps/web/src/lib/locale-path.ts`; `apps/web/src/site-config.json`; README config notes. |
| Validation sweep | `npm run lint:api-auth`; `npm run lint:action-origin`; repository-wide `rg` for API routes, exported actions, maintenance guards, revalidation calls, upload-serving paths, and share/group references. |

## Findings summary

| ID | Type | Severity | Confidence | Flow | Title |
| --- | --- | --- | --- | --- | --- |
| TRACER-01 | Confirmed | HIGH | HIGH | restore -> actions/upload/health | Restore maintenance is a check-only, process-local flag; in-flight and other-worker mutations can overlap restore. |
| TRACER-02 | Confirmed | HIGH | HIGH | delete -> share/group visibility | Image deletion does not invalidate cached photo-share or group-share pages. |
| TRACER-03 | Confirmed gap / likely symptom | MEDIUM | HIGH | upload -> queue -> public visibility | Queue completion flips `processed=true` without any post-processing public revalidation. |
| TRACER-04 | Confirmed | MEDIUM | HIGH | auth/session -> rate-limit DB buckets | Login/password DB rate-limit buckets still check before increment across processes. |
| TRACER-05 | Likely deployment break | HIGH | MEDIUM-HIGH | upload serving | Shipped nginx upload `root` does not match the documented host-network deployment path. |
| TRACER-06 | Likely race | MEDIUM | MEDIUM-HIGH | config -> processing -> serving | `image_sizes` can change while jobs are in flight, producing derivative filenames the UI no longer requests. |
| TRACER-07 | Confirmed | LOW | HIGH | topic-image upload/resources | `createTopic` leaks a processed topic cover file on route-conflict return. |

---

## TRACER-01 — Restore maintenance is a check-only, process-local flag; in-flight and other-worker mutations can overlap restore

- **Type:** Confirmed code gap; multi-worker part is deployment-dependent risk.
- **Severity:** HIGH
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/src/lib/restore-maintenance.ts:1-23,44-55` stores maintenance state only on `globalThis`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:254-315` restore acquires a restore-only MySQL advisory lock, flips local maintenance at `271`, drains only local buffered/queue work at `292-293`, runs restore at `299`, then clears local maintenance at `301`.
  - `apps/web/src/app/actions/images.ts:90-93` checks maintenance at upload entry, `218-222` checks once after the original is saved, then `247-305` still inserts the DB row and enqueues after that final check.
  - Other mutating actions also use one entry check only, e.g. `apps/web/src/app/actions/sharing.ts:92-99,188-195,307-314,347-354`, `apps/web/src/app/actions/topics.ts:59-66,147-154,293-300,353-360,420-427`, `apps/web/src/app/actions/tags.ts:41-48,97-104,136-143,199-206,256-263,338-349`.
  - `apps/web/src/app/api/health/route.ts:8-15` reports restore maintenance from the same process-local flag.

### Failure scenario

A long upload passes the entry maintenance check, writes the original, passes `cleanupOriginalIfRestoreMaintenanceBegan()` at `images.ts:218-222`, then a restore starts before the upload reaches `db.insert(images)` at `images.ts:247`. Restore drains the local queue, but not in-flight server actions. The upload can still insert a row and/or enqueue while `mysql` is restoring. Depending on timing, the restored DB can discard that row while the original/derivatives remain, or the upload can enqueue a job against a transient row set.

In a scaled deployment, process A can set `globalThis.restoreMaintenance.active=true` while process B still has `false`, so process B can accept uploads/share/topic/settings mutations and return `/api/health` as normal during process A's restore.

### Concrete fix

Replace the process-local Boolean with a real mutation barrier:

1. Add a DB-backed or advisory-lock-backed global maintenance state visible to every process.
2. Have every mutating server action acquire a shared/read mutation lock for the full mutation window; restore acquires an exclusive/write lock before quiescing queues and running `mysql`.
3. For uploads, hold the barrier across original write -> DB insert -> enqueue, or re-check an exclusive restore lock immediately before insert and clean up the saved original if restore won the race.
4. Make `/api/health` read the same global state, not just local `globalThis`.

---

## TRACER-02 — Image deletion does not invalidate cached photo-share or group-share pages

- **Type:** Confirmed missing invalidation.
- **Severity:** HIGH
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/src/app/actions/images.ts:367-375` single delete selects filenames/topic only; it omits `images.share_key` and any `shared_groups.key` membership.
  - `apps/web/src/app/actions/images.ts:398-400` deletes the image row; FK cascade removes group links via `apps/web/src/db/schema.ts:97-104`.
  - `apps/web/src/app/actions/images.ts:427` revalidates `/`, `/p/${id}`, topic, and admin dashboard, but not `/s/${shareKey}` or affected `/g/${groupKey}`.
  - `apps/web/src/app/actions/images.ts:461-469,539-555` batch delete has the same omission for share/group keys.
  - Public share/group reads are `apps/web/src/lib/data.ts:552-568` for `/s/[key]` and `617-630` for `/g/[key]`.
  - The dedicated revoke/delete paths prove these routes are expected to be invalidated: `apps/web/src/app/actions/sharing.ts:338` revalidates `/s/${oldShareKey}`, and `381` revalidates `/g/${group.key}`.

### Failure scenario

An admin shares a photo or group, the share URL is visited and cached, then the admin deletes the image instead of revoking the share first. The DB row/link is removed, but the previously generated `/s/<key>` or `/g/<key>` page is never invalidated by the delete action. A stale cached share page can continue to show a photo the admin believes was deleted until the route's cache naturally expires or another broad invalidation happens.

### Concrete fix

Before deleting images, fetch:

- `images.share_key` for each target image;
- all `sharedGroups.key` rows joined through `sharedGroupImages` for the target image IDs.

After a successful delete, call `revalidateLocalizedPaths(...shareKeys.map(k => `/s/${k}`), ...groupKeys.map(k => `/g/${k}`), existing paths...)`. For large batches, `revalidateAllAppData()` may be acceptable, but single/small deletes need targeted share/group invalidation.

---

## TRACER-03 — Queue completion flips `processed=true` without any post-processing public revalidation

- **Type:** Confirmed code gap; public staleness requires a cache hit during processing.
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/src/app/actions/images.ts:224-240` inserts new images with `processed: false`.
  - `apps/web/src/app/actions/images.ts:297-305` enqueues the background processor.
  - `apps/web/src/app/actions/images.ts:338-340` revalidates `/`, `/admin/dashboard`, and `/${topic}` immediately after upload, before the queued job finishes.
  - `apps/web/src/lib/image-queue.ts:279-282` later marks the row `processed=true`.
  - `apps/web/src/lib/image-queue.ts:295-299` explicitly documents that per-job `revalidatePath` was removed and no replacement post-processing invalidation exists.
  - Public listing/detail queries exclude unprocessed rows at `apps/web/src/lib/data.ts:295-303,441-459,552-568,617-630`.
  - Public pages have long ISR windows: home/topic `apps/web/src/app/[locale]/(public)/page.tsx:16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:16`; photo detail `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:21-22`.

### Failure scenario

Upload finishes and revalidates the public home/topic path while the new row is still `processed=false`. A visitor or crawler hits that stale path before the queue completes, so the page regenerates without the new image and becomes fresh for its ISR window. The queue then sets `processed=true`, but no revalidation runs, so the image remains missing from public home/topic listings until the 1-hour revalidate window, another mutation, or a manual refresh invalidates the path.

### Concrete fix

Add debounced post-processing invalidation after the successful `processed=true` update. To avoid the old cache-thrash problem, aggregate completed job IDs/topics for a short interval and revalidate `/`, the affected topic paths, relevant `/p/${id}` paths if needed, and sitemap/metadata surfaces as appropriate. Keep admin dashboard revalidation at upload time if unprocessed admin visibility is desired.

---

## TRACER-04 — Login/password DB rate-limit buckets still check before increment across processes

- **Type:** Confirmed cross-process race.
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files/regions:**
  - Login checks DB limits at `apps/web/src/app/actions/auth.ts:108-130`, then increments DB buckets at `139-141`.
  - Password change checks at `apps/web/src/app/actions/auth.ts:320-324`, then increments at `337`.
  - `apps/web/src/lib/rate-limit.ts:172-193` treats `count >= max` as limited before the current request is included.
  - `apps/web/src/lib/rate-limit.ts:200-215` provides atomic DB increment, but auth calls it after the read.
  - Safer sibling flows increment first and check including the current request: `apps/web/src/app/actions/public.ts:72-94`, `apps/web/src/app/actions/sharing.ts:121-130,232-240`.

### Failure scenario

Two Node processes receive bad login attempts for the same account bucket when DB count is 4 and max is 5. Both call `checkRateLimit()` before either increments, both see 4, both proceed, and both run Argon2 verification. The DB count lands at 6, so the DB-backed source-of-truth admits extra attempts exactly where the in-memory map is not shared.

### Concrete fix

Make auth match the sharing/search pattern:

1. Increment the IP and account DB buckets before the DB check.
2. Check with `count > max` / "includes current request" semantics.
3. Roll back both buckets if either bucket rejects or if infrastructure fails before authentication is actually evaluated.
4. Consider a single atomic conditional upsert that refuses to exceed the limit for the strongest guarantee.

---

## TRACER-05 — Shipped nginx upload `root` does not match the documented host-network deployment path

- **Type:** Likely deployment break.
- **Severity:** HIGH
- **Confidence:** MEDIUM-HIGH
- **Files/regions:**
  - `apps/web/nginx/default.conf:89-95` intercepts `/uploads/{jpeg,webp,avif}/...` and serves from fixed `root /app/apps/web/public`.
  - `apps/web/docker-compose.yml:10-22` runs only the app with `network_mode: host`; nginx is host-managed, while `./public` is mounted into the app container at `/app/apps/web/public`.
  - `README.md:158-169` documents arbitrary host deployment through a host reverse proxy and says processed derivatives remain under `public/uploads/`.
  - The hardened Next fallback exists at `apps/web/src/lib/serve-upload.ts:32-115`, but nginx consumes matching upload URLs before they reach Next.

### Failure scenario

An operator deploys the repository somewhere other than host `/app`, follows the checked-in host-network compose + host nginx guidance, and copies `apps/web/nginx/default.conf`. Upload processing writes derivatives under the repository's `apps/web/public/uploads`, but nginx serves `/uploads/jpeg/...` from `/app/apps/web/public/uploads`. Valid gallery image requests return 404 even though the files exist.

### Concrete fix

Template the nginx root to the real host path, add an nginx container/service with a matching bind mount, or remove the static upload location and proxy `/uploads` to Next until the static path is configured. Add a deploy smoke test that requests a processed derivative through the reverse proxy.

---

## TRACER-06 — `image_sizes` can change while jobs are in flight, producing derivative filenames the UI no longer requests

- **Type:** Likely race.
- **Severity:** MEDIUM
- **Confidence:** MEDIUM-HIGH
- **Files/regions:**
  - `apps/web/src/app/actions/settings.ts:72-103` prevents `image_sizes` changes only when a processed image already exists (`images.processed = true` at `94-98`).
  - `apps/web/src/app/actions/images.ts:224-240` creates new rows with `processed=false`.
  - `apps/web/src/lib/image-queue.ts:240-263` reads current gallery config once per job and passes `imageSizes` into processing.
  - `apps/web/src/lib/process-image.ts:390-444` writes only the configured size-suffixed derivative filenames.
  - Public pages compute derivative URLs from the current config, e.g. home JSON-LD `apps/web/src/app/[locale]/(public)/page.tsx:146-147`, photo metadata `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:65-68`, group grid `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:169-176`, and `apps/web/src/lib/image-url.ts:24-48`.

### Failure scenario

On a new gallery with no processed images, an upload begins and a queue job reads the old `image_sizes` config. Before the job finishes and flips `processed=true`, an admin updates `image_sizes`; the guard sees no processed images and allows it. The in-flight job writes old-size filenames, while public rendering now requests new-size filenames. Result: processed rows point to a base JPEG/WebP/AVIF, but responsive thumbnails/OG URLs for the configured sizes 404.

### Concrete fix

Make `image_sizes` immutable once any image row exists, or quiesce the processing queue and in-flight uploads before allowing a size change. If runtime changes are required, persist generated sizes per image or enqueue a full derivative regeneration before switching the public config.

---

## TRACER-07 — `createTopic` leaks a processed topic cover file on route-conflict return

- **Type:** Confirmed orphan-file leak.
- **Severity:** LOW
- **Confidence:** HIGH
- **Files/regions:**
  - `apps/web/src/app/actions/topics.ts:96-105` processes and writes the optional topic image before route-conflict checks.
  - `apps/web/src/app/actions/topics.ts:107-115` returns `{ error: t('slugConflictsWithRoute') }` from inside the lock callback when the slug/alias conflicts.
  - `apps/web/src/app/actions/topics.ts:132-135` cleanup only runs in `catch`, so returned error objects skip cleanup.
  - `apps/web/src/lib/process-topic-image.ts:55-80` writes `public/resources/<uuid>.webp`.

### Failure scenario

An admin tries to create a topic with a conflicting slug and includes a cover image. The image is processed into `public/resources`, then the slug conflict returns normally. Because no exception is thrown, the outer catch never deletes the new file. Repeated failed attempts accumulate unreferenced public resources.

### Concrete fix

Perform route availability checks before `processTopicImage()` where possible. Otherwise, before every returned error after `imageFilename` is set, call `deleteTopicImage(imageFilename)` and clear the variable.

---

## Auth/API guard sweep

- `npm run lint:api-auth` passed and reported `OK: src/app/api/admin/db/download/route.ts`.
- `npm run lint:action-origin` passed and reported all mutating server actions enforce same-origin provenance.
- Manual API inventory found only `/api/admin/db/download`, `/api/health`, `/api/live`, and `/api/og`; the admin API route uses `withAdminAuth` and an explicit same-origin check.

## Final sweep for missed issues / skipped files

- Re-ran path inventories and `rg` sweeps for exported actions, `/api` route handlers, maintenance guards, share/group key use, upload-serving paths, and revalidation calls.
- Fully inspected the source files listed in the inventory table. Selected tests were used to confirm intended behavior around backup download, health, restore maintenance, and route guards; I did not line-review every test file because the task was a causal source-flow review.
- Skipped `node_modules`, `.next`/tsbuildinfo, binary fixtures/uploads/screenshots, historical `.context/plans` and older review artifacts, public fonts, and generated/compiled cache files. These do not define the reviewed runtime control/data flows.
- Existing uncommitted files outside this report were present before this review and were not touched.

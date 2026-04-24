# Tracer Review — Prompt 1 Cycle 4/100

Repo: `/Users/hletrd/flash-shared/gallery`
Scope traced: upload → process → serve → share, admin auth → actions/API, DB backup/restore, settings/i18n, image navigation, cache invalidation.

## Method and competing hypotheses

I traced state transitions from server actions into DB rows, background queue state, derivative files, public routes, and cache invalidation calls. I specifically tested these hypotheses against source evidence:

- **H1: Auth/API action gates are missing on an admin mutation.** Rejected for the current tree: `npm run lint:action-origin` and `npm run lint:api-auth` pass; protected admin layout also re-checks `isAdmin()`.
- **H2: Public upload serving allows original-file disclosure or traversal.** Rejected for current tracked routes: only `jpeg/webp/avif` are allowed and `lstat`/`realpath` containment is checked.
- **H3: Upload/process/cache state can diverge.** Confirmed: processing completion does not invalidate pages that filter `processed=true`; several related cache invalidation paths miss share or navigation dependents.
- **H4: DB restore maintenance prevents all concurrent writes.** Rejected: the maintenance flag is process-local, while deployments can have multiple Node workers/processes.
- **H5: Settings/i18n config is internally coherent.** Partly confirmed: English/Korean key parity is clean, but settings/upload has a timing window that can leave derivatives generated with a stale processing contract.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---:|---:|---|---|
| TR-C4-01 | High | High | Confirmed | Upload completion can leave public caches stuck before the new image becomes `processed=true` |
| TR-C4-02 | High | High | Confirmed | Restore maintenance is process-local, so other workers can mutate state during a restore |
| TR-C4-03 | High | Medium-High | Likely | The restore scanner rejects standard app-generated `mysqldump` files containing `DROP TABLE` |
| TR-C4-04 | Medium | High | Confirmed | Metadata edits do not invalidate direct-share or group-share pages |
| TR-C4-05 | Medium | High | Confirmed | Deleting a photo does not invalidate cached adjacent photo navigation |
| TR-C4-06 | Medium | Medium | Likely | A new-gallery settings/upload race can generate derivatives using stale image-size/GPS settings |

## Detailed findings

### TR-C4-01 — Upload completion can leave public caches stuck before the new image becomes `processed=true`

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Flow:** upload → queue process → public list serve → cache invalidation
- **Evidence:**
  - `uploadImages` inserts the image with `processed: false` before queueing: `apps/web/src/app/actions/images.ts:216-232`.
  - The upload action invalidates `/`, `/admin/dashboard`, and the topic immediately after enqueue: `apps/web/src/app/actions/images.ts:335-336`.
  - Public list queries exclude unprocessed rows: `apps/web/src/lib/data.ts:295-303`.
  - The queue later flips `processed` to true: `apps/web/src/lib/image-queue.ts:284-287`.
  - The queue explicitly does **not** revalidate on completion: `apps/web/src/lib/image-queue.ts:300-304`.
  - Home/topic pages can cache list results for an hour: `apps/web/src/app/[locale]/(public)/page.tsx:12-16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:15`.
- **Concrete failure scenario:** Admin uploads a photo. The upload action invalidates the homepage/topic while the row is still `processed=false`. A visitor or bot hits the homepage before Sharp finishes; the regenerated ISR page excludes the new row and can remain stale for up to 3600 seconds. The queue later marks the row processed but does not invalidate the public list, so the processed photo is not served until natural revalidation or another mutation.
- **Suggested fix:** Reintroduce post-processing invalidation, but batch/debounce it to avoid the earlier ISR-thrash concern. After `processed=true`, revalidate `/`, the image topic, and `/p/{id}` (or enqueue IDs/topics into a short debounce flusher). Add a regression test proving that queue completion triggers invalidation after the processed flip, not only at upload acceptance.

### TR-C4-02 — Restore maintenance is process-local, so other workers can mutate state during a restore

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Flow:** DB restore/backup → admin actions/API → upload/process/share/settings
- **Evidence:**
  - Restore maintenance state is stored on `globalThis`: `apps/web/src/lib/restore-maintenance.ts:1-22`, and toggled only in the current process: `apps/web/src/lib/restore-maintenance.ts:44-55`.
  - `restoreDatabase` acquires a MySQL advisory lock only for the restore action itself: `apps/web/src/app/[locale]/admin/db-actions.ts:258-269`.
  - It then sets process-local maintenance and quiesces only this process's queue: `apps/web/src/app/[locale]/admin/db-actions.ts:271-299`.
  - Mutating actions trust that same process-local flag, e.g. uploads: `apps/web/src/app/actions/images.ts:91-94`, settings: `apps/web/src/app/actions/settings.ts:44-45`, sharing: `apps/web/src/app/actions/sharing.ts:98-99`.
- **Concrete failure scenario:** Production runs two Node workers. Worker A starts a 250 MB restore, sets its own `globalThis` maintenance flag, and streams SQL into MySQL. A concurrent upload/share/settings request lands on Worker B, where `isRestoreMaintenanceActive()` is false. Worker B writes rows and queues processing against the database while Worker A is restoring, causing lost writes, FK failures, or derivatives for rows that the restore later replaces.
- **Suggested fix:** Move restore maintenance to shared state: a DB `admin_settings` maintenance row with TTL/owner, a named advisory lock checked by all mutating actions, or an external lock (Redis, etc.). Mutating actions and queue bootstrap should consult the shared lock, not only `globalThis`; queue quiesce/resume should be coordinated across workers.

### TR-C4-03 — The restore scanner rejects standard app-generated `mysqldump` files containing `DROP TABLE`

- **Severity:** High
- **Confidence:** Medium-High
- **Status:** Likely
- **Flow:** DB backup → restore scanner → restore
- **Evidence:**
  - `dumpDatabase` invokes `mysqldump` without `--skip-add-drop-table` or equivalent: `apps/web/src/app/[locale]/admin/db-actions.ts:136-140`.
  - The restore scanner rejects `DROP TABLE`: `apps/web/src/lib/sql-restore-scan.ts:13-19`.
  - Restore scans the entire uploaded SQL and returns `disallowedSql` on any match: `apps/web/src/app/[locale]/admin/db-actions.ts:362-381`.
  - The test suite codifies `DROP TABLE images;` as dangerous: `apps/web/src/__tests__/sql-restore-scan.test.ts:30`.
- **Concrete failure scenario:** Admin clicks Backup, downloads the app's own mysqldump, then later uploads that file to Restore. Standard mysqldump output normally includes `DROP TABLE IF EXISTS` before `CREATE TABLE`; the scanner rejects the file before `mysql` runs, so the backup/restore loop is not self-compatible.
- **Suggested fix:** Make backup and restore policy agree. Either add `--skip-add-drop-table` to the dump command and add a round-trip fixture test, or permit the exact mysqldump-safe `DROP TABLE IF EXISTS \`known_app_table\`` pattern after validating table names against the schema. The former is safer and smaller.

### TR-C4-04 — Metadata edits do not invalidate direct-share or group-share pages

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Flow:** admin action → shared serve → cache invalidation
- **Evidence:**
  - `updateImageMetadata` fetches only the image topic before updating: `apps/web/src/app/actions/images.ts:598-621`.
  - It revalidates `/p/{id}`, `/admin/dashboard`, `/`, and the topic, but no `/s/{share_key}` or `/g/{groupKey}`: `apps/web/src/app/actions/images.ts:620-621`.
  - Share pages render metadata/title/description from cached share lookups: direct share `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:46-64`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-126`; group share `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:118-143`.
  - The file already has helpers for collecting share/group revalidation paths used by delete paths: `apps/web/src/app/actions/images.ts:57-79`.
- **Concrete failure scenario:** Admin shares a photo, then corrects its title/description. `/p/{id}` updates after revalidation, but `/s/{key}` and any `/g/{key}` containing the image can keep serving the old title/description/OG data until another broad invalidation or natural expiry.
- **Suggested fix:** In `updateImageMetadata`, select `share_key` and collect affected group keys with `getSharedGroupKeysForImages([id])`; include the resulting `/s/*` and `/g/*` paths in `revalidateLocalizedPaths`. Add regression coverage mirroring the delete revalidation tests.

### TR-C4-05 — Deleting a photo does not invalidate cached adjacent photo navigation

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Flow:** image navigation → delete → cache invalidation
- **Evidence:**
  - Photo detail pages cache for a week: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:27-28`.
  - Each photo page computes `prevId`/`nextId` from the current DB ordering: `apps/web/src/lib/data.ts:465-545`.
  - `deleteImage` revalidates the deleted photo, home, topic, admin dashboard, and share paths only: `apps/web/src/app/actions/images.ts:427`.
  - `deleteImages` revalidates only found IDs/topics/share paths for small batches: `apps/web/src/app/actions/images.ts:553-562`.
- **Concrete failure scenario:** Photo 11 is cached with `nextId=10`. Admin deletes photo 10. `/p/11` is not revalidated, so its arrow/prefetch still points to `/p/10`; users navigating from photo 11 hit a deleted/not-found page until the week-long ISR entry is invalidated.
- **Suggested fix:** Before deletion, compute adjacent public photo IDs around the deleted IDs in the same global sort order and revalidate those `/p/{adjacentId}` pages too. For batch deletes, collect boundary neighbors after excluding all deleted IDs, or use layout-level revalidation when neighbor computation is too costly.

### TR-C4-06 — A new-gallery settings/upload race can generate derivatives using stale image-size/GPS settings

- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely
- **Flow:** settings/i18n → upload → process → serve
- **Evidence:**
  - Upload snapshots the processing config before claiming upload capacity: `apps/web/src/app/actions/images.ts:122-125` versus the later tracker pre-claim at `apps/web/src/app/actions/images.ts:179-185`.
  - Settings only blocks upload-contract changes if the process-local upload tracker has active claims or an image row exists: `apps/web/src/app/actions/settings.ts:73-77`, `apps/web/src/app/actions/settings.ts:100-130`.
  - The queued job uses the upload-time snapshot for qualities/sizes: `apps/web/src/app/actions/images.ts:289-303`, `apps/web/src/lib/image-queue.ts:242-268`.
  - Public URL builders use current configured sizes when rendering metadata/viewers: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:67-70`, `apps/web/src/components/photo-viewer.tsx:213-225`.
- **Concrete failure scenario:** Empty gallery. Upload request A reads old `image_sizes`, then stalls before tracker pre-claim/DB insert. Settings request B changes `image_sizes` because there are no active claims and no image rows. Request A then inserts and queues a job with the old size list. Public pages use the new size list and request derivative filenames that were never generated, causing broken thumbnails/OG images. The same process-local tracker also cannot protect across workers.
- **Suggested fix:** Serialize processing-contract changes with uploads. Claim a shared upload/settings lock before reading `getGalleryConfig()`, or move the processing contract into the image row/job payload and have all renderers choose sizes from per-image metadata. At minimum, pre-claim before config read and use a DB-backed lock so settings cannot change between config snapshot and row creation across processes.

## Traced surfaces without new findings

- **Admin auth/actions/API:** `npm run lint:action-origin` reported all mutating server actions enforce `requireSameOriginAdmin`; `npm run lint:api-auth` reported the admin download API route is wrapped. Protected admin layout also redirects unauthenticated users via `isAdmin()`.
- **i18n key parity:** A JSON flatten comparison of `apps/web/messages/en.json` and `apps/web/messages/ko.json` found zero missing keys in either direction.
- **Upload serving:** `serveUploadFile` restricts top-level directories/extensions and checks symlink/realpath containment before streaming (`apps/web/src/lib/serve-upload.ts:32-102`). I did not find a current traversal/original-disclosure path in tracked code.

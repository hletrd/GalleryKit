# Cycle 1 causal tracer report

Date: 2026-05-02 (Asia/Seoul)
Scope: suspicious cross-file flows requested for `upload -> process -> serve`, `auth -> admin action -> DB`, `share creation -> public routes`, `settings -> config -> UI/metadata`, `backup/restore -> maintenance gates`, `rate limiting -> caller identity`, and `navigation -> caching/revalidation`.

Working-tree boundary: pre-existing unrelated changes were present in `.context/reviews/architect.md`, `.context/reviews/test-engineer.md`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/photo-viewer.tsx`, and `apps/web/src/__tests__/image-zoom-math.test.ts`. I did not edit application code; this report is the only intended tracer edit.

## 1. Flow-relevant file inventory

### Cross-cutting data, config, auth, identity, cache
- `apps/web/src/db/schema.ts` — core persistence for images/share keys/settings/admin users/audit/sessions/rate-limit buckets (`images` at `:16-66`, settings at `:82-85`, share tables at `:87-104`, admin/session/rate-limit at `:106-145`).
- `apps/web/src/db/index.ts` — MySQL pool, per-connection `group_concat_max_len`, query/execute wrappers, Drizzle exports (`:13-90`).
- `apps/web/src/lib/session.ts` — session secret/token/signature/DB session validation (`:16-145`).
- `apps/web/src/lib/request-origin.ts` — same-origin/proxy origin trust boundary (`:45-107`).
- `apps/web/src/lib/action-guards.ts` — server-action same-origin guard (`:37-44`).
- `apps/web/src/lib/api-auth.ts` — route-handler admin auth wrapper (`:26-55`).
- `apps/web/src/proxy.ts` — protected-admin redirect prefilter and middleware matcher (`:53-128`).
- `apps/web/src/lib/rate-limit.ts` — IP normalization, trusted-proxy identity, public share/OG/search and DB bucket helpers (`:86-155`, `:228-370`).
- `apps/web/src/lib/audit.ts` — audit log writes/purge (`:8-68`).
- `apps/web/src/lib/revalidation.ts` — localized and app-wide revalidation (`:11-57`).
- `apps/web/next.config.ts` — server-action body cap, upload/image headers, local image patterns (`:28-83`).
- `apps/web/src/lib/constants.ts`, `apps/web/src/lib/content-security-policy.ts` — locale/base URL and image/CSP policy plumbing.

### Upload -> process -> serve
- Client/UI: `apps/web/src/components/upload-dropzone.tsx` (`:125-274`).
- Server action: `apps/web/src/app/actions/images.ts` upload path (`:117-455`) plus delete/update paths (`:458-778`).
- Processing: `apps/web/src/lib/process-image.ts` original save/metadata (`:329-432`) and derivative generation (`:441-558`).
- Queue and queue maintenance: `apps/web/src/lib/image-queue.ts` enqueue/claim/process (`:206-389`) and restore quiesce/resume (`:527-559`).
- Filesystem contract: `apps/web/src/lib/upload-paths.ts` (`:12-103`), `apps/web/src/lib/upload-limits.ts` (`:1-31`), `apps/web/src/lib/upload-tracker-state.ts` (`:15-79`), `apps/web/src/lib/upload-processing-contract-lock.ts` (`:9-73`).
- Serving: `apps/web/src/lib/serve-upload.ts` (`:32-117`), `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- Storage abstraction note: `apps/web/src/lib/storage/index.ts` documents that it is not the live upload pipeline.

### Auth -> admin action -> DB
- Auth/session actions: `apps/web/src/app/actions/auth.ts` login (`:71-238`), logout/update password (`:258-442`).
- Admin user actions: `apps/web/src/app/actions/admin-users.ts` create/delete (`:71-274`).
- Admin mutation surfaces: `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`.
- Admin route shells/pages: `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, `apps/web/src/app/[locale]/admin/page.tsx`.
- Advisory locks: `apps/web/src/lib/advisory-locks.ts` (`:17-39`).

### Share creation -> public routes
- Share mutations: `apps/web/src/app/actions/sharing.ts` (`:78-383`).
- Public share pages: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` (`:1-150`), `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (`:1-220`).
- Data loaders: `apps/web/src/lib/data.ts` share-key lookup (`:873-934`), group lookup/view-count buffering (`:940-1026`, `:43-182`).
- Display/navigation dependencies: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/photo-title.ts`.

### Settings -> config -> UI/metadata
- Settings schema/defaults/validation: `apps/web/src/lib/gallery-config-shared.ts` (`:10-154`).
- Runtime config reader: `apps/web/src/lib/gallery-config.ts` (`:33-101`).
- Gallery settings action/UI: `apps/web/src/app/actions/settings.ts` (`:40-166`), `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx` (`:8-23`), `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (`:34-185`).
- SEO action/runtime metadata: `apps/web/src/app/actions/seo.ts` (`:54-161`), `apps/web/src/lib/seo-og-url.ts` (`:3-30`), `apps/web/src/lib/data.ts` SEO settings (`:1258-1282`).
- Metadata consumers: public home/topic/photo/share pages and `apps/web/src/app/manifest.ts`.

### Backup/restore -> maintenance gates
- Restore/export UI: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` (`:33-185`).
- DB actions: `apps/web/src/app/[locale]/admin/db-actions.ts` export/dump/restore (`:36-360`) and SQL import (`:363-515`).
- Maintenance and scan helpers: `apps/web/src/lib/restore-maintenance.ts` (`:1-56`), `apps/web/src/lib/db-restore.ts` (`:1-34`), `apps/web/src/lib/sql-restore-scan.ts` (`:2-134`).
- Queue maintenance hooks: `apps/web/src/lib/image-queue.ts` (`:527-559`).

### Tests/contracts inventoried for these flows
- `apps/web/src/__tests__/sharing-source-contracts.test.ts`, `shared-route-rate-limit-source.test.ts`, `rate-limit.test.ts`, `admin-users.test.ts`, `admin-user-create-ordering.test.ts`, `auth-rate-limit-ordering.test.ts`, `restore-maintenance.test.ts`, `restore-upload-lock.test.ts`, `images-actions.test.ts`, `tags-actions.test.ts`, `seo-actions.test.ts`, `revalidation.test.ts`, `check-api-auth.test.ts`, `data-adjacency-source.test.ts`, plus E2E entrypoints `apps/web/admin.spec.ts`, `apps/web/public.spec.ts`, `apps/web/origin-guard.spec.ts`, `apps/web/nav-visual-check.spec.ts` and `apps/web/e2e/helpers.ts`.

## 2. Cross-file causal traces and competing hypotheses

### A. Upload -> process -> serve

**Trace.** The browser gate filters accepted files by count and bytes in `upload-dropzone.tsx:125-160`, then sends one file at a time with topic/tags to `uploadImages` (`upload-dropzone.tsx:185-246`). The action enforces restore maintenance, admin session, same-origin, file/topic/tag shape, and then acquires the upload-processing contract lock before reading config and caller identity (`images.ts:117-183`). It creates/reuses a process-global upload tracker keyed by `userId:ip`, validates free disk and cumulative byte/count limits, validates topic existence, then pre-claims bytes/count (`images.ts:185-258`).

For each file, original bytes are saved and metadata/EXIF extracted, GPS is stripped according to the upload-time config snapshot, and late restore maintenance can delete the just-saved original before DB insert (`images.ts:265-300`). The DB row is inserted as `processed=false`, tags are attached, then `enqueueImageProcessing` receives filenames plus quality/size snapshot and the action revalidates localized public/admin paths (`images.ts:302-455`). The queue refuses new work during restore maintenance, validates filenames, acquires a per-image DB advisory claim, verifies the row is still pending, resolves the private original, generates WebP/AVIF/JPEG derivatives, verifies files are non-empty, then marks `processed=true` only if the row still exists and is still unprocessed (`image-queue.ts:206-389`).

Serving is deliberately limited to derivative directories. Original uploads live under private `UPLOAD_ORIGINAL_ROOT`, with legacy public original detection/warning in `upload-paths.ts:24-40` and `:82-103`. `serveUploadFile` only accepts whitelisted top-level upload dirs/extensions, rejects unsafe path segments and symlinks, resolves realpaths under `UPLOAD_ROOT`, and streams with immutable cache headers (`serve-upload.ts:32-105`).

**Competing hypotheses.**
- Original-file public disclosure: **not confirmed** in the current live serve path; `serve-upload.ts:37-49` restricts top-level dirs/extensions and `upload-paths.ts:27-40` keeps originals private.
- Upload/config race: **mostly mitigated** by the upload-processing contract lock (`images.ts:172-177`) and config snapshot passed into jobs (`image-queue.ts:278-304`).
- Restore mid-upload: **partly mitigated** in-process by early and late maintenance checks plus cleanup (`images.ts:119-121`, `:288-300`) and by the DB upload contract lock used by restore (`db-actions.ts:298-308`). See Finding T-04 for the cross-process gap.

### B. Auth -> admin action -> DB

**Trace.** Login sanitizes inputs, requires same-origin headers, derives an IP through `getClientIp`, pre-increments both IP and account login buckets before Argon2 verification, uses dummy-hash verification to reduce username timing signals, resets counters only after successful auth, and transactionally creates the new session while deleting older sessions (`auth.ts:71-238`). `verifySessionToken` validates HMAC shape, max token age, DB session existence, and expiry (`session.ts:82-145`). Protected admin pages use middleware as a cookie-shape prefilter (`proxy.ts:53-128`) and layouts/actions still call server-side session checks.

Admin mutations generally follow `maintenance -> isAdmin/current user -> same-origin -> validation -> DB mutation -> audit -> revalidate`, e.g. `createAdminUser` (`admin-users.ts:71-157`), tags (`tags.ts:42-49`), topics (`topics.ts:73-80`), settings (`settings.ts:40-47`), SEO (`seo.ts:54-61`), images (`images.ts:117-129`), and sharing (`sharing.ts:78-85`, `:181-188`).

**Competing hypotheses.**
- Middleware-only auth bypass: **not confirmed**; middleware excludes API routes but server actions route through explicit `isAdmin`/same-origin checks.
- Last-admin deletion invariant race: **confirmed**; see Finding T-01.
- Admin user creation rate-limit semantics mismatch: **risk**; see Finding T-06.

### C. Share creation -> public routes

**Trace.** Photo share creation requires maintenance/admin/origin gates, validates the image ID, fetches the image, requires `processed=true`, and returns the existing key or rate-limits/generates a key with a conditional `share_key IS NULL` update (`sharing.ts:78-178`). Group share creation validates all unique IDs, requires all rows to exist and be processed, rate-limits, then transactionally inserts `shared_groups` plus ordered `shared_group_images` (`sharing.ts:181-299`). Revocation/deletion revalidates the affected photo/share/admin paths (`sharing.ts:302-383`).

Public `/s/[key]` and `/g/[key]` pages set `revalidate = 0` (`s/[key]/page.tsx:16`, `g/[key]/page.tsx:17`) and rate-limit body rendering with `preIncrementShareAttempt` before the page data lookup (`s/[key]/page.tsx:101-115`, `g/[key]/page.tsx:111-125`; rate helper at `rate-limit.ts:234-244`). Data lookups validate Base56-ish keys before DB selection (`data.ts:873-934`, `:940-1026`).

**Competing hypotheses.**
- Unprocessed image share: **not confirmed**; both share creation paths reject unprocessed rows (`sharing.ts:95-99`, `:210-220`).
- Existing share no-op erases rate-limit pressure: **confirmed**; see Finding T-02.
- Metadata route bypasses lookup throttling: **confirmed**; see Finding T-03.

### D. Settings -> config -> UI/metadata

**Trace.** Supported gallery setting keys and validators are centralized in `gallery-config-shared.ts:10-64`, defaults and image-size parsing in `:73-154`, and runtime config reads `admin_settings` with fallback in `gallery-config.ts:33-101`. `updateGallerySettings` requires maintenance/admin/origin, sanitizes/validates all keys, acquires the upload contract lock when output sizes or GPS stripping change, blocks `image_sizes` and `strip_gps_on_upload` changes once any image exists, upserts settings transactionally, audits, and revalidates the app layout (`settings.ts:40-166`).

SEO settings follow a similar guard/validate/upsert/revalidate path (`seo.ts:54-161`) and public metadata reads SEO/config via `getSeoSettings` and `getGalleryConfig`, e.g. share page metadata uses configured title/base URL/image sizes (`s/[key]/page.tsx:48-76`, `g/[key]/page.tsx:44-72`).

**Competing hypotheses.**
- Config silently changes derivative contract after images exist: **not confirmed server-side**; the action blocks both output-size and strip-GPS semantic changes after an image exists (`settings.ts:103-132`).
- UI suggests a setting is editable when server will reject it: **confirmed** for GPS stripping; see Finding T-05.

### E. Backup/restore -> maintenance gates

**Trace.** Restore requires maintenance not already active, admin auth, same-origin, a DB restore advisory lock, then the upload-processing contract lock (`db-actions.ts:266-308`). It flips a process-global maintenance flag, flushes buffered share view counts, quiesces the image queue, runs the SQL restore, then ends maintenance, resumes the queue, releases locks, and returns the connection (`db-actions.ts:310-360`). `runRestore` enforces file presence/size/header, scans SQL chunks for dangerous statements, then streams into `mysql` and audits/revalidates (`db-actions.ts:363-515`; `db-restore.ts:1-34`; `sql-restore-scan.ts:2-134`).

**Competing hypotheses.**
- Restore/upload interleaving in the same process: **mostly mitigated** by the maintenance flag plus upload-processing contract lock.
- Restore/admin mutations from another process: **risk** because most action gates only read a process-local flag; see Finding T-04.

### F. Rate limiting -> caller identity

**Trace.** `getClientIp` trusts `x-forwarded-for`/`x-real-ip` only when `TRUST_PROXY=true`; otherwise it returns `unknown` and warns in production if proxy headers are present (`rate-limit.ts:123-153`). Login, password change, user creation, sharing, uploads, public pagination/search, OG, and share lookups all use this identity path either directly or through server actions/routes. DB buckets provide cross-restart accounting for login/user/share write rate limits (`rate-limit.ts:266-364`) while some public routes use process-local bounded maps (`rate-limit.ts:191-247`).

**Competing hypotheses.**
- IP spoofing via `X-Forwarded-For`: **not confirmed** with default config; proxy headers are ignored unless explicitly trusted.
- Accidental global bucket/DoS when behind a proxy without `TRUST_PROXY=true`: **operational risk**; all callers collapse to `unknown` by design (`rate-limit.ts:148-153`).
- Share/write rollback undercount: **confirmed** for existing photo shares; see Finding T-02.

### G. Navigation -> caching/revalidation

**Trace.** Public home/topic/photo/share pages use `revalidate = 0` for dynamic DB-backed rendering (home/topic/photo/share pages) while mutations call localized or app-wide revalidation (`revalidation.ts:11-57`, examples in `images.ts:445`, `:549`, `:699-707`, `:778`; `sharing.ts:142`, `:333`, `:376`; `settings.ts:153-155`; `seo.ts:154-157`; `tags.ts:91-92`, `:130-131`, `:199-200`, `:336-337`, `:465-466`; `topics.ts:145-149`, `:290-291`, `:362-363`, `:423-424`, `:493-495`).

Client navigation builds localized photo/share paths and prefetches adjacent pages on hover/idle (`photo-navigation.tsx:31-41`, `:209-232`; `photo-viewer.tsx:130-198`). Shared group photo navigation syncs `photoId` in the query string (`photo-viewer.tsx:200-203`) and server-side group rendering chooses the selected image from the loaded group (`g/[key]/page.tsx:140-175`).

**Competing hypotheses.**
- Stale processed/share/settings pages due to static caching: **not confirmed** for primary pages; `revalidate=0` and explicit revalidation are present.
- Adjacent prefetch serving stale sensitive data: **low confidence/not confirmed**; prefetch targets the same public data loaders and share pages remain `noindex/nocache` metadata, but metadata rate-limit bypass still applies before page body throttling (Finding T-03).

## 3. Findings

### T-01 — High / confirmed / Confidence: High
**Admin delete uses per-target locks, so two admins can delete each other and leave zero admins.**

- Evidence: `deleteAdminUser` intends to serialize the last-admin check (`admin-users.ts:198-209`) but uses `getAdminDeleteLockName(id)` (`admin-users.ts:211-215`), which is scoped to the target user (`advisory-locks.ts:26-32`). Inside that per-target lock, it starts a transaction, checks `SELECT COUNT(*) AS count FROM admin_users`, then deletes the target row (`admin-users.ts:227-252`).
- Failure scenario: with admins A and B, A deletes B while B deletes A. The requests acquire different advisory locks (`gallerykit_admin_delete:B` and `gallerykit_admin_delete:A`), both transactions can observe count `2`, both delete a different row, and both commit. The invariant “at least one admin remains” is violated.
- Suggested fix: use one global lock for the last-admin invariant (e.g. `gallerykit_admin_delete`) or lock the relevant `admin_users` rows/table with `SELECT ... FOR UPDATE` before counting/deleting. Add a concurrency test for cross-target deletes.

### T-02 — Medium / confirmed / Confidence: High
**Existing photo-share no-op rolls back rate-limit counters before any pre-increment, enabling share-write throttling bypass.**

- Evidence: `createPhotoShareLink` fetches the image and returns an existing key at `sharing.ts:95-105`. That branch calls `rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)` at `:104`, but the in-memory and DB pre-increment only happen later at `:108-124`. The comment at `:101-103` says the action is rolling back “pre-incremented” counters that do not yet exist on this path.
- Failure scenario: an admin repeatedly requests a share link for an already-shared image. Each no-op can decrement/delete current `share_photo` pressure for the caller, reducing the count created by other share attempts in the same window. Alternating existing-share no-ops with new-share creations can stretch or bypass the intended `20/min` share-write budget.
- Suggested fix: remove the rollback from the already-existing branch, or move the rate-limit pre-increment before image lookup/existing-key handling and roll back only if this invocation actually claimed a slot. Update `sharing-source-contracts.test.ts:8-16`, which currently checks the opposite contract.

### T-03 — Medium / confirmed / Confidence: High
**Public share `generateMetadata` performs DB lookups before the share lookup rate-limit, so enumeration still hits DB after the page body is throttled.**

- Evidence: `/s/[key]` metadata explicitly skips rate limiting (`s/[key]/page.tsx:42-48`) and then calls `getImageByShareKeyCached(key)` (`:54`). The page body rate-limit runs later at `:101-107`. `/g/[key]` has the same split: metadata skips rate limiting (`g/[key]/page.tsx:37-44`) and calls `getSharedGroupCached(key, { incrementViewCount: false })` at `:50`; the body rate-limit runs at `:111-118`. The backing lookups reach DB after key validation (`data.ts:873-934`, `:940-1026`).
- Failure scenario: automated requests to random share keys still force metadata DB lookups even when the caller is already over the body’s share-lookup budget. This weakens enumeration/DoS resistance and may double DB work per request.
- Suggested fix: enforce a route-level guard before both metadata and body data access, or make metadata cheap/no-DB for share keys once over limit. If avoiding double-increment is the reason, share a per-request “rate checked” marker or use a peek/claim API that can be called from both contexts without double counting. Update `shared-route-rate-limit-source.test.ts:32-50`, which currently encodes “no metadata rate limit.”

### T-04 — Medium / risk / Confidence: Medium
**Restore maintenance is process-local, so non-upload admin mutations can run during restore in another Node process.**

- Evidence: maintenance state is `globalThis.__galleryRestoreMaintenance` only (`restore-maintenance.ts:1-22`), read by action gates via `getRestoreMaintenanceMessage` (`restore-maintenance.ts:25-27`). Restore itself holds a DB restore advisory lock and the upload-processing contract lock (`db-actions.ts:279-308`) before setting this flag (`db-actions.ts:310-340`). Upload is additionally protected by the same upload contract lock (`images.ts:172-177`), but tags/topics/shares/settings/admin-users mostly rely on the process-local maintenance flag plus auth/origin gates (examples: `tags.ts:42-49`, `topics.ts:73-80`, `settings.ts:40-47`, `admin-users.ts:71-78`, `sharing.ts:78-85`).
- Failure scenario: in a clustered/serverless deployment, process P1 starts restore and imports SQL while process P2 has its own `globalThis` flag unset. P2 can update tags/topics/shares/settings/admin users against tables being dropped/recreated/restored, causing lost writes, failed foreign keys, or state from “during restore” to survive unexpectedly after import.
- Suggested fix: make maintenance state DB-backed or advisory-lock-backed for every mutating action. For example, create a `maintenance_state` row checked by the central action guard, or have mutating actions perform a non-blocking `GET_LOCK(LOCK_DB_RESTORE, 0)`/release pattern and fail closed if restore owns it. If deployment is guaranteed single-process, document that assumption and keep the severity lower.

### T-05 — Low / confirmed / Confidence: High
**Settings UI leaves “strip GPS on upload” editable after images exist, but the server rejects the change.**

- Evidence: server blocks a changed `strip_gps_on_upload` setting once any image exists (`settings.ts:115-132`). The UI disables `image_sizes` when `hasExistingImages` is true (`settings-client.tsx:142-155`) and shows a generic upload-contract lock message (`:182-185`), but the `Switch` for `strip_gps_on_upload` remains enabled (`:175-180`).
- Failure scenario: an admin toggles GPS stripping after images exist, presses save, and receives a server-side `uploadSettingsLocked`/failure even though the UI allowed the edit.
- Suggested fix: disable the switch when `hasExistingImages` is true, or change UI copy to explain that the switch cannot be changed after the first upload and prevent dirty-state submission for that field.

### T-06 — Low / risk / Confidence: Medium
**Admin user creation rate-limit is documented as CPU/abuse protection, but successful unique creations are rolled back.**

- Evidence: the comment says user creation is rate-limited to prevent brute-force/CPU DoS (`admin-users.ts:113-115`) and pre-increments before Argon2 hashing (`:122-128`). After successful insert/audit, it rolls back the attempt (`:151-154`). `admin-users.test.ts:150-162` appears to lock in this “success does not count” behavior.
- Failure scenario: an authenticated but compromised/malicious admin can create many unique users and force repeated Argon2 hashes without consuming the hourly `user_create` budget. This is admin-only, so severity is low, but the implementation does not match the stated DoS intent.
- Suggested fix: decide the intended semantics. If it is a CPU/account-creation budget, count successful creations and only roll back validation/duplicate/infrastructure failures. If it is only a failed-attempt budget, rename comments/messages and consider a separate daily account-count cap.

## 4. Confirmed non-findings / mitigated suspicious paths

- **Original upload serving:** mitigated by private original root and serve whitelist (`upload-paths.ts:27-40`; `serve-upload.ts:37-49`).
- **Upload processing marks DB before files exist:** queue verifies all derivatives before `processed=true` (`image-queue.ts:306-324`).
- **Share creation for unprocessed images:** photo/group share actions reject unprocessed inputs (`sharing.ts:95-99`, `:210-220`).
- **Proxy header spoofing by default:** `getClientIp` ignores forwarded headers unless `TRUST_PROXY=true` (`rate-limit.ts:123-153`).
- **Static-cache drift on primary dynamic pages:** public pages use `revalidate=0` and mutations call localized/app-wide revalidation as listed in the navigation trace.
- **Restore/upload race in one process:** restore holds the upload-processing contract lock and queue maintenance hooks (`db-actions.ts:298-354`; `image-queue.ts:527-559`). Cross-process non-upload mutations remain T-04.

## 5. Final missed-issues sweep

Performed a final source sweep across `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/src/__tests__`, `apps/web/e2e`, and `apps/web/next.config.ts` for `export async function`, `GET_LOCK`, `RELEASE_LOCK`, `getRestoreMaintenanceMessage`, `preIncrementShareAttempt`, share rollback, and revalidation calls. The sweep confirmed:

- Every traced mutating action family has an auth/origin/maintenance gate, but the maintenance gate is process-local (T-04).
- Advisory-lock users are upload contract, restore, topic route segment, image-processing claim, and admin-user delete; only admin-user delete uses per-target scoping for a global invariant (T-01).
- Public share lookup rate limiting is body-only by design/tests, leaving metadata DB work outside the throttle (T-03).
- Share write rollback sites are mostly after pre-increment except the already-existing photo share branch (T-02).

Skipped files confirmed: `node_modules`, `.next`, generated build/cache artifacts, upload data directories, binary screenshots/fixtures under `.context/reviews`, historical review/aggregate reports, and non-flow UI-only components not participating in the requested state/data/control paths. Relevant tests were inventoried and selectively inspected for source contracts; I did not run the test suite because this was a report-only review and application code was not changed.

## 6. Counts by severity

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 2 |

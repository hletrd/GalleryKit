# Cycle 1 review-plan-fix — debugger latent bug / failure-mode review

## Scope and inventory
I reviewed the bug-relevant parts of `apps/web` end-to-end, focusing on data mutation, upload/processing, route handling, locale pathing, cleanup, and retry logic.

### Review inventory
- **Actions / mutations**: `src/app/actions/auth.ts`, `src/app/actions/images.ts`, `src/app/actions/public.ts`, `src/app/actions/seo.ts`, `src/app/actions/settings.ts`, `src/app/actions/sharing.ts`, `src/app/actions/tags.ts`, `src/app/actions/topics.ts`, `src/app/actions/admin-users.ts`
- **Route and layout surfaces**: `src/app/[locale]/layout.tsx`, `src/app/[locale]/(public)/page.tsx`, `src/app/[locale]/(public)/[topic]/page.tsx`, `src/app/[locale]/(public)/p/[id]/page.tsx`, `src/app/[locale]/(public)/g/[key]/page.tsx`, `src/app/[locale]/(public)/s/[key]/page.tsx`, `src/app/[locale]/(public)/uploads/[...path]/route.ts`, `src/app/uploads/[...path]/route.ts`, `src/app/api/og/route.tsx`, `src/app/api/admin/db/download/route.ts`, `src/app/sitemap.ts`, `src/app/manifest.ts`, `src/app/robots.ts`, `src/app/[locale]/admin/*`, `src/app/dashboard/*`
- **Core libraries**: `src/lib/data.ts`, `src/lib/process-image.ts`, `src/lib/image-queue.ts`, `src/lib/queue-shutdown.ts`, `src/lib/request-origin.ts`, `src/lib/session.ts`, `src/lib/rate-limit.ts`, `src/lib/auth-rate-limit.ts`, `src/lib/api-auth.ts`, `src/lib/upload-paths.ts`, `src/lib/serve-upload.ts`, `src/lib/image-url.ts`, `src/lib/seo-og-url.ts`, `src/lib/locale-path.ts`, `src/lib/gallery-config.ts`, `src/lib/gallery-config-shared.ts`, `src/lib/validation.ts`, `src/lib/tag-records.ts`, `src/lib/tag-slugs.ts`, `src/lib/upload-tracker.ts`, `src/lib/revalidation.ts`, `src/lib/restore-maintenance.ts`, `src/lib/db-restore.ts`, `src/lib/sql-restore-scan.ts`, `src/lib/backup-filename.ts`, `src/lib/csv-escape.ts`, `src/lib/sanitize.ts`, `src/lib/photo-title.ts`, `src/lib/base56.ts`, `src/lib/image-types.ts`, `src/lib/upload-limits.ts`, `src/lib/constants.ts`
- **User-facing components**: `src/components/home-client.tsx`, `src/components/image-manager.tsx`, `src/components/photo-viewer.tsx`, `src/components/lightbox.tsx`, `src/components/upload-dropzone.tsx`, `src/components/tag-input.tsx`, `src/components/search.tsx`, `src/components/admin-user-manager.tsx`, `src/components/info-bottom-sheet.tsx`, `src/components/photo-navigation.tsx`, `src/components/optimistic-image.tsx`, `src/components/nav.tsx`, `src/components/nav-client.tsx`, `src/components/admin-nav.tsx`, `src/components/admin-header.tsx`
- **Tests inspected during the sweep**: `src/__tests__/request-origin.test.ts`, `action-guards.test.ts`, `check-action-origin.test.ts`, `serve-upload.test.ts`, `upload-tracker.test.ts`, `queue-shutdown.test.ts`, `locale-path.test.ts`, `next-config.test.ts`, `image-url.test.ts`, `public-actions.test.ts`, `tag-slugs.test.ts`, `tag-records.test.ts`, `tags-actions.test.ts`, `images-actions.test.ts`, plus the other adjacent unit suites in `src/__tests__`

### Verification
- `apps/web`: `npm test` passed — **50 test files / 298 tests**

## Findings

### 1) Upload tag ingestion can persist an empty slug, creating an unreachable tag row
**Status:** Confirmed issue
**Severity:** Medium
**Confidence:** High

**Code region(s):**
- `src/app/actions/images.ts:109-116, 261-290`
- `src/lib/tag-records.ts:5-12`
- `src/lib/validation.ts:32-39`
- `src/db/schema.ts:68-72`

**Why this fails:**
`uploadImages()` validates each tag with `isValidTagName()` and then immediately derives the slug with `getTagSlug(cleanName)` before calling `ensureTagRecord()`.
`isValidTagName()` allows many punctuation-only inputs, but `getTagSlug()` strips non-letter/non-number characters and can return `""`.
Because `tags.slug` is `NOT NULL UNIQUE`, that empty string is persisted as a real tag slug, but it cannot be routed to, searched by slug, or round-tripped through the normal tag APIs.

**Concrete failure scenario:**
A user uploads a photo with tags like `!!!` or `🎉`. The upload succeeds, but the database receives a tag row with `slug = ''`. That tag becomes effectively orphaned: it is visible only as a broken DB record, not as a usable tag. If the same user later uploads another punctuation-only tag, it collides with the same empty slug and is either dropped or ambiguous.

**Why this is not just theoretical:**
The current test coverage only exercises non-empty slugs (`Night Sky`, `풍경`, `서울 야경`) and the happy-path upload flow. There is no test covering a tag name that normalizes to an empty slug.

**Suggested fix:**
Validate the derived slug before insert (`isValidTagSlug(getTagSlug(cleanName))`) and reject the tag if it is empty/invalid. For upload flow, either fail the upload with a clear tag-format error or return a structured per-file warning so the client can surface the loss. Also mirror the warning behavior used in `batchUpdateImageTags()` instead of only logging collisions.

**Related inconsistency:**
`src/app/actions/tags.ts:372-389` already warns and skips colliding/invalid tag additions in the admin batch-update path, which means the upload path is the outlier that can silently lose tag metadata.

---

### 2) Deletion cleanup does not remove historical image-size variants after config changes
**Status:** Likely risk
**Severity:** Medium
**Confidence:** High

**Code region(s):**
- `src/lib/process-image.ts:170-205`
- `src/app/actions/images.ts:406-419, 518-533`
- `src/lib/image-queue.ts:266-273`

**Why this fails:**
`deleteImageVariants()` only deletes the base file plus the filenames derived from the size list passed in. When callers pass the current configured `imageSizes`, cleanup is deterministic, but it only knows the *current* list. If admin image sizes changed since the image was generated, older derivative filenames are not included and will survive on disk.

**Concrete failure scenario:**
1. Images are processed while the gallery uses `[640, 1536, 2048, 4096]`.
2. Later, the admin reduces the list to `[800, 1600]`.
3. A previously processed image is deleted.
4. Cleanup removes `*_800.*` / `*_1600.*` variants, but the old `*_2048.*` and `*_4096.*` files for that image remain in the upload directories.

That creates orphaned derivatives that can accumulate across deletes, eventually producing disk-pressure failures that the upload preflight (`statfs`) will surface as rejected uploads.

**Suggested fix:**
For delete-time cleanup, force the directory-scan branch (`sizes = []`) so the code removes every file matching the image prefix, not just the current size list. If I/O cost is a concern, persist the historical size set per image and use that during cleanup.

**Why I’m calling this a risk rather than a confirmed regression:**
The code path clearly leaves stale files behind under a size-change scenario, but I did not run a destructive repro on the live filesystem. The logic gap itself is confirmed.

---

### 3) OptimisticImage retries every failure up to five times and never uses the advertised fallback path
**Status:** Likely risk
**Severity:** Low to Medium
**Confidence:** Medium

**Code region(s):**
- `src/components/optimistic-image.tsx:9-42`
- `src/components/home-client.tsx:285-295`
- `src/components/image-manager.tsx:368-375`

**Why this fails:**
The component comment says it stops retrying on a “definitive 404” and only retries network/5xx cases, but the `onError` handler does not have HTTP status information. In practice it retries any error up to 5 times, with exponential backoff, before showing the final error state. The `fallbackSrc` prop is declared but unused, so there is no real fallback behavior.

**Concrete failure scenario:**
A deleted image or permanently broken upload path in the homepage grid or admin image manager will continue retrying for ~15 seconds before showing the `imageUnavailable` message. That produces unnecessary requests and delayed feedback on the most visible thumbnail surfaces.

**Suggested fix:**
Either implement a real fallback strategy (for example, a server-side existence probe or a dedicated placeholder path) or remove the misleading 404 comment and stop retrying the same source after the first failure. If the goal is resilience, a deterministic placeholder is better than five blind retries.

**Why this is a lower-severity issue:**
It is mainly a UX/perf failure mode rather than data corruption, but it affects primary browsing and admin preview surfaces.

---

## Missed-issues sweep
I did a final pass over the remaining high-risk surfaces — queue bootstrap/shutdown, upload serving, locale path helpers, revalidation, and the remaining admin/public actions — and did not find any additional high-confidence bugs beyond the findings above.

The main gap is still the empty-slug tag path: the tag action suite covers collision handling and normal tag creation, but not the punctuation-only / empty-slug case that breaks the upload path.

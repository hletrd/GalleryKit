# Debugger Review — Cycle 3 Latent-Bug Sweep

**Scope:** whole-repo latent-bug / failure-mode review of the current working tree.
**Inventory reviewed first:** app routes, public/admin pages, image-processing pipeline, tag/topic mutations, revalidation helpers, upload serving, storage abstraction, auth/session/rate-limit code, and backup/restore actions.
**Verification run:** `npm run lint --workspace=apps/web` ✅, `npm test --workspace=apps/web` ✅ (`13` files, `97` tests).

## Confirmed issues

### D3-01 — Changing `image_sizes` can strand existing photos on missing derivative URLs
**Severity:** High
**Confidence:** High
**Citations:** `apps/web/src/app/actions/settings.ts:35-85`, `apps/web/src/lib/gallery-config-shared.ts:48-53,95-101`, `apps/web/src/lib/process-image.ts:345-423`, `apps/web/src/components/home-client.tsx:249-287`, `apps/web/src/components/photo-viewer.tsx:201-221`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:167-173`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:45-57`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:65-79,145-147`

**Failure scenario:**
An admin edits `image_sizes` from the default set to a new list such as `320,640,1280`. `updateGallerySettings()` accepts the new value and revalidates the app, but `processImageFormats()` only generates derivatives at upload time. Existing images still have only the old size set on disk, while the public readers immediately build URLs from the new config. The result is a wave of 404s in the browser and broken OG / thumbnail URLs for already-uploaded content.

**Suggested fix:**
Treat `image_sizes` as a migration boundary, not a free-form runtime toggle. Either backfill all existing images whenever the setting changes, or make the readers fall back to sizes that actually exist on disk for each image. The current behavior assumes the new size list is universally available, which is not true for legacy content.

---

### D3-02 — Topic/tag label changes leave statically cached photo pages stale until ISR expiry
**Severity:** Medium
**Confidence:** High
**Citations:** `apps/web/src/app/actions/topics.ts:161-206`, `apps/web/src/app/actions/tags.ts:42-114`, `apps/web/src/app/actions/tags.ts:121-214`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:20-21,129-140,181-235`

**Failure scenario:**
`PhotoPage` is explicitly cached for one week and renders both `image.topic_label` and `image.tags`. `updateTopic()` revalidates the topic listing paths, but not the photo pages for images inside that topic. `updateTag()` and `deleteTag()` also skip photo-page invalidation entirely. After a topic rename or tag rename/delete, the photo page can keep showing the old topic label, old tag chips, and old breadcrumb text for up to 7 days unless some unrelated path happens to revalidate it first.

**Suggested fix:**
Invalidate the affected photo pages whenever a topic or tag mutation changes text that the photo page renders. For broad renames/deletes where enumerating every impacted image is expensive, use a broader invalidation strategy (`revalidateAllAppData()` or an equivalent full-tree invalidation) instead of relying on the weekly ISR window.

---

### D3-03 — Image deletion hides filesystem cleanup failures, leaving orphaned files still publicly servable
**Severity:** Medium
**Confidence:** High
**Citations:** `apps/web/src/app/actions/images.ts:347-383`, `apps/web/src/app/actions/images.ts:440-503`, `apps/web/src/lib/serve-upload.ts:28-113`

**Failure scenario:**
`deleteImage()` and `deleteImages()` delete the DB rows first and then perform filesystem cleanup in best-effort `try/catch` blocks that swallow any error. If `deleteOriginalUploadFile()` or one of the derivative deletions fails, the actions still report success. Because `serveUploadFile()` streams directly from the filesystem and does not consult the database, the supposedly deleted files can remain accessible by their direct upload URLs until an operator notices and cleans them up manually.

**Suggested fix:**
Make filesystem cleanup a first-class outcome. At minimum, return a partial-failure status and persist a retry/cleanup job when file deletion fails. The current log-and-continue pattern masks a real retention and consistency failure.

## Risks / follow-up

### R3-01 — Share-link rate-limit policy is split between a shared in-memory map and type-specific DB buckets
**Confidence:** Medium
**Citations:** `apps/web/src/app/actions/sharing.ts` (`checkShareRateLimit()`, `createPhotoShareLink()`, `createGroupShareLink()`), `apps/web/src/lib/rate-limit.ts`

The in-memory `shareRateLimit` map is shared across photo-share and group-share creation, while the DB-backed buckets are tracked separately as `share_photo` and `share_group`. That means the effective budget can differ between a warm process and a restarted process, and one share type can consume in-memory budget for the other. I did not confirm a user-visible breakage from this alone, but the policy split is worth reconciling if share-link abuse limits matter operationally.

## Missed-issues sweep

I rechecked the remaining high-risk surfaces for additional current regressions and did not find a stronger new crash/auth/security issue than the three confirmed findings above.

**Bottom line:** 3 confirmed latent bugs remain, with the image-size/config mismatch being the highest impact, plus 1 policy consistency risk worth tracking.

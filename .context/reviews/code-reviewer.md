# Code Reviewer Deep Review — Cycle 1

## Inventory / Coverage

Reviewed the tracked repository with emphasis on `apps/web` source, tests, build/deploy config, docs, and cross-file interactions.

Coverage buckets I checked:
- Public gallery flow: `app/[locale]/(public)`, `app/actions/public.ts`, `components/load-more.tsx`, `lib/data.ts`
- Admin/auth/maintenance flow: `app/actions/auth.ts`, `app/actions/images.ts`, `app/actions/settings.ts`, `app/actions/seo.ts`, `app/actions/topics.ts`, `app/actions/tags.ts`, `app/actions/sharing.ts`, `app/actions/admin-users.ts`, `app/[locale]/admin/*`
- Upload / processing / serving: `lib/image-queue.ts`, `lib/process-image.ts`, `lib/serve-upload.ts`, `app/uploads/[...path]/route.ts`, `app/[locale]/(public)/uploads/[...path]/route.ts`
- Security / request provenance / rate limits: `lib/request-origin.ts`, `lib/api-auth.ts`, `lib/rate-limit.ts`, `lib/session.ts`
- Supporting logic: `lib/gallery-config*.ts`, `lib/validation.ts`, `lib/sanitize.ts`, `lib/locale-path.ts`, `lib/image-url.ts`, `lib/revalidation.ts`, `lib/restore-maintenance.ts`, `lib/audit.ts`
- Scripts / config / docs / tests: root and app `package.json`, `README.md`, `CLAUDE.md`, `.context/reviews/prompts/*`, and the relevant `apps/web/src/__tests__` and `apps/web/e2e` coverage around the reviewed flows

Final sweep focus areas: pagination, upload cleanup, image processing retries, rate limiting, origin validation, and upload serving.

## Confirmed Issues

### 1. [High] Offset pagination over a live, mutating feed can skip or duplicate images

**Files / regions**
- `apps/web/src/app/actions/public.ts:23-40`
- `apps/web/src/lib/data.ts:318-335`
- `apps/web/src/lib/data.ts:359-385`
- `apps/web/src/lib/data.ts:420-438`
- `apps/web/src/components/load-more.tsx:20-41`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:9-16`

**Why this is a problem**
- The public infinite-scroll path and the admin image list both page with `offset` while ordering by `capture_date`, `created_at`, and `id`.
- That pagination scheme is unstable whenever rows are inserted, deleted, or move from unprocessed to processed between requests.
- Because uploads are processed asynchronously, the gallery content is actively mutating while users are loading more rows.

**Concrete failure scenario**
- A user loads the homepage and receives the first 30 photos.
- Before the next `loadMoreImages()` call, a new upload finishes processing and lands at the top of the sort order.
- The next request asks for `offset=30`, but the underlying result set has shifted, so one older photo is skipped or one already-seen photo is returned again.
- The same class of issue affects the admin dashboard when a user pages through a list while uploads finish in the background.

**Suggested fix**
- Replace offset pagination with cursor/keyset pagination based on the active sort tuple (`capture_date`, `created_at`, `id`).
- Thread that cursor through `loadMoreImages()` and `LoadMore`, and use the same approach for the admin list helpers if you want stable paging there too.

**Confidence**: High

---

### 2. [High] Deleted-during-processing cleanup only deletes the current default size set, so custom size variants can be orphaned

**Files / regions**
- `apps/web/src/lib/image-queue.ts:272-284`
- `apps/web/src/lib/process-image.ts:162-200`
- `apps/web/src/app/actions/images.ts:411-418` (the contrasting delete path already scans for historical variants)

**Why this is a problem**
- `deleteImageVariants()` only scans the directory for leftover variants when `sizes` is empty.
- In the queue cleanup path, `image-queue.ts` calls `deleteImageVariants()` with no explicit sizes array, so it uses the default size list instead of the sizes actually used for that job.
- The admin delete path already does the safer thing and passes `[]` so historical variants are discovered and removed.

**Concrete failure scenario**
- An image is uploaded while the gallery is configured to emit a custom size set.
- The user deletes that image while background processing is still running.
- The queue notices the row was deleted and runs the cleanup branch, but it only deletes files for the default size list.
- Any derivatives produced with the custom admin-configured sizes remain on disk indefinitely, creating storage leaks and leaving behind stale files that the rest of the code no longer knows about.

**Suggested fix**
- Make the queue job carry the exact size list used for processing, and pass that same list into cleanup; or
- for this rare deletion-after-processing race, use the scan-on-delete mode (`[]`) so every matching derivative basename is removed regardless of which size list created it.

**Confidence**: High

---

### 3. [Medium] Failed image processing can leave partially generated derivatives on disk

**Files / regions**
- `apps/web/src/lib/process-image.ts:381-460`
- `apps/web/src/lib/image-queue.ts:293-305`
- `apps/web/src/lib/image-queue.ts:357-361`

**Why this is a problem**
- `processImageFormats()` writes derivative files sequentially within each format and in parallel across formats.
- If any `sharp(...).toFile()` call throws after earlier variants have already been written, those earlier files remain on disk.
- The queue retry path only re-enqueues the job; after the retry budget is exhausted, there is no cleanup pass for already-written derivatives.
- The repository already has explicit cleanup for orphaned `.tmp` files, which makes the absence of equivalent cleanup for final derivative files stand out.

**Concrete failure scenario**
- A malformed or unusually expensive source image gets far enough to write a subset of WebP/AVIF/JPEG variants.
- One later encoder call fails.
- The job retries a few times and eventually gives up.
- The partially written derivatives remain forever, even though the image never becomes `processed=true`, so the queue has created real disk waste and a stale-file maintenance burden.

**Suggested fix**
- On any terminal processing failure, delete all known derivative filenames for that job before giving up; or
- change the processing flow to stage outputs in a temp location and only promote them after all formats succeed.

**Confidence**: Medium

## Likely Issues

### 4. [Medium] Missing `TRUST_PROXY` silently collapses rate-limited traffic into a single global bucket

**Files / regions**
- `apps/web/src/lib/rate-limit.ts:61-86`
- `README.md:135-138`
- `CLAUDE.md:248-253`

**Why this is a problem**
- `getClientIp()` returns the literal string `"unknown"` whenever `TRUST_PROXY !== 'true'`.
- Every login/search/share/admin-user rate-limited path keys off that same value.
- The docs say `TRUST_PROXY=true` is required behind a reverse proxy, but the code still falls back to a shared bucket instead of failing closed or rejecting the deployment shape.

**Concrete failure scenario**
- Someone deploys the app directly, or forgets to carry `TRUST_PROXY=true` into the production environment.
- Every visitor is rate-limited under the same `unknown` key.
- One abusive client can burn the budget for everyone else, and legitimate users can suddenly lose access to login, search, or other protected flows until the shared window expires.

**Suggested fix**
- Fail fast in production when proxy headers are expected but `TRUST_PROXY` is not set; or
- make the caller explicitly opt into the `unknown` fallback so the dangerous behavior is not the default; or
- require a resolved client IP before applying security-sensitive rate limits.

**Confidence**: Medium

## Risks Requiring Manual Validation

### A. [Low] The hard pagination caps may be too small if the gallery grows beyond the current assumptions

**Files / regions**
- `apps/web/src/app/actions/public.ts:27-30`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:9-16`

**Why this needs manual validation**
- The public infinite-scroll path stops returning rows once `offset > 10000`.
- The admin list clamps page numbers to 1000, which effectively caps how far back the UI can browse.
- Those limits are a reasonable DoS guard for small/medium galleries, but they become a functional ceiling if the repository is expected to scale beyond that.

**Manual validation ask**
- Confirm the product scope really will stay under those caps, or raise the limits / switch to a cursor-based paging model that does not need a hard stop.

**Confidence**: Low

## Final sweep

I rechecked the pagination paths, upload/cleanup paths, route serving, auth/rate-limit utilities, and the docs/config that constrain those behaviors. I did not find any additional confirmed correctness or maintainability defects beyond the items above.

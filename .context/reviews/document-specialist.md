# Document Specialist Review — GalleryKit

Scope: repository-wide documentation review focused on README / CLAUDE / AGENTS / deployment docs, configuration examples, and comments that contradict implementation. Generated/runtime artifacts (`node_modules`, `.git`, `.next`, `test-results`, `.omc`, `.omx` temp files) were excluded unless they were needed to verify behavior.

## Findings

### 1) Quick-start docs do not warn that uploads become visible only after background processing completes

- **Files / regions**
  - `README.md:101-102`
  - `apps/web/README.md:21`
  - Supporting implementation: `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/lib/data.ts:435-463`, `apps/web/src/app/actions/images.ts:373-388`
- **Mismatch**
  - The quick-start instructions say to upload one photo and then confirm the public homepage renders it, but the implementation only lists `processed=true` images on public pages and enqueues image conversion after the DB insert. A fresh upload is not guaranteed to appear immediately.
- **Failure scenario**
  - A new developer uploads a test photo, refreshes the homepage right away, and sees nothing because the Sharp queue has not finished yet. They may assume the upload failed when it only needs a short wait/refresh.
- **Suggested fix**
  - Add one sentence to the quick-start steps saying uploads are processed asynchronously and the homepage may take a moment to reflect the new photo.
- **Severity**
  - Medium
- **Confidence**
  - High
- **Validation**
  - Confirmed from source and targeted Vitest coverage.

### 2) Upload docs omit the hard 1 GiB free-space precheck

- **Files / regions**
  - `README.md:131-145`
  - `apps/web/README.md:40-43`
  - Supporting implementation: `apps/web/src/app/actions/images.ts:203-215`
  - Supporting test: `apps/web/src/__tests__/images-actions.test.ts:260-272`
- **Mismatch**
  - The docs describe file-size and batch-size limits, but they do not mention that `uploadImages()` also rejects uploads when the upload volume has less than 1 GiB free space.
- **Failure scenario**
  - An operator sizes the batch limits correctly, but uploads still fail with `insufficientDiskSpace` on a nearly full volume. The failure looks like a mystery because the documented limits were respected.
- **Suggested fix**
  - Document the minimum free-space requirement alongside the upload limit settings and deployment notes.
- **Severity**
  - Medium
- **Confidence**
  - High
- **Validation**
  - Confirmed from source and targeted Vitest coverage.

### 3) Settings docs miss that `image_sizes` and `strip_gps_on_upload` are locked once images exist

- **Files / regions**
  - `CLAUDE.md:176-180`
  - `CLAUDE.md:197-198`
  - Supporting implementation: `apps/web/src/app/actions/settings.ts:75-139`
  - Supporting test: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
- **Mismatch**
  - The docs describe image sizes as configurable and call out the upload-processing contract, but they do not say that changing `image_sizes` or `strip_gps_on_upload` is rejected once any image row already exists.
- **Failure scenario**
  - A maintainer uploads photos first and later tries to change the derivative sizes or GPS-stripping policy. The settings save fails with `imageSizesLocked` or `uploadSettingsLocked`, which is surprising if the lock was not documented.
- **Suggested fix**
  - Add an operational note that these settings must be finalized before the first image is added, or state explicitly that they are locked after the gallery has content.
- **Severity**
  - Medium
- **Confidence**
  - High
- **Validation**
  - Confirmed from source and targeted Vitest coverage.

### 4) SEO docs omit the same-origin / relative-only restriction on OG image URLs

- **Files / regions**
  - `README.md:43-56`
  - `apps/web/README.md:36-38`
  - Supporting implementation: `apps/web/src/lib/seo-og-url.ts:3-30`, `apps/web/src/app/actions/seo.ts:130-142`
  - Supporting test: `apps/web/src/__tests__/seo-actions.test.ts`
- **Mismatch**
  - The docs describe the OG image field as editable, but they do not say the value is restricted to either a root-relative path or a same-origin absolute URL.
- **Failure scenario**
  - An admin pastes a CDN or third-party URL into the OG image setting, then the save fails with `seoOgImageUrlInvalid`. Without the caveat, this looks like a broken admin form instead of a documented restriction.
- **Suggested fix**
  - Add the restriction to the SEO configuration docs and, ideally, to the admin UI helper text as well.
- **Severity**
  - Medium
- **Confidence**
  - High
- **Validation**
  - Confirmed from source and targeted Vitest coverage.

### 5) Docker deployment docs omit that the container runs migrations before starting the server

- **Files / regions**
  - `README.md:165-181`
  - `apps/web/README.md:34-46`
  - Supporting implementation: `apps/web/Dockerfile:89-90`
- **Mismatch**
  - The deployment docs explain build and run steps, but they do not mention that the production container executes `node apps/web/scripts/migrate.js` every time it starts, before launching `node apps/web/server.js`.
- **Failure scenario**
  - An operator restarts the container expecting a quick process restart, but startup stalls or fails in the migration step because the database is unavailable or a migration needs attention.
- **Suggested fix**
  - Add a short note to the Docker deployment section that booting the image also runs migrations, so operators know where startup failures can occur.
- **Severity**
  - Medium
- **Confidence**
  - High
- **Validation**
  - Confirmed from source.

### 6) `session.ts` contains a misleading “Dev-only fallback” comment

- **Files / regions**
  - `apps/web/src/lib/session.ts:40-45`
- **Mismatch**
  - The comment says the DB-backed secret path is “Dev-only,” but the code actually uses that fallback in every non-production environment, including test runs.
- **Failure scenario**
  - A maintainer reads the comment and assumes tests never touch the fallback path, which can hide accidental DB coupling or secret-handling regressions.
- **Suggested fix**
  - Change the comment to “Non-production fallback” or narrow the implementation if the fallback is truly intended only for development.
- **Severity**
  - Low
- **Confidence**
  - High
- **Validation**
  - Confirmed from source.

## Final sweep

- Reviewed the primary docs and deployment surface: `README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`, `.env` examples, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, and `apps/web/Dockerfile`.
- Reviewed the runtime/config/code paths that those docs describe: `next.config.ts`, `proxy.ts`, `content-security-policy.ts`, `request-origin.ts`, `rate-limit.ts`, `session.ts`, `seo-og-url.ts`, `gallery-config*.ts`, `upload-limits.ts`, `upload-paths.ts`, `settings.ts`, `seo.ts`, `images.ts`, `data.ts`, and the public-page routing files.
- Verified behavior with targeted Vitest runs covering request origin, rate limiting, health checks, SEO validation, backup downloads, session handling, validation/sanitization, upload settings locking, image queueing, upload limits, restore maintenance, and config guards.
- Excluded generated/runtime artifacts and temp outputs unless they were needed to verify behavior.

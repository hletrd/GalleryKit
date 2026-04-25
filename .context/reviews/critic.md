# Cycle 5 deep repository review — critic

## Inventory
Reviewed the repo across product surface, server actions, data layer, image pipeline, ops/deploy, security gates, and tests.

Primary areas reviewed:
- Docs/config: `README.md`, `apps/web/README.md`, root/app `package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/drizzle.config.ts`
- Data/auth/core libs: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/revalidation.ts`
- Server actions/routes: `apps/web/src/app/actions/{auth,images,public,settings,admin-users,sharing,topics,tags,seo}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/{health,live,og}/route.tsx`, upload routes, `apps/web/src/proxy.ts`
- Public/admin pages/components: localized root/public/topic/photo/share pages, admin dashboard/db/settings/seo layouts/pages, `components/{photo-viewer,home-client,nav,nav-client,footer,image-manager,upload-dropzone}`
- Tests/gates: representative unit and e2e coverage including `public-actions`, `images-actions`, `admin-users`, `topics-actions`, `health-route`, `live-route`, `backup-download-route`, `sql-restore-scan`, `admin.spec.ts`, `public.spec.ts`, `origin-guard.spec.ts`, `test-fixes.spec.ts`, `nav-visual-check.spec.ts`, plus lint-gate scripts `scripts/check-action-origin.ts` and `scripts/check-api-auth.ts`

Verification run during review:
- `npm run test --workspace=apps/web` ✅ (58 files, 341 tests)
- `npm run typecheck --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅

## Findings

### 1) Process-local coordination is still a runtime footgun, not an enforced deployment constraint
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** `README.md:145` explicitly says the app is intended for a single web-instance/single-writer deployment because restore maintenance, upload quotas, and image queue state are process-local. The code confirms that with process memory/global state in `apps/web/src/lib/image-queue.ts:67-132`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/upload-tracker-state.ts:7-60`, and buffered share-view counts in `apps/web/src/lib/data.ts:11-108`.
- **Why this matters:** the repo documents the limitation, but the runtime does not enforce it. A second web instance, serverless scale-out, blue/green overlap, or even an unexpected process restart can cause duplicate image processing, inconsistent restore lock behavior, lost share view counts, and per-process upload/rate state drift.
- **Failure scenario:** an operator scales the service to two replicas behind a load balancer. One replica enters restore maintenance while the other keeps accepting uploads; queue claiming partly mitigates duplicate processing, but upload quotas, maintenance state, and debounced share view increments diverge or get lost on restart.
- **Fix:** either (a) move queue state, maintenance state, upload quota tracking, and buffered counters into shared durable storage/locks, or (b) hard-fail startup when the deployment shape is multi-instance / non-sticky / serverless and surface that constraint in runtime diagnostics, not only in docs.

### 2) The “download JPEG” action is not downloading the original file; it serves the largest generated derivative
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `apps/web/src/lib/process-image.ts:371-417` makes the unsuffixed base filename the **largest configured generated size**, not the original asset. `apps/web/src/components/photo-viewer.tsx:101-103` then points downloads at `/uploads/jpeg/${image.filename_jpeg}`, and the actual download button uses that URL in `apps/web/src/components/photo-viewer.tsx:548-555`.
- **Why this matters:** the UI exposes original metadata (dimensions/format/file size) but the only download path is the optimized JPEG derivative. For large originals, users silently receive a lossy/downscaled export rather than the source image they likely expect.
- **Failure scenario:** a photographer uploads a 6000px RAW-derived image, sees full-resolution metadata in the viewer, clicks download, and receives a 4096px JPEG because that is the biggest configured derivative. This is hard to notice until downstream print/archive use fails.
- **Fix:** add an explicit original-download route for authorized cases, or rename the CTA to something accurate like “Download optimized JPEG” and show the downloadable dimensions/format next to it.

### 3) CSV export still materializes the full dataset twice across the server/client boundary
- **Severity:** Medium
- **Confidence:** High
- **Status:** Likely
- **Evidence:** `apps/web/src/app/[locale]/admin/db-actions.ts:33-94` loads up to 50,000 rows, builds a full in-memory CSV string, then returns it from a server action. The client then recreates the entire payload as a browser `Blob` in `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-118`.
- **Why this matters:** tests/lint pass because the path is functionally correct, but the architecture is memory-heavy and scales poorly. The server action payload, the CSV string, and the client-side blob all exist in memory in sequence for the same export.
- **Failure scenario:** a large gallery export works in dev seeds but stalls or crashes in production browsers/workers when the CSV grows into tens of MB. Even before OOM, the admin UI can freeze while serializing the server-action response and creating the Blob.
- **Fix:** move CSV export to a streaming/download route or background file generation path, then return a signed/admin URL instead of the raw CSV payload.

### 4) Backup/restore depends on `mysql`/`mysqldump` binaries, but that requirement is only guaranteed inside the container image
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:** backup spawns `mysqldump` in `apps/web/src/app/[locale]/admin/db-actions.ts:136-140`; restore spawns `mysql` in `apps/web/src/app/[locale]/admin/db-actions.ts:398-407`. The production container installs `mariadb-client` in `apps/web/Dockerfile:12-16`, but the local prerequisites in `README.md:83-99` mention Node/npm/MySQL only and do not call out these CLI binaries.
- **Why this matters:** the feature looks like an app capability, but outside the container it is really an OS dependency. A local/self-hosted non-Docker operator can reach the admin DB page and only discover the missing tooling at runtime.
- **Failure scenario:** a developer runs the app locally with a reachable MySQL server, opens the admin DB page, and backup/restore fails because the host lacks CLI clients even though the rest of the app works.
- **Fix:** document the CLI dependency explicitly, add an admin/runtime health check for binary availability, and disable or annotate the backup/restore controls when the host cannot execute them.

### 5) Shared-group pages do duplicate expensive DB work because metadata and page rendering call the cached loader with different argument shapes
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely
- **Evidence:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:30-36` calls `getSharedGroupCached(key, { incrementViewCount: false })` in `generateMetadata`, while `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:97-102` calls `getSharedGroupCached(key)` for the page itself. The cached wrapper is `cache(getSharedGroup)` at `apps/web/src/lib/data.ts:853`, and `getSharedGroup` itself performs a group query plus image query plus batched tag query in `apps/web/src/lib/data.ts:594-638`.
- **Why this matters:** the shared-group route is doing the expensive join/tag work twice per request path, once for metadata and once for render, because the cache key is no longer identical.
- **Failure scenario:** a hot shared-group link gets crawled/social-previewed heavily. Each request duplicates the group/image/tag DB load, inflating database pressure without improving correctness.
- **Fix:** split the loader into two layers (`getSharedGroupCore` + `incrementSharedGroupViewCount`) or compute metadata from the page-loaded data so the same cached fetch can be reused.

## Final sweep — commonly missed issues
- **Config split-brain remains:** SEO settings are DB-backed in `apps/web/src/lib/data.ts:870-890`, but analytics/home-link/footer still come directly from checked-in JSON at `apps/web/src/app/[locale]/layout.tsx:109-117`, `apps/web/src/components/nav-client.tsx:51-53`, and `apps/web/src/components/footer.tsx:34-38`. That means runtime admin changes only partially affect site branding/behavior.
- **Backup retention is missing from the reviewed code path:** backups are always written into `data/backups` in `apps/web/src/app/[locale]/admin/db-actions.ts:121-126`, and the download route serves whatever remains there in `apps/web/src/app/api/admin/db/download/route.ts:42-90`, but I found no pruning/retention logic in the reviewed repo paths.
- **Review blind spot in automated coverage:** the repo has strong unit coverage and opt-in public/admin E2E, but I did not find coverage for successful backup/restore flows or for the documented single-instance/process-local deployment assumption. Those are exactly the kinds of failures that only show up in ops.

## Files reviewed
- `README.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/README.md`
- `apps/web/next.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/vitest.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/drizzle.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/helpers.ts`

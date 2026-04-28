# Code review — code-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`  
Scope: static, read-only review of repository code quality, logic, SOLID/maintainability, and cross-file interactions. No fixes were implemented; only this report file was written.

## 1. Review inventory built before analysis

**Discovery command shape:** recursive file inventory excluding `node_modules`, `.git`, `.next`, Playwright/test-result reports, OMX/context state, plan scratch files, upload/data artifacts, and binary image/font payloads. Local secret `.env.deploy` and AppleDouble `._*` files were identified and excluded from content review. `.env.deploy.example` and `.env.local.example` were reviewed instead.

**Relevant files examined:** 295 files. **Excluded local artifacts:** 3 files (`.env.deploy`, `apps/web/._data`, `apps/web/public/._uploads`).

### Inventory by area
- Unit/integration tests: 71 file(s)
- Next app routes/actions/layouts: 53 file(s)
- Library modules: 51 file(s)
- React components: 45 file(s)
- Config/docs/root/app config: 33 file(s)
- Scripts: 15 file(s)
- Drizzle migrations/meta: 7 file(s)
- E2E tests: 6 file(s)
- Other src: 5 file(s)
- GitHub workflow/assets: 3 file(s)
- DB modules: 3 file(s)
- Messages: 2 file(s)
- Public source assets: 2 file(s)

<details>
<summary>Complete examined file inventory</summary>

#### Unit/integration tests
- `apps/web/src/__tests__/action-guards.test.ts`
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-rethrow.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/blur-data-url.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/client-source-contracts.test.ts`
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`
- `apps/web/src/__tests__/csv-escape.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- `apps/web/src/__tests__/data-tag-names-sql.test.ts`
- `apps/web/src/__tests__/data-view-count-flush.test.ts`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/exif-datetime.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/histogram.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/__tests__/image-queue.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/images-action-blur-wiring.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/images-delete-revalidation.test.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/load-more-rate-limit.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/og-rate-limit.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/process-image-blur-wiring.test.ts`
- `apps/web/src/__tests__/process-image-dimensions.test.ts`
- `apps/web/src/__tests__/process-image-variant-scan.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
- `apps/web/src/__tests__/share-key-length.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/storage-local.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/tag-label-consolidation.test.ts`
- `apps/web/src/__tests__/tag-records.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/tags-actions.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/upload-limits.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`

#### Next app routes/actions/layouts
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/apple-icon.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/icon.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`

#### Library modules
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/blur-data-url.ts`
- `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/csp-nonce.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/lib/validation.ts`

#### React components
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/aspect-ratio.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/scroll-area.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/upload-dropzone.tsx`

#### Config/docs/root/app config
- `.agent/rules/commit-and-push.md`
- `.dockerignore`
- `.env.deploy.example`
- `.gitignore`
- `.nvmrc`
- `AGENTS.md`
- `CLAUDE.md`
- `LICENSE`
- `README.md`
- `apps/web/.dockerignore`
- `apps/web/.env.local.example`
- `apps/web/.gitignore`
- `apps/web/Dockerfile`
- `apps/web/README.md`
- `apps/web/components.json`
- `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`
- `apps/web/drizzle.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/next-env.d.ts`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/tailwind.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.scripts.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/vitest.config.ts`
- `package-lock.json`
- `package.json`
- `scripts/deploy-remote.sh`

#### Scripts
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate-admin-auth.ts`
- `apps/web/scripts/migrate-aliases.ts`
- `apps/web/scripts/migrate-capture-date.js`
- `apps/web/scripts/migrate-titles.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/migration-add-column.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/scripts/seed-e2e.ts`
- `scripts/deploy-remote.sh`

#### Drizzle migrations/meta
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
- `apps/web/drizzle/0001_sync_current_schema.sql`
- `apps/web/drizzle/0002_fix_processed_default.sql`
- `apps/web/drizzle/0003_audit_created_at_index.sql`
- `apps/web/drizzle/meta/0000_snapshot.json`
- `apps/web/drizzle/meta/0001_snapshot.json`
- `apps/web/drizzle/meta/_journal.json`

#### E2E tests
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`

#### Other src
- `apps/web/src/i18n/request.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/site-config.example.json`
- `apps/web/src/site-config.json`

#### GitHub workflow/assets
- `.github/assets/logo.svg`
- `.github/dependabot.yml`
- `.github/workflows/quality.yml`

#### DB modules
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/seed.ts`

#### Messages
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

#### Public source assets
- `apps/web/public/.gitkeep`
- `apps/web/public/histogram-worker.js`

</details>

## 2. Findings summary

| ID | Severity | Confidence | Category | Finding |
| --- | --- | --- | --- | --- |
| CR-001 | Medium | High | Confirmed static path | Topic slug/alias validation allows several route segments that the public topic page always 404s. |
| CR-002 | Medium | High | Likely runtime bug from confirmed code path | Infinite scroll uses offset pagination against a mutable descending feed, causing duplicates/skips under concurrent uploads/deletes. |
| CR-003 | Low | Medium | Likely / manual validation | ICC `mluc` profile names are decoded as UTF-16LE even though the field is UTF-16BE, corrupting non-ASCII color profile metadata. |
| CR-004 | Low | High | Confirmed static path | Batch tag warnings returned by the server are ignored by the admin UI, hiding partial failures. |
| CR-005 | Low | Medium | Confirmed static path | DB restore enters global maintenance and quiesces the image queue before basic restore-file validation, so invalid submissions can briefly block the app. |

No high-severity correctness or security finding was confirmed during this static pass.

## 3. Detailed findings

### CR-001 — Topic route validation and public route guards use different reserved-segment sets

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed static path
- **Files / regions:**
  - `apps/web/src/lib/validation.ts:3-10`, `17-19` defines the shared `RESERVED_TOPIC_ROUTE_SEGMENTS` as only `admin`, `g`, `p`, `s`, `uploads`, and locales.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:19-31`, `133-136` adds a separate page-local deny-list for `apple-icon`, `favicon.ico`, `icon`, `manifest`, `manifest.webmanifest`, `robots.txt`, and `sitemap.xml`, and returns `notFound()` for those topic segments.
  - `apps/web/src/app/actions/topics.ts:102-107`, `204-209`, `402-407` call only the shared helper when creating/updating topics or aliases.
  - `apps/web/src/app/actions/topics.ts:35-46`, `123-131`, `231-234`, `408-412` check only existing DB topics/aliases for conflicts.
- **Problem:** The write-side validation and read-side routing invariants disagree. Admin mutations prevent slugs such as `admin` or `p`, but they still allow no-dot reserved segments that the public topic page itself refuses to render, notably `icon`, `manifest`, and `apple-icon`.
- **Concrete failure scenario:** An admin creates a topic with slug `icon` (or creates `icon` as an alias). The action accepts it because `isReservedTopicRouteSegment('icon')` is false and no DB row conflicts. The topic can then appear in admin/category lists and public navigation, but visiting `/en/icon` hits the topic page guard and returns a 404. SEO/sitemap/navigation can advertise a topic that users cannot open.
- **Suggested fix:** Consolidate every topic-route reserved segment into one exported shared helper/constant and use it in both `validation.ts` and the `[topic]` page. Keep the DB uniqueness check as a separate concern. Add regression tests in `topics-actions.test.ts` and `validation.test.ts` that `icon`, `manifest`, and `apple-icon` are rejected for topic slugs and aliases, and a page-level test proving the same helper drives the public guard.

### CR-002 — Offset pagination is unstable for the mutable gallery feed

- **Severity:** Medium
- **Confidence:** High
- **Category:** Likely runtime bug from confirmed code path
- **Files / regions:**
  - `apps/web/src/components/home-client.tsx:260-268` initializes `<LoadMore>` with `initialOffset={images.length}`.
  - `apps/web/src/components/load-more.tsx:20-61` stores a numeric `offset`, calls `loadMoreImages(..., offset, limit)`, appends the returned rows, then increments the offset by the number of rows returned.
  - `apps/web/src/app/actions/public.ts:66-95` accepts and forwards the offset to the data layer.
  - `apps/web/src/lib/data.ts:391-410` orders by `capture_date DESC`, `created_at DESC`, `id DESC`, then applies `.offset(offset)`.
- **Problem:** Offset pagination assumes the row ordering is stable between requests. This feed is explicitly mutable: uploads complete asynchronously, images can be deleted, capture dates/tags/topics can be edited, and background processing changes visibility. Because the sort order is descending by mutable data, row positions can shift after the first page has rendered.
- **Concrete failure scenario:** A visitor loads the first 30 photos. Before the observer fetches the next page, an admin uploads/processes a photo with the newest `capture_date` or deletes one photo from the first page. The next request still asks for `offset=30`; the database skips the first 30 rows in the new ordering, so one row can be missed or repeated in the appended page. With topic/tag filters the same shift can happen when an admin retags or retopics a photo.
- **Suggested fix:** Replace offset pagination with keyset/cursor pagination using the last rendered row's `(capture_date, created_at, id)` tuple and a stable tie-breaker predicate matching the `ORDER BY`. Carry the cursor in `LoadMore` instead of a count. If historical snapshots are required, add a snapshot timestamp/token and filter consistently across pages. Add a regression around `getImagesLite`/`loadMoreImages` proving that inserting a newer row between page 1 and page 2 does not skip existing rows.

### CR-003 — ICC `mluc` profile names are decoded with the wrong UTF-16 endianness

- **Severity:** Low
- **Confidence:** Medium
- **Category:** Likely / manual validation
- **Files / regions:**
  - `apps/web/src/lib/process-image.ts:341-352` handles ICC `mluc` profile-description tags and decodes the selected string with `Buffer.toString('utf16le')`.
  - `apps/web/src/app/actions/images.ts:307-312` persists `data.iccProfileName` into `images.color_space` when available.
- **Problem:** ICC `mluc` strings are stored as UTF-16BE. Decoding those bytes as UTF-16LE byte-swaps every code unit. ASCII-only names may look obviously garbled; non-ASCII localized profile names will be corrupted before being persisted as `color_space`.
- **Concrete failure scenario:** A JPEG with a localized ICC profile description stored in an `mluc` tag is uploaded. Processing extracts the right byte range but decodes it little-endian, producing unreadable text in `color_space`. The admin/photo metadata then displays bad color-profile data and any future filtering/export based on the field inherits the corruption.
- **Suggested fix:** Decode `mluc` text as UTF-16BE. In Node this can be done by byte-swapping the selected slice before `utf16le`, or by using a runtime-supported `TextDecoder('utf-16be')` path with fallback. Keep the existing length/bounds checks and add a fixture-based unit test for an `mluc` record containing both ASCII and non-ASCII characters.

### CR-004 — Server-side batch-tag warnings are dropped by the admin client

- **Severity:** Low
- **Confidence:** High
- **Category:** Confirmed static path
- **Files / regions:**
  - `apps/web/src/app/actions/tags.ts:300-331` filters the requested image IDs to existing images and returns `{ success: true, warning: ... }` when some selected images were missing.
  - `apps/web/src/components/image-manager.tsx:199-218` treats every truthy `res.success` as a plain success toast and never reads `res.warning`.
- **Problem:** The action intentionally communicates partial success, but the UI discards that information. This breaks the contract between server action and client and makes partial failures invisible to admins.
- **Concrete failure scenario:** An admin selects several images in the dashboard. Another admin or browser tab deletes one of those images before the batch tag submission completes. The server tags the remaining images and returns a warning such as “some images not found,” but the client shows only the generic batch-success toast, clears the selection, closes the dialog, and refreshes. The operator has no indication that not all originally selected images were tagged.
- **Suggested fix:** In `handleBatchAddTag`, show `res.warning` with a warning/destructive toast or combine it with the success message before clearing the selection. Consider keeping the dialog open for partial success if the warning needs operator action. Add a component/unit test or action-client contract test asserting that warnings are surfaced.

### CR-005 — Restore maintenance starts before basic restore-file validation

- **Severity:** Low
- **Confidence:** Medium
- **Category:** Confirmed static path
- **Files / regions:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:300-332` acquires the restore lock, calls `beginRestoreMaintenance()`, flushes buffered view counts, and quiesces the image-processing queue before invoking `runRestore`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:350-393` performs basic restore-file validation only inside `runRestore`: no file, file size, stream-to-temp, and plausible SQL dump header.
  - `apps/web/src/lib/restore-maintenance.ts:21-27`, `44-55` exposes maintenance state used by many public/admin actions and health checks.
- **Problem:** Invalid restore submissions still enter the same maintenance window as real restores until `runRestore` rejects them. For a missing file this window is tiny; for a large but invalid SQL-like upload it lasts through temp-file streaming and header validation. During that window public load-more/search, admin mutations, health, and image queue bootstrap paths observe restore maintenance and may block or report degraded health.
- **Concrete failure scenario:** An admin accidentally submits a 200 MB non-dump file. The action enters maintenance and quiesces processing before discovering the header is invalid. Users can see load-more/search maintenance errors and `/api/health` can report unhealthy even though no destructive restore has begun. Repeated invalid submissions can produce avoidable operational noise.
- **Suggested fix:** Split restore validation into a pre-maintenance phase and a maintenance phase. Validate presence, size, temp-file write, and plausible dump header before `beginRestoreMaintenance()` and before queue quiescence. Only acquire/hold global maintenance for the actual database restore and cache/queue consistency window. Add a regression in `db-restore.test.ts`/`backup-download-route.test.ts` (or a new action test) proving invalid headers do not toggle maintenance or quiesce the queue.

## 4. Maintainability / architecture notes without findings

- The project has strong guard coverage around server actions, origin validation, restore maintenance, upload processing, privacy field selection, and rate limits. Several previously risky paths have explicit regression tests and comments explaining invariants.
- The largest maintainability risk is duplicated route knowledge: public route guards, validation helpers, sitemap/nav generation, and action validation should continue moving toward shared constants to avoid drift like CR-001.
- The data layer is generally centralized, but pagination semantics leak through `HomeClient`/`LoadMore`/`public.ts`/`data.ts`; moving to a cursor object would reduce cross-file coupling and make the feed invariant explicit.

## 5. Final sweep

- Inventory was built before reviewing findings. All 295 relevant non-artifact files listed in the inventory were examined by direct reading, line-numbered region inspection, targeted cross-file tracing, or repository-wide static search.
- Exclusions were limited to dependency/vendor directories (`node_modules`), VCS/build/test artifacts (`.git`, `.next`, Playwright reports/results), OMX/context/planning scratch state, local upload/data blobs, binary image/font payloads, AppleDouble metadata files, and the local secret `.env.deploy`. The corresponding examples/configs were included where relevant.
- No relevant source, migration, script, config, message, or test file from the inventory was intentionally skipped.
- Verification was static only. I did not run lint/typecheck/tests because the assignment was read-only except for writing this review artifact and those commands can create or mutate caches/artifacts.

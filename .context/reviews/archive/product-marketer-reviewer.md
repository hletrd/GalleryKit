# Product Marketing Review — GalleryKit

Reviewer role: `product-marketer-reviewer`
Repo: `/Users/hletrd/flash-shared/gallery`
Output: `.context/reviews/product-marketer-reviewer.md`
Scope: product messaging, onboarding, README/SEO/metadata, empty states, user-facing copy, discoverability, trust, and market-positioning consistency. This pass is read-only except for this review artifact.

## Review-relevant inventory

I excluded `node_modules`, `.git`, build/output/generated artifacts, uploaded image derivatives, and prior review/context artifacts. I inspected the following review-relevant docs, configs, routes, metadata generators, UI copy, admin/public components, user-facing actions, deployment files, and tests.

<details>
<summary>Inventory of inspected files (146)</summary>

- `.github/assets/logo.svg`
- `.github/workflows/quality.yml`
- `README.md`
- `package.json`
- `apps/web/.env.local.example`
- `apps/web/Dockerfile`
- `apps/web/README.md`
- `apps/web/docker-compose.yml`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/src/__tests__/client-source-contracts.test.ts`
- `apps/web/src/__tests__/data-tag-names-sql.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
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
- `apps/web/src/app/uploads/[...path]/route.ts`
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
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/site-config.example.json`
- `apps/web/src/site-config.json`

</details>

## Findings

### 1. Quickstart promises “upload one photo” before the product has a category to upload into

- **Severity:** High
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:**
  - `README.md:97-101` runs `npm run init --workspace=apps/web`, starts dev, then tells the owner to “log in at `/en/admin`, upload one photo”.
  - `apps/web/README.md:17-21` repeats the same `npm run init` / `npm run dev` path and “upload one photo” instruction.
  - `apps/web/package.json:17-18` defines `db:seed` as admin-only seeding and `init` as `tsx scripts/init-db.ts`.
  - `apps/web/scripts/init-db.ts:24-31` only executes `node scripts/migrate.js`.
  - `apps/web/scripts/migrate.js:502-522` seeds only the default `admin` user; `apps/web/scripts/migrate.js:540-542` then calls that admin seed after migrations.
  - `apps/web/src/components/upload-dropzone.tsx:178-183` disables the dropzone when `!hasTopics`, and `apps/web/src/components/upload-dropzone.tsx:312-316` renders “Create a category before uploading”.
  - `apps/web/messages/en.json:141-142` confirms the no-category state: “Create a category before uploading” and “Photos need a category before they can be uploaded.”
  - `apps/web/e2e/admin.spec.ts:66-81` uploads into a pre-existing `e2e-smoke` category, so the documented fresh-install path is not protected by the current E2E happy path.
- **Problem:** The README onboarding path is not actually executable on a fresh database. The install docs skip the required “create a category” step, but the upload UI hard-blocks uploads until a category exists.
- **User/business failure scenario:** A self-hosting evaluator follows the quickstart, signs in, tries to validate the app by uploading a first photo, and hits a disabled upload area. The first-run moment looks broken rather than guided, which can cause churn before the product demonstrates its core value.
- **Suggested fix:** Update both READMEs to insert “create a category” before “upload one photo”; add an obvious CTA from the no-category upload state to `/admin/categories`; and/or seed a default “Gallery” category during `init` if that is acceptable for new installs. Add a first-run E2E test that starts with only the admin user and verifies the owner can discover the category prerequisite.

### 2. The public first-run empty state is a dead end for owners and visitors

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:**
  - `apps/web/src/components/home-client.tsx:270-284` renders the empty gallery state as only an icon plus `home.noImages`; the clear-filter hint appears only when tag filters are active.
  - `apps/web/messages/en.json:200-216` defines the empty state as “No photos.”, with “Try fewer filters” only for filtered empty results.
  - `apps/web/messages/ko.json:200-216` mirrors the same compact empty-state structure for Korean.
  - `apps/web/src/components/footer.tsx:49-50` includes an `Admin` link, but it is a small footer link and is not connected to the empty-state recovery path.
- **Problem:** The same sparse empty state is used for a genuinely empty new gallery and for a filtered result with no matches. It does not explain whether the site is newly set up, whether the visitor should come back later, or how the owner can add the first photo.
- **User/business failure scenario:** A gallery owner shares the new public URL before adding content, or opens it after deployment to validate the install. Visitors see “No photos.” and may assume the app, database, or upload pipeline is broken. The owner has no contextual next step in the main content area.
- **Suggested fix:** Split the copy and UI into two cases: zero-library and filtered-empty. For zero-library, use a warmer message such as “No photos yet” plus an owner-oriented CTA (“Sign in to add photos” or “Open admin”) where appropriate. For filtered-empty, keep the current “Try fewer filters” / “Clear” recovery path.

### 3. Core taxonomy drifts across “Topics”, “Albums”, “Categories”, “Shared Album”, and “Shared Photos”

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:**
  - `README.md:31-37` markets the feature as “Topics & Albums” while explaining that photos are organized into “categories”.
  - `apps/web/messages/en.json:64-98` uses `manageTopics` internally but exposes the admin concept as “Categories”, with fields “Name” and “Slug”.
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:161-183` presents the management UI as “Categories”.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:67-73` builds topic/category page metadata from `topicData.label` and the translation key `photosInTopic`.
  - `apps/web/messages/en.json:274-281` labels a shared collection as “Shared Album”.
  - `apps/web/messages/en.json:299-311` labels the group-share route as “Shared Photos”, while its not-found copy says “Shared album not found” and its not-found description says “shared collection”.
- **Problem:** The product’s information architecture is not stable. The README sells “topics and albums”; the admin UI asks users to create “categories”; the route code and internal naming still say “topic”; share pages alternate between “album”, “photos”, and “collection”.
- **User/business failure scenario:** A prospective user reads the README expecting album management, then lands in an admin UI with categories and no album primitive. When they send a “Shared Album” link, recipients may expect a persistent album page, but the product is actually a generated share collection. This weakens product positioning and increases support/documentation friction.
- **Suggested fix:** Choose a single public taxonomy and apply it consistently. If the target buyer is photographers/families, “Albums” may be more intuitive than “Categories”; if the technical structure should remain categories, then remove “Albums” from marketing copy and call share links “shared collections” or “shared links”. Keep internal `topic` names if desired, but align all visible README, admin, route metadata, and share copy.

### 4. Filtered-page SEO uses raw tag slugs while the visible UI uses humanized tag labels

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:**
  - `apps/web/src/app/[locale]/(public)/page.tsx:33-43` generates filtered home-page metadata from `tagSlugs`, producing titles like `#music_festival | Site` and descriptions from raw slug strings.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:63-73` does the same on topic/category pages.
  - `apps/web/src/components/home-client.tsx:125-145` maps active tag chips through `humanizeTagLabel` before rendering them in the page heading.
  - `apps/web/src/components/tag-filter.tsx:59-99` explicitly documents and applies humanized display names for tag pills.
  - `apps/web/messages/en.json:211` and `apps/web/messages/en.json:529` use the supplied `{tags}` value in SEO-facing “Browse {tags} photos…” messages.
- **Problem:** The visible interface has been polished to show human-readable tags, but browser titles, meta descriptions, and social/search snippets for filtered URLs still use raw canonical slugs.
- **User/business failure scenario:** A filtered gallery URL shared in Slack, Messages, or a search result can show `#family_trip_2026` instead of `#Family Trip 2026`. That makes the gallery look less curated and can reduce trust/discoverability even though the in-page UI looks correct.
- **Suggested fix:** Build filtered metadata from the matched tag records (`allTags`) and pass `humanizeTagLabel(tag.name)` or another display label into title/description generation. Keep slug-based canonical routing and current `noindex` behavior for filtered pages, but make snippets match the UI copy.

### 5. The default upload flow creates public photos with no useful title/description, causing “Untitled” and “Photo {id}” to leak into cards and metadata

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:**
  - `apps/web/src/app/actions/images.ts:288-301` inserts uploaded images with `title: null`, `description: ''`, and the original filename stored only as `user_filename`.
  - `apps/web/src/lib/data.ts:179-206` defines public fields by deliberately omitting `user_filename`; `apps/web/src/lib/data.ts:388-390` warns not to add original/user filenames to public queries for privacy.
  - `apps/web/src/components/home-client.tsx:172-173` falls back to `image.user_filename || t('common.untitled')` when building the card display title; public listing data does not include `user_filename`.
  - `apps/web/messages/en.json:510-524` defines the public fallbacks “Untitled”, “Photo”, and “Photo {id}”.
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:61-79` uses `Photo {id}` as the metadata fallback title and then falls back to that display title for description when no photo description exists.
  - `apps/web/src/__tests__/data-tag-names-sql.test.ts:8-13` explicitly guards against a previous regression where every card became “View photo: Untitled” / alt “Photo”.
- **Problem:** The privacy decision not to expose original filenames is sound, but the product has no compensating first-run/content-quality nudge. A normal batch upload can create a public gallery full of generic titles and weak SEO/social metadata unless the admin later edits every photo or adds tags.
- **User/business failure scenario:** A photographer uploads an event set without manually adding per-photo titles. The public grid and photo pages show generic labels like “Untitled” or “Photo 42”, making the gallery feel unfinished and less searchable/shareable.
- **Suggested fix:** Add a lightweight title/description step to upload or post-upload editing; surface an admin checklist/warning for untitled photos; or derive a safe public default from non-sensitive context such as category label, capture date, and humanized tags. Keep `user_filename` private unless the owner explicitly opts into using cleaned filenames.

### 6. Branding controls are split between admin SEO settings and file/static defaults, so rebranding remains visibly incomplete

- **Severity:** Low to Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:**
  - `README.md:43-55` says admins can edit `title`, `description`, `nav_title`, `author`, `locale`, and OG image URL in the dashboard while static links and analytics remain file-backed.
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:91-155` exposes title, nav title, description, author, and locale; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:158-174` exposes only the Open Graph image URL in the second card.
  - `apps/web/src/site-config.json:2-10` still defaults `footer_text` to “Powered by GalleryKit”.
  - `apps/web/src/components/footer.tsx:36-49` always renders the file-backed footer text plus a hard-coded GitHub link to `https://github.com/hletrd/gallerykit`.
  - `apps/web/src/app/manifest.ts:9-28` uses dynamic SEO names but fixed `/icon` and `/apple-icon` assets.
  - `apps/web/src/app/icon.tsx:12-38` and `apps/web/src/app/apple-icon.tsx:10-33` generate a static GalleryKit-style image mark.
- **Problem:** The dashboard makes the product feel rebrandable, but several public brand surfaces remain static or file-only. Owners can change the nav/site metadata and still show “Powered by GalleryKit”, an upstream GitHub link, and generic app icons.
- **User/business failure scenario:** A user deploys a private client/family archive and changes the site title to their own brand. On the public page footer and installed-web-app icon, the site still reads as a GalleryKit template. That may be fine for open-source attribution, but it is inconsistent with the admin promise of SEO/branding control.
- **Suggested fix:** Decide whether visible GalleryKit attribution is a product requirement. If yes, state that clearly in the SEO/branding UI and README. If no, move footer text/link and app icon/brand mark into a single Branding area or document the file-edit path next to the dashboard SEO settings.

### 7. The OG image setting says relative paths are allowed, but the input is typed as an absolute URL field

- **Severity:** Low
- **Confidence:** Medium
- **Category:** Likely; manual browser validation recommended
- **Evidence:**
  - `apps/web/messages/en.json:338-340` labels the field “OG Image URL” and says the value may be a “Same-origin URL or path.”
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:164-173` renders the field as `<Input ... type="url" />`.
  - `apps/web/src/lib/seo-og-url.ts:9-10` accepts relative paths beginning with `/`.
  - `apps/web/src/__tests__/seo-actions.test.ts:5-20` verifies that `/uploads/og.jpg` is accepted and cross-origin URLs are rejected.
- **Problem:** The backend and helper copy permit `/uploads/og.jpg`, but `type="url"` communicates absolute-URL semantics to browsers, mobile keyboards, password/form managers, and native validity states.
- **User/business failure scenario:** An admin follows the hint and enters `/uploads/og.jpg`. Depending on browser interaction and validation timing, the field can look invalid or behave like a URL-only input, making the documented relative-path option feel unsupported.
- **Suggested fix:** Change the input to `type="text"` with explicit same-origin/path helper text and server-side validation, or update copy and validation to require a full same-origin URL.

## Final sweep / coverage confirmation

- I inspected the full inventory above across root docs, app docs, site config examples/defaults, translations, public/admin routes, SEO metadata generators, share routes, upload/search/gallery components, admin settings, server actions, deployment files, and user-facing tests.
- I intentionally did not inspect or cite generated/runtime outputs, uploaded derivatives, `node_modules`, `.git`, or prior `.context` review artifacts.
- I found no additional high-confidence product-marketing issues in the public route wrappers, localized root error/loading/not-found shells, health/live APIs, UI primitive components, action-origin helpers, or deployment scripts beyond the onboarding/branding trust points listed above.
- I did not implement fixes. The only intended repository write from this pass is this markdown review file.

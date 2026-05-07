# Comprehensive Review — Cycle 4 (2026-04-19)

## Review Scope

Full codebase review focusing on: fresh findings since C39, SEO/Open Graph gaps, admin-configurable SEO requirement, and verification that prior fixes remain intact.

## New Findings

### C4-01: SEO metadata is hardcoded in site-config.json with no admin UI [HIGH] [HIGH confidence]
- **Files**: `apps/web/src/site-config.json`, all `generateMetadata()` functions
- **Description**: The `site-config.json` file contains the only source of SEO metadata (`title`, `description`, `url`, `author`, `nav_title`). There is no admin page to edit these values. Any change requires a code deployment. The user-injected TODO explicitly requests making SEO/OG configurable from the admin page.
- **Current state**: `site-config.json` is imported statically at build time. All `generateMetadata()` calls across 5 page routes read from it directly. The root layout `metadata` export also reads from it.
- **Impact**: Site operators cannot update their gallery title, description, or OG defaults without redeploying. This is the primary feature gap for this cycle.
- **Fix**: Create an `seo_settings` row in `admin_settings` table, add admin UI to manage SEO fields, and make `generateMetadata()` read from DB with JSON file as fallback.

### C4-02: Open Graph image for homepage uses full-resolution JPEG instead of OG-optimized size [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/page.tsx` lines 45-52
- **Description**: The homepage `generateMetadata()` constructs the OG image URL as `/uploads/jpeg/${latestImage.filename_jpeg}` -- this is the base (2048px) JPEG, which can be several megabytes. Social media crawlers will time out downloading large OG images. The topic page correctly uses the `/api/og` route for its OG image, but the homepage and shared pages do not.
- **Fix**: Use the sized variant `_1536.jpg` for OG images on the homepage, matching the photo page pattern.

### C4-03: Shared photo/group OG images use `_2048.webp` which may be too large for some crawlers [MEDIUM] [MEDIUM confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` line 39, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` lines 41, 53
- **Description**: Both shared photo and shared group pages use `_2048.webp` for OG images. While WebP is efficient, 2048px is still very large for social media previews (Twitter recommends 1200x630, Facebook max 1200x630). Some crawlers also don't support WebP.
- **Fix**: Use `_1536.jpg` as JPEG fallback (widest crawler support) for OG images on shared pages.

### C4-04: `og:type` is `'website'` on shared photo pages but should be `'article'` [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` line 44
- **Description**: The photo page (`/p/[id]`) correctly sets `og:type: 'article'` with `publishedTime` and `authors`. The shared photo page (`/s/[key]`) sets `og:type: 'website'` even though it displays the same photo content. While not strictly wrong, `'article'` is more semantically appropriate for individual photo pages.
- **Fix**: Change `type: 'website'` to `type: 'article'` on the shared photo page, and add `publishedTime` if the image has a capture/creation date.

### C4-05: No `og:locale:alternate` tags on any page [LOW] [MEDIUM confidence]
- **Files**: All `generateMetadata()` functions
- **Description**: The site supports English and Korean (`LOCALES = ['en', 'ko']`), but individual pages don't declare alternate locales in their OG metadata. The root layout has `alternates.languages` for SEO but no corresponding `openGraph.locale` alternates. This reduces discoverability in non-default locales on social platforms.
- **Fix**: Add `locale: { alternate: ['ko_KR', 'en_US'] }` to the root layout OG config and relevant pages.

### C4-06: `home-client.tsx` eslint-disable for `react-hooks/set-state-in-effect` still present [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/home-client.tsx` line 158
- **Description**: C3R-04 fixed the same pattern in `info-bottom-sheet.tsx` by using a ref guard. The same pattern exists in `home-client.tsx` line 158 (`eslint-disable-next-line react-hooks/set-state-in-effect`) for `setAllImages(images)`. The same ref-based guard approach should be applied for consistency.
- **Fix**: Track previous `images` prop via a ref and only call `setAllImages` when the images array reference actually changes.

### C4-07: `og:image` on topic page passes unsanitized `tags` param to `/api/og` [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` line 51
- **Description**: The OG image URL is constructed as `${BASE_URL}/api/og?topic=${topicData.slug}&tags=${tagSlugs.join(',')}`. While `topicData.slug` comes from the DB, the `tags` parameter values come from user input (URL query param) and are passed directly into the OG URL. The OG route does sanitize internally, but the URL itself could contain special characters. Using `encodeURIComponent` would be safer.
- **Fix**: Encode the tags parameter with `encodeURIComponent()` before constructing the URL.

### C4-08: Root layout `metadata` reads `siteConfig` at import time -- cannot be overridden per-request [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/layout.tsx` lines 16-45
- **Description**: The root layout exports a static `metadata` object that reads `siteConfig.title`, `siteConfig.description`, etc. at module evaluation time. If we make SEO settings dynamic (admin-configurable), this static export cannot read from the DB. The `generateMetadata()` pattern used by child pages can be dynamic, but the root layout uses the static `metadata` export.
- **Fix**: When implementing admin-configurable SEO (C4-01), convert the root layout from `export const metadata` to `export async function generateMetadata()` so it can read from the DB.

### C4-09: `robots.ts` uses `process.env.BASE_URL || siteConfig.url` while other pages use `BASE_URL` from constants [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/robots.ts` line 21
- **Description**: The robots file derives the sitemap URL with `process.env.BASE_URL || siteConfig.url` directly, while other files import `BASE_URL` from `@/lib/constants`. This is functionally equivalent but introduces a second source of truth for the same computation.
- **Fix**: Import `BASE_URL` from `@/lib/constants` for consistency.

### C4-10: Upload dropzone tag label wraps a `div` instead of being associated with the TagInput [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/components/upload-dropzone.tsx` lines 235-244
- **Description**: The `<label htmlFor="upload-tags">` is associated with `<div id="upload-tags">` which contains the `TagInput`. A `<label>` associated with a `<div>` via `htmlFor`/`id` doesn't provide proper accessibility -- screen readers won't announce the label when the TagInput receives focus because `div` elements are not labelable. The `htmlFor` attribute only works with labelable form elements.
- **Fix**: Use `aria-labelledby` on the TagInput wrapper instead of `htmlFor`/`id` on a div. Add `role="group"` with `aria-labelledby` pattern.

## Verification of Prior Fixes

### C3R-01 (photo-viewer GPS guard): VERIFIED
- `photo-viewer.tsx` line 474 now uses `isAdmin` with a clear comment. Fix properly implemented.

### C3R-02 (batchAddTags name-first lookup): VERIFIED
- `tags.ts` lines 121-128 and 219-224 both use name-first, slug-fallback lookup. Fix properly implemented.

### C3R-03 (document.title stale restoration): VERIFIED
- `photo-viewer.tsx` lines 75-82 now uses `siteTitleRef`. Fix properly implemented.

### C3R-04 (info-bottom-sheet eslint-disable): PARTIALLY VERIFIED
- `info-bottom-sheet.tsx` fixed, but same pattern in `home-client.tsx` line 158 still present. See C4-06.

### C39-01 through C39-03, SEC-39-01, SEC-39-03: All verified as properly implemented.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status. See Plans 105 and 107 for the full list.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security, DB schema (schema.ts), admin pages, public pages, API routes (health, og, db download), SEO routes (robots.ts, sitemap.ts, manifest.ts), SQL restore scanning (sql-restore-scan.ts), validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager), root layout metadata, site-config.json.

# Aggregate Review — Cycle 4 (2026-04-19)

**Source reviews:** cycle4-comprehensive-review (fresh deep review with SEO/OG focus)

## Summary

Cycle 4 fresh deep review of the full codebase found **10 new actionable issues** (1 HIGH, 2 MEDIUM, 7 LOW) plus the user-injected SEO/OG configuration requirement. No CRITICAL findings. No regressions from prior cycles. All C39 fixes confirmed properly implemented.

## New Findings (Deduplicated)

### C4-01: SEO metadata is hardcoded in site-config.json with no admin UI [HIGH] [HIGH confidence]
- **Files**: `apps/web/src/site-config.json`, all `generateMetadata()` functions, `apps/web/src/app/[locale]/layout.tsx`
- **User-injected TODO**: "Prepare for more SEO and open graph optimizations, showing title and descriptions. Make SEO / open graph configurable from admin page."
- **Description**: The `site-config.json` file contains the only source of SEO metadata (`title`, `description`, `url`, `author`, `nav_title`). There is no admin page to edit these values. Any change requires a code deployment. The root layout uses a static `metadata` export that reads from this file at module evaluation time, so it cannot be made dynamic without refactoring.
- **Fix**: (1) Add SEO fields to `admin_settings` table, (2) Create a `getSeoSettings()` data accessor with `site-config.json` fallback, (3) Convert root layout from `export const metadata` to `export async function generateMetadata()`, (4) Add admin SEO settings page, (5) Update all `generateMetadata()` functions to read from DB.

### C4-02: Open Graph image for homepage uses full-resolution JPEG instead of OG-optimized size [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/page.tsx` lines 45-52
- **Description**: The homepage `generateMetadata()` constructs the OG image URL as `/uploads/jpeg/${latestImage.filename_jpeg}` -- this is the base (2048px) JPEG, which can be several megabytes. Social media crawlers will time out downloading large OG images. The topic page correctly uses the `/api/og` route for its OG image, but the homepage does not.
- **Fix**: Use the sized variant `_1536.jpg` for OG images on the homepage, matching the photo page pattern.

### C4-03: Shared photo/group OG images use `_2048.webp` which may be too large for some crawlers [MEDIUM] [MEDIUM confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` line 39, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` lines 41, 53
- **Description**: Both shared photo and shared group pages use `_2048.webp` for OG images. While WebP is efficient, 2048px is still very large for social media previews. Some crawlers also don't support WebP.
- **Fix**: Use `_1536.jpg` as JPEG fallback (widest crawler support) for OG images on shared pages.

### C4-04: `og:type` is `'website'` on shared photo pages but should be `'article'` [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` line 44
- **Description**: The photo page (`/p/[id]`) correctly sets `og:type: 'article'`. The shared photo page sets `og:type: 'website'` even though it displays the same photo content.
- **Fix**: Change `type: 'website'` to `type: 'article'` on the shared photo page.

### C4-05: No `og:locale:alternate` tags on any page [LOW] [MEDIUM confidence]
- **Files**: All `generateMetadata()` functions
- **Description**: The site supports English and Korean but individual pages don't declare alternate locales in OG metadata.
- **Fix**: Add locale alternate information to the root layout OG config.

### C4-06: `home-client.tsx` eslint-disable for `react-hooks/set-state-in-effect` still present [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/home-client.tsx` line 158
- **Description**: C3R-04 fixed the same pattern in `info-bottom-sheet.tsx` by using a ref guard. The same pattern exists in `home-client.tsx`.
- **Fix**: Use a ref guard or add a justification comment matching the `info-bottom-sheet.tsx` pattern.

### C4-07: `og:image` on topic page passes unsanitized `tags` param to `/api/og` [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` line 51
- **Description**: The tags parameter values come from user input and are passed directly into the OG image URL without `encodeURIComponent`.
- **Fix**: Encode the tags parameter with `encodeURIComponent()`.

### C4-08: Root layout `metadata` reads `siteConfig` at import time -- cannot be overridden per-request [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/layout.tsx` lines 16-45
- **Description**: The root layout exports a static `metadata` object. If SEO settings become dynamic (C4-01), this static export cannot read from the DB. Prerequisite for C4-01.
- **Fix**: Convert from `export const metadata` to `export async function generateMetadata()`.

### C4-09: `robots.ts` uses `process.env.BASE_URL || siteConfig.url` while other pages use `BASE_URL` from constants [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/robots.ts` line 21
- **Description**: Inconsistent BASE_URL derivation across files.
- **Fix**: Import `BASE_URL` from `@/lib/constants`.

### C4-10: Upload dropzone tag label wraps a `div` instead of being associated with the TagInput [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/components/upload-dropzone.tsx` lines 235-244
- **Description**: `<label htmlFor="upload-tags">` associated with `<div id="upload-tags">` is not accessible since div elements are not labelable.
- **Fix**: Use `aria-labelledby` on the TagInput wrapper instead of `htmlFor`/`id` on a div.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status:
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window

## Agent Failures

None -- single-agent deep review completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security, DB schema (schema.ts), admin pages, public pages, API routes (health, og, db download), SEO routes (robots.ts, sitemap.ts, manifest.ts), SQL restore scanning (sql-restore-scan.ts), validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager), root layout metadata, site-config.json.

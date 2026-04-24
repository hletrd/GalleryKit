# Product-Marketer Reviewer — Deep Code Review (GalleryKit)

**Date:** 2026-04-24
**Lane:** `product-marketer-reviewer` compatibility lane
**Agent prompt loaded:** `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` was available and read. Its BurstPick-specific photography-app language was adapted to this GalleryKit repo.
**Repository:** `/Users/hletrd/flash-shared/gallery`
**Output requested:** `./.context/reviews/product-marketer-reviewer.md`
**Commit status:** Review artifact only; no commit made per prompt.

## Executive Summary

GalleryKit has a credible engineering core for a self-hosted photo publishing product, but its public messaging is not launch-ready because it undersells the real wedge, overstates or mislabels several features, and leaves legal/privacy/SEO trust decisions implicit. **Go-to-market readiness: 5.8/10 for a public open-source launch, 4.5/10 for a polished self-hosted product launch.** The single biggest issue is that the README and default metadata position GalleryKit as just “a high-performance, self-hosted photo gallery,” which is too generic in a crowded market; the defensible angle in the code is more specific: **a privacy-conscious, bilingual, admin-managed, self-hosted photo portfolio/publishing kit with local derivative generation, share links, and private originals.** Fix the first-run docs, remove/qualify unsupported claims, make license/privacy/SEO behavior explicit, and the product becomes much easier to trust.

## Classification Legend

- **Confirmed:** Directly evidenced in code/docs/current copy.
- **Likely:** Strongly implied by implementation and product flow, but not proven by a failing test.
- **Risk:** Not necessarily wrong today, but likely to create user confusion, legal exposure, or conversion loss.

## Review Inventory / Coverage

I inventoried and inspected the relevant product-marketing surface area rather than sampling.

### Docs, onboarding, deploy, and config surfaces inspected

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `package.json`
- `.env.deploy.example`
- `scripts/deploy-remote.sh`
- `apps/web/README.md`
- `apps/web/package.json`
- `apps/web/.env.local.example`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/scripts/init-db.ts`
- `apps/web/src/site-config.example.json`
- local ignored `apps/web/src/site-config.json` where present, only to understand deployed defaults

### User-facing copy and route surfaces inspected

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/global-error.tsx`
- public `error.tsx`, `not-found.tsx`, and `loading.tsx` route states

### Components and admin surfaces inspected

- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/user-manager.tsx`
- admin layout/page/login/protected layout/loading/error/dashboard/categories/tags/db/password/users/SEO/settings pages and clients

### Implementation surfaces inspected to verify claims

- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`

### Tests/specs inspected where they encode product behavior

- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`

## Claim Verification Snapshot

| Public/user-facing claim | Evidence | Status | Marketing read |
|---|---|---:|---|
| “High-performance, self-hosted photo gallery” | README hero at `README.md:7-9`; Sharp derivatives in implementation; MySQL/Next stack in docs | Likely true, under-proven | Technically plausible but generic; needs a buyer/outcome/proof point. |
| Masonry grid + infinite scroll | Feature copy at `README.md:31`; public grid/load-more implementation inspected | Confirmed | Strong product feature; should be translated into “fast public browsing.” |
| AVIF/WebP/JPEG optimization | Feature copy at `README.md:32`; `sharp` dependency and processing path inspected | Confirmed | Real differentiator for self-hosted portfolios. |
| “Topics & Albums” / categories | README copy at `README.md:33`; UI messages use “Categories” at `apps/web/messages/en.json:502-503`; schema uses `topics` at `apps/web/src/db/schema.ts:4-14` | Confirmed inconsistency | Pick one user-facing term. |
| EXIF incl. GPS | README copy at `README.md:34`; GPS columns at `apps/web/src/db/schema.ts:32-41`; extraction at `apps/web/src/lib/process-image.ts:507-524`; public omission at `apps/web/src/lib/data.ts:154-181` | Confirmed but privacy-ambiguous | The implementation is safer than the marketing explains. |
| “Full metadata search” | README copy at `README.md:35`; actual search fields at `apps/web/src/lib/data.ts:748-753`, tags at `apps/web/src/lib/data.ts:771-780`, aliases at `apps/web/src/lib/data.ts:797-806` | Confirmed overbroad | Search is useful but not “full metadata.” |
| Share links with Base56 keys | README copy at `README.md:36`; sharing/action/base56 surfaces inspected | Confirmed | Add “unlisted/noindex” trust copy. |
| “Batch editing” | README copy at `README.md:37`; batch toolbar supports tag/share/delete at `apps/web/src/components/image-manager.tsx:253-330`; metadata edit is per image at `apps/web/src/components/image-manager.tsx:474-493` | Confirmed overbroad | Say “bulk tagging, sharing, and delete.” |
| English/Korean i18n | README copy at `README.md:38`; locale constants at `apps/web/src/lib/constants.ts:1-4`; parity script found 500 keys each, zero missing | Confirmed structurally | EXIF values remain English; see PM-10. |
| Docker support | README copy at `README.md:39`; Docker instructions at `README.md:158-169`; compose host-network assumptions inspected | Confirmed with caveats | Current copy is appropriately caveated, unlike older “one command” style claims. |
| SEO/admin controls | Admin fields at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:89-175`; base URL comes from env/site-config at `apps/web/src/lib/data.ts:883-890` | Partial | Admin can edit SEO text, not public canonical origin. |
| AI positioning | Repo-wide sweep of README/messages/routes/components/libs | Confirmed absent | Good. Do not add AI copy without real implementation. |

---

# Detailed Findings

## PM-01 — Generic positioning does not choose a beachhead user or wedge

- **Severity:** High
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- README hero says only “A high-performance, self-hosted photo gallery built with Next.js” (`README.md:7-9`).
- The first substantive product section is a feature list, not a target-user/outcome statement (`README.md:29-39`).
- Default metadata repeats generic category language: title “GalleryKit,” description “A self-hosted photo gallery,” footer “Powered by GalleryKit” (`apps/web/src/site-config.example.json:2-10`).

**Failure scenario**

A self-hoster or photographer comparing GalleryKit with PhotoPrism, Immich, Piwigo, Lychee, static-site galleries, SmugMug, or Pixieset cannot tell in the first 10 seconds whether this is a public portfolio publisher, private family archive, lightweight DAM, client-proofing tool, or developer starter. Without a chosen wedge, the evaluator defaults to larger projects with clearer category expectations.

**Concrete fix**

Rewrite the hero around the product truth already visible in code:

> GalleryKit is a privacy-conscious, bilingual, self-hosted photo portfolio for creators who want fast public galleries, private originals, local derivative generation, and admin-managed publishing.

Add “Best for / Not for” immediately under the hero:

- **Best for:** self-hosted creator portfolios, bilingual galleries, admin-managed photo publishing, share links, private originals with public derivatives.
- **Not for:** mobile camera backup, face recognition, full DAM/catalog replacement, client proofing/payments, S3/MinIO storage today.

---

## PM-02 — First-run docs run initialization before environment setup

- **Severity:** High
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- Root installation runs `npm run init --workspace=apps/web` before the README tells the user to create/edit `.env.local` (`README.md:87-95` versus `README.md:109-128`).
- App-level quick start also lists `npm run init` before any `.env.local` copy/edit step (`apps/web/README.md:7-14`).
- `init-db.ts` loads `.env.local` from the app root (`apps/web/scripts/init-db.ts:14-16`) and runs migration using that process env (`apps/web/scripts/init-db.ts:24-30`).
- DB connection construction expects `DB_USER`, `DB_PASSWORD`, and `DB_NAME` from env (`apps/web/src/db/index.ts:13-19`).
- `.env.local.example` contains required DB/public/admin settings (`apps/web/.env.local.example:1-29`).

**Failure scenario**

A first-time evaluator follows the README literally. `npm run init --workspace=apps/web` runs before DB credentials, admin password, and session secret exist. The product may be sound, but the first ten minutes feel broken, which is fatal for self-hosted adoption.

**Concrete fix**

Make the happy path ordered and complete:

1. Install dependencies.
2. Create MySQL database/user.
3. `cp apps/web/.env.local.example apps/web/.env.local` and edit DB/admin/public URL values.
4. `cp apps/web/src/site-config.example.json apps/web/src/site-config.json` and edit title/url.
5. `npm run init --workspace=apps/web`.
6. `npm run dev`.
7. Log in at `/en/admin`, upload a first photo, confirm the public homepage renders.

Add a root `npm run doctor`/`npm run check:setup` script later if desired, but the immediate fix is copy order and explicit prerequisites.

---

## PM-03 — Settings copy claims processing concurrency while the UI cannot configure it

- **Severity:** Medium-High
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- English settings copy says “Configure image quality, output sizes, and processing concurrency” and includes “Processing Concurrency” strings (`apps/web/messages/en.json:520-529`).
- Korean copy mirrors that concurrency claim (`apps/web/messages/ko.json:520-529`).
- The Settings UI renders image quality and output sizes only in the image-processing card (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89-152`), then privacy GPS only (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:155-178`).
- Configurable DB-backed settings only include quality, sizes, and GPS stripping (`apps/web/src/lib/gallery-config-shared.ts:10-19`, defaults at `apps/web/src/lib/gallery-config-shared.ts:40-46`).
- Actual job concurrency is env-only: `new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2 })` (`apps/web/src/lib/image-queue.ts:115-118`).
- `.env.local.example` documents `SHARP_CONCURRENCY` but not `QUEUE_CONCURRENCY` (`apps/web/.env.local.example:31-38`).

**Failure scenario**

An admin reads “processing concurrency,” expects a setting, and cannot find it. A deployer trying to tune throughput may set `SHARP_CONCURRENCY` thinking it controls queue parallelism while the queue remains at 2. That is both a UX trust break and an ops documentation gap.

**Concrete fix**

Choose one path:

- **Copy-only fix:** Change settings description to “Configure image quality and output sizes.” Remove unused `queueConcurrency` strings or leave them only if the UI is imminent.
- **Feature fix:** Add a validated setting key for queue concurrency, wire it into queue creation safely, and document `QUEUE_CONCURRENCY` in `.env.local.example` if env remains the source of truth.

---

## PM-04 — Dormant storage/gallery/upload-limit copy advertises features not wired into the live product

- **Severity:** Medium-High
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- Settings translation files include public/admin copy for gallery display columns, upload limits, and storage backends including MinIO/S3 (`apps/web/messages/en.json:530-553`, `apps/web/messages/ko.json:530-553`).
- The settings UI only renders image processing and GPS privacy sections (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89-178`).
- Live setting keys do not include display columns, upload limits, or storage backend (`apps/web/src/lib/gallery-config-shared.ts:10-19`).
- Storage abstraction comments explicitly say production upload/processing/serving still use direct filesystem paths and the abstraction is not wired into the live pipeline (`apps/web/src/lib/storage/index.ts:4-12`, `apps/web/src/lib/storage/types.ts:4-15`).

**Failure scenario**

A reviewer or translator sees MinIO/S3 and configurable gallery display strings and assumes those are shipping. A user searching the UI cannot find them. Worse, external docs or generated screenshots could accidentally promote object storage before it is real.

**Concrete fix**

Remove dormant strings from production translation files until wired, or move them behind a clearly named experimental namespace/comment. If S3/MinIO is roadmap, document it as **planned**, not configurable today.

---

## PM-05 — Photo JSON-LD hardcodes a Creative Commons BY-NC license without a visible configuration path

- **Severity:** High
- **Confidence:** High
- **Classification:** Confirmed legal/trust risk

**Evidence**

- Photo pages emit `ImageObject` JSON-LD (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:139-176`).
- The JSON-LD hardcodes `license: 'https://creativecommons.org/licenses/by-nc/4.0/'` (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:145`).
- `acquireLicensePage`, `creator`, and `copyrightNotice` are populated from `siteConfig.parent_url` / SEO author (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:146-152`).
- Root site config documentation lists title, description, URL, parent URL, locale, author, nav title, footer, and GA only; it does not document photo license (`README.md:41-58`).
- Admin SEO UI has title/nav/description/author/locale/OG image fields, not license/acquire-license controls (`apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:89-175`).

**Failure scenario**

A photographer publishes proprietary work and unknowingly emits machine-readable CC BY-NC licensing in search/social metadata. Search engines, crawlers, or downstream users may treat that as a reuse signal. This is a trust and legal-positioning problem even if page-visible text never says “Creative Commons.”

**Concrete fix**

Make photo license explicit and configurable, or omit it by default:

- Add `image_license_url` and `image_acquire_license_page` to site config/admin SEO; document defaults.
- If unset, do not emit `license` / `acquireLicensePage`.
- Add README copy: “GalleryKit does not assign a license to your photos unless configured.”

---

## PM-06 — GPS/privacy copy does not explain the full storage/publication model

- **Severity:** Medium-High
- **Confidence:** High
- **Classification:** Confirmed risk

**Evidence**

- README claims EXIF extraction includes GPS (`README.md:34`).
- Schema includes `latitude` and `longitude` columns (`apps/web/src/db/schema.ts:32-41`).
- EXIF extraction populates GPS when present (`apps/web/src/lib/process-image.ts:507-524`).
- Default privacy setting is `strip_gps_on_upload: 'false'` (`apps/web/src/lib/gallery-config-shared.ts:40-46`).
- Upload action strips GPS only when the privacy setting is enabled, or when DB config cannot be read (`apps/web/src/app/actions/images.ts:204-216`).
- Public selects intentionally omit latitude/longitude (`apps/web/src/lib/data.ts:154-181`).
- Viewer comments say GPS blocks are currently unreachable from public photo pages because public select fields exclude coordinates (`apps/web/src/components/photo-viewer.tsx:503-508`, `apps/web/src/components/info-bottom-sheet.tsx:352-355`).
- Admin copy says “Do Not Store GPS Coordinates on Upload” and clarifies existing images/source EXIF are not rewritten (`apps/web/messages/en.json:536-539`, `apps/web/messages/ko.json:536-539`).

**Failure scenario**

A privacy-sensitive user sees “EXIF Extraction — ... GPS” and assumes GPS is public, or sees the admin setting and assumes enabling it also rewrites old data and original files. The implementation is more nuanced and safer for public pages, but the README does not explain that nuance.

**Concrete fix**

Add a privacy section:

- “GalleryKit can extract GPS into private admin metadata.”
- “Public routes intentionally omit latitude/longitude by default.”
- “Enable ‘Do Not Store GPS Coordinates on Upload’ before importing location-sensitive images.”
- “The setting affects new metadata rows; it does not rewrite existing images or original source EXIF.”

---

## PM-07 — “Batch editing” overstates the admin feature set

- **Severity:** Medium
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- README says the admin dashboard includes “batch editing” (`README.md:37`).
- The selected-image toolbar supports batch add tag, share, and delete (`apps/web/src/components/image-manager.tsx:253-330`).
- Title/description editing is a single-image dialog (`apps/web/src/components/image-manager.tsx:474-493`).

**Failure scenario**

A photographer expects bulk metadata editing: batch title patterns, batch descriptions, category moves, capture-date edits, or EXIF/privacy operations. They find only tag/share/delete. The claim creates disappointment in exactly the admin workflow where trust matters.

**Concrete fix**

Change README copy to:

> **Admin Dashboard** — drag-and-drop uploads, bulk tagging/share/delete, per-photo title/description edits, multi-user auth (Argon2)

If broader batch editing is desired, implement and test bulk category/title/description/privacy operations before using that phrase.

---

## PM-08 — SEO Settings can edit SEO text but not the public/canonical origin that powers sitemap, robots, and metadata

- **Severity:** Medium
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- SEO admin UI exposes title, nav title, description, author, Open Graph locale, and OG image URL (`apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:89-175`).
- Runtime SEO URL comes from `process.env.BASE_URL || siteConfig.url`, not admin settings (`apps/web/src/lib/data.ts:883-890`).
- `BASE_URL` is the central source for metadata/canonical URLs (`apps/web/src/lib/constants.ts:11-14`).
- Sitemap uses `process.env.BASE_URL || siteConfig.url` (`apps/web/src/app/sitemap.ts:9-14`, entries at `apps/web/src/app/sitemap.ts:26-35`).
- Robots sitemap uses `BASE_URL` (`apps/web/src/app/robots.ts:1-20`).
- README example still shows local `BASE_URL=http://localhost:3000` in env setup (`README.md:117-128`).

**Failure scenario**

A site owner edits “SEO Settings” in admin and assumes search/social metadata is fixed, but canonical URLs and sitemap still use localhost or a stale domain from env/site-config. Search previews and crawlers receive the wrong origin.

**Concrete fix**

Either:

- Add a validated “Public site URL” field to admin settings and route all metadata/sitemap/robots through it; or
- Add explicit SEO UI copy: “Public URL/canonical origin is configured in `BASE_URL` or `site-config.json`, not here.”

Also add a production guard/warning when `BASE_URL` is localhost outside development.

---

## PM-09 — Open Graph locale is one global configured value even though routes are bilingual

- **Severity:** Medium
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- Supported route locales are `en` and `ko` (`apps/web/src/lib/constants.ts:1-4`).
- Root locale layout metadata is generated without a locale param (`apps/web/src/app/[locale]/layout.tsx:15-24`).
- Open Graph locale uses the single SEO setting `seo.locale`, and alternateLocale is always `['ko_KR', 'en_US']` (`apps/web/src/app/[locale]/layout.tsx:32-39`).
- Admin SEO UI exposes one “OG Locale” field (`apps/web/messages/en.json:316-317`, Korean mirror at `apps/web/messages/ko.json:316-317`).

**Failure scenario**

The Korean page can emit `en_US` if that is the configured default, or the English page can emit `ko_KR`. Social platforms and crawlers receive mixed locale signals, making the bilingual positioning less credible.

**Concrete fix**

Map route locale to OG locale in metadata:

- `/en` → `en_US`
- `/ko` → `ko_KR`
- `alternateLocale` → the other locale

If admin locale remains, call it “Default OG locale” and use it only as fallback for unknown locales.

---

## PM-10 — Korean UI localizes EXIF labels but not several EXIF values

- **Severity:** Medium
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- Viewer labels are translated in message files (`apps/web/messages/en.json`, `apps/web/messages/ko.json` viewer sections inspected).
- EXIF extraction stores English display strings such as `Auto`, `Manual`, `Center-weighted`, `Program AE`, `Forced On`, `Forced Off`, and `Not Fired` (`apps/web/src/lib/process-image.ts:538-583`).
- Photo viewer renders stored EXIF values directly (`apps/web/src/components/photo-viewer.tsx:467-495`).
- Bottom sheet also renders stored EXIF values directly (`apps/web/src/components/info-bottom-sheet.tsx:316-344`).

**Failure scenario**

A Korean visitor sees localized labels but English values in the same metadata panel. This feels like partial localization, not a fully bilingual product. For a product whose README claims English/Korean support, this matters.

**Concrete fix**

Store raw EXIF enum codes or normalized keys, then translate at render time. For existing rows, add a compatibility mapper from current English display strings to translation keys.

---

## PM-11 — Footer forces GalleryKit/GitHub/Admin affordances onto every public site

- **Severity:** Medium
- **Confidence:** High
- **Classification:** Confirmed positioning/white-label risk

**Evidence**

- Footer text itself is configurable via `siteConfig.footer_text` (`apps/web/src/components/footer.tsx:31-35`).
- GitHub link is hardcoded to `https://github.com/hletrd/gallerykit` (`apps/web/src/components/footer.tsx:37-45`).
- Admin link is visible on every public footer, localized to `/admin` and only marked `nofollow` (`apps/web/src/components/footer.tsx:46-48`).
- Default site config says “Powered by GalleryKit” (`apps/web/src/site-config.example.json:8-10`).

**Failure scenario**

A photographer deploys GalleryKit as their public portfolio. The visible footer still promotes the upstream project and exposes an Admin entry point. This is fine for a demo, but it weakens white-label/portfolio positioning and may make non-technical site owners feel less professional.

**Concrete fix**

Add site-config/admin settings such as:

- `show_powered_by_gallerykit` default true for demo/dev, documented false for production portfolios.
- `footer_links` for GitHub/custom social links.
- `show_admin_link` default false in production, or hide behind explicit config.

---

## PM-12 — Category naming is inconsistent: topics, albums, and categories all mean the same user concept

- **Severity:** Low-Medium
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- README says “Topics & Albums” but describes organizing photos into categories (`README.md:33`).
- User-facing browse copy says category, e.g. “Photos in {topic} category” (`apps/web/messages/en.json:500-503`).
- Internal schema names the table `topics` and aliases `topic_aliases` (`apps/web/src/db/schema.ts:4-14`).

**Failure scenario**

Docs say albums, UI says categories, URLs/schema say topics. Users form different mental models: albums imply curated collections, categories imply taxonomy, topics imply tags/subjects. This muddles onboarding and makes future feature naming harder.

**Concrete fix**

Pick one public word. Recommendation: **Albums** if the product is creator/portfolio-oriented, or **Categories** if the product is taxonomy/site-oriented. Keep `topics` internal if renaming the schema is not worth it, but standardize all user-facing copy.

---

## PM-13 — “Full metadata search” claims more than the implementation searches

- **Severity:** Low-Medium
- **Confidence:** High
- **Classification:** Confirmed

**Evidence**

- README says “full metadata search across titles, descriptions, cameras, and tags” (`README.md:35`).
- Main search checks title, description, camera model, topic slug, and topic label (`apps/web/src/lib/data.ts:748-753`).
- Secondary queries search tags (`apps/web/src/lib/data.ts:771-780`) and topic aliases (`apps/web/src/lib/data.ts:797-806`).
- The query does not search lens model, ISO, aperture, shutter speed/exposure time, focal length, color space, white balance, metering mode, exposure program, flash, GPS, or bit depth, despite those metadata fields existing in schema/process/rendering surfaces (`apps/web/src/db/schema.ts:32-45`, `apps/web/src/lib/process-image.ts:515-583`).

**Failure scenario**

A user searches “85mm”, “ISO 3200”, “f/1.8”, or lens names expecting “full metadata” search and gets no result. The search feature works; the marketing phrase is too broad.

**Concrete fix**

Change copy to:

> **Tagging & Search** — search titles, descriptions, camera model, albums/categories, tags, and slug aliases.

Only use “full metadata search” after adding broader EXIF-indexed search and tests.

---

## PM-14 — Homepage social preview silently uses the latest uploaded photo by default

- **Severity:** Low-Medium
- **Confidence:** High
- **Classification:** Confirmed risk

**Evidence**

- Home metadata uses a custom OG image when configured (`apps/web/src/app/[locale]/(public)/page.tsx:46-68`).
- If no custom image is configured, it fetches the latest image and uses that as the homepage OG image (`apps/web/src/app/[locale]/(public)/page.tsx:70-89`).
- Admin copy says leaving OG image empty uses the latest photo (`apps/web/messages/en.json:318-322`, Korean mirror at `apps/web/messages/ko.json:318-322`).

**Failure scenario**

A site owner uploads a private-feeling but public gallery image, then the homepage link preview changes unexpectedly across Slack/Kakao/Twitter/social caches. This is not a bug, but it is a brand-control risk.

**Concrete fix**

Prefer a generated branded default OG image and make “latest photo” an explicit opt-in toggle, or strengthen copy:

> Leave empty to use the latest public photo. This can change as you upload and may be cached by social platforms.

---

# Product-Market Fit Assessment

## Problem clarity

GalleryKit solves a real but narrower problem than the README states: **self-hosters and creator-photographers need a public gallery/portfolio they control, with local image optimization, admin upload management, bilingual routes, and private-original handling.** It is not a broad photo library, backup app, AI culling product, or full DAM.

## Target first user

The strongest first-user profile is:

> A developer/photographer or small creative studio that wants a self-hosted public photo portfolio, wants English/Korean publishing, values private originals and local derivatives, and is comfortable operating MySQL + Next.js.

Avoid “everyone with photos.” The current deployment/onboarding complexity makes the product a poor fit for non-technical photographers unless hosted/managed distribution is added.

## Wedge identification

Defensible wedge, code-verified:

- Self-hosted public portfolio with Next.js metadata/sitemap/social sharing.
- Local AVIF/WebP/JPEG derivative generation.
- Private originals/public derivatives deployment model.
- English/Korean UI structure.
- Admin upload, tagging, search, and share links.

The copy should lead with that package, not a generic “photo gallery.”

## Switching cost

Low if positioned as a **publishing layer** beside an existing editing/catalog workflow. High if positioned as a DAM replacement. Do not compete with Lightroom/PhotoPrism/Immich on library management; position as the final publishing surface after culling/editing elsewhere.

## Differentiation durability

The individual features are copyable. The defensible position is an opinionated bundle: privacy-first, self-hosted, bilingual, public portfolio, local derivatives, admin-managed publishing. That is specific enough to attract the right users and repel poor-fit users.

# Positioning Audit & Recommendation

## Current positioning

Current public positioning is category-generic:

- “A high-performance, self-hosted photo gallery built with Next.js” (`README.md:7-9`).
- Feature-led README list (`README.md:29-39`).
- Default description “A self-hosted photo gallery” (`apps/web/src/site-config.example.json:2-10`).

That could describe many projects.

## Recommended positioning

**Primary sentence:**

> GalleryKit is a privacy-conscious, bilingual, self-hosted photo portfolio kit for creators who want fast public galleries without handing originals, metadata, or presentation control to a SaaS.

**One sentence a user tells another user:**

> “It’s a self-hosted photo portfolio that generates fast AVIF/WebP/JPEG galleries, keeps originals private, supports English/Korean, and gives you an admin panel for publishing and share links.”

## Category choice

Enter an existing category: **self-hosted photo portfolio/publishing kit.** Do not create a new category. Do not imply a DAM, backup system, or AI product.

# Messaging Architecture

## Before → after copy recommendations

| Surface | Current | Recommended |
|---|---|---|
| Hero | “A high-performance, self-hosted photo gallery built with Next.js” | “A privacy-conscious, bilingual, self-hosted photo portfolio for creators who want fast public galleries and private originals.” |
| Feature: Topics | “Topics & Albums — organize photos into categories with slug aliases” | “Albums/Categories — organize public galleries with stable slugs and aliases.” |
| Feature: EXIF | “EXIF Extraction — ... GPS” | “EXIF-aware metadata — camera/lens/exposure details for viewers; GPS is private and can be stripped on upload.” |
| Feature: Search | “full metadata search” | “Search titles, descriptions, camera model, albums/categories, tags, and aliases.” |
| Feature: Admin | “batch editing” | “drag-and-drop uploads, bulk tagging/share/delete, per-photo metadata edits, multi-user auth.” |
| Settings | “quality, output sizes, and processing concurrency” | “quality and output sizes” unless concurrency becomes configurable. |
| SEO admin | “SEO Settings” | “SEO copy settings — public URL is configured by `BASE_URL` / site config.” |

## Proof points to add

- “Original uploads are stored in a private data volume; public derivatives are served from `public/uploads/`” — supported by README deployment copy (`README.md:169-171`).
- “Public queries omit GPS coordinates by default” — supported by `apps/web/src/lib/data.ts:154-181`.
- “No AI/cloud processing claims” — keep trust by avoiding hype not present in code.
- “Bilingual route support: English/Korean” — supported by `apps/web/src/lib/constants.ts:1-4` and message parity.

# AI Messaging Strategy

No active AI marketing claim was found in the reviewed README, UI messages, route metadata, or app copy. That is the right choice for this product today. Do **not** add “AI-powered gallery,” “AI search,” “AI captions,” or similar copy unless there is real code, opt-in behavior, data-flow disclosure, and failure-mode documentation.

If AI is added later, use trust-first language:

- “Optional local caption suggestions,” not “AI magic.”
- “You approve every generated caption before publishing.”
- “No image leaves your server unless you configure a remote model provider.”

# Business Model & Pricing Recommendation

No pricing, licensing gate, hosted upsell, or paid feature surface was found in the inspected app. The repo presents as an open-source/self-hosted project. The business model should match that reality.

Recommended paths:

1. **Open-source trust path:** Apache-licensed self-hosted core, paid hosted setup/support/templates later.
2. **Managed hosting path:** Free self-hosted, paid hosted GalleryKit Cloud with backups/CDN/domain setup.
3. **Professional services path:** Custom deployment and portfolio customization for photographers/studios.

Avoid a paid-product launch until onboarding and trust gaps PM-02, PM-05, PM-06, and PM-08 are fixed.

# Distribution & Growth Plan

## Launch strategy

- Launch first to self-hosting/developer-photographer communities, not non-technical photographers.
- Lead with a working demo, a 10-minute setup video, and “best for / not for.”
- Publish a transparent architecture post: private originals, public derivatives, EXIF/GPS behavior, sitemap/SEO, bilingual routing.

## Content plan

1. “Build your own bilingual photo portfolio with GalleryKit” — setup walkthrough.
2. “How GalleryKit handles originals, derivatives, and EXIF privacy” — trust post.
3. “GalleryKit vs Immich/PhotoPrism/static galleries: what it is and is not” — positioning post.
4. “Deploying GalleryKit behind nginx with MySQL” — ops guide tied to current Docker caveats.

## Community playbook

- Be explicit that GalleryKit is not a mobile backup app or full DAM.
- Share technical details and accept criticism in GitHub/self-hosting communities.
- Ask early users to publish their GalleryKit sites as examples; the product is visual, so real galleries are the best marketing.

# Competitive Positioning Map

Axes: **publishing polish** vs **library/DAM depth**.

| Product type | Publishing polish | Library/DAM depth | GalleryKit implication |
|---|---:|---:|---|
| Static gallery generators | Medium | Low | GalleryKit can win with admin UX + dynamic metadata. |
| Immich / PhotoPrism | Low-Medium public portfolio polish | High library/backup depth | Do not compete on backup/DAM; compete on public presentation. |
| SaaS portfolio tools | High | Medium | GalleryKit competes on self-hosting/privacy/control, not simplicity. |
| Piwigo/Lychee-style galleries | Medium | Medium | GalleryKit needs clearer modern/bilingual/privacy positioning. |
| GalleryKit | Medium today, potentially high | Low-Medium | Own “self-hosted creator portfolio/publishing kit.” |

# Trust-Building Roadmap

1. **Fix first-run docs** (PM-02) — highest conversion impact.
2. **Make photo licensing explicit** (PM-05) — highest legal/trust impact.
3. **Add privacy explainer** (PM-06) — high trust impact.
4. **Correct overclaims** (PM-03, PM-07, PM-13) — prevents disappointment.
5. **Expose/hide footer/admin/GitHub branding controls** (PM-11) — improves portfolio professionalism.
6. **Add setup validation** — reduces support burden.
7. **Publish demo galleries and screenshots** — proves visual value.
8. **Document “what GalleryKit is not”** — filters bad-fit users.

# Risk Matrix

| Risk | Probability | Impact | Evidence | Mitigation |
|---|---:|---:|---|---|
| First-run failure from docs order | High | High | `README.md:87-95`, `README.md:109-128`, `apps/web/README.md:7-14` | Reorder setup; add setup check. |
| Legal/trust issue from hardcoded CC BY-NC JSON-LD | Medium | High | `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:139-176` | Configurable/omitted license metadata. |
| Privacy misunderstanding around GPS | Medium | High | `README.md:34`, `apps/web/src/db/schema.ts:32-41`, `apps/web/src/lib/data.ts:154-181` | Privacy section and import warning. |
| Feature overclaim disappointment | High | Medium | PM-03, PM-07, PM-13 | Tighten copy to actual behavior. |
| SEO domain misconfiguration | Medium | Medium | `apps/web/src/lib/data.ts:883-890`, `apps/web/src/app/sitemap.ts:13` | Admin warning or editable public URL. |
| Product category confusion | High | Medium | README hero/features | Choose portfolio/publishing kit positioning. |
| White-label/professionalism friction | Medium | Medium | `apps/web/src/components/footer.tsx:37-48` | Configurable footer/admin link. |

# Market Readiness Checklist

## Must be true before a polished public launch

- [ ] Setup docs create/edit env before `npm run init`.
- [ ] README has a clear “Best for / Not for” section.
- [ ] Photo license JSON-LD is configurable or omitted by default.
- [ ] GPS/privacy behavior is documented in README and admin copy.
- [ ] Unsupported settings copy is removed or hidden.
- [ ] “Batch editing” and “full metadata search” claims are corrected or implemented.
- [ ] SEO settings clarify/can edit the canonical public URL.
- [ ] Bilingual OG locale maps to route locale.
- [ ] Footer GitHub/Admin links are configurable for production portfolios.
- [ ] At least one demo gallery and setup screenshot/video exist.

# Prioritized Recommendations

## Tier 0 — Blocking for trust

1. PM-02: Fix first-run setup order.
2. PM-05: Remove/configure hardcoded CC BY-NC license metadata.
3. PM-06: Document GPS storage/public omission/source-file behavior.

## Tier 1 — High-impact conversion and message fixes

4. PM-01: Rewrite hero and defaults around the real portfolio/publishing wedge.
5. PM-03/PM-04: Remove unsupported concurrency/storage/gallery/upload-limit copy.
6. PM-07/PM-13: Correct “batch editing” and “full metadata search.”
7. PM-08: Clarify/admin-control public URL for SEO.

## Tier 2 — Product polish/growth enablers

8. PM-09: Route-aware OG locale.
9. PM-10: Localize EXIF enum values.
10. PM-11: Configurable footer/Admin/GitHub links.
11. PM-12: Standardize categories/albums/topics naming.
12. PM-14: Make latest-photo OG default explicit/opt-in.

## Tier 3 — Longer-term moat

13. Hosted/managed deployment option.
14. Demo-gallery showcase and community examples.
15. Setup doctor and production-readiness checks.
16. Optional CDN/storage backend only after end-to-end pipeline integration.

# Final Sweep

Final sweep actions performed:

- Loaded and applied the `product-marketer-reviewer` role prompt from `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`.
- Used repository inventory plus targeted inspection of docs, messages, route metadata, admin UI, processing/data/storage code, actions, and tests listed above.
- Ran a message parity check: English and Korean flattened message files both contained 500 keys; no missing keys in either direction. Empty namespaces observed: `users.actions`, `imageManager.actions`.
- Ran a final grep sweep for stale/high-risk terms and claim anchors: `single-command`, `batch editing`, `GPS`, `MinIO`, `S3`, `processing concurrency`, `Creative Commons`, `creativecommons`, `license`, `OG Locale`, `latest photo`, `full metadata`, `Topics & Albums`, `BASE_URL`, `AI`, `GalleryKit`, `self-hosted`, `Docker Support`, `Storage Backend`.
- The sweep found no active “single-command Docker” claim and no active AI marketing claim. It did find the exact claim anchors reported above.

Skipped files: none intentionally skipped among relevant product-marketing surfaces. Pure low-level implementation files not affecting docs/UI/copy/metadata/onboarding were not treated as marketing surfaces unless needed to verify a claim.

# Final Verdict

**Launch recommendation:** wait for a polished public/product launch; acceptable for a developer-facing open-source preview after Tier 0 fixes.
**Score:** 5.8/10 developer/open-source readiness; 4.5/10 polished self-hosted product readiness.

The first 100 users should be technical photographers, self-hosting enthusiasts, and bilingual creator-site owners who can tolerate MySQL/Next.js deployment and value control. Reach them with a precise promise: fast self-hosted public photo portfolios, private originals, bilingual routes, share links, and admin publishing. Do not market GalleryKit as a DAM, backup app, AI product, or general “full metadata” gallery until those claims are engineered and documented.

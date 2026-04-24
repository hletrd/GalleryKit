# Product Marketer Reviewer — PROMPT 1 Cycle 4/100

Repo: `/Users/hletrd/flash-shared/gallery`
Lane: `product-marketer-reviewer`
Review date: 2026-04-25 (Asia/Seoul)

## Inventory reviewed

- Product docs/onboarding: `README.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/init-db.ts`, Docker/deploy docs/config.
- Public UI copy and flows: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, public routes under `apps/web/src/app/[locale]/(public)/**`, `Nav`, `Footer`, `HomeClient`, `Search`, `PhotoViewer`, `InfoBottomSheet`.
- Admin onboarding/copy: login, dashboard, upload, image manager, categories, tags, users, DB, SEO, and settings surfaces under `apps/web/src/app/[locale]/admin/**` plus shared admin components.
- SEO/social preview flows: localized root metadata, homepage/topic/photo/share metadata, JSON-LD, `/api/og`, `robots.ts`, `sitemap.ts`, `manifest.ts`, `seo-og-url.ts`, SEO admin actions and validations.
- Prior carry-forward check: the earlier quick-start ordering issue recorded in this file is no longer reproducible in the current README/app README; env/site-config setup now precedes `npm run init`.

## Findings summary

| ID | Severity | Confidence | Status | Finding |
| --- | --- | --- | --- | --- |
| PMR4-01 | HIGH | High | Confirmed/open | Public photo JSON-LD advertises every image as CC BY-NC licensed without a product setting or documentation. |
| PMR4-02 | MEDIUM | High | Confirmed/open | SEO UI says individual photo pages use the photo itself, but a global OG image overrides photo and share previews. |
| PMR4-03 | MEDIUM | High | Confirmed/open | Topic OG image generator ignores SEO admin branding and still renders `site-config.json` title. |
| PMR4-04 | MEDIUM | Medium | Confirmed/open | Robots.txt disallows share routes even though share pages emit OG/Twitter preview metadata. |
| PMR4-05 | LOW | High | Confirmed/open | OG image URL help copy invites a generic “Full URL” while server validation only accepts relative or same-origin URLs. |
| PMR4-06 | LOW | High | Confirmed/open | Settings page promises “processing concurrency,” but the visible form and setting schema expose no concurrency control. |

## Detailed findings

### PMR4-01 — Public photo JSON-LD advertises every image as CC BY-NC licensed without a product setting or documentation

- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed/open
- **Exact file:line/code region:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:137-150`; `apps/web/src/site-config.example.json:4-7`; `README.md:41-58`.
- **Evidence:** The photo page emits `ImageObject` JSON-LD for every public photo and hard-codes `license: 'https://creativecommons.org/licenses/by-nc/4.0/'` plus `acquireLicensePage: siteConfig.parent_url` and author/copyright fields from `seo.author`. The example config and README document `parent_url` as a generic parent site field, not a license/acquisition page, and there is no admin-facing license setting.
- **Concrete failure scenario:** A photographer self-hosts GalleryKit for private portfolio work or client-owned images. Search engines/scrapers read the structured data and treat every public photo as Creative Commons BY-NC with the configured parent URL as the licensing page, creating a legal/trust mismatch and encouraging reuse under terms the owner never selected.
- **Suggested fix:** Do not emit `license` or `acquireLicensePage` by default. Add explicit configurable fields such as `license_url`, `license_name`, `license_page_url`, and creator type/name, document them in README/admin SEO copy, and only render licensing JSON-LD when the owner has opted in.

### PMR4-02 — SEO UI says individual photo pages use the photo itself, but a global OG image overrides photo and share previews

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed/open
- **Exact file:line/code region:** `apps/web/messages/en.json:320-324`; `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:73-105`; `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:52-83`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:46-81`.
- **Evidence:** Admin SEO copy says the custom Open Graph image is for social previews and that “Individual photo pages use the photo itself.” The photo page, shared-photo page, and shared-group page all branch on `seo.og_image_url` and use that global image instead of the actual photo/cover image when configured.
- **Concrete failure scenario:** An admin sets a branded default OG image expecting only site/topic fallback previews to change. Links to a specific photo or private share now unfurl with the generic brand image rather than the selected photo, making the share look unrelated and reducing recipient trust/click-through.
- **Suggested fix:** Align behavior and copy. Prefer the actual photo/cover image on `/p`, `/s`, and `/g` regardless of global fallback, or rename the setting/copy to make clear that it overrides all public/share preview images. If both use cases matter, split into `default_og_image_url` and `force_global_og_image`.

### PMR4-03 — Topic OG image generator ignores SEO admin branding and still renders `site-config.json` title

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed/open
- **Exact file:line/code region:** `apps/web/messages/en.json:304-308`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:95-104`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:55-88`; `apps/web/src/app/api/og/route.tsx:1-4,24-30,70-84`.
- **Evidence:** SEO admin copy says the Site Title is used in Open Graph. Topic metadata correctly sets `siteName` and social title from `seo.title`, but when no custom OG image is configured the topic route points social previews at `/api/og?topic=...`; that image route imports static `siteConfig` and renders `siteConfig.title` as the brand text.
- **Concrete failure scenario:** A site owner updates SEO title/nav title from “GalleryKit” to their studio name in the admin UI. Shared topic cards show the right text title in the HTML metadata but the generated image still says “GalleryKit,” making the product look unbranded or incorrectly configured.
- **Suggested fix:** Pass the resolved SEO title into `/api/og` as a sanitized query parameter, or move OG image generation to a server runtime that can read `getSeoSettings()`. Keep the rendered card brand aligned with the same source used by metadata.

### PMR4-04 — Robots.txt disallows share routes even though share pages emit OG/Twitter preview metadata

- **Severity:** MEDIUM
- **Confidence:** Medium
- **Status:** Confirmed/open
- **Exact file:line/code region:** `README.md:31-37`; `apps/web/src/app/robots.ts:4-18`; `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14-24,62-83`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:15-25,58-82`.
- **Evidence:** Product docs market per-photo and group sharing. Share pages include explicit robots metadata plus Open Graph/Twitter fields, but `robots.txt` disallows `/s/`, `/g/`, and localized equivalents globally.
- **Concrete failure scenario:** A user shares a generated `/en/s/...` or `/en/g/...` link in a social/chat product whose unfurler honors `robots.txt`. The crawler cannot fetch the page, so the recipient sees a bare URL or missing preview despite the app investing in share OG metadata.
- **Suggested fix:** Remove share routes from `robots.txt` and rely on page-level `noindex`, `nofollow`, `noarchive`, and `noimageindex` metadata to prevent search indexing while still allowing unfurlers to fetch previews. If stricter privacy is required, document that share previews are intentionally disabled and remove/limit share OG metadata.

### PMR4-05 — OG image URL help copy invites a generic “Full URL” while server validation only accepts relative or same-origin URLs

- **Severity:** LOW
- **Confidence:** High
- **Status:** Confirmed/open
- **Exact file:line/code region:** `apps/web/messages/en.json:320-324`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:158-175`; `apps/web/src/app/actions/seo.ts:98-105`; `apps/web/src/lib/seo-og-url.ts:3-30`.
- **Evidence:** The field placeholder/hint says `https://example.com/og-image.jpg` and “Full URL to an image,” but the validator only accepts relative paths or URLs whose origin equals the configured site origin. Off-origin CDN or asset URLs fail with `seoOgImageUrlInvalid`.
- **Concrete failure scenario:** A marketer pastes a hosted `https://cdn.example.com/brand-card.jpg` URL from their CDN because the UI asked for a full URL. Save fails with a technical origin error, and the UI does not explain the same-origin policy up front.
- **Suggested fix:** Update help text and placeholder to say “relative path or same-origin URL” and give a realistic example such as `/uploads/jpeg/card.jpg` or `${BASE_URL}/og-image.jpg`. If external CDN OG images are a desired marketing workflow, extend validation/CSP/docs to support an allowlist.

### PMR4-06 — Settings page promises “processing concurrency,” but the visible form and setting schema expose no concurrency control

- **Severity:** LOW
- **Confidence:** High
- **Status:** Confirmed/open
- **Exact file:line/code region:** `apps/web/messages/en.json:523-532`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89-151`; `apps/web/src/lib/gallery-config-shared.ts:10-19,40-46`.
- **Evidence:** The visible Image Processing card description says admins can configure “image quality, output sizes, and processing concurrency,” and translations include `queueConcurrency` labels. The rendered settings form only exposes WebP/AVIF/JPEG quality and output sizes, and the shared settings key/default schema contains only quality, image sizes, and GPS stripping.
- **Concrete failure scenario:** A self-hosted user experiencing CPU pressure opens Settings looking for the advertised concurrency control, cannot find it, and assumes the admin panel is incomplete or broken.
- **Suggested fix:** Remove “processing concurrency” from the visible description until a real setting exists, or add a validated queue-concurrency setting wired through `gallery-config-shared`, `getGalleryConfig()`, the image queue, and the admin form.

## Reviewer notes

- No WRITE_BLOCKED: this file was written successfully.
- The review intentionally focused on product-facing communication and trust/SEO outcomes, not general implementation bugs already covered by code/security/performance lanes.

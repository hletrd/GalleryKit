# Product Marketing Review — GalleryKit (Cycle 1)

**Reviewer:** `product-marketer-reviewer` adaptation for GalleryKit
**Source reviewer profile:** `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`
**Date:** 2026-04-24
**Scope:** README/product positioning, onboarding, claims vs shipped behavior, SEO/social metadata, public UX copy, i18n messages, conversion/readability, docs-marketing consistency.
**Constraint:** This review intentionally changes only this file.

> Note: the discovered custom reviewer prompt is written for BurstPick, a macOS AI photo-culling product. This review applies that same product-marketing methodology—code-verified claims, skeptical-user positioning, trust-first messaging—to GalleryKit, which is a self-hosted web photo gallery rather than a paid desktop photography workflow app.

## Executive Summary

GalleryKit ships a credible privacy-conscious, self-hosted photo gallery foundation, but the public positioning is still a generic feature checklist and several onboarding/metadata claims outrun or underspecify shipped behavior. **Go-to-market readiness: 5.5/10 for a broad public launch, 7/10 for a developer/self-hoster beta.** The biggest marketing problem is not missing capability; it is that the README does not choose a specific buyer, use case, or wedge beyond “high-performance self-hosted photo gallery,” so evaluators comparing PhotoPrism, Piwigo, Immich, static galleries, and SaaS portfolio tools have no fast reason to believe GalleryKit is for them. Before a stronger launch, fix the onboarding path, de-risk overclaims, make SEO/social defaults safer, and make localization/white-label polish match the shipped bilingual promise.

---

## Inventory Reviewed First

### Required/custom reviewer context

- `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` — read fully; adapted BurstPick-specific questions to GalleryKit.
- `.context/project/01-overview.md`, `.context/project/02-architecture.md`, `.context/project/03-ui-architecture.md`, `.context/development/01-conventions.md` — expected by the custom prompt, but not present in this repo.
- Existing `.context/reviews/*.md` inventory — directory reviewed for context and to avoid overwriting existing review artifacts; this requested filename did not exist before this review.

### Product/docs/deployment inventory

Examined all relevant public and operational docs found in this repo, not a sample:

- `README.md`
- `apps/web/README.md`
- `CLAUDE.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/src/site-config.example.json`
- Local ignored `apps/web/src/site-config.json` was present and inspected only as local runtime context; it is not tracked and was not modified.

### SEO/social/public route inventory

- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/proxy.ts`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/locale-path.ts`

### Public UX/copy inventory

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
- `apps/web/src/components/optimistic-image.tsx`

### Admin/onboarding/copy inventory

- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/change-password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`

### i18n/behavior verification inventory

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/base56.ts`

### Verification sweeps performed

- Targeted claim/copy sweep across docs, messages, public routes, components, and libs for: AI, S3, MinIO, single-command, batch editing, GPS, license, Open Graph, SEO, GalleryKit, self-hosted, Docker Ready, Internationalization, Argon2, Base56, infinite scroll, admin, and download language.
- i18n key parity check: English and Korean each have **497 flattened keys**, with **no missing keys**. Empty strings are identical in both locales: `users.actions` and `imageManager.actions`.
- Final missed-issues sweep did not find additional active marketing surfaces beyond the inventory above.

---

## Claim Verification Snapshot

| Public/doc claim | Evidence | Status | Marketing implication |
|---|---|---:|---|
| High-performance self-hosted Next.js gallery | `README.md:7-9`, stack at `README.md:171-181` | Partially substantiated | Needs proof points: build/runtime benchmarks, demo metrics, or “fast image delivery via AVIF/WebP/JPEG derivatives” instead of vague “high-performance.” |
| Masonry grid + infinite scroll | `README.md:31`; home grid at `apps/web/src/components/home-client.tsx:123-148`; load-more intersection handling in `apps/web/src/components/load-more.tsx` | True | Good feature; translate to visitor outcome (“fast portfolio browsing”). |
| AVIF/WebP/JPEG optimization | `README.md:32`; processing pipeline at `apps/web/src/lib/process-image.ts:362-460` | True | Strong differentiator; should be a proof point in positioning. |
| EXIF extraction incl. GPS | `README.md:34`; GPS columns at `apps/web/src/db/schema.ts:32-41`; extraction at `apps/web/src/lib/process-image.ts:507-524` | Technically true, public behavior ambiguous | Needs privacy-qualified wording; public pages omit GPS. |
| Search across metadata/tags | `README.md:35`; public search action in `apps/web/src/app/actions/public.ts:43-107`; query surface in `apps/web/src/lib/data.ts:725-832` | True | Good user value; explain searchable fields in README/admin docs. |
| Sharing with Base56 links | `README.md:36`; photo share action at `apps/web/src/app/actions/sharing.ts:92-115`; Base56 generation at `apps/web/src/lib/base56.ts:1-31` | True | Good trust feature; mention unlisted/noindex behavior for shares. |
| Admin dashboard with batch editing | `README.md:37`; actual selected actions are batch tag/share/delete at `apps/web/src/components/image-manager.tsx:253-330`; title/description edit is single-photo at `apps/web/src/components/image-manager.tsx:474-493` | Overbroad | Reword or implement true batch metadata edits. |
| Multi-user auth / Argon2 | `README.md:37`; schema users at `apps/web/src/db/schema.ts:106-110`; auth uses Argon2 in `apps/web/src/app/actions/auth.ts` | True | Credible trust claim. |
| English and Korean i18n | `README.md:38`; locales in `apps/web/src/lib/constants.ts:1-4`; messages parity checked | Mostly true | Some EXIF values remain English in Korean UI. |
| Docker Ready / single-command deployment | `README.md:39`; Docker setup prerequisites at `README.md:155-164`; site-config fail-fast at `apps/web/scripts/ensure-site-config.mjs:4-8`; compose host-network and bind mount at `apps/web/docker-compose.yml:10-22` | Overpromises | Reword as “Docker-ready after configuration.” |

---

## Detailed Findings

### PM-01 — Generic positioning does not identify a beachhead user or reason to choose GalleryKit

**Severity:** High
**Confidence:** High

**Evidence**

- The README hero says only: “A high-performance, self-hosted photo gallery built with Next.js” (`README.md:7-9`).
- The first substantive marketing surface is a feature checklist rather than a target-user/outcome statement (`README.md:29-39`).
- Default site metadata repeats the generic category language: title “GalleryKit” and description “A self-hosted photo gallery” (`apps/web/src/site-config.example.json:2-10`).
- Public homepage copy defaults to “Latest” plus count metadata when no configured heading is provided (`apps/web/src/components/home-client.tsx:123-136`).

**Concrete user/business scenario**

A photographer, developer, or self-hoster comparing GalleryKit against PhotoPrism, Piwigo, Immich, Lychee, a static Astro gallery, or SaaS portfolio builders lands on the README. They can see the stack and features, but cannot tell whether GalleryKit is for a professional portfolio, a private family archive, a bilingual personal gallery, a client-proofing workflow, or a lightweight image CDN/gallery starter. Because there is no chosen wedge, the evaluator falls back to incumbents with clearer categories and larger communities.

**Fix**

Pick a narrow first position and rewrite the top of the README around that buyer. Example:

> “GalleryKit is a privacy-first, bilingual, self-hosted portfolio gallery for photographers and creators who want fast AVIF/WebP delivery, private originals, and admin-managed publishing without SaaS lock-in.”

Add immediately below it:

- **Best for:** personal/professional photo portfolios, bilingual galleries, self-hosters who want private originals and optimized derivatives.
- **Not for:** full DAM/catalog replacement, face recognition, mobile camera backup, client proofing/payment workflows.
- **Proof:** AVIF/WebP/JPEG derivative generation, public privacy field selection, unlisted/noindex share pages, live demo, screenshots.

---

### PM-02 — First-run onboarding skips database initialization and admin bootstrap, creating a high-risk drop-off

**Severity:** High
**Confidence:** High

**Evidence**

- Root installation ends after `git clone`, `cd`, and `npm install` (`README.md:87-93`).
- Environment setup tells the user to create `apps/web/.env.local` and edit MySQL/admin/public URL settings (`README.md:107-128`), then jumps to `npm run dev` (`README.md:141-147`).
- The app README lists the missing commands—`db:push`, `db:seed`, and `init` (`apps/web/README.md:16-23`)—but root onboarding does not put them in the main path.
- Root scripts do not expose `init`; `package.json` only includes dev/build/start/lint/typecheck/test/deploy at the workspace root, while `apps/web/package.json` defines `init`, `db:push`, and `db:seed` for the web app.

**Concrete user/business scenario**

A self-hoster follows the root README, starts the dev server, then hits missing schema/admin-login failures because the database was never initialized or seeded. That person is not yet emotionally invested; a broken first 10 minutes becomes a GitHub issue, a bounce, or an “interesting but not ready” mental label.

**Fix**

Make the root README’s “Getting Started” a complete happy path:

1. Install dependencies.
2. Create MySQL database/user.
3. Copy and edit `.env.local`.
4. Copy/create `apps/web/src/site-config.json` from the example.
5. Run `npm run init --workspace=apps/web` or add a root `init` script and document `npm run init`.
6. Start `npm run dev`.
7. Log in at `/en/admin` with the seeded admin credential and upload first photos.

Include a “You are done when…” checkpoint: public homepage loads, admin login works, and first upload appears after processing.

---

### PM-03 — “Docker Ready — single-command deployment” overpromises relative to required configuration

**Severity:** High
**Confidence:** High

**Evidence**

- Feature claim: “Docker Ready — standalone output, single-command deployment” (`README.md:39`).
- Docker deployment actually requires configuring env, being on Linux or adapting networking, providing a real site config, and then running compose (`README.md:155-164`).
- Production/deploy builds fail fast if `apps/web/src/site-config.json` is missing (`README.md:157-160`; script path and fail-fast behavior in `apps/web/scripts/ensure-site-config.mjs:4-8`).
- The checked-in compose file assumes host networking and a host-side `src/site-config.json` bind mount (`apps/web/README.md:31-32`; `apps/web/docker-compose.yml:10-22`).

**Concrete user/business scenario**

A buyer/evaluator reads “single-command deployment,” tries `docker compose up -d --build`, and fails because site config or host-network assumptions are not in place. Even if the failure is correct and secure, the marketing claim taught them to expect a lower-friction path than the product provides.

**Fix**

Reword the feature to:

> “Docker-ready production build after explicit env, site-config, MySQL, and reverse-proxy setup.”

Then add two paths:

- **Local evaluation:** a minimal Docker/dev path with clear prerequisites and expected localhost result.
- **Production:** Linux host-network + reverse proxy + MySQL + persistent volumes + site-config bind mount.

Only use “single-command” if a checked-in command truly creates a working demo stack from examples without hidden prerequisites.

---

### PM-04 — “Batch editing” claim exceeds the shipped admin edit surface

**Severity:** Medium-High
**Confidence:** High

**Evidence**

- README claims the admin dashboard includes “drag-and-drop uploads, batch editing, multi-user auth (Argon2)” (`README.md:37`).
- The selected-images toolbar supports batch add tag, group share, and bulk delete (`apps/web/src/components/image-manager.tsx:253-330`).
- Title and description editing are a single-image dialog, not batch metadata editing (`apps/web/src/components/image-manager.tsx:474-493`).

**Concrete user/business scenario**

A gallery owner uploads 300 event photos and expects to batch edit titles/descriptions/topics or apply broad metadata changes because the README said “batch editing.” They discover only batch tag/delete/share. The feature is still useful, but the copy created the wrong expectation.

**Fix**

Either implement true batch metadata editing, or narrow the claim to the shipped behavior:

> “Admin dashboard with drag-and-drop uploads, batch tagging, bulk delete, share-link creation, and per-photo title/description edits.”

This is still strong, and it is trust-preserving.

---

### PM-05 — GPS/location messaging is technically true but privacy-ambiguous

**Severity:** Medium-High
**Confidence:** High

**Evidence**

- README says EXIF extraction includes “GPS” (`README.md:34`).
- The database stores latitude and longitude (`apps/web/src/db/schema.ts:32-41`).
- EXIF extraction reads GPS coordinates into the DB payload (`apps/web/src/lib/process-image.ts:507-524`).
- Public field selection intentionally omits latitude and longitude (`apps/web/src/lib/data.ts:154-181`).
- The public photo viewer’s GPS block is explicitly documented as currently unreachable because public `selectFields` excludes latitude/longitude (`apps/web/src/components/photo-viewer.tsx:503-509`).
- The admin privacy setting says “Do Not Store GPS Coordinates on Upload,” and the hint clarifies existing images/source EXIF are not rewritten (`apps/web/messages/en.json:535-538`; `apps/web/messages/ko.json:535-538`).

**Concrete user/business scenario**

Two different users can be misled in opposite directions. A privacy-sensitive self-hoster may not realize precise GPS can be stored by default unless the admin setting is enabled. A photographer who wants location display may expect public map/location support from the README’s “GPS” claim, but public pages intentionally omit it.

**Fix**

Rewrite public/docs messaging as:

> “EXIF extraction for camera/lens/exposure metadata. GPS can be stored for private admin metadata, but is never exposed on public photo pages; enable ‘Do Not Store GPS Coordinates’ to avoid persisting new upload coordinates.”

If location display is a product feature, add an admin-only location view backed by an authenticated accessor. If it is privacy-only metadata, avoid marketing it as a visible gallery feature.

---

### PM-06 — Localized Open Graph metadata uses one configured locale for all localized routes

**Severity:** Medium
**Confidence:** High

**Evidence**

- `generateMetadata()` does not receive route params or inspect the active locale (`apps/web/src/app/[locale]/layout.tsx:15-24`).
- It sets `openGraph.locale` from the single configured SEO value (`apps/web/src/app/[locale]/layout.tsx:32-38`).
- The default config locale is `en_US` (`apps/web/src/site-config.example.json:6`).
- The app has explicit `en` and `ko` locales (`apps/web/src/lib/constants.ts:1-4`) and always-prefixed locale routing in middleware (`apps/web/src/proxy.ts:5-10`).
- The admin SEO UI asks for a single “OG Locale” value (`apps/web/messages/en.json:316-317`; `apps/web/messages/ko.json:316-317`).

**Concrete user/business scenario**

A Korean visitor shares `/ko/...` to KakaoTalk, Slack, Discord, or social platforms. The page content is Korean, but the OG locale can still advertise `en_US`, weakening crawler/social-preview consistency and making the bilingual promise look less polished.

**Fix**

Make metadata locale-aware:

- Accept `params` in `[locale]/layout.tsx` metadata generation.
- Map `en -> en_US`, `ko -> ko_KR` for `openGraph.locale`.
- Set `alternateLocale` to only the other locale(s).
- Keep the admin-configured locale as a fallback only for unknown/custom deployments, or replace the single field with per-locale metadata settings.

---

### PM-07 — Public footer hardcodes project/admin links, reducing white-label and professional portfolio polish

**Severity:** Medium
**Confidence:** High

**Evidence**

- The footer text itself is configurable (`apps/web/src/components/footer.tsx:31-35`).
- The footer still hardcodes a GitHub link to `https://github.com/hletrd/gallerykit` (`apps/web/src/components/footer.tsx:37-45`).
- The footer also shows a visible “Admin” link on every public page (`apps/web/src/components/footer.tsx:46-48`).

**Concrete user/business scenario**

A photographer uses GalleryKit as a client-facing portfolio. The public footer advertises the software repo and an admin entrypoint instead of the photographer’s brand, contact page, licensing page, or social links. This makes the site feel like a template/demo rather than a polished owned gallery.

**Fix**

Add site-config/admin settings for footer behavior:

- `show_powered_by` / `powered_by_url`
- `footer_links[]`
- `show_admin_link` defaulting to false for production/public deployments

If “Powered by GalleryKit” is a growth loop, make it opt-in or a clear default that can be disabled without editing source.

---

### PM-08 — Korean localization is structurally complete, but EXIF values remain English strings

**Severity:** Medium
**Confidence:** High

**Evidence**

- English/Korean message files have full key parity: 497 flattened keys each, no missing locale keys.
- EXIF display labels are localized in messages (`apps/web/messages/en.json:217-260`; `apps/web/messages/ko.json:217-260`).
- But EXIF values are stored as English display strings such as `Auto`, `Manual`, `Center-weighted`, `Program AE`, `Forced On`, and `Not Fired` (`apps/web/src/lib/process-image.ts:538-583`).
- Those strings are rendered directly in the public viewer and bottom sheet (`apps/web/src/components/photo-viewer.tsx:467-500`; `apps/web/src/components/info-bottom-sheet.tsx:316-350`).

**Concrete user/business scenario**

A Korean visitor sees Korean labels with English technical values in the same metadata panel. The app still works, but the bilingual positioning feels incomplete at exactly the moment a viewer is inspecting the photography details.

**Fix**

Store canonical EXIF enum keys or raw numeric codes, then translate at render time:

- `whiteBalance.auto`, `whiteBalance.manual`
- `meteringMode.centerWeighted`, etc.
- `exposureProgram.aperturePriority`, etc.
- `flash.forcedOff`, etc.

For existing rows, either migrate known display strings to enum keys or translate legacy strings through a compatibility map.

---

### PM-09 — Dormant S3/MinIO storage copy conflicts with the shipped local-only storage reality

**Severity:** Low-Medium
**Confidence:** High

**Evidence**

- Settings messages include “Storage Backend,” “MinIO,” “Amazon S3,” and S3/MinIO environment guidance (`apps/web/messages/en.json:545-552`; `apps/web/messages/ko.json:545-552`).
- The actual settings UI renders image processing and privacy cards only (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89-178`).
- The storage module explicitly says the live production upload/processing/serving paths still use direct filesystem code, are not wired into this module, and currently support local filesystem only (`apps/web/src/lib/storage/index.ts:4-12`).
- Internal docs warn not to document or expose S3/MinIO switching as supported until the pipeline is wired end-to-end (`CLAUDE.md:99`).

**Concrete user/business scenario**

A translator, contributor, or admin UI implementer sees S3/MinIO message strings and assumes cloud/object storage support exists. That can create docs, screenshots, or issue responses that promise a backend the product does not actually support.

**Fix**

Remove inactive storage-backend i18n strings until the feature ships, or gate them under explicit future/development comments outside production message files. If S3/MinIO is on the roadmap, create a public roadmap note that says “planned, not supported yet” rather than letting product strings imply hidden support.

---

### PM-10 — Photo JSON-LD hardcodes a Creative Commons license that admins cannot configure

**Severity:** Medium
**Confidence:** Medium-High

**Evidence**

- Photo pages emit `ImageObject` JSON-LD (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:139-176`).
- The JSON-LD hardcodes `license: 'https://creativecommons.org/licenses/by-nc/4.0/'` (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:145`).
- It also sets `acquireLicensePage` from `siteConfig.parent_url` and creator/copyright fields from the SEO author (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:146-152`).
- The README/site config/admin SEO UI documents title, description, locale, author, and OG image, but no license setting (`README.md:41-58`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:120-175`).

**Concrete user/business scenario**

A photographer publishes proprietary portfolio work or client images. Search engines and license-aware consumers may see CC BY-NC structured data even though the owner never opted into that license. That is a trust/legal/business risk, not just an SEO detail.

**Fix**

Make license metadata configurable or omit it by default:

- Add `license_url`, `license_label`, and `acquire_license_page` settings.
- Default to no `license` field unless configured.
- Document the default clearly in README/admin SEO copy.

---

### PM-11 — Homepage social preview can silently use the latest uploaded photo as the site-wide OG image

**Severity:** Low-Medium
**Confidence:** Medium-High

**Evidence**

- If no custom OG image is configured, homepage metadata fetches the latest image and uses its JPEG derivative as the Open Graph image (`apps/web/src/app/[locale]/(public)/page.tsx:64-83`).
- Admin SEO copy explicitly instructs: “Leave empty to use the latest photo” (`apps/web/messages/en.json:318-322`; Korean equivalent at `apps/web/messages/ko.json:318-322`).
- If a custom OG image is configured, that image is used instead (`apps/web/src/app/[locale]/(public)/page.tsx:44-61`).

**Concrete user/business scenario**

A gallery owner uploads a personal, unrepresentative, or low-context image. The next share of the homepage uses that image as the brand card, creating a surprising preview and potentially undermining conversion or privacy expectations.

**Fix**

Prefer a generated branded OG image as the default and make “latest photo” an explicit opt-in. Rewrite the hint:

> “Recommended: set a 1200×630 brand/cover image. If left empty, GalleryKit can fall back to the latest public photo, which may change after uploads.”

---

## Product-Market Fit Assessment

### Problem clarity

GalleryKit solves a real problem: a creator/self-hoster wants a fast, bilingual, public photo gallery with private originals, optimized public derivatives, admin uploads, tags/topics/search, and share links. The product is not positioned sharply enough to say which version of that problem it solves best.

### Target user definition

Recommended first customer:

> A technically comfortable photographer/creator who wants a self-hosted, bilingual public portfolio/gallery, values privacy of originals and metadata, and is willing to manage MySQL/Docker/Next.js infrastructure for control and ownership.

Secondary users:

- Developers building a portfolio/photo gallery for themselves or a client.
- Korean/English bilingual creators who want locale-prefixed galleries.
- Privacy-conscious self-hosters who do not need a full DAM or mobile sync product.

Not ideal first users:

- Non-technical photographers expecting SaaS onboarding.
- Families wanting automatic phone backup and face recognition.
- Studio/client-proofing businesses needing payments, selections, comments, contracts, or client accounts.
- Users expecting object storage/cloud backend support today.

### Wedge identification

Current defensible wedge if messaged truthfully:

> “A self-hosted photo portfolio/gallery starter that keeps originals private, publishes optimized AVIF/WebP/JPEG derivatives, supports English/Korean localization, and gives admins enough CMS controls for topics, tags, SEO, users, and unlisted sharing.”

This is more defensible than “photo gallery” because it combines privacy, performance derivatives, bilingual routing, and admin workflow. It is not yet defensible as “single-command Docker gallery,” “full DAM,” or “cloud-storage-ready portfolio system.”

### Switching/adoption cost

- For a developer/self-hoster: moderate. Requires Node 24, MySQL, env setup, site config, and deployment knowledge.
- For a photographer without ops experience: high. Needs either hosted offering, turnkey compose, or much clearer first-run docs.
- For a current static gallery user: moderate/high, but GalleryKit can win with admin uploads, search/tags, and automatic derivatives.
- For a PhotoPrism/Immich/Piwigo user: unclear unless GalleryKit chooses a lighter, portfolio-first position instead of competing as a full library manager.

### Differentiation durability

- AVIF/WebP/JPEG derivatives are valuable but copyable.
- Bilingual English/Korean support is useful but not a moat.
- Privacy-conscious public field selection/private originals is strong trust positioning.
- The strongest durable angle is developer-friendly ownership plus polished public portfolio UX, not raw feature breadth.

---

## Positioning Audit & Recommendation

### Current positioning

Current public sentence:

> “A high-performance, self-hosted photo gallery built with Next.js” (`README.md:7-9`).

This is a description, not a position. It says category and stack, but not why this gallery exists, whom it serves, or why it is better for a specific job.

### Recommended positioning

Primary position:

> **GalleryKit is a privacy-first, bilingual, self-hosted photo portfolio for creators who want fast public galleries without giving a SaaS their originals or metadata.**

Supporting pillars:

1. **Publish fast galleries, keep originals private.** Processed AVIF/WebP/JPEG derivatives are public; originals live in private storage.
2. **Admin-managed, not rebuild-managed.** Upload, tag, organize topics, edit SEO, manage users, and create share links from the admin UI.
3. **Built for bilingual galleries.** English/Korean routes, messages, sitemap alternates, and localized public UX.
4. **Honest self-hosting.** MySQL, Docker/Next.js, explicit reverse-proxy/env setup; no pretend SaaS simplicity.

### One sentence a user tells another user

> “GalleryKit is a self-hosted portfolio gallery that publishes optimized public photos while keeping originals and sensitive metadata under your control.”

---

## Messaging Architecture

### Before/after copy rewrites

| Surface | Current | Issue | Recommended |
|---|---|---|---|
| README hero | “A high-performance, self-hosted photo gallery built with Next.js” (`README.md:7-9`) | Generic and stack-first | “A privacy-first, bilingual, self-hosted photo portfolio with fast AVIF/WebP delivery and private originals.” |
| Docker feature | “Docker Ready — standalone output, single-command deployment” (`README.md:39`) | Overpromises setup friction | “Docker-ready production build with explicit MySQL, site-config, and reverse-proxy setup.” |
| Admin feature | “batch editing” (`README.md:37`) | Overbroad | “Batch tagging, bulk delete/share, and per-photo title/description edits.” |
| EXIF feature | “EXIF... GPS” (`README.md:34`) | Privacy ambiguity | “EXIF camera/lens/exposure metadata, with GPS stored privately only when enabled and never exposed publicly by default.” |
| Site default description | “A self-hosted photo gallery” (`apps/web/src/site-config.example.json:3`) | Category-only | “A fast, self-hosted photo gallery with private originals and optimized public images.” |

### Suggested README hero block

```md
<p align="center">
  A privacy-first, bilingual, self-hosted photo portfolio with fast AVIF/WebP delivery and private originals.
</p>

GalleryKit is for creators and self-hosters who want an owned photo site: upload from an admin dashboard, organize by topics and tags, publish optimized public derivatives, keep originals private, and share selected photos through unlisted links.

**Best for:** personal/professional portfolios, bilingual galleries, lightweight self-hosted publishing.
**Not for:** full DAM/catalog management, phone backup, face recognition, client proofing/payments, or object-storage backends yet.
```

### Proof points to surface earlier

- Private original upload storage and public derivative serving (`README.md:166-168`).
- Public field selection intentionally excludes sensitive fields (`apps/web/src/lib/data.ts:154-181`).
- AVIF/WebP/JPEG derivative pipeline (`apps/web/src/lib/process-image.ts:362-460`).
- Share pages are noindex/nofollow (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14-24`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:15-25`).
- Admin SEO/settings/users/database surfaces exist and are localized.

### Risk-mitigation copy to add

- “Originals are not served from public upload URLs in current production paths.”
- “GPS is not exposed on public pages; optional setting can prevent storing new upload GPS coordinates.”
- “S3/MinIO/object storage is not supported yet.”
- “Docker deployment assumes MySQL and a reverse proxy you control.”

---

## “AI” Messaging Strategy

GalleryKit currently has **no active AI product claim** in README or public UX copy. That is good: do not add AI language unless the product ships meaningful AI behavior.

Recommendations:

- Avoid “AI gallery,” “smart gallery,” or “intelligent curation” unless source code backs those claims.
- If future AI features land, market them as assistive and optional, with clear privacy constraints: on-device/server-side, no third-party upload, what data is processed, and failure modes.
- Do not borrow the BurstPick prompt’s AI-culling language for GalleryKit; it would misposition the product.

---

## Business Model & Pricing Recommendation

No pricing model is present in the repo. Current signals are open-source/self-hosted: Apache 2.0 license in `README.md:183-185`, GitHub-first links, and no billing/licensing code found in the reviewed app surfaces.

### Recommended model options

| Model | Fit | Pros | Risks |
|---|---:|---|---|
| Pure open source | Good now | Trust, contributor adoption, self-hoster friendliness | No obvious sustainability story |
| Open-core self-hosted + paid hosted | Strong if growth goal exists | Keeps trust while serving non-technical photographers | Requires ops/support/sales surface |
| Paid hosted only | Weak initially | Easier onboarding for photographers | Undercuts self-hosted differentiation |
| Paid plugins/themes/support | Moderate | Monetizes professional installs | Smaller market, support burden |
| Sponsorship/donations | Moderate | Low friction | Unpredictable revenue |

### Recommendation

For the current product, position as open-source/self-hosted with an honest sustainability statement:

- Free self-hosted core under Apache 2.0.
- Optional paid hosted/support later for users who want GalleryKit without operating MySQL/Docker.
- Optional premium themes/client features only after core positioning is stable.

Do not introduce pricing before the onboarding and claims issues above are fixed; charging money amplifies trust gaps.

---

## Distribution & Growth Plan

### Launch sequence

1. **Private beta with self-hosters/developer-photographers**
   - Goal: validate install docs and admin workflow.
   - Channels: GitHub, self-hosted Discords, Korean developer/photography communities, small personal blogs.

2. **Public developer launch**
   - Prepare README with screenshots/GIFs, demo credentials or demo video, clear “best for/not for.”
   - Channels: Hacker News “Show HN,” r/selfhosted, r/NextJS, GitHub topics, personal technical blog.

3. **Creator/photographer launch**
   - Only after docs are turnkey enough for non-developers or a hosted path exists.
   - Channels: photography YouTube/blog outreach, portfolio-builder comparison posts, bilingual creator communities.

### Content plan

- “How GalleryKit keeps originals private while serving fast public derivatives” — trust/technical blog.
- “Self-hosting a bilingual photo portfolio with Next.js and MySQL” — developer acquisition.
- “GalleryKit vs static gallery vs PhotoPrism vs Piwigo: when to choose a portfolio-first gallery” — positioning content.
- 3-minute first-upload demo from blank repo to public gallery.
- SEO/social preview guide for photographers.

### Community playbook

- Lead with transparent limitations, not hype.
- Answer self-hosting questions with exact deployment assumptions.
- Avoid posting as “best gallery”; post as “I built a privacy-first portfolio gallery; looking for install feedback.”
- Convert recurring questions into docs quickly.

### Reviewer outreach

Start with self-hosted/developer reviewers before photography influencers. The current product has operational setup complexity; mainstream photography reviewers will judge first-run UX harshly unless there is a hosted demo or turnkey installer.

---

## Competitive Positioning Map

Axes:

- **X-axis:** Portfolio publishing focus ←→ Full library/DAM/mobile-sync focus
- **Y-axis:** Self-hosted ownership/control ←→ Managed SaaS convenience

Approximate placement:

```text
High ownership/control
^
|                 PhotoPrism / Immich
|                 (broader library/archive)
|
|        GalleryKit
|        (portfolio-first, private originals,
|         optimized derivatives, bilingual)
|
|   Static galleries
|   (simple, rebuild-managed)
|
+------------------------------------------------> Full library/DAM focus
     Portfolio publishing focus

Low ownership/control / more SaaS convenience:
Adobe Portfolio, SmugMug, Pixieset, Squarespace
```

GalleryKit’s best position is not “more features than Immich/PhotoPrism.” It is “lighter, cleaner, portfolio-first publishing for people who still want ownership.”

---

## Trust-Building Roadmap

### Quick wins

1. Add screenshots and a first-upload walkthrough to README.
2. Add “best for/not for” and “current limitations” sections.
3. Reword Docker/batch/GPS claims to match shipped behavior.
4. Add privacy architecture notes: private originals, public derivatives, GPS omission.
5. Make license metadata configurable or remove hardcoded license JSON-LD.

### Medium effort

1. Locale-aware OG metadata.
2. Configurable footer/admin link/powered-by behavior.
3. EXIF enum localization.
4. Generated branded OG fallback instead of latest-photo default.
5. Root `npm run init` script and a complete quickstart.

### Long-term trust investments

1. Public roadmap that distinguishes shipped/planned features.
2. Hosted demo with sample gallery and admin-flow video.
3. Migration/import docs from static folders or other galleries.
4. Optional managed hosting/support plan if targeting non-technical photographers.

---

## Risk Matrix

| Risk | Probability | Impact | Evidence/trigger | Mitigation |
|---|---:|---:|---|---|
| Generic positioning loses evaluators | High | High | README hero and defaults are category-only (`README.md:7-9`; `apps/web/src/site-config.example.json:2-10`) | Choose portfolio/privacy/bilingual wedge. |
| First-run setup failure | High | High | Root quickstart omits DB init/admin seed (`README.md:87-147`; `apps/web/README.md:16-23`) | Complete bootstrap path and root `init` script. |
| Trust loss from overclaims | Medium | High | “single-command deployment,” “batch editing,” ambiguous GPS (`README.md:34,37,39`) | Reword or implement. |
| SEO/legal rights mismatch | Medium | High | Hardcoded CC BY-NC license (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:145`) | Configurable/omitted license metadata. |
| Localization polish gap | Medium | Medium | English EXIF enum values in Korean UI (`apps/web/src/lib/process-image.ts:538-583`) | Translate enum values at render time. |
| White-label/professional polish gap | Medium | Medium | Public hardcoded GitHub/Admin footer links (`apps/web/src/components/footer.tsx:37-48`) | Configurable footer links. |
| Planned feature leakage | Medium | Medium | S3/MinIO messages despite local-only implementation (`apps/web/messages/en.json:545-552`; `apps/web/src/lib/storage/index.ts:4-12`) | Remove dormant strings or ship end-to-end support. |
| Competing against full DAMs | High | Medium | Feature list can imply broad gallery/DAM category | Explicitly position as portfolio-first, not full library manager. |

---

## Market Readiness Checklist

### Go criteria for developer/self-hoster beta

- [x] README has install prerequisites.
- [x] App has admin upload, tags/topics/search/share links.
- [x] English/Korean messages have no missing keys.
- [ ] Root quickstart includes DB init/admin seed/site-config creation.
- [ ] README claims match shipped behavior exactly.
- [ ] Docker docs no longer claim single-command deployment.
- [ ] Public privacy behavior is explained in one clear section.

### Go criteria for broader photographer/creator launch

- [ ] Positioning chooses portfolio/privacy/bilingual wedge.
- [ ] README has screenshots, demo walkthrough, and “best for/not for.”
- [ ] Footer/branding can be configured without source edits.
- [ ] License metadata is owner-configurable or omitted.
- [ ] OG locale and OG image fallback are safe and predictable.
- [ ] EXIF value localization is complete enough for Korean launch.
- [ ] Support path is explicit: GitHub Issues, Discussions, email, Discord, or hosted support.
- [ ] Deployment path is either turnkey enough for non-developers or clearly scoped to technical self-hosters.

---

## Prioritized Recommendations

### Tier 0 — Blocking before a broad public launch

1. Fix root onboarding so a new user can get to first admin login/upload without guessing DB init steps.
2. Reword overclaims: Docker “single-command,” admin “batch editing,” and unqualified GPS.
3. Remove or configure hardcoded CC BY-NC license JSON-LD.
4. Add explicit limitations: no object storage backend today, no full DAM/mobile backup/client proofing.

### Tier 1 — High impact conversion/readability fixes

1. Rewrite README hero and default site description around privacy-first self-hosted portfolio positioning.
2. Add screenshots/GIFs and a first-upload path.
3. Add “Best for / Not for” to reduce wrong-fit adoption.
4. Explain private originals/public derivatives and public metadata omission.
5. Make footer links configurable for professional portfolio polish.

### Tier 2 — Growth enablers

1. Publish technical trust content about image processing and metadata privacy.
2. Add comparison docs against static galleries, PhotoPrism/Immich, and SaaS portfolio sites.
3. Create a hosted demo/video for reviewers.
4. Add a support/community destination and response expectations.

### Tier 3 — Long-term moat

1. Provide migration/import tooling from folder structures/static galleries.
2. Offer optional managed hosting/support while keeping open-source core.
3. Add theme/branding system for photographers and client-facing portfolios.
4. Ship object storage only after end-to-end upload/processing/serving support is real, then market it aggressively.

---

## Final Missed-Issues Sweep

- Re-ran targeted search across docs, messages, public app routes, components, actions, and libs for marketing-sensitive claims and future-feature strings.
- Confirmed i18n key parity between English and Korean: no missing keys; only shared intentional empty labels (`users.actions`, `imageManager.actions`).
- Confirmed no active AI marketing claims in public README/UX surfaces.
- Confirmed S3/MinIO appears in messages/storage types but not in the rendered settings UI; captured as PM-09.
- Confirmed the main remaining marketing risks are claim precision, onboarding, SEO/social defaults, and white-label/localization polish rather than missing core gallery capability.

---

## Final Verdict

**Wait on a broad public creator launch; proceed with a developer/self-hoster beta after Tier 0 docs/claim fixes.** GalleryKit has enough real product to market honestly—optimized derivatives, private originals, admin publishing, sharing, search, bilingual routing—but the current top-level message is too generic and a few claims create avoidable trust debt. The first 100 users should be technically comfortable photographers, self-hosters, and developers building personal/client portfolios. Reach them with a transparent GitHub/self-hosted launch, a complete quickstart, screenshots, and a privacy/performance story that the code already supports.

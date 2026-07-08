# Product Marketer Reviewer - Cycle 35

Review target: current workspace `HEAD` `7993fa46`.

Role surface: GalleryKit product-marketer-reviewer. I read `AGENTS.md` and `CLAUDE.md` first, ignored reviewer guidance for unrelated products, and kept the pass review-only. This markdown report is the only intended file change.

## Inventory / Scope Reviewed

Primary product/operator docs:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/scripts/ensure-site-config.mjs`

Public messaging, metadata, SEO, feeds, and discovery:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/nav-client.tsx`

Public/admin UX copy and claim-validation source:

- `apps/web/src/components/search.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/download-labels.ts`
- `apps/web/src/lib/color-primaries.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/seo/seo-settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/seo.ts`

## Executive Summary

I found two confirmed product-facing messaging risks.

1. The wide-gamut visitor hint says an sRGB display is showing an "sRGB version" or converted sRGB color, but the rendering path does not choose an sRGB-specific asset by display capability.
2. The checked-in `site-config.json` is still deployment-specific to Atik and can become a fresh self-hosted install's brand, canonical URL, sitemap origin, OpenGraph fallback, and footer if the operator builds without overriding it.

I did not find active copy that promises payment/proofing, editing/culling/scoring, a bundled Lightroom Classic plugin, S3/MinIO storage, public HDR delivery, one-click production semantic search, app-level encrypted backups, or admin role separation.

## Findings

### PMR-C35-01 - Wide-gamut hint overstates sRGB delivery on sRGB displays

Severity: Medium
Confidence: High
Classification: Confirmed

Exact file/region:

- `apps/web/messages/en.json:398-399`
- `apps/web/messages/ko.json:398-399`
- `apps/web/src/components/wide-gamut-hint.tsx:146-172`
- `apps/web/src/components/photo-viewer.tsx:521-561`, `apps/web/src/components/photo-viewer.tsx:807-810`
- `apps/web/src/components/info-bottom-sheet.tsx:384-387`

Why this is a problem:

The English public hint says, "Your display shows the sRGB version of this photo." The Korean hint similarly says the display shows color converted to sRGB. The component only checks whether the source is wide-gamut and whether the display reports `color-gamut: srgb`; it does not know which encoded asset the browser selected. The viewer still renders AVIF, WebP, then JPEG `<source>` rows in normal codec order. The component comments state the delivery ceiling for wide-gamut sources is Display P3, with wider sources encoded down to P3, not an sRGB-only display-specific rendition.

Concrete user/operator failure scenario:

A photographer reviews a public photo on an sRGB laptop and sees a notice saying the sRGB version is being shown. They may assume GalleryKit generated and served a separate color-managed sRGB public rendition, then misdiagnose color complaints or leave the `force_srgb_derivatives` setting unchanged. In an AVIF-capable browser, the visitor can still receive the wide-gamut AVIF source while the display/browser gamut-maps or clips it for an sRGB panel, so the product copy describes the wrong delivery behavior.

Suggested fix:

Replace both locale strings with display-capability wording that does not claim a separate sRGB asset. For example: "This display cannot show the full wide-gamut preview. Display P3 delivery is available on {gamut} screens." For wider-than-P3 sources, keep the source context but say the public delivery target is Display P3. If the product wants exact "sRGB JPEG/WebP" copy, pass the active derivative policy and selected format into the hint instead of deriving it from display gamut alone.

### PMR-C35-02 - Checked-in Atik config can become a fresh deploy's public brand and canonical URL

Severity: Medium
Confidence: High
Classification: Confirmed

Exact file/region:

- `apps/web/src/site-config.json:2-10`
- `apps/web/src/site-config.example.json:2-11`
- `apps/web/scripts/ensure-site-config.mjs:4-12`, `apps/web/scripts/ensure-site-config.mjs:14-42`
- `apps/web/src/lib/data.ts:1851-1872`, `apps/web/src/lib/data.ts:1887-1896`
- `apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/sitemap.ts:70-113`
- `apps/web/src/app/[locale]/layout.tsx:15-48`
- `apps/web/src/components/footer.tsx:33-37`
- `README.md:60-77`, `README.md:121-122`, `README.md:171-172`, `README.md:200`
- `apps/web/README.md:19-20`, `apps/web/README.md:50-58`

Why this is a problem:

The committed config is deployment-specific: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and Atik nav/footer values. The docs correctly warn operators to customize `site-config.json`, but the destination file already exists in a fresh checkout. The production guard rejects placeholders such as `example.com` and localhost, but `gallery.atik.kr` is a real host and therefore passes when `BASE_URL` is unset. SEO and fallback brand plumbing then uses `BASE_URL || siteConfig.url`.

Concrete user/operator failure scenario:

A self-hosting photographer clones GalleryKit, sees `apps/web/src/site-config.json` already present, and builds a production image before DB SEO settings are initialized. The app can emit Atik's title, author, footer text, canonical metadata, OpenGraph fallback, feed/sitemap URLs, and social preview origin. Crawlers may index the wrong host and the operator experiences the project as tied to another gallery.

Suggested fix:

Track only `site-config.example.json` and ignore the real deployment `site-config.json`, or replace the committed `site-config.json` with placeholder values that production validation rejects unless `BASE_URL` or database SEO settings provide a real operator-owned origin. If this repository must carry the Atik config for its primary deployment, require an explicit deployment env such as `GALLERYKIT_ALLOW_ATIK_SITE_CONFIG=true` before `gallery.atik.kr` passes the production guard.

## Claim Checks With No Findings

Finished-photo positioning: Supportable. `README.md:33-35` and `README.md:54` say GalleryKit is for publishing finished photos and is not an editing, culling, scoring, proofing, payment, or SaaS system. EN/KO About copy mirrors that boundary in `apps/web/messages/en.json:831-839` and `apps/web/messages/ko.json:831-839`.

Semantic search: Supportable. `README.md:50` and `apps/web/README.md:66-92` describe disabled-by-default, operator-gated production activation. Admin copy distinguishes disabled, stub, and production modes in `apps/web/messages/en.json:773-782` and `apps/web/messages/ko.json:773-782`; public search copy labels stub search as filename/tag/EXIF-only in `apps/web/src/components/search.tsx:532-568`; similar photos are hidden outside production mode at `apps/web/src/components/similar-photos.tsx:138-141`.

HDR/color delivery: Mostly supportable except PMR-C35-01. Upload/settings copy says HDR source retention does not mean public HDR delivery (`apps/web/messages/en.json:176`, `apps/web/messages/en.json:383-385`, `apps/web/messages/en.json:783-790`, with matching KO strings). Gain-map copy states SDR-only delivery at `apps/web/messages/en.json:402-404` and `apps/web/messages/ko.json:402-404`.

Privacy and analytics: Supportable. Privacy copy discloses optional Google Analytics, first-party view events, rate-limit IP buckets, and OpenStreetMap tiles (`apps/web/messages/en.json:842-852`, `apps/web/messages/ko.json:842-852`). Public layout loads GA only when `siteConfig.google_analytics_id` is present and validates in `apps/web/src/app/[locale]/(public)/layout.tsx:23-35`, and the privacy page derives disclosure from the same config.

Upload/API/Lightroom positioning: Supportable. `README.md:218-227`, `apps/web/README.md:98-107`, and token copy at `apps/web/messages/en.json:876-903` describe PAT-authenticated upload access and explicitly say no Lightroom Classic plugin is bundled.

Storage and backups: Supportable. `CLAUDE.md` states only local filesystem storage is live; `apps/web/src/lib/storage/index.ts` keeps the abstraction inactive for remote backends. DB tools copy says backups cover database rows, are plaintext at rest, and exclude originals/derivatives/resources (`apps/web/messages/en.json:18-46`, `apps/web/messages/ko.json:18-46`).

Admin roles: Supportable. User-management copy says every admin has root access and avoids role-separation claims (`apps/web/messages/en.json:47-65`, `apps/web/messages/ko.json:47-65`).

## Final Sweep / Skipped Scope

Final sweep checks:

- Searched active docs, source, and translations for `Stripe`, `checkout`, `paid`, `license`, `entitlement`, `proof`, `cull`, `score`, `Lightroom`, `S3`, `MinIO`, `storage backend`, `semantic search`, `HDR`, `sRGB version`, `OpenStreetMap`, `Google Analytics`, `offline`, `sync`, `role`, and `root admin`.
- Checked public/admin EN and KO strings for feature claims, onboarding/error states, SEO/OpenGraph/feed messaging, privacy, analytics, upload token, backup, color/HDR, semantic search, and GalleryKit positioning.
- Confirmed unrelated modified review files already existed in the worktree and did not touch them.

Skipped:

- Generated build output, uploaded media, binary assets, fonts/icons, `node_modules`, and historical review/plan archives except where they informed current product constraints.
- Live deployment validation for `https://gallery.atik.kr`, external GitHub release/package/social pages, and browser-rendered screenshots.
- Lint/typecheck/tests/build, because this was a review-only pass and changed only this markdown artifact.

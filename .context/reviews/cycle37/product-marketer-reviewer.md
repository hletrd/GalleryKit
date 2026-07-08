# Cycle 37 Product Marketer Reviewer

Review target: `/Users/hletrd/flash-shared/gallery` at `dc1845c4` with current uncommitted cycle-37 worktree edits treated as source evidence.

Role: `product-marketer-reviewer`, adapted from the registered BurstPick-oriented prompt to GalleryKit: a self-hosted finished-photo gallery, not an AI culling/editing product.

Date: 2026-07-08 KST

Review-only lane. I did not edit product code and did not commit, push, deploy, or run destructive commands. This report is the only file added.

## Executive Summary

GalleryKit's core positioning is now mostly honest and technically backed: it clearly says "finished-photo publishing," explicitly rejects editing/culling/scoring/payment/hosted-SaaS promises, and documents semantic search, HDR, GPS, backups, and upload APIs with meaningful operator caveats. Market-readiness score: **7/10** for an open-source self-hosted gallery. The largest remaining product-marketing risk is not overclaiming color or AI; it is that the shipped public experience still mixes a photographer portfolio with GalleryKit product/vendor surfaces and deployment-specific Atik defaults, which can make a fresh operator's gallery look like someone else's branded demo.

## Inventory And Examined Files

Control and reviewer context:

- `AGENTS.md`, in-thread AGENTS instructions, `CLAUDE.md`, `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`.
- Previous relevant reviews: `.context/reviews/product-marketer-reviewer.md`, `.context/reviews/designer-document-product.md`.
- Current plan context: `.context/plans/README.md`.

Public/docs/copy surfaces:

- `README.md`, `apps/web/README.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`.
- `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`.
- Public route/product pages: `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx`, `privacy/page.tsx`, homepage/topic/photo/map/timeline/share route inventory, `apps/web/src/app/sitemap.ts`.
- Public components: `components/nav.tsx`, `components/nav-client.tsx`, `components/footer.tsx`, `components/search.tsx`, `components/photo-viewer.tsx`, `components/color-details-section.tsx`, `components/similar-photos.tsx`, `components/wide-gamut-hint.tsx`.

Source evidence for claim checks:

- Color/HDR/image pipeline: `apps/web/src/lib/process-image.ts`, `color-detection.ts`, `color-pipeline-decisions.ts`, `gallery-config-shared.ts`.
- Privacy and data exposure: `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/gps-exif-strip.ts`.
- Semantic search: `apps/web/src/lib/clip-model.ts`, `clip-embeddings.ts`, `clip-model-id.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts`, `scripts/download-clip-models.ts`, `scripts/backfill-clip-embeddings.ts`.
- Operator/admin promises: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, DB/settings/upload/token/admin route inventory, `apps/web/scripts/ensure-site-config.mjs`.

## Findings

### PMR-C37-01 - Confirmed: checked-in Atik config can ship as another operator's canonical brand

Severity: Medium  
Confidence: High  
Status: Confirmed  
Area: onboarding, SEO, self-hosting trust, demo expectations

Evidence:

- The committed runtime config contains deployment-specific values: title `Atik Gallery`, description `A self-hosted finished-photo gallery by Atik`, URL `https://gallery.atik.kr`, author `Atik`, nav title `Atik Gallery`, and footer text `Atik Gallery` at `apps/web/src/site-config.json:2-10`.
- The generic template is separate and still placeholder-based at `apps/web/src/site-config.example.json:2-11`.
- Production validation rejects placeholder hosts such as `example.com`, localhost, and loopback, but accepts any real absolute URL, including the committed Atik URL, at `apps/web/scripts/ensure-site-config.mjs:11-42`.
- The root README tells operators to copy the example over `apps/web/src/site-config.json` at `README.md:118-122`, but a fresh clone already has a real `site-config.json`.
- README also explains that JSON config is build-time inlined and becomes metadata/static links until rebuild at `README.md:60-77` and `README.md:171-172`.
- Sitemap generation uses `process.env.BASE_URL || siteConfig.url` at `apps/web/src/app/sitemap.ts:14-18`, then emits localized homepage/photo/static URLs from that base at `apps/web/src/app/sitemap.ts:70-107`.

Concrete failure scenario:

A photographer clones GalleryKit, configures MySQL and admin secrets, skips `cp apps/web/src/site-config.example.json apps/web/src/site-config.json` because the destination file already exists, and builds without `BASE_URL`. Production validation passes because `gallery.atik.kr` is a real URL. The new self-hosted gallery can publish Atik's title, author, footer, canonical/sitemap origin, OpenGraph defaults, and feed metadata.

Suggested fix:

Track only `site-config.example.json` and keep real deployment config ignored, or replace the tracked `site-config.json` with production-rejected placeholders. If the Atik deployment config must stay tracked, add an explicit production guard that rejects `gallery.atik.kr` unless an Atik-specific env opt-in is set.

### PMR-C37-02 - Confirmed: product/vendor footer surfaces are hardwired into every public gallery

Severity: Low-Medium  
Confidence: High  
Status: Confirmed  
Area: photographer/audience fit, visible product positioning, operator control

Evidence:

- Public footer always renders `siteConfig.footer_text` plus links for `GalleryKit`, `Timeline`, `Map`, `Privacy`, GitHub, and `Admin` at `apps/web/src/components/footer.tsx:32-68`.
- The `GalleryKit` footer link always points to `/about-gallerykit` at `apps/web/src/components/footer.tsx:41-44`.
- The About page is product copy about the GalleryKit engine, operator workflows, semantic search, backups, and non-goals, not an "about this photographer/gallery" page: route structure at `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`, strings at `apps/web/messages/en.json:838-846`.
- The product page is included in sitemap static public paths at `apps/web/src/app/sitemap.ts:25` and emitted for every locale at `apps/web/src/app/sitemap.ts:100-107`.
- Current admin navigation settings cover only Timeline and Map visibility at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:887-918`; the shared setting keys likewise only add `show_timeline_nav` and `show_map_nav` at `apps/web/src/lib/gallery-config-shared.ts:68-70`.
- README positions GalleryKit for "finished-photo publishing" and "self-hosted sharing" at `README.md:33-40`, so the public audience is clients/viewers as much as operators.

Concrete failure scenario:

A wedding, travel, or portfolio photographer sends a public gallery link to clients. The footer invites visitors to GitHub, Admin, and a GalleryKit product explainer. A client clicking "GalleryKit" expecting "about this gallery" lands on software-positioning copy about operator workflows. That may be acceptable for an OSS demo, but it dilutes the photographer's brand on a production portfolio and exposes operator-focused language to the wrong audience.

Suggested fix:

Make footer attribution and utility links configurable by operator intent. At minimum, split "About this gallery/photographer" from "Powered by GalleryKit"; allow hiding GitHub and Admin from public footer; and consider `noindex` or sitemap exclusion for `/about-gallerykit` when the operator disables product attribution. Keep OSS attribution as the default for demo installs, but make the portfolio-safe path explicit.

### PMR-C37-03 - Likely: search is a core claim, but the visible trigger is still too easy to miss below large desktop

Severity: Low  
Confidence: Medium-High  
Status: Likely  
Area: demo expectations, product discovery, visible positioning

Evidence:

- README lists visitor search as part of the product shape and claims keyword metadata search plus optional semantic search at `README.md:38-50`.
- The nav mounts Search as a primary control beside theme/language at `apps/web/src/components/nav-client.tsx:170-175`.
- Closed Search renders visible text only when `semanticSearchMode === 'production' || showDesktopLabel`; for non-production with `showDesktopLabel`, the text span is `hidden lg:inline`, so mobile/tablet still see an icon-only trigger at `apps/web/src/components/search.tsx:381-398`.
- The dialog copy itself is clear once opened: keyword placeholder/hint at `apps/web/messages/en.json:420-424`, semantic setup/production caveats at `apps/web/messages/en.json:431-436`, and semantic toggle rendering at `apps/web/src/components/search.tsx:533-568`.

Concrete failure scenario:

A visitor evaluating the demo on a phone or tablet sees a magnifier icon next to theme and locale controls. The gallery does have useful title/tag/camera/description search, and production deployments may have semantic search, but the feature is not visibly named until the visitor already knows to open the icon. This under-sells one of GalleryKit's stronger browse/discovery promises, especially on first-run empty or sparse galleries.

Suggested fix:

Use a visible "Search" label for the trigger at least when the mobile nav is expanded, on tablet widths, or whenever semantic production is active. Keep the compact icon for the narrowest collapsed layout if needed, but do not make the strongest discovery affordance depend on icon recognition.

## Claim Checks With No Finding

- Finished-photo boundary is backed. README says GalleryKit is for publishing and explicitly not for editing, culling, scoring, proofing, payment, or hosted SaaS at `README.md:33-35` and `README.md:54`; public About copy repeats the same boundary at `apps/web/messages/en.json:838-846`. I found no shipped editor/culler/scoring/payment claim in the examined copy.
- Color/HDR positioning is appropriately cautious. README says browser/codec limits and no public HDR delivery yet at `README.md:45-46`; source has NCLX/ICC/gain-map detection in `apps/web/src/lib/color-detection.ts:1-12` and `apps/web/src/lib/color-detection.ts:171-221`, wide-gamut/P3 decision code in `apps/web/src/lib/process-image.ts:1027-1068`, and 10-bit AVIF probing/fallback at `apps/web/src/lib/process-image.ts:59-73` and `apps/web/src/lib/process-image.ts:1282-1320`.
- Semantic-search honesty is backed. README says production is disabled by default and operator-runbook-only at `README.md:50`; defaults set `semantic_search_mode: 'disabled'` at `apps/web/src/lib/gallery-config-shared.ts:123-125`; Settings intentionally omits a user-selectable production item at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:844-864`; the route returns 503 outside stub/production at `apps/web/src/app/api/search/semantic/route.ts:186-201`; real CLIP loads offline with `env.allowRemoteModels = false` at `apps/web/src/lib/clip-model.ts:203-216`; embedding scans are model-version-filtered and capped at `apps/web/src/app/api/search/semantic/route.ts:263-279`.
- Privacy claims are mostly backed. Public selects omit GPS and other sensitive fields at `apps/web/src/lib/data.ts:368-405`; the map select is the explicit latitude/longitude exception with topic visibility guard at `apps/web/src/lib/data.ts:409-438` and runtime map-visible checks at `apps/web/src/lib/data.ts:1778-1808`; upload GPS stripping can null DB coordinates and strip retained originals at `apps/web/src/app/actions/images.ts:368-372`, with fail-closed behavior described in `apps/web/src/lib/process-image.ts:1686-1722`.
- Lightroom/plugin wording is honest. README says the upload route is an API contract, not a bundled Lightroom Classic plugin at `README.md:216-227`; token UI copy repeats that at `apps/web/messages/en.json:882-895`.
- Prior map/timeline discoverability issue appears improved in the current worktree. Nav browse links now include Timeline/Map when enabled at `apps/web/src/components/nav-client.tsx:46-49` and render them in primary nav at `apps/web/src/components/nav-client.tsx:120-137`; Settings exposes toggles at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:887-918`.

## Final Missed-Issues Sweep

Searched public docs, README files, route copy, EN/KO messages, nav/footer/about/privacy pages, site config, sitemap/SEO plumbing, settings UI, semantic-search route/model code, color/HDR pipeline, GPS/privacy data selects, upload/token API surfaces, and previous product-marketer reviews. I specifically checked claims around self-hosting, private originals, color-managed delivery, HDR, semantic search, AI, Lightroom, proofing/payment/editor/culling non-goals, analytics, backups/restores, storage/CDN, map/timeline, admin roles, and demo expectations. I did not run live browser checks or authenticated admin flows in this cycle, and I did not verify current production DB/model state at `gallery.atik.kr`.

# Cycle 28 Product Marketer Reviewer

Date: 2026-06-30
Role: product-marketer-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `9d7f7f7494d8`

## Scope and Method

Applied `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` under `AGENTS.md` and `CLAUDE.md` authority. The local prompt is BurstPick-specific, so I used its evidence-first product-marketing lens for GalleryKit: public positioning, user-facing promises, onboarding flow, SEO/social metadata, i18n copy, privacy expectations, and feature-claim/code alignment.

This is Prompt 1 review only. No fixes were implemented. This report artifact is the only intended change.

## Inventory of Review-Relevant Files Examined

Loaded first:

- `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`
- `AGENTS.md` project instructions from the task prompt
- `CLAUDE.md`, especially project overview, key files, semantic-search activation, color/HDR pipeline, privacy/security, deployment, and operational playbook sections

Public/product documentation and defaults:

- `README.md`
- `apps/web/README.md`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

i18n/user-facing message catalogs:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

Public route, metadata, SEO, privacy, and navigation surfaces:

- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (author/metadata grep)
- `apps/web/src/app/feed.xml/route.ts` and topic feed route (author/metadata grep)
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx` and `photo-viewer.tsx` GPS-link grep

Admin onboarding/settings/API copy surfaces:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/topics.ts` (map-visible action grep)

Claim anchors in implementation:

- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/data.ts`
- semantic and similar search routes by repository grep
- upload API/token route by repository grep
- service-worker/PWA files by repository grep
- privacy/select-field guards and map GPS query in `data.ts`

Historical review context:

- Existing `.context/reviews/product-marketer-reviewer.md` from cycle 27 was read before replacement.
- `.context/reviews/` and `.context/plans/` were inventoried/search-scanned for marketing, privacy, semantic-search, SEO, and prior promise-drift themes. Generated screenshots, gate logs, test fixtures, binary assets, migrations, and pure implementation tests were not read line-by-line because they do not contain review-relevant product/marketing/user-facing copy. No relevant copy/doc/message file was intentionally skipped.

## Executive Summary

GalleryKit's positioning is mostly disciplined: it says finished-photo publishing, not editing/culling/proofing/payment; semantic search is documented as disabled-by-default and operator-gated; upload API copy no longer implies a bundled Lightroom plugin; analytics copy distinguishes first-party tracking from optional Google Analytics. The main drift is trust/onboarding: first-run docs and admin labels can lead operators to publish or retain location metadata without realizing the consequence, while the public demo/default SEO still ships generic GalleryKit branding. Market-readiness score for public positioning: 7/10. The product is technically honest in many details, but a photographer evaluating privacy and color fidelity can still be misled at the exact moments that determine trust.

## Findings

### C28-PMR-01 - First-run docs push upload before GPS/privacy setup, but GPS stripping defaults off and locks after photos exist

- Severity: High
- Confidence: High
- Category: Onboarding friction / privacy promise drift
- File and lines:
  - `README.md:29-32` positions GalleryKit around private original storage and self-hosted publishing, then `README.md:118` tells a new operator to create a category, upload one photo, and confirm the homepage.
  - `apps/web/README.md:24` repeats the same first-run sequence.
  - `apps/web/src/lib/gallery-config-shared.ts:97` sets `strip_gps_on_upload` default to `false`.
  - `apps/web/src/components/upload-dropzone.tsx:77` detects the first-upload GPS warning condition only when GPS stripping is off and no images exist; `upload-dropzone.tsx:387-390` shows a warning, but it appears at the upload surface after the setup path already sent the user there.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:660-675` disables the GPS switch once images exist; `settings-client.tsx:677-680` repeats the lock notice.
  - `apps/web/messages/en.json:735-739` says new uploads can strip GPS and that image size/GPS settings are locked for an existing gallery.
  - `apps/web/messages/en.json:172` warns that, with GPS stripping off, first uploads containing location metadata retain it in originals.

Problem: The public setup path optimizes for "upload one photo" before it tells operators to make the irreversible privacy choice. That conflicts with the product's trust positioning around private originals and metadata safety. The code is honest once the operator reaches the upload form, but the docs do not steer first-time admins to Settings before their first real upload, and the setting becomes unavailable after photos exist.

Concrete failure scenario: A photographer follows `README.md`, creates a category, and uploads a sample from a camera roll that contains home/studio GPS metadata. Because `strip_gps_on_upload` defaults to `false`, GalleryKit stores the retained original with GPS. The admin later reads Privacy settings, tries to turn stripping on, and finds the setting locked because the gallery already has images. The public gallery may not expose GPS in normal pages, but the operator's private-original privacy expectation has already been violated.

Suggested fix: Change the first-run docs to explicitly configure privacy before the first upload: "Before uploading real photos, open Settings and decide whether retained originals should have GPS stripped." Stronger product fix: default `strip_gps_on_upload` to `true` for new installs, or add a first-run interstitial that requires an explicit keep/strip GPS choice before the first upload. Keep the upload warning, but do not rely on it as the primary onboarding guard.

### C28-PMR-02 - "Show on Map" hides that the toggle publishes GPS coordinates to a public page

- Severity: High
- Confidence: High
- Category: UX copy / privacy disclosure
- File and lines:
  - `apps/web/messages/en.json:107-109` labels the admin control as "Show on Map" and "Toggle map visibility for {label}".
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:226` renders the table header from that copy.
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:260-264` renders a one-click switch with only that aria label.
  - `apps/web/src/lib/data.ts:410-416` documents `publicMapSelectFields` as the only unauthenticated select retaining latitude/longitude.
  - `apps/web/src/lib/data.ts:1660-1685` confirms `/map` returns processed images with latitude and longitude for topics where `topics.map_visible = true`.
  - `apps/web/messages/en.json:808` explains the privacy model on the Privacy page, but the admin toggle itself does not carry that warning.

Problem: The control label is too soft for the action. "Show on Map" sounds like a navigation/display preference; the actual behavior publishes geotagged image coordinates on an unauthenticated public map for the whole topic. That is a high-trust decision for a photographer's private locations, not a simple visibility toggle.

Concrete failure scenario: An admin sees a category table, toggles "Show on Map" to make a portfolio category easier to browse, and does not connect the label to public release of precise GPS coordinates. Photos from a home, client site, school, private venue, or travel location now appear on `/map`. The privacy page is accurate, but it is not in the decision path when the admin flips the switch.

Suggested fix: Rename the label to a consequence-first phrase such as "Publish GPS on public map" and change the aria label accordingly. Add a confirmation dialog the first time a topic is enabled: "This exposes coordinates for photos in this category on the public map. Continue?" Include a short inline help text in the table or category edit dialog; avoid hiding the only disclosure on the Privacy page.

### C28-PMR-03 - Checked-in live site defaults keep generic GalleryKit SEO/brand metadata

- Severity: Medium
- Confidence: High
- Category: SEO / positioning / public-facing metadata
- File and lines:
  - `README.md:22` links the live demo.
  - `apps/web/src/site-config.json:2-9` sets the live URL to `https://gallery.atik.kr` but keeps `title`, `author`, `nav_title`, and `footer_text` as "GalleryKit" and `description` as "A self-hosted photo gallery".
  - `apps/web/src/lib/data.ts:1714-1717` documents SEO fallback to `site-config.json`.
  - `apps/web/src/lib/data.ts:1742-1749` actually falls back to those generic values when DB-backed SEO rows are absent or unreadable.
  - `apps/web/src/app/[locale]/layout.tsx:22-49` uses the resolved SEO title/description/siteName for root metadata and Open Graph.
  - `apps/web/src/app/[locale]/(public)/page.tsx:38-53` uses the same SEO values for home title/description, and `page.tsx:176-182` emits them in JSON-LD.

Problem: The repository's production-like config points at a real public origin but still brands the site as the software package rather than the photographer/gallery. If DB SEO settings are missing, unreadable, or not configured in a fresh deployment, the public page, social previews, JSON-LD, footer, and navigation present "GalleryKit" and "A self-hosted photo gallery" instead of a portfolio identity.

Concrete failure scenario: A visitor or social crawler hits `gallery.atik.kr` during a DB issue or before the admin has configured SEO rows. The page title and social card read like a generic app demo, not a photography site. A photographer evaluating GalleryKit sees a self-hosting tool that forgets to make the photographer the brand, which undercuts the product promise that this is for publishing finished work.

Suggested fix: For the checked-in live config, use demo-specific, photographer-facing defaults rather than package defaults. For reusable templates, keep `site-config.example.json` generic but add a first-run/admin SEO checklist before public launch. Consider an admin dashboard warning while SEO title/description/nav title remain the stock defaults.

### C28-PMR-04 - "Color-faithful" and "Photographer-grade color management" overstate a pipeline that can clip, downconvert HDR, and depend on browser/display behavior

- Severity: Medium
- Confidence: High
- Category: Marketing claim precision / photographer trust
- File and lines:
  - `README.md:31` claims "browser-managed color-faithful delivery".
  - `README.md:38` claims "Photographer-grade color management" and says Display P3, DCI-P3, Adobe RGB, ProPhoto, and Rec.2020 sources are mapped to Display P3.
  - `apps/web/messages/en.json:377` says HDR sources are delivered as SDR and HDR AVIF output is only planned.
  - `apps/web/messages/en.json:384-386` explicitly warns that Adobe RGB, ProPhoto, and Rec.2020 sources may clip when mapped to P3.
  - `apps/web/messages/en.json:389` warns display calibration affects color accuracy.
  - `apps/web/messages/en.json:396` says Apple HDR gain maps are not passed through.
  - `apps/web/messages/en.json:756-759` says forcing sRGB affects WebP/JPEG while AVIF stays wide-gamut, creating format-dependent delivery behavior.

Problem: The implementation and in-app copy are unusually honest about limitations, but the README headline language is stronger than the delivery contract. "Color-faithful" and "Photographer-grade" imply the photographer's edit is preserved, while the documented reality is a color-aware web pipeline with explicit browser/display limits, gamut mapping, possible clipping, SDR output for HDR sources, and gain-map omission.

Concrete failure scenario: A photographer uploads a ProPhoto or Rec.2020 export with saturated colors, or a PQ/HLG/HDR-gain-map image. They chose GalleryKit partly because the README promised color-faithful, photographer-grade delivery. Public visitors see clipped P3/SDR derivatives or browser-dependent rendering. The admin audit panel may explain why, but the initial marketing promise has already overreached.

Suggested fix: Reframe the README language around verifiable constraints: "color-aware delivery with explicit gamut/HDR audit trails" or "preserves and discloses color decisions within browser delivery limits." Keep the detailed feature bullet, but move the limitations into the same sentence as the benefit: P3 delivery for supported sources, explicit clipping labels for wider gamuts, SDR-only HDR handling until HDR AVIF/gain-map delivery ships.

### C28-PMR-05 - Semantic-search admin copy says "Enable" while the UI can only expose Disabled/Stub, making a test mode look like a public feature

- Severity: Medium
- Confidence: Medium
- Category: Feature-policy drift / admin UX copy
- File and lines:
  - `apps/web/messages/en.json:748-755` says "Enable CLIP-based semantic image search", describes production mode, and says "When enabled, shows a semantic search toggle in the search box."
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:758-779` renders only Disabled and Stub options; comments say no production item by design.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:785-788` warns only when a raw stored production value already exists.
  - `apps/web/src/components/search.tsx:491-520` shows a public "Semantic search" toggle whenever mode is not disabled, including stub mode; in stub mode it adds only "Experimental - results may not match your query."
  - `apps/web/README.md:73-79` is clearer than the UI: production requires env opt-in plus a DB row and has no one-click admin toggle.
  - `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:3-5` and `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:5-17` correctly mark the older semantic-search docs as historical, not current production-state evidence.

Problem: The admin Settings card uses enablement language for a feature whose production path is deliberately outside the UI. The only selectable non-disabled state is Stub, which public visitors can see as "Semantic search" even though its embeddings are explicitly non-meaningful. The copy is not false in isolation, but it asks admins to reason across a long paragraph, a hidden runbook, and a public toggle.

Concrete failure scenario: An operator wants semantic search, opens Settings, reads "Enable CLIP-based semantic image search," chooses "Stub (testing only)" because it is the only available enabled-looking option, and saves. Public visitors now see a "Semantic search" toggle and get irrelevant results with a mild experimental disclaimer. The operator thinks the product feature is bad; visitors think GalleryKit's AI search is unreliable.

Suggested fix: Split the card into two policies: "Public semantic search" (production status, read-only unless operator-gated) and "Stub test mode" (clearly marked "Do not expose on public sites"). Rename the public toggle in stub mode to "Test semantic search" or hide it from unauthenticated visitors unless production mode is active. Shorten the admin hint to: "This UI only supports Disabled or Stub test mode. Production requires the operator runbook."

## Validated Claims With No New Finding

- Finished-photo positioning is aligned: `README.md:29-32` says GalleryKit is for edited-work publishing and not editing, culling, scoring, proofing, payment, or SaaS workflows; reviewed app copy did not introduce a conflicting marketed workflow.
- Upload API wording is aligned: `README.md:205-216`, `apps/web/README.md:82-91`, and `apps/web/messages/en.json:831-858` describe a PAT upload API and explicitly say GalleryKit does not bundle a Lightroom Classic plugin.
- Google Analytics opt-in is aligned: `README.md:29` and `README.md:69` say GA is optional/disabled unless configured; `apps/web/src/app/[locale]/layout.tsx:147-159` injects GA only for a configured valid ID.
- Semantic-search docs are mostly cautious: `README.md:42` says disabled by default, operator setup, bounded newest-first scan, and not a vector index; `apps/web/README.md:61-80` gives the production runbook caveats. Finding C28-PMR-05 is about UI copy/mental model, not a false repository claim.
- Privacy page copy is accurate as written: `apps/web/messages/en.json:803-808` distinguishes processed derivatives, local analytics, no full IP/client fingerprint storage in analytics tables, and map-visible GPS publication. The findings above are about decision-path disclosure and onboarding order.
- PWA/offline wording remains appropriately bounded in `README.md:43`: visited image caching plus offline HTML fallback, not full gallery sync.
- Historical CLIP docs are labeled as historical records and point readers back to `CLAUDE.md` / `apps/web/README.md`; I did not find a current-doc contradiction there.

## Missed-Issues Sweep

Final sweeps searched for product-policy drift terms across docs, messages, app routes, components, and core config/data files: `privacy`, `GPS`, `original`, `semantic`, `production`, `stub`, `AI`, `color-faithful`, `Photographer-grade`, `self-hosted`, `map`, `metadata`, `SEO`, `Open Graph`, `Lightroom`, `download`, `license`, `payment`, `proof`, and related variants.

No relevant file was intentionally skipped. Non-relevant generated artifacts, binary assets, screenshots, migration snapshots, fixture data, and implementation-only tests were excluded from line-by-line review after repository inventory because they do not carry product/positioning/marketing/UX copy.

Finding count: 5 confirmed findings (2 High, 3 Medium). No fixes implemented.

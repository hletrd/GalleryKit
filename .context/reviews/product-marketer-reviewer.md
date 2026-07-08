# Product Marketer Reviewer - Cycle 36

Review target: `/Users/hletrd/flash-shared/gallery` at `bc73c02293f2568d23602ab498f12346a37fadf1`
Role: `cycle-36 product-marketer-reviewer`
Date: 2026-07-08 KST

Review-only lane. I changed only this provenance report and did not commit, push, deploy, or edit production code.

## Evidence Base

- Read `AGENTS.md` instructions supplied in-thread and `CLAUDE.md`.
- Reviewed public product copy, SEO metadata plumbing, config defaults, footer/nav IA, privacy/about pages, search/photo/map/timeline copy, and admin settings/token/backup copy.
- Browser evidence came from `next start` on `http://localhost:3002` using agent-browser snapshots for `/en`, `/ko`, `/en/admin`, `/en/map`, and search.
- Authenticated admin pages were source-reviewed only because credentials were unavailable.
- `npm run typecheck --workspace=apps/web` passed.

## Findings

### PMR-C36-01 - Checked-in Atik site config can ship as another operator's brand/canonical origin

Severity: Medium
Confidence: High
Area: product positioning, onboarding, SEO

Evidence:

- Source: `apps/web/src/site-config.json:2-10` is deployment-specific: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and `Atik Gallery` footer/nav values.
- Source: root metadata falls back to `getSeoSettings()` and uses the configured URL/site name for metadata and OpenGraph: `apps/web/src/app/[locale]/layout.tsx:15-48`.
- Source: footer renders `siteConfig.footer_text`: `apps/web/src/components/footer.tsx:33-37`.
- Source: sitemap uses SEO/site URL plumbing: `apps/web/src/app/sitemap.ts` was in scope from the route inventory; current public runtime also emitted Atik title/copy on localhost.
- Runtime evidence: `/en` page title was `Atik Gallery`; footer text was `Atik Gallery`.

Failure scenario:

A self-hosting photographer clones the repository and builds before overriding DB SEO settings or replacing `site-config.json`. Because `gallery.atik.kr` is a real URL, placeholder validation will not catch it like `example.com`. The new gallery can emit Atik's brand, canonical URL, footer, author, social metadata, feed/sitemap origin, and browser title.

Fix:

Track only `site-config.example.json` and keep real deployment config out of the repository, or make the committed `site-config.json` contain production-rejected placeholders. If the Atik deployment must remain checked in, require an explicit env opt-in before `gallery.atik.kr` is accepted in production.

### PMR-C36-02 - "GalleryKit" footer link switches from portfolio browsing to product marketing without context

Severity: Low-Medium
Confidence: High
Area: product/marketing clarity, visitor expectation

Evidence:

- Source: public brand defaults to the gallery/operator: `apps/web/src/site-config.json:2-9` uses `Atik Gallery`.
- Source: footer link label is `GalleryKit`: `apps/web/messages/en.json:824-826`, `apps/web/messages/ko.json:824-826`.
- Source: footer links `GalleryKit` to `/about-gallerykit`: `apps/web/src/components/footer.tsx:42-44`.
- Source: the About page H1 and body market the software product, not this specific gallery or photographer: `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`; strings at `apps/web/messages/en.json:832-840` and `apps/web/messages/ko.json:832-840`.
- Runtime evidence: `/en` footer exposed link `GalleryKit` while the page brand was `Atik Gallery`.

Failure scenario:

A public visitor clicks "GalleryKit" expecting an about-this-gallery page and lands on product copy about a self-hosted gallery engine, operator workflows, semantic search, backups, and what the software is not. That is useful for open-source positioning but abrupt in a photographer portfolio context.

Fix:

Rename the footer link to "About GalleryKit" / "Powered by GalleryKit", or add a separate "About this gallery" page for the operator/photographer and keep product copy under a clearly product-labeled route. This preserves open-source attribution without confusing portfolio visitors.

### PMR-C36-03 - Search is marketed as an icon-only utility unless semantic production is enabled

Severity: Low
Confidence: High
Area: product discovery, affordance

Evidence:

- Source: search trigger shows visible text only when `semanticSearchMode === 'production'`: `apps/web/src/components/search.tsx:380-397`.
- Source: nav renders the search trigger as one of the primary sticky controls: `apps/web/src/components/nav-client.tsx:145-151`.
- Runtime `/en` snapshot: the sticky nav exposed an accessible `Search photos` button, but the visible trigger was icon-only because the seeded local app was not semantic-production mode.
- Product claim context: About copy says search is operator-controlled, `apps/web/messages/en.json:837-838`, but ordinary keyword search exists even when semantic search is disabled.

Failure scenario:

Visitors who do not recognize the magnifier icon may miss keyword search entirely. The product has title/tag/camera/description search, but its visible marketing affordance becomes a generic icon unless the operator enables the more advanced semantic-search mode.

Fix:

Show a compact visible "Search" label at desktop/tablet widths for all modes, not only semantic production. Keep the icon-only version for very narrow mobile if space is constrained, and use the search dialog copy to distinguish keyword vs semantic behavior.

### PMR-C36-04 - Footer-only Timeline/Map placement under-sells two differentiated browsing modes

Severity: Low-Medium
Confidence: High
Area: product discovery, information architecture

Evidence:

- Source: Timeline and Map labels exist in footer strings: `apps/web/messages/en.json:827-829`, `apps/web/messages/ko.json:827-829`.
- Source: footer renders Timeline and Map links at `apps/web/src/components/footer.tsx:45-50`.
- Source: sticky nav only exposes topics plus utilities, `apps/web/src/components/nav-client.tsx:106-168`.
- Runtime `/en` snapshot: Timeline and Map appeared only in `contentinfo`; nav exposed the category `E2E Smoke`, Search, Theme, and language.
- Source: the Map route has a full product surface with marker/list fallback and metadata: `apps/web/src/app/[locale]/(public)/map/page.tsx:69-115`; Timeline route has year/month browsing: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:151-299`.

Failure scenario:

Timeline and Map are strong differentiators for a finished-photo archive, but a visitor must reach the footer to discover them. On long galleries, that means the product's richer browsing story is effectively hidden behind the photo grid.

Fix:

Promote Timeline and Map into the primary navigation or a "Browse" menu. Keep Privacy/About in the footer, but treat Timeline/Map as core browsing modes.

## Claim Checks With No Finding

- Finished-photo boundary still holds: About copy says GalleryKit is not an editor, culling station, scoring tool, proofing portal, payment system, hosted SaaS workflow, or bundled Lightroom plugin (`apps/web/messages/en.json:839-840`, `apps/web/messages/ko.json:839-840`).
- Wide-gamut visitor copy no longer claims a separate sRGB version; current EN/KO strings describe display capability and Display P3 availability (`apps/web/messages/en.json:398-399`, `apps/web/messages/ko.json:398-399`), matching `WideGamutHint` source (`apps/web/src/components/wide-gamut-hint.tsx:152-172`).
- HDR honesty remains clear: public/admin copy says HDR source metadata does not imply public HDR output (`apps/web/messages/en.json:383-385`, `apps/web/messages/en.json:402-404`, with KO equivalents).
- Privacy copy discloses Google Analytics, first-party analytics, rate-limit IP buckets, metadata/GPS boundaries, and OpenStreetMap tiles (`apps/web/messages/en.json:842-852`, `apps/web/messages/ko.json:842-852`).
- Token copy says GalleryKit exposes an API endpoint and does not bundle a Lightroom Classic plugin (`apps/web/messages/en.json:876-903`, KO equivalent follows).

## Final Missed-Issue Sweep

Searched active source/messages/docs for claims around editing/culling/scoring, proofing, payment, SaaS, Lightroom, semantic search, HDR, sRGB, storage, backups, privacy, roles, analytics, map, timeline, and self-hosting defaults. Skipped generated build output, binary assets/media, live production at `gallery.atik.kr`, external social previews, and authenticated runtime admin pages. No implementation changes were made.

# GalleryKit Product Marketer Reviewer - Cycle 7 Lane F

Date: 2026-07-07
Reviewed workspace: `/Users/hletrd/flash-shared/gallery`
Lane: product-marketer-reviewer
Mode: reviewer-style product/positioning pass, adapted to GalleryKit. The local BurstPick-oriented prompt was used only for claim discipline and market-readiness framing; BurstPick assumptions were not applied.

## Inventory

I built the review inventory first, then checked product claims against source/docs:

- Product/docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/src/site-config*.json`, package metadata.
- Public surfaces: localized public home/topic/photo/share/group/map/timeline/year/smart collection/privacy/not-found routes.
- Admin/product surfaces: admin login, settings, users, DB, tokens, SEO, analytics, upload, bulk edit, color metadata, and protected admin nav.
- Claim-sensitive code: storage backend, upload/private paths, semantic-search settings/API, search UI, privacy-sensitive data selects, map coordinate reads, upload API/token scopes, analytics config, color/HDR processing/render gates, PWA/service-worker behavior, and admin navigation.
- Tests and browser evidence: public/admin/e2e specs, privacy/a11y/focus/error contracts, and live production browser pass on `https://gallery.atik.kr`.

## Verified Claim Inventory

No materially false product claim was found in the checked docs or UI. Current positioning is mostly claim-honest:

- Finished-photo positioning is explicit. `README.md:29-46` says GalleryKit is for edited work and not editing, culling, scoring, proofing, payment, or hosted SaaS workflows.
- Semantic search is accurately caveated. `README.md:42`, `apps/web/README.md:62-84`, `apps/web/src/lib/gallery-config-shared.ts:119-120`, and `gallery-config-shared.ts:223-228` align on disabled-by-default, operator-gated production mode. The live production demo does have semantic search enabled, which is consistent with the runbook caveat.
- Upload API is not overclaimed as a Lightroom plugin. `README.md:207-218` says it is a PAT-authenticated upload route and not a bundled Lightroom Classic plugin.
- Local-only storage is not marketed as S3/MinIO support. The storage abstraction is still local-only in implementation.
- Trusted-admin team positioning is clearer than prior cycles. `README.md:29` says "trusted owner/operator teams", and `README.md:44` discloses multiple root-admin accounts with no role separation.
- Configuration docs now correctly distinguish build-time JSON from runtime DB SEO/branding fields. `README.md:52-68` and `README.md:187-205` match the static import behavior.

## Findings

### PMKT-C7F-01 - The live demo sells Atik's gallery, not GalleryKit's product promise

Severity: Low-Medium
Confidence: High
Status: confirmed

Evidence:

- `README.md:22-24` sends prospects to `https://gallery.atik.kr` as the live demo.
- Live browser evidence on `/en`: the first viewport is a real gallery headed `Latest`, with tag filters, photo cards, search, and the `Atik Gallery` brand. The footer exposes `Privacy`, `GitHub`, and `Admin`, but no "About GalleryKit", install, product promise, or "for/not for" context.
- Source: `apps/web/src/app/[locale]/(public)/page.tsx:212-235` renders JSON-LD plus `HomeClient` and `OnThisDayWidget`; there is no product/demo explainer surface.
- Source: `apps/web/src/components/footer.tsx:32-59` renders only instance footer text, Privacy, GitHub, and Admin.
- Source config: `apps/web/src/site-config.json:2-10` brands the instance as `Atik Gallery` with description `A self-hosted finished-photo gallery by Atik`.

Failure scenario:

A photographer or technical buyer clicks "Live Demo" from the README, sees a polished personal gallery, and leaves without understanding the product wedge: self-hosted finished-photo publishing, private originals, color-conscious derivatives, first-party analytics, and operator-runbook semantic search. The demo proves UI quality, but it does not convert curiosity into a product understanding unless the visitor returns to GitHub and reads the README.

Suggested fix:

Keep the demo gallery-first, but add one low-friction product path: a footer link or unobtrusive `/about-gallerykit` page that states what GalleryKit is, who it is for/not for, what is enabled on the demo, and where to install it. Avoid a marketing hero on the actual gallery home; the product link should not degrade the photographer-facing demo.

### PMKT-C7F-02 - The strongest positioning sentence is too dense for first-contact readers

Severity: Low
Confidence: High
Status: confirmed

Evidence:

- `README.md:29` is one long paragraph containing audience, private originals, SaaS avoidance, public derivatives, color limits, operator semantic search, first-party analytics, and optional Google Analytics.
- `README.md:36-44` immediately follows with feature bullets that include highly technical proof points such as NCLX `colr`, Bradford adaptation, 4:4:4 chroma JPEG, libheif 10-bit AVIF, Base56 keys, bounded newest-first embedding scans, and Argon2 root-admin accounts.
- These claims are implementation-backed, but the first-reader hierarchy is "dense proof matrix before plain promise."

Failure scenario:

A non-specialist photographer or small studio operator who is a viable self-hosting buyer understands "private originals" and "finished-photo publishing", but bounces before reaching the crisp "For/Not for" line because the first product paragraph and feature block read like an engineering decision record. The repo is credible but less skimmable than it could be.

Suggested fix:

Keep all technical proof, but restructure the top README into:

1. One short promise sentence.
2. Three plain-language value bullets: private originals, color-honest public delivery, self-hosted admin/sharing.
3. A compact status table: default features, admin features, operator-runbook features.
4. Move the codec/color/search internals into a "Technical proof" subsection.

### PMKT-C7F-03 - 404 tab titles weaken product trust and share-link recovery

Severity: Low
Confidence: High
Status: confirmed

Evidence:

- Browser route: `https://gallery.atik.kr/en/nonexistent-topic-cycle7-lane-f`
- DOM/browser result: visible 404 shell was correct, but `document.title` stayed `ATIK.KR Gallery`.
- Source: `apps/web/src/app/[locale]/not-found.tsx:12-49` renders the not-found shell without title handling.
- Source/test gap: `apps/web/e2e/not-found-status.spec.ts:14-89` verifies status and robots but not the human-facing tab title.

Failure scenario:

GalleryKit's public sharing promise depends on clean photo/topic/group links. When a stale or mistyped share link opens, the visible page says "Page not found" but the browser tab still looks like a valid gallery. That makes support screenshots, browser history, and multi-tab recovery less trustworthy.

Suggested fix:

Share the designer fix: set a localized 404 title such as `Page not found | Atik Gallery` and add a regression test. This is a product trust issue, not only an accessibility issue.

## Final Sweep

Checked claim categories:

- Audience and positioning
- Live demo conversion path
- Finished-photo vs editing/culling/scoring/proofing/payment claims
- Private originals and public derivatives
- Color/HDR honesty and codec caveats
- Semantic search activation and production gating
- Admin team/root-account limitations
- Upload API/PAT scope claims
- Local-only storage support
- PWA/offline wording
- Privacy, analytics, GPS/map metadata, and OpenStreetMap tile disclosure
- Docker/deploy/configuration expectation setting
- Public smart collections and admin operability
- SEO/not-found/share-link trust

No source files or plans were modified. The remaining product-marketing issues are expectation-setting and conversion-path issues; the core product claims are substantially backed by code and docs.

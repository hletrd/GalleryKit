# Product Marketer Reviewer - Cycle 18

Role surface: `product-marketer-reviewer`, adapted to GalleryKit. The global BurstPick context is stale and ignored except for the product-copy/truthfulness review style.

## Inventory

Reviewed public/admin/operator copy and source proof points:

- Public docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`.
- Public product pages/messages: `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Operator/admin copy: Settings semantic-search/alt-text/HDR/backfill copy, upload-token copy, analytics copy, DB/backup/restore copy, deploy/config runbooks.
- Source truth checks: semantic search gates (`settings.ts`, `gallery-config*`, `similar-photos.tsx`, semantic/similar API routes), privacy/originals/GPS data selection, PWA service worker/manifest, storage abstraction notes, smart-collection availability, upload-token API.
- Browser evidence: live public/demo `/en`, live `/en/p/348`, live `/ko/admin`, plus local `localhost:3001` error/admin-login probes. The "Live Demo" link is reachable and returns a functioning GalleryKit deployment.

## Confirmed Issues

No confirmed product-marketing or operator-copy drift found in the current source. Previously reported risks are fixed or adequately qualified:

- Semantic-search Settings copy now says Disabled/Stub only, production is operator-runbook-only, and similar photos appears only in production mode (`apps/web/messages/en.json:767-777`, `apps/web/messages/ko.json:767-777`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:813-875`).
- Token revoke and token expiry copy now warns that UI-created tokens do not expire by default and names the token in revoke confirmation (`apps/web/messages/en.json:871-898`, `apps/web/messages/ko.json:922-949`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:307-328`).
- Analytics country copy is localized and backed by `Intl.DisplayNames` (`apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:61-72`, `:183-215`).
- README semantic-search claims are qualified as disabled by default, not Settings-enabled for production, bounded newest-first scan, and operator-runbook activation (`README.md:36-49`; `apps/web/README.md:65-91`).
- Public About copy states what GalleryKit is not: no editing, culling, scoring, proofing, payment, hosted SaaS, or bundled Lightroom Classic plugin (`apps/web/messages/en.json:827-835`, `apps/web/messages/ko.json:827-835`).
- Storage and smart-collection authoring are not marketed as supported admin features; `CLAUDE.md` explicitly says storage switching and smart-collection authoring UI are not live.

## Likely Issues

None strong enough to file. Copy that initially looked risky is source-backed with current caveats:

- PWA is described as installable with limited offline fallback, not full sync.
- Private-original and GPS claims match public-select omission and map-visible gating.
- Auto alt-text copy says EXIF-derived hints, not model-generated captions.
- HDR copy says public derivatives remain SDR until HDR delivery ships.
- Upload API copy says API endpoint only, no bundled Lightroom Classic plugin.

## Manual-Validation Risks

### PM-C18-RISK-01 - "Live Demo" can be mistaken for exact source-default behavior

Severity: Low
Confidence: Medium
Exact file/region: `README.md:21-24`

Why it matters: the link text is "Live Demo". The probed deployment is reachable and healthy, but it is also a live Atik deployment with real data/config. It may have optional production semantic search, site config, analytics, or content that differ from a fresh self-hosted install.

Concrete failure scenario: an operator evaluates GalleryKit from the demo and assumes the public dataset, semantic-search state, or Atik-specific branding represents repository defaults.

Suggested fix: rename the link to "Example deployment" or add a short note near the link: "The demo is a live GalleryKit deployment and may include deployment-specific content/config; source defaults are documented below."

### PM-C18-RISK-02 - "Photographer-grade color management" remains a subjective superlative

Severity: Low
Confidence: Medium
Exact file/region: `README.md:42-44`; qualifying context at `README.md:29`, `README.md:48`, `CLAUDE.md` Color & HDR Pipeline

Why it matters: the implementation is unusually careful and the README includes browser/codec/HDR caveats, so this is not a confirmed false claim. Still, "photographer-grade" can read like a reference-color or public-HDR guarantee.

Concrete failure scenario: a photographer expects end-to-end public HDR/reference color delivery from the headline, then learns HDR ingest is gated and public derivatives are SDR today.

Suggested fix: soften the heading to "Photographer-oriented color pipeline" or add an inline caveat in the bullet heading: "within browser/codec limits; public HDR delivery not yet shipped."

## Evidence Notes

- Local DB-backed page rendering was limited: `localhost:3001/en` returned HTTP 500 while `/api/live` was OK. This did not affect source-backed product-copy review, but it means local runtime parity was not proven.
- I did not validate production database state, deployed commit hash, CLIP weights, embedding counts, or live Atik semantic-search mode. The report avoids claiming those states.
- I did not treat historical `docs/superpowers/*` plans as current operator truth where README/CLAUDE/source supersede them.

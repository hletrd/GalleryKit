# Product Marketer Reviewer - Cycle 17

Role: `product-marketer-reviewer`
Scope: GalleryKit, a self-hosted Next.js photo gallery. The installed reviewer prompt appears BurstPick-specific; this review applies only the product-marketing, documentation-critical, claim-truthfulness perspective relevant to GalleryKit and intentionally ignores Swift/BurstPick surfaces that do not exist in this repository.

## Product/Marketing Inventory Reviewed

I built the inventory from public-facing docs, operator runbooks, localized UI copy, public pages, admin copy surfaces, and implementation files that prove or disprove feature claims.

Primary docs and operator copy:

- `AGENTS.md`: workspace rules, deploy/schema/quality gate promises, reviewer constraints.
- `CLAUDE.md`: architecture, color/HDR pipeline, PWA notes, CLIP semantic-search runbook, privacy/security notes, deferred product surfaces.
- `README.md`: public positioning, feature list, setup, deploy, self-hosted/privacy/AI/PWA/color claims, live-demo link.
- `apps/web/README.md`: app setup, env/deploy notes, semantic-search activation, upload API, auto-alt-text limits.
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`: semantic-search design baseline.
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`: historical semantic-search plan, treated as historical because current README/CLAUDE/source supersede it.

Localized copy and page surfaces:

- `apps/web/messages/en.json` and `apps/web/messages/ko.json`: public About/Privacy/Map, admin Settings, backup/restore, token, analytics, upload, search, and color/HDR strings.
- `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx`: public product-positioning page.
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`: public privacy disclosure page.
- `apps/web/src/app/[locale]/(public)/map/page.tsx` and `apps/web/src/components/map/map-client.tsx`: public map/GPS disclosure behavior.
- Public gallery/photo/share/timeline/smart-collection route inventory under `apps/web/src/app/[locale]/(public)/`.

Admin/operator UI surfaces:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` and `apps/web/src/app/actions/settings.ts`: settings copy and server-side constraints.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/app/actions/lr-tokens.ts`, and `apps/web/src/app/api/admin/lr/upload/route.ts`: upload-token/API copy and behavior.
- Admin analytics, DB backup/restore, SEO, users, dashboard, categories, tags, sharing, and upload manager surfaces under `apps/web/src/app/[locale]/admin/(protected)/` and `apps/web/src/components/`.

Source used to back or challenge claims:

- Semantic search: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`.
- Privacy/originals/GPS/analytics: `apps/web/src/lib/data.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`.
- PWA/offline: `apps/web/src/app/manifest.ts`, `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/components/register-service-worker.tsx`.
- Storage/deploy/config: `apps/web/src/site-config.example.json`, `apps/web/src/lib/storage/*`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx.conf`, deploy scripts, package manifests.

Overall verdict: GalleryKit's current public positioning is mostly careful and source-backed. Several cycle-16 risks have been addressed: token expiry copy now says UI-created tokens do not expire by default, site-config reuse is warned about in both READMEs, and semantic-search runbooks now clearly explain production gating, model seeding, no vector index, and offline runtime inference. The remaining issues are low-severity operator-copy clarity gaps rather than false headline claims.

## Confirmed Issues

### 1. Semantic-search Settings copy still uses "Enable" language for a panel that cannot enable production search

Severity: Low
Confidence: High

Files/regions:

- `apps/web/messages/en.json:767-770`
- `apps/web/messages/ko.json:767-770`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:813-875`
- `apps/web/src/app/actions/settings.ts:96-104`
- `apps/web/src/lib/gallery-config-shared.ts:223-228`
- Correct operator contrast: `apps/web/README.md:78-89`, `CLAUDE.md:602-611`

Why this is a problem:

The admin Settings copy now includes important qualifications, but it still starts with "Enable CLIP-based semantic image search" and labels the control "Enable Semantic Search." The implementation intentionally prevents this UI from enabling production: the server action rejects `semantic_search_mode='production'`, the select renders only Disabled/Stub as writable choices, and the resolver heals an unauthorized stored production value back to disabled unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.

That means the first verb on the admin surface still suggests a capability activation flow, while the real UI is only a disable/stub wiring-test panel. The surrounding copy reduces the risk, but the first-scan message remains misleading for operators skimming Settings.

Concrete failure scenario:

An operator opens Settings, reads the "Enable Semantic Search" label, selects Stub, and expects the public semantic-search feature to be live. Visitors can see the semantic-search toggle, but stub embeddings are deterministic placeholders and not meaningful CLIP ranking. If the operator expects "similar photos" as part of semantic search, that feature remains hidden because it is production-only.

Suggested fix:

Rename the Settings surface to avoid activation language:

- Change `semanticSearchDesc` to lead with "Configure semantic-search visibility and stub wiring tests."
- Change `semanticSearchEnabled` / help copy to "Show semantic-search toggle in Stub mode" or remove "Enable" entirely.
- Add a first-line warning that "Production CLIP search is operator-runbook-only and cannot be enabled from this panel."
- Mirror the English and Korean copy.

### 2. Similar-photos availability is not explained where operators configure semantic search

Severity: Low
Confidence: High

Files/regions:

- Product promise: `README.md:48`, `apps/web/README.md:67-70`
- Public About copy: `apps/web/messages/en.json:827-835`, `apps/web/messages/ko.json:827-835`
- Settings surface: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:813-875`
- Production-only implementation: `apps/web/src/components/similar-photos.tsx:138-141`
- API gate: `apps/web/src/app/api/search/similar/[id]/route.ts:115-130`

Why this is a problem:

The README and About page correctly present similar photos as part of the operator-controlled semantic-search feature set. The actual implementation is stricter than the visible Settings copy: similar photos renders nothing unless `semanticSearchMode === 'production'`, and the API returns 503 outside production. The Settings panel explains Stub vs Production for search, but does not explicitly tell operators that Stub mode only exercises text-search wiring and will never expose similar-photo recommendations.

Concrete failure scenario:

An admin enables Stub mode to test semantic search on a gallery, then visits a photo detail page expecting a similar-photo module because the product copy says semantic search includes "similar photos." Nothing appears, and the admin cannot distinguish "feature intentionally production-only" from "bug, missing embeddings, hidden UI, or bad category/photo data."

Suggested fix:

Add one operator-facing sentence to `settings.semanticSearchEnabledHint` or the Settings card body:

"Similar photos appears only in production semantic-search mode; Stub mode only tests text-search wiring and does not show image-to-image recommendations."

Update both `en.json` and `ko.json`.

## Likely Issues

No additional likely product-claim issues were strong enough to report after source verification. Claims that initially looked risky are currently backed by code and/or explicit caveats:

- Private originals: public upload serving allows only `jpeg`, `webp`, and `avif` directories (`apps/web/src/lib/serve-upload.ts:15`, `apps/web/src/lib/serve-upload.ts:172-175`), while legacy public originals trigger warnings/errors (`apps/web/src/lib/upload-paths.ts:173-201`).
- Public GPS privacy: public selects omit GPS by default and the map path is explicitly gated by `topics.map_visible=true` (`apps/web/src/lib/data.ts:368-487`, `apps/web/src/lib/data.ts:1777-1815`).
- Analytics/privacy copy: local analytics stores event metadata asynchronously and discloses rate-limit IP buckets (`apps/web/messages/en.json:837-847`, `apps/web/src/app/actions/public.ts:437-557`).
- PWA copy: installability and limited offline behavior are backed by the manifest and service worker, with admin/share/smart-collection/map exclusions documented in code (`apps/web/src/app/manifest.ts:6-52`, `apps/web/public/sw.template.js:43-63`, `CLAUDE.md:453-460`).
- Upload API copy: the token UI now says generated tokens do not expire by default (`apps/web/messages/en.json:871-884`, `apps/web/messages/ko.json:921-934`), and the API route states no bundled Lightroom Classic plugin is shipped.
- Payment/pricing position: docs say GalleryKit is not a payment system, and CLAUDE explicitly records paid downloads/Stripe as removed and not to re-add (`README.md:31-32`, `CLAUDE.md:648-650`).
- Storage backend scope: the storage abstraction states it is not wired into the live image pipeline, and I found no current public docs claiming S3/MinIO support (`apps/web/src/lib/storage/index.ts:5-17`, `apps/web/src/lib/storage/types.ts:4-14`).

## Risks Needing Manual Validation

### A. "Photographer-grade color management" is source-backed but still a subjective superlative

Severity: Low
Confidence: Medium

Files/regions:

- `README.md:42-44`
- Qualifying premise: `README.md:29`, `CLAUDE.md:302-335`
- HDR limitation copy: `apps/web/messages/en.json:780-785`, `apps/web/messages/ko.json:780-785`

Why this is a risk:

The implementation has unusually detailed color/HDR handling, and the README does qualify delivery "within browser and codec limits." Still, the feature heading "Photographer-grade color management" is a marketing superlative that can be read as a professional/reference color guarantee. The detailed docs also say HDR ingest is accepted only behind admin opt-in and public derivatives are still delivered as SDR.

Concrete failure scenario:

A photographer evaluating GalleryKit for HDR or reference-grade color delivery reads the feature heading, uploads HDR/P3 files, and expects end-to-end public HDR reproduction. The app may preserve important metadata and gamut decisions, but public HDR delivery is intentionally not promised yet; HDR signals are admin-audit-only until the encoder path ships.

Suggested fix:

Use a less absolute heading such as "Photographer-oriented color pipeline" or "Color-aware derivative pipeline," and keep the current detailed explanation below it. If the current headline is retained, add a short parenthetical immediately in the heading line: "within browser/codec limits; HDR public delivery not yet shipped."

### B. The Live Demo link is reachable, but repo parity was not validated

Severity: Low
Confidence: Medium

Files/regions:

- `README.md:21-24`

Why this is a risk:

The README labels `https://gallery.atik.kr` as a "Live Demo." I verified only that the URL redirects to `/en` and returns HTTP 200 on 2026-07-08 KST. I did not run a browser parity audit against the current repository HEAD, check deployed version/commit, or verify whether production-only features such as CLIP semantic search are enabled there.

Concrete failure scenario:

A prospective operator treats the demo as an exact representation of the current open-source default experience, but the deployed site may use Atik-specific content, production config, optional Google Analytics, different semantic-search state, or a newer/older deploy than the current checkout.

Suggested fix:

Rename the link to "Example deployment" or add a short README note: "The demo is a live GalleryKit deployment and may include deployment-specific data/configuration; source defaults are documented below."

## Final Missed-Issues Sweep

Final sweep performed:

- Searched docs/source/copy for product-claim terms including `semantic`, `CLIP`, `Lightroom`, `plugin`, `PWA`, `offline`, `AI`, `privacy`, `analytics`, `proofing`, `payment`, `SaaS`, `hosted`, `map`, `GPS`, `HDR`, `originals`, `collections`, `storage`, `Stripe`, and related operator language.
- Enumerated public routes, admin routes, API routes, component copy surfaces, message files, and docs under `docs/`.
- Cross-checked README and public About/Privacy claims against source for semantic search, similar photos, PWA, upload tokens/API, privacy/originals/GPS, local/Google analytics, payments, smart collections, storage backend, Docker/runtime data handling, and site config.
- Checked the external demo only with an HTTP HEAD/redirect request, not a full browser/content audit.

Skipped or bounded:

- I did not run the web app, Playwright, lint, typecheck, or the full test suite because the requested output is a read-only product/documentation review and no code changes were made.
- I did not validate live production database state, deployed commit hash, CLIP model files, embeddings, or the Atik deployment's runtime semantic-search mode.
- I did not exhaustively read other `.context/reviews/*` files as product source of truth; they are review artifacts, not user/operator-facing product claims.

# Product Marketer Review - Cycle 16

Date: 2026-06-30
Reviewer lane: product-marketer-reviewer
Scope: current HEAD `fc041738`, GalleryKit repo only. Adapted the local product-marketer prompt to GalleryKit's self-hosted gallery/operator-docs context, not BurstPick.

## Executive Summary

I found 5 product-copy / positioning issues: 3 confirmed and 2 likely. The biggest issue is still self-hosting identity drift: the tracked runtime config and nginx template carry the live demo domain, and the production guard accepts that as a valid non-placeholder site identity. Most feature claims are unusually well qualified, especially semantic search, color/HDR, backups, storage, and admin privileges. The remaining risks are expectation-setting failures: upload capacity copy that ignores the bundled reverse proxy cap, Lightroom-language that can imply a client integration that is not shipped, and a couple of broad marketing phrases that need proof or tighter wording.

## Inventory Reviewed

- Public docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`
- Runtime/default config and deploy docs: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/nginx/default.conf`, `apps/web/src/lib/constants.ts`
- Public pages and metadata: layout, sitemap, robots, feed, privacy page, map page, OG/search routes
- Admin UI/message copy: `apps/web/messages/en.json`, key Korean mirrors, settings, database, upload, users, analytics, SEO, tokens
- Code-backed claims: semantic search/similar photos, CLIP model loading, upload limits, Lightroom-style PAT route, color/HDR rendering, GPS/privacy field selection, storage quarantine, backup/restore scope, PWA/offline cache references

## Confirmed Issues

### PMR16-01 - Demo domain can become a self-hosted operator's production identity

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- `README.md:8` positions the app as self-hosted, and `README.md:148` says production builds need `BASE_URL` or a non-placeholder `site-config.json` URL.
- `apps/web/src/site-config.json:4` is tracked with `"url": "https://gallery.atik.kr"`; the example file uses the rejected placeholder `https://example.com` at `apps/web/src/site-config.example.json:4`.
- `apps/web/scripts/ensure-site-config.mjs:14-21` rejects placeholder hosts, but `gallery.atik.kr` is not in that set.
- `apps/web/src/lib/constants.ts:21-24`, `apps/web/src/app/sitemap.ts:18`, and `apps/web/src/app/robots.ts:24` publish the effective base URL into canonical/sitemap/robots surfaces.
- `apps/web/nginx/default.conf:21-24` also ships `server_name gallery.atik.kr`.

Failure scenario:
A new self-hosting operator builds without setting `BASE_URL` because the repo already contains `src/site-config.json`. The guard passes, but their production metadata, sitemap, robots entry, OG fallbacks, feed links, and nginx virtual-host name can point at the GalleryKit demo domain. That breaks the core self-hosted promise and creates SEO/social-preview confusion that is hard to diagnose after launch.

Suggested fix:
Do not track a real demo-domain runtime config. Track only the example, or make the tracked runtime file use a production-rejected placeholder. Add `gallery.atik.kr` to a forbidden demo-host list in `ensure-site-config.mjs`, with an explicit deploy-only escape hatch for the demo environment. Change the nginx template `server_name` to `_` or `example.com` with a required customization note.

### PMR16-02 - Upload UI advertises a 2 GB window, but the bundled nginx path accepts about one 200 MiB file per request

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- The app-level defaults are 2 GiB total per upload window and 200 MiB per file in `apps/web/src/lib/upload-limits.ts:1-5` and `apps/web/src/lib/upload-limits.ts:19-21`.
- The admin dashboard passes those app-level values directly to the dropzone in `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:41`.
- The UI copy says "Up to {maxFiles} files, {maxFileSize} per file, and {maxSize} per upload window" in `apps/web/messages/en.json:157-158`, and the client enforces only those values in `apps/web/src/components/upload-dropzone.tsx:143-178`.
- The shipped nginx config caps `/admin/dashboard` and `/api/admin/lr/upload` at 216 MiB in `apps/web/nginx/default.conf:90-94` and `apps/web/nginx/default.conf:123-134`.
- The docs mention both facts, but still lead with "2 GiB total per upload window" at `README.md:151` and `apps/web/README.md:48`.

Failure scenario:
An admin selects two 150 MiB JPEG exports. The UI accepts them because the app-level total is below 2 GiB and each file is below 200 MiB. In the documented nginx deployment, the multipart request is roughly 300 MiB and is rejected at the proxy before the app can return the localized upload-limit copy. The first-run product experience looks broken even though each individual layer is behaving as coded.

Suggested fix:
Expose a "max files per request under bundled nginx" copy path, or change the dropzone/server action to upload one file per request so the 2 GiB window is actually reachable through repeated 216 MiB requests. At minimum, change docs and UI help to say: "Bundled nginx accepts one 200 MiB file plus multipart overhead per request; the 2 GiB value is a rolling app quota, not a single batch size."

### PMR16-03 - Lightroom wording still implies a client integration in places where only a server API ships

Severity: Low
Confidence: High
Status: Confirmed

Evidence:
- The best public README wording is already clear: `README.md:40` says the admin dashboard has a PAT-authenticated upload API and no Lightroom Classic plugin is bundled.
- Admin token copy is also clear at `apps/web/messages/en.json:808-810`.
- But the operator docs still frame the route as "Lightroom publishes" in `README.md:151` and `apps/web/README.md:48`.
- The route itself is generic multipart upload with a PAT header, while its file header says "including a Lightroom Classic publish-client implementation" and "does not bundle or distribute a Lightroom plugin" at `apps/web/src/app/api/admin/lr/upload/route.ts:1-19`.
- The token UI only creates `lr:upload` tokens in `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`, even though the token type has forward-looking `lr:read` and `lr:delete` scopes in `apps/web/src/lib/admin-tokens.ts:24-25`.

Failure scenario:
A photographer/operator reads "Lightroom publishes" and expects a ready Lightroom Classic publish plugin or a documented Lightroom setup flow. They instead get a scoped token plus a server endpoint and must bring their own client. The implementation is useful, but the channel-specific wording creates avoidable disappointment.

Suggested fix:
Standardize public/operator wording on "external upload clients" or "PAT-authenticated upload API." Mention Lightroom only as "compatible with a separately supplied Lightroom Classic publish client; no plugin is bundled." If a plugin exists outside this repo, link it and state support boundaries.

## Likely Issues

### PMR16-04 - "High-performance" is plausible but under-proven in product-facing copy

Severity: Low
Confidence: Medium
Status: Likely

Evidence:
- The hero copy says "A high-performance, self-hosted photo gallery" at `README.md:8`; `CLAUDE.md:5` repeats the phrase.
- The implementation has real performance work: masonry layout, bounded caches, route caps, and image optimization are documented in `CLAUDE.md:398-411`.
- It also has important constraints: single web-instance/single-writer deployment and process-local rate/queue state in `CLAUDE.md:228`; semantic search scans newest embeddings instead of a vector index per `README.md:37` and `apps/web/README.md:58-66`.

Failure scenario:
A technical evaluator treats "high-performance" as a benchmark claim and asks how many photos, concurrent visitors, upload jobs, or semantic-search embeddings the default deployment supports. The docs answer with architecture caveats but no simple benchmark or sizing envelope, so the headline feels like positioning without proof.

Suggested fix:
Either add a small benchmark/sizing section ("tested on N photos, N derivatives, N concurrent visitors, host spec") or soften the phrase to "optimized self-hosted photo gallery." Keep the caveats close to the claim: single-writer by default, newest-first semantic scan, and proxy/upload caps.

### PMR16-05 - "HDR-capable" badge can be read as HDR delivery before the SDR caveat is seen

Severity: Low
Confidence: Medium
Status: Likely

Evidence:
- The localized badge label is `HDR-capable` at `apps/web/messages/en.json:366`, with the clearer SDR caveat in `apps/web/messages/en.json:367-368`.
- The color details section renders the badge and SDR caveat together in `apps/web/src/components/color-details-section.tsx:548-558`.
- HDR ingest is rejected by default and accepted HDR is still delivered as SDR in the browser/upload copy: `apps/web/messages/en.json:162`, `apps/web/messages/en.json:739-740`, and `apps/web/src/app/actions/images.ts:353-365`.
- Public viewers do not see admin-only HDR fields because `is_hdr` and `transfer_function` are omitted from public selects in `apps/web/src/lib/data.ts:375-404`.

Failure scenario:
An admin reviewing an HDR upload sees or screenshots an "HDR-capable" pill and interprets it as an output capability, especially in compact contexts. The detailed row says SDR delivery, but the first label is stronger than the current delivery pipeline.

Suggested fix:
Rename the badge to "HDR source" or "HDR source - SDR delivery" and keep `hdrDeliveredAsSdr` as the explanatory row. That preserves the honest audit signal without suggesting the served bytes are HDR.

## Positive Claim Checks

- Semantic search copy matches the implementation posture: disabled by default, stub mode is non-meaningful, production is env/DB/weights gated, text search scans bounded newest embeddings, and similar photos is production-only (`README.md:37`, `apps/web/README.md:58-76`, `apps/web/src/app/api/search/semantic/route.ts:168-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:97-176`).
- The semantic-search admin UI truthfully exposes only Disabled/Stub and documents the production escape hatch (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:637-685`, `apps/web/messages/en.json:730-736`).
- Auto alt-text copy is honest that Florence-2/model captions are not implemented; the code only generates EXIF-derived stubs (`apps/web/messages/en.json:725-728`, `apps/web/src/lib/caption-generator.ts:1-16`, `apps/web/src/lib/caption-generator.ts:52-62`).
- Backup/restore copy correctly says database rows only, not originals/derivatives/resources (`apps/web/messages/en.json:18-24`, `apps/web/README.md:52`, `README.md:157`).
- Storage marketing is restrained: `CLAUDE.md:142` explicitly says local filesystem only and not to expose S3/MinIO as supported while the storage abstraction is quarantined (`apps/web/src/lib/storage/local.ts:1-6`, `apps/web/src/__tests__/storage-quarantine.test.ts:111-132`).
- Privacy copy is broadly aligned: standard public fields omit GPS, and only the explicit map-visible route exposes coordinates (`apps/web/src/lib/data.ts:368-445`, `apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-29`, `apps/web/src/app/[locale]/(public)/map/page.tsx:38-50`).

## Manual-Validation Risks

- The README says semantic search is live on the demo at `README.md:37`; I verified the code path and docs but did not live-test `https://gallery.atik.kr` in a browser.
- I did not run social validators for OG/Twitter cards, so canonical/preview effects of `site-config.json` were source-verified only.
- I did not run a real proxy upload through nginx; PMR16-02 is based on app and nginx source contracts.
- I did not install the PWA or test offline behavior. The README's "visited image caching and offline HTML fallback" wording appears source-backed, but browser behavior remains manual-validation territory.
- Korean copy was searched for parity, but I did not perform a full native-language marketing review.

## Final Missed-Issues Sweep

I re-swept claim-bearing surfaces with searches for: `GalleryKit`, `self-hosted`, `demo`, `BASE_URL`, `siteConfig.url`, `canonical`, `sitemap`, `robots`, `feed`, `OG`, `analytics`, `referrer`, `semantic`, `AI`, `CLIP`, `PWA`, `offline`, `Lightroom`, `plugin`, `publish`, `upload`, `2 GiB`, `216M`, `HDR`, `P3`, `color`, `GPS`, `privacy`, `backup`, `restore`, `S3`, `MinIO`, `role`, `permission`, `not implemented`, `disabled`, and `production`.

No additional source-backed product-copy mismatches were found beyond the five findings above. I left existing dirty review-lane files untouched and updated only this cycle-16 product-marketer artifact.

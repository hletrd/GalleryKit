# Cycle 96 Product/Marketing Review — Review-only

Repository: `/tmp/gallery-recovery-check`
Lane: product-marketer-reviewer
Mode: review-only; no repo files modified.

## Public-facing inventory reviewed

- **Public routes:** home, topics, photo detail, collection/share pages, timeline/year, map, privacy, feeds, upload APIs under `apps/web/src/app/[locale]/(public)/`.
- **Public UX components:** nav, footer, home gallery, search, photo viewer, color details, similar photos, map client.
- **Admin journeys:** dashboard, upload, settings, SEO, DB backup/restore, users, Lightroom tokens, categories/topic GPS controls, analytics.
- **Content/config/docs:** `README.md`, `CLAUDE.md`, `.env*.example`, `site-config*.json`, `messages/en.json`, `messages/ko.json`, nginx/docker deploy files.
- **Trust/privacy/data paths:** public data selectors, CSP, proxy, upload processing, analytics actions, schema.

## Executive summary

I found **5 user/operator-impacting issues**:
- **3 confirmed product/docs/content mismatches**
- **2 likely/manual-validation risks** where source evidence shows drift, but exact runtime behavior or product intent should be validated.

---

## Findings

### PM-96-01 — Privacy page omits third-party OpenStreetMap tile disclosure

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High

**Evidence**

Public `/map` renders map markers and a map client:

- `apps/web/src/app/[locale]/(public)/map/page.tsx:50-66`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:68-92`

The map client loads third-party OpenStreetMap tiles:

- `apps/web/src/components/map/map-client.tsx:115-118`

CSP explicitly allows OSM tile hosts:

- `apps/web/src/lib/content-security-policy.ts:62-66`
- `apps/web/src/lib/content-security-policy.ts:80-82`

Privacy page only covers analytics and photo metadata/GPS policy, not map tile providers:

- `apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-29`
- `apps/web/messages/en.json:816-824`
- `apps/web/messages/ko.json:816-824`

**Failure scenario**

A privacy-sensitive visitor opens `/map`. Their browser contacts OpenStreetMap tile servers, exposing IP/user-agent/referrer and approximate viewed map tile areas to a third party. The privacy page emphasizes optional Google Analytics and self-hosted local analytics, so visitors/operators may reasonably infer no third-party map provider is contacted.

**Suggested fix**

Add an explicit “Map tiles” disclosure to English and Korean privacy copy. State that `/map` loads OpenStreetMap tiles and that OSM may receive request/device information. If stronger privacy is desired, self-host/proxy tiles or make map loading opt-in.

---

### PM-96-02 — Admin says GPS is published to a public map, but the map is not discoverable in public navigation

- **Status:** Likely/manual-validation risk
- **Severity:** Low–Medium
- **Confidence:** High for source evidence; Medium for intended product behavior

**Evidence**

Admin category controls expose a “Publish GPS on public map” setting:

- `apps/web/messages/en.json:109-115`
- `apps/web/src/components/admin/topic-manager.tsx:268-274`
- `apps/web/src/components/admin/topic-manager.tsx:290-318`
- `apps/web/src/app/actions/topics.ts:605-630`

The public map route exists:

- `apps/web/src/app/[locale]/(public)/map/page.tsx:16-31`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:68-92`

Public nav links topics/search/theme/locale, but not `/map`:

- `apps/web/src/components/nav-client.tsx:136-190`

Footer links Privacy/GitHub/Admin, but not `/map`:

- `apps/web/src/components/footer.tsx:41-58`

**Failure scenario**

An operator enables GPS publishing expecting visitors to find a map view, but normal public navigation gives no path to it. If the map is intentionally unlisted for safety, the admin label “public map” does not explain that it is public-but-unlisted.

**Suggested fix**

Either add a localized “Map” link when public map markers exist, or revise admin copy to say “unlisted public map at `/map`” and document how operators should share it.

---

### PM-96-03 — Shipped nginx template hardcodes the demo domain

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High

**Evidence**

The nginx config hardcodes a real demo domain:

- `apps/web/nginx/default.conf:21-23`

Docker/deploy docs instruct operators to use the app/nginx setup but do not call out replacing `server_name`:

- `README.md:187-205`
- `README.md:198-205`
- `README.md:162-168`

Operational docs emphasize `site-config` and deployment settings, but not nginx virtual-host replacement:

- `CLAUDE.md:663-673`

**Failure scenario**

A self-hosting operator copies the template for `photos.example.com`. nginx may not match their host as intended, or may serve the gallery under the wrong virtual host/default-server behavior. This can cause failed routing, TLS/HSTS confusion, or accidental exposure under unintended hostnames.

**Suggested fix**

Change the template to `server_name _;` or `server_name example.com;` with an obvious “replace this” comment. Add a Docker deployment checklist item: update nginx `server_name`/TLS vhost for your domain.

---

### PM-96-04 — i18n promise overstates localized SEO/brand content

- **Status:** Confirmed limitation / product-content mismatch
- **Severity:** Low–Medium
- **Confidence:** High

**Evidence**

README markets English/Korean internationalization:

- `README.md:47`

SEO settings are single global fields, not per-locale:

- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:16-23`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:95-132`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:148-158`

Data layer returns one global SEO record:

- `apps/web/src/lib/data.ts:1770-1780`
- `apps/web/src/lib/data.ts:1793-1801`

Root layout applies the same title/description to all locales:

- `apps/web/src/app/[locale]/layout.tsx:22-58`
- `apps/web/src/app/[locale]/layout.tsx:101-102`

Footer uses one global `siteConfig.footer_text`:

- `apps/web/src/components/footer.tsx:35-37`
- `apps/web/src/site-config.json:8-10`

**Failure scenario**

A Korean visitor may see Korean UI chrome but English/global SEO, footer, social previews, and branding. If the operator sets Korean SEO copy, English routes inherit Korean copy. This weakens trust and search/social conversion for one audience.

**Suggested fix**

Either document the limitation clearly: “UI chrome is localized; SEO/branding/footer text are global,” or add per-locale SEO/footer settings and route-aware metadata lookup.

---

### PM-96-05 — Browser upload accept list omits formats the backend/docs support

- **Status:** Confirmed source drift; manual browser validation recommended
- **Severity:** Medium
- **Confidence:** Medium–High

**Evidence**

Backend accepts HEIC, HEIF, BMP, and other formats:

- `apps/web/src/lib/process-image.ts:399-401`

Client dropzone accept extensions omit `.heic`, `.heif`, and `.bmp`:

- `apps/web/src/components/upload-dropzone.tsx:201-203`
- `apps/web/src/components/upload-dropzone.tsx:217-221`

Server-side upload path processes originals and HDR/color metadata:

- `apps/web/src/app/actions/images.ts:370-397`

Docs position Apple HDR/gain-map/HEIF handling as a product capability:

- `README.md:38`
- `CLAUDE.md:133`
- `CLAUDE.md:302`

**Failure scenario**

A photographer uploads an iPhone `.HEIC`/`.HEIF` original expecting HDR/gain-map handling. The browser dropzone may reject the file before it reaches the backend, despite server support and product docs. The user gets an upload rejection instead of the documented color/HDR workflow.

**Suggested fix**

Align the client accept list with backend-supported extensions, especially `.heic`, `.heif`, and `.bmp`, or narrow docs/backend support claims to formats accepted by browser upload. Add localized “accepted formats” copy near the dropzone.

---

## Positive checks / non-findings

- Semantic search is honestly framed as optional/operator-gated, with disabled-state UX and admin setup guidance.
- GPS retention risk is surfaced in upload/admin copy, and public selectors appear intentionally privacy-filtered.
- DB backup/restore and root-admin limitations are described with stronger-than-average operator warnings.
- Lightroom token UI warns about one-time display and no-expiry defaults.

## Final sweep

Performed source-grounded sweeps for:

- Public navigation/footer discoverability
- Privacy page vs CSP/external network surfaces
- GPS/map publishing journey
- Admin upload messaging vs backend accepted formats
- SEO/i18n settings and route metadata
- Docker/nginx operational docs
- Analytics/privacy claims
- Semantic search trust messaging

## Skipped / limitations

- Did not run the app or browser flows; runtime browser behavior for upload accept lists should be manually validated.
- Did not audit historical `.context` review archives exhaustively.
- Did not verify deployed production/demo behavior.
- Did not run tests/build because this was review-only and no code changes were made.
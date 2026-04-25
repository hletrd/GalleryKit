# Product Marketer Reviewer — PROMPT 1 Cycle 5

Repo: `/Users/hletrd/flash-shared/gallery`
Lane: `product-marketer-reviewer`
Review date: 2026-04-25 (Asia/Seoul)
Scope: product-facing copy, docs/onboarding, admin/public user flows, metadata/SEO, i18n, discoverability, and promise-vs-implementation mismatches. No implementation or commits performed.

## Inventory reviewed

- Product docs/onboarding/config: `README.md`, `CLAUDE.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`.
- Localized copy/i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`; verified both locale files contain 517 leaf keys with no missing keys in either direction.
- Public routes/flows: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, public layout, upload route, and supporting components (`Nav`, `Footer`, `HomeClient`, `Search`, `TagFilter`, `PhotoViewer`, `InfoBottomSheet`).
- Admin routes/flows: login, dashboard/upload, image manager, categories, tags, SEO, settings, password, users, DB backup/restore, and shared admin components (`AdminHeader`, `AdminNav`, `AdminUserManager`, `UploadDropzone`, `ImageManager`).
- Metadata/discoverability: localized root metadata, photo/topic/share metadata, JSON-LD, `/api/og`, `manifest.ts`, `robots.ts`, `sitemap.ts`, `seo-og-url.ts`, SEO/admin settings actions.
- Tests/docs as user-flow specs: `apps/web/e2e/public.spec.ts`, `admin.spec.ts`, `nav-visual-check.spec.ts`, `origin-guard.spec.ts`, `test-fixes.spec.ts`, `helpers.ts`, and SEO/settings/upload-related unit tests discovered during inspection.

## Findings summary

| ID | Severity | Confidence | Status | Finding |
| --- | --- | --- | --- | --- |
| PMR5-01 | HIGH | High | Confirmed | Production builds can ship localhost canonical/OG/sitemap URLs because the committed default config is accepted as production-valid. |
| PMR5-02 | HIGH | High | Confirmed | The “Add Admin” dialog copy understates that new users receive full root-admin powers. |
| PMR5-03 | MEDIUM | High | Confirmed | The GPS privacy switch remains interactive even though the server rejects changes once images exist. |
| PMR5-04 | MEDIUM | High | Confirmed risk | Photo metadata can emit blank-author snippets and JSON-LD when the documented example config is used as-is. |
| PMR5-05 | MEDIUM | High | Confirmed | One global, free-text OG locale setting is emitted on every localized page, making either English or Korean pages wrong. |
| PMR5-06 | LOW | High | Confirmed | Upload copy advertises only the 2GB upload-window cap, hiding the hard 200MB per-file cap until after failure. |
| PMR5-07 | LOW | High | Confirmed | `parent_url` is documented and shipped in config but is unused, creating a false customization promise. |
| PMR5-08 | MEDIUM | Medium | Risk | The shipped nginx sample contains a real demo domain and a container-root path that conflicts with the documented host-nginx deployment. |

## Detailed findings

### PMR5-01 — Production builds can ship localhost canonical/OG/sitemap URLs because the committed default config is accepted as production-valid

- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Exact file:line/code region:** `apps/web/src/site-config.json:1-11`; `apps/web/scripts/ensure-site-config.mjs:11-32`; `apps/web/src/lib/data.ts:883-890`; `apps/web/src/app/[locale]/layout.tsx:16-40`; `apps/web/src/app/sitemap.ts:10-57`; onboarding reminder at `README.md:166-175`.
- **Evidence:** The checked-in `site-config.json` uses `url: "http://localhost:3000"` and `parent_url: "http://localhost:3000"`. The production guard only rejects missing URLs, invalid URLs, and `example.com`/`www.example.com` placeholders; `localhost`, `127.0.0.1`, and private/internal hosts pass. Runtime SEO then uses `process.env.BASE_URL || siteConfig.url` for metadata, OG, and sitemap URL generation.
- **Concrete user/business failure scenario:** A self-hoster follows Docker deployment, forgets `BASE_URL`, and leaves the committed config in place. The site deploys successfully, but canonical URLs, Open Graph URLs, sitemap entries, and localized alternates point crawlers/social unfurlers at `http://localhost:3000`, causing broken previews, poor indexing, and avoidable support/debugging for a production gallery.
- **Suggested fix:** Make production/deploy builds reject loopback, `.local`, private-network, and plaintext non-development origins unless explicitly allowed. Prefer requiring `BASE_URL` in production or replacing the committed real config with a generated/gitignored file plus example. Add a build/test assertion that `NODE_ENV=production` with `site-config.url=http://localhost:3000` fails.

### PMR5-02 — The “Add Admin” dialog copy understates that new users receive full root-admin powers

- **Severity:** HIGH
- **Confidence:** High
- **Status:** Confirmed
- **Exact file:line/code region:** `apps/web/messages/en.json:43-49`; `apps/web/messages/ko.json:43-49`; `apps/web/src/components/admin-user-manager.tsx:92-99`; full admin surface listed in `apps/web/src/components/admin-nav.tsx:15-23`; product/schema note at `README.md:37` and `CLAUDE.md:157-160`.
- **Evidence:** The user-creation dialog says “Add Admin” / “Adds dashboard access.” Korean copy says “대시보드 접근 권한 부여.” The docs and schema notes clarify there is no role/capability model and every admin can upload/edit, change settings, export/restore DB backups, and manage other admins. The admin nav exposes those areas to all admins.
- **Concrete user/business failure scenario:** A gallery owner creates an account for a helper, translator, or uploader believing it grants limited dashboard access. That account can restore/overwrite the database, export private data, change SEO/settings, and manage other admins, turning a copy ambiguity into a trust and operational-risk failure.
- **Suggested fix:** Change dialog/help copy in both locales to state “Creates a full root admin with access to uploads, settings, users, and database backup/restore; roles are not supported yet.” Consider adding a confirmation step for new admins until role separation exists.

### PMR5-03 — The GPS privacy switch remains interactive even though the server rejects changes once images exist

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Exact file:line/code region:** `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:8-23`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-185`; `apps/web/src/app/actions/settings.ts:112-129`; copy at `apps/web/messages/en.json:550-570` and `apps/web/messages/ko.json:550-570`.
- **Evidence:** The settings page passes `hasExistingImages={imageCount > 0}`. Output sizes are disabled when images exist and show a locked hint, but the `strip-gps` switch remains enabled. The server action later rejects a changed `strip_gps_on_upload` value when any image exists and returns `uploadSettingsLocked`.
- **Concrete user/business failure scenario:** An admin realizes after initial uploads that GPS should not be stored. The visible privacy control appears changeable, they toggle it and save, then receive a rejection only after submission. For a privacy-sensitive setting, this feels like the product is either broken or hiding state, and it delays remediation of a location-data concern.
- **Suggested fix:** Disable the GPS switch whenever `hasExistingImages` is true and pair it with the same locked-state affordance as output sizes. If post-upload privacy changes are a supported product goal, implement and document a migration/delete-GPS workflow instead of showing an interactive but rejected switch.

### PMR5-04 — Photo metadata can emit blank-author snippets and JSON-LD when the documented example config is used as-is

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed risk
- **Exact file:line/code region:** `README.md:93-97`; `apps/web/src/site-config.example.json:1-12`; `apps/web/src/app/actions/seo.ts:35-43`; `apps/web/src/lib/data.ts:883-890`; `apps/web/messages/en.json:505-511`; `apps/web/messages/ko.json:505-511`; `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:83-105` and `138-149`; SEO admin copy at `apps/web/messages/en.json:325-329` / `ko.json:325-329`.
- **Evidence:** Quick start instructs copying `site-config.example.json` to `site-config.json`; that example leaves `author` empty. Admin SEO settings return an empty `seo_author` by default, and runtime falls back to `siteConfig.author`. Photo pages use `seo.author` in meta descriptions, OG/Twitter descriptions, `authors`, `creditText`, `creator.name`, and `copyrightNotice` when a photo has no description.
- **Concrete user/business failure scenario:** A photographer launches with the example config and does not fill in Author because the UI says leaving it empty uses the default. Public photo cards/search snippets can render awkward strings such as “View photo by  (Sunset)”, while JSON-LD contains empty creator/copyright fields. That weakens attribution, professional polish, and rich-result trust.
- **Suggested fix:** Make author either explicitly required for photo attribution or safe when blank. If blank, omit `authors`, `creditText`, `creator`, and `copyrightNotice`, and use neutral copy such as “View photo {title}.” Alternatively, fall back to site title/owner and make the example author a clear placeholder that production validation rejects until changed.

### PMR5-05 — One global, free-text OG locale setting is emitted on every localized page, making either English or Korean pages wrong

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Exact file:line/code region:** SEO setting key at `apps/web/src/lib/gallery-config-shared.ts:25-31`; default locale at `apps/web/src/site-config.json:6` and `apps/web/src/site-config.example.json:6`; global metadata at `apps/web/src/app/[locale]/layout.tsx:16-40`; admin UI at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:144-153`; validation at `apps/web/src/app/actions/seo.ts:91-93`; copy at `apps/web/messages/en.json:328-329` and `apps/web/messages/ko.json:328-329`.
- **Evidence:** The app has localized `/en` and `/ko` routes, but root metadata ignores route params and emits one `seo.locale` value for every localized page. The admin field is free text, with only a max-length check, so invalid values such as `ko-KR` or `Korean` can be saved and emitted. If the admin changes the global setting to `ko_KR`, English pages become wrong; if left at default `en_US`, Korean pages are wrong.
- **Concrete user/business failure scenario:** Korean pages shared into Kakao/Facebook/Open Graph consumers declare `og:locale=en_US`, or English pages declare `ko_KR` after a Korean-focused admin change. Social platforms and crawlers receive inconsistent language signals, hurting localized preview quality and discoverability.
- **Suggested fix:** Derive Open Graph locale from the current route locale (`en -> en_US`, `ko -> ko_KR`) and keep `alternateLocale` route-aware. If admins need customization, expose a validated per-locale mapping/dropdown rather than one global free-text field.

### PMR5-06 — Upload copy advertises only the 2GB upload-window cap, hiding the hard 200MB per-file cap until after failure

- **Severity:** LOW
- **Confidence:** High
- **Status:** Confirmed
- **Exact file:line/code region:** Visible upload hint at `apps/web/src/components/upload-dropzone.tsx:344-358`; localized copy at `apps/web/messages/en.json:141-148` and `apps/web/messages/ko.json:141-148`; exposed upload-window limits at `apps/web/src/lib/upload-limits.ts:1-24`; hidden hard cap at `apps/web/src/lib/process-image.ts:39-43` and `224-227`; generic all-failed response at `apps/web/src/app/actions/images.ts:317-330` plus `apps/web/messages/en.json:401-405` / `ko.json:401-405`.
- **Evidence:** The dropzone tells admins “Up to 100 files and 2GB per upload window.” The client-facing upload limits module exposes total/window caps only. Actual processing rejects any single file larger than 200MB, then the action suppresses the specific error and returns the generic “All uploads failed” if no file succeeds.
- **Concrete user/business failure scenario:** A photographer with a 300MB TIFF/RAW-adjacent image sees the 2GB window promise, selects the file, waits for upload/processing, and receives a generic failure. The product appears unreliable and the admin cannot tell whether compression, format, network, or size caused the failure.
- **Suggested fix:** Export the per-file cap as a shared constant, pass it to the dropzone as `maxSize`, and update copy to “up to 200MB per file, 2GB total per upload window.” Preserve and localize per-file rejection reasons where safe.

### PMR5-07 — `parent_url` is documented and shipped in config but is unused, creating a false customization promise

- **Severity:** LOW
- **Confidence:** High
- **Status:** Confirmed
- **Exact file:line/code region:** `README.md:43-57`; `apps/web/src/site-config.json:1-11`; `apps/web/src/site-config.example.json:1-12`; repository-wide search only finds `parent_url` in those docs/config files.
- **Evidence:** Product configuration documentation lists `parent_url` alongside visible settings like title, description, URL, nav title, footer text, and analytics ID. The field is also present in shipped config files, but no application source reads it.
- **Concrete user/business failure scenario:** A site owner configures `parent_url` expecting a backlink, canonical parent, portfolio-home link, or licensing page relationship. Nothing changes in the UI or metadata, so onboarding teaches a setting that does not exist as product behavior.
- **Suggested fix:** Remove `parent_url` from the documented/shipped config until it has a supported purpose, or wire it to a named product feature with explicit copy (for example “portfolio home URL” or “license page URL”) and tests.

### PMR5-08 — The shipped nginx sample contains a real demo domain and a container-root path that conflicts with the documented host-nginx deployment

- **Severity:** MEDIUM
- **Confidence:** Medium
- **Status:** Risk
- **Exact file:line/code region:** Docker/host-nginx guidance at `README.md:142-145` and `README.md:164-175`; host-network comments/volumes at `apps/web/docker-compose.yml:13-25`; sample nginx config at `apps/web/nginx/default.conf:12-20` and `93-99`; deploy output at `apps/web/deploy.sh:27-34`.
- **Evidence:** The README and Compose comments describe a Linux host-network app with nginx running on the host. The shipped nginx sample hard-codes `server_name gallery.atik.kr` and serves processed uploads from `root /app/apps/web/public`, a path that exists in the container mount but not necessarily on the host. The deploy script only says the app is at localhost and data is under `apps/web/data`/`apps/web/public`.
- **Concrete user/business failure scenario:** A self-hoster copies the included nginx config as the obvious production reverse-proxy template. Their domain does not match `gallery.atik.kr`, and direct upload serving may 404 because the host nginx cannot find `/app/apps/web/public`. The first production deployment looks broken even though the app container is healthy.
- **Suggested fix:** Turn `default.conf` into a template with placeholders (`YOUR_DOMAIN`, absolute host path to `apps/web/public`) and add replacement instructions to Docker deployment docs, or ship a containerized nginx service whose paths match the compose mounts. The deploy script should warn that the nginx file is not copy-paste-ready until customized.

## Final missed-issues sweep

- Revalidated the Cycle 4 product findings before carrying anything forward. The CC BY-NC JSON-LD license, global OG override for photo/share pages, `/api/og` static branding, robots share-route disallow, broad OG URL hint, and visible processing-concurrency promise are no longer open in the same form, so they are not repeated as Cycle 5 findings.
- Searched for locale-copy drift and verified `en.json`/`ko.json` key parity: 517 leaf keys each, no missing keys.
- Searched product promises around `parent_url`, `seo_locale`, upload limits, GPS stripping, admin roles, sitemap/metadata, manifest, share/photo/topic metadata, and deployment/nginx docs.
- Reviewed existing test coverage as product-flow documentation; no tests were run because this was a read-only markdown review and no code behavior was changed.
- No implementation, dependency changes, commits, or pushes were performed.

## Files reviewed

- `README.md`
- `CLAUDE.md`
- `apps/web/README.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/deploy.sh`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/helpers.ts`

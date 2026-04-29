# Product Marketing / Content / SEO Review — Cycle 3 Prompt 1

Reviewer: product-marketer-reviewer
Date: 2026-04-29
Scope: README/docs, deployment/onboarding copy, public UI copy, SEO metadata/social cards, i18n consistency, admin copy, empty/error states, and product promise vs. implementation.

## Method and inventory

I inventoried the repo first, then reviewed all files that can shape product messaging, conversion, SEO, social previews, localization, onboarding, deployment, empty/error states, or the implemented product promise. I did not sample within the relevant set.

### Reviewed files / regions

- Top-level product docs and packaging: `README.md`, `package.json`, `.gitignore`, `.env.deploy.example`, `.github/assets/logo.svg`.
- Web app docs and deployment/onboarding: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`.
- Site/SEO/social configuration: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/icon.tsx`, `apps/web/src/app/apple-icon.tsx`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/gallery-config-shared.ts`.
- Public UI copy, empty/error states, navigation, discovery, and viewer flows: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/topic-empty-state.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/app/[locale]/error.tsx`, `apps/web/src/app/[locale]/not-found.tsx`, `apps/web/src/app/global-error.tsx`, public route `loading.tsx` files.
- Admin/onboarding/conversion-critical copy: `apps/web/src/app/[locale]/admin/login-form.tsx`, `apps/web/src/app/[locale]/admin/page.tsx`, `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/admin-header.tsx`, `apps/web/src/app/[locale]/admin/(protected)/admin-nav.tsx`, dashboard, images, categories, tags, users, SEO, settings, database, and password admin route components under `apps/web/src/app/[locale]/admin/(protected)/**`.
- Product-promise implementation checks: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/lib/process-image.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`.

## Findings

### 1. Remote deployment instructions point users to an env file the deploy script never reads

- Severity: High
- Confidence: High
- Evidence:
  - `README.md:103-113` says the remote deploy helper keeps SSH config in a gitignored root `.env.deploy`, then instructs `cp .env.deploy.example .env.deploy`, edit it, and run `npm run deploy`.
  - `.env.deploy.example:1-4` says the default expected location is `~/.gallerykit-secrets/gallery-deploy.env`, unless `DEPLOY_ENV_FILE` is set.
  - `scripts/deploy-remote.sh:5-6` sets `DEFAULT_DEPLOY_ENV_FILE="$HOME/.gallerykit-secrets/gallery-deploy.env"` and reads only `${DEPLOY_ENV_FILE:-$DEFAULT_DEPLOY_ENV_FILE}`.
  - `scripts/deploy-remote.sh:47-50` tells users to copy `.env.deploy.example` to the home secrets path when the file is missing.
  - `.gitignore:18` ignores root `.env.deploy`, which reinforces the README path but not the script behavior.
- Failure scenario: A self-hosting evaluator follows the README exactly, creates `.env.deploy`, runs `npm run deploy`, and immediately hits a missing-env-file error for `~/.gallerykit-secrets/gallery-deploy.env`. This breaks the first deploy moment and makes the remote-deploy promise look unreliable.
- Concrete fix: Align the docs and script to one path. Preferred: update `README.md:105-110` to `mkdir -p ~/.gallerykit-secrets && cp .env.deploy.example ~/.gallerykit-secrets/gallery-deploy.env`, then edit that file before `npm run deploy`. Alternatively, change `scripts/deploy-remote.sh` to fall back to root `.env.deploy` before the home-secrets path, and update `.env.deploy.example` plus the failure copy accordingly.

### 2. Photo/social metadata advertises original image dimensions for resized OG image URLs

- Severity: Medium
- Confidence: High
- Evidence:
  - Home fallback social card builds a resized `_ogImageSize` URL at `apps/web/src/app/[locale]/(public)/page.tsx:90-92`, but reports `width: latestImage.width` and `height: latestImage.height` at `apps/web/src/app/[locale]/(public)/page.tsx:93-94`.
  - Photo detail metadata builds a resized social URL at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:70-73`, but reports original `image.width` / `image.height` at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:82-83`.
  - Individual share metadata repeats the pattern at `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:51-59`.
  - Group share metadata repeats the pattern at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:56-67`.
- Failure scenario: A large portrait or landscape photo is shared to Slack, Twitter/X, KakaoTalk, or Facebook. The crawler fetches the resized derivative but receives original dimensions in `og:image:width`/`og:image:height`, causing bad reserved aspect ratios, crop mistakes, preview validation warnings, or lower-quality card rendering.
- Concrete fix: Centralize social-image metadata generation. When the URL points to the `_N` derivative, compute the real derivative dimensions, e.g. `ogWidth = Math.min(image.width, ogImageSize)` and `ogHeight = Math.round(image.height * ogWidth / image.width)`, preserving orientation. Reuse the helper across home, photo detail, individual share, and group share routes. If exact derivative dimensions are not available, omit width/height rather than emitting incorrect values.

### 3. Fresh/empty sites have no default branded social image fallback

- Severity: Medium
- Confidence: High
- Evidence:
  - Home metadata uses configured `seo.og_image_url` when present at `apps/web/src/app/[locale]/(public)/page.tsx:52-75`, otherwise falls back to the latest uploaded image at `apps/web/src/app/[locale]/(public)/page.tsx:78-97`.
  - If there is no configured OG image and no uploaded image, `ogImages` remains empty at `apps/web/src/app/[locale]/(public)/page.tsx:80-83` / `apps/web/src/app/[locale]/(public)/page.tsx:97`.
  - The dynamic OG route requires a `topic` parameter and returns `400` without it at `apps/web/src/app/api/og/route.tsx:26-37`; it cannot provide a generic home/brand card.
  - The shipped examples do not include an OG image default: `apps/web/src/site-config.example.json:2-10` and `apps/web/src/site-config.json:2-10` leave `seo.og_image_url` empty.
- Failure scenario: A new user deploys the app, customizes only the title/URL, and shares the home page before uploading photos. The link preview is text-only or platform-generated rather than a branded GalleryKit card, weakening launch/share conversion exactly when the site is being introduced.
- Concrete fix: Add a generic branded OG fallback, such as `/api/og?site=home` or a static `/og-default.png`, and use it when neither `seo.og_image_url` nor a latest image exists. Update README/admin SEO copy to recommend replacing this with a custom brand/social image for production.

### 4. Upload copy and file picker accept formats this installed image pipeline cannot process

- Severity: Medium
- Confidence: High
- Evidence:
  - The dropzone accepts `image/*` plus `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.arw`, `.heic`, `.heif`, `.tiff`, `.tif`, `.gif`, and `.bmp` at `apps/web/src/components/upload-dropzone.tsx:162-164`.
  - The server allowlist mirrors those extensions at `apps/web/src/lib/process-image.ts:42-44`.
  - Actual processing calls `sharp(fileBuffer).metadata()` and throws a generic invalid-file message if Sharp cannot decode the input at `apps/web/src/lib/process-image.ts:264-270`.
  - The upload action collapses processing failures into per-file failures and, when all fail, returns the generic translated `allUploadsFailed` result at `apps/web/src/app/actions/images.ts:393-406`.
  - Runtime verification of the installed Sharp build showed input suffix support for GIF, AVIF, JPEG, PNG, SVG, TIFF, VIPS, and WebP, but not `.heic`, `.heif`, `.arw`, or `.bmp`; HEIF support was exposed only for `.avif` in this installation.
- Failure scenario: A photographer selects iPhone `.heic`, camera `.arw`, or `.bmp` files because the UI file picker explicitly permits them. The upload then fails after selection with a generic "all uploads failed" state. That is a product-promise mismatch for "multi-format optimization" and is especially damaging for photo-heavy users evaluating the product.
- Concrete fix: Make accepted extensions match the runtime image pipeline, or detect supported Sharp input formats at startup/build time and derive both the dropzone accept list and server allowlist from that source. Add localized unsupported-format messages that include the extension and the supported formats. If HEIC/RAW support is a roadmap feature, document it as not currently supported instead of accepting those files.

### 5. Korean/localized admin flows still leak English error copy

- Severity: Low
- Confidence: High
- Evidence:
  - The Korean and English message files have matching key sets, so this is not a missing-key issue.
  - Database backup download validation hardcodes `Invalid download URL` at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:40`.
  - Upload rejection toasts pass through the raw React Dropzone library `reason` at `apps/web/src/components/upload-dropzone.tsx:166-175`; those default reasons are not localized through `apps/web/messages/en.json` / `apps/web/messages/ko.json`.
- Failure scenario: A Korean admin hits an invalid backup URL or file-type/size rejection and sees English text inside an otherwise Korean admin interface. That lowers perceived product polish and makes recovery instructions less clear.
- Concrete fix: Add localized keys such as `db.invalidDownloadUrl`, `upload.unsupportedFileType`, `upload.fileTooLarge`, and `upload.tooManyFiles`. Map React Dropzone error codes to those keys instead of displaying library-provided English strings.

### 6. Public taxonomy is inconsistent: docs promise “Topics & Albums,” UI says “Categories,” errors still say “Topic”

- Severity: Low
- Confidence: High
- Evidence:
  - Marketing docs advertise `Topics & Albums` at `README.md:33`.
  - The primary admin/public UI uses `Categories`, e.g. `apps/web/messages/en.json:68`, `apps/web/messages/en.json:72`, and upload guidance at `apps/web/messages/en.json:125-126` / `apps/web/messages/en.json:141-142`.
  - Several user-visible server/error messages still use `Topic`, including `apps/web/messages/en.json:366-409` (`slugOrAliasExists`, `invalidTopicFormat`, `topicRequired`, `topicNotFound`, etc.).
- Failure scenario: A prospect reads the README expecting album/topic organization, then lands in an admin flow that talks about categories while errors talk about topics. The feature is implemented, but the mixed naming makes onboarding and support harder and dilutes SEO/content consistency.
- Concrete fix: Choose one public term. If the intended user-facing term is `Categories`, change `README.md:33` to `Categories (album-like groupings with slug aliases)` and update user-visible message strings under `apps/web/messages/en.json:366-409` and the Korean equivalents to say Category/카테고리. Keep `topic` as an internal code term if desired.

### 7. Search placeholder undersells description/title search despite implementation and README promise

- Severity: Low
- Confidence: High
- Evidence:
  - README promises search across titles, descriptions, cameras, and tags at `README.md:35`.
  - The English placeholder says `Search photos, tags, cameras...` at `apps/web/messages/en.json:284`; the Korean placeholder similarly emphasizes photos/tags/cameras at `apps/web/messages/ko.json:284`.
  - The adjacent hint is more complete at `apps/web/messages/en.json:286` and `apps/web/messages/ko.json:286`.
  - Implementation searches title/description/camera fields and tags/aliases in `apps/web/src/lib/data.ts:933-935`, `apps/web/src/lib/data.ts:955-964`, and `apps/web/src/lib/data.ts:993-1000`.
- Failure scenario: Users with many captioned photos do not realize they can search descriptions or titles from the main search box, so the product feels less powerful than it is and search engagement suffers.
- Concrete fix: Update the placeholder to include the strongest metadata promise, e.g. `Search titles, descriptions, tags, cameras...` and the Korean equivalent, or use a shorter `Search photos and metadata...` placeholder while keeping the detailed hint.

### 8. Admin “OG Locale” copy overstates what the field controls

- Severity: Low
- Confidence: Medium
- Evidence:
  - The SEO admin exposes `OG Locale` with hint text from `apps/web/messages/en.json:334-335` and UI at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:144-153`.
  - Runtime metadata locale selection is route-first: `getOpenGraphLocale(locale, configuredLocale)` returns `en_US` for `/en` and `ko_KR` for `/ko` before considering configured locale at `apps/web/src/lib/locale-path.ts:57-68`.
- Failure scenario: An admin sets `ko_KR` in the SEO form expecting all Open Graph previews to use Korean locale, but `/en/...` still emits `en_US`. The field is not useless, but its copy does not explain that configured locale is mostly a fallback for unsupported route locales.
- Concrete fix: Change the field label/hint to `Fallback OG locale` and explain `Route locale wins for /en and /ko`. Alternatively, remove the setting from the admin UI if the product wants route-derived locale only.

## Positive notes

- The message key sets are consistent between `apps/web/messages/en.json` and `apps/web/messages/ko.json` (509 flattened keys each; no missing keys found).
- Core metadata routes exist for home, topics, photos, individual shares, and group shares, plus `robots.ts`, `sitemap.ts`, dynamic manifest, app icons, and same-origin OG image URL validation.
- README, web README, `.env.local.example`, Docker files, and admin SEO/settings pages cover most of the expected self-hosted onboarding surface.

## Final missed-issues sweep

Completed before writing this report:

- Re-ran targeted inventory for docs, SEO/social metadata, i18n messages, public UI components, admin copy, deployment scripts, and image/search implementation files.
- Checked message-key parity between English and Korean files; no missing localization keys found.
- Grepped for hardcoded user-facing strings in reviewed admin/public components and separated true issues from deliberate technical identifiers.
- Cross-checked README product promises against implementation for search, formats, SEO/social cards, deploy flow, categories/topics, and empty states.
- Verified installed Sharp input format suffixes to confirm the upload-format mismatch rather than relying on extension names alone.

Recommendation: address Findings 1-4 before using the README/deploy flow or social previews as acquisition/conversion paths. Findings 5-8 are polish/content consistency fixes that can be grouped with the next i18n/SEO pass.

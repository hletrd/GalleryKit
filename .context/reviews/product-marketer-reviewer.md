# Product Marketing Truth Review

Scope: GalleryKit self-hosted photo gallery, product positioning, onboarding/docs, launch readiness, and public/admin product surfaces versus implementation truth.

Reviewer lane: product-marketer-reviewer, adapted from the registered reviewer prompt for GalleryKit rather than BurstPick.

## Inventory Built First

Marketing and documentation surfaces examined:

- `README.md:1-199` - top-level product positioning, feature list, live demo link, quick start, env, Docker/deploy, tech stack.
- `apps/web/README.md:1-72` - app-level quick start, scripts, semantic search operational notes.
- `CLAUDE.md:1-260` - architecture, product premise, storage, HDR/color, deployment and operational constraints.
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:1-122` - semantic search design and activation claims.
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:1-15` - semantic search completion status.
- `package.json:1-21` and `apps/web/package.json:1-67` - scripts, Node engine, dependency posture.
- `apps/web/.env.local.example:1-63` - onboarding env surface.
- `apps/web/src/site-config.json:1-10`, `apps/web/src/site-config.example.json:1-10`, `apps/web/src/app/manifest.ts:1-51`, `apps/web/src/app/[locale]/layout.tsx:17-159` - site metadata, PWA, SEO surface.
- Public pages and components: `apps/web/src/app/[locale]/(public)/page.tsx:18-227`, `apps/web/src/components/nav.tsx:1-12`, `apps/web/src/components/footer.tsx:27-58`, `apps/web/src/components/search.tsx:123-468`, `apps/web/src/components/similar-photos.tsx:1-101`.
- Admin product surfaces: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:407-681`, `apps/web/messages/en.json:390-404,711-730`.
- Deployment surfaces: `apps/web/Dockerfile:1-124`, `apps/web/docker-compose.yml:1-26`, `apps/web/deploy.sh:1-56`, `scripts/deploy-remote.sh:1-72`, `apps/web/nginx/default.conf:21-28,171-176`.

Implementation used to verify claims:

- Semantic search: `apps/web/src/lib/gallery-config-shared.ts:91-125,157-163`, `apps/web/src/lib/gallery-config.ts:64-69,126-145`, `apps/web/src/app/api/search/semantic/route.ts:1-29,217-256`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-28,91-168`, `apps/web/src/lib/clip-model.ts:1-15,81-99,118-200`, `apps/web/src/lib/clip-inference.ts:1-14,63-72`, `apps/web/src/lib/clip-embeddings.ts:8-18,144-164`, `apps/web/scripts/download-clip-models.ts:25-30,47-64,141-142`, `apps/web/scripts/backfill-clip-embeddings.ts:4-21,47-49,79-95,151-158`.
- Auto alt text: `apps/web/src/lib/caption-generator.ts:1-18,37-43,54-64`, `apps/web/src/lib/image-queue.ts:413-430`, `apps/web/src/components/bulk-edit-dialog.tsx:241-258`, `apps/web/src/app/actions/images.ts:982-1031`, `apps/web/src/lib/caption-constants.ts:12-30`.
- Color/HDR: `apps/web/src/lib/process-image.ts:958-1042,1073-1219,1263-1289`, `apps/web/src/lib/color-detection.ts:1-10,19-40,170-212`, `apps/web/src/components/color-details-section.tsx:170-266`, `apps/web/src/components/lightbox-color-pip.tsx:60-70,131-156,203-222`, `apps/web/src/lib/hdr-filenames.ts:1-10`.
- Storage: `apps/web/src/lib/storage/index.ts:1-12,25-40,81-86`, `apps/web/src/lib/storage/local.ts:1-6,130-137`, `apps/web/src/lib/storage/types.ts:1-14`, `apps/web/src/lib/upload-paths.ts:11-40,82-103`.

## Executive Assessment

GalleryKit's product truth is strong in several areas: it is genuinely self-hosted, local-filesystem-backed, Docker-deployable, PWA-capable, and it contains real wide-gamut/color-pipeline work. The main launch risk is not fake functionality, but marketing and onboarding compression: the root README leads with advanced AI/color claims that are either operator-gated, stubbed, admin-only, or SDR-only in important edge cases. A technical self-hoster can reconstruct the truth from `apps/web/README.md`, `CLAUDE.md`, and code, but the first public impression overstates readiness for semantic search, auto alt text, and HDR.

## Findings

### 1. Semantic search is marketed as generally live, but fresh installs default to disabled and production activation is intentionally gated

- Severity: High
- Confidence: High
- Type: Confirmed issue

Evidence:

- Root feature claim: `README.md:37` says "Semantic Search (AI, self-hosted)" with English/Korean natural-language search, similar photos, in-process CLIP, no per-query API cost, and "Live on demo".
- The app-level truth is more constrained: `apps/web/README.md:58-70` says disabled mode returns 503, stub mode is deterministic but not semantically meaningful, production requires offline model weights, backfill, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and a DB setting.
- Defaults disable it: `apps/web/src/lib/gallery-config-shared.ts:102-103` sets `semantic_search_mode` to `disabled`.
- Production is healed back to disabled unless an env gate is set: `apps/web/src/lib/gallery-config.ts:126-145`.
- Admin settings expose only Disabled and Stub, not Production: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:649-669`, with a warning if the raw DB value is production at `settings-client.tsx:676-679`.
- Public text search route returns 503 when disabled: `apps/web/src/app/api/search/semantic/route.ts:217-233`.
- Similar-photos is production-only and hidden otherwise: `apps/web/src/app/api/search/similar/[id]/route.ts:91-107`, `apps/web/src/components/similar-photos.tsx:98-101`.
- The main env example does not surface `SEMANTIC_SEARCH_ALLOW_PRODUCTION` or `CLIP_MODELS_ROOT`: `apps/web/.env.local.example:1-63`, even though the downloader tells operators to set `CLIP_MODELS_ROOT` in app env at `apps/web/scripts/download-clip-models.ts:141-142`.

Why this is a problem:

The root README creates the expectation that semantic search is a normal shipped feature for self-hosters. In reality, the safest product posture is "demo/operator-enabled, disabled by default, with a stub mode for UI validation." That is a defensible implementation, but the public claim currently makes the advanced feature sound more turnkey than it is.

Concrete failure scenario:

A photographer or agency follows `README.md:81-104`, imports photos, searches "sunset portraits in Seoul", and either sees no semantic search path because the mode is disabled, receives a 503 from the route, or enables Stub in admin and gets deterministic non-semantic results. They conclude the gallery's headline AI feature is broken or misleading, even though the code is behaving according to its safety gates.

Suggested fix:

Change the root README feature line to say "Semantic Search (operator-enabled on demo)" or "Production semantic search is available after local CLIP weight seeding and embedding backfill; fresh installs default disabled." Add a root README checklist that mirrors `apps/web/README.md:65-70`, and add commented semantic env vars to `.env.local.example` with clear "production only after backfill" language. Keep "Live on demo" only if paired with "not enabled by default for new installs."

### 2. Admin "Auto Alt-Text" presents a stub as an AI accessibility feature and can push generic EXIF text into public title/description fields

- Severity: Medium-High
- Confidence: High
- Type: Confirmed issue

Evidence:

- Admin copy says "Generate AI alt-text suggestions using a local Florence-2 model (stub; real ONNX inference is a future feature)" and "When enabled, generates an EXIF-derived alt text hint... Requires Florence-2 ONNX model (stub active)": `apps/web/messages/en.json:711-714`.
- Implementation is explicitly stub-only and non-visual: `apps/web/src/lib/caption-generator.ts:1-18`.
- Generated output is generic EXIF text such as `[AUTO] Photo taken with {camera}` or `[AUTO] Photo`: `apps/web/src/lib/caption-generator.ts:37-43`.
- The queue stores this generated value in `alt_text_suggested`: `apps/web/src/lib/image-queue.ts:413-430`.
- Bulk edit exposes "Apply suggested alt text" as an action source: `apps/web/src/components/bulk-edit-dialog.tsx:241-258`.
- Applying suggested alt text can copy it into `title` or `description` when empty: `apps/web/src/app/actions/images.ts:982-1031`; the `[AUTO]` prefix stripping behavior lives at `apps/web/src/lib/caption-constants.ts:12-30`.

Why this is a problem:

The UI is honest that it is a stub, but the feature framing still says "AI alt-text" and puts the output on a path where admins can publish it into visible metadata. That risks weak accessibility, poor SEO, and a mismatch with a photographer-focused product that should preserve intent and avoid generic machine-generated captions.

Concrete failure scenario:

An admin preparing a client gallery enables Auto Alt-Text because the settings page describes AI suggestions. They bulk-apply suggestions before launch. Public photos then get titles or descriptions like "Photo taken with Canon EOS R5" instead of meaningful subject descriptions. A client or accessibility audit sees low-quality pseudo-alt text and treats GalleryKit's accessibility posture as unserious.

Suggested fix:

Rename the setting to "EXIF caption placeholder" or hide it outside a clearly marked development/stub panel until real visual captioning ships. Disable bulk-apply-to-title/description for stub-generated suggestions, or add a blocking confirmation that these are non-visual placeholders. Avoid using "AI alt-text" in public/admin copy until Florence-2 or another real image-caption model is wired.

### 3. Color management claims are strong, but HDR delivery is easy to misread as shipped public HDR support

- Severity: Medium
- Confidence: High
- Type: Confirmed issue

Evidence:

- Root README says "Photographer-grade color management" with ICC handling, NCLX metadata, P3 mapping, Apple HDR gain map detection, and PQ/HLG ingest gates: `README.md:33`.
- The image pipeline does real wide-gamut work: `apps/web/src/lib/process-image.ts:982-995` resolves output color space, `process-image.ts:1073-1127` preserves 16-bit/wide-gamut paths where supported, and `process-image.ts:1138-1219` writes AVIF/JPEG with P3 or sRGB targets.
- HDR is explicitly not full delivery: `apps/web/src/lib/color-detection.ts:1-10` says true HDR AVIF delivery is deferred, and `CLAUDE.md:253-257` says HDR stays SDR-only and admin-only for now.
- Public UI gates HDR details to admins: `apps/web/src/components/lightbox-color-pip.tsx:60-70,131-156`; color details also treat HDR as admin-only metadata: `apps/web/src/components/color-details-section.tsx:170-183,221-242`.
- HDR filename/path support is reserved but not wired: `apps/web/src/lib/hdr-filenames.ts:1-10`.

Why this is a problem:

The README bullet is technically careful, but it compresses three different things into one premium-sounding claim: wide-gamut delivery, HDR detection, and gated HDR ingest. A non-implementer can reasonably read this as "GalleryKit publicly serves HDR photos." The code truth is narrower: wide-gamut SDR delivery is real; HDR detection/audit is real; public HDR delivery is not.

Concrete failure scenario:

A photographer with iPhone HDR or HLG exports deploys GalleryKit expecting visitors to see HDR output. They enable HDR ingest, see admin audit data, and market the gallery as HDR-capable. Visitors still receive SDR base assets. The gap damages trust because the product did not distinguish detection from delivery at the top-level claim.

Suggested fix:

Split the README bullet into separate claims:

- "Wide-gamut color pipeline: ICC-aware P3/sRGB output with AVIF/WebP/JPEG derivatives."
- "HDR detection/audit: Apple gain-map and PQ/HLG signals are detected for admins; public HDR delivery is not shipped yet."

Remove or qualify "photographer-grade" unless accompanied by a concise compatibility table that shows what is preserved, converted, rejected, and delivered.

### 4. "High-performance" positioning lacks public proof, sizing guidance, or benchmark framing

- Severity: Medium
- Confidence: Medium
- Type: Likely issue

Evidence:

- Product tagline claims "A high-performance, self-hosted photo gallery built with Next.js": `README.md:8`.
- The README lists Sharp-derived multi-format processing and Docker support, but does not provide throughput, hardware, latency, or sizing expectations: `README.md:29-42,168-186`.
- The package exposes operational scripts and queues but no benchmark command or published profile: `apps/web/package.json:8-26`.
- Semantic search docs have some internal performance spike context, such as local CLIP load and embedding latency targets, but it is not converted into public operator guidance: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:120-122`.

Why this is a problem:

"High-performance" is a comparative claim. Self-hosters need to know what hardware and settings are enough for upload processing, AVIF generation, CLIP backfills, and public gallery response. Without benchmark framing, the claim reads as marketing assertion rather than launch-ready trust signal.

Concrete failure scenario:

An operator deploys on a small VPS, uploads a large wedding set, and sees slow AVIF generation or CLIP backfill CPU pressure. Because there are no published expectations, they interpret normal heavy processing as a product failure.

Suggested fix:

Add a "Performance profile" section with measured hardware, photo count, source sizes, derivative generation throughput, gallery page response/LCP sample, recommended `IMAGE_PROCESSING_CONCURRENCY`, and CLIP text/image embedding timings. If measurements are not ready, change the tagline to a less comparative claim such as "A self-hosted photo gallery optimized for modern image delivery."

### 5. Demo/deploy surfaces leak maintainer-specific defaults into self-hosting posture

- Severity: Medium
- Confidence: High
- Type: Confirmed issue

Evidence:

- Root README points to the live demo `https://gallery.atik.kr`: `README.md:22`.
- The committed site config also uses the same production demo domain: `apps/web/src/site-config.json:1-10`; the example file uses `https://example.com` at `apps/web/src/site-config.example.json:1-10`.
- Nginx config has `server_name gallery.atik.kr` and comments about sitting behind a TLS edge: `apps/web/nginx/default.conf:21-28`.
- Docker Compose uses host networking: `apps/web/docker-compose.yml:14-16`.
- The README warns about Docker static paths and deployment adaptation: `README.md:171-186`, but the checked-in default still resembles a single maintainer deployment.

Why this is a problem:

For a self-hosted product, the first trust signal is whether the repository separates demo configuration from reusable operator configuration. Here, the codebase has an example config, but the default deploy/nginx/site config surfaces are still demo-specific enough that a self-hoster can copy the wrong file and ship a broken or confusing deployment.

Concrete failure scenario:

A user copies `apps/web/nginx/default.conf`, keeps the maintainer `server_name`, or serves static uploads from the wrong path noted in `README.md:186`. Their domain has broken routing or static assets, and the product feels like an internal deployment snapshot rather than a polished self-hosted package.

Suggested fix:

Move demo-specific config into a clearly named demo/local file and make checked-in deploy examples use placeholders. Template `server_name`, static root, and public URL values, or add an operator-facing "copy this, not the demo config" path. Keep `gallery.atik.kr` only in the README demo link and demo-specific config.

### 6. Public repository/support trust signal may be brittle at launch

- Severity: Low-Medium
- Confidence: Medium
- Type: Risk needing manual validation

Evidence:

- README clone instructions use `https://github.com/hletrd/gallerykit.git`: `README.md:92`.
- Footer links to `https://github.com/hletrd/gallerykit`: `apps/web/src/components/footer.tsx:43-45`.
- Both root and app packages are marked private: `package.json:3`, `apps/web/package.json:3`.

Why this is a problem:

A "Powered by GalleryKit" footer that points to a missing, private, or not-yet-launch-ready repository turns an open-source/self-hosted trust signal into a dead end. The packages being private may be intentional for npm publishing, but it increases the need to manually verify that the GitHub target is public and ready before public launch.

Concrete failure scenario:

A demo visitor clicks the footer GitHub link to evaluate self-hosting, hits a 404 or a private repository, and leaves before reading the docs. The product loses credibility at the highest-intent moment.

Suggested fix:

Before launch, manually verify that `hletrd/gallerykit` is public and contains the same README users see in-product. If the repository location is not stable, make the footer repository URL configurable via site config or remove the public link until the repo is public.

## Claims Verified Without Findings

- Storage backend honesty: no public docs were found advertising S3, MinIO, R2, or external object storage. `CLAUDE.md:111` says the storage backend is not integrated and local filesystem remains canonical. Code supports only `local` in `apps/web/src/lib/storage/index.ts:25-40,81-86`, and local URLs come from `/uploads/...` while originals are private in `apps/web/src/lib/storage/local.ts:130-137`. README storage/deploy notes match this posture at `README.md:179-183`.
- PWA claim: the app has a manifest in `apps/web/src/app/manifest.ts:1-51`, registers a service worker from layout at `apps/web/src/app/[locale]/layout.tsx:145-159`, and includes cache/offline claims in `README.md:38`. I did not find a product-truth mismatch in the reviewed regions.
- Root-admin/no-role-separation honesty: README admin copy says root-admin accounts and no role separation at `README.md:40`; this matches the product posture described in `CLAUDE.md:78-83`.
- No editing/culling/scoring posture: `CLAUDE.md:224-237` explicitly says GalleryKit is not an editing/culling/scoring product. I did not find public marketing that contradicts this.

## Missed-Issues Sweep

Final sweep performed across:

- Top-level docs: `README.md`, `CLAUDE.md`, `package.json`.
- App docs and env: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/package.json`.
- Product metadata and public surfaces: `apps/web/src/site-config*.json`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`.
- Admin copy/surfaces: `apps/web/messages/en.json`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`.
- Semantic search implementation/scripts: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-*`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Color/HDR implementation: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/color-detection.ts`, `apps/web/src/components/color-details-section.tsx`, `apps/web/src/components/lightbox-color-pip.tsx`, `apps/web/src/lib/hdr-filenames.ts`.
- Storage/deploy implementation: `apps/web/src/lib/storage/*`, `apps/web/src/lib/upload-paths.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`.

Relevant search themes included semantic/CLIP, Florence/alt text/caption, HDR/gain map/PQ/HLG, storage/S3/MinIO/R2, public/demo/deploy, manifest/PWA, and repo/footer links.

Residual risks:

- I did not perform live browser validation of `https://gallery.atik.kr` or public GitHub availability; repository/link publicness remains a manual launch check.
- I did not run build/test suites because this was a read-only review and no source behavior was modified.
- Korean copy should receive a parallel product-truth review if Korean is a primary buyer/operator surface; this pass cited English admin copy and code paths.

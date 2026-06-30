# Product Marketer Review - Cycle 20

Date: 2026-06-30
Reviewer lane: product-marketer-reviewer
Scope: GalleryKit only. Product messaging, public docs, privacy/operator trust, feature claims vs code reality, photographer/user fit, public UX copy, deployment/support docs, and claim honesty.

## Executive Summary

I found 5 current issues: 1 High, 3 Medium, 1 Low. Cycle-19 carry-forward items around robots/OG, visitor-safe empty states, and Similar Photos silent failure appear fixed in the current tree. The remaining trust risk is concentrated in privacy and launch identity: the public privacy page still under-discloses first-party analytics when Google Analytics is disabled, and the tracked runtime config can silently publish GalleryKit/demo identity into a fresh operator's public metadata.

Go-to-market readiness score: 7/10 for a technical self-hosted photographer/operator, 5/10 for broader creator adoption until launch-readiness and trust copy are tightened.

## Inventory Reviewed

- Project guidance and context: `AGENTS.md`, `CLAUDE.md`, prior `.context/reviews/product-marketer-reviewer.md`.
- Public/product docs: `README.md`, `apps/web/README.md`, `docs/superpowers/**`.
- Public metadata and discovery surfaces: home, photo, topic, smart collection, map, share, feed, sitemap, robots, manifest, OG image route.
- User-facing copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, nav/footer, home empty state, search, similar photos, settings, SEO, upload, tokens, analytics, privacy.
- Trust/privacy implementation: first-party analytics recorders, analytics schema, GPS/map controls, public/private field guards, SEO settings fallback, site config/build guard.
- Deployment/support docs: Docker compose, deploy helper, build-time site-config validation, canonical URL use.

## Findings

### PMR20-01 - GA-disabled privacy page hides first-party analytics disclosure

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- The privacy page chooses exactly one analytics paragraph based only on `siteConfig.google_analytics_id`: `apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-25`.
- The GA-enabled paragraph includes first-party analytics disclosure, but the GA-disabled paragraph only says Google Analytics is not configured: `apps/web/messages/en.json:783-791` and `apps/web/messages/ko.json:783-791`.
- GalleryKit records first-party photo/topic/shared-group view events regardless of GA status: `apps/web/src/app/actions/public.ts:351-389`, `apps/web/src/app/actions/public.ts:397-420`, `apps/web/src/app/actions/public.ts:428-455`.
- The durable analytics tables store timestamps plus `referrer_host`, `country_code`, and `bot`: `apps/web/src/db/schema.ts:220-263`.

Product/user failure scenario:
A viewer opens `/privacy` on the common default setup where Google Analytics is blank. The page says GA is not configured, so the viewer reasonably infers there is no local visit analytics beyond normal server logs. In reality, GalleryKit still writes photo/topic/shared-gallery view rows for local analytics. That weakens the self-hosted trust promise exactly where privacy-sensitive viewers and operators check it.

Suggested fix:
Split the analytics copy into two independent paragraphs: always disclose GalleryKit first-party analytics, then conditionally disclose Google Analytics. Keep the first-party paragraph identical across GA-enabled and GA-disabled sites, and mention the retention window.

### PMR20-02 - Privacy copy says GalleryKit stores a client fingerprint that code does not persist

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- The GA-enabled privacy paragraph says GalleryKit stores "a short client fingerprint for rate-limited counting": `apps/web/messages/en.json:787-789`; Korean mirrors that claim at `apps/web/messages/ko.json:787-789`.
- The view recorder derives only IP for transient rate limiting, sanitized referrer host, derived country code, and bot flag: `apps/web/src/app/actions/public.ts:330-360`.
- The persisted inserts include only image/topic/group id, `referrer_host`, `country_code`, and `bot`: `apps/web/src/app/actions/public.ts:383-389`, `apps/web/src/app/actions/public.ts:415-420`, `apps/web/src/app/actions/public.ts:450-455`.
- The schema has no fingerprint/client hash field in the analytics tables: `apps/web/src/db/schema.ts:224-258`.
- The analytics helper's privacy contract also says full IPs are never stored and only country/referrer/bot summaries persist: `apps/web/src/lib/analytics.ts:1-11`.

Product/user failure scenario:
An operator who would otherwise accept privacy-preserving local analytics reads the public policy and believes GalleryKit stores a persistent fingerprint. That can trigger unnecessary cookie/consent work, scare privacy-sensitive visitors, or cause the operator to disable/avoid a feature that is actually less invasive than the copy claims.

Suggested fix:
Remove the fingerprint sentence from public privacy copy. If rate limiting needs disclosure, say "GalleryKit uses the request IP transiently for rate limiting but does not store full IP addresses in the analytics tables."

### PMR20-03 - Checked-in demo-domain `site-config.json` can become a fresh install's canonical URL

Severity: Medium
Confidence: High
Status: Confirmed risk

Evidence:
- The tracked runtime config uses the demo origin, not a placeholder: `apps/web/src/site-config.json:2-10`.
- The example config is rejected in production because `example.com` is a placeholder, but the build guard's placeholder host set does not include `gallery.atik.kr`: `apps/web/scripts/ensure-site-config.mjs:11-21`, `apps/web/scripts/ensure-site-config.mjs:28-42`.
- `getSeoSettings()` falls back to `process.env.BASE_URL || siteConfig.url`: `apps/web/src/lib/data.ts:1729-1750`.
- The localized root layout publishes `seo.url` as `metadataBase`, Open Graph URL, hreflang base, and preconnect target: `apps/web/src/app/[locale]/layout.tsx:17-58`, `apps/web/src/app/[locale]/layout.tsx:112-114`.
- Sitemap and robots also derive public URLs from `BASE_URL || siteConfig.url`: `apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/sitemap.ts:57-91`, `apps/web/src/app/robots.ts:1-23`.
- The per-photo OG fallback redirects to the canonical origin if no image/default OG fallback is available: `apps/web/src/app/api/og/photo/[id]/route.tsx:244-294`.

Product/user failure scenario:
A self-hosting photographer clones the repo, misses `BASE_URL`, and deploys with the tracked `apps/web/src/site-config.json`. Production build validation passes because `gallery.atik.kr` is a valid non-placeholder URL. Their sitemap, robots sitemap pointer, canonical metadata, Open Graph, feed URLs, and fallback OG redirects can point to the demo site instead of their domain. Shared links and SEO previews then look untrustworthy or route crawlers to the wrong gallery.

Suggested fix:
Do not ship a real demo origin as the tracked runtime fallback. Options: keep only an example file and require a gitignored local `site-config.json`; add `gallery.atik.kr` to rejected production defaults unless an explicit demo/deploy env is set; or require `BASE_URL` for production builds even when `site-config.url` is present. Also add a launch-readiness check that warns when public URL still equals the demo origin.

### PMR20-04 - Generic GalleryKit identity still flows into public SEO/PWA/feed defaults

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- The tracked runtime and example configs both use product-generic identity: `apps/web/src/site-config.json:2-10`, `apps/web/src/site-config.example.json:2-10`.
- Public SEO settings fall back to those values when DB fields are empty or unreadable: `apps/web/src/lib/data.ts:1729-1750`.
- The admin SEO getter returns empty strings for unset DB-backed fields: `apps/web/src/app/actions/seo.ts:26-46`.
- The SEO form tells admins they may leave title/nav/description/author empty for defaults, without showing that the default can be "GalleryKit": `apps/web/messages/en.json:443-471`, `apps/web/messages/ko.json:443-471`.
- Root metadata and the PWA manifest publish the resolved title, nav title, author-derived metadata, and description: `apps/web/src/app/[locale]/layout.tsx:17-58`, `apps/web/src/app/manifest.ts:6-52`.
- The public footer uses `siteConfig.footer_text` directly, so the default footer remains "Powered by GalleryKit" unless the file is edited: `apps/web/src/components/footer.tsx:26-37`.
- Root feed author/rights fall back to `seo.author`, `seo.title`, then `siteConfig.title`: `apps/web/src/app/feed.xml/route.ts:76-83`, `apps/web/src/app/feed.xml/route.ts:104-123`.

Product/user failure scenario:
A photographer completes the technical install and uploads photos before customizing SEO. Search snippets, social cards, PWA install labels, Atom feed author/rights, nav, and footer can all identify the site as "GalleryKit" / "A self-hosted photo gallery" rather than the photographer or studio. Recipients of shared links see an unfinished product instead of a branded gallery.

Suggested fix:
Add an admin launch-readiness warning when SEO title, description, nav title, author, URL, or footer still match product defaults. In the SEO page, show the resolved fallback next to each empty field and label product defaults as "not launch-ready." Add a first-run checklist in docs: set public URL, gallery title, author/copyright, footer, OG image, privacy/GPS setting, first upload, share preview.

### PMR20-05 - README still proves engineering depth before product experience

Severity: Low
Confidence: High
Status: Confirmed

Evidence:
- The hero value proposition is only "A high-performance, self-hosted photo gallery built with Next.js": `README.md:5-9`.
- The feature list immediately leads with implementation-heavy claims about formats, color pipelines, CLIP, PWA behavior, and admin scope: `README.md:29-44`.
- The first "what success looks like" setup outcome appears later as one sentence after install commands: `README.md:83-107`.
- The reviewed README top-to-bottom section has no screenshots, live share preview example, first-run checklist, privacy checklist, or visitor-facing walkthrough: `README.md:1-208`.

Product/user failure scenario:
A photographer or small-studio operator evaluating the repo sees strong engineering credibility but little immediate proof of what visitors will experience, what a shared photo looks like, or what launch steps reduce privacy/SEO risk. That under-converts the creative audience GalleryKit is otherwise well-shaped to serve.

Suggested fix:
Move a compact product-proof section above the dense feature inventory: desktop/mobile screenshots, one share/OG preview, and a "first 10 minutes after install" checklist. Keep the technical feature list, but let the first screen answer "will this make my photo site look good and trustworthy?"

## Product-Market Fit Assessment

GalleryKit's strongest wedge remains clear: a self-hosted public photo gallery for photographers/operators who care about color fidelity, metadata privacy, private originals, sharing, and owning the publishing stack. The code and docs mostly avoid false claims around HDR, semantic search, Lightroom, storage backends, and role separation.

The first customer is still a technically capable photographer or small studio. The broader creator audience needs more launch guidance: public identity, canonical URL, privacy disclosure, GPS/map behavior, and share-preview verification.

## Positioning Recommendation

Current positioning is accurate but engineering-first:

> A high-performance, self-hosted photo gallery built with Next.js.

Stronger GalleryKit positioning:

> A self-hosted photo gallery for photographers who want fast delivery, accurate color, private originals, and control over every public share.

Avoid making AI search the lead wedge. It is useful and now carefully documented, but trust, color, and ownership are the more durable product story.

## Current Strengths

- Semantic search copy is now honest about disabled/stub/production modes, bounded scans, and operator setup.
- Similar Photos no longer silently disappears on fetch failures; it keeps a visible localized error state.
- `robots.txt` now explicitly allows OG image endpoints before disallowing the rest of `/api/`.
- The public empty gallery state no longer exposes admin-dashboard instructions to visitors.
- Upload API token copy clearly says GalleryKit ships an API endpoint, not a Lightroom Classic plugin.
- HDR and wide-gamut surfaces consistently frame metadata vs delivered SDR/current browser limits.

## Final Missed-Issue Sweep

Sweep performed:
- Re-ran targeted `rg` over privacy, analytics, SEO, OG, robots, empty states, semantic search, Similar Photos, README/docs, upload tokens, storage, deployment, and support copy.
- Checked current source regions for fixed carry-forward items: robots/OG allowlist, public empty state, Similar Photos failure UI, semantic-search setup copy, Lightroom token copy.
- Checked implementation evidence for analytics persistence, GPS/map visibility, public field guards, canonical URL fallback, site-config build validation, and feed/manifest/metadata derivation.

Not filed because current code/copy is adequate:
- Storage backend docs correctly avoid presenting S3/MinIO as supported.
- Upload API/token docs do not promise a bundled Lightroom plugin.
- Semantic search is honestly gated and differentiates stub from production.
- Similar Photos failure feedback is now visible in production mode.
- Public empty state is visitor-safe.
- OG endpoints are now allowed in robots before the `/api/` disallow.
- GPS public map behavior is disclosed and route-gated by map-visible topics.
- Backup plaintext-at-rest limitations are disclosed in docs.

Review boundary:
- I did not modify implementation code, run tests, or verify live browser rendering. This was a static product/content/trust review with exact source references.

## Final Verdict

GalleryKit's claim discipline is strong for a fast-moving self-hosted app, but trust copy and first-run identity are still below the bar set by the implementation. Fix the privacy page split, remove the nonexistent fingerprint claim, and prevent demo/default identity from leaking into public canonicals before spending more effort on broader marketing polish.

# Product Marketer Review - Cycle 22

Date: 2026-06-30
Reviewer lane: product-marketer-reviewer-style
Scope: GalleryKit only. The installed prompt at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` is BurstPick-specific, so I used only its general reviewer discipline: verify public/product/operator claims against implementation, call out positioning risk, and avoid forcing BurstPick paths or assumptions onto GalleryKit.

## Executive Summary

GalleryKit is mostly honest about what it is: a self-hosted gallery for finished photography, not an editor, culler, or Lightroom replacement. The remaining product-marketing risk is concentrated in two places: the README still blurs first-party/local-control positioning with optional third-party analytics, and the Settings re-encode UI gives operators an obvious button beside a state that often requires a sidecar command instead. I found 3 issues: 1 High and 2 Medium. Go-to-market readiness: 7/10 for technical self-hosters, 5/10 for photographers/operators who need product proof and setup confidence without reading source comments or CLAUDE.md.

## Inventory Reviewed

- Reviewer and project guidance: `AGENTS.md`, `CLAUDE.md`, `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`.
- Public/product docs: `README.md`, `apps/web/README.md`, `apps/web/src/site-config.json`.
- Operator/admin copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, admin Settings, Tokens, DB/privacy copy.
- Product surfaces and implementation evidence: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, semantic and similar search routes/components, upload API token route and auth helpers, privacy/map data access, PWA service worker/manifest paths.
- Review history checked: current `.context/reviews/product-marketer-reviewer.md` before replacement, cycle-21 aggregate notes, cycle-22 aggregate/document-specialist context, photographer/color and UI/UX review history where relevant.
- Final sweep terms: `Semantic`, `CLIP`, `Lightroom`, `plugin`, `PWA`, `offline`, `HDR`, `GPS`, `analytics`, `Google Analytics`, `operator-only`, `stub`, `production`, `placeholder`, `not implemented`, `root admin`, `backup`, `self-hosted`, `S3`, `MinIO`, `storage`.

## Findings

### PMR22-01 - "Without handing analytics to SaaS" conflicts with configurable Google Analytics

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- Root README frames the product as for people who want to publish without handing "originals, analytics, or AI features to a hosted SaaS": `README.md:29`.
- The shipped site config has a `google_analytics_id` field, making third-party analytics an intended configuration surface: `apps/web/src/site-config.json:10`.
- The public privacy copy explicitly says that when Google Analytics is configured, the site loads Google Analytics and Google may receive request/device information: `apps/web/messages/en.json:790-792`.
- The README later shows `google_analytics_id` in the configuration example but does not reconcile that with the earlier no-SaaS analytics promise: `README.md:50-63`.

Failure scenario:
An operator chooses GalleryKit because the README promises analytics are not handed to hosted SaaS, then enables `google_analytics_id` from the documented config example. The privacy page is truthful, but the top-level positioning has already overpromised. For privacy-sensitive photographers, this reads like a trust breach even though the implementation is behaving as configured.

Suggested fix:
Change the top promise to a conditional claim: "keeps originals private and provides first-party local analytics by default, with optional Google Analytics if you configure it." In the config section, label `google_analytics_id` as an optional third-party analytics integration and link to the privacy copy. Keep the self-hosted/control positioning, but do not imply all analytics always stay off SaaS.

### PMR22-02 - Settings re-encode CTA still overpromises for settings-only changes

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- The Settings UI shows a "Backfill required" banner when existing images are present and a color/HDR/quality field is dirty: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:285-295`.
- The same card always renders "Re-encode existing photos" with a "Re-encode now" button when images exist: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:306-327`.
- The localized copy admits the in-app button only processes photos below the current pipeline version and settings-only changes need the sidecar backfill with `--force-reencode`: `apps/web/messages/en.json:765-768`.
- The runner candidate query confirms the in-app path selects only `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)`: `apps/web/src/lib/admin-backfill-runner.ts:387`, `apps/web/src/lib/admin-backfill-runner.ts:417`.
- The sidecar script has the `--force-reencode` bypass for all processed images; the in-app path does not expose that mode: `apps/web/scripts/backfill-color-pipeline.ts:282`, `apps/web/scripts/backfill-color-pipeline.ts:335-337`.

Failure scenario:
An operator changes JPEG quality, AVIF effort, or chroma settings, sees the "Backfill required" state, clicks the adjacent "Re-encode now" button, and gets "All photos are already at the current pipeline version. Nothing to re-encode." They reasonably believe GalleryKit has either applied the setting or failed silently, because the primary UI action cannot perform the required work for that state.

Suggested fix:
Split the UI into state-specific actions. When dirty settings require `--force-reencode`, either disable the in-app button with a clear "Use sidecar forced re-encode" callout or add a guarded in-app forced re-encode flow. The visible CTA should not be the primary action unless it can actually satisfy the banner's claim.

### PMR22-03 - README is more accurate than before, but still lacks proof-led positioning

Severity: Medium
Confidence: Medium-High
Status: Confirmed

Evidence:
- The current tagline and intro now name a real wedge: finished photography, accurate color, private originals, and operator-controlled search: `README.md:7-9`, `README.md:29`.
- The next section immediately becomes a dense feature list covering masonry, formats, color science, semantic search, PWA, sharing, admin, i18n, and Docker: `README.md:31-46`.
- The "not a photo editor, culler, or scoring tool" boundary is present and important, but it appears after several feature bullets instead of as part of the first positioning decision: `README.md:44`.
- The strongest proof points are scattered across docs and implementation: color/HDR decision matrix in `CLAUDE.md:267-305`, semantic-search limits in `apps/web/README.md:59-80`, upload API contract in `README.md:200-211`, and privacy/backup boundaries in `apps/web/messages/en.json:18-24`, `apps/web/messages/en.json:786-794`.

Failure scenario:
A photographer comparing GalleryKit against Immich, PhotoPrism, WordPress gallery plugins, Lightroom Web, or a static portfolio gets an impressive implementation inventory but not an immediate "choose this if..." story. The product's truth is good; the marketing architecture still makes evaluators assemble it themselves.

Suggested fix:
Keep the technical bullets, but move them under a proof-led hierarchy:
1. "For / not for" in the first viewport: finished-photo publishing, not editing/culling/proofing SaaS.
2. Three buyer outcomes: color-faithful delivery, private originals, operator-owned search/sharing.
3. Proof points under each outcome: color matrix, public/privacy field guards, semantic-search gates, upload API contract, PWA/offline limits.
4. A first-run success checklist with screenshots or demo paths.

## Confirmed Accurate / Not Re-filed

- Semantic search copy is currently careful: disabled by default, stub is called non-meaningful/testing-only, production is operator-gated, newest-first bounded scan is disclosed, and similar photos are production-only (`README.md:39`, `apps/web/README.md:61-80`, `apps/web/messages/en.json:413-418`, `apps/web/src/app/api/search/similar/[id]/route.ts:110-126`).
- Upload API/Lightroom positioning has improved: docs say server API only and no bundled Lightroom Classic plugin (`README.md:200-211`, `apps/web/README.md:82-91`, `apps/web/messages/en.json:817-819`).
- Auto alt-text overclaim from the prior cycle is addressed in visible copy: the UI now says "EXIF Alt-Text Hints" and explicitly says model-generated descriptions are future work (`apps/web/messages/en.json:734-737`).
- PWA copy is narrow and matches the service worker posture: visited image caching plus offline HTML fallback, not full offline sync (`README.md:40`, `apps/web/public/sw.js:7-19`).
- Privacy/map copy matches the implementation: standard public pages exclude GPS, and the public map only exposes coordinates for map-visible topics (`apps/web/messages/en.json:793-794`, `apps/web/src/lib/data.ts:410-416`, `apps/web/src/lib/data.ts:1650-1689`).
- Storage backend honesty is intact: CLAUDE warns local filesystem only, and I found no public S3/MinIO support claim.

## Final Sweep

I re-ran targeted searches after drafting the findings and checked the current code paths behind each candidate claim. I did not run tests because this was a static product/truthfulness review and the user explicitly requested no source edits. I did not commit or push.

## Final Verdict

Wait on broad launch positioning until the README lead resolves the analytics-control ambiguity and the Settings re-encode action no longer promises work it cannot perform. The product itself is more honest than most self-hosted gallery projects; the remaining work is to make the first five minutes of evaluation match that honesty.

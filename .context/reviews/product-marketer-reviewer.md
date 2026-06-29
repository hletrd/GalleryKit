# Product Marketer Review - Cycle 12

Date: 2026-06-29
Reviewer: product-marketer-reviewer
Repository: GalleryKit
Scope: Product positioning, public/user-facing copy, onboarding, trust, deployment docs, feature discoverability, SEO/marketing surfaces, market fit for photographers/self-hosters, and claim-versus-engineering reality for `/Users/hletrd/flash-shared/gallery`.

## Profile Adaptation Note

The local `product-marketer-reviewer` perspective is BurstPick/Swift-specific. I used only its reviewer-style lens: claim truthfulness, onboarding clarity, market fit, support-risk detection, and whether marketing promises match implemented behavior. I adapted it to this actual repo: GalleryKit, a self-hosted Next.js photo gallery for photographers/operators.

No product fixes or code changes were implemented. This file is the review artifact.

## Inventory Built Before Findings

Primary docs and README-like surfaces reviewed:

- `AGENTS.md` instructions supplied in the prompt
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.env.local.example`
- `.env.deploy.example`
- `LICENSE`
- `.github/workflows/quality.yml`
- `.github/dependabot.yml`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `.context/reviews/` review history as prior-context inventory; current findings below are against live docs/code

User-facing copy and configuration reviewed:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`

Public product, SEO, and trust surfaces reviewed:

- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/manifest.ts`
- Public feed, Open Graph, and metadata behavior reachable through the app routes inspected during the claim pass

Admin/onboarding/product-control surfaces reviewed:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/nav-client.tsx`

Engineering reality checked for claims:

- `package.json`
- `apps/web/package.json`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/nginx/default.conf`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`
- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-embedding-constants.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/admin-tokens.ts`

Focused final sweeps:

- Searched claim-sensitive terms: `semantic`, `AI`, `CLIP`, `Lightroom`, `plugin`, `privacy`, `GPS`, `analytics`, `HDR`, `wide-gamut`, `color-gamut`, `PWA`, `offline`, `S3`, `MinIO`, `Stripe`, `payment`, `pricing`, `culling`, `scoring`, `editing`, `deploy`, `nginx`, `server_name`, and `site-config`.
- Checked bilingual copy where the issue can affect both English and Korean users.
- Checked current worktree status before writing. Unrelated modified files existed at `.context/reviews/test-engineer.md` and `.context/reviews/tracer.md`; this review did not touch them.

## Executive Summary

GalleryKit's overall product positioning is mostly honest and strong: the repo consistently presents a self-hosted photographer gallery, not a SaaS marketplace, editor, culler, scoring tool, or payment product. Version and stack claims align with package metadata. The privacy, backup/restore, PWA, color/HDR, single-writer deployment, and production semantic-search guardrails are generally backed by code.

The remaining product-marketing risks are sharper onboarding mismatches: the root README markets semantic search without the bounded-scan limitation that the app README and code enforce; docs/comments still imply a Lightroom publish plugin even though the product only ships a server-side upload API; Firefox display copy is technically inaccurate versus the repo's own browser matrix; and the nginx self-hosting doc points users to a config that still contains the production domain without calling out the required edit.

Finding count: 4 issues.

| Severity | Confirmed | Likely | Risk |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 2 | 0 | 0 |
| Low | 1 | 0 | 1 |

## Findings

### PMR-C12-01 - Root README over-promises semantic search completeness for larger galleries

Severity: Medium
Confidence: High
Classification: Confirmed claim-vs-engineering-reality issue

Exact regions:

- `README.md:37` markets semantic search as natural-language English/Korean photo search plus similar photos, powered by local CLIP, disabled by default and live on the demo.
- `apps/web/README.md:56-62` gives the missing caveat: the feature is fully self-hosted, but scan scope is bounded and searches newest embeddings first; large galleries may not surface relevant older photos unless re-uploaded or re-embedded after a backfill.
- `apps/web/src/lib/clip-embeddings.ts:22-44` implements `SEMANTIC_SCAN_LIMIT`, defaulting to `2000` and clamping env overrides to `25_000`.
- `apps/web/src/app/api/search/semantic/route.ts:257-269` scans only the most recent embeddings for the active model and limits rows by `SEMANTIC_SCAN_LIMIT`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-150` applies the same newest-first capped candidate set to similar-photo search.

Failure scenario:

A photographer self-hosts GalleryKit with 8,000-20,000 photos, sees the root README's semantic-search feature bullet, completes model setup/backfill, and expects natural-language and similar-photo search to cover the whole library. Relevant older photos outside the newest-first scan window can be absent even with valid embeddings. From the user's point of view, that looks like low-quality or broken AI search, not an operator-tunable performance guardrail.

Suggested fix:

Add the bounded-scan caveat to the root README feature bullet or a nearby semantic-search subsection. State the default and hard cap plainly: newest embeddings first, default scan limit 2,000, env-tunable up to 25,000, and large libraries need deliberate backfill/re-embedding strategy or future ANN indexing for whole-catalog recall. Mention that similar-photo search has the same candidate cap.

### PMR-C12-02 - Lightroom wording implies an included publish plugin that GalleryKit does not ship

Severity: Medium
Confidence: High
Classification: Confirmed onboarding/support-risk issue

Exact regions:

- `README.md:150` says `/api/admin/lr/upload` is capped at 216 MiB "so Lightroom publishes are not caught" by the generic admin API cap.
- `apps/web/README.md:47` repeats that the route cap exists so "Lightroom publishes bypass" the generic cap.
- `CLAUDE.md:152` describes `admin_tokens` as "Lightroom Classic publish-plugin PATs" and says "The plugin (`/api/admin/lr/upload`) accepts the token..."
- `apps/web/nginx/default.conf:122-128` comments describe "Lightroom Classic publish-plugin upload" and say the generic cap would silently break "the LR publish integration."
- `apps/web/messages/en.json:800-802` is more precise in the product UI: upload API tokens are for server-side upload integrations, and "GalleryKit does not bundle or distribute a Lightroom Classic plugin."
- `apps/web/messages/ko.json:850-852` gives the same Korean UI clarification.
- `apps/web/src/app/api/admin/lr/upload/route.ts:4-8` confirms the implementation accepts external upload clients, including a Lightroom Classic publish-client implementation, but exposes the server-side API only and does not bundle or distribute a plugin.

Failure scenario:

A self-hoster or photographer reads the README/nginx/CLAUDE wording and expects GalleryKit to include a ready-to-install Lightroom Classic publish plugin. They reach the admin token page and discover only API token generation, with the UI explicitly saying no plugin is bundled. That gap creates avoidable support churn and makes the integration feel missing or hidden.

Suggested fix:

Standardize public docs and comments on "external upload API" or "Lightroom-compatible upload endpoint." If the project wants to claim Lightroom integration, add the precise status in the README: GalleryKit ships the authenticated server endpoint and token UI, not a bundled Lightroom plugin. Include the required header, route, upload expectations, and a curl or third-party-client example.

### PMR-C12-03 - Firefox display-detection copy contradicts the repo's own browser matrix

Severity: Low
Confidence: High
Classification: Confirmed technical-copy issue

Exact regions:

- `apps/web/messages/en.json:739-740` tells admins: "Firefox does not support the color-gamut media query..."
- `apps/web/messages/ko.json:739-740` says the same in Korean.
- `CLAUDE.md:303` says Firefox parses the media-query syntax since version 110, but it always returns false because wide-gamut rendering is not implemented.
- `CLAUDE.md:356-367` repeats the browser matrix: Firefox 124+ parses `(color-gamut: p3)`, always returns false due to Mozilla bug 1626624, and suppresses P3 badges and hints for all Firefox visitors.
- `CLAUDE.md:374` notes Firefox 110+ parses the syntax, but practical behavior is the same as older unsupported versions because it always returns false.

Failure scenario:

An operator debugging color/HDR visibility reads the admin settings note and concludes Firefox lacks the media query itself. The actual problem is subtler: modern Firefox parses the query but reports no P3/wide-gamut capability. The current copy weakens trust in GalleryKit's otherwise careful color-management documentation.

Suggested fix:

Change the English and Korean strings to explain the real behavior: Firefox 110+ parses `color-gamut`, but currently reports no wide-gamut/P3 support, so GalleryKit conservatively hides gamut/HDR badges and the educational hint unless "Force Show Color Chips" is enabled. Keep the old "no support" phrasing only for Firefox <= 109 if the UI needs that distinction.

### PMR-C12-04 - Self-hosting nginx guidance points to a config with the production domain hardcoded

Severity: Low
Confidence: Medium
Classification: Risk

Exact regions:

- `README.md:188` tells operators that the checked-in `apps/web/nginx/default.conf` matches the documented host-side nginx + app-container deployment and can be adapted for custom static upload serving.
- `apps/web/README.md:49-50` similarly describes the checked-in compose/nginx topology.
- `apps/web/nginx/default.conf:21-28` defines the server block with `server_name gallery.atik.kr;`, followed by comments about TLS edge behavior.

Failure scenario:

A self-hoster copies the checked-in nginx config to a multi-vhost server for `photos.example.com`, edits upload paths and TLS separately, but misses the `server_name` value. Depending on nginx default-server order, requests may fall through to another server block or miss GalleryKit's body-size/private-originals rules. This is not a code vulnerability by itself, but it is a common deployment-onboarding footgun.

Suggested fix:

Make the self-hosting doc call out `server_name` replacement explicitly, or convert the checked-in config comment to an obvious placeholder instruction near `server_name`. Example: `server_name gallery.example.com; # replace with your public gallery host`. If `gallery.atik.kr` is intentionally the production deploy config, document that self-hosters must copy and edit it rather than use it verbatim.

## Aligned / No-Action Checks

- Stack/version positioning is aligned. `README.md` claims Next.js 16, React 19, TypeScript 6, Node 24+, and MySQL 8+; `apps/web/package.json` and root package scripts support those claims.
- "Not a photo editor, culler, or scoring tool" is correctly stated in `README.md:42`; I did not find active user-facing promises for culling/scoring/payment workflows.
- Storage claims are restrained. `CLAUDE.md` says local filesystem is the only implemented storage backend and not to document S3/MinIO as supported; current public README copy does not market S3/MinIO support.
- Privacy/backup wording is generally better than typical self-hosted-gallery docs. The DB backup/restore copy in `apps/web/messages/en.json` and `ko.json` correctly says it backs up database rows and does not snapshot file storage.
- Production semantic-search honesty gates are real. `gallery-config.ts` heals stored `production` mode back to `disabled` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, and the route returns 503 rather than serving stub vectors under the production label when real embeddings are missing.
- PWA/offline claims are supported by the service worker implementation: admin/API/share-sensitive paths are bypassed, HTML uses network-first behavior with offline fallback, and images use cache-first/stale-while-revalidate style handling.
- SEO basics are implemented, not just claimed: localized metadata, canonical/hreflang links, sitemap generation, robots rules, manifest generation, feed/OG surfaces, and DB-fallback behavior were present.
- Public color/HDR claims are mostly careful: the README states HDR ingest is opt-in and gain-map detection is admin audit only; admin settings expose the corresponding controls and warnings.

## Final Sweep Notes

- I did not review generated dependency directories, runtime upload data, local build artifacts, or test output as product/source-of-truth surfaces.
- I checked prior `.context/reviews/` context for review continuity, but treated current source/docs as authoritative.
- I found no current marketing copy promising paid downloads, Stripe checkout, S3/MinIO storage, horizontal scaling, role-based permissions, or bundled AI captioning beyond the current EXIF-placeholder disclosure.
- The strongest cycle-12 fix candidates are doc/copy changes, not code behavior changes: semantic-search scale caveat, Lightroom endpoint naming, Firefox detection wording, and nginx self-hosting instructions.

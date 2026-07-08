# Product Marketer Reviewer - Run-10 Cycle 34

Review target: current `HEAD` `e94455d3`.

Role surface: registered `~/.codex/agents/product-marketer-reviewer.md` reviewer-style lane, adapted to GalleryKit. I treated the BurstPick-specific text in that surface as non-applicable and used the underlying mandate: verify public/product/operator claims against source evidence.

Scope: product-facing messaging, public UX copy, SEO/discoverability, docs/product-promise alignment, no-payment/no-editing photographer constraints, i18n copy, and operator-facing communication. Review-only: this artifact is the only intended file change.

## Relevant Inventory

Primary docs and operator promises:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/scripts/ensure-site-config.mjs`

Public metadata, SEO, and discoverability:

- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/nav-client.tsx`

Public UX copy and i18n:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/download-button.tsx`
- `apps/web/src/components/photo-lightbox.tsx`

Admin/operator communication:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/[locale]/admin/(protected)/db-tools/db-tools-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/upload/upload-client.tsx`

Product-claim source checks:

- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/cycle-24-source-contracts.test.ts`
- `apps/web/e2e/semantic-search.spec.ts`
- historical `docs/`, `plan/`, and `.context/plans|reviews` references for payment/editing/search drift

## Executive Summary

One confirmed product trust issue remains from the current repository state: the checked-in `site-config.json` is a real Atik deployment config, and the production validation path accepts it. That can make a fresh self-hosted install publish another operator's brand, canonical URL, OpenGraph metadata, sitemap URLs, and footer fallback if `BASE_URL` or DB SEO settings are absent.

I did not find another confirmed current product-copy mismatch. The active docs and EN/KO UI copy are generally careful about the major constraints: no payment/proofing/editing/culling/scoring workflow, no bundled Lightroom Classic plugin, semantic search is operator-gated and disabled by default, stub search is explicitly non-semantic, public HDR delivery is not promised yet, auto alt text is EXIF-derived, storage is local filesystem only, and DB backups are rows-only/plaintext-at-rest.

## Confirmed Issues

### PMR-C34-01 - Checked-in Atik config can become a fresh deploy's public brand and canonical URL

Severity: Medium  
Confidence: High  
Status: Confirmed

Exact file/region:

- `apps/web/src/site-config.json:2-10`
- `apps/web/scripts/ensure-site-config.mjs:4-12`, `apps/web/scripts/ensure-site-config.mjs:14-42`
- `apps/web/src/lib/data.ts:1851-1872`, `apps/web/src/lib/data.ts:1887-1896`
- `apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/sitemap.ts:70-113`
- `apps/web/src/app/[locale]/layout.tsx:15-48`
- `apps/web/src/components/footer.tsx:33-37`
- `README.md:60-77`, `README.md:121-122`, `README.md:171-172`, `README.md:198-200`
- `apps/web/README.md:19-20`, `apps/web/README.md:49-51`

Why this is a problem:

The committed config is deployment-specific: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and Atik footer/nav text. The docs warn operators to customize `site-config.json`, but the target file already exists in a fresh clone. The production guard rejects placeholder hosts such as `example.com` and localhost, but `gallery.atik.kr` is a real URL, so it passes validation as a production fallback.

Concrete user/operator failure scenario:

A self-hosting photographer or studio clones GalleryKit, creates environment variables, sees `apps/web/src/site-config.json` already present, and builds without `BASE_URL`. If DB SEO settings are not yet initialized or temporarily unavailable, the app can emit sitemap entries, canonical metadata, OpenGraph defaults, footer text, and fallback SEO settings for Atik's gallery. Crawlers and social previews can index the wrong host/brand, while the operator experiences the project as unsafe or overly specific to the original deployment.

Suggested fix:

Track only `site-config.example.json` and gitignore the real deployment `site-config.json`; or replace the committed file with a generic placeholder that production validation rejects unless `BASE_URL` or DB SEO settings provide a real host. If this repository must keep the Atik config for its primary deployment, require an explicit deployment env such as `GALLERYKIT_ALLOW_ATIK_SITE_CONFIG=true` before `gallery.atik.kr` passes production validation. Add a source test proving a production build without `BASE_URL` refuses the checked-in deployment-specific config in distributable mode.

## Likely Issues

None found in active public docs, active UI copy, current config surfaces, or operator-facing admin copy.

Historical notes: old plans, migrations, and review files still contain Stripe/payment/entitlement terminology because those features were removed over time. I did not count this as a likely active issue because current README/app README/About copy explicitly says GalleryKit is not a payment/proofing system (`README.md:33-35`, `README.md:54`, `apps/web/messages/en.json:831-839`, `apps/web/messages/ko.json:831-839`), and `CLAUDE.md:655` documents that Stripe/paid downloads were removed.

## Risks Needing Manual Validation

- Live deployment state: I reviewed repository source, not the running `https://gallery.atik.kr` deployment. Production DB SEO settings, semantic-search mode, seeded model weights, embedding counts, analytics settings, and actual rendered metadata need live validation.
- External marketing channels: I did not review GitHub release pages, package metadata, screenshots, blog posts, social posts, or hosted docs outside this checkout. Those channels could still overpromise removed payment/editing/AI/search features.
- Browser-rendered UX: I inspected source and messages rather than running a browser pass. Manual/browser validation should confirm no locale interpolation, responsive truncation, or route-level metadata behavior changes the copy in production.
- Historical docs exposure: `docs/`, `plan/`, `.context/plans/`, and `.context/reviews/` include deliberately historical content. If any of those are published as user docs, old payment/search/deployment language should be curated or labeled as archival.

## Claim Checks

No-payment/no-editing photographer constraints: supportable. `README.md:33-35` defines GalleryKit as finished-photo publishing, not editing/culling/scoring/proofing/payment/SaaS. `README.md:54` repeats that admin batch operations are metadata-only. EN/KO About copy mirrors the constraint at `apps/web/messages/en.json:831-839` and `apps/web/messages/ko.json:831-839`.

Semantic search: supportable. `README.md:50` and `apps/web/README.md:66-92` describe disabled-by-default, operator-runbook activation, local/offline inference after model seeding, and bounded newest-first scans. Settings copy and behavior keep production activation out of the admin UI (`apps/web/messages/en.json:771-781`, `apps/web/messages/ko.json:771-781`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:813-876`, `apps/web/src/app/actions/settings.ts:102-103`). Public search labels distinguish stub mode from production semantics (`apps/web/src/components/search.tsx:532-568`), and similar photos are hidden outside production mode (`apps/web/src/components/similar-photos.tsx:141`).

SEO/discoverability: mostly supportable except PMR-C34-01. Metadata, sitemap, and DB SEO settings consistently use `BASE_URL || siteConfig.url` (`apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/[locale]/layout.tsx:15-48`, `apps/web/src/lib/data.ts:1851-1872`). The risk is not inconsistent plumbing; it is that the checked-in fallback is a real deployment identity.

Privacy/analytics: supportable. Privacy copy discloses optional Google Analytics, first-party view events, rate-limit IP buckets, and OpenStreetMap tiles (`apps/web/messages/en.json:841-851`, `apps/web/messages/ko.json:841-851`). GA only loads when the build-time config value validates (`apps/web/src/app/[locale]/(public)/layout.tsx:23-35`), and the privacy page derives its GA disclosure from the same config (`apps/web/src/app/[locale]/(public)/privacy/page.tsx:13-32`).

HDR/color: supportable. Upload and settings copy say HDR source retention does not mean public HDR delivery (`apps/web/messages/en.json:176`, `apps/web/messages/ko.json:176`, `apps/web/messages/en.json:383-385`, `apps/web/messages/ko.json:383-385`, `apps/web/messages/en.json:784-789`, `apps/web/messages/ko.json:784-789`). CLAUDE reinforces that public derivatives remain SDR until HDR output ships.

Auto alt text: supportable. Docs/settings frame it as EXIF-derived suggestions, not hosted AI captioning (`apps/web/README.md:94-97`, `apps/web/messages/en.json:767-770`, `apps/web/messages/ko.json:767-770`).

Upload/API/LR positioning: supportable. `README.md:218-227`, `apps/web/README.md:98-107`, and token copy at `apps/web/messages/en.json:875-903` describe a PAT-authenticated upload API and explicitly say no Lightroom Classic plugin is bundled.

Storage and scale: supportable. `CLAUDE.md:159` says the storage abstraction is not integrated and only local filesystem is live. Source comments match this at `apps/web/src/lib/storage/index.ts:5-12`. I did not find active S3/MinIO support promises.

Operator backups/admins: supportable. DB tools copy says backups cover database rows, are plaintext at rest, and exclude originals/derivatives/resources (`apps/web/messages/en.json:18-46`, `apps/web/messages/ko.json:18-46`). User-management copy says every admin has root access (`apps/web/messages/en.json:47-65`, `apps/web/messages/ko.json:47-65`).

## Final Sweep

Missed-issue checks completed:

- Searched for active `Stripe`, `checkout`, `paid`, `license`, `entitlement`, `proof`, `cull`, `score`, `edit`, `Lightroom`, `S3`, `MinIO`, `semantic`, `HDR`, `analytics`, `GPS`, `OpenStreetMap`, `alt text`, and `BurstPick` claims across docs/source/messages.
- Confirmed active public copy does not promise payments, proofing, editing, culling, scoring, hosted SaaS, S3/MinIO storage, one-click production semantic search, full offline gallery sync, encrypted app-level backups, or admin role separation.
- Confirmed EN/KO copy is aligned on the no-payment/no-editing, semantic-search, HDR, privacy, backup, token, and upload constraints inspected in this pass.
- Did not run lint/typecheck/tests/build because this was review-only and changed only this markdown artifact.
- Did not commit, push, deploy, or modify source files.

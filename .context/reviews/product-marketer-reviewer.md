# Product Marketer Reviewer - Cycle 24

Review target: current `HEAD` `4b43fad7`.

Role surface: product/docs/user-facing claim truthfulness and market-positioning risk for GalleryKit as a self-hosted photo gallery. BurstPick-specific assumptions were not used.

## Executive Summary

One confirmed trust/positioning issue remains: the repository tracks a real Atik deployment `site-config.json`, and the production validation path accepts it as a valid canonical fallback. A fresh self-hosting operator can therefore ship the wrong public brand/canonical URL if they miss the config customization step.

I did not find additional confirmed misleading claims in the reviewed docs/UI copy. The current README, app README, About/Privacy pages, settings copy, token copy, and source comments are mostly careful about the major product boundaries: semantic search is operator-gated and disabled by default, no Lightroom Classic plugin is bundled, no payment/proofing/editor/scoring feature is promised, DB backups are rows-only/plaintext-at-rest, HDR ingest is SDR delivery, admin users are root admins, storage is local filesystem only, and PWA support is not full offline sync.

## Confirmed Issues

### PMR-C24-01 - Checked-in Atik site config can silently become a fresh deploy's public brand/canonical

Severity: Medium  
Confidence: High  
Status: Confirmed

Exact file/region:

- `apps/web/src/site-config.json:2-10`
- `README.md:60-77`, `README.md:121-122`, `README.md:171-172`, `README.md:198-200`
- `apps/web/README.md:19-20`, `apps/web/README.md:49-50`, `apps/web/README.md:57`
- `apps/web/scripts/ensure-site-config.mjs:6-12`, `apps/web/scripts/ensure-site-config.mjs:14-42`
- `apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/sitemap.ts:70-113`
- `apps/web/src/app/[locale]/layout.tsx:15-26`
- `apps/web/src/components/footer.tsx:33-37`
- `apps/web/src/lib/data.ts:1866-1890`

Why this is a problem:

The committed config is deployment-specific: `Atik Gallery`, `https://gallery.atik.kr`, `Atik`, and an Atik footer/nav fallback. The docs instruct operators to copy/edit `site-config.example.json`, but the destination already exists in a fresh clone. The production guard rejects placeholders such as `example.com` and localhost, but `gallery.atik.kr` is a real non-placeholder URL, so a production build without `BASE_URL` can pass with someone else's canonical host and brand.

Concrete failure scenario:

A self-hosting operator clones GalleryKit, creates `.env.local`, skips `cp apps/web/src/site-config.example.json apps/web/src/site-config.json` because the file already exists, and builds without `BASE_URL`. The app can publish sitemap entries, `metadataBase`, OpenGraph defaults, footer text, and fallback SEO settings pointing at Atik's deployment. This undercuts the self-hosted trust story and can confuse crawlers, link previews, and users.

Suggested fix:

Track only `site-config.example.json` and gitignore `site-config.json`, or replace the committed config with a generic placeholder that production validation rejects unless `BASE_URL` is explicitly set. If the Atik config must stay for the primary deployment, add a denylist or deployment-specific env requirement so `gallery.atik.kr` cannot pass as an accidental fresh-install fallback. Add a source test proving production build validation refuses the checked-in deployment-specific config when `BASE_URL` is unset.

## Likely Issues

None found in this pass.

## Risks Needing Manual Validation

- Live example deployment state: README correctly warns that `https://gallery.atik.kr` may have deployment-specific model/search state, but I did not validate the live production DB/settings, model weights, or embedding counts.
- External channels: I reviewed repository docs and in-app copy, not GitHub release notes, screenshots, marketplace listings, social posts, or hosted docs outside this checkout.
- Generated build artifacts: I inspected source/runtime paths, not `.next` output or a running browser session for this pass.

## Claim Checks

Semantic search: supportable. `README.md:50` and `apps/web/README.md:65-91` describe disabled-by-default, operator-runbook production activation, local/offline inference after model seeding, and bounded newest-first scans. Source supports this via `apps/web/src/lib/gallery-config-shared.ts:119-128` and `apps/web/src/lib/gallery-config-shared.ts:176-228`, Settings only writing Disabled/Stub in `settings-client.tsx:813-874`, and the public search UI warning in `search.tsx:536-570`.

No editor/culling/scoring/payment/proofing/BurstPick positioning: supportable. `README.md:33-54` and `apps/web/messages/en.json:831-839` explicitly define GalleryKit as finished-photo publishing and say it is not an editor, culling station, scoring tool, proofing portal, payment system, hosted SaaS workflow, or bundled Lightroom Classic plugin. No `BurstPick` claims were found in the reviewed source/docs.

Upload integration: supportable. `README.md:216-227`, `apps/web/README.md:97-106`, and `apps/web/messages/en.json:875-895` describe a PAT-authenticated upload API and token risk, not a bundled Lightroom plugin.

Privacy/analytics: supportable. `apps/web/messages/en.json:841-849` discloses optional Google Analytics, first-party view events, rate-limit IP buckets, and OpenStreetMap tiles. Source aligns: public layout loads GA only when `siteConfig.google_analytics_id` validates (`layout.tsx:23-35`), analytics helpers persist country/referrer summaries rather than full IPs (`analytics.ts:1-11`, `schema.ts:255-296`), and rate-limit buckets can store IPs (`schema.ts:244-251`).

Backups/restore: supportable. README/app README and admin UI copy state that backups are database rows only, plaintext at rest, and do not include originals/derivatives/resources (`README.md:180`, `apps/web/README.md:59-60`, `apps/web/messages/en.json:16-22`).

HDR/color: supportable. README and Settings copy state HDR ingest is gated and public derivatives are SDR until HDR delivery ships (`README.md:46`, `apps/web/messages/en.json:176`, `apps/web/messages/en.json:784-787`). CLAUDE and source reinforce that public HDR badges are hidden until bytes fulfill the claim.

Storage and scale: supportable. `CLAUDE.md:159` says the storage abstraction is not a live S3/MinIO feature, and README deployment copy calls out single web-instance/single-writer topology plus local filesystem persistence (`README.md:175`, `CLAUDE.md:245-249`, `CLAUDE.md:531`).

Auto alt text: supportable. Settings and docs call this EXIF-derived hints, not model-generated captions (`apps/web/messages/en.json:767-770`, `CLAUDE.md:635-637`), with a source-contract test guarding active comments (`apps/web/src/__tests__/cycle-24-source-contracts.test.ts:50-63`).

## Final Sweep

Examined categories:

- Root/app docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/plans/README.md`
- Config/deploy docs and source: `site-config.json`, `site-config.example.json`, `ensure-site-config.mjs`, sitemap, root metadata, footer, SEO fallback accessors
- Public pages/copy: About, Privacy, footer/nav/search, EN/KO messages
- Admin/user-facing copy: Settings, DB backup/restore, admin users, upload, token pages/messages
- Claim-verification source: semantic config/UI, search UI, analytics/privacy helpers/schema, storage abstraction notes, rate-limit buckets, backup/restore docs, free-download/auto-alt source-contract tests

Common missed issues checked:

- No current BurstPick naming or positioning claims found.
- No current Stripe/payment/entitlement product promise found.
- No bundled Lightroom Classic plugin promise found.
- No S3/MinIO/storage-backend support promise found.
- No production semantic search one-click/admin-UI activation promise found.
- No full offline gallery sync promise found.
- No app-level encrypted backup promise found.
- No admin role/capability separation promise found.

No destructive commands were run. No source files were edited.

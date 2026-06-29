# Product Marketer Review - Cycle 17

Date: 2026-06-30
Reviewer lane: product-marketer-reviewer
Scope: GalleryKit only. I read `AGENTS.md`, `CLAUDE.md`, the local product-marketer prompt, and applied only the prompt's general trust-first / claim-verification principles. I did not require any BurstPick-specific files.

## Executive Summary

I found 6 product/copy/positioning issues: 5 confirmed and 1 likely. The most important issue is an admin trust mismatch: the settings UI says changed color/HDR encoder settings can be applied through the in-app "Re-encode existing photos" control, but the in-app runner only processes photos whose `pipeline_version` is behind the current code. A settings-only change on already-current photos can therefore no-op while the copy implies success.

Most public claims are unusually well qualified. The README and operator docs are honest about no editor/culling/scoring features, no bundled Lightroom plugin, semantic search being operator-gated, local-only storage, SQL-only backups, PWA limits, and single-instance deployment constraints. The remaining risks are primarily hierarchy and runtime-state mismatches: honest caveats exist in docs, but the public/admin UI sometimes omits them at the decision point.

## Inventory Reviewed

- Public/product docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`
- Defaults and identity surfaces: `apps/web/src/site-config.json`, `apps/web/src/site-config.example.json`, SEO/admin messages, footer defaults
- Public UI and routes: home metadata, privacy page, search toggle, similar photos, color/HDR display, upload dropzone
- Admin UI and operator copy: settings, image-processing/backfill, semantic-search mode, DB backup/restore, users, upload API tokens
- Localization: `apps/web/messages/en.json` and matching Korean keys for search, HDR, backfill, upload API tokens, privacy, upload warnings
- Implementation checks: semantic-search routes, CLIP scan limits, admin backfill runner, color backfill sidecar, HDR ingest/render gating, token scopes, GPS stripping, storage abstraction

## Findings

### PMR17-01 - In-app re-encode copy over-promises settings backfills

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/messages/en.json:757` (`settings.backfillRequiredHint`) says changing color/HDR encoder settings requires running the backfill before new encoding takes effect for existing images.
- `apps/web/messages/en.json:759` (`settings.backfillTriggerHint`) says the in-app trigger is "Safe to run after a pipeline version bump or after changing color/HDR settings above."
- The Korean mirror makes the same promise at `apps/web/messages/ko.json:757-759`.
- The settings screen shows that banner and trigger when dirty color-impacting fields exist at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:253-280`.
- The in-app runner selects only `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)` at `apps/web/src/lib/admin-backfill-runner.ts:383-388` and `apps/web/src/lib/admin-backfill-runner.ts:413-418`; its own comment says already-completed rows are filtered out at `apps/web/src/lib/admin-backfill-runner.ts:45-51`.
- The sidecar script has the missing behavior via `--force-reencode`, which bypasses the version check at `apps/web/scripts/backfill-color-pipeline.ts:331-340`.
- `CLAUDE.md:323` correctly says flipping admin tunables requires a backfill pass, but does not distinguish the in-app runner from the force sidecar path.

Failure scenario:
An operator changes `force_srgb_derivatives`, JPEG chroma, AVIF effort, quality, or wide-gamut pixel cap after all photos are already at pipeline version 7. The UI says to re-encode and presents a live-host button. The runner finds zero candidates because no `pipeline_version` is behind current code, returns a clean no-op, and existing derivatives keep the old bytes. The operator can leave with false confidence that the new color/HDR policy was applied.

Suggested fix:
Either make the in-app trigger support an explicit settings-change force mode, or narrow the copy. For example: "This button only applies pipeline-version backfills. For settings-only re-encodes of current photos, run `scripts/backfill-color-pipeline.ts --force-reencode` from a sidecar." If a force mode is added in-app, make the confirmation explicit because it rewrites every processed derivative.

### PMR17-02 - Demo URL can still become a self-hosted install's production identity

Severity: High
Confidence: High
Status: Confirmed

Evidence:
- The product is positioned as self-hosted at `README.md:8` and in the feature list at `README.md:40-44`.
- Production docs say to set `BASE_URL` or replace `site-config.json.url` with a non-placeholder origin before build at `README.md:148` and `apps/web/README.md:42`.
- The tracked runtime config still contains the live demo origin, not a placeholder: `apps/web/src/site-config.json:4`.
- The example config uses the rejected placeholder `https://example.com` at `apps/web/src/site-config.example.json:4`.
- The same tracked defaults publish generic product identity through `title`, `description`, `author`, nav title, and footer at `apps/web/src/site-config.json:2-9`.

Failure scenario:
A new operator clones the repo and builds without `BASE_URL` because a non-placeholder `src/site-config.json` already exists. Public metadata, canonical/social surfaces, feed/sitemap-style URLs, and footer/brand defaults can point at the GalleryKit demo or product brand instead of the photographer's domain. That undermines the self-hosted positioning and can create SEO/social-preview confusion after launch.

Suggested fix:
Do not ship a real demo domain in the tracked runtime config. Use a production-rejected placeholder in `src/site-config.json`, add `gallery.atik.kr` to the forbidden demo-host list unless a demo-only escape hatch is set, or move the demo config to deploy-local state. Add a first-run/admin SEO warning until the public URL and title are changed from product defaults.

### PMR17-03 - Public semantic-search UI omits the bounded-scan recall caveat in production

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- README copy is precise: semantic results are a "bounded newest-first embedding scan, not a vector index" at `README.md:37`.
- Operator docs repeat that very large galleries need tuning or a future vector index at `apps/web/README.md:58` and spell out scan scope at `apps/web/README.md:65`.
- Public UI only labels the switch "Semantic search" via `apps/web/messages/en.json:413` / `apps/web/messages/ko.json:413`.
- The production UI intentionally omits the disclaimer; it is shown only in stub mode at `apps/web/src/components/search.tsx:491-499`.
- The endpoint actually scans only the most recent embeddings at `apps/web/src/app/api/search/semantic/route.ts:1-10` and `apps/web/src/app/api/search/semantic/route.ts:261-273`.
- Similar photos uses the same newest-first cap at `apps/web/src/app/api/search/similar/[id]/route.ts:15-21` and `apps/web/src/app/api/search/similar/[id]/route.ts:143-156`.
- The default cap is 2,000 embeddings at `apps/web/src/lib/clip-embeddings.ts:43-44`.

Failure scenario:
On a gallery larger than the scan limit, a visitor searches for an older relevant photo or opens "Similar photos" for an older image. The implementation may never inspect the best match, but the public UI presents the feature as normal semantic search. Visitors or photographers may conclude the AI search is low quality, missing Korean/English concepts, or broken, when the real limitation is recall scope.

Suggested fix:
Add a concise production-mode hint where the toggle lives, not only in README. Example: "Searches the newest embedded photos first; very large galleries may miss older matches." For admin/operator views, include the configured `SEMANTIC_SCAN_LIMIT` and link to the backfill/vector-index caveat.

### PMR17-04 - Semantic setup failures are surfaced as "maintenance"

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- The semantic endpoint returns 503 with "Semantic search is not fully configured" when disabled/unconfigured at `apps/web/src/app/api/search/semantic/route.ts:180-184`.
- Production mode with zero real embeddings also returns the same setup-oriented 503 at `apps/web/src/app/api/search/semantic/route.ts:279-283`.
- The search client maps every 503 from the semantic endpoint to the generic `maintenance` state at `apps/web/src/components/search.tsx:193-199`.
- The public message says "Search is temporarily unavailable during maintenance" at `apps/web/messages/en.json:410` and `apps/web/messages/ko.json:410`.
- Admin settings correctly explain that production mode requires env opt-in, weights, and backfill at `apps/web/messages/en.json:730-736` and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:637-685`.

Failure scenario:
An operator enables production semantic search but misses weight seeding, env opt-in, or embedding backfill. Public search reports maintenance rather than "semantic search is not configured yet." The operator investigates restore-maintenance or uptime instead of the actual activation path.

Suggested fix:
Return a machine-readable error code such as `semantic_not_configured` / `no_semantic_embeddings` and map it to setup-specific copy. Keep the generic maintenance message for restore maintenance or infrastructure failures only.

### PMR17-05 - HDR compact labels can still imply HDR output

Severity: Medium
Confidence: Medium
Status: Likely

Evidence:
- The localized badge label is `HDR-capable` at `apps/web/messages/en.json:366`; Korean says `HDR 지원` at `apps/web/messages/ko.json:366`.
- The detailed color section renders the SDR caveat beside that badge at `apps/web/src/components/color-details-section.tsx:544-558`.
- Compact surfaces do not carry the caveat: the lightbox pip announces/renders the same badge at `apps/web/src/components/lightbox-color-pip.tsx:167-189`, and the mobile info sheet hardcodes `HDR` at `apps/web/src/components/info-bottom-sheet.tsx:272-275`.
- The product contract says HDR ingest is admin-gated and current browser derivatives are SDR at `CLAUDE.md:288-292`; upload/settings copy also says public derivatives are SDR tone-mapped at `apps/web/messages/en.json:162` and `apps/web/messages/en.json:739-740`.

Failure scenario:
An admin reviewing an HDR upload sees a compact "HDR-capable" / "HDR" chip and interprets it as an output claim, especially when screenshotting or using the lightbox pip rather than opening the full details section. The longer SDR caveat exists, but it is not present on every surface where the claim appears.

Suggested fix:
Rename the badge everywhere to "HDR source" or "HDR source - SDR delivery"; in Korean, use wording equivalent to "HDR 원본(SDR 제공)" rather than "HDR 지원." Avoid bare `HDR` in compact admin chips until the served derivatives are actually HDR.

### PMR17-06 - Upload API token copy undersells bearer-token risk

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- Token page copy correctly says GalleryKit exposes an API endpoint and no Lightroom Classic plugin is bundled at `apps/web/messages/en.json:810` and `apps/web/messages/ko.json:860`.
- Token creation copy says "Upload access is granted automatically" at `apps/web/messages/en.json:818`; Korean says upload permission is granted automatically at `apps/web/messages/ko.json:868`.
- New token dialog says it will not be shown again at `apps/web/messages/en.json:821` / `apps/web/messages/ko.json:871`, but does not say to treat it as a secret.
- The UI creates tokens with `scopes: ['lr:upload']` at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`.
- The token model supports scopes and expiry, but generated tokens are bearer secrets; scope names are defined at `apps/web/src/lib/admin-tokens.ts:20-25`.
- Existing-token copy says "Never expires; revoke to disable" at `apps/web/messages/en.json:834` / `apps/web/messages/ko.json:884`.

Failure scenario:
An admin treats an upload token like a harmless integration label or plugin code and stores it in chat, docs, or a shared Lightroom preset. Anyone with the token can upload until revoked. The current copy is technically correct, but it does not carry the security weight expected for a long-lived bearer token.

Suggested fix:
Change create/plaintext copy to say: "Creates a bearer token with upload-only scope. Anyone with this token can upload until it expires or is revoked; store it like a password." If expiration is not exposed in the UI, consider adding an expiry choice or explicitly saying "This token does not expire by default."

## Positive Claim Checks

- The README explicitly rejects editor/culler/scoring positioning at `README.md:42`, matching the workspace rule that photos arrive after editing.
- Semantic search docs are strong at the operator level: disabled by default, production-gated, weights not baked, offline CLIP loading, backfill required, and newest-first scan caveats are all documented at `README.md:37`, `apps/web/README.md:58-77`, and `CLAUDE.md:487-523`.
- Admin semantic UI truthfully offers only Disabled/Stub and warns if a raw `production` value exists without operator activation at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:637-685`.
- Auto alt-text copy does not overclaim model captions: `apps/web/messages/en.json:725-728` says Florence-2/local inference is not implemented yet.
- Backup/restore wording is honest that DB backups contain rows only and not original/derivative files at `apps/web/messages/en.json:19`, `README.md:157`, and `CLAUDE.md:209-210`.
- Storage marketing is properly restrained: `CLAUDE.md:142` says local filesystem only and not to expose S3/MinIO as supported.
- Privacy copy correctly states that standard public pages exclude GPS and the public map requires an admin-visible topic at `apps/web/messages/en.json:780-785`; upload UI warns on first upload when GPS stripping is off at `apps/web/messages/en.json:164` and `apps/web/src/components/upload-dropzone.tsx:366-369`.
- Deployment docs do warn that the shipped Docker path is single web-instance/single-writer and should not be horizontally scaled without moving coordination state at `README.md:152`, `apps/web/README.md:50`, and `CLAUDE.md:228`.

## Final Missed-Copy Sweep

I re-swept claim-bearing surfaces for: `GalleryKit`, `self-hosted`, `high-performance`, `demo`, `site-config`, `BASE_URL`, `description`, `footer`, `semantic`, `CLIP`, `AI`, `similar photos`, `production`, `stub`, `maintenance`, `HDR`, `P3`, `wide-gamut`, `SDR`, `Lightroom`, `plugin`, `upload token`, `backup`, `restore`, `GPS`, `privacy`, `PWA`, `offline`, `storage`, `S3`, `MinIO`, `single-writer`, and `role`.

No additional source-backed product/copy mismatches were found beyond the six findings above. I did not implement fixes and did not modify any file other than this review artifact.

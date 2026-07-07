# Product Marketer Reviewer - Cycle 16

Role: `product-marketer-reviewer`
Scope: GalleryKit, a self-hosted Next.js photo gallery. This review adapts the local persona to this repository and intentionally excludes BurstPick, SwiftUI, and desktop-app claims.

## Method And Inventory

I built an inventory from public/operator-facing docs, localized UI copy, metadata/config surfaces, and relevant source that proves or disproves feature claims.

Inspected docs and product copy:

- `README.md`: top-level positioning, feature list, install/deploy, semantic search, upload API.
- `apps/web/README.md`: app setup, semantic search activation, auto alt text, upload API.
- `CLAUDE.md`: architecture, security/ops guidance, semantic-search operator runbook, smart collections notes.
- `apps/web/messages/en.json` and `apps/web/messages/ko.json`: public About/Privacy/admin Settings/token UI copy.
- `apps/web/src/site-config.example.json`, local ignored `apps/web/src/site-config.json`, and site config validation/build helpers.

Inspected source backing claims:

- Public/admin routes under `apps/web/src/app/`.
- PWA implementation: `apps/web/src/app/manifest.ts`, `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`, locale layout service-worker registration.
- Semantic search gates: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, CLIP model scripts/libs.
- Upload token/API surfaces: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/lib/admin-tokens.ts`.
- Analytics/privacy source: `apps/web/src/lib/analytics.ts`, `apps/web/src/db/schema.ts`, public privacy page.
- Docker/site packaging: `apps/web/.dockerignore`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`.

Overall verdict: GalleryKit's top-level positioning is mostly careful and code-backed. The strongest product risks are in operator-facing UI copy where the implementation is safer/more constrained than the words imply.

## Confirmed Issues

### 1. Semantic-search Settings copy implies production CLIP can be enabled from the UI

Severity: Medium  
Confidence: High  
Files/regions:

- `apps/web/messages/en.json:766-769`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:845-852`
- Correct runbook contrast: `apps/web/README.md:82-89`
- Runtime gate: `apps/web/src/lib/gallery-config-shared.ts:223-228`

Why this is a problem:

The Settings copy says "Enable CLIP-based semantic image search" and "Run the backfill script after enabling." In the actual UI, only `Disabled` and `Stub` are selectable; production is intentionally rendered as disabled/read-only unless an operator has already performed the external runbook. The source even documents that production has no user-selectable radio by design at `settings-client.tsx:847-852`.

That means the UI copy sells an operator action the UI cannot actually perform. Worse, the only selectable enabled mode is `Stub`, and the copy says stub embeddings are "not semantically meaningful" only after already framing the feature as "CLIP-based semantic image search."

Concrete failure scenario:

An admin opens Settings, selects `Stub`, sees the public semantic-search control become available, runs the backfill script "after enabling," and tells photographers or visitors that semantic search is active. Visitor results are deterministic wiring-test results rather than meaningful CLIP matches, while similar-photo search remains unavailable because `apps/web/src/app/api/search/similar/[id]/route.ts:115-130` requires production mode.

Suggested fix:

Rewrite the Settings copy to separate wiring tests from production activation. Example direction:

- "This panel can disable semantic search or enable Stub mode for local wiring tests only."
- "Production CLIP search cannot be enabled here. Follow the operator runbook: seed weights, run the production backfill, set the environment gate, redeploy, then set the DB mode."
- Rename or annotate the selectable `Stub` option as "Stub - wiring test only; do not use for public galleries."
- Mirror the same clarification in Korean copy.

### 2. Upload-token copy promises expiry behavior the admin UI does not expose

Severity: Medium  
Confidence: High  
Files/regions:

- `apps/web/messages/en.json:870-880`
- `apps/web/messages/ko.json:920-930`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-103`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:202-248`
- Server support contrast: `apps/web/src/app/actions/lr-tokens.ts:29-33` and `apps/web/src/app/actions/lr-tokens.ts:79-101`

Why this is a problem:

The English UI says upload tokens can be used "until it expires or is revoked," and the Korean copy carries the same promise. The server action supports an optional `expiresAt`, but the admin client never renders an expiry field and creates tokens with only `{ label, scopes: ['lr:upload'] }`. In practice, tokens created through the UI do not expire unless a separate caller supplies `expiresAt` outside this UI.

This is a trust and credential-safety mismatch: the product copy gives operators a safety boundary that the visible workflow does not provide.

Concrete failure scenario:

An operator creates a token for a temporary external publishing client and assumes the token will naturally age out because the dialog says tokens are valid until expiry or revocation. The token actually remains valid indefinitely unless manually revoked, increasing upload-abuse risk if the client machine or token copy is later compromised.

Suggested fix:

Either add an expiry control to the token creation dialog or make the copy explicit that UI-created tokens do not expire by default.

Recommended product fix:

- Add an expiry selector with presets such as 7 days, 30 days, 90 days, and Never.
- Send `expiresAt` to `createLrTokenAction`.
- Keep "Never" available only with clear copy.

Minimal copy fix:

- Change dialog/body text to "Tokens created here do not expire by default; revoke them to disable access."
- Keep the list label `Never expires`, but make it visually prominent for no-expiry tokens.
- Update Korean copy in parallel.

## Likely Issues

No additional likely product-claim issues were strong enough to report as likely defects after source verification. Several initially suspicious claims were code-backed:

- PWA install/cache/offline fallback is backed by `apps/web/src/app/manifest.ts:6-52`, `apps/web/public/sw.template.js:1-24`, and `apps/web/src/lib/sw-cache.ts:17-19`.
- Same-origin/custom OG image constraints are backed by `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:172-184`, `apps/web/src/app/actions/seo.ts:133-140`, and `apps/web/src/lib/seo-og-url.ts:3-43`.
- "No bundled Lightroom Classic plugin" is accurately reflected by the API route comments at `apps/web/src/app/api/admin/lr/upload/route.ts:1-19` and by the README/API docs.
- Docker packaging does not appear to bake local uploads/resources into the image because `apps/web/.dockerignore:27-31` excludes them and `apps/web/docker-compose.yml:24-32` bind-mounts runtime data.

## Manual-Validation Risks

### A. Local ignored site config contains production-looking Atik metadata

Severity: Low  
Confidence: Medium  
Files/regions:

- Local ignored file: `apps/web/src/site-config.json:2-10`
- Ignore rule: `apps/web/.gitignore:48-53`
- Tracked template: `apps/web/src/site-config.example.json`
- Build guard: `apps/web/scripts/ensure-site-config.mjs:14-21` and `apps/web/scripts/ensure-site-config.mjs:28-38`

Why this is a risk:

The tracked repository correctly ships `site-config.example.json`, and `site-config.json` is ignored. However, the local workspace has a real-looking `apps/web/src/site-config.json` with Atik/gallery.atik.kr metadata. The build guard rejects placeholders but does not reject this local production-looking config because it is valid for this deployment.

This is not a confirmed repository defect because the file is ignored and should not ship in clean clones. It is still a manual-validation risk for deployers or reviewers working from a reused workspace.

Concrete failure scenario:

A new operator copies the working tree or deployment directory rather than starting from a clean clone/template, misses that `site-config.json` is ignored/deploy-local, and launches a gallery with Atik title, canonical URL, and metadata.

Suggested fix:

Clarify in setup docs that `apps/web/src/site-config.json` is deploy-local and must be verified per installation, especially when copying an existing working tree. If this repository is meant to be reused by multiple independent deployers, consider a prebuild warning when `site_url` is `gallery.atik.kr` unless an explicit environment acknowledgement is set.

### B. CLIP privacy claim should distinguish one-time model download from runtime privacy

Severity: Low  
Confidence: Medium  
Files/regions:

- Product claim: `README.md:29` and `README.md:48`
- App runbook: `apps/web/README.md:65-91`
- Runtime offline gate: `apps/web/src/lib/clip-model.ts:208-210`
- Model seeding script: `apps/web/scripts/download-clip-models.ts:111-122`

Why this is a risk:

The README says GalleryKit avoids handing AI features to hosted SaaS and has no per-query API cost. That is accurate for runtime semantic search: `clip-model.ts` sets `allowRemoteModels: false`. The setup path still downloads public model weights during the seed step. The app README says "Seed CLIP weights" and "weights load offline" but does not plainly state that the seed step contacts the model host while photos, queries, and embeddings stay local.

Concrete failure scenario:

A privacy-sensitive or air-gapped operator reads "without handing originals or AI features to hosted SaaS" as "no external network call is needed for AI setup," runs the seed step in production, and is surprised by a Hugging Face/model-download dependency or by the need to pre-seed weights elsewhere.

Suggested fix:

Add one sentence to the semantic-search runbook: "The seed step downloads public CLIP model weights once; after seeding, photo embeddings and visitor queries run locally and are not sent to Hugging Face or any hosted inference API."

## Final Sweep And Skipped Files

Final sweep performed:

- Searched current docs and UI copy for product/claim terms: `semantic`, `CLIP`, `Lightroom`, `plugin`, `PWA`, `offline`, `AI`, `privacy`, `analytics`, `proofing`, `payment`, `SaaS`, `hosted`, `map`, `GPS`, `HDR`, `originals`, `collections`.
- Enumerated app routes and API routes under `apps/web/src/app`.
- Cross-checked README claims against source for semantic search, PWA, upload API, analytics/privacy, SEO metadata, smart collections, and Docker/runtime data handling.
- Checked tracked vs ignored status for deploy-local config and public upload/resource directories.

Skipped or bounded:

- I did not run the web app, browser flows, or full test suite because this review target is claim correctness from docs/source, and the requested output is a reviewer report.
- `.context/project/*` files referenced by the generic persona do not exist in this repository; I used `CLAUDE.md`, `AGENTS.md`, README files, messages, and source as the GalleryKit authority.
- Existing `.context/reviews/*` reports from other agents were not exhaustively reviewed as product source of truth; they are review artifacts, not user/operator-facing product claims.

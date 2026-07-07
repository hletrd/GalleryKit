# GalleryKit Product Marketer Reviewer - Cycle 8

Date: 2026-07-07
Reviewed workspace: `/Users/hletrd/flash-shared/gallery`
Lane: product-marketer-reviewer

The local reviewer prompt at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` was used only for its evidence-first product review posture. Its BurstPick-specific assumptions were treated as stale and were not applied. This review checks GalleryKit's repository docs, source, routes, messages, tests, and plans for product positioning, public documentation, user trust, feature-claim accuracy, distribution/deploy readiness, and public/admin UX expectation risks.

## Inventory

I built the inventory before writing findings.

### Public Documentation And Positioning

- Root product docs: `README.md:7-9`, `README.md:29-54`, `README.md:56-74`, `README.md:97-177`, `README.md:193-224`, and `README.md:226-237`.
- Web-app docs: `apps/web/README.md:7-60`, `apps/web/README.md:62-90`, and `apps/web/README.md:92-101`.
- Full project knowledge base: `CLAUDE.md`, especially the implementation caveats for storage, CLIP semantic search, smart collections, GPS stripping, single-instance deployment, upload serving, and sidecar backfills.
- Workspace rules: `AGENTS.md`, including deploy, schema, quality gates, touch target, and no-edit/culling/scoring conventions.
- Config examples: `apps/web/src/site-config.example.json:1-10`, `.env.deploy.example:1-16`, and `apps/web/.env.local.example`.
- Package and distribution metadata: root `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, and `scripts/deploy-remote.sh`.

### Public Pages, Messages, And Trust Copy

- Public localized pages/routes include home, topic, photo, photo share, group share, smart collection, map, timeline, year archive, privacy, about-GalleryKit, localized uploads, root feed, and topic feeds:
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx`
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
  - `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx`
- Footer/product chrome: `apps/web/src/components/footer.tsx:32-64`.
- Public product copy: `apps/web/messages/en.json:817-843`.
- Privacy-relevant public selectors and map selectors: `apps/web/src/lib/data.ts` public field blocks and map field blocks.
- Search UX and semantic disclaimers: `apps/web/src/components/search.tsx` and `apps/web/messages/en.json` search/settings strings.

### Admin, Operator, And Feature Surfaces

- Admin routes include login, dashboard, categories, tags, SEO, settings, upload API tokens, password, users, database, analytics, and protected admin shell.
- Admin nav exposes no smart-collection authoring route; this matches `CLAUDE.md`'s warning that smart collections have a public read side but no admin authoring UI/API.
- Token surface: `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`, `apps/web/src/app/actions/lr-tokens.ts`, and `apps/web/src/lib/admin-tokens.ts`.
- Upload API surface: `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Semantic search surfaces: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/src/lib/clip-paths.ts`, `apps/web/src/components/search.tsx`, and `apps/web/src/components/similar-photos.tsx`.
- Deploy/operator surfaces: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`, and `apps/web/scripts/migrate.js`.

### Tests, Gates, And Plans

- Unit/contract tests: 346 files under `apps/web/src/__tests__`.
- Browser/e2e tests: `apps/web/e2e/admin.spec.ts`, `focus-restore.spec.ts`, `hydration-photo-page.spec.ts`, `nav-visual-check.spec.ts`, `not-found-status.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `swipe-visual-reset.spec.ts`, and `test-fixes.spec.ts`.
- Claim-sensitive tests inspected include privacy field guards, map privacy, deploy-script contracts, tracked-secret scans, source-contract docs, upload/token contracts, and CLIP semantic integration.
- Planning and review history is substantial and committed under `.context/plans/`, `.context/reviews/`, and `docs/superpowers/`, including CLIP semantic-search design and implementation plans.

## Verified Claim Inventory

The current repo is unusually careful about not over-selling the product.

- Finished-photo positioning is explicit: `README.md:29-32` and `README.md:52` say GalleryKit is for edited/finished photo publishing, not editing, culling, scoring, proofing, payment, or hosted SaaS.
- Public feature scope is mostly aligned with code: visitor/admin/operator bullets in `README.md:36-38` match the route and admin inventory.
- The semantic-search claim is caveated in the right places: `README.md:48`, `apps/web/README.md:62-86`, and `apps/web/src/lib/gallery-config.ts` describe disabled-by-default behavior, operator setup, model weights, backfill, env opt-in, newest-first bounded scan, and no one-click production UI.
- Upload API wording avoids a Lightroom-plugin overclaim: `README.md:50`, `README.md:213-224`, `apps/web/README.md:92-101`, and `apps/web/src/app/api/admin/lr/upload/route.ts:1-19` all say GalleryKit ships the server API, not a bundled Lightroom Classic plugin.
- Privacy copy is specific and code-shaped: `apps/web/messages/en.json:833-843` discloses processed derivatives, local analytics, rate-limit IP buckets, GPS behavior, public map scope, and OpenStreetMap tile requests.
- Deploy docs disclose important operator constraints: `README.md:168-177`, `README.md:193-211`, and `apps/web/README.md:44-60` cover build-time config, real public URLs, proxy trust, upload caps, host-network Docker, plaintext DB backups, and filesystem backups.

## Findings

### PMR-C8-01 - Default quality gates do not prove the public English/Korean CLIP claim

Severity: Medium
Confidence: High
Status: risk, not a confirmed runtime failure

Evidence:

- `README.md:48` publicly claims natural-language photo search in English and Korean plus similar photos, powered by in-process `jina-clip-v2`.
- `apps/web/README.md:64-70` repeats the self-hosted multilingual CLIP claim and says production mode serves real embeddings, not stub or empty results.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:4-9` describes the anti-vacuity test that proves real semantic rankings but explicitly gates it behind `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` skips the whole suite by default when that env var is absent.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:72-80` is the only inspected test that directly asserts both English and Korean semantic ranking against real fixtures.

Failure scenario:

A release can pass the normal `npm test --workspace=apps/web` gate while a CLIP model-cache, preprocessing, tokenizer, revision, or ONNX runtime regression remains untested because the real semantic-ranking suite is skipped by default. The public docs are careful about operator activation, but once an operator enables production mode, the strongest product claim, English/Korean semantic search, depends on an optional gate that is easy to omit from launch readiness.

Suggested fix:

Promote the CLIP integration smoke to a documented release/activation gate for semantic-search launches. The least invasive fix is a checklist entry near `apps/web/README.md:76-86` and `CLAUDE.md`'s CLIP runbook saying: before advertising/enabling production semantic search, run `CLIP_INTEGRATION=1 npm test --workspace=apps/web -- clip-semantic-integration.test.ts` on a host with seeded model weights. A stronger fix is a small CI job or release script that runs this test only when model artifacts are available.

### PMR-C8-02 - Product/footer chrome is forced onto every public gallery

Severity: Low-Medium
Confidence: High
Status: confirmed

Evidence:

- The default config ships product-oriented public branding: `apps/web/src/site-config.example.json:2-9` uses `GalleryKit`, `A self-hosted photo gallery`, and `Powered by GalleryKit`.
- The footer always renders the site footer text and fixed public links to GalleryKit/about, privacy, GitHub, and admin: `apps/web/src/components/footer.tsx:32-64`.
- The about link goes to an operator/product page, not the photographer's own about page: `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`.
- The about copy describes GalleryKit's product boundaries and operator workflows: `apps/web/messages/en.json:823-831`.
- `README.md:36-38` positions the app as serving visitor, admin, and operator experiences, so visitor-facing presentation is part of the product promise, not incidental.

Failure scenario:

A photographer deploys GalleryKit as a client-facing portfolio and configures the gallery title/SEO, but every visitor still gets product chrome that points to the software project, GitHub, and the admin route. This is transparent for an open-source demo, but it can reduce trust for branded client delivery: visitors see the publishing stack and an admin entry point before they see any photographer-controlled "about this gallery" context. The admin route is protected, so this is not a security finding; it is a product expectation and public-trust mismatch.

Suggested fix:

Make product/footer links configurable. Keep the current default for project demos if desired, but add config/admin settings for `show_gallerykit_about_link`, `show_github_link`, and `show_admin_footer_link`, or document that GalleryKit intentionally exposes software/project chrome on public galleries. A photographer-facing deployment should be able to keep Privacy while replacing GalleryKit/GitHub/Admin with owner-controlled links.

### PMR-C8-03 - Upload-token copy promises expiry behavior the create UI cannot choose

Severity: Low
Confidence: High
Status: confirmed

Evidence:

- Token copy says anyone with a token can use its scopes "until it expires or is revoked": `apps/web/messages/en.json:867-877`.
- The token list displays expiry and says `Never expires by default; revoke to disable` when `expiresAt` is absent: `apps/web/messages/en.json:891-894`.
- The server action supports an optional expiry: `apps/web/src/app/actions/lr-tokens.ts:29-33` accepts `expiresAt`, validates it at `apps/web/src/app/actions/lr-tokens.ts:79-93`, and passes it to storage at `apps/web/src/app/actions/lr-tokens.ts:95-101`.
- The token model verifies expiry if present: `apps/web/src/lib/admin-tokens.ts:141-167`.
- The shipped create dialog sends only `label` and `scopes: ['lr:upload']`, with no expiry input: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-89` and dialog fields at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:210-246`.

Failure scenario:

An admin reading the token-management UI may infer that expiring upload tokens are a supported admin workflow, but the visible create path mints long-lived bearer credentials unless revoked. This matters because the same UI warns that plaintext is shown once and should be stored like a password. For an external publish client on a laptop or studio machine, missing an expiry choice makes the risk posture less obvious at the moment the credential is created.

Suggested fix:

Either add an expiry control to the create dialog, or tighten the copy to match the current UI: "Tokens created here do not expire by default; revoke them to disable access." If expiry remains supported only at the action/library level, document that it is reserved for future/API-driven creation rather than implying it is an admin-facing choice.

## Non-Findings Checked

- No S3/MinIO storage claim was found in the current public docs; `CLAUDE.md` correctly warns not to document that as integrated.
- No bundled Lightroom plugin claim was found; docs and route comments consistently frame this as a server-side upload API for external clients.
- No broad "AI editing", culling, ranking, scoring, proofing, or payment claim was found; docs explicitly reject those categories.
- Public GPS handling appears honestly documented. Standard public pages use public field selections without GPS, while the public map has a separate explicit map selector and privacy copy.
- Docker/deploy readiness docs disclose host-network, build-time config, real public URL, reverse proxy, upload cap, auto-prune, bind mounts, plaintext DB backups, and complete-backup requirements.
- The presence of `.env.deploy` and `apps/web/.env.local` in the working tree did not indicate tracked secret exposure; the tracked files are examples, and `.gitignore`/`apps/web/.gitignore` ignore the runtime env files.

## Final Sweep

Checked categories:

- Product positioning and target user
- Public README and app README claims
- `CLAUDE.md` implementation caveats
- Site config and public footer defaults
- Public pages, privacy page, about-GalleryKit page, and localized messages
- Route structure for public, admin, upload, health, live, feed, and search endpoints
- Admin UX expectations for settings, tokens, users, database, analytics, SEO, categories, and tags
- Semantic search, similar-photo, model-weight, stub/production, and backfill claims
- Upload API contract, PAT scope, and no-plugin wording
- Privacy, analytics, GPS/map, and public metadata handling
- Docker/deploy/readiness, proxy trust, backup, build-time config, and secret-file handling
- Test gates, e2e coverage, tracked-secret checks, and plan/review history

No fixes were implemented. No commits, pushes, deploys, service stops, file removals, or MySQL mutations were performed. This review intentionally changed only `.context/reviews/product-marketer-reviewer.md`.

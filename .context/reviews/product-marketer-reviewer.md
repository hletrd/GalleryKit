# Product Marketer Reviewer - Cycle 25

Reviewed HEAD: `4cb1258ba0b2cca689846a85423264edc2d96b90`

Review mode: read-only product / market / documentation-positioning review, treated as a code review. I wrote this report artifact only; no source, config, test, commit, push, or deploy action was performed.

## Findings

### PMR-25-01 - Fresh-install database onboarding uses three incompatible credential/name examples

- Severity: Medium
- Confidence: High
- Risk type: Confirmed onboarding / conversion blocker
- Evidence:
  - Root installation creates database/user `gallerykit`: `README.md:106-110`.
  - The same root README later tells operators to fill `DB_USER=your_user` and `DB_NAME=gallery`: `README.md:134-141`.
  - The app README also creates database/user `gallerykit`: `apps/web/README.md:9-20`.
  - The copied environment template defaults to `DB_USER=gallery` and `DB_NAME=gallery`: `apps/web/.env.local.example:1-7`.
- Concrete failure scenario: A new self-hosting evaluator follows the quick start, runs the MySQL commands that create only `gallerykit`/`gallerykit`, copies `.env.local.example`, sets the password, and runs `npm run init --workspace=apps/web`. The init process then attempts to connect as `gallery` to database `gallery`, which was never created, causing an access-denied or unknown-database failure before the product can be evaluated.
- Suggested fix: Pick one canonical local install identity and use it everywhere. The least disruptive path is to change `.env.local.example` and the root env snippet to `DB_USER=gallerykit` and `DB_NAME=gallerykit`, with `DB_PASSWORD=<change-me>` or an explicit "replace this with the password from the CREATE USER command" note. Alternatively change both README SQL blocks to create `gallery`/`gallery`; do not leave the quick-start SQL and copied env template out of sync.

### PMR-25-02 - Nginx deploy comments still frame the upload route as a Lightroom publish-plugin integration

- Severity: Low
- Confidence: High
- Risk type: Confirmed deploy/operator positioning drift
- Evidence:
  - Current product docs say the upload route is an external-client API contract, not a bundled Lightroom Classic plugin: `README.md:205-214`, `apps/web/README.md:82-91`.
  - Admin copy tells operators GalleryKit exposes the API endpoint and does not bundle or distribute a Lightroom Classic plugin: `apps/web/messages/en.json:830-835`.
  - CLAUDE.md states the same product boundary while documenting the token model: `CLAUDE.md:160`.
  - The shipped nginx template still labels the route "Lightroom Classic publish-plugin upload" and warns about "breaking the LR publish integration": `apps/web/nginx/default.conf:124-130`.
- Concrete failure scenario: An operator adapting the deployment template reads the nginx comments, then documents or sells the deployment internally as including a Lightroom Classic publish-plugin integration. That conflicts with the user-facing README/admin contract and creates avoidable support pressure when no plugin is bundled.
- Suggested fix: Reword the nginx comment to match the current positioning, for example "PAT-authenticated external upload API" and "external upload clients." Keep the `/api/admin/lr/upload` path and body-size rationale, but avoid implying a shipped Lightroom plugin or maintained Lightroom integration surface.

## Inventory Covered

I inventoried and inspected the product-facing surfaces rather than sampling:

- Product and operator docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, deploy scripts, Dockerfile, Compose, nginx, site config examples, and package metadata.
- Localized copy: full `apps/web/messages/en.json` and `apps/web/messages/ko.json`, with focused checks around privacy, analytics, semantic search, upload tokens, HDR/color, auto alt text, settings, navigation, errors, and public/admin labels.
- Public routes and metadata: every public `page.tsx` / `layout.tsx` / feed / upload route under `apps/web/src/app/[locale]/(public)/`, plus root `manifest.ts`, `robots.ts`, `sitemap.ts`, `feed.xml/route.ts`, `not-found.tsx`, `error.tsx`, and `global-error.tsx`.
- Admin and API surfaces: admin dashboard, settings, SEO, tokens, analytics, db, categories, tags, users, login/layout pages, admin upload API, health/live, semantic search, similar search, OG routes, and upload-serving routes.
- Feature-claim implementation checks: `gallery-config-shared.ts`, `gallery-config.ts`, semantic search routes/actions, image-processing/color/HDR support, privacy/analytics storage paths, upload token schema, and source-contract tests that lock product claims.

## Validated Claims With No Finding

- Finished-photo positioning is consistent: README says GalleryKit is for published edited work and explicitly not for editing, culling, scoring, proofing, payment, or hosted SaaS workflows; code/test sweeps did not find a revived payment or scoring surface.
- Semantic search positioning is honest: docs and admin copy describe disabled-by-default, stub-vs-production behavior, operator env opt-in, model-weight seeding, and backfill requirements; config and route code enforce those gates.
- Google Analytics positioning is aligned: file-backed `google_analytics_id` defaults empty, public layout injects GA only for a valid configured ID, and privacy copy distinguishes first-party analytics from third-party GA.
- Storage positioning remains local-filesystem only in product docs; I did not find S3/MinIO exposed as a supported admin feature.
- Upload API docs and admin copy mostly match the current product boundary: external PAT-authenticated API, no bundled Lightroom Classic plugin. The only drift found is the nginx comment above.

## Missed-Issue Sweep

Final sweeps searched for database onboarding names, Lightroom/plugin wording, S3/MinIO, Stripe/payment/paid-download terms, editing/culling/scoring claims, Google Analytics claims, semantic-search mode gates, auto-alt/Firenze-style future-feature wording, HDR planned-output wording, public route metadata, and deploy/onboarding snippets. No additional product-facing mismatch rose above the reporting threshold.

## Verification

Validation was static inspection and repository search only, appropriate for a read-only review report. I did not run lint, typecheck, build, unit tests, e2e tests, commits, pushes, or deploys because the requested deliverable was a review artifact, not an implementation change.

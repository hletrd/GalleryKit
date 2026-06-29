# Product Marketer Review - Cycle 7

Date: 2026-06-29
Reviewer: product-marketer-reviewer
HEAD reviewed: `17124135999a3d7cb4f5262e8b2b5917503088ae`
Repository: GalleryKit
Scope: product positioning, onboarding, operator documentation, public/admin copy, trust signals, SEO/PWA/semantic-search claims, and launch/readiness claims versus current implementation.

## Executive Summary

Go-to-market readiness score: 7/10 for the self-hosted photographer/operator audience. GalleryKit's active positioning is mostly trust-building and technically honest: color/HDR claims are now qualified, semantic search is described as operator-gated, backup/restore copy says database-only, and the single-instance deployment posture is disclosed. The main current marketing/readiness problem is first-run onboarding: both READMEs promise a fresh operator can upload one photo immediately after init, but the product requires a category first and `npm run init` does not create one. That is a launch-doc defect because it breaks the first success moment for exactly the evaluator most likely to follow the README.

Finding count: 1 confirmed issue, 0 likely issues, 0 manual-validation risks.

| Severity | Confirmed | Likely | Manual-validation risk |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 1 | 0 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 0 | 0 | 0 |

## Prompt/Context Notes

- The requested repo-local prompt `.codex/agents/product-marketer-reviewer.md` was not present in this checkout. I used the installed user-level prompt at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` and adapted its BurstPick-specific marketing lens to GalleryKit.
- The prompt's required BurstPick source paths (`Sources/BurstPick/**`, `web/**`) do not exist here, so the review targeted GalleryKit's actual public docs, onboarding, product copy, admin surfaces, and implementation-backed claims.
- Required repo context read first: `AGENTS.md`, `CLAUDE.md`.

## Review-Relevant Inventory

Docs, repo metadata, and operator files inspected:

- `README.md`
- `apps/web/README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/.env.local.example`
- `.env.deploy.example`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

Public/admin UX and copy surfaces inspected:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`

Implementation claim checks inspected:

- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/src/db/seed.ts`
- `apps/web/scripts/seed-e2e.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

## Product-Market Fit Assessment

GalleryKit's strongest position is not broad "photo gallery software"; it is a self-hosted, photographer-trust-first gallery for operators who care about color/HDR honesty, private originals, no cloud dependency, and explicit runbooks. That position is credible in the code: the product exposes color metadata carefully, avoids paid/download claims, keeps semantic search operator-gated, and documents single-instance/self-hosted constraints. The first-run funnel, however, still has a avoidable break: the README tells evaluators to upload immediately before the product has any uploadable category.

## Positioning Audit & Recommendation

Current positioning is specific enough for a technically literate self-hosting audience: "high-performance, self-hosted photo gallery built with Next.js" plus photographer-grade color, Docker, i18n, PWA, sharing, and operator-enabled semantic search. The recommended one-sentence position remains:

> GalleryKit is a self-hosted photographer gallery that preserves color intent, keeps originals private, and gives operators explicit control over search, sharing, and deployment.

That sentence is better than a generic "AI gallery" frame because the AI surface is optional and operationally heavier than the gallery's core trust promise.

## Messaging Architecture

Strong current proof points:

- `README.md:32-40` now qualifies wide-gamut AVIF fallback, admin-only HDR gain-map audit, semantic-search setup, no role separation, and self-hosted Docker deployment.
- `apps/web/README.md:53-73` states the CLIP model, disabled/stub/production modes, external weight seeding, production honesty gate, bounded scan, and operator-only activation.
- `apps/web/messages/en.json:18-23` and `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:150-219` correctly warn that DB backup/restore does not include original files, derivatives, or resources.
- `README.md:149-151` documents the single web-instance/single-writer topology and trusted proxy requirement.

Weak current point:

- The fresh-install "first value" instructions skip category creation, so the first real product proof moment is not reproducible from the docs.

## AI Messaging Strategy

GalleryKit should keep treating "AI" as an operator-controlled feature rather than the headline. The current wording is mostly healthy: `README.md:37` says disabled by default and requires model download/backfill/env opt-in, while `apps/web/README.md:58-61` names stub mode as non-meaningful and warns that bounded scans may miss older photos. Do not simplify this into "AI search included" on public marketing pages; that would overpromise setup, coverage, and result quality.

## Business Model & Pricing Recommendation

No paid-download or subscription surface is currently active, and `CLAUDE.md` permanently defers Stripe/paid downloads. That matches the open-source/self-hosted positioning. The pricing message should stay out of the product docs unless a real support/commercial model is introduced; otherwise it risks implying a SaaS/support promise the repo does not currently ship.

## Distribution & Growth Plan

For GalleryKit's current shape, the best distribution motion is technical credibility rather than broad consumer marketing:

- Show a short "fresh install to first public photo" path in the README once the category step is fixed.
- Publish a color-management proof page that uses real Display P3 / Adobe RGB / HDR-ingest examples and links to the decision matrix.
- Keep semantic search as an advanced operator note with exact seed/backfill steps and known bounded-scan limits.
- Treat the live demo as proof of production semantic search, but keep the README explicit that fresh installs start disabled.

## Competitive Positioning Map

Axes: self-hosted/operator control vs. managed/cloud convenience; photographer color fidelity vs. generic media gallery.

- GalleryKit: high self-hosted/operator control, high photographer color-fidelity credibility.
- Generic static galleries: high self-hosted control, lower dynamic/admin/search features.
- Hosted portfolio builders: high convenience, lower operator control and weaker transparency over image processing.
- DAM/gallery SaaS tools: higher collaboration/business workflows, lower self-hosting and often less transparent color-pipeline control.

This is defensible as long as onboarding remains honest and runbooks stay accurate.

## Trust-Building Roadmap

1. Fix fresh-install docs so the first operator success path includes creating a category before uploading.
2. Add a "what backup does and does not cover" note near deployment setup, not only in admin DB copy.
3. Keep semantic-search limitations near every activation path; do not move bounded-scan details only into deep docs.
4. Consider a compact "production assumptions" section: single web instance, host backups for mutable files, trusted proxy, model weights not baked into image.

## Risk Matrix

| Risk | Probability | Impact | Mitigation |
| --- | --- | --- | --- |
| First-run evaluator follows README and hits disabled upload | High | High | Add "create a category" before "upload one photo" in both READMEs, or seed a default category in `init` intentionally. |
| Semantic search perceived as built-in when fresh installs are disabled | Medium | Medium | Keep operator-gated wording; current active docs mostly do this. |
| Self-hosted backup misunderstood as full gallery backup | Medium | High | Admin DB copy is honest; reinforce in deployment docs. |
| Multi-admin no-role model mistaken for RBAC | Low | Medium | Current README and admin copy already disclose root-admin/no-role posture. |
| Color/HDR claims outrun delivered bytes | Low | High | Current README and viewer copy now qualify 10-bit, SDR delivery, and admin-only HDR audit surfaces. |

## Confirmed Issues

### PM-C7-01 - Fresh-install docs promise upload before required category creation

Severity: High
Confidence: High
Classification: Confirmed product-onboarding defect

Exact regions:

- `README.md:91-104` gives the fresh install flow through `npm run init --workspace=apps/web`, `npm run dev`, then says: "After the dev server starts, log in at `/en/admin`, upload one photo, and confirm the public homepage renders it."
- `apps/web/README.md:11-21` repeats the app-local quick start and the same "upload one photo" instruction.
- `apps/web/package.json:17-19` defines `db:seed` as `tsx scripts/seed-admin.ts` and `init` as `tsx scripts/init-db.ts`; there is no default-topic seed in the documented init path.
- `apps/web/scripts/init-db.ts:24-31` only runs `node scripts/migrate.js`.
- `apps/web/scripts/migrate.js:774-780` enters the admin seeding path after schema reconciliation/migrations; it checks for the `admin` user, not any topic/category seed.
- `apps/web/src/db/seed.ts:4-10` can seed example topics (`idol`, `plane`), but it is not wired to `npm run init` or documented as part of fresh setup.
- `apps/web/src/components/upload-dropzone.tsx:191-196` disables the dropzone when `!hasTopics`.
- `apps/web/src/components/upload-dropzone.tsx:347-357` renders the first-run "Create a category before uploading" status and link instead of an uploadable dropzone.
- `apps/web/messages/en.json:146-148` provides the user-facing no-category copy: "Create a category before uploading", "Photos need a category before they can be uploaded", and "Create a category".
- `apps/web/e2e/admin.spec.ts:132-149` covers upload only after selecting `e2e-smoke`, and `apps/web/scripts/seed-e2e.ts:181-184` creates that topic for E2E. This protects the seeded E2E happy path but not the documented fresh-install path.

Why this is a problem:

The README is the top-of-funnel trust artifact for self-hosted evaluators. It promises a first success path that the product intentionally blocks until a category exists. The UI handles this better than the docs by linking to category creation, but the evaluator still experiences the README as wrong at the exact moment they are deciding whether the project is reliable enough to run.

Concrete failure scenario:

A photographer/operator creates a fresh database, runs the root README commands, logs in at `/en/admin`, and tries to upload the requested first photo. The upload control is disabled because no topics exist. They must discover that categories are mandatory, navigate to category creation, return to the dashboard, then upload. This is recoverable, but it undermines the product's "operator-runbook quality" promise.

Suggested fix:

Update both `README.md:104` and `apps/web/README.md:21` to explicitly say: create a category first, then upload one photo. Example:

> After the dev server starts, log in at `/en/admin`, create your first category from Admin -> Categories, return to the dashboard, upload one photo into that category, and confirm the public homepage renders it.

If the product wants upload to be immediately possible instead, wire an intentional default category into the init path and document that choice. The docs-only fix is lower risk and better aligned with the current UI.

## Likely Issues

None promoted. I did not find another active public/operator claim that likely contradicts current implementation.

## Risks Needing Manual Validation

None promoted. The previous cycle's archived CLIP-plan wording has been corrected: `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:955` now points to the current operator-only runbook.

## Source-Backed Non-Findings

- The previous product-marketer finding about unconditional 10-bit AVIF is fixed. `README.md:32` now says 10-bit AVIF depends on deployed libheif support and has an explicit 8-bit fallback.
- Semantic-search public/operator messaging is aligned: `README.md:37`, `apps/web/README.md:53-73`, `apps/web/src/lib/gallery-config.ts:126-145`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:640-680`, `apps/web/src/app/api/search/semantic/route.ts:156-176`, and `apps/web/src/app/api/search/similar/[id]/route.ts:97-113` all support disabled-by-default/operator-gated production semantics.
- The bounded newest-first CLIP scan is disclosed in active app docs: `apps/web/README.md:61` matches `apps/web/src/app/api/search/semantic/route.ts:242-251` and `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`.
- Metadata search claims are backed: `README.md:36` says titles, descriptions, cameras, and tags; `apps/web/src/lib/data.ts:1539-1550` searches title/description/camera/lens/topic, and `apps/web/src/lib/data.ts:1584-1608` adds tag and alias searches.
- PWA claims are backed for production: `README.md:38`, `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/public/sw.template.js:4-19`, and `apps/web/src/app/manifest.ts:6-52` implement production-only service-worker registration, image derivative stale-while-revalidate caching, offline-only HTML fallback, and install metadata.
- DB backup/restore copy is honest: `apps/web/messages/en.json:18-23` and `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:150-219` state database rows only and warn that file storage is unchanged.
- Storage positioning is not overpromised: active docs do not claim S3/MinIO support, while `CLAUDE.md` says the storage abstraction is local-only/not integrated end-to-end.
- Admin-account positioning is honest: `README.md:40` states multiple root admins with no role separation, matching the documented product model.
- The paid-download/Stripe surface remains removed and is not marketed as present.

## Final Missed-Issues Sweep

Final sweep searched active docs, app copy, admin/public routes, API routes, deployment scripts, storage code, semantic-search gates, PWA files, SEO metadata paths, and historical CLIP docs for: unsupported storage claims, semantic/CLIP production promises, HDR/wide-gamut/10-bit claims, backup/restore claims, root-admin/role language, first-run onboarding claims, category/upload prerequisites, paid/download/subscription claims, PWA/offline claims, and operator setup wording.

Relevant files intentionally not inspected in detail:

- Binary/static media assets, generated build outputs, `node_modules`, `.next`, upload/data directories, lockfile internals, and archived `.context/**` history.
- Most unit tests were used only as supporting contract evidence when directly relevant to product promises; this was a review-only lane and did not run the full gate suite.

No additional confirmed product-marketing/readiness issues were found beyond PM-C7-01.

## Final Verdict

Launch/readiness recommendation: wait on broad "easy self-hosted install" messaging until the first-run docs are corrected. The product itself handles the no-category state acceptably, but the README needs to match that reality. First 100 users should be technically comfortable photographers and self-hosters who value color fidelity and operational control; do not market semantic search as the primary wedge until setup, scan limits, and no-result failure modes are smoother.

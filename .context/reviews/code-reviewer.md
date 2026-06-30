# Cycle 29 Code Review

Reviewer: cycle-29 code-reviewer  
Repo: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `b4fa1f644acb0778fc4e1dd25bcf026f482d4226`  
Date: 2026-06-30 KST

## Result

No confirmed code-quality, correctness, logic, SOLID, maintainability, or cross-file interaction issues were found in the reviewed HEAD.

Recommendation: **APPROVE** for this review angle.

## Required Read-In

Read first and treated as binding review context:

- `AGENTS.md`
- `CLAUDE.md`

Key constraints applied from those files:

- Do not modify product code during this prompt.
- Preserve the GalleryKit privacy boundary: public DTOs must omit admin-only fields unless an explicit public contract allows them.
- Preserve same-origin/admin-auth/rate-limit lint gates.
- Treat migrations, Drizzle journal metadata, restore flows, deploy helper behavior, color/HDR handling, and touch-target tests as behavior-shaping code, not incidental files.

## Inventory

Review-relevant files were inventoried with `rg --files`, `find`, and line-count sweeps while excluding dependency/build/runtime directories such as `node_modules`, `.next`, public uploads, runtime data, and coverage output.

Covered categories:

| Area | Coverage |
| --- | --- |
| Root project docs/config | `AGENTS.md`, `CLAUDE.md`, `README.md`, package/workspace config, TypeScript/Vitest/Playwright config, Docker/NGINX/deploy files |
| Next app routes/pages/layouts | `apps/web/src/app/**/*`, including locale pages, public pages, admin pages, API routes, OG routes, feed/sitemap/manifest routes |
| Server actions | `apps/web/src/app/actions/**/*`, including images, topics, collections, public analytics/search/load-more, settings, auth, bulk operations |
| Data/model layer | `apps/web/src/db/**/*`, `apps/web/src/lib/data.ts`, schema relations, cache wrappers, public/admin select projections |
| Background/runtime code | image queue, restore maintenance, background DB writes, instrumentation, rate limits, sessions, search/semantic/CLIP helpers |
| UI components | public viewer/lightbox/map/search components, admin components, upload/dropzone controls, form helpers |
| Scripts and migrations | `apps/web/scripts/**/*`, `apps/web/drizzle/**/*`, migration journal metadata and reconcile helpers |
| Tests | `apps/web/src/__tests__/**/*`, `apps/web/e2e/**/*`, fixtures/helpers, lint guard tests and custom lint scripts |
| Static/generated behavior sources | PWA service worker template/generated file, icons pipeline, public resources referenced by app behavior |
| Review/plan history | `.context/reviews/**/*`, `.context/plans/**/*` for stale finding dedupe and current-cycle context |

Inventory evidence:

- `apps/web/src` contains 483 source/test files within the inspected max-depth sweep.
- `apps/web/src/__tests__`, `apps/web/e2e`, `apps/web/scripts`, and `apps/web/drizzle` contain 348 files in the inspected test/script/migration sweep.
- Non-test TypeScript/TSX source under `apps/web/src` totals 42,786 lines.
- Large/high-risk files were explicitly line-read, including `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, semantic search routes, OG routes, restore helpers, smart collection helpers, validation/sanitization, and rate-limit code.

## Findings

### Confirmed Issues

None.

### Likely Issues

None.

### Risks Needing Manual Validation

These are not actionable defects from the static review, but they remain runtime surfaces that local gates cannot fully prove.

#### R29-CODE-RISK-01 - Production sitemap population depends on runtime DB-backed ISR refresh

Classification: Risk needing manual validation  
Severity: Low  
Confidence: Medium

Regions:

- `apps/web/src/app/sitemap.ts:24-55`
- `apps/web/src/app/sitemap.ts:57-120`
- `apps/web/src/lib/data.ts:509-544`

Why this is a risk, not a finding:
`npm run build --workspace=apps/web` succeeded, and `sitemap.ts` intentionally catches build-time DB unavailability at `sitemap.ts:39-55`, emitting a homepage-only fallback so Docker/Next builds do not fail when MySQL is absent. The surrounding comments state that ISR should replace the fallback on a runtime hit. Static review and the successful build show the fallback is intentional, but this local environment could not validate a production DB-backed `/sitemap.xml` response.

Manual validation scenario:
After deploy, request `/sitemap.xml` in the production environment with MySQL reachable and confirm topic, image, feed, and localized entries are present, not only localized homepage entries.

Suggested validation/fix if validation fails:
Check the deployed `BASE_URL`, DB connectivity, and ISR behavior for `sitemap.ts`; if runtime refresh still returns the fallback, make the DB failure observable in deploy smoke checks and adjust the sitemap generation path or deploy sequencing.

#### R29-CODE-RISK-02 - Browser-only flows were source-reviewed but not exercised with Playwright in this prompt

Classification: Risk needing manual validation  
Severity: Low  
Confidence: Medium

Regions:

- `apps/web/e2e/admin.spec.ts:1`
- `apps/web/e2e/origin-guard.spec.ts:1`
- `apps/web/e2e/public.spec.ts:1`
- `apps/web/e2e/nav-visual-check.spec.ts:1`
- `apps/web/e2e/test-fixes.spec.ts:1`

Why this is a risk, not a finding:
The browser-flow specs and UI source were reviewed, and unit/type/build gates passed, but `npm run test:e2e --workspace=apps/web` was not run during this prompt. Some E2E tests are intentionally environment-gated or skipped without admin credentials/base URL, so local source review cannot fully prove the real browser/admin flows.

Manual validation scenario:
Run the Playwright suite against a configured local or staging-like instance when browser-flow coverage is required for release confidence.

Suggested validation/fix if validation fails:
Use the failing Playwright trace to isolate whether the issue is a browser interaction regression, test fixture drift, or environment setup gap.

## Manual Review Focus

Line-level review focused on cross-file contracts and historically fragile surfaces:

- Public/admin data boundary: `apps/web/src/lib/data.ts:251-489`, `apps/web/src/__tests__/privacy-fields.test.ts`
- Pagination/search/map/public DTOs: `apps/web/src/lib/data.ts:620-812`, `apps/web/src/lib/data.ts:878-947`, `apps/web/src/lib/data.ts:1490-1712`
- Image upload, deletion, metadata, retries: `apps/web/src/app/actions/images.ts:1-1310`
- Topic and smart collection mutations: `apps/web/src/app/actions/topics.ts:1-626`, `apps/web/src/app/actions/collections.ts:1-139`, `apps/web/src/lib/smart-collections.ts:1-550`
- Public actions and analytics: `apps/web/src/app/actions/public.ts:1-510`
- Semantic and similar-photo API routes: `apps/web/src/app/api/search/semantic/route.ts:1-366`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-271`
- OG image routes and fetch helper: `apps/web/src/app/api/og/route.tsx:1-252`, `apps/web/src/app/api/og/photo/[id]/route.tsx:1-295`, `apps/web/src/lib/og-photo-fetch.ts:1-118`
- Rate limits and trust proxy handling: `apps/web/src/lib/rate-limit.ts:1-518`
- Image queue and restore interactions: `apps/web/src/lib/image-queue.ts:1-1114`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`
- Admin backup/restore and maintenance scripts: `apps/web/src/app/[locale]/admin/db-actions.ts:1-821`, `apps/web/scripts/migrate.js`, `apps/web/scripts/restore-maintenance-recovery.mjs`
- Sanitization and validation helpers: `apps/web/src/lib/sanitize.ts:1-190`, `apps/web/src/lib/validation.ts:1-199`
- Share pages and shared-group access paths: `apps/web/src/app/[locale]/g/[key]/page.tsx`, `apps/web/src/app/[locale]/s/[key]/page.tsx`

## Validation Evidence

Commands run and reviewed:

- `npm run lint:api-auth --workspace=apps/web` - passed
- `npm run lint:action-origin --workspace=apps/web` - passed
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed
- `npm run lint --workspace=apps/web` - passed
- `npm run typecheck --workspace=apps/web` - passed
- `npm test --workspace=apps/web` - passed: 274 test files, 272 passed and 2 skipped; 2,543 tests total, 2,539 passed and 4 skipped
- `npm run build --workspace=apps/web` - passed; build logged the intentional sitemap DB fallback because local MySQL at `127.0.0.1:3306` was unavailable

Additional sweeps:

- `rg` scan for TODO/FIXME/HACK, TypeScript suppression comments, raw SQL/query execution, `dangerouslySetInnerHTML`, eval-like patterns, environment-variable usage, redirects, and revalidation calls.
- Secret-pattern scan for common API-token/private-key/password forms found no committed secret; matches were documentation text, lockfile substrings, CSS terms, or policy examples.
- Focused-test scan found no `.only`; skipped tests were intentional offline/integration or environment-gated cases.
- Guard-specific lint scripts passed for admin API auth, mutating server action same-origin checks, and public mutating route rate limits.
- Build/typecheck/test output was read before claiming completion.

## Final Missed-Issues Sweep

The final sweep rechecked the highest-risk cross-file boundaries:

- Public privacy projections versus schema/admin-only fields
- Same-origin and admin-auth enforcement on server actions and API routes
- Public mutating route rate limits
- Upload path validation, disk-space checks, RAW handling, audit metadata, and image-queue enqueue/claim/finalize flows
- Restore maintenance gates and background DB write draining
- Smart collection AST validation, slug remapping, and query compilation
- Search/semantic result enrichment and public field safety
- OG generation cache/rate-limit/fallback paths
- Drizzle migrations, journal metadata, and reconcile baseline behavior
- PWA/service-worker generation and tested cache contracts
- Test coverage, skipped/focused test markers, and custom lint guard coverage

No confirmed or likely actionable issues remained after this sweep. Residual risk is limited to runtime-only validation that local unit/type/build gates cannot prove: production DB-backed sitemap refresh and configured Playwright browser flows.

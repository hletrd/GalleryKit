# Verifier Review - Cycle 13

Date: 2026-06-29
Role: verifier subagent, evidence-based correctness check against docs, tests, and code contracts
Scope: `/Users/hletrd/flash-shared/gallery` on `master` at `b269a36b`
Constraint: review artifact only. No production code edited.

## Inventory

Reviewed the repo surfaces that carry explicit behavior claims:

- Governing docs/contracts: `AGENTS.md` from the prompt, `CLAUDE.md`, root `package.json`, `apps/web/package.json`.
- Runtime/deploy/config: `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`.
- Routes/actions: committed `apps/web/src/app/**/route.{ts,tsx}` files, public pages under `app/[locale]/(public)`, server actions under `apps/web/src/app/actions/`, and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Data/privacy/search: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, feed helpers, sitemap/robots helpers, and public semantic/similar search routes.
- Image/color/upload pipeline: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `gallery-config*.ts`, `settings-hash.ts`, color/ICC/gain-map/GPS helpers, upload serving, and backfill scripts.
- Auth/security/rate-limit: `proxy.ts`, `session.ts`, `api-auth.ts`, `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, admin token helpers, CSP helpers, and scanner scripts.
- Schema/migrations/scripts: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, build/service-worker scripts, backup/restore scripts.
- Tests/contracts sampled: auth/origin/rate-limit scanners, privacy guards, migration journal/reconcile tests, nginx/Next config tests, service-worker cache/template contracts, semantic/similar search, OG route contracts, and image/upload source contracts.

Excluded as non-source review inputs: `node_modules/`, `.git/`, `.claude/worktrees/`, `.next/`, generated build/test output, runtime upload/data/resource directories, local `.env*`, screenshots/binary fixtures, and transient review inventories.

## Findings

### LOW / Confirmed / High Confidence - Service worker admin bypass omits unlocalized `/admin` routes

**Evidence**

- `CLAUDE.md` defines the service-worker contract: `public/sw.template.js` is the shipped source and `lib/sw-cache.ts` is the unit-tested reference (`CLAUDE.md:408-409`). The HTML offline fallback must exclude admin routes and admin-rendered pages (`CLAUDE.md:411`).
- The shipped template repeats the narrower claim that `/admin/*` and `/api/admin/*` always bypass to network (`apps/web/public/sw.template.js:18`), and the fetch handler relies entirely on `isAdminRoute(pathname)` for that bypass (`apps/web/public/sw.template.js:382-383`).
- The actual template predicate only matches locale-prefixed admin paths and admin API paths: `^/[a-z]{2}(-[A-Z]{2})?/admin` or `^/api/admin` (`apps/web/public/sw.template.js:42-46`). It does not match `/admin` or `/admin/dashboard`.
- The unit-tested reference implementation has the same omission: its comment says it matches `/[locale]/admin/* and /api/admin/*`, and the regexes match only those two shapes (`apps/web/src/lib/sw-cache.ts:54-62`).
- If the predicate misses an HTML admin route, the request falls through to `networkFirstHtml` (`apps/web/public/sw.template.js:395-397`). That path caches any `networkResponse.ok` response unless `x-gk-admin-render` is set (`apps/web/public/sw.template.js:296-315`).
- Existing tests pass but do not cover the missing route shape. `sw-cache.test.ts` asserts `/en/admin/`, `/ko/admin/settings`, and `/api/admin/db`, but has no `/admin` or `/admin/dashboard` case (`apps/web/src/__tests__/sw-cache.test.ts:47-71`). `sw-template-contract.test.ts` checks the marker gate and revocable-share bypasses, but does not assert the unlocalized admin bypass (`apps/web/src/__tests__/sw-template-contract.test.ts:28-80`).
- Other source contracts acknowledge unlocalized admin paths. `proxy.ts` treats `/admin/...` as protected default-locale admin subroutes (`apps/web/src/proxy.ts:65-72`), and `robots.ts` disallows `/admin` and `/admin/` alongside localized admin paths (`apps/web/src/app/robots.ts:4-8`).

**Failure scenario**

An unauthenticated browser with the service worker installed requests `/admin/dashboard` or `/admin` while online. Because the service worker does not classify that URL as admin, the request can enter the HTML offline fallback path. If the server returns an OK login/redirect target without `x-gk-admin-render`, the service worker can cache that HTML under the admin URL for up to 24 hours. Later offline visits receive cached admin/login HTML instead of the documented "always bypass to network" behavior. Authenticated admin page bodies are still protected by the proxy-set `x-gk-admin-render` marker (`apps/web/src/proxy.ts:120-129`), so this is a contract/freshness bug rather than a confirmed sensitive-data leak.

**Suggested fix**

Add an explicit `^/admin(/|$)` match to both `apps/web/public/sw.template.js` and `apps/web/src/lib/sw-cache.ts`, then regenerate and commit `apps/web/public/sw.js` as required by `CLAUDE.md:408`. Add tests for `/admin` and `/admin/dashboard` in `sw-cache.test.ts`, and add a template contract that pins the shipped service worker admin predicate against the same unlocalized paths.

## Likely Issues

No additional likely correctness issues were found with enough evidence to report as actionable in this pass.

## Risks Needing Manual Validation

- After fixing the service-worker predicate, validate in a real browser/PWA session that `/admin`, `/admin/`, and `/admin/dashboard` bypass the service worker while public gallery/photo pages still populate and serve the intended offline-only HTML fallback. The current unit/source tests do not exercise browser redirect caching behavior end to end.

## Confirmed Correct Invariants

- Admin authentication is layered: middleware only performs the coarse admin cookie/path guard, while protected layouts/actions/API wrappers still verify sessions or admin tokens (`CLAUDE.md:192-195`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`).
- Public privacy selectors omit GPS, original filenames, user filenames, color/HDR internals, blur placeholders, and processing/admin-only fields; the symmetric privacy guard and fixture cover the omission list (`apps/web/src/lib/data.ts:368-507`, `apps/web/src/__tests__/privacy-fields.test.ts:7-132`).
- Public search and semantic enrichment use the public select/enrichment fields rather than admin selects, and semantic routes apply same-origin/content-type/body/rate-limit gates before expensive work (`apps/web/src/app/api/search/semantic/route.ts:106-246`, `apps/web/src/app/api/search/similar/[id]/route.ts:60-170`).
- Upload serving rejects original files, validates derivative directories/extensions, rejects symlinks, checks realpath containment, versions ETags with `IMAGE_PIPELINE_VERSION`, and supports conditional/HEAD handling (`apps/web/src/lib/serve-upload.ts:15-17`, `142-184`, `191-259`).
- Deploy/disk hygiene matches the documented single-host posture: bind-mounted data/uploads/resources are preserved, Docker prune runs after `up -d`, and `volume prune` is used without `-a` (`apps/web/docker-compose.yml:1-27`, `apps/web/deploy.sh:31-58`).
- Migration journal/reconcile tests and scanner gates cover the current schema and auth/origin/rate-limit contracts sampled in this pass.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` -> passed; 2 admin API route exports OK.
- `npm run lint:action-origin --workspace=apps/web` -> passed; mutating server actions enforce same-origin provenance or explicit exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- `npm test --workspace=apps/web -- privacy-fields.test.ts migration-journal.test.ts migration-journal-monotonicity.test.ts migrate-reconcile-coverage.test.ts nginx-config.test.ts next-config-uploads-headers.test.ts` -> 6 files passed, 93 tests passed.
- `npm test --workspace=apps/web -- sw-cache.test.ts sw-template-contract.test.ts` -> 2 files passed, 38 tests passed. This is evidence that the current suite misses the unlocalized `/admin` bypass case.

Not run: full `npm run lint`, full `npm run typecheck`, full `npm run build`, full `npm test`, and Playwright e2e. This was a verifier review pass with targeted gates and source-contract checks, not a complete release validation run.

## Files And Regions Reviewed

- Docs/contracts: `AGENTS.md`, `CLAUDE.md:186-228`, `CLAUDE.md:326-348`, `CLAUDE.md:406-414`, `CLAUDE.md:520-541`, `CLAUDE.md:588-597`.
- Auth/admin/token routes: `apps/web/src/proxy.ts:52-132`, `apps/web/src/lib/session.ts:26-151`, `apps/web/src/lib/api-auth.ts:55-140`, `apps/web/src/app/actions/auth.ts:93-280`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Public API/serving: `apps/web/src/app/api/search/semantic/route.ts:1-355`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-235`, `apps/web/src/app/api/og/route.tsx:33-224`, `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/uploads/[...path]/route.ts`, `apps/web/src/lib/serve-upload.ts:15-309`.
- Public pages/actions/feeds: share pages under `s/[key]` and `g/[key]`, root/topic feed routes, `apps/web/src/app/actions/public.ts:31-439`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts:1-26`, `apps/web/src/lib/atom-feed.ts:21-165`.
- Data/privacy/schema: `apps/web/src/lib/data.ts:13-507`, `apps/web/src/lib/data.ts:1462-1744`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/db/schema.ts:1-311`.
- Image/config/deploy: `apps/web/src/lib/gallery-config-shared.ts:21-287`, `apps/web/src/lib/gallery-config.ts:34-200`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/build-sw.ts`, `apps/web/public/sw.template.js:1-402`, `apps/web/src/lib/sw-cache.ts:1-95`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`.
- Tests/contracts: `apps/web/src/__tests__/privacy-fields.test.ts:1-132`, `apps/web/src/__tests__/sw-cache.test.ts:1-95`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-180`, migration/config/scanner tests listed in validation evidence.

## Final Sweep

Commonly missed checks completed:

- Compared source-contract tests to the implementation they claim to lock, not just their pass/fail status.
- Checked both the shipped service-worker template and the separate unit-tested reference copy for drift and shared omissions.
- Re-read public GET routes even though the public-route rate-limit scanner only blocks mutating handlers.
- Cross-checked docs against privacy/data selectors, route guards, upload serving, image pipeline versioning, deploy mounts, and migration assertions.
- Checked locale and non-locale route variants for admin, feed, uploads, sitemap/robots, and public search surfaces.

No critical, high, or medium confirmed correctness findings were identified in this pass.

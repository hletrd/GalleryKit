# Code Reviewer - Cycle 12

**Date:** 2026-06-29  
**HEAD reviewed:** `155f684f4ee8ad3ab5949ad4b00de9ab34c62081` (`155f684f docs(review): preserve cycle 12 verifier evidence`)  
**Role:** code-reviewer  
**Scope:** whole current repository at HEAD from code quality, logic, SOLID, maintainability, correctness, cross-file contracts, guardrails, privacy, and operational behavior. Review-only: no production code was changed.

## Required Context Read

- Project `AGENTS.md`
- Project `CLAUDE.md`
- Local code-review skill: `/Users/hletrd/.agents/skills/code-review/SKILL.md`

## Inventory Built Before Findings

Review-relevant active surface was enumerated before deep review, excluding dependency/build/runtime blobs (`node_modules`, `.next`, coverage, uploads/data, `.git`, `.claude`, `.omx`, and generated reports). The resulting inventory contained 621 files:

- `apps/web/src/app`: 77 App Router pages, route handlers, layouts, metadata, and server action exports.
- `apps/web/src/components`: 57 client/server UI components.
- `apps/web/src/lib`: 96 shared modules for auth, rate limiting, data access, privacy projections, upload serving, image processing, queues, smart collections, semantic search, settings, and deployment/runtime helpers.
- `apps/web/src/db`: 3 schema/connection modules.
- `apps/web/src/__tests__`: 262 Vitest files.
- `apps/web/scripts`: 27 operational, lint, migration, backfill, and build scripts.
- `apps/web/drizzle`: 31 migrations and journal/snapshot files.
- `apps/web/e2e`: 8 Playwright specs/fixtures/helpers.
- Plus root/project docs and config: 30 markdown files, 14 JSON files, 6 JS, 6 MJS, 3 shell scripts, 1 nginx conf, 1 CSS file, 1 YAML file, and 6 binary JPEG fixtures.

Coverage approach: text files in the product inventory were covered by repository-wide static sweeps plus direct reads of risk-bearing regions. Sweeps included admin/API auth wrappers, same-origin ordering, public route/action rate limits, CSP/proxy headers, service worker caching, DB projections, GPS/privacy gates, smart collection visibility, uploads/path containment, image queue/retry/cleanup, backfill scripts, migrations/journal/reconcile logic, raw SQL, child-process sites, JSON parsing, detached promises, audit logging, advisory locks, i18n route behavior, and prior-cycle finding status. Binary fixtures were inventory-only.

## Findings

### C12-CQ-01 - Offline HTML cache can outlive smart-collection revoke/delete

**Severity:** Medium  
**Confidence:** High  
**Classification:** Confirmed cross-file privacy/revocation bug.

**File/region:**

- `apps/web/public/sw.template.js:61-63` and generated `apps/web/public/sw.js:61-63` define `isRevocableShareHtmlRoute(...)` to match only `/s/{key}` and `/g/{key}` paths.
- `apps/web/public/sw.template.js:370-376` and generated `apps/web/public/sw.js:370-376` bypass only those share pages before sending all other HTML through `networkFirstHtml(...)`.
- `apps/web/public/sw.template.js:275-295` caches any successful non-admin HTML response and deliberately ignores normal HTML `Cache-Control` for the offline fallback path.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:78-84` enforces `collection.is_public` at render time, then embeds the collection page and first page of matching images in SSR HTML at `:100-150`.
- `apps/web/src/app/actions/collections.ts:93-101` can make a collection private, and `:112-126` can delete it; both only call `revalidateAllAppData()`, which cannot purge already-installed browser service-worker caches.
- `apps/web/src/__tests__/sw-template-contract.test.ts:71-79` locks only the share-page bypass contract and has no equivalent assertion for `/c/{slug}`.

**Issue:** Smart collections are revocable public resources, but the service worker treats them as ordinary cacheable HTML. The app correctly rejects private/deleted collections on the server, yet a browser that previously loaded a public `/c/{slug}` route can keep the old SSR page in `gk-html-*` for up to `HTML_MAX_AGE_MS` and receive that page when offline. The existing service-worker comment explicitly recognizes this revoke/delete class for share pages, but the same class exists for public smart collections.

**Concrete failure scenario:** An admin publishes `/ko/c/client-preview`, a visitor opens it once, and the service worker stores the HTML. The admin then sets `is_public=false` or deletes the collection. Online requests now 404, but if the visitor is offline within the 24-hour HTML fallback window, `networkFirstHtml` catches the failed network request and returns the cached collection page, including collection name and the first page of photo metadata/thumbnails from before revocation.

**Suggested fix:** Replace `isRevocableShareHtmlRoute` with a broader revocable-public-route predicate that also matches localized `/c/{slug}` pages, or make route responses for smart collections carry an explicit header that the service worker honors before HTML caching. Add a service-worker contract test proving `/c/foo` and `/ko/c/foo` bypass `networkFirstHtml` before the generic HTML branch.

### C12-CQ-02 - Offline HTML cache can preserve GPS map markers after topic visibility is disabled

**Severity:** Medium  
**Confidence:** High  
**Classification:** Confirmed privacy stale-cache bug.

**File/region:**

- `apps/web/src/app/[locale]/(public)/map/page.tsx:9-10` documents that the public map must reflect GPS visibility changes immediately.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50` fetches `getMapImages()` and serializes marker latitude/longitude into the SSR page passed to `MapLoader`.
- `apps/web/src/lib/data.ts:1651-1687` correctly filters GPS rows to `topics.map_visible = true` and throws if a hidden topic leaks through.
- `apps/web/src/app/actions/topics.ts:593-618` lets an admin toggle `map_visible` and calls `revalidateAllAppData()`.
- `apps/web/public/sw.template.js:370-376` sends `/map` and localized `/ko/map` HTML through the generic 24-hour offline fallback; the bypass regex at `:61-63` does not match map routes.
- `apps/web/src/__tests__/map-privacy.test.ts:80-130` covers DB/runtime GPS filtering, but there is no test that the service worker refuses to cache the GPS-bearing map HTML.

**Issue:** The DB layer and map action preserve the `map_visible` invariant for online SSR, but the service-worker HTML cache is outside that invariant. `/map` contains location data by design, and the page itself says visibility toggles must reflect immediately. Once cached, the service worker can serve the old HTML offline for 24 hours even after a topic is hidden from the map, bypassing the fresh `getMapImages()` filter entirely.

**Concrete failure scenario:** A topic is temporarily enabled on the public map for a client review. A visitor opens `/map`, causing the service worker to cache the rendered markers. The admin later disables `map_visible` for that topic. Fresh online requests omit those GPS coordinates, but the same visitor can go offline and reopen `/map`; the service worker returns the stale SSR payload with the hidden topic's marker coordinates and photo links.

**Suggested fix:** Treat public map HTML as privacy-sensitive and bypass offline HTML caching for localized `/map` routes, or emit a route-level `no-store`/sensitive marker that `networkFirstHtml` checks before caching. Add contract coverage in `sw-template-contract.test.ts` that `/map` and `/ko/map` bypass the generic HTML cache, and consider a named predicate such as `isRevocableOrSensitiveHtmlRoute` so future privacy-sensitive public pages are forced through the same decision point.

## No Additional Findings After Final Sweep

- No critical or high-severity confirmed findings were identified in this cycle.
- Cycle 11 sidecar concurrency findings are fixed: `backfill-color-pipeline.ts:371-374` and `backfill-cicp-recheck.ts:81-84` now use `parseBoundedPositiveInteger(..., { fallback: 2, max: 8 })`.
- Cycle 11 same-origin ordering findings are fixed for sampled prior examples: settings and SEO now call `requireSameOriginAdmin()` before `isAdmin()`, and the lint gate still passes.
- Admin API routes remain wrapped by `withAdminAuth`, and public mutating API scanning passes.
- Privacy-sensitive public projections, smart-collection query compilation, semantic/similar search response shaping, upload path containment, derivative cleanup, image queue claim/retry, migration journal postconditions, and restore-maintenance gates did not yield a non-duplicate finding at this review threshold.
- Final hygiene sweep found ignored local env/build artifacts (`.env.deploy`, `apps/web/.env.local`, `apps/web/tsconfig.tsbuildinfo`) and historical tracked review logs/pids under `.context`; these were not treated as product behavior defects.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- migration-journal migration-journal-monotonicity` - passed; 2 files, 10 tests.
- `npm test --workspace=apps/web -- sw-template-contract map-privacy` - passed; 2 files, 26 tests. This confirms existing tests cover only the current share-page SW bypass and DB-level map privacy, not the stale HTML cache cases above.
- Node regex spot-check of the shipped SW bypass pattern: `/s/abc`, `/ko/s/abc`, `/g/abc`, and `/ko/g/abc` match; `/map`, `/ko/map`, `/c/wedding`, and `/ko/c/wedding` do not.
- Static inventory and sweeps with `rg --files`, `find`, `git ls-files`, `rg`, `nl -ba`, direct source reads, config/package reads, and current HEAD checks.

I did not run full `npm run build` or Playwright e2e because this was a review-only artifact and no executable source was changed. Binary JPEG fixtures were inventoried but not semantically inspected beyond their fixture role.

## Recommendation

Comment / request follow-up fixes for the two medium privacy-cache findings before relying on offline PWA HTML fallback for revocable or sensitive public pages. The common fix is to move route sensitivity into an explicit service-worker predicate or response marker, then add contract tests for every public route whose visibility can be revoked or whose SSR payload contains location-sensitive data.

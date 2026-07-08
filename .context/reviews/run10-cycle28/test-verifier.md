# Run-10 Cycle 28/100 Test-Verifier Review

Scope: current HEAD `8753b939a780984b2c988fb6b75ed23ebad98ec9` only. I reviewed the test/gate surface, source-contract tests, e2e coverage, and documented claims in `AGENTS.md` / `CLAUDE.md`. I did not edit application code.

Validation evidence run during review:

- `npm run lint:api-auth --workspace=apps/web` PASS
- `npm run lint:action-origin --workspace=apps/web` PASS
- `npm run lint:public-route-rate-limit --workspace=apps/web` PASS

## Inventory

Blocking quality gates documented for this repo:

- ESLint: `npm run lint --workspace=apps/web`
- Custom API auth scanner: `npm run lint:api-auth --workspace=apps/web`
- Custom server-action origin + restore-barrier scanner: `npm run lint:action-origin --workspace=apps/web`
- Custom public route rate-limit scanner: `npm run lint:public-route-rate-limit --workspace=apps/web`
- Type gates: `npm run typecheck --workspace=apps/web`
- Production build: `npm run build --workspace=apps/web`
- Vitest: `npm test --workspace=apps/web`
- Playwright: `npm run test:e2e --workspace=apps/web`, plus opt-in `npm run test:e2e:admin --workspace=apps/web`
- CLIP real-model preflight: `CLIP_MODELS_ROOT=<abs> npm run test:clip:preflight --workspace=apps/web`; current HEAD also has `.github/workflows/clip-preflight.yml`, so I am not reporting the gated CLIP suite as an uncovered claim.

Current test surface observed:

- 363 top-level Vitest test files under `apps/web/src/__tests__/`.
- 8 Playwright spec files under `apps/web/e2e/`.
- Source-contract tests are heavily used for scanner behavior, migration/schema invariants, SW template parity, privacy-field guards, touch-target policy, client/server boundary, restore-maintenance ordering, and cycle-specific regressions.

## Findings

### 1. HIGH - Server-action origin scanner can miss valid Next server actions outside the blessed directories

Severity: HIGH  
Confidence: Medium-high

Evidence:

- The scanner declares the security-critical intent as "every mutating server action" but its discovered file set is limited to recursive `src/app/actions/`, hard-coded `src/app/[locale]/admin/db-actions.ts`, and `src/app/actions.ts`: `apps/web/scripts/check-action-origin.ts:13-22`, `apps/web/scripts/check-action-origin.ts:92-113`.
- The docs repeat that scope and instruct new actions to live under `app/actions/`: `CLAUDE.md:691-704`.
- The discovery tests prove recursive behavior only for an arbitrary root passed into `walkForActionFiles`; they do not prove the full `src/app` tree rejects or discovers out-of-directory server-action files: `apps/web/src/__tests__/check-action-origin.test.ts:1039-1087`.

Concrete failure scenario:

A future admin page adds `apps/web/src/app/[locale]/admin/(protected)/analytics/actions.ts` with `'use server'` and an exported mutating action that calls `db.delete(...)`, then imports it from a client component. Next accepts that as a server-action module, but `lint:action-origin` never scans it, so missing `requireSameOriginAdmin()` and missing `acquireAdminMutationSlot()` can pass all current custom gates.

Suggested focused test:

Add a placement/discovery contract that walks `src/app/**` for files containing a top-level `'use server'` directive and exported async functions. Fail if such a file is outside the approved scan set, or include it in `discoverActionFiles()`. Fixture it with an out-of-directory server-action file and assert the gate fails before checking source contents.

### 2. MEDIUM - Public-page restore-maintenance body short-circuit is only checked by substring, not by behavior or ordering

Severity: MEDIUM  
Confidence: High

Evidence:

- `CLAUDE.md` says public pages short-circuit during restore maintenance so DB-backed public surfaces do not use the DB as authoritative during a restore window: `CLAUDE.md:449`, `CLAUDE.md:462`.
- The current cycle-28 source contract only asserts each page source contains `isRestoreMaintenanceActive` and `<PublicRestoreMaintenance`; it does not assert these occur before DB-backed reads: `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:27-44`.
- The page bodies currently do the right thing, e.g. home checks maintenance before `getSeoSettings()` and `getImagesLitePage()`: `apps/web/src/app/[locale]/(public)/page.tsx:155-177`.
- Existing behavioral page tests cover normal photo fetch behavior but not the maintenance-active body branch: `apps/web/src/__tests__/photo-page-fetch-behavior.test.ts:127-153`. Cycle 29 covers `generateMetadata()` ordering, not default page-body ordering: `apps/web/src/__tests__/cycle-29-source-contracts.test.ts:21-44`.

Concrete failure scenario:

A refactor moves `const seo = await getSeoSettings()` or `await getImagesLitePage(...)` above the maintenance check while leaving a later `<PublicRestoreMaintenance />` branch in the file. The cycle-28 contract still passes, but during restore maintenance the public page can query a half-imported or temporarily non-authoritative DB before returning the maintenance shell.

Suggested focused test:

For each DB-backed public page, add a small mocked-module unit test for the maintenance-active branch that imports the page, calls its default export, asserts it returns `PublicRestoreMaintenance`, and asserts relevant data mocks (`getSeoSettings`, `getImagesLitePage`, `getImageCached`, `getMapImages`, etc.) were not called. If direct component imports are too heavy for every page, strengthen the source contract to assert `isRestoreMaintenanceActive()` precedes the first DB-read marker inside the `export default` body, mirroring the cycle-29 metadata test.

### 3. MEDIUM - The documented `revalidate = 0` freshness contract for public pages is not locked by a dedicated test

Severity: MEDIUM  
Confidence: High

Evidence:

- `CLAUDE.md` says public home/topic/photo/shared/smart-collection/timeline/year/map pages "currently set `revalidate = 0`" and that ISR should only return with an explicit invalidation plan: `CLAUDE.md:449`. The SW offline-fallback rationale also depends on dynamic public pages emitting no-cache responses: `CLAUDE.md:462`.
- Current pages do set the value, e.g. home: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, photo: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42`, map: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`.
- I found comments in tests mentioning the contract, but no dedicated source contract that enumerates these public pages and fails if `export const revalidate = 0` is removed or changed.

Concrete failure scenario:

A developer removes `revalidate = 0` from `p/[id]/page.tsx` or a route added later under the same public surface. Typecheck, lint, Vitest, and most e2e flows can still pass against fresh test data, while production starts serving stale metadata/photos/share state until Next's cache invalidates. The SW fallback documentation also becomes misleading because the page may no longer be no-cache/dynamic.

Suggested focused test:

Add a source-contract test that enumerates the same public-page list used in cycle-28/cycle-29 and asserts each file contains `export const revalidate = 0;`. Include a comment that static policy pages, such as `about-gallerykit`, are intentionally excluded.

### 4. MEDIUM - Authenticated Playwright coverage still omits first-class admin pages

Severity: MEDIUM  
Confidence: High

Evidence:

- `AdminNav` exposes ten first-class destinations: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, and analytics: `apps/web/src/components/admin-nav.tsx:15-25`.
- The main authenticated navigation Playwright test clicks categories, tags, users, password, and DB only: `apps/web/e2e/admin.spec.ts:20-43`.
- A separate settings-specific test covers settings: `apps/web/e2e/admin.spec.ts:73-103`.
- There is no current Playwright visit/assertion for SEO, tokens, or analytics pages; those surfaces are mostly protected by source/unit contracts.

Concrete failure scenario:

A route-level regression breaks hydration, translations, or a runtime import on `/admin/seo`, `/admin/tokens`, or `/admin/analytics`. Existing unit/source tests can still pass because they inspect component text or source snippets, and the current authenticated browser smoke never navigates to those pages.

Suggested focused test:

Extend `admin.spec.ts` with a table-driven navigation smoke over every `AdminNav` destination. Keep it shallow: click each nav link and assert one stable landmark/control per page, such as the SEO form heading/input, token issue/revoke table affordance, and analytics heading/time-window control. This gives route-level browser proof without turning the spec into full CRUD coverage.

## Notes

No CRITICAL findings. The custom lint gates are currently passing and broad; the gaps above are about surfaces the gates do not prove or source contracts that are too syntactic to catch realistic ordering/freshness regressions.

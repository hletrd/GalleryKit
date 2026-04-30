# Plan 165 — Cycle 1 Metadata, Cache, and Import-Coupling Fixes

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `architect.md`, `code-reviewer.md`, `critic.md`, `debugger.md`, `dependency-expert.md`, `verifier.md`

## Scope
Fix the confirmed metadata/navigation/control-plane defects and remove the auth-wrapper import coupling that currently drags unrelated runtime side effects into admin API routes.

## Planned items

### C165-01 — Fix null-`capture_date` next-photo navigation
- **Findings:** `AG1-01`
- **Goal:** Keep `getImage()` prev/next navigation monotonic when the current image has no `capture_date`.
- **Files to touch:**
  - `apps/web/src/lib/data.ts`
  - tests covering navigation ordering if a narrow regression test can be added safely this cycle
- **Implementation notes:**
  - In the `next` branch, when the current image has `capture_date = NULL`, do not match dated rows as “older”.
  - Prefer a minimal query fix over wider query rewrites.

### C165-02 — Revalidate the full app tree after SEO updates
- **Findings:** `AG1-02`
- **Goal:** Ensure SEO setting changes invalidate every public route/layout/metadata surface that reads `getSeoSettings()`.
- **Files to touch:**
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/lib/revalidation.ts` only if helper changes are necessary
- **Implementation notes:**
  - Reuse the existing layout-level invalidation path instead of adding a long list of hand-maintained public routes.

### C165-03 — Unify runtime SEO/branding consumers with the admin-edited SEO source
- **Findings:** `AG1-03`
- **Goal:** Stop mixing DB-backed SEO settings and static `site-config.json` for live branding surfaces.
- **Files to touch:**
  - `apps/web/src/components/nav.tsx`
  - `apps/web/src/components/nav-client.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/manifest.ts`
  - any small supporting types/helpers needed
- **Implementation notes:**
  - Keep `site-config.json` as fallback/default bootstrap data, not the live source of truth for admin-editable SEO fields.
  - Avoid unnecessary client-side DB reads by passing server-fetched values into client components.

### C165-04 — Decouple admin API auth from the server-action barrel
- **Findings:** `AG1-04`
- **Goal:** Prevent auth-only routes from importing the entire action barrel and triggering image-queue bootstrap side effects.
- **Files to touch:**
  - `apps/web/src/lib/api-auth.ts`
  - any directly-related tests/docs if the build trace or route behavior changes
- **Implementation notes:**
  - Import `isAdmin` from the narrow auth module instead of `@/app/actions`.
  - Verify the change does not alter API auth behavior.

### C165-05 — Revalidate public caches correctly after large batch deletes
- **Findings:** `AG1-07`
- **Goal:** Avoid stale `/p/{id}` and topic pages when deleting large image batches.
- **Files to touch:**
  - `apps/web/src/app/actions/images.ts`
  - tests only if a narrow existing surface can cover the new invalidation behavior
- **Implementation notes:**
  - Prefer a layout-level/public-tree invalidation path for large batches instead of silently skipping deleted photo/topic routes.

## Ralph progress
- 2026-04-20: Plan created from cycle-1 aggregate review.
- 2026-04-20: Fixed null-`capture_date` next-photo navigation in `apps/web/src/lib/data.ts`.
- 2026-04-20: Switched SEO updates and large batch deletes to layout-level invalidation so cached public pages and metadata do not drift.
- 2026-04-20: Unified live branding consumers (`nav`, shared/public photo pages, manifest, photo title updates) around `getSeoSettings()` with `site-config.json` remaining as fallback bootstrap data.
- 2026-04-20: Decoupled auth-only routes/pages from the server-action barrel by importing `isAdmin` from `@/app/actions/auth`.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.

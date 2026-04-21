# Plan 187 — Cycle 8 Ultradeep Fixes

**Source review:** Cycle 8 Aggregate Review (`C8-01` through `C8-08`)
**Status:** DONE
**User-injected TODOs honored this cycle:** `deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`

---

## Findings to Address This Cycle

| ID | Description | Severity | Confidence |
|---|---|---|---|
| C8-01 | `createGroupShareLink()` can silently succeed with a partial or empty image set under concurrent deletes | MEDIUM | HIGH |
| C8-02 | Canonical topic redirects drop active tag filters | MEDIUM | HIGH |
| C8-03 | Search overlay can repopulate stale results after the query is cleared | MEDIUM | HIGH |
| C8-04 | Search/admin thumbnails still fetch the largest base JPEG derivative | MEDIUM | HIGH |
| C8-05 | Successful tag mutations leave the current admin table stale | MEDIUM | HIGH |
| C8-06 | Backup downloads use a derived URL fragment instead of the server-returned filename | LOW | HIGH |
| C8-07 | Copied share links still use the operator's current browser origin instead of the canonical public origin | MEDIUM | HIGH |
| C8-08 | `npm run test:e2e` still depends on pre-seeded state even though the default runner does not seed it | MEDIUM | HIGH |

---

## Implementation Plan

### 1. Make group share creation fail loudly on concurrent delete races (`C8-01`)
**Files:**
- `apps/web/src/app/actions/sharing.ts`

**Plan:**
1. Remove the silent `.ignore()` behavior from the `sharedGroupImages` insert.
2. Verify the association insert count matches `uniqueImageIds.length`.
3. Map FK/concurrency failures to a user-facing `imagesNotFound` style error rather than returning success with a truncated group.
4. Re-run sharing-related flows and deploy smoke checks after the change.

### 2. Preserve tag filters during canonical topic redirects (`C8-02`)
**Files:**
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

**Plan:**
1. Rebuild the canonical redirect target with the current search params intact.
2. Keep locale preservation behavior unchanged.
3. Add regression coverage for alias URLs with `?tags=...` so canonicalization no longer drops active filters.

### 3. Cancel stale search requests when the query clears (`C8-03`)
**Files:**
- `apps/web/src/components/search.tsx`

**Plan:**
1. Invalidate the current request token when the query becomes empty.
2. Clear loading state immediately on the empty-query branch.
3. Verify rapid type/clear interactions no longer repopulate stale results.

### 4. Use configured thumbnail derivatives for tiny preview surfaces (`C8-04`)
**Files:**
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/__tests__/image-url.test.ts`

**Plan:**
1. Add a shared helper for choosing a nearest configured derivative filename/path for tiny JPEG previews.
2. Thread configured `imageSizes` from the server to `Search` and `ImageManager` so preview surfaces use the right derivative even after admin-configured size changes.
3. Add focused helper tests to lock the filename/path behavior.

### 5. Refresh admin image-management state after successful tag mutations (`C8-05`)
**Files:**
- `apps/web/src/components/image-manager.tsx`

**Plan:**
1. Refresh the current route after successful `batchAddTags()` and `batchUpdateImageTags()` calls so the table reflects canonical saved state.
2. Keep existing warnings/toasts intact.
3. Avoid introducing optimistic state that can drift from the server truth.

### 6. Use the returned backup filename directly (`C8-06`)
**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`

**Plan:**
1. Use `result.filename` for the `download` attribute.
2. Keep the existing URL prefix validation intact.
3. Verify the browser download still succeeds and now uses the intended filename.

### 7. Compose copied share URLs from the canonical public origin (`C8-07`)
**Files:**
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`

**Plan:**
1. Thread `seo.url`/canonical public origin from server components into `PhotoViewer` and `ImageManager`.
2. Replace `window.location.origin` composition with the canonical public origin.
3. Keep locale-preserving `localizeUrl()` behavior intact.

### 8. Make the default local E2E runner self-seeding (`C8-08`)
**Files:**
- `apps/web/playwright.config.ts`
- `apps/web/scripts/seed-e2e.ts` (only if needed)

**Plan:**
1. Ensure the default local `npm run test:e2e` path seeds the required topic/group fixtures before the app boots.
2. Preserve remote-run behavior when `E2E_BASE_URL` targets a non-local host.
3. Re-run the Playwright suite locally to prove the self-seeded path works.

---

## Verification Goals

- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- Per-cycle deploy command succeeds after green gates:
  - `ssh -i ~/.ssh/atik.pem ubuntu@gallery.atik.kr "cd /home/ubuntu/gallery && bash apps/web/deploy.sh"`

## Completion Notes

- [x] `C8-01` implemented in `apps/web/src/app/actions/sharing.ts`
- [x] `C8-02` implemented in `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- [x] `C8-03` implemented in `apps/web/src/components/search.tsx`
- [x] `C8-04` implemented via the shared derivative helper in `apps/web/src/lib/image-url.ts` and the affected preview surfaces
- [x] `C8-05` implemented in `apps/web/src/components/image-manager.tsx`
- [x] `C8-06` implemented in `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- [x] `C8-07` implemented by threading the canonical public origin into share-link copy flows
- [x] `C8-08` implemented in `apps/web/playwright.config.ts` + `apps/web/scripts/seed-e2e.ts`

## Verification Results

- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`

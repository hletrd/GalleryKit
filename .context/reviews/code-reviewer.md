# Code Reviewer — review-plan-fix Cycle 1 / Prompt 1

**HEAD:** `1d5545cbf3840fc449fb67998104b5d5f2aab433`
**Date:** 2026-06-22
**Lane:** code-reviewer
**Scope:** whole-repository quality / logic / SOLID / maintainability review, with emphasis on cross-file contracts, state consistency, error handling, schema/data projection contracts, and privacy field contracts.
**Source edits:** none. This review artifact is the only file updated.

## Inventory First

Review-relevant inventory was built before findings were written:

- Project guidance: `AGENTS.md`, `CLAUDE.md`, root/package workspace manifests.
- Core application surface: `apps/web/src/app/**`, including public pages, admin pages, server actions, admin API routes, public API routes, metadata/OG routes, and localized route groups.
- Data/schema contracts: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/db/**`, `apps/web/drizzle/**`, migration helper scripts.
- Security and mutation boundaries: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/app/actions/**`, `apps/web/src/app/api/**`, lint scripts for auth/origin/rate-limit gates.
- Image pipeline / state consistency: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, color/HDR helpers, GPS stripping, backfill runner, upload routes/actions, restore/maintenance helpers.
- Client data consumers: `apps/web/src/components/photo-viewer.tsx`, `color-details-section.tsx`, `info-bottom-sheet.tsx`, `lightbox-color-pip.tsx`, `image-manager.tsx`, public gallery/search/map components.
- Tests and fixtures: focused privacy, map privacy, color details, smart collections, retry failed image, auth/origin/rate-limit, queue, restore, migration, and route contract tests under `apps/web/src/__tests__`.
- Localization: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

Static inventory count for the main reviewed source/test/config areas was 502 files across `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/src/__tests__`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/messages`. I line-read the files named in the findings and sampled adjacent contract tests and callers to distinguish real defects from intentional privacy/security boundaries.

## Findings

### CR-CODE-01 — Admin photo detail mode is fed by the public image projection, so admin-only audit fields never reach the viewer

**Type:** confirmed issue
**Severity:** Medium
**Confidence:** High

**Code regions:**

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:142-149` loads `image` with `getImageCached(imageId)` in the same `Promise.all` that checks `isAdmin()`.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:276-284` passes that same `image` to `<PhotoViewer>` with `canShare={isAdminUser}` and `isAdmin={isAdminUser}`.
- `apps/web/src/lib/data.ts:316-355` defines `publicSelectFields` by omitting privacy/internal fields from `adminSelectFields`.
- `apps/web/src/lib/data.ts:414-417` marks `latitude`, `longitude`, `original_format`, `original_file_size`, `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `was_downscaled`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `color_space`, `icc_profile_name`, and `pipeline_version` as privacy-sensitive public omissions.
- `apps/web/src/lib/data.ts:954-974` implements `getImage(id)` with `...publicSelectFields`, plus only `blur_data_url` and `topic_label`.
- `apps/web/src/components/color-details-section.tsx:375-446` renders admin-only color pipeline, matrix coefficient, EXIF color space, bit-depth, and downscale rows only when those fields are present.
- `apps/web/src/components/color-details-section.tsx:513-549` renders admin HDR/gain-map disclosures from `transfer_function` / `has_gain_map`.
- `apps/web/src/components/photo-viewer.tsx:823-878` has original format/file size, source bit depth, and GPS rows; the GPS comment explicitly says it is unreachable unless an admin-only accessor includes the coordinates.

**Why this is a problem:**

The route's control flow says "admin mode" to the viewer, but the data shape is still "public mode". The privacy projection is correct for unauthenticated visitors, but once `isAdminUser` is true the detail surface is internally inconsistent: it enables admin-only UI branches and sharing controls while starving the audit panels of the fields they are designed to display.

This is not a privacy leak. It is the opposite failure mode: admin-only fields remain protected, but the authenticated admin cannot inspect the full source/color/GPS/HDR metadata from the photo detail surface. The comments in `photo-viewer.tsx:872-878` already document that the GPS branch needs an admin-only accessor, and no such accessor is used by `/p/[id]`.

**Concrete failure scenario:**

An admin opens `/ko/p/123` for an uploaded HDR or gain-map image that has GPS coordinates and source color metadata. `isAdmin()` returns true, so `PhotoViewer` receives `isAdmin={true}`. However `getImageCached` resolves through `getImage`, which selected `publicSelectFields`. Fields such as `transfer_function`, `matrix_coefficients`, `color_space`, `has_gain_map`, `latitude`, `longitude`, `original_format`, and `original_file_size` are absent. The admin sees the detail viewer but cannot see HDR/gain-map honesty disclosures, EXIF color-space audit rows, GPS map link, or original format/file-size information. The dashboard list does not provide an alternate full detail surface; it uses `getAdminImagesLite`, which is intentionally a list projection.

**Suggested fix:**

Add an explicit authenticated detail accessor, for example `getAdminImage(id)` or `getImageDetail(id, { includeAdminFields })`, that selects the admin-only detail fields after `isAdmin()` has been established. In `/p/[id]/page.tsx`, resolve auth first or use a two-step branch so unauthenticated requests keep using `getImageCached` / `publicSelectFields`, while authenticated admins receive the admin projection. Keep the current public privacy guards and add a regression test that:

- public `/p/[id]` data still excludes every `PrivacySensitiveKeys` member;
- admin photo detail data includes representative audit fields (`latitude`, `longitude`, `color_pipeline_decision`, `transfer_function`, `has_gain_map`, `original_format`);
- `PhotoViewer` admin mode is not invoked with a purely public projection.

### CR-CODE-02 — `retryFailedImage` has one remaining hardcoded English error in a translated server-action contract

**Type:** confirmed issue
**Severity:** Low
**Confidence:** High

**Code regions:**

- `apps/web/src/app/actions/images.ts:1085-1096` loads `getTranslations('serverActions')`, validates origin/admin, and returns localized `unauthorized` / `invalidImageId` errors.
- `apps/web/src/app/actions/images.ts:1092-1095` explicitly notes a prior localization cleanup for the invalid-id path.
- `apps/web/src/app/actions/images.ts:1121-1123` returns the hardcoded string `'Image not found or not in a failed state'` when the failed-image row cannot be selected.
- `apps/web/messages/en.json:529-532` and `apps/web/messages/ko.json:529-532` already contain nearby reusable server-action error keys such as `allUploadsFailed`, `imageNotFound`, and `failedToUpdateImage`, but no specific key for the failed-state retry case.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:44-56` currently displays a generic localized toast on failure, which limits user-facing impact, but the server action itself still exposes a non-localized error contract for callers/logs/future UI reuse.

**Why this is a problem:**

The action's error contract is otherwise translation-backed. Returning one raw English string creates contract drift: future callers that show `result.error` directly will regress Korean/admin localization, tests that assert translation-key semantics will miss this path, and the adjacent comment suggests this class of issue was already intentionally cleaned up for another branch in the same function.

**Concrete failure scenario:**

An admin retries an image that was deleted, processed by a concurrent worker, or had its failure state cleared between dashboard render and button click. The query at `images.ts:1117-1119` returns no row. The current dashboard only shows `dashboard.retryFailed`, but a future retry UI or a debugging panel that displays `result.error` directly will surface English text inside the Korean admin flow, unlike sibling image actions that return `t('imageNotFound')` or another localized key.

**Suggested fix:**

Add a dedicated `serverActions.imageNotFoundOrNotFailed` key to both message files and return `t('imageNotFoundOrNotFailed')`, or deliberately reuse a broader existing key such as `t('imageNotFound')` if the UI should not reveal state distinctions. Add a small source or unit test beside `failed-image-retry.test.ts` / `retry-failed-image-auth.test.ts` that rejects this hardcoded string.

## Missed-Issues Sweep

Candidate issues checked and rejected:

- Public GPS map exposure: `publicMapSelectFields` intentionally exposes only `latitude` / `longitude` beyond `publicSelectFields`; `apps/web/src/__tests__/map-privacy.test.ts` locks that exact union and the runtime `topic.map_visible` guard. No finding.
- Smart collection dynamic predicates: `apps/web/src/lib/smart-collections.ts` compiles through allowlisted fields/operators and Drizzle's local `and()` implementation filters `undefined` conditions. Pagination tests cover the action/page contract. No finding.
- Admin API wrapping: `npm run lint:api-auth --workspace=apps/web` passed for admin routes.
- Mutating server action same-origin checks: `npm run lint:action-origin --workspace=apps/web` passed for all scanned mutating actions and documented read-only exemptions.
- Public mutating route rate limits: `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Type-level/schema projection sanity: `npm run typecheck --workspace=apps/web` passed, including `tsconfig.typecheck.json` tests.
- Backup/restore and Lightroom upload paths: reviewed `db-actions.ts`, `api-auth.ts`, `admin-tokens.ts`, and `api/admin/lr/upload/route.ts` for auth, same-origin/token-scope boundaries, restore scanning, upload contract locking, and queue handoff. No finding.
- Queue failure/retry state: reviewed `image-queue.ts`, `failed-image-retry.test.ts`, and `retry-failed-image-auth.test.ts`; failure persistence, retry auth, and failed-state selection are covered. The only issue found there is the low-severity untranslated retry miss above.

Relevant files examined in detail or as contract context:

- `AGENTS.md`, `CLAUDE.md`
- `package.json`, `apps/web/package.json`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/map-privacy.test.ts`
- `apps/web/src/__tests__/color-details-section-delivered.test.ts`
- `apps/web/src/__tests__/failed-image-retry.test.ts`
- `apps/web/src/__tests__/retry-failed-image-auth.test.ts`
- `apps/web/src/__tests__/smart-collections.test.ts`
- `apps/web/src/__tests__/smart-collection-pagination.test.ts`
- `apps/web/src/__tests__/data-tag-names-sql.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

Residual risk: this was a broad static review, not a full execution of `npm test` or `npm run build`. I used targeted source tracing plus the blocking auth/origin/rate-limit/typecheck gates to validate the highest-risk contracts for this lane.

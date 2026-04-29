# API Reviewer Report — Cycle 3 / Prompt 1

Date: 2026-04-29  
Role: `api-reviewer`  
Scope: public/admin routes, server actions, types/return unions, validation, backwards compatibility, Next.js route semantics, and client call sites.  
Constraint: review-only; no implementation files edited.

## Inventory examined

I inventoried and reviewed the relevant contract surfaces rather than sampling:

- Public app routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, public layout, and localized upload route.
- Admin routes/pages/clients: protected admin layout plus dashboard, DB backup/restore/export, password, SEO, settings, categories/topic manager, tags/tag manager, users, login form, and admin index/layout.
- Server actions: `apps/web/src/app/actions.ts`, `actions/auth.ts`, `actions/images.ts`, `actions/public.ts`, `actions/seo.ts`, `actions/settings.ts`, `actions/sharing.ts`, `actions/tags.ts`, `actions/topics.ts`, `actions/admin-users.ts`, and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Route handlers and metadata routes: admin DB download, health/live, OG image, upload handlers, robots, sitemap, manifest, icon/apple-icon.
- Contract helpers/types: `lib/action-result.ts`, `lib/action-guards.ts`, `lib/validation.ts`, `lib/api-auth.ts`, `lib/request-origin.ts`, `lib/session.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/backup-filename.ts`, `lib/serve-upload.ts`, `lib/upload-limits.ts`, `lib/gallery-config-shared.ts`, `lib/gallery-config.ts`, `lib/seo-og-url.ts`, `lib/sanitize.ts`, `lib/revalidation.ts`, `lib/data.ts`, `lib/image-types.ts`, `lib/image-url.ts`, `lib/constants.ts`, `lib/tag-slugs.ts`, `db/schema.ts`, `db/index.ts`.
- Client action call sites: `components/load-more.tsx`, `search.tsx`, `photo-viewer.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `admin-header.tsx`, `admin-user-manager.tsx`, and the admin client/page call sites listed above.
- Related contract tests checked for expectations: public actions, load-more rate limiting, SEO actions, tag actions, topic actions, image actions, admin users, and backup download route tests.

## Findings

### API-01 — `loadMoreImages` returns transient blocked states with `hasMore: true`, causing auto-retry loops in the client

- Severity: Medium
- Confidence: High
- Evidence:
  - `apps/web/src/app/actions/public.ts:16-19` defines `maintenance` / `rateLimited` results as `images: []` with `hasMore: true`.
  - `apps/web/src/app/actions/public.ts:67` returns `{ status: 'maintenance', images: [], hasMore: true }`.
  - `apps/web/src/app/actions/public.ts:91-93` returns `{ status: 'rateLimited', images: [], hasMore: true }`.
  - `apps/web/src/components/load-more.tsx:57-62` copies `page.hasMore` for non-OK statuses and only shows a toast.
  - `apps/web/src/components/load-more.tsx:95-105` keeps observing the sentinel, and `apps/web/src/components/load-more.tsx:112-118` keeps rendering it while `hasMore` is true.
  - Existing tests also lock this server return shape: `apps/web/src/__tests__/public-actions.test.ts:141-144`, `169-172`; `apps/web/src/__tests__/load-more-rate-limit.test.ts:95-100`, `179-180`.
- Failure scenario: once a user scrolls the sentinel into view during restore maintenance or after hitting the load-more limiter, the action returns a blocked status but leaves `hasMore` true. The observer remains attached, `loading` flips back to false, and the still-visible sentinel can trigger another call/toast cycle. Under rate limiting this can repeatedly hammer the action and extend the limited state; under maintenance it can spam users and server logs until the page is navigated away or the sentinel leaves view.
- Concrete fix: make the contract distinguish “more data exists” from “client may immediately retry.” Either return `hasMore: false` for `maintenance` / `rateLimited`, or add a field such as `retryAfterMs` / `blocked: true` and update `LoadMore` to disconnect/back off and hide/disable the sentinel for blocked statuses. Update the tests that currently assert `hasMore: true` on blocked statuses.

### API-02 — SEO/settings update actions assume a well-formed `Record<string,string>` before runtime validation

- Severity: Medium
- Confidence: High
- Evidence:
  - `apps/web/src/app/actions/seo.ts:55` exposes `updateSeoSettings(settings: Record<string, string>)`, but runtime validation starts with `Object.keys(settings)` at `apps/web/src/app/actions/seo.ts:64-70` and then calls `value.trim()` at `apps/web/src/app/actions/seo.ts:91-94`.
  - `apps/web/src/app/actions/settings.ts:40` exposes `updateGallerySettings(settings: Record<string, string>)`, but it also starts with `Object.keys(settings)` at `apps/web/src/app/actions/settings.ts:50-56` and `value.trim()` at `apps/web/src/app/actions/settings.ts:62-65`.
  - Current clients send changed objects (`apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-50`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:37-52`), but the server action is the trust boundary and can be invoked with malformed serialized data.
- Failure scenario: a stale/buggy client, browser console call, or unexpected server-action serialization payload sends `null`, an array, or a record containing a non-string value. `Object.keys(null)` or `value.trim()` throws before the action can return its `{ error }` union, so the client falls into a generic catch path and the server action contract becomes a rejected invocation/500 instead of a localized validation error.
- Concrete fix: add an early runtime envelope guard in both actions, e.g. `isPlainRecord(settings)` plus `typeof value === 'string'` for every entry, before `Object.keys`/`Object.entries` trimming. Return the existing invalid-key/invalid-value localized errors instead of throwing. Add regression tests for `null`, arrays, and non-string values.

### API-03 — `batchUpdateImageTags` has a one-off return contract and unguarded array parameters

- Severity: Medium
- Confidence: High
- Evidence:
  - Most tag mutations return `{ error } | { success: true }` (`apps/web/src/app/actions/tags.ts:42-98`, `100-137`, `139-255`, `257-336`), while `batchUpdateImageTags` declares a different shape: `Promise<{ success: boolean; added: number; removed: number; warnings: string[] }>` at `apps/web/src/app/actions/tags.ts:338-342`.
  - It returns failures via `success: false` plus `warnings` (`apps/web/src/app/actions/tags.ts:345-349`, `421-424`) rather than an `error` field.
  - It dereferences `addTagNames.length` / `removeTagNames.length` before checking `Array.isArray` at `apps/web/src/app/actions/tags.ts:355-358`, then iterates both values at `apps/web/src/app/actions/tags.ts:375-402`.
  - The client call site treats success warnings but drops failure warnings and shows a generic toast: `apps/web/src/components/image-manager.tsx:416-428`.
  - The repo has a standard action result type that this does not follow: `apps/web/src/lib/action-result.ts:1-4`.
- Failure scenario: if the action receives malformed data for `addTagNames` or `removeTagNames`, a non-array value can either throw (`undefined.length`) or be iterated incorrectly (`'abc'` iterates characters). Even for legitimate server-side failures like unauthorized, maintenance, or image-not-found, the client discards the specific warning text and only shows `batchAddFailed`, breaking the observable error contract.
- Concrete fix: normalize this action to the common action union, e.g. `{ success: true, added, removed, warnings } | { error: string, warnings?: string[] }`, or wrap the payload in `ActionResult<{ added; removed; warnings }>` consistently. Validate `Array.isArray(addTagNames)` and `Array.isArray(removeTagNames)` before reading `.length`, validate each element is a string, and update the client to display `res.error ?? res.warnings?.join('\n')` on failure.

### API-04 — Tags admin page ignores the `getAdminTags` error branch and silently renders an empty manager

- Severity: Low
- Confidence: High
- Evidence:
  - `getAdminTags` returns `{ success: true, tags }` or `{ error }`: `apps/web/src/app/actions/tags.ts:18-39`.
  - `TagsPage` destructures only `tags` and falls back to an empty array: `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx:6-12`.
- Failure scenario: if the admin session check fails unexpectedly or the tag query fails, the page renders the tag manager as though the gallery simply has no tags. Operators lose the localized error and may attempt mutations against a misleading empty state.
- Concrete fix: mirror the SEO/settings admin page pattern: store the full result, branch on `result.success`, and render an error/alert state for `result.error` instead of passing `[]`.

### API-05 — `createTopicAlias` checks wrapped MySQL errors inconsistently, weakening backwards-compatible error messages

- Severity: Low
- Confidence: Medium
- Evidence:
  - `createTopicAlias` catches duplicate and FK failures at `apps/web/src/app/actions/topics.ts:427-438`.
  - The duplicate branch tries to inspect `e.cause?.code` but only after `isMySQLError(e)` succeeds: `apps/web/src/app/actions/topics.ts:431-432`.
  - The FK branch only checks top-level `e.code`: `apps/web/src/app/actions/topics.ts:434-435`.
  - The helper intended to check both top-level and wrapped codes exists at `apps/web/src/lib/validation.ts:109-117`.
- Failure scenario: if Drizzle/mysql wraps `ER_DUP_ENTRY` or `ER_NO_REFERENCED_ROW_2` under `cause` without a top-level `code`, the action falls through to the generic `failedToCreateTopic` error instead of preserving `aliasAlreadyExists` or `topicNotFound`. That is an avoidable API/backwards-compatibility regression for clients and tests that distinguish validation conflicts from generic server failure.
- Concrete fix: import/use `hasMySQLErrorCode` for both checks: `hasMySQLErrorCode(e, 'ER_DUP_ENTRY')` and `hasMySQLErrorCode(e, 'ER_NO_REFERENCED_ROW_2')`. Add tests with wrapped `cause.code` errors.

### API-06 — Dedicated DB connection acquisition sits outside return-union catches in two admin actions

- Severity: Low
- Confidence: High
- Evidence:
  - `deleteAdminUser` obtains a pool connection before its `try`: `apps/web/src/app/actions/admin-users.ts:202-207`; the catch that returns localized errors starts at `apps/web/src/app/actions/admin-users.ts:245-257`.
  - `restoreDatabase` also obtains a pool connection before its `try`: `apps/web/src/app/[locale]/admin/db-actions.ts:288-294`; subsequent failures return `{ success: false, error }` inside later control flow (`apps/web/src/app/[locale]/admin/db-actions.ts:303-345`).
- Failure scenario: if the MySQL pool is exhausted, credentials are invalid, or the DB is temporarily unavailable at connection checkout, the server action rejects before it reaches the documented return union. The admin client receives a thrown action/generic catch path instead of the localized `failedToDeleteUser` / `restoreFailed` style response used for later DB errors.
- Concrete fix: move `connection.getConnection()` into the protected block or wrap it in a small acquisition `try/catch` that returns the existing failure union. Keep `conn.release()` guarded behind `if (conn)`.

## Passed checks / notes

- Mutating server actions consistently call `requireSameOriginAdmin()` after auth/maintenance checks; read-only admin getters are explicitly annotated as origin-exempt.
- Upload route handlers delegate to `serveUploadFile`, which validates path segments, allowed directories, realpath containment, and MIME extension before streaming.
- Admin DB download route uses `withAdminAuth`, same-origin provenance checks with `allowMissingSource: false`, filename validation, backup-directory containment, symlink rejection, and `Content-Disposition: attachment`.
- Public search and load-more server actions use discriminated status unions; the issue above is the retry semantics of the blocked load-more states, not the existence of the union.

## Final missed-issues sweep

Commands run before writing this report:

- `rg` sweep for return unions, `Object.keys`/`Object.entries`, array length/`Array.isArray`, `hasMore: true`, and `{ error }`/`{ success }` shapes across `app/actions`, admin DB actions, components, and admin routes.
- `rg` sweep for route handlers, `withAdminAuth`, `NextResponse`, `allowMissingSource`, `@action-origin-exempt`, and `requireSameOriginAdmin` across `app` and `lib`.
- `rg` sweep for client result/error/warning/status handling across `components` and admin client/page files.
- `rg` sweep for related test assertions around `loadMoreImages`, `rateLimited`, `maintenance`, `updateSeoSettings`, `batchUpdateImageTags`, `createTopicAlias`, admin users, and backup download route.

No implementation tests were run because this pass only edits the review artifact.

# API Reviewer Report — Cycle 1

Scope: API routes, server actions, request/response contracts, auth wrappers, origin guards, caching/revalidation, validation, rate limits, public/private data separation, and related integration/unit tests.

Review date: 2026-05-02 (Asia/Seoul). No application code was changed.

## Inventory reviewed

### HTTP/API route handlers
- `apps/web/src/app/api/admin/db/download/route.ts` — admin backup download, `withAdminAuth`, filename/path containment, no-store response headers.
- `apps/web/src/app/api/health/route.ts` — public health/readiness JSON, restore-maintenance and optional DB check.
- `apps/web/src/app/api/live/route.ts` — public liveness JSON.
- `apps/web/src/app/api/og/route.tsx` — public OG image generation, validation, public cache, ETag, in-memory OG rate limit.
- `apps/web/src/app/uploads/[...path]/route.ts` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts` — public upload-file serving via shared helper.

### Server actions
- Barrel: `apps/web/src/app/actions.ts`.
- Auth/session actions: `apps/web/src/app/actions/auth.ts`.
- Admin user actions: `apps/web/src/app/actions/admin-users.ts`.
- Image actions: `apps/web/src/app/actions/images.ts`.
- Public read actions: `apps/web/src/app/actions/public.ts`.
- SEO/settings actions: `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/settings.ts`.
- Sharing actions: `apps/web/src/app/actions/sharing.ts`.
- Tag/topic actions: `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`.
- DB admin actions: `apps/web/src/app/[locale]/admin/db-actions.ts`.

### Related public route-like pages reviewed for lookup/rate-limit contracts
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`.

### Shared libraries reviewed
- Auth/origin/session/rate limit: `apps/web/src/lib/api-auth.ts`, `action-guards.ts`, `request-origin.ts`, `session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`.
- Validation/sanitization/upload limits: `apps/web/src/lib/validation.ts`, `sanitize.ts`, `upload-limits.ts`, `upload-paths.ts`, `serve-upload.ts`.
- Cache/revalidation/data/privacy: `apps/web/src/lib/revalidation.ts`, `data.ts`, `gallery-config.ts`, `gallery-config-shared.ts`.
- DB backup/restore/audit helpers: `apps/web/src/lib/db-restore.ts`, `sql-restore-scan.ts`, `backup-filename.ts`, `audit.ts`.
- Security lint gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`.
- Middleware/proxy context: `apps/web/src/proxy.ts`, `apps/web/next.config.ts`.

### Related tests reviewed
- Route/auth/origin: `backup-download-route.test.ts`, `health-route.test.ts`, `live-route.test.ts`, `serve-upload.test.ts`, `request-origin.test.ts`, `action-guards.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, `origin-guard.spec.ts`.
- Rate limits/auth: `rate-limit.test.ts`, `auth-rate-limit.test.ts`, `auth-rate-limit-ordering.test.ts`, `auth-no-rollback-on-infrastructure-error.test.ts`, `load-more-rate-limit.test.ts`, `og-rate-limit.test.ts`, `public-actions.test.ts`.
- Actions/data/privacy/validation: `admin-users.test.ts`, `admin-user-create-ordering.test.ts`, `images-actions.test.ts`, `images-delete-revalidation.test.ts`, `sharing-source-contracts.test.ts`, `shared-route-rate-limit-source.test.ts`, `tags-actions.test.ts`, `topics-actions.test.ts`, `seo-actions.test.ts`, `settings-image-sizes-lock.test.ts`, `privacy-fields.test.ts`, `validation.test.ts`, `sanitize*.test.ts`, `revalidation.test.ts`, `db-restore.test.ts`, `sql-restore-scan.test.ts`, `restore-upload-lock.test.ts`.
- E2E smoke/integration: `apps/web/e2e/admin.spec.ts`, `public.spec.ts`, `origin-guard.spec.ts`.

## Findings

### HIGH-01 — Confirmed — `deleteAdminUser` lock no longer protects the “never delete the last admin” invariant

- Evidence: `deleteAdminUser` checks current user/origin and validates the id at `apps/web/src/app/actions/admin-users.ts:179-190`, then documents a concurrency invariant at `198-207`. However, the advisory lock is scoped to the target id at `211-215`, while the transaction only checks `COUNT(*)` at `227-233` before deleting the target at `243-252`.
- Failure scenario: With two admin accounts, admin A deletes admin B while admin B simultaneously deletes admin A. The target ids differ, so the calls acquire different locks. Both transactions can observe `COUNT(*) = 2` and both delete, leaving zero admin accounts or a locked-out installation.
- Suggested fix: Use one global admin-delete lock for the count-and-delete critical section, or enforce the invariant in a single serializable transaction/conditional delete that locks the admin set, not only the target row. Add a concurrency unit/integration test for two different target ids.
- Confidence: High.

### MEDIUM-01 — Confirmed — Public share-key metadata performs DB lookups before the lookup rate limit

- Evidence: The single-photo share route intentionally avoids rate limiting in metadata (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-47`) but still calls `getImageByShareKeyCached(key)` at `54`; the page body rate limit happens later at `101-112`. The group share route has the same shape: metadata comment at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-43`, DB lookup at `50`, and rate limit only later at `111-121`. The source-contract tests lock in “no metadata rate limit” at `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-49`.
- Failure scenario: A bot requests many valid-looking `/s/{key}` or `/g/{key}` URLs. Even after the page body would return `notFound()` from `preIncrementShareAttempt`, the metadata path has already queried the DB. For valid keys, metadata can also be computed before the explicit lookup budget is enforced.
- Suggested fix: Do not perform share-key DB lookups from `generateMetadata`; return generic `noindex` metadata for share routes, or centralize the lookup/rate-limit in a request-scoped path that increments once and is shared by metadata and page rendering. Add an integration/source test that asserts no `getImageByShareKeyCached`/`getSharedGroupCached` call precedes the first lookup limiter.
- Confidence: High.

### MEDIUM-02 — Confirmed — `/api/og` rolls back rate-limit budget for nonexistent topics after doing DB work

- Evidence: `/api/og` validates `topic`, pre-increments the OG limiter at `apps/web/src/app/api/og/route.tsx:38-61`, then performs `getSeoSettings()` and `getTopicBySlug(topic)` at `63-66`. If the topic is missing, it calls `rollbackOgAttempt(ip)` and returns 404 at `67-77`. The helper test only covers bucket mechanics (`apps/web/src/__tests__/og-rate-limit.test.ts:15-44`), not the route’s 404 rollback contract.
- Failure scenario: An unauthenticated script sends unlimited requests for random valid slugs such as `/api/og?topic=probe-000001`. Each request performs SEO/topic DB reads, then rolls back the limiter, so it never reaches the 30/minute budget.
- Suggested fix: Treat post-DB 404s as budget-consuming attempts, or introduce a separate cheap negative-lookup budget. Only “free” requests that fail validation before expensive work. Add a route-level test for repeated nonexistent-topic requests reaching 429.
- Confidence: High.

### MEDIUM-03 — Confirmed — Existing photo-share no-op path decrements rate-limit counters before any increment

- Evidence: `createPhotoShareLink` fetches the image at `apps/web/src/app/actions/sharing.ts:95-99`. If `image.share_key` already exists, it calls `rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)` at `100-105`, but the in-memory and DB pre-increments do not occur until `108-120`. `rollbackShareRateLimitFull` decrements both stores at `71-75`.
- Failure scenario: An admin/client repeatedly calls `createPhotoShareLink` for an already-shared image. Each call can decrement prior `share_photo` budget from other share operations in the same window, allowing the write-rate limit to be bypassed or made inaccurate.
- Suggested fix: Remove the rollback on the initial `image.share_key` no-op branch because there is no current attempt to undo. Keep rollbacks only after a pre-incremented attempt is known to have happened. Add a unit test covering the initial already-shared branch.
- Confidence: High.

### MEDIUM-04 — Confirmed — Upload tag parsing silently strips rejected control/formatting characters instead of rejecting

- Evidence: `uploadImages` sanitizes the submitted topic and tag string with `stripControlChars` at `apps/web/src/app/actions/images.ts:131-138`, then validates the already-stripped `candidateTags` at `151-158`. Other admin-controlled strings use `requireCleanInput`/`sanitizeAdminString` and reject when sanitization changes input, e.g. tag update at `apps/web/src/app/actions/tags.ts:56-65` and image metadata at `apps/web/src/app/actions/images.ts:729-737`. Tests cover invalid tag punctuation (`apps/web/src/__tests__/images-actions.test.ts:229-256`) but not Unicode bidi/zero-width/control-character rejection in upload tag strings.
- Failure scenario: A direct Server Action caller submits `tags="safe\u202Ename"` or embedded C0 controls. The action strips the invisible/control character and persists/uses a different tag than the admin submitted, bypassing the rejection policy used by the rest of the admin string surface.
- Suggested fix: Use `requireCleanInput` on each candidate tag or reject when `stripControlChars(tagsString)` differs from the raw `tags` input. Consider applying the same reject-on-change policy to `topic` in `uploadImages` for contract consistency. Add upload action tests for bidi, zero-width, and C0 tag inputs.
- Confidence: High.

### LOW-01 — Likely — Integration/source tests miss the highest-risk cross-surface regressions found above

- Evidence: Existing origin/auth gates are strong and CI runs them (`.github/workflows/quality.yml:50-63`); `check-api-auth` scans admin API routes (`apps/web/scripts/check-api-auth.ts:17-30`, `160-177`) and `check-action-origin` scans mutating actions (`apps/web/scripts/check-action-origin.ts:13-21`, `331-344`). However, current tests do not cover `deleteAdminUser` concurrency; `admin-users.test.ts` imports and describes only `createAdminUser` at `apps/web/src/__tests__/admin-users.test.ts:99-178`. The share metadata test explicitly asserts metadata has no limiter (`apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-49`) and `sharing-source-contracts.test.ts` covers only the concurrent-winner rollback branch at `1-16`, not the initial already-shared branch.
- Failure scenario: A future refactor can keep all current quality gates green while preserving the admin-delete race, the metadata lookup bypass, or the initial share no-op rollback bug.
- Suggested fix: Add targeted tests for the scenarios in HIGH-01, MEDIUM-01, MEDIUM-02, and MEDIUM-03. Prefer behavior tests over string-only source-contract tests where feasible.
- Confidence: Medium.

## Positive controls confirmed

- Admin API auth wrapper: the only `/api/admin` route is wrapped with `withAdminAuth` (`apps/web/src/app/api/admin/db/download/route.ts:17`); `withAdminAuth` enforces same-origin first and admin auth second at `apps/web/src/lib/api-auth.ts:26-47` and adds `nosniff` on success at `48-54`.
- Origin primitive fails closed by default (`apps/web/src/lib/request-origin.ts:83-107`) and is covered for same-origin, cross-origin, missing provenance, and proxy behavior (`apps/web/src/__tests__/request-origin.test.ts:24-143`).
- Mutating server actions consistently call `requireSameOriginAdmin()` or use direct auth-origin checks in `auth.ts`; the lint gate passed during this review.
- Public/private image field separation is deliberate: `publicSelectFields` omits sensitive keys in `apps/web/src/lib/data.ts:280-326`, and `privacy-fields.test.ts:15-62` enforces the contract.
- Backup download filename validation and realpath containment are layered (`apps/web/src/app/api/admin/db/download/route.ts:19-59`), and route tests cover auth, cross-origin, missing provenance, success streaming, and filesystem failures (`backup-download-route.test.ts:72-161`).
- Upload serving denies invalid top-level dirs/extension mismatches/symlink traversal (`apps/web/src/lib/serve-upload.ts:32-105`) and is covered by `serve-upload.test.ts:25-74`.

## Verification run

- `npm run lint:api-auth` — passed.
- `npm run lint:action-origin` — passed.
- Targeted tests: `npm run test --workspace=apps/web -- --run src/__tests__/backup-download-route.test.ts src/__tests__/request-origin.test.ts src/__tests__/action-guards.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/images-actions.test.ts src/__tests__/sharing-source-contracts.test.ts src/__tests__/shared-route-rate-limit-source.test.ts` — 8 files / 64 tests passed.

## Final missed-issues sweep

Performed a final grep sweep over:
- all `route.ts`/`route.tsx` files under `apps/web/src/app`;
- every exported server action under `apps/web/src/app/actions` and `apps/web/src/app/[locale]/admin/db-actions.ts`;
- auth/origin/rate-limit/revalidation call sites;
- public share lookup pages;
- API/action lint gates and related tests.

No additional unwrapped `/api/admin` route, missing mutating-action origin guard, direct path traversal issue, or public sensitive image-field leak was found.

## Skipped files

- Generated/build artifacts: `apps/web/.next/**`.
- Dependencies: `node_modules/**`.
- Non-API visual/unit-only tests not tied to request/action contracts (for example lightbox math, touch target audits) were not cited, except where E2E smoke was relevant.
- No application source files were edited.

## Counts by severity

- Critical: 0
- High: 1
- Medium: 4
- Low: 1
- Total findings: 6

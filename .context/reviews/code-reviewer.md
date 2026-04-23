# Code Reviewer Deep Review — Cycle 6

## Inventory / Coverage

Reviewed the tracked repository with emphasis on `apps/web` source, tests, build/deploy config, and cross-file interactions.

Coverage inventory:
- `apps/web/src`: 189 tracked source files
- `apps/web/src/__tests__`: 41 unit test files
- `apps/web/e2e`: 7 E2E files/specs
- `apps/web/scripts`: 13 scripts
- Root/app config and docs: `README.md`, root/app `package.json`, Next/Vitest/Playwright/ESLint/TS/Drizzle/Docker configs

Explicitly excluded as non-review targets: generated/untracked/runtime artifacts such as `.next/`, `node_modules/`, `test-results/`, local env files, and binary fixture contents beyond existence/usage checks.

Tooling/verification used:
- `npm run lint --workspace=apps/web`
- `npm run test --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- targeted grep/pattern sweeps for `console.log`, empty catches, hardcoded secrets, route/auth usage, and cross-file call paths

Verification result: lint, unit tests, build, and admin API auth lint all passed.

## Stage 1 — Spec / Intent Compliance

Broadly, the repository still matches the intended product shape: self-hosted localized gallery, admin workflows, image processing pipeline, sharing, backup/restore, and test/build surfaces are present and working at a baseline level.

That said, I do **not** consider Stage 1 fully passed because there are correctness/operational gaps that undermine expected behavior in real usage:
- rate limiting is effectively global when `TRUST_PROXY` is missing,
- gallery infinite scroll is built on mutable offset pagination,
- the checked-in topic seed path creates data that violates current runtime invariants.

## Confirmed Issues

### 1. [MEDIUM] Per-IP rate limiting silently collapses into one global bucket when `TRUST_PROXY` is unset
- **Files / regions:**
  - `apps/web/src/lib/rate-limit.ts:61-86`
  - representative callers: `apps/web/src/app/actions/auth.ts:92-107`, `apps/web/src/app/actions/public.ts:39-47`, `apps/web/src/app/actions/images.ts:120-157`, `apps/web/src/app/actions/sharing.ts:84-112`
- **Why this is a problem:**
  - `getClientIp()` returns the literal string `"unknown"` whenever `TRUST_PROXY !== 'true'`.
  - All login/search/upload/share/user-create limits then key off the same constant value.
- **Concrete failure scenario:**
  - A direct/self-host deployment (or a proxy deployment with `TRUST_PROXY` accidentally omitted) puts every visitor into the same bucket.
  - One client can exhaust the login/search/upload/share budget for every other client, creating an application-wide denial of service instead of per-IP throttling.
- **Suggested fix:**
  - Fail fast in production when no trusted client IP source is configured, instead of silently falling back to `"unknown"`; or
  - plumb a real client IP from `NextRequest`/trusted proxy middleware into the rate-limit layer; and
  - avoid using a single shared constant as the rate-limit key for security-sensitive paths.
- **Confidence:** High

### 2. [MEDIUM] Infinite scroll uses offset pagination over a live, mutable sort order, so new uploads can cause skipped or duplicated photos
- **Files / regions:**
  - `apps/web/src/app/actions/public.ts:11-28`
  - `apps/web/src/lib/data.ts:318-335`
  - `apps/web/src/components/load-more.tsx:20-41`
- **Why this is a problem:**
  - The gallery sorts by `capture_date`, `created_at`, `id`, but `LoadMore` advances by `offset`.
  - Offset pagination is unstable when rows are inserted or finish processing between requests.
- **Concrete failure scenario:**
  - A user opens the homepage, loads the first 30 photos, then a new processed upload lands at the top of the feed.
  - The next request asks for `offset=30`; because the dataset shifted, one older photo is skipped or one already-seen photo is duplicated.
  - This is especially plausible here because uploads become visible asynchronously after queue processing.
- **Suggested fix:**
  - Replace offset pagination with cursor/keyset pagination using the active sort tuple (`capture_date`, `created_at`, `id`), and pass that cursor through `loadMoreImages`/`LoadMore`.
- **Confidence:** High

### 3. [LOW] The legacy topic seed path creates topic slugs that the runtime now treats as invalid/unresolvable
- **Files / regions:**
  - `apps/web/src/db/seed.ts:4-10`
  - `apps/web/src/lib/validation.ts:12-15`
  - `apps/web/src/lib/data.ts:672-704`
  - `apps/web/src/app/actions/topics.ts:148-153`, `apps/web/src/app/actions/topics.ts:294-299`
- **Why this is a problem:**
  - `src/db/seed.ts` inserts uppercase topic slugs (`IDOL`, `PLANE`).
  - Current runtime rules only accept lowercase slugs.
  - `getTopicBySlug()` only direct-matches lowercase-safe slugs, and topic mutation actions reject uppercase current slugs.
- **Concrete failure scenario:**
  - If a developer/operator runs this seed script, the seeded topics can become unreachable by the public topic route and impossible to update/delete through the current admin action path without manual SQL cleanup.
- **Suggested fix:**
  - Normalize seeded slugs to lowercase in `src/db/seed.ts`, or
  - make topic lookup/admin mutation flows tolerate legacy uppercase slugs long enough to migrate them.
- **Confidence:** High

## Risks Requiring Manual Validation

### A. [RISK] Sensitive admin mutations are inconsistent about explicit same-origin enforcement
- **Files / regions:**
  - explicit checks exist in `apps/web/src/app/actions/auth.ts` and `apps/web/src/app/api/admin/db/download/route.ts`
  - but not in many other sensitive mutations such as `apps/web/src/app/actions/images.ts`, `tags.ts`, `topics.ts`, `settings.ts`, `seo.ts`, `sharing.ts`, `admin-users.ts`, and `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Why this needs validation:**
  - This may be acceptable if you are intentionally relying on framework-level Server Action origin protection.
  - But the codebase currently applies app-level provenance checks only on some sensitive paths, so the trust model is inconsistent and easy to regress during framework/deployment changes.
- **Manual validation ask:**
  - Confirm the deployed Next.js/server-action configuration still enforces origin/CSRF protections for all mutation surfaces, especially after proxy/header changes.
- **Confidence:** Medium

## Final missed-issues sweep

I did a final sweep across:
- route/auth wrappers,
- upload/restore/backup paths,
- topic/tag/share flows,
- pagination/search interactions,
- runtime/build/deploy config,
- unit/E2E coverage inventory.

I did **not** find any additional confirmed high-severity code-quality/correctness defects beyond the items above.

## Recommendation

**REQUEST CHANGES**

Rationale:
- The repo is in generally solid shape and all verification commands passed.
- However, the two medium-severity correctness issues are user-visible/operational enough that I would not sign off without fixes.

# Code Reviewer Report - Cycle 17/100

HEAD reviewed: `5e054f80f646cbcd16c7aae5412aa29424e05032`
Branch: `master`
Scope: current `HEAD`, static deep review of repository code quality, logic, SOLID/maintainability, correctness, and cross-file interactions.
Provenance: read `AGENTS.md` and `CLAUDE.md` first; inventoried tracked/source/test/doc surfaces; compared cycle 16 base `3da74946a7e7a198041bf6067a0192411d61a860..HEAD`; inspected implementation and tests for changed and high-risk paths.
Outcome: 4 confirmed issues, 1 likely issue, 3 manual-validation risks. No critical/high-severity runtime vulnerability confirmed in this pass.

## Confirmed Issues

### C17-CR-01 - Tag rename/delete changes public photo content without bumping image freshness timestamps

Severity: MEDIUM
Confidence: High

Code regions:
- `apps/web/src/app/actions/tags.ts:42-91`
- `apps/web/src/app/actions/tags.ts:99-129`
- `apps/web/src/lib/data.ts:523-529`
- `apps/web/src/lib/data.ts:537-543`
- `apps/web/src/lib/data.ts:842-853`
- `apps/web/src/lib/data.ts:1627-1638`
- `apps/web/src/app/sitemap.ts:57-80`
- `apps/web/src/lib/photo-title.ts:38-52`

Problem:
Cycle 16/17 work correctly started using `images.updated_at` for sitemap `<lastmod>` and feed freshness. Direct tag add/remove paths now bump `images.updated_at`, but `updateTag` and `deleteTag` do not bump any affected image rows. That leaves a cross-file invariant broken: tag names are public photo content, but the freshness signals for those photo URLs are still tied only to the image row timestamp.

Concrete failure scenario:
An admin renames a widely used tag from `draft` to `portfolio` or deletes an accidental tag. Public photo pages, gallery cards, JSON-LD/alt/title helpers, and feeds derive visible text from `tags.name` through `tag_names`/tag joins. The page content changes immediately, but `getImageIdsForSitemap()` still returns the old `images.updated_at`, `getTopics()` still reports the old `MAX(images.updated_at)`, and `getImagesForFeed()` still orders entries as if no public content changed. Crawlers/feed readers that trust `<lastmod>` or Atom ordering may miss the content update.

Suggested fix:
In `updateTag`, select linked image ids for the tag and update `images.updated_at = CURRENT_TIMESTAMP` for those ids after the tag rename succeeds. In `deleteTag`, capture linked image ids before deleting `image_tags`, then bump those image rows in the same transaction. Add tests that `updateTag` and `deleteTag` issue the image freshness bump, and add a sitemap/feed regression that documents tag-derived content as a freshness-affecting mutation.

### C17-CR-02 - Public route rate-limit scanner can bless an inverted local helper

Severity: MEDIUM
Confidence: High

Code regions:
- `apps/web/scripts/check-public-route-rate-limit.ts:129-170`
- `apps/web/scripts/check-public-route-rate-limit.ts:193-214`
- `apps/web/scripts/check-public-route-rate-limit.ts:271-275`
- `apps/web/scripts/check-public-route-rate-limit.ts:345-350`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:326-360`

Problem:
The new local-helper support marks a helper as an approved rate-limit gate if the helper contains a syntactic pre-increment/early-return pattern and no mutation. The exported handler then treats any call to that helper inside an early-returning `if` as a valid gate. The scanner never verifies the helper's return semantics, so an inverted helper can pass while allowing over-limit requests to mutate.

Concrete failure scenario:
This route shape passes the scanner but mutates when over limit:

```ts
import { preIncrementShareAttempt } from '@/lib/rate-limit';

async function enforceQuota(ip: string) {
  const overLimit = preIncrementShareAttempt(ip);
  if (overLimit) return false;
  return true;
}

export async function POST() {
  if (await enforceQuota('1.2.3.4')) return Response.json({}, { status: 429 });
  await db.insert(rows).values({ ok: true });
  return Response.json({ ok: true });
}
```

The helper is added to `localRateLimitGateFunctions`, and the handler's `if (await enforceQuota(...)) return` satisfies the gate check. At runtime the boolean meaning is reversed, so the protected mutation runs exactly when the limiter says to stop.

Suggested fix:
Avoid semantic inference for arbitrary local helpers. Either require the approved `preIncrement*`/`checkAndIncrement*` result to be checked in the exported handler body, or support only a narrow helper contract that returns an object with a named field such as `{ overLimit }` and require the handler condition to check that field. Add a negative fixture for the inverted-helper example above.

### C17-CR-03 - Action-origin scanner models `try/catch/finally` in an unsafe order

Severity: MEDIUM
Confidence: High

Code regions:
- `apps/web/scripts/check-action-origin.ts:302-319`
- `apps/web/scripts/check-action-origin.ts:342-360`
- `apps/web/scripts/check-action-origin.ts:391-405`
- `apps/web/src/__tests__/check-action-origin.test.ts:184-203`
- `apps/web/src/__tests__/check-action-origin.test.ts:613-626`

Problem:
For public `@action-origin-exempt` actions, the scanner processes every statement in the `try` block before it processes `catch` and `finally`. That is not control-flow accurate: an exception can jump to `catch` before a later rate-limit gate in the `try` block executes. If the later `try` statement contains a syntactic limiter, `sawRateLimitGate` becomes true before the scanner visits the catch/finally mutation, so the mutation is treated as protected.

Concrete failure scenario:
A future analytics action can pass the scanner while writing before the limiter on the exceptional path:

```ts
/** @action-origin-exempt: public analytics endpoint */
export async function recordView(id: number) {
  try {
    const params = await buildViewParams(await headers()); // can throw before limiter
    if (isViewRecordRateLimited(params.ip, Date.now())) return;
  } catch {
    await db.insert(errors).values({ imageId: id }); // scanner sees this after the limiter
  }
}
```

The current real analytics actions do not mutate inside `catch`, so this is a guardrail defect rather than an active route bug. It matters because this lint gate is security-critical and explicitly exists to prevent public writes before rate-limit admission.

Suggested fix:
Treat `catch` and `finally` as independent branches that must already be protected within that branch, or fail closed on any mutation in catch/finally unless the branch itself contains its own dominating limiter. Add fixtures where the `try` block has a statement that may throw before the limiter and the catch/finally mutates.

### C17-CR-04 - `WithAdminAuthOptions` still documents a token argument the wrapper never passes

Severity: LOW
Confidence: High

Code regions:
- `apps/web/src/lib/api-auth.ts:22-35`
- `apps/web/src/lib/api-auth.ts:82-90`
- `apps/web/src/lib/api-auth.ts:18-20`
- `apps/web/src/app/api/admin/lr/upload/route.ts:68-75`

Problem:
The implementation-level doc was corrected, but the interface comment still says the verified token info is "passed as the LAST argument to the handler." The wrapper sets a `WeakMap` context and then calls `handler(...args)` without appending the verified token.

Concrete failure scenario:
A future admin API author follows the interface comment, declares a handler expecting a final token argument, and gets the route context or `undefined` instead. Authentication still happens in the wrapper, but attribution, audit logging, per-token behavior, or scope-specific logic can silently use the wrong value. The Lightroom route demonstrates the actual supported pattern: `getAdminAuthToken(request)` plus cookie fallback via `getCurrentUser()`.

Suggested fix:
Update the `WithAdminAuthOptions` comment to match the real API: token details are available only through `getAdminAuthToken(request)` during the wrapped handler call. Add a small source-contract or unit assertion that `withAdminAuth` does not append handler arguments if that remains the intended API.

## Likely Issues

### C17-CR-05 - Home page image-query failures are rendered as a successful empty gallery

Severity: LOW
Confidence: Medium

Code regions:
- `apps/web/src/app/[locale]/(public)/page.tsx:14-16`
- `apps/web/src/app/[locale]/(public)/page.tsx:164-176`
- `apps/web/src/app/[locale]/(public)/page.tsx:193-209`
- `apps/web/src/app/[locale]/(public)/page.tsx:231-233`

Risk:
The home page now catches `getImagesLitePage()` errors, logs a warning, and renders `HomeClient` with `images=[]`, `totalCount=0`, `hasMore=false`. That converts a gallery-listing failure into a normal 200 response with no visible error state and no `ImageGallery` JSON-LD. If a query-shape regression or transient DB issue affects only the listing query while settings/tags/topics still load, visitors and crawlers see an apparently empty gallery instead of an unavailable page.

Suggested fix:
Prefer an explicit public "temporarily unavailable" state, a retry affordance, or throwing to the route error boundary for listing-query failures. If empty fallback is a product decision, distinguish it from a genuine empty gallery in the UI and consider `noindex`/`no-store` on the degraded response so crawlers do not treat outage output as canonical content.

## Inventory Summary

Tracked files inventoried from current `HEAD`: 789.

- `apps/web/src`: 507 files total
- Test files/fixtures under `apps/web/src`: 268 files
- App route/action files under `apps/web/src/app`: 77 files
- Shared libraries under `apps/web/src/lib`: 96 files
- `apps/web/e2e`: 8 files
- `apps/web/scripts`: 27 files
- `apps/web/drizzle`: 31 files
- `.context`: 2,330 files

Review-relevant implementation surfaces inspected:
- Server actions: auth, public analytics/search/load-more, image CRUD/bulk edit, tags, topics, sharing, settings/SEO, admin users, collections/embeddings.
- Public/admin API routes: OG, semantic/similar search, upload serving, health/live, DB backup download, Lightroom upload.
- Data and schema: `data.ts`, `schema.ts`, privacy-select guards, sitemap/feed queries, smart-collection compiler, rate-limit persistence, token auth, upload/processing paths.
- Tooling/tests: action-origin scanner, public-route rate-limit scanner, API-auth scanner, privacy-field tests, sitemap tests, tag action tests, LR upload source contracts, public action tests, smart collection tests.
- Docs/context: `AGENTS.md`, `CLAUDE.md`, current `.context/reviews/code-reviewer.md`, current cycle diff, and recent git history.

## Cross-File Interaction Notes

- Freshness now depends on a broad invariant: every mutation that changes public photo-rendered content must update `images.updated_at`. Direct metadata edits, direct tag add/remove, and bulk tag add/remove mostly follow it; tag rename/delete currently do not.
- The two security lint scanners are important architecture, not incidental tests. Both now contain enough AST sophistication that control-flow and helper-contract false negatives are real maintainability risks.
- The cycle 16 DB rate-limit rollback issue appears fixed on the inspected search/load-more/share/user-create paths by threading `dbIncremented` into rollback decisions.
- The cycle 16 topic-delete FK error mapping appears fixed by mapping `ER_ROW_IS_REFERENCED_2` to the user-facing "category has images" message.
- Privacy-sensitive image/admin fields remain guarded through `publicSelectFields`, `publicMapSelectFields`, `PrivacySensitiveKeys`, `searchEnrichmentSelectFields`, and `privacy-fields.test.ts`; no new public PII leak was confirmed.
- The migration journal still contains historical non-monotonic entries, but the current last entry (`0027_analytics_retention_indexes`) has the maximum `when` value and matches the documented post-condition/reconcile strategy. No new schema drift was confirmed in this pass.

## Manual-Validation Risks

- I did not run the full blocking gates in this read-only review lane. After fixes, validate with `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, `npm run lint:public-route-rate-limit --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm test --workspace=apps/web`.
- Visual/HDR/EXIF delivery, production CLIP model behavior, and browser-specific rendering cannot be fully proven from static inspection. I checked the static contracts and relevant tests, but those surfaces still need runtime smoke coverage when changed.
- I did not inspect every historical `.context` artifact line-by-line; I inventoried them and used current docs/reviews only for constraints and prior issue patterns. Runtime code and tests under `apps/web` received the detailed inspection.

## Final Missed-Issue Sweep

Final sweeps covered:
- Current diff from cycle 16 base to `HEAD`.
- Stale cycle 16 findings and whether their implementation fixes actually landed.
- Public/admin API handler exports and `withAdminAuth` wrapping.
- Public mutating route rate-limit scanner behavior and tests.
- Mutating server-action same-origin/action-origin scanner behavior and tests.
- Rate-limit increment/check/rollback semantics on search, load-more, sharing, and admin-user creation.
- Tag/image freshness, sitemap/feed lastmod generation, public title/tag display, and test coverage.
- Privacy-sensitive select fields and compile/test guards.
- Migration journal shape, schema/data interactions, raw SQL surfaces, upload/processing contracts, and prominent catch/fallback paths.

No additional confirmed critical/high issues were found. The most actionable fixes are C17-CR-01 for user-visible freshness correctness and C17-CR-02/C17-CR-03 for security-tooling false negatives before future route/action additions rely on those patterns.

# Code Reviewer Report - Cycle 16/100

HEAD reviewed: `3da74946a7e7a198041bf6067a0192411d61a860`
Scope: current `HEAD` only, static code quality / logic / SOLID / maintainability review.
Outcome: 2 confirmed issues, 1 likely issue, 3 manual-validation risks. No critical or high-severity issues found in this pass.

## Confirmed Issues

### C16-CR-01 - DB rate-limit rollback can subtract a request that was never persisted

Severity: MEDIUM
Confidence: High

Code regions:
- `apps/web/src/lib/rate-limit.ts:112-116` documents the DB as the source of truth across restarts.
- `apps/web/src/lib/rate-limit.ts:436-451` increments persistent buckets.
- `apps/web/src/lib/rate-limit.ts:478-507` decrements persistent buckets without a request token or prior-increment guard.
- `apps/web/src/app/actions/public.ts:32-41`, `apps/web/src/app/actions/public.ts:92-107`, `apps/web/src/app/actions/public.ts:146-155`, `apps/web/src/app/actions/public.ts:276-303`
- `apps/web/src/app/actions/admin-users.ts:55-59`, `apps/web/src/app/actions/admin-users.ts:130-138`, `apps/web/src/app/actions/admin-users.ts:161-178`
- `apps/web/src/app/actions/sharing.ts:77-82`, `apps/web/src/app/actions/sharing.ts:117-127`, `apps/web/src/app/actions/sharing.ts:150-181`, `apps/web/src/app/actions/sharing.ts:231-240`, `apps/web/src/app/actions/sharing.ts:286-302`

Failure scenario:
The affected actions intentionally continue when `incrementRateLimit(...)` throws, relying on the in-memory limiter during DB trouble. Later, if the request is over-limit, duplicates, hits a validation race, or the protected operation fails, the rollback helpers still call `decrementRateLimit(...)` for the same bucket. If the original DB increment failed but the later decrement succeeds, the code subtracts from a bucket row created by earlier legitimate requests in the same window. Repeated transient increment failures followed by rollback paths can drive the persistent bucket below the real attempt count, weakening the restart-safe / multi-process limiter that comments describe as the source of truth.

This is especially visible in `public.ts`: `checkLoadMoreRateLimit` swallows an increment failure at `apps/web/src/app/actions/public.ts:92-96`, but over-limit fallback at `apps/web/src/app/actions/public.ts:100-107` and data-fetch failure at `apps/web/src/app/actions/public.ts:153-155` both call rollback with the pinned bucket. `searchImagesAction` has the same shape at `apps/web/src/app/actions/public.ts:276-303`. The same accounting pattern appears in admin user creation and share-link creation.

Suggested fix:
Thread DB-increment success through the admission result, for example `{ bucketStart, dbIncremented }`, and only call `decrementRateLimit` when `dbIncremented === true`. Prefer a small helper that owns `increment -> check -> optional rollback` so each action cannot drift. Add regression tests that force `incrementRateLimit` to reject and then force a downstream rollback branch for search, load-more, user-create, photo share, and group share; assert `decrementRateLimit` is not called in those cases.

### C16-CR-02 - `withAdminAuth` documents a token argument that the wrapper never passes

Severity: LOW
Confidence: High

Code regions:
- `apps/web/src/lib/api-auth.ts:22-35` says the verified token info is "passed as the LAST argument to the handler."
- `apps/web/src/lib/api-auth.ts:55-89` preserves the original handler arguments and calls `handler(...args)`; token state is instead exposed through a request-scoped `WeakMap`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:67-72` shows the actual usage pattern: `getAdminAuthToken(request)?.userId`.

Failure scenario:
A future admin API route author can follow the interface comment, declare a handler expecting a final `VerifiedToken`, and get `undefined` or a Next route context object instead. That is unlikely to bypass the wrapper authentication, but it can cause wrong audit attribution, duplicate token verification, null `uploaded_by`-style metadata, or runtime failures on a token-only integration path.

Suggested fix:
Update the `WithAdminAuthOptions` comment to state that token details are available only through `getAdminAuthToken(request)` during the wrapped handler call. If an explicit parameter API is desired, change the generic signature and implementation to append the token deliberately, then update the Lightroom route and tests together. The smaller maintainable fix is the comment correction plus a test/example asserting the context-access pattern.

## Likely Issues

### C16-CR-03 - Concurrent topic usage can turn a "topic has images" delete into a generic failure

Severity: LOW
Confidence: Medium

Code regions:
- `apps/web/src/app/actions/topics.ts:429-466`
- `apps/web/src/db/schema.ts:33`

Failure scenario:
`deleteTopic` comments that the transaction prevents a TOCTOU race, but the transaction first reads `images` for the topic at `apps/web/src/app/actions/topics.ts:433-437`, then deletes the topic at `apps/web/src/app/actions/topics.ts:438-441`. The schema correctly protects consistency with `images.topic` using `onDelete: 'restrict'` at `apps/web/src/db/schema.ts:33`. If another admin upload or retopic operation attaches an image after the empty check but before the delete resolves, the database should reject the delete. That keeps data safe, but the catch block only maps the local `TopicHasImagesError`; an FK rejection falls through to `failedToDeleteTopic` at `apps/web/src/app/actions/topics.ts:461-466`.

Suggested fix:
Map the MySQL FK-reference error, typically `ER_ROW_IS_REFERENCED_2`, to `cannotDeleteCategoryWithImages` as well. If the code wants to preserve the stronger "transaction prevents TOCTOU" claim, lock the topic/images rows consistently or perform a single conditional delete with a `NOT EXISTS` predicate and then map affected-row / FK outcomes explicitly.

## Manual-Validation Risks

- Runtime gates were not executed in this review lane. Static inspection found the issues above, but `npm run lint --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, `npm test --workspace=apps/web`, and targeted Playwright flows remain the authoritative verification gates after fixes.
- The topic-delete race should be validated against the deployed MySQL engine/isolation behavior before choosing a locking strategy. The user-facing error mapping fix is still useful even if the exact concurrent interleaving manifests as a wait, deadlock, or FK rejection.
- Visual/HDR/EXIF output quality, production CLIP model behavior, and browser rendering cannot be fully proven from static source review. I checked the relevant static contracts and tests, but those surfaces still need runtime smoke coverage when changed.

## Inventory Summary

Tracked files inventoried from `HEAD`: 2,557.

- `apps/web/src`: 505 files total
- Non-test app/runtime source under `apps/web/src`: 238 files
- Unit tests, fixtures, mocks, and test utilities under `apps/web/src`: 267 files
- `apps/web/e2e`: 8 files
- `apps/web/drizzle`: 31 files
- `apps/web/scripts`: 27 files
- `.context`: 1,755 files
- Remaining repository/config/docs/assets: 193 files

Review-relevant surfaces included:
- Next.js app routes, server actions, admin/public API routes, middleware/proxy, image pages, sharing routes, sitemap/feed/OG/search surfaces.
- `src/lib`, `src/db`, migrations, migration journal, schema reconciliation scripts, deploy/backup/restore/backfill scripts, package/config/lint gates, test suites, messages, and public configuration assets.
- Historical `.context` plans/reviews were inventoried for constraints and prior issue patterns; they were not treated as runtime code.

## Cross-File Interaction Notes

- Rate-limiting is the highest-coupling area: `src/lib/rate-limit.ts` defines accounting semantics while public actions, admin user creation, sharing actions, auth actions, OG routes, and semantic search each choose different rollback policies. C16-CR-01 is cross-file because the generic decrement helper cannot know whether a given request actually incremented the DB bucket.
- Admin API auth is centralized in `src/lib/api-auth.ts`, with `lint:api-auth` enforcing wrapper usage. Token-authenticated Lightroom routes currently use `getAdminAuthToken(request)`, so the mismatch in C16-CR-02 is a maintainability contract problem rather than an immediate auth failure.
- Topic deletion relies on both server-action prechecks and the schema-level `onDelete: 'restrict'` relationship. The database keeps referential integrity intact; the likely issue is stale user feedback under concurrency.
- Migration safety still depends on the documented triad: SQL migration, `_journal.json`, and `reconcileLegacySchema` in `apps/web/scripts/migrate.js`. No new schema drift finding was identified in this cycle.
- Privacy-sensitive image/admin fields remain guarded through `data.ts` omit blocks and the privacy-field tests described in `AGENTS.md`; no additional privacy leak was confirmed by this pass.

## Final Missed-Issues Sweep

Final grep/read sweeps covered:
- Admin API wrapper usage and token context (`withAdminAuth`, `getAdminAuthToken`).
- Mutating server-action origin checks (`requireSameOriginAdmin`) and public mutating route rate-limit patterns.
- Persistent/in-memory rate-limit increment, check, rollback, and tests.
- Topic/category mutation flows, FK behavior, audit logging, and image cleanup after DB changes.
- Privacy-sensitive field omission, migration/journal conventions, upload path handling, backup/restore maintenance guards, sitemap/feed/OG/search/public share routes, and comments that encode stale contracts.

No additional confirmed critical/high issues were found after the final sweep. The actionable next step is to fix C16-CR-01 first because it crosses multiple rate-limited surfaces and has the clearest security/reliability impact.

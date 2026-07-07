# Cycle 11 Code-Reviewer Report

Date: 2026-07-07
Reviewer: code-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `b965e3bf7621b1fa1892f199ba79a808665457e5`

## Scope And Method

I reviewed the repository from code quality, logic, SOLID, maintainability, and cross-file interaction perspectives. I did not edit source files or plans; this report is the only intended write from this lane.

Inventory built before review:

- Repository rules: `AGENTS.md`, `CLAUDE.md`, current peer review files under `.context/reviews/`.
- Application code: 605 TypeScript/TSX files under `apps/web/src`, including 80 app route/action files and 111 library files.
- Tests: 346 TypeScript/TSX files under `apps/web/src/__tests__`, plus Playwright e2e coverage under `apps/web/e2e`.
- Operational surfaces: `apps/web/scripts`, `apps/web/drizzle`, deploy scripts, Drizzle config, migration journal, custom lint scripts.

Areas inspected:

- Public pages, route handlers, metadata paths, JSON-LD injection, upload proxy routes, feed/OG routes.
- Server actions for auth, public views/search/load-more, images, topics, tags, sharing, settings, SEO, smart collections, admin users, embeddings, and DB backup/restore.
- Data layer, cursor pagination, public privacy selectors, shared links/groups, topic alias resolution, map/search/smart collection queries.
- Auth/session/origin/rate-limit/API-admin wrappers and custom lint enforcement.
- Image upload, processing queue, color/HDR pipeline, semantic search/backfill/embedding paths, restore maintenance locks.
- Migration tooling, DB TLS configuration, Drizzle journal conventions, schema reconciliation surfaces.
- Tests around topics, pagination/load-more, image queue locks, restore locks, privacy guards, and source-contract checks.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

I did not run full `lint`, `typecheck`, `build`, unit, or e2e suites because this is a review-only lane with unrelated active worktree changes from other lanes, and some of those commands may generate framework artifacts or require broader runtime state. The targeted read-only guard checks were enough to validate the auth/origin/rate-limit contracts relevant to this review.

## Confirmed Issues

### CR-C11-01 - Topic route advisory lock release failure can leak a pooled MySQL lock

Severity: Medium
Confidence: High
Exact file:line region: `apps/web/src/app/actions/topics.ts:69-89`; related safer pattern/comment at `apps/web/src/lib/image-queue.ts:1045-1051`; tests currently only cover successful unlock at `apps/web/src/__tests__/topics-actions.test.ts:170-192`.

Why it is a problem:

`withTopicRouteMutationLock` acquires a MySQL advisory lock on a dedicated pooled connection, then swallows any `RELEASE_LOCK` error and always returns the connection to the pool:

```ts
await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_TOPIC_ROUTE_SEGMENTS]).catch(() => {});
conn.release();
```

MySQL advisory locks are session-bound. If the unlock query fails while the session remains alive, returning that same connection to the pool can preserve the lock on an idle pooled session. The image queue already documents this exact failure class and logs unlock failures loudly because a leaked advisory lock can wedge all future claims for the same lock name.

Concrete failure scenario:

A transient network/protocol error occurs while releasing `gallerykit_topic_route_segments` after `createTopic`, `updateTopic`, or alias mutation. The catch block hides it, `conn.release()` returns the still-alive session to the pool, and subsequent topic route mutations block until the 5 second `GET_LOCK` timeout. Admin users then see repeated `topicRouteBusy` failures even though no visible mutation is running.

Suggested fix:

Treat unlock failure on this pooled advisory-lock connection as unhealthy state. At minimum log at error level and do not silently return the session as clean. Prefer a small helper that attempts `RELEASE_LOCK`, records whether it succeeded, and calls `conn.destroy()` or the mysql2 equivalent on release failure; only call `conn.release()` when unlock succeeded or no lock was acquired. Add a focused test where `RELEASE_LOCK` rejects and assert the connection is not returned silently.

### CR-C11-02 - Shared-group read path still owns a hidden view-count side effect

Severity: Low
Confidence: High
Exact file:line region: `apps/web/src/lib/data.ts:1322-1407`, cached wrapper warning at `apps/web/src/lib/data.ts:1805-1809`.

Why it is a problem:

`getSharedGroup` is a public data reader but also buffers a view-count write unless callers opt out with `incrementViewCount:false` or pass a valid selected photo id. The cached wrapper documents that the read can carry count semantics. This keeps a mutable analytics side effect inside a function that otherwise looks like a pure fetch and makes cache/call-order semantics part of correctness.

Concrete failure scenario:

A future metadata, preview, admin moderation, or API path calls `getSharedGroupCached(key)` just to inspect the group and forgets `incrementViewCount:false`. That code silently increments public analytics. If another render path in the same request calls the cached wrapper with different count semantics, React `cache()` deduplication can also make the side effect depend on which call happened first.

Suggested fix:

Split the pure read from the analytics mutation. Keep `getSharedGroup` side-effect-free and move group-view accounting into an explicit public action or route-level helper, similar to the existing `recordSharedGroupView` shape. If the buffered write is retained temporarily, remove cached access to the counting variant and export separate names such as `getSharedGroupForReadCached` and `recordSharedGroupViewLookup`.

### CR-C11-03 - Drizzle Kit DB TLS config diverges from runtime and script TLS CA handling

Severity: Low
Confidence: High
Exact file:line region: `apps/web/drizzle.config.ts:6-22`; runtime contrast at `apps/web/src/db/index.ts:7-19`; script helper contrast at `apps/web/scripts/mysql-connection-options.js:13-29`.

Why it is a problem:

Runtime DB connections and shared script helpers require `DB_SSL_CA` for non-local DB hosts unless `DB_SSL=false`. `drizzle.config.ts` enables TLS for non-local hosts with only `{ rejectUnauthorized: true }` and never reads the configured CA file. That means migration/introspection tooling does not share the same trust configuration as the app and scripts.

Concrete failure scenario:

An operator points Drizzle Kit at the same remote MySQL service used by runtime with a private CA. The app and migration scripts connect successfully because they load `DB_SSL_CA`; `drizzle-kit` fails certificate validation because the CA is omitted. Under pressure, the operator may set `DB_SSL=false` for tooling, creating a weaker and different path than production runtime.

Suggested fix:

Centralize connection-option construction or mirror `DB_SSL_CA` handling in `drizzle.config.ts`. For non-local hosts, fail fast when `DB_SSL_CA` is missing unless `DB_SSL=false`, and pass `ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true }`.

## Likely Issues

No additional likely production issues were strong enough to report after the final sweep. Several older review concerns have either been addressed by comments/tests or were better classified as validation risks rather than confirmed runtime defects.

## Validation Risks

### CR-C11-VR-01 - Load-more action tests duplicate a looser cursor normalizer instead of exercising the real one

Severity: Medium
Confidence: High
Exact file:line region: real helper at `apps/web/src/lib/data.ts:701-759`; duplicated test normalizers at `apps/web/src/__tests__/public-actions.test.ts:39-56`, `apps/web/src/__tests__/smart-collection-pagination.test.ts:56-75`, and `apps/web/src/__tests__/load-more-rate-limit.test.ts:30-45`.

Why it is a problem:

The real `normalizeImageListCursor` is intentionally strict: it accepts only bounded MySQL datetime strings, bounded ISO strings, valid `Date` objects, positive integer ids, and nullable capture dates. Several action tests mock `@/lib/data` and reimplement a simplified normalizer inline. Two of those mocks accept arbitrary string dates that `new Date(...)` can parse; they do not enforce the real MySQL/ISO regex contract or all length checks.

Concrete failure scenario:

A future edit accidentally loosens or tightens the production cursor contract, or changes accepted date formats. The action tests keep passing because they test the inline copy, not the real helper. Pagination then regresses only in browser/manual paths, for example by accepting locale date strings in tests while production rejects them and falls back to offset-based loading.

Suggested fix:

Add direct unit coverage for `normalizeImageListCursor` edge cases and make action tests import the real helper via `vi.importActual` while mocking only DB-backed exports. Avoid inline "mirrors the real contract" copies for parsing logic that is part of the user-visible pagination contract.

## Final Missed-Issue Sweep

The final sweep specifically checked advisory locks, swallowed errors, route/action auth gates, public route rate limiting, DB TLS configuration, cached data readers with side effects, cursor pagination, and duplicated test logic. No Critical or High production defects were found in this pass. The custom guard lints passed, supporting that admin APIs, mutating server actions, and public expensive/mutating routes still satisfy the repository's enforced auth/origin/rate-limit contracts.

# Cycle 7 - Code-Reviewer Lane

Date: 2026-07-07
Reviewer: code-reviewer
HEAD reviewed: `cae5fbd9b88f193a815bc91c1e41df2833094fd7`
Mode: read-only repository review except this artifact. No source files or plans were modified.

## Inventory

I built the inventory before selecting findings and reviewed cross-file behavior rather than only comments or tests.

- Instructions/context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, existing `.context/reviews/*`, and relevant `.context/plans/*`.
- Application source: 606 files under `apps/web/src`, including Next.js app routes, server actions, React components, data access, auth/session/rate-limit helpers, image processing, queues, privacy projections, search, smart collections, upload/share flows, and storage quarantine.
- Tests and contracts: 346 files under `apps/web/src/__tests__`, 12 Playwright e2e/fixture files, lint scripts for auth/origin/rate-limit policy, route/source contract tests, migration tests, and privacy guard tests.
- Schema/scripts/deploy/docs: 30 SQL migrations plus Drizzle journal, 29 `apps/web/scripts` files including `migrate.js`, `Dockerfile`, `docker-compose.yml`, `apps/web/deploy.sh`, root deploy helper, nginx config, and docs.

Validation performed: static code/data-flow review only. I did not run the full quality gates because this lane was scoped to read-only review plus report artifacts.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 1 confirmed
- Low: 1 confirmed maintainability/design risk
- Manual-validation-only risks: 0

## Findings

### CR-C7-01 - Deleting a topic leaves public smart collections with stale topic predicates

Severity: Medium
Confidence: High
Status: Confirmed from code

Evidence:

- Smart collections store rule ASTs in opaque JSON (`apps/web/drizzle/0009_smart_collections.sql:6-14`), so the database cannot enforce a foreign key from `query_json` topic values to `topics.slug`.
- The validator permits exact topic predicates such as `topic eq "slug"` and `topic in [...]` as plain strings (`apps/web/src/lib/smart-collections.ts:432-440`).
- The rename path knows this coupling exists and remaps exact topic references inside the same transaction (`apps/web/src/app/actions/topics.ts:316-349`) using `remapTopicSlugInQuery()` (`apps/web/src/lib/smart-collections.ts:522-550`).
- The delete path only checks whether images still reference the topic, then deletes the topic row (`apps/web/src/app/actions/topics.ts:448-462`). It never scans `smart_collections`, blocks deletion, remaps rules, or marks affected collections private/invalid.
- Public smart-collection pages trust the stored rule at read time and return normal content for a public collection if the query parses and compiles (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:90-111`); load-more does the same (`apps/web/src/app/actions/public.ts:219-233`).

Concrete failure scenario:

1. An operator creates a public smart collection with `{"type":"predicate","column":"topic","operator":"eq","value":"travel"}`.
2. Later all images are moved away from topic `travel`.
3. The operator deletes `travel`; `deleteTopic()` succeeds because it checks only `images.topic`.
4. The collection remains public and valid, but now references a non-existent topic slug. It silently returns zero images and keeps doing so until someone manually audits `query_json`.

Suggested fix:

Before deleting a topic, scan smart collections with the existing parser and detect exact topic references. Either block deletion with a clear error naming the referencing collections, or update a documented lifecycle policy such as marking affected collections private/invalid and logging an audit event. Put this logic in a shared topic-reference helper so rename and delete cannot diverge again. Add a unit/source test that a topic referenced by `eq` or `in` smart-collection predicates cannot be deleted silently.

### CR-C7-02 - `getSharedGroup()` is a read-style getter with hidden write side effects and a cached wrapper

Severity: Low
Confidence: High
Status: Confirmed maintainability risk from code

Evidence:

- `getSharedGroup()` performs read/model assembly, then conditionally writes by calling `bufferGroupViewCount(group.id)` (`apps/web/src/lib/data.ts:1331-1407`).
- The exported cached wrapper directly wraps the side-effectful getter (`apps/web/src/lib/data.ts:1793-1797`) and relies on callers remembering argument-sensitive count semantics.
- The page separately records durable shared-group analytics after resolving whether a selected photo is present (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`), which means the route already has an explicit write boundary for part of the same event.

Concrete failure scenario:

A future caller uses `getSharedGroupCached(key)` for a metadata/existence/read-only path, or reuses the cached helper in a render path with different selected-photo/count semantics. Because the getter itself owns the denormalized counter update, that read path can increment counters without an explicit write call, and the React cache wrapper makes the behavior depend on argument shape and call ordering. The current warning comment documents the footgun, but the function boundary still permits it.

Suggested fix:

Split `getSharedGroup()` into a pure read helper and an explicit counter mutation, similar to the existing `recordSharedGroupView()` call site. Have the page decide once whether the group view should count, then call both durable analytics and denormalized counter update explicitly. Cache only the pure read helper.

## Final Sweep

Areas checked for commonly missed issues: admin API auth wrappers, same-origin server-action guards, public route rate-limit pre-increments, privacy projection omissions, restore-maintenance fences, queue/bootstrap behavior, migration baseline/reconcile rules, semantic search public routes, Lightroom upload parity, share-key pages, smart collection parse/compile paths, storage abstraction quarantine, deploy/disk-prune policy, and docs/source contract drift.

Residual risk: this was static review. Full lint/typecheck/build/unit/e2e gates were not rerun in this lane.

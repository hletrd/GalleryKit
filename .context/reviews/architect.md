# Cycle 7 - Architect Lane

Date: 2026-07-07
Reviewer: architect
HEAD reviewed: `cae5fbd9b88f193a815bc91c1e41df2833094fd7`
Mode: read-only architecture/design review except this artifact. No source files or plans were modified.

## Inventory

I inventoried the repository first and reviewed architecture through cross-file contracts, not isolated files.

- Product/runtime contract: `AGENTS.md`, `CLAUDE.md`, root/web READMEs, review history, deferred plans, and deployment notes.
- Layers reviewed: Next.js route tree, public/admin server actions, API routes, auth/session/rate-limit boundaries, data-access layer, schema/migrations, image processing pipeline, background queues, restore fences, smart collections, sharing, SEO/i18n, and storage quarantine.
- Operational architecture: migration/reconcile script, deploy scripts, Docker/compose/nginx topology, service worker/source contracts, lint gates, and test suites.
- Counts: 606 app source files, 346 source-contract/unit tests, 12 e2e/fixture files, 30 SQL migrations, 29 web scripts, and 3 top-level docs/scripts outside app scope.

Validation performed: static architecture review only. I did not run application quality gates because this review lane was scoped to read-only inspection plus report artifacts.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 1 confirmed architecture issue
- Low: 1 confirmed boundary/coupling risk

## Findings

### ARCH-C7-01 - Smart-collection topic references have no lifecycle owner on topic deletion

Severity: Medium
Confidence: High
Status: Confirmed from code

Evidence:

- The architectural model stores smart-collection rules as JSON text (`apps/web/drizzle/0009_smart_collections.sql:6-14`). This is intentionally flexible, but it means cross-entity references inside the AST are outside relational FK enforcement.
- Topic predicates are first-class AST values and are validated only as strings (`apps/web/src/lib/smart-collections.ts:432-440`).
- Rename owns this dependency explicitly: `updateTopic()` scans every smart collection and remaps exact references in the same transaction (`apps/web/src/app/actions/topics.ts:316-349`), using `remapTopicSlugInQuery()` (`apps/web/src/lib/smart-collections.ts:522-550`).
- Delete does not share that ownership. `deleteTopic()` checks `images.topic`, then deletes the topic (`apps/web/src/app/actions/topics.ts:448-462`) without consulting `smart_collections`.

Concrete failure scenario:

The system preserves smart-collection behavior across topic rename, but not across topic deletion. A public smart collection can keep a valid query that targets a deleted topic slug and degrade into an empty gallery with no schema violation, no admin warning, and no route-level error. This is especially likely because smart collections are documented as direct-DB-authored operator artifacts rather than a fully guided UI workflow.

Suggested fix:

Create one topic-reference lifecycle boundary for smart collections. The deletion path should use the same parser/remapper family as rename to find exact topic references, then apply a product decision: block deletion while collections reference the topic, or automatically mark/update affected collections with an audit trail. Add tests at the action/helper level so rename and delete remain symmetrical for `topic eq` and `topic in` predicates.

### ARCH-C7-02 - Shared-group view counting crosses read, cache, and write boundaries

Severity: Low
Confidence: High
Status: Confirmed design/coupling risk

Evidence:

- `getSharedGroup()` is named and used as a data retrieval helper, but it conditionally buffers a denormalized view-count write after building the group result (`apps/web/src/lib/data.ts:1331-1407`).
- The same side-effectful function is exported through React `cache()` with a warning that callers must not mix count semantics in one render path (`apps/web/src/lib/data.ts:1793-1797`).
- The page-level route already resolves the selected-photo/counting decision and records durable analytics explicitly (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`), so the architecture has two owners for one view event: route code for durable analytics and data-layer read code for denormalized counters.

Concrete failure scenario:

A new layout, metadata path, or share preview calls `getSharedGroupCached()` for read-only data and accidentally increments the denormalized group view count. Another route can later pass selected-photo options and rely on the same cached helper, making the counter behavior harder to reason about than the durable analytics path. The system is currently protected by comments and caller discipline rather than by layer boundaries.

Suggested fix:

Make shared-group reads pure and move all view-event writes into an explicit route/service function. The route should decide once whether the access counts, then call durable analytics and denormalized counter buffering together. Only the pure read helper should be cached.

## Final Sweep

Architecture categories examined: route/action/API layering, admin/public trust boundaries, origin/auth/rate-limit gates, restore and background-write ownership, DB schema versus JSON rule references, migration/reconcile safety, media pipeline responsibilities, public sharing flows, semantic search activation, storage abstraction quarantine, deployment topology, and documentation-to-code contract drift.

Residual risk: this was static review, so production-only behavior such as live nginx state, real restore contention, and host deployment configuration was not manually validated.

# Cycle 8 - Code-Reviewer Lane

Date: 2026-07-07
Reviewer: code-reviewer
HEAD reviewed: `eca55414cae2b5a716fb9eac02ad9ee1e4b688b0`
Mode: read-only repository review except this artifact. No source fixes, commits, pushes, deploys, service changes, file removals, or MySQL-container mutations were performed.

## Inventory

I built the inventory before selecting findings and reviewed current code against the latest review/plan history instead of restating closed work.

- Instructions/context read first: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, latest `.context/reviews/_aggregate.md`, current `.context/reviews/code-reviewer.md`, `run9-cycle8` aggregate/lane files, `plan/plan-370-cycle9-fixes.md`, and `plan/plan-371-cycle9-deferred.md`.
- Application source inventory: 600 TypeScript/TSX files under `apps/web/src`, including 80 App Router/action/API files and 175 files across `lib`, `db`, and `components`.
- Tests/contracts inventory: 358 files across `apps/web/src/__tests__` and `apps/web/e2e`, including auth/origin/rate-limit scanners, migration/reconcile tests, privacy-field guards, semantic-search contracts, and touch-target/a11y checks.
- Schema/scripts/config/docs inventory: 30 SQL migrations plus Drizzle journal/snapshots, 29 app scripts, Dockerfile/compose/deploy/nginx config, root deploy helper, service worker/template, package manifests, and operational docs.
- Focus areas inspected: auth/session/rate-limit, server actions, public API routes, privacy select projections, smart collections, image upload/delete/retry, image queue/backfill, semantic/similar search, restore/backup, migrations/schema/journal, public map/share pages, upload serving, service worker cache, deploy scripts, i18n contracts, and recent hardening changes in HEAD.

Validation performed: static code/data-flow review plus one targeted read-only test command:
`npm test --workspace=apps/web -- src/__tests__/clip-semantic-limits-env.test.ts src/__tests__/semantic-search-params.test.ts` -> 2 files passed, 27 tests passed. I did not run full lint/typecheck/build/unit/e2e gates in this review lane.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 1 confirmed
- Low: 0 new
- Manual-validation-only risks: 0 new

## Findings

### CR-C8-01 - Semantic text search can be configured to return 25,000 public results per request

Severity: Medium
Confidence: High
Status: Confirmed from code and tests

Evidence:

- `envPositiveInt()` applies one shared hard cap, `SEMANTIC_ENV_INT_MAX = 25_000`, to both `SEMANTIC_TOP_K_MAX` and `SEMANTIC_SCAN_LIMIT` (`apps/web/src/lib/clip-embeddings.ts:36-44`).
- The public semantic route clamps client-supplied `topK` to `SEMANTIC_TOP_K_MAX` (`apps/web/src/app/api/search/semantic/route.ts:72-91`) and then passes that value directly into `topK(scored, topKParam, activeThreshold)` (`apps/web/src/app/api/search/semantic/route.ts:311`).
- Every selected result id is then sent through one enrichment query and mapped into the JSON response (`apps/web/src/app/api/search/semantic/route.ts:322-367`), so a high `SEMANTIC_TOP_K_MAX` is not just an internal ranking value; it controls public response cardinality.
- The test suite currently pins the bad coupling: `SEMANTIC_TOP_K_MAX=2000000` is expected to clamp to `25_000` (`apps/web/src/__tests__/clip-semantic-limits-env.test.ts:75-80`), and `clampSemanticTopK(1000)` is expected to clamp only to the current env-derived max (`apps/web/src/__tests__/semantic-search-params.test.ts:36-38`).
- The docs describe `SEMANTIC_SCAN_LIMIT` as having a 25,000 hard cap, but describe `SEMANTIC_TOP_K_MAX` separately as the ceiling on results returned to clients with default 50 (`CLAUDE.md:598-601`, also the env table at `CLAUDE.md:118-119`). That separation is correct operationally; the implementation conflates the scan-row cap with the response-count cap.

Concrete failure scenario:

An operator raises `SEMANTIC_SCAN_LIMIT` for a larger gallery and accidentally also sets `SEMANTIC_TOP_K_MAX=2000000`, or follows the current test-implied "unbounded override clamps to 25,000" behavior. A public same-origin semantic search with `{"query":"portrait","topK":25000}` is accepted. The route scans up to 25,000 embeddings, runs the insertion-based `topK` loop with `k=25000`, sends an `IN (...)` enrichment query for every matched id above threshold, sorts and serializes thousands of cards, and returns a huge JSON payload. The rate limit limits request frequency, but one admitted request can still consume avoidable CPU, DB, memory, and bandwidth on the single-writer host.

Suggested fix:

Split the env parser into separate caps, for example `SEMANTIC_SCAN_LIMIT_HARD_MAX = 25_000` and `SEMANTIC_TOP_K_HARD_MAX = 100` or another UI-budgeted result count. Clamp `SEMANTIC_TOP_K_MAX` to the smaller response cap even when the env value is higher. Update `clip-semantic-limits-env.test.ts` so oversized `SEMANTIC_TOP_K_MAX` no longer resolves to 25,000, and add a route/clamp assertion proving client `topK` cannot exceed the response cap.

## Prior Findings Checked

- Prior `CR-C7-01` is fixed at current HEAD: `deleteTopic()` now parses `smartCollections.query_json` and throws `TopicReferencedBySmartCollectionError` when an exact `topic eq` or `topic in` reference points at the slug being deleted (`apps/web/src/app/actions/topics.ts:461-479`), using `queryReferencesTopicSlug()` (`apps/web/src/lib/smart-collections.ts:552-560`).
- Prior `CR-C7-02` still exists as a known residual: `getSharedGroup()` can buffer a view-count side effect and `getSharedGroupCached` still wraps it (`apps/web/src/lib/data.ts:1396-1407`, `apps/web/src/lib/data.ts:1796-1800`). I did not re-file it as a new finding because it is already recorded in the previous lane and unchanged.

## Final Sweep

Checked issue classes: admin API auth wrappers, same-origin server-action guards, public route rate-limit pre-increments, privacy projection omissions, unsafe JSON/HTML/script sinks, raw SQL and LIKE escaping, path traversal/symlink/realpath checks, restore-maintenance fences, child-process env/timeout cleanup, queue/bootstrap/backfill retry behavior, migration journal/schema/reconcile drift, semantic search scan/result limits, Lightroom upload parity, share-key view accounting, smart-collection topic lifecycle, map GPS visibility/truncation, upload-serving abort cleanup, service-worker cache boundaries, deploy/disk-prune invariants, i18n key parity surfaces, and docs/source contract drift.

I found one real actionable current defect and no new Critical/High issues. Residual risk: full blocking gates and Playwright e2e were not rerun in this lane.

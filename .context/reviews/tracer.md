# Cycle 10 Tracer Review

HEAD reviewed: `42c5b226` (`887e1dd7` source tree plus intervening review-artifact-only commits: `.context/reviews/debugger.md`, `.context/reviews/document-specialist.md`, `.context/reviews/test-engineer.md`).

Mode: read-only causal tracing review. Source code was not edited; this report is the only intended artifact.

## Scope And Method

Read first, per workspace rule:
- `AGENTS.md`
- `CLAUDE.md`
- `~/.agents/skills/code-review/SKILL.md`

Inventory target: request/data lifecycles, ordering, race windows, cross-file invariants, and failure propagation across the current repository. I built the inventory from `rg --files` over app actions, API routes, library modules, scripts, DB schema, migrations, and review context; the app/source inventory contained 1,888 files under the reviewed roots, with the request/data-flow subset narrowed to the files below.

## Files Reviewed / Inventory Summary

Upload, processing, queue, and retry lifecycle:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`

Restore, maintenance, and migration lifecycle:
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/meta/_journal.json`

Admin mutation, route-segment, sharing, and settings lifecycle:
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/validation.ts`

Public request, search, analytics, and semantic lifecycle:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

## Confirmed Findings

None found in the current tree.

Evidence: the high-risk upload/settings path uses the upload-processing contract lock (`settings.ts:72-89`, `settings.ts:136-166`, `images.ts:177-184`, `lr/upload/route.ts:220-236`); processing uses per-image advisory claims and conditional DB transitions (`image-queue.ts:430-457`, `image-queue.ts:538-659`); restore obtains restore/backfill/upload locks before maintenance and queue quiescence (`db-actions.ts:266-419`); topic slug rewrites update images, aliases, topic views, and smart collection JSON in one transaction (`topics.ts:255-340`); public semantic production mode heals to disabled unless operator-gated (`gallery-config.ts:123-142`).

## Likely Findings

None found.

## Risks Needing Manual Validation

### TRC10-RISK-01 - Semantic search recall is capped to the most recently updated embedding rows

Severity: Medium
Confidence: High
Status: Risk

Code region:
- `apps/web/src/lib/clip-embeddings.ts:22-44`
- `apps/web/src/app/api/search/semantic/route.ts:242-283`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`

Failure scenario:
`SEMANTIC_SCAN_LIMIT` defaults to 2,000 and is clamped at 25,000 (`clip-embeddings.ts:36-44`). Natural-language semantic search and similar-image search both read active-model embeddings ordered by `updated_at DESC` and then stop at that hard limit (`semantic/route.ts:242-283`, `similar/[id]/route.ts:141-170`). On a gallery with more active embeddings than the cap, older rows are never candidates, so an older photo can be absent from semantic results even when it has a valid embedding.

Concrete fix:
Expose a health/admin signal when active embedding count exceeds `SEMANTIC_SCAN_LIMIT`, and label the feature as a bounded recent-embedding scan under that condition. For full-gallery semantics, move to an ANN/vector index or a paginated bounded top-k strategy with an explicit recall contract.

### TRC10-RISK-02 - Dark in-app embedding backfill can report success after one capped candidate set

Severity: Low
Confidence: Medium
Status: Risk

Code region:
- `apps/web/src/app/actions/embeddings.ts:79-80`
- `apps/web/src/app/actions/embeddings.ts:103-124`
- `apps/web/src/app/actions/embeddings.ts:129-172`
- `apps/web/scripts/backfill-clip-embeddings.ts:113-117`

Failure scenario:
The action notes that no UI currently wires it and that the sidecar remains canonical (`embeddings.ts:79-80`). If a future admin UI wires this action directly, it selects one `SEMANTIC_SCAN_LIMIT`-bounded set of missing embeddings (`embeddings.ts:103-124`), processes that fixed set, and returns `{ status: 'ok', processed, skipped }` without a `hasMore` or remaining-count signal (`embeddings.ts:129-172`). With more missing rows than the cap, the UI could present an incomplete backfill as complete. The sidecar at least warns operators when its scan limit is reached (`backfill-clip-embeddings.ts:113-117`).

Concrete fix:
Keep the action unwired, remove it, or make it keyset-paginated like the sidecar and return `hasMore` plus remaining count. Add a source-level comment or test contract that prevents future UI wiring from treating the one-shot action as complete.

### TRC10-RISK-03 - Process-local coordination depends on the documented single web-instance topology

Severity: Medium
Confidence: High
Status: Risk

Code region:
- `CLAUDE.md` runtime topology section
- `apps/web/src/lib/restore-maintenance.ts:1-55`
- `apps/web/src/lib/image-queue.ts:273-323`
- `apps/web/src/lib/upload-tracker-state.ts:70-79`
- `apps/web/src/app/actions/public.ts:323-341`
- `apps/web/src/app/actions/sharing.ts:22-82`

Failure scenario:
The current production topology is documented as a single web instance. Several invariants are process-local: restore maintenance state, queue/enqueued/retry maps, upload quota tracking, public analytics rate limiting, and share-write fast-path rate limiting. If the service is later scaled horizontally behind the same database without moving those states to shared storage, one instance could accept uploads while another is in restore maintenance, or per-IP budgets could be multiplied by instance count.

Concrete fix:
Before scale-out, move restore maintenance state, queue coordination, upload quota tracking, and public/share rate-limit fast paths into shared DB/Redis-backed state, or add a startup guard that hard-fails unsupported multi-instance deployments.

## Competing Hypotheses Ruled Down

- Topic rename race: covered by `LOCK_TOPIC_ROUTE_MUTATION` and a transaction that rewrites `topics`, `images.topic`, `topicAliases.topicSlug`, `topicViews.topic`, and exact smart-collection topic predicates (`topics.ts:62-83`, `topics.ts:255-340`).
- Topic image cleanup after revalidation failure: current revalidation wrappers catch internally (`revalidation.ts:30-45`, `revalidation.ts:59-64`), and topic revalidation runs outside mutation cleanup catches (`topics.ts:173-179`, `topics.ts:401-405`).
- Upload/settings configuration race: settings that change processing/privacy semantics acquire the upload-processing contract lock and reject changes while active upload claims exist (`settings.ts:72-89`, `settings.ts:136-166`); both browser and Lightroom upload flows acquire the same lock before saving/inserting/enqueuing (`images.ts:177-184`, `lr/upload/route.ts:220-236`).
- Delete-while-processing orphan derivatives: queue success uses a conditional `processed=false` update and deletes full derivative ladders when the row vanished mid-processing (`image-queue.ts:637-659`); admin and sidecar backfills use the same claim namespace or are globally serialized (`admin-backfill-runner.ts:335-359`, `backfill-color-pipeline.ts:284-360`).
- Semantic production activation through ordinary settings: config resolution heals stored `production` to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is set (`gallery-config.ts:123-142`).
- Shared-group view count flush starvation: the buffer swaps maps before draining, nulls fired timers before the in-flight guard, re-buffers failed chunks with retry/backoff caps, and shutdown can await the in-flight drain (`data.ts:12-70`, `data.ts:74-150`).

## Final Missed-Issue Sweep

Final sweep covered:
- Upload maintenance checks, quota claim/settle paths, disk preflight rollback, original-file cleanup, strict config reads, enqueue rejection rollback, and browser/Lightroom parity.
- Queue bootstrap, per-image locks, retry maps, permanent-failure persistence, delete-during-processing cleanup, caption/embedding side effects, and restore/shutdown drains.
- Restore advisory locks, maintenance begin/end, dump scanning, mysql child-process failure paths, queue quiescence order, and post-restore migration failure behavior.
- Topic route-segment locking, alias conflicts, topic-view and smart-collection remaps, topic image lifecycle cleanup, and revalidation failure containment.
- Share key atomic update, group-share transaction boundaries, public analytics write ordering, shared-group view count buffering, and rate-limit rollback branches.
- Public search/load-more rate-limit ordering, semantic body-read ordering, semantic mode gates, model-version filters, embedding scan cap, and enrichment privacy fields.
- Schema/migration journal monotonicity, migration postconditions, deploy bind-mount expectations, and the single-instance runtime assumption.

No confirmed or likely source defects were found in current HEAD. The actionable items from this tracer lane are the three operational/manual-validation risks above.

Validation not run: no source files changed. I will run markdown diff validation after writing this artifact.

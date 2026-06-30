# Cycle 30 Architect Review

Reviewer: architect
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `8db1df97a8ffa9b3357c4242b501bb19f9db7c30`
Date: 2026-06-30 KST
Scope: architecture/design-boundary review only. No product code fixes were implemented.

## Inventory Summary

I inventoried current HEAD first, then reviewed architecture-relevant source, docs, tests, migrations, scripts, and cross-file boundaries.

Tracked file inventory:

| Area | Count / Coverage |
| --- | --- |
| Total tracked files | 2609 |
| Application source | `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**` |
| Server actions | 13 files |
| API routes | 8 files |
| DB/migrations | schema, relations, Drizzle SQL/meta, migration/reconcile script |
| Tests | 281 unit test files and 8 e2e files |
| Review/planning history | `.context/reviews/**`, `.context/plans/**` |

Architecture surfaces examined:

- Governance and constraints: `AGENTS.md`, `CLAUDE.md`
- Data model and migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`
- Public/admin data boundary: `apps/web/src/lib/data.ts`, public pages, public actions, semantic/similar search routes
- Restore/maintenance topology: `apps/web/src/app/[locale]/admin/db-actions.ts`, restore-maintenance helpers, background DB writes, image queue interactions
- Upload/processing/storage: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/**`
- Semantic search: `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Representative tests for restore, schema reconciliation, SQL restore scanning, privacy projections, semantic search, uploads, topics, and touch targets

## Findings

### C30-ARCH-01: The storage abstraction does not preserve the live filesystem pipeline's atomicity and read-safety contracts

Severity: Medium
Confidence: Medium
Classification: Likely architectural risk in dormant/future integration path

Exact region:

- `apps/web/src/lib/storage/index.ts:4-12`
- `apps/web/src/lib/storage/local.ts:76-108`
- `apps/web/src/lib/storage/local.ts:115-122`
- Contrast `apps/web/src/lib/process-image.ts:1182-1196`
- Contrast `apps/web/src/lib/serve-upload.ts:166-184`

Evidence:

`storage/index.ts` states that the storage backend is not wired into the live image pipeline yet and exists for explicit callers/future integration. The current `LocalStorageBackend` writes directly to the final path with `createWriteStream(filePath)` and `fs.writeFile(filePath)`, then reads by checking `lstat()` and reopening the path. The live pipeline has stricter invariants: image processing writes final derivatives through a temp-file plus rename helper, and public upload serving validates the opened file handle before streaming.

Concrete failure scenario:

A later "move uploads to storage" refactor could route image derivatives, private originals, resources, or export downloads through `StorageBackend` because the interface already exists. That would silently downgrade two important live invariants: readers could observe partially written final files during an interrupted write, and a storage read could stream a path that changed after validation. The result could be truncated images, cached bad bytes, inconsistent public gallery output, or unintended file disclosure if a writable subtree is compromised.

Suggested fix:

Treat storage integration as a contract migration, not a mechanical import swap. Either quarantine/delete the abstraction until it is ready, or harden it before adoption: same-directory temp writes followed by atomic rename, opened-handle validation for reads, realpath containment checks, symlink rejection at the handle level, and tests that compare storage behavior against `process-image.ts` and `serve-upload.ts` invariants. Add an explicit "not for live pipeline" guard in code or docs if retaining the current implementation.

### C30-ARCH-02: Semantic search remains a request-thread brute-force scan bounded only by configurable caps

Severity: Medium
Confidence: High
Classification: Confirmed architectural scaling risk

Exact region:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/app/api/search/semantic/route.ts:263-311`
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`

Evidence:

The semantic helpers clamp `SEMANTIC_SCAN_LIMIT` to `25_000`, defaulting to `2_000`. Both semantic text search and similar-photo search select the most recent matching embeddings, load the embedding blob/string column into the Next.js request process, decode each vector, compute similarity in-process, then run `topK`. The cap prevents unbounded scans, but the architecture still couples public request latency and CPU work to a brute-force row scan.

Concrete failure scenario:

As the library grows or an operator raises `SEMANTIC_SCAN_LIMIT` toward the documented hard maximum, a burst of same-origin semantic requests can make the web worker and MySQL writer spend request time reading and scoring thousands of embeddings per request. That competes with public browsing, admin uploads, restore preparation, and queue work. It also ranks only the most recently updated embeddings inside the scan window, so older relevant images can become permanently undiscoverable once the corpus exceeds the scan cap.

Suggested fix:

Move semantic retrieval behind a search-owned architecture boundary before increasing corpus or traffic expectations. Options include a vector index/service, precomputed candidate partitions, database-native vector support if available, or a background-built candidate table keyed by model version/topic/date. Add acceptance tests or operational assertions that make the recall tradeoff explicit when total production embeddings exceed `SEMANTIC_SCAN_LIMIT`.

## No-Finding Areas

- The stale cycle-29 rate-limit retention index issue appears fixed in current HEAD: `apps/web/src/db/schema.ts` defines a `bucketStartIdx` on `rate_limit_buckets`, and the architecture concern was not carried forward.
- Public metadata restore-maintenance behavior was rechecked on representative public pages. Current pages either use generic metadata without DB lookup or call `getPublicRestoreMaintenanceMetadata()` before DB-backed metadata work.
- Restore/backup architecture now has a coherent maintenance boundary across durable state, queue quiescence, background write draining, SQL scanning, migrations, and cleanup. I did not find a fresh boundary issue there.
- Upload parity between browser upload and Lightroom upload was reviewed around quota, topic validation, lock checks, settings, processing, DB insert, and queue enqueue. I did not find a fresh architectural divergence.
- Public DTO/privacy boundaries remain explicitly modeled through public select fields, omit helpers, type guards, and tests.

## Final Sweep

Skipped or limited areas:

- I did not run full lint/typecheck/build/test gates because the prompt requested review outputs only and no product implementation changes.
- I did not execute production deploy, remote backup, restore, or browser e2e flows.
- I did not exhaustively re-read every historical `.context/**` review artifact; prior findings were used only to avoid stale assumptions and verify whether they still exist in current HEAD.

Review conclusion:

Two current architecture risks were found: one future-integration storage boundary risk and one confirmed semantic-search scaling boundary risk. No additional high-severity architectural defect was found in current HEAD from this review perspective.

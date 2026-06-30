# Cycle 39/100 Deferred Findings

## `PERF-C39-03` - Feed and sitemap updated-time indexes

Reason: this is schema-changing migration work. It needs EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring before it is safe to schedule.

Exit criterion: a migration plan identifies exact composite indexes, validates query plans against representative data, and updates Drizzle journal/schema reconciliation.

## `PERF-C39-04` - Backfill pipeline-version indexes

Reason: this is schema-changing migration work sharing the same index-planning risk as the feed/sitemap item.

Exit criterion: a migration plan proves the candidate/status scans benefit from a concrete index without harming write paths or deploy migration safety.

## `AGG-C38-07` - Broad imported-helper side-effect classification

Reason: the current prefix heuristic is useful but incomplete. A broader fail-closed scanner model risks false positives unless it includes a reviewed pure-import allowlist and source-contract coverage.

Exit criterion: scanner policy can distinguish known pure helpers from mutating imported helpers and has fixtures for both categories.

## `AGG-C38-08` - Sidecar keyset pagination

Reason: this is a larger throughput/memory refactor touching batch iteration behavior and should be scheduled with dedicated backfill stress tests.

Exit criterion: a plan defines keyset cursor semantics, completion criteria, and regression coverage for interrupted/resumed batches.

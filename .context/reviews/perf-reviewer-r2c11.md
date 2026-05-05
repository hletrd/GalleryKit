# Performance Reviewer — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: CPU/memory/UI responsiveness, concurrency, resource leaks
**Scope**: Image pipeline, DB queries, component render paths, cache behavior

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-PERF-01: Semantic search endpoint materializes entire request body
**File**: `apps/web/src/app/api/search/semantic/route.ts` (line 104)
**Severity**: Low | **Confidence**: Medium

`await request.json()` allocates memory for the full parsed JSON tree. For a malicious multi-megabyte payload, this pins heap during parsing even though the query string is expected to be < 200 code points. Next.js body parsing limits provide a backstop, but an explicit early `Content-Length` guard would be cheaper.

**Suggested fix**: Check `request.headers.get('content-length')` before `request.json()` and reject bodies > 8 KB.

### C11-PERF-02: Semantic search embedding scan is unbounded in DB I/O
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 128-136)
**Severity**: Low | **Confidence**: Medium

The route scans up to `SEMANTIC_SCAN_LIMIT` (5000) embeddings. Each embedding is stored as base64 text (`MEDIUMBLOB` in SQL). Fetching 5000 rows of base64-encoded 512-float vectors is ~10 MB of data transferred from DB to application per request. At 30 req/min, this could be 300 MB/min of DB traffic.

**Note**: This is a known limitation of the stub implementation. The comment acknowledges that real ONNX inference is future work.

**Suggested fix**: For now, document the I/O cost. When real inference is added, consider pre-filtering by topic or using a vector index.

### C11-PERF-03: `data.ts` searchImages main query lacks LIMIT short-circuit optimization
**File**: `apps/web/src/lib/data.ts` (lines 1175-1193)
**Severity**: Low | **Confidence**: Low

The main search query (title/description/camera/topic/label) has `.limit(effectiveLimit)` but no early termination hint. MySQL may still scan more rows than needed depending on the `LIKE` pattern and index usage. The `LIKE '%term%'` patterns cannot use standard B-tree indexes effectively.

**Note**: Full-text search is not yet implemented. The current design is intentional for personal-gallery scale.

**Suggested fix**: If gallery size grows beyond ~10k images, consider adding a MySQL FULLTEXT index or a dedicated search engine.

## Final Sweep
No additional performance findings after reviewing image queue, Sharp pipeline, and component render paths.

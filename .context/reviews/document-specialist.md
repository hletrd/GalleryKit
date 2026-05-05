# Document Specialist Review — Cycle 21

## Method
Compared code against inline comments, CLAUDE.md references, and cross-file documentation. Focused on comments that no longer match implementation, stale references, and misleading documentation.

## Findings

### C21-DOC-01 (LOW): Semantic search endpoint comment understates the stub problem
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 17-19)
**Confidence**: HIGH

The comment says:
```
NOTE: The stub encoder produces deterministic but NOT semantically meaningful
embeddings. Enable semantic_search_enabled only after running the backfill
script and (in a future cycle) replacing the stub with real ONNX inference.
```

This is accurate but understated. The problem is not just that embeddings are "not semantically meaningful" — it is that the entire endpoint returns RANDOM results that look legitimate. A developer skimming the comment might think "ok, results won't be great" rather than "results are completely unrelated to the query."

**Fix**: Change comment to: "WARNING: The stub encoder returns RANDOM results. Do NOT enable semantic_search_enabled in production until the stub is replaced with real ONNX inference."

---

### C21-DOC-02 (LOW): `quiesceImageProcessingQueueForRestore` name contradicts behavior
**File**: `apps/web/src/lib/image-queue.ts` (lines 604-625)
**Confidence**: HIGH

The function name "quiesce" implies bringing to a complete stop. The implementation does not wait for active jobs. This is a documentation/semantics mismatch that could confuse operators reading logs or admin documentation.

**Fix**: Rename to `pauseQueueForRestore` or add a docstring explaining that active jobs may still complete.

---

### C21-DOC-03 (LOW): `clip-inference.ts` TODO is not tracked
**File**: `apps/web/src/lib/clip-inference.ts` (lines 9-13)
**Confidence**: MEDIUM

The TODO comment references deferred work (ONNX inference, model download) but there is no ticket reference or GitHub issue. In a project with many cycles, untracked TODOs are often forgotten.

**Fix**: Create a tracking issue or add a ticket ID to the TODO.

---

## Documentation confirmed accurate
- Rate-limit pattern docstring in `rate-limit.ts`: Accurate.
- CLAUDE.md "Security Architecture" section: Matches implementation.
- `process-image.ts` ICC profile resolution matrix: Matches implementation.
- Privacy field comments in `data.ts`: Correct.

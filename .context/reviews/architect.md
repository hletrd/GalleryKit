# Architect Review — Cycle 21

## Review Scope
Architectural/design risks, coupling, layering, and long-term maintainability of new features (semantic search, smart collections) and existing pipelines.

## Findings

### C21-ARCH-01: Semantic Search Is Fully Wired but Produces Meaningless Results
**File**: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/lib/clip-inference.ts`
**Severity**: High
**Confidence**: High

The semantic search feature is architecturally complete (endpoint, schema, embeddings table, backfill action, admin toggle) but the inference layer is a stub that produces deterministic but semantically meaningless embeddings. This creates a "trapdoor" architecture: everything appears to work, but the output is random.

**Risk**: Admins enable the feature expecting it to work. Users see random results. The engineering team may not prioritize replacing the stub because "the feature already works."
**Fix**: Add an explicit `semantic_search_mode` config with values `'disabled' | 'stub' | 'production'`. Default to `'disabled'`. Only allow `'production'` when a real ONNX model is detected. Make `'stub'` require an explicit opt-in with a warning banner in the admin UI.

---

### C21-ARCH-02: `quiesceImageProcessingQueueForRestore` Has Race Condition with Active Jobs
**File**: `apps/web/src/lib/image-queue.ts` (lines 604-625)
**Severity**: Medium
**Confidence**: High

The queue quiescence abstraction is broken: it waits for `onPendingZero()` which does NOT include active jobs. This is an architectural mismatch between what "quiesce" means (stop all work) and what the implementation does (stop queued work only).

**Risk**: DB restore can proceed while image processing is actively writing files and DB rows, violating the assumed invariant that quiescence means "nothing is happening."
**Fix**: Change the abstraction to track active job promises and wait for them. Or rename to `pauseQueueForRestore` and document that active jobs may still complete.

---

### C21-ARCH-03: Smart Collection AST Compiler Uses Raw `sql` for Tag Predicates
**File**: `apps/web/src/lib/smart-collections.ts` (lines 248-272)
**Severity**: Low
**Confidence**: Medium

The tag predicate compiler uses `sql`${images.id} IN (SELECT ...)` with raw SQL template literals. While the table/column references come from Drizzle constants (safe), the overall pattern introduces a raw SQL surface that could drift from the rest of the codebase's pure-Drizzle style.

**Risk**: Future maintenance could introduce unsafe interpolation if a developer modifies the raw SQL without understanding the parameterized boundary.
**Fix**: Refactor to use Drizzle's subquery builder (`db.select().from(imageTags).$dynamic()`) instead of raw SQL template. Deferred until smart collections are more mature.

---

### C21-ARCH-04: Rate Limit Decrement is Not Atomic
**File**: `apps/web/src/lib/rate-limit.ts` (lines 427-454)
**Severity**: Low
**Confidence**: Medium

The UPDATE+DELETE sequence for decrementing rate limits is not architecturally atomic. This violates the principle that rate-limit counters should be monotonically increasing within a window, with decrements being safe.

**Risk**: Under high concurrency, rollback decrements can accidentally delete incremented counts, allowing more requests than intended.
**Fix**: Use a single atomic statement or stored procedure.

---

## No new architectural risks detected in:
- Image processing pipeline (well-structured, versioned)
- Auth layer (defense in depth, multiple checks)
- Data access layer (compile-time privacy guards)
- Upload pipeline (path traversal prevention, symlink rejection)

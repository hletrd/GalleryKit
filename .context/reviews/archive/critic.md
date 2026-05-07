# Critic Review — Cycle 22

## Method
Multi-perspective critique: (1) whether prior fixes introduced regressions, (2) whether defensive patterns are consistently applied, (3) whether comments and code tell the same story, (4) edge case symmetry across similar functions.

## Verified Prior Fixes
- C21-CT-01 (semantic stub): FIXED — semantic_search_mode now requires explicit opt-in
- C21-CT-02 (quiesce naming): FIXED — now uses `onIdle` (semantically correct)
- C21-CT-03 (chunked encoding): FIXED — body read as text with cap
- C21-CT-04 (backfill guards): PARTIALLY FIXED — auth added, rate limiting still missing

## Findings

### HIGH

#### C22-CT-01: `decrementRateLimit` Race Is a Defensive Pattern Gap
- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Confidence**: HIGH
- **Cross-file agreement**: C22-HIGH-01 (code-reviewer), C22-SEC-01 (security), C22-ARCH-01 (architect), C22-DEBUG-01 (debugger)

The codebase is otherwise meticulous about atomicity: advisory locks for restores, `INSERT IGNORE` for session secrets, `onDuplicateKeyUpdate` for rate-limit increments, transactions for topic slug renames. But `decrementRateLimit` breaks this pattern with a non-atomic UPDATE+DELETE. This asymmetry is surprising and error-prone.

**Critique**: A developer adding a new rate-limit type would reasonably copy `decrementRateLimit` as a reference. They would inherit the race condition. The pattern is not marked with a warning comment.

**Fix**: Add atomicity or a prominent TODO comment warning about the race.

---

#### C22-CT-02: SW HTML Cache Is the Only Uncapped Cache
- **Source**: `apps/web/public/sw.js`
- **Confidence**: HIGH
- **Cross-file agreement**: C22-HIGH-02 (code-reviewer), C22-PERF-02 (perf-reviewer)

IMAGE_CACHE has 50MB LRU + metadata tracking. META_CACHE is tiny (one JSON blob). HTML_CACHE has no cap at all. The asymmetry is striking: the team carefully designed LRU eviction for images but left HTML completely unbounded.

**Critique**: This looks like an oversight, not a deliberate design choice. The fix is straightforward (add entry-count LRU) and should mirror the image cache pattern.

---

### MEDIUM

#### C22-CT-03: Bootstrap Cleanup Is Not Idempotent in Intent
- **Source**: `apps/web/src/lib/image-queue.ts:583-585`
- **Confidence**: MEDIUM
- **Cross-file agreement**: C22-MED-02 (code-reviewer), C22-PERF-01 (perf-reviewer)

The cleanup functions are idempotent in effect (deleting expired rows twice is harmless), but they are not idempotent in cost. Running `purgeExpiredSessions` (which may scan a large sessions table) on every bootstrap during a recovery loop is wasteful. The intent of bootstrap is to discover pending images, not to run garbage collection.

**Fix**: Move cleanup out of bootstrap entirely, or gate it with a "hasRunThisHour" flag.

---

### LOW

#### C22-CT-04: Semantic Search Client Constant Duplication
- **Source**: `apps/web/src/components/search.tsx:79`, `apps/web/src/lib/clip-embeddings.ts:12`
- **Confidence**: MEDIUM

Hardcoding `topK: 20` in the client while the server exports `SEMANTIC_TOP_K_DEFAULT = 20` violates the DRY principle. If the server default is tuned (e.g., lowered to 10 for performance), the client will silently continue requesting 20.

**Fix**: Share the constant through a client-safe module.

---

## No regressions from prior fixes detected
- All cycle-21 fixes are clean.
- No new patterns of incomplete HTTP guards were found.

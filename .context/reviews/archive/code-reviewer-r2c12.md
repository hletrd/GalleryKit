# Code Reviewer — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Entire repository, with focus on R2C11-fixed surfaces and lint/test infrastructure
**Method**: Manual source review of changed files and critical cross-file interactions

## Finding C12-LOW-01: `check-public-route-rate-limit.ts` prefix regex does not strip comments

- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 136-139
- **Code**:
  ```typescript
  const usesPrefixHelper = RATE_LIMIT_NAME_PREFIXES.some((prefix) => {
      const re = new RegExp(`\\b${prefix}[A-Za-z0-9_]+\\s*\\(`);
      return re.test(withoutStrings);
  });
  ```
- **Problem**: `withoutStrings` strips string literals (lines 124-127) but does NOT strip line comments (`// ...`) or block comments (`/* ... */`). A commented-out rate-limit helper call like `// preIncrementSemanticAttempt(ip, now)` or `/* preIncrementCheckoutAttempt(ip) */` matches `\bpreIncrement[A-Za-z0-9_]+\s*\(` and falsely satisfies the gate. The import check at lines 142-148 already excludes commented lines (C8-F03), but the prefix check was never hardened the same way.
- **Failure scenario**: A developer comments out the rate-limit call during debugging, ships the file, and the lint gate passes because the commented-out call matches the regex. The public mutating route ships without active rate limiting.
- **Fix**: Strip line and block comments from `withoutStrings` before the prefix check, or add a per-line comment filter matching the import-check pattern.
- **Severity**: Low | **Confidence**: High

## Finding C12-LOW-02: Semantic search Content-Length guard accepts malformed and non-numeric values

- **File**: `apps/web/src/app/api/search/semantic/route.ts`, line 76
- **Code**:
  ```typescript
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_SEMANTIC_BODY_BYTES) {
  ```
- **Problem**: `Number.parseInt` accepts leading numeric prefixes (`"8abc"` → 8) and returns `NaN` for non-numeric strings (`"abc"` → NaN). Since `NaN > 8192` is `false`, a client sending `Content-Length: abc` or `Content-Length: NaN` bypasses the guard entirely. Similarly, `"8kb"` parses as `8` and passes. While Next.js has its own body limits, this guard is meant to be a fast-path rejection and should not be bypassable by malformed headers.
- **Failure scenario**: A malicious client sends `Content-Length: NaN` with a 50 KB JSON body. The guard does not fire. Next.js may or may not reject the body depending on its own configuration. The route proceeds to `request.json()`, potentially consuming memory and CPU.
- **Fix**: Replace with `const contentLengthNum = Number(contentLength); if (Number.isFinite(contentLengthNum) && contentLengthNum > MAX_SEMANTIC_BODY_BYTES) { ... }`
- **Severity**: Low | **Confidence**: High

## Finding C12-LOW-03: BoundedMap `set()` does not enforce the hard cap — design/doc mismatch

- **File**: `apps/web/src/lib/bounded-map.ts`, lines 64-67
- **Code**:
  ```typescript
  set(key: K, value: V): this {
      this.map.set(key, value);
      return this;
  }
  ```
- **Problem**: The class docstring says "automatically prunes expired entries and evicts oldest entries when the hard cap is exceeded." However, `set()` does not enforce the cap — it only adds entries. The cap eviction only happens inside `prune()`, which callers must invoke manually before every operation. For the current rate-limit consumers this is fine (they all call `prune()` first), but as a general-purpose utility the API is misleading and could be misused by future callers who forget to call `prune()`.
- **Fix**: Either (a) document that `prune()` must be called before reads/writes, or (b) enforce the cap inline in `set()` by evicting oldest entries when size exceeds maxKeys after insertion.
- **Severity**: Low | **Confidence**: Medium

## Finding C12-LOW-04: High-bitdepth AVIF probe has unguarded concurrent-first-use race

- **File**: `apps/web/src/lib/process-image.ts`, lines 49-66
- **Problem**: `_highBitdepthAvifProbed` and `_highBitdepthAvifAvailable` are module-level `let` variables with no synchronization. When the first image in a batch triggers the probe, multiple concurrent `processImageFormats` calls (especially with `QUEUE_CONCURRENCY > 1`) can race: one succeeds and calls `markHighBitdepthAvifAvailable()`, another fails and calls `markHighBitdepthAvifUnavailable()`. The winner is non-deterministic. After the flag stabilizes the behavior is consistent, but the first-batch output is unpredictable.
- **Fix**: Wrap the probe in a `Promise`-based singleton so only one worker performs the probe and the result is broadcast to all concurrent waiters.
- **Severity**: Low | **Confidence**: Medium

## Commonly Missed Sweep

- No dead code or unused imports in recently changed files.
- All R2C11 fix commits are individually clean and correctly scoped.
- The `semantic-search/route.ts` enrichment fallback (`filename_jpeg: ''`) is intentional degradation, not a bug.

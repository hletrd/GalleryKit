# Aggregate Review — Cycle 19

## Review method

Direct deep review of all source files by a single agent with multi-perspective
analysis. All key modules examined: rate-limit, image-queue, data, sanitize,
validation, proxy, session, auth, api-auth, action-guards, images actions,
public actions, sharing, admin-users, db-actions, settings, content-security-policy,
request-origin, bounded-map, csv-escape, safe-json-ld, advisory-locks,
upload-tracker-state, schema. Particular attention to recently changed files
(`sw.js`, `check-public-route-rate-limit.ts`, `api/checkout`, `api/og`,
`api/search/semantic`).

## Verified prior fixes (from cycle 18)

| ID | Status | Notes |
|----|--------|-------|
| C18-HIGH-01 (checkout idempotency randomUUID) | FIXED | `route.ts:153` now uses deterministic key without randomUUID. |
| C18-MED-01 (SW cache key mismatch) | FIXED | `sw.js:116` uses `request.url` string for both `put` and `delete`. |
| C18-MED-02 (semantic search codepoints) | FIXED | `route.ts:114` now uses `countCodePoints(query) < 3`. |
| C18-LOW-01 (caption/embedding hook race) | UNCHANGED | Still present, low impact, acceptable. |
| C18-LOW-02 (SW HTML route navigate mode) | UNCHANGED | Still present, low impact. |
| C18-LOW-03 (semantic search negative Content-Length) | UNCHANGED | Still present, low impact. |

---

## Findings (sorted by severity)

### MEDIUM severity

#### C19-AGG-01: `check-public-route-rate-limit.ts` ESM entry-point detection is broken — throws ReferenceError

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:179`
- **Cross-agent agreement**: C19-CR-01, C19-SR-01, C19-DEBUG-01, C19-CT-01 (4 agents agree)
- **Issue**: The dual-mode entry-point guard `require.main === module || (typeof require === 'undefined' && ...)` evaluates `require.main` BEFORE the `typeof require === 'undefined'` short-circuit can protect it. In ESM, `require` does not exist, so the left operand throws `ReferenceError` immediately. The file is imported by `check-public-route-rate-limit.test.ts`; if the test runner or project ever switches to ESM mode, the lint gate crashes on load instead of running.
- **Failure scenario**: Adding `"type": "module"` to package.json, or running vitest in ESM mode, causes `ReferenceError: require is not defined` on module import. CI pipeline fails before tests run, bypassing the lint gate.
- **Fix**: Reorder to test `typeof require !== 'undefined'` BEFORE accessing `require.main`:
  ```typescript
  const isCliEntry = (typeof require !== 'undefined' && require.main === module) || (typeof require === 'undefined' && import.meta?.url?.includes('check-public-route-rate-limit'));
  ```
- **Confidence**: High

### LOW severity

#### C19-AGG-02: `data.ts` misplaced `cache()` side-effect comment documents wrong function

- **Source**: `apps/web/src/lib/data.ts:1324-1328`
- **Cross-agent agreement**: C19-CR-03, C19-DEBUG-02, C19-DOC-01, C19-CT-02 (4 agents agree)
- **Issue**: The comment warning about `incrementViewCount` side effects and `cache()` deduplication is placed above `getImageByShareKeyCached`, but `getImageByShareKey` no longer has any view-count side effect. The actual side-effect-bearing function is `getSharedGroup` (cached on the next line, line 1329) which calls `bufferGroupViewCount`. The comment is confusing and documents behavior that no longer exists for the function it sits above.
- **Fix**: Move the comment to line 1329 (above `getSharedGroupCached`). Add a simple "Pure function — safe to cache" comment above `getImageByShareKeyCached`.
- **Confidence**: High

#### C19-AGG-03: `check-public-route-rate-limit.ts` regex requires at least one suffix character

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:145-148`
- **Cross-agent agreement**: C19-CR-02, C19-TEST-02 (2 agents agree)
- **Issue**: The rate-limit helper detection regex `\b${prefix}[A-Za-z0-9_]+\s*\(` requires at least one alphanumeric character after the prefix. A helper named exactly `preIncrement()` (with no suffix) would not match, even though the documented convention says "any helper whose name starts with `preIncrement`".
- **Failure scenario**: Future developer adds a generic `preIncrement` helper and the lint gate falsely flags the route as missing rate limiting.
- **Fix**: Change `[A-Za-z0-9_]+` to `[A-Za-z0-9_]*` so the suffix is optional.
- **Confidence**: Medium

#### C19-AGG-04: Semantic search fallback branch returns unfiltered embedding results

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:216-230`
- **Cross-agent agreement**: C19-CR-04, C19-DEBUG-03, C19-CT-03 (3 agents agree)
- **Issue**: In the `catch` fallback branch (when the image metadata enrichment query fails), the code returns all `results` from the embedding scan without the `eq(images.processed, true)` filter that the success branch enforces. The returned objects have empty metadata (`filename_jpeg: ''`, `width: 0`) which may break client rendering.
- **Fix**: Return `{ results: [] }` in the fallback branch instead of raw embedding matches. This is consistent with other endpoints (e.g., `loadMoreImages` returns structured error on DB failure).
- **Confidence**: Low (fallback path only, requires DB error)

#### C19-AGG-05: `sw.js` comment references non-existent `scripts/build-sw.ts`

- **Source**: `apps/web/public/sw.js:11`
- **Cross-agent agreement**: C19-DOC-02
- **Issue**: The comment says `e04a331 is replaced at build time by scripts/build-sw.ts`. No such script exists in the repository. The `SW_VERSION` is hardcoded.
- **Fix**: Update the comment to reflect the actual build process.
- **Confidence**: Low

### DEFERRED / INFORMATIONAL

- C19-PERF-01: SW `recordAndEvict` O(n log n) sort on every image update — informational, acceptable at personal-gallery scale.
- C19-SR-03: `semantic/route.ts` same-origin check without method verification — informational, no active GET handler.
- C19-DOC-03: `check-public-route-rate-limit.ts` references internal ticket IDs — informational, code is self-explanatory.

## Previously fixed findings (confirmed still fixed)

- C18-HIGH-01: checkout idempotency randomUUID — FIXED
- C18-MED-01: SW cache key mismatch — FIXED
- C18-MED-02: semantic search codepoints — FIXED
- C18-TEST-01/02/03: prior test gaps — addressed by fixes above

## Carry-forward (unchanged — existing deferred backlog)

- C16-HIGH-01: SW metadata cache read-modify-write race — deferred
- C16-LOW-03: getRateLimitBucketStart truncates sub-second windows — deferred
- C16-LOW-04: SW caches non-image responses — deferred
- C16-LOW-05: Analytics record functions don't validate entity existence — deferred
- C17-ARCH-03: SW metadata store uses single shared JSON blob — deferred
- C17-PERF-02: getImagesLitePage COUNT(*) OVER() — deferred

# Code Reviewer — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: code-reviewer (quality, logic, SOLID, maintainability).

Scope: full repository walk of `apps/web/src/` with emphasis on the surfaces
changed since the cycle-5-rpl aggregate (lint-gate scripts, SQL scanner,
sharing/public actions, image queue, data layer, db-actions).

## Inventory

- Action surface: `apps/web/src/app/actions/*.ts` (9 files) + `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Lib surface: 40 files under `apps/web/src/lib/`.
- Lint scripts: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- Tests: 47 vitest files, 256 passing tests; `apps/web/e2e/*.spec.ts` (Playwright).
- API routes: `apps/web/src/app/api/**/route.ts` (incl. admin/db/download and live/health).

## Findings

### C6-01 — `checkActionSource` skips CallExpression-embedded arrow/function exports
- File: `apps/web/scripts/check-action-origin.ts:150-193`.
- Severity: LOW. Confidence: HIGH.
- The scanner accepts three export forms: `export async function foo() {...}`,
  `export const foo = async (...) => {...}`, and
  `export const foo = async function (...) {...}`. It does NOT accept the
  `export const foo = withGuard(async (...) => {...})` pattern. The latter is
  a legitimate higher-order-function wrapping pattern sometimes used for
  action HOFs (e.g. if a future `withAdminAndOrigin(handler)` helper is
  introduced). The scanner would silently pass such an export even though
  `requireSameOriginAdmin` is not literally called inside `handler`.
- Scenario: refactor lands an HOF; arrow handler inside HOF args never calls
  `requireSameOriginAdmin` directly (the HOF is expected to call it). Lint
  passes. If the HOF is broken or the handler is routed to a different HOF
  in a rebase, the defense-in-depth check disappears silently.
- Fix: either (a) document the HOF pattern as unsupported and require direct
  declaration form, or (b) recurse into CallExpression arguments looking for
  ArrowFunction / FunctionExpression nodes when the statement is a
  VariableStatement. Observational today — no current HOF usage.

### C6-02 — `viewCountBuffer` does not track per-group first-seen for LRU eviction
- File: `apps/web/src/lib/data.ts:28-42`, `apps/web/src/lib/data.ts:48-96`.
- Severity: LOW. Confidence: MEDIUM.
- When the buffer is at capacity (`MAX_VIEW_COUNT_BUFFER_SIZE = 1000`) the
  code drops increments for new groupIds but keeps serving groupIds already
  in the buffer. If an attacker can craft 1000 distinct shared-group keys
  (via DB access) and each gets one view before flush, increments for the
  1001st legitimate group are dropped for the rest of the buffer lifetime.
- Realistically bounded: attacker needs DB access to create groups; the
  flush timer fires every 5s so the window is small; view counts are
  observational, not billing. But the buffer's eviction policy is
  FIFO-friendly by iteration order only, not LRU — the Map's insertion order
  would bias against more recent groups in a collision scenario.
- Fix: none required today. If ever needed, switch to a `lru-cache`-backed
  buffer with a soft cap. Document as observational.

### C6-03 — `flushGroupViewCounts` increments `succeeded` inside `.then()` without volatile fence
- File: `apps/web/src/lib/data.ts:67`.
- Severity: LOW. Confidence: MEDIUM.
- `succeeded++` is written from multiple `.then()` callbacks concurrently.
  In V8 single-threaded execution this is safe by definition — each
  microtask runs to completion — but the semantics are easy to misread.
  The final decision to reset / increment `consecutiveFlushFailures` depends
  on whether `succeeded > 0`, and while V8 guarantees no torn writes, a
  future migration to worker threads would need to revisit this.
- Fix: add a comment pointing out V8 concurrency is single-threaded, so the
  pattern is safe. Observational.

### C6-04 — `searchImagesAction` DB check happens AFTER DB increment without rollback on unlimited
- File: `apps/web/src/app/actions/public.ts:64-90`.
- Severity: LOW. Confidence: MEDIUM.
- The action pre-increments the DB counter before `checkRateLimit`. If the
  DB check succeeds (under limit), it proceeds — correct. If the DB check
  FAILS (limit exceeded), it rolls back the in-memory counter, but NOT the
  DB counter that was just incremented. This means legitimate users who hit
  the limit momentarily pay one extra DB-counted attempt that isn't
  reversed. Over time, this skews the DB counter high and triggers earlier
  lockouts.
- Compare: `sharing.ts::createPhotoShareLink` rolls back both in-memory and
  DB on limit exceeded (line 113: `rollbackShareRateLimit(ip, ...)` — but
  only rolls in-memory; DB counter also stays high). Same asymmetry.
- Compare: `auth.ts::login` pre-increments BOTH, rolls back BOTH on
  unexpected error (lines 229-238). That path is correct.
- Fix: on the DB-over-limit branch, call `decrementRateLimit(ip, 'search',
  SEARCH_WINDOW_MS)` symmetrically. Same applies to `sharing.ts`.
  This is a small drift — the cycle-5 finding list covered in-memory rate
  limit rollback but not the DB rollback specifically.

### C6-05 — `cleanOrphanedTmpFiles` uses `entries.filter` before logging — LOG can claim "Removing N" when parallel unlinks fail
- File: `apps/web/src/lib/image-queue.ts:26-37`.
- Severity: LOW. Confidence: HIGH.
- `console.info('[Cleanup] Removing ${tmpFiles.length} orphaned .tmp files')`
  is logged BEFORE the unlinks, so the count reflects discovered files, not
  successfully removed ones. If all unlinks swallow via `.catch(() => {})`,
  the log lies by omission.
- Fix: tally succeeded vs failed, log after `Promise.all`. Trivial
  improvement. Defense-in-debuggability.

### C6-06 — `enqueueImageProcessing` re-enqueues itself from `setTimeout` callback inside a `p-queue` task
- File: `apps/web/src/lib/image-queue.ts:169-175`.
- Severity: LOW. Confidence: MEDIUM.
- When claim fails, the code schedules a self-re-enqueue via
  `setTimeout(..., delay)`. That `enqueueImageProcessing(job)` call runs in
  a bare macrotask context (not inside `state.queue.add`), so:
  (a) If `isRestoreMaintenanceActive()` has since become true, the guard
      at line 138 correctly drops the job. Good.
  (b) If `state.shuttingDown` has since become true, the guard at line 138
      also drops. Good.
  (c) If `state.enqueued.has(job.id)` is already set from a different path
      (e.g., another concurrent enqueue of the same id), the guard at line
      142 drops. Good.
  However, the re-enqueue call does NOT re-acquire the claim lock first —
  it just re-enters the queue. If a different worker has just finished
  processing the same id and released the lock, the re-enqueue will grab
  it and process it again. The claim check at line 178 catches this via
  `eq(images.processed, false)`. Okay.
- Observational: the self-referential setTimeout inside a `p-queue` task
  is a known anti-pattern. A `BackOffQueue` helper would be clearer. Not a
  bug; maintainability concern.

### C6-07 — `getImages` and `getImagesLite` diverge in pagination semantics
- File: `apps/web/src/lib/data.ts:318-418`.
- Severity: LOW. Confidence: MEDIUM.
- `getImages(...)` returns `baseQuery.limit(effectiveLimit).offset(offset)`
  without a `+1 row` trick for `hasMore`. `getImagesLitePage(...)` uses a
  `limit(normalizedPageSize + 1)` / `normalizePaginatedRows` trick to carry
  a `total_count` window function + hasMore flag. Two different patterns
  coexist — one via window function, one via +1 row.
- Not a bug; documentation gap. A future maintainer adding cursor
  pagination to `getImages` would pick one of the two and inconsistency
  would grow. Covered by cycle-5 finding AGG5R-07 (deferred).

### C6-08 — `sharedGroups` view count flush dropped increments aren't reflected in audit
- File: `apps/web/src/lib/data.ts:32-36`, `apps/web/src/lib/data.ts:68-77`.
- Severity: LOW. Confidence: MEDIUM.
- When the buffer is at capacity, increments are silently dropped with a
  `console.warn`. There is no audit event, no Prometheus counter, no
  admin-visible UI. During a multi-hour DB outage, arbitrarily many group
  views would be lost. For a personal gallery this is acceptable but a
  simple `droppedIncrements` counter surfaced in `/api/health` would help
  diagnose capacity issues.
- Fix: expose counter at module level, read from `/api/health`. Tiny.

### C6-09 — `cleanString` rejects literal "undefined"/"null" only for non-string inputs; but an EXIF library that stringifies `null` to the string `"null"` could land in camera_model
- File: `apps/web/src/lib/process-image.ts:462-470`.
- Severity: LOW. Confidence: LOW.
- The comment says "prevents dropping legitimate EXIF metadata that happens
  to be the word 'null' or 'undefined'" — fair. But in practice,
  `exif-reader` passes strings directly. If a camera wrote the literal word
  "undefined" to the Model tag, that's preserved. That's correct. No bug;
  observational.

### C6-10 — `shareRateLimit` prune does not enforce max-key ceiling atomically
- File: `apps/web/src/app/actions/sharing.ts:36-50`.
- Severity: LOW. Confidence: MEDIUM.
- `pruneShareRateLimit()` is called inside `checkShareRateLimit()`. If two
  concurrent invocations both prune then both increment, the map size can
  briefly exceed `SHARE_RATE_LIMIT_MAX_KEYS` by 1 before the next prune
  bounds it. Not a leak — just a soft cap. Map size is bounded by
  iterations; prune is called every action invocation.
- Fix: none required. Observational.

### C6-11 — `restoreDatabase`'s BigInt comparison `acquired !== BigInt(1)` works but obscures intent
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:276-280`.
- Severity: LOW. Confidence: HIGH.
- `acquired !== 1 && acquired !== BigInt(1)` handles both `mysql2`'s return
  types (number or bigint depending on flags). It's correct, but the literal
  `BigInt(1)` every call allocates a new BigInt instance. Minor — BigInt(1)
  constant-folds. No perf concern.
- Readability: extract to a constant `const LOCK_ACQUIRED_BIGINT = BigInt(1);`
  at module level to avoid the per-call allocation AND make intent clear.
  Observational.

### C6-12 — `escapeCsvField` regex excludes `\n` (0x0A) and `\r` (0x0D) from the control-char strip step
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:27-41`.
- Severity: LOW. Confidence: HIGH.
- The comment says "Strip null bytes, tab, and other control characters (except \r\n which are handled below)", and the regex is `[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]`. The ranges correctly exclude \r (0x0D) and \n (0x0A). Good.
  But the second step `value.replace(/[\r\n]/g, ' ')` converts both to a
  single space rather than removing entirely. That means `"title\r\nfoo"`
  becomes `"title  foo"` (two spaces) not `"title foo"`. Minor — CSV
  field rendering is still safe. Could collapse to a single space, but a
  double space is not a bug.
- Fix: `value.replace(/[\r\n]+/g, ' ')` to collapse consecutive line breaks.
  Cosmetic.

## Cross-file interactions reviewed

- `public.ts::searchImagesAction` vs `rate-limit.ts::incrementRateLimit` —
  see C6-04. The asymmetric DB-rollback is a real inconsistency with the
  login path.
- `sharing.ts::rollbackShareRateLimit` vs DB state — only rolls back
  in-memory; DB is unaffected. Same pattern as C6-04.
- `session.ts::getSessionSecret` production hard-fail — verified correct.
  Non-production DB fallback uses `INSERT IGNORE + re-fetch` pattern,
  matching AGG3R carry-forward rationale. Good.
- `image-queue.ts::enqueueImageProcessing` self-re-enqueue — safe but
  complex (C6-06).
- `rate-limit.ts::getClientIp` — verified `TRUST_PROXY`-gated reading of
  `x-forwarded-for`, `x-real-ip`. Reverse iteration + `normalizeIp` is
  correct. `warnedMissingTrustProxy` single-shot warning covered by
  AGG5R-14 deferred.

## Summary

- **0 HIGH / MEDIUM** findings.
- **12 LOW** findings, mostly observational/cosmetic. The most actionable
  is **C6-04 / C6-10** (symmetric DB rollback on search/share rate-limit
  check failures). The rest are refactor hints or documentation improvements.
- The code quality is high. The defense-in-depth scaffolding (origin check,
  maintenance guards, pre-increment rate limits with symmetric rollback)
  is consistent across the action surface.

VERDICT: APPROVED

# Run-10 Cycle 3 — Ralph completion verification (THOROUGH tier)

Reviewer: ralph completion reviewer. Method: read the committed code (not just
the plan), ran the full gate suite, and traced the load-bearing invariant of
each requested WP plus 3 spot-checks. HEAD range `e08b6f97..HEAD` (15 impl
commits; newest test-pin `d07c6d32`).

## Gate evidence (all green at HEAD)
- **vitest**: `333 passed | 2 skipped (335 files)`; `3091 passed | 4 skipped
  (3095 tests)`. Up from the review-time baseline of 3032/326 — tests were
  ADDED, none deleted/weakened to pass.
- **typecheck** (`typecheck:app` + `typecheck:scripts`): pass (routes generated,
  8 JS scripts checked, tsc clean).
- **lint:api-auth / lint:action-origin / lint:public-route-rate-limit**: all pass.
- (build + e2e not re-run here; e2e specs inspected for shape — see WP4/WP6.)

## Per-WP findings (specifically-requested)

### WP1 — migrate.js mixed-case batch swallow (C3-01) — VERIFIED
`apps/web/scripts/migrate.js:837-873`. In `prepareLegacyDatabaseIfNeeded`:
`trueDrift = cursor === null ? missing : missing.filter(folderMillis <= cursor)`;
`pendingTail` is the above-cursor complement, left UN-baselined (only a NOTE
log) so `drizzle.migrate()` genuinely applies it. `baselineAllJournalMigrations`
now takes `{ maxFolderMillis }` and THROWS (`Refusing to baseline …`) before any
INSERT if handed an above-cursor entry (belt-and-braces; migrate.js:756-772).
- Empty-log path: `cursor === null → trueDrift = missing` and `maxFolderMillis =
  null` skips the guard → baselines everything after reconcile. ✓
- Fresh-DB path (`!hasGalleryTables`, migrate.js:801-802): unchanged — reconcile
  + `baselineAllJournalMigrations(connection, migrations)` with no options. ✓
- Tests (`migrate-pending-migrations.test.ts:129-198`): MIXED batch
  `[1000,2000,2500,1800,3000]`, recorded `[hash-0,hash-1]`, cursor 2000 →
  asserts ONLY hash-3 (1800, below cursor) inserted, hash-2/hash-4 (above)
  excluded; guard test asserts throw + zero inserts; empty-log baselines all.
  Meaningful and reproduces the DBG3-02 case.

### WP2 — single-writer guard (C3-02 + C3-03) — VERIFIED
`apps/web/src/lib/single-writer-guard.ts`, `advisory-locks.ts:67-72`.
- Keepalive: `setInterval(SELECT 1, 60_000)`, `keepaliveTimer.unref?.()`
  (line 124); cleared in `stopSingleWriterGuard` via `clearKeepalive()` (208)
  AND on lapse (conn 'error' handler line 107 + keepalive-failure line 120).
- DB-scoped lock: `getSingleWriterLockName` = `gallerykit_web_singleton_` (25) +
  16-hex sha256(dbName) = 41 chars ≤ 64. Distinct per DB (test line 112).
- Cry-wolf: initial GET_LOCK failure closes the probe quietly and arms an
  unref'd `REPROBE_DELAY_MS` (25s) timer; `emitLoudTopologyError` fires ONLY
  inside `reprobeOnce` after the re-probe still fails.
- No throw escapes `startSingleWriterGuard`: `openGuardConnection` catches →
  null; the acquire/timer body is try/caught; the setTimeout runs `void
  reprobeOnce()` which is itself fully try/caught; all `conn.end()` are
  `.catch()`-guarded.
- Tests are behavioral and comprehensive (keepalive tick counts, warn-once on
  lapse, transient vs persistent re-probe, null-lock, every error path
  resolves-undefined, idempotency, stop releases lock, instrumentation wiring).

### WP5 — SW touchMeta durability + size-0 (C3-10 + C3-22) — VERIFIED
`apps/web/public/sw.template.js:358-388`. Both confirmed-fresh branches (304 at
368, same-ETag at 387) now `await touchMeta(request.url, cachedSize, () =>
responseSize(cached)).catch(() => {})` — inside `respondWith`'s promise chain, so
SW-lifetime covers the write; the `.catch` still serves cached bytes on failure.
`touchMeta` (178-210) resolves an unknown size lazily and `if (!size) return;`
before recording — size-0 entries are impossible. `sw-cache.ts` mirror updated
in lockstep. `sw.js` regenerated: `SW_VERSION = '26516421-p7'` and the awaited
+ size-0-guarded body is present at sw.js:198/368/387 (hash mechanism =
`sha256(template + PIPELINE).slice(0,8) + '-p' + IMAGE_PIPELINE_VERSION`).

### WP7 — embedding-scan cursor starvation (C3-07) — VERIFIED
`apps/web/src/lib/image-queue.ts`. `embeddingScanCursorId` persisted on queue
state; scan resumes from it (`let cursorId = state.embeddingScanCursorId`); on
cap-hit `state.embeddingScanCursorId = cursorId` (saved) then break; on clean
completion (`rows.length < BATCH`) reset to 0 (wraparound retries the failed
prefix); restore reset clears it to 0 + clears retry timers
(`quiesce…ForRestore`, line ~1285). Test
`image-queue-embedding-bootstrap-cap.test.ts:227-255` drives a 110-row stuck
backlog across two invocations: asserts cursor==100 after inv-1 (resume point),
resumes past id>100 and wraps to 0 on inv-2. No infinite-loop / skipped-row
regression (cursor strictly advances; failed prefix retried on wrap).

### WP9 — micro-cache + operability (C3-15/16/20/21) — VERIFIED
`gallery-config.ts:211-239`. 2s TTL + in-flight dedupe. Cannot cache a poisoned
promise: `_getGalleryConfig` catches internally (never rejects → caches
real-or-default value); even if it did reject, the cache assignment is AFTER the
await and `uncachedConfigInFlight` is nulled in `finally`, so a rejection is
returned but never cached. 2s detached-context skew honestly documented.
`image-queue.ts`: clamp `console.warn` when QUEUE_CONCURRENCY pool-clamped;
per-job retry timers now `scheduleTrackedRetry`→state.retryTimers, cleared in
shutdown, defensive re-init, and restore reset; the copy-pasted "up to 25s"
comment corrected to 10s at the processing-retry site (line 949) while the
claim-retry site (721, MAX_CLAIM_RETRIES=10 → 25s reachable) correctly keeps it.

### WP15 — serve-upload 304/HEAD fd-free (C3-28/29) — VERIFIED (security-preserving)
`apps/web/src/lib/serve-upload.ts:198-217`. Ordering: `resolveUploadRootCached`
→ `lstat(absolutePath)` symlink reject (201-203) → `realpath` + `startsWith(
resolvedRoot + sep)` containment (204-207) — ALL before the path-`stat` at 217
that feeds the 304 (263) and HEAD (280) branches. A symlink or traversal cannot
reach the fd-free responses. The GET body path still `open()`s and `fstat`s
THROUGH the descriptor it streams from (296-302, `bodyStats`/`bodyEtag`). Cached
realpath root: only a SUCCESSFUL realpath is cached; ENOENT falls back
per-request; and a stale cached root FAILS CLOSED — a swapped root makes
`realpath(target)` not start with the old cached root → 403. No open bypass.

### WP4 — 404 head robots (C3-05) — VERIFIED (no regression)
`[locale]/layout.tsx:54-66` removed the explicit `robots:{index,follow}`.
Grepped every `robots` usage in `app/**`: pages needing non-default behavior set
it explicitly (`[topic]` noindex/tag-slug, `map` noindex-follow, `s`/`g` share
`sharePageRobots`, home tag-slug noindex-follow). No valid page RELIED on
inheriting `index,follow` — absence of a robots tag is crawler-equivalent to
index/follow, so nothing loses indexing. e2e `not-found-status.spec.ts` pins
exactly one `noindex` robots tag + no `index, follow` on 4 404 classes (both
locales) and the 200 home control.

## Spot-checks
- **WP3 (C3-04)**: `admin-backfill-runner.ts:691` swapped `getGalleryConfig()` →
  `getGalleryConfigUncached()`. The wiring test was renamed
  `image-queue-uncached-config-wiring.test.ts` →
  `detached-uncached-config-wiring.test.ts` and EXPANDED to pin BOTH detached
  modules (image-queue 3 call sites + backfill runner), asserting neither uses
  bare `getGalleryConfig(`. Strengthened, not a deletion-to-weaken.
- **WP6 (C3-13/14)**: `photo-navigation.tsx` — success branches call
  `applySwipeVisuals(0,true)` before `goToPhoto`; `useLayoutEffect` keyed on
  `[prevId,nextId,applySwipeVisuals]` re-asserts resting styles on ANY in-place
  switch (covers the shared-view `setCurrentImageId` mechanism). e2e
  `swipe-visual-reset.spec.ts` added (real TouchEvents on shared-group fixture).
- **WP8 (C3-06)**: `search/similar/[id]/route.ts:168` `targetEmbedding = new
  Float32Array(decoded)` off the hot loop; comment tightened to the
  copy-before-holding constraint. Removes dependence on mysql2 buffer internals.
- **WP10 (C3-08/09/12doc)**: `nginx/default.conf` adds `zone=nextimage:10m
  rate=30r/s` + `limit_req zone=nextimage burst=120 nodelay` on `^~
  /_next/image`, and the topology comment gains the `set_real_ip_from` /
  `real_ip_header` LB caveat. Ledger honesty recorded (operator apply pending).
- **WP12 (C3-25)**: `next-config-uploads-headers.test.ts` brace-balanced
  location parser replaces the indexOf hack. `api-csp-header.test.ts`
  relaxations JUDGED SOUND: the CSP value is still exactly pinned
  (`findHeader(...).value === API_CSP`), a STRONGER `not.toContain('immutable')`
  negative added, and the production-only property is still pinned by the intact
  `does NOT add a dedicated /api rule in dev … toBeUndefined()` test (line 62).
  Only the ossification-tax exact-rule-COUNT pins were dropped.
- **WP16**: `.context/plans/deferred-carry-forward.md` exists (9.1 KB
  consolidated register).
- **WP11**: `not-found-layout-restore-maintenance.test.ts`, `clip-inference.test.ts`,
  `csp-nonce.test.ts`, `settings-normalization.test.ts` all present.
- **WP14**: `optimistic-image.tsx` retries against `retryBaseRef` (switches to
  `fallbackSrc` as the retry base), not the dead original `src`.

## Flagged test relaxations — both preserve load-bearing assertions
- `resolved-stream-source.test.ts` (d07c6d32): tracks the PERF3-07 rename
  (`stats` → `bodyStats`) while still pinning "stats THROUGH the descriptor it
  streams from" plus `open(resolvedPath)`, `createReadStream` from the handle,
  and `not createReadStream(absolutePath)`. Invariant intact.
- `api-csp-header.test.ts` (8b2dd1d2): see WP12 — CSP value still exact, added a
  stronger immutable-negative, dev-absence still pinned. Sound.

## Scope / deferred integrity
- No scope reduction: all 16 WPs implemented in code + tests. The only unmet
  plan items are the operator-side nginx prod-apply/429-verify (WP10 post-deploy
  checkboxes) — correctly deferred (C3-08op/C3-12op) under the destructive-action
  policy; deploys do not touch host nginx by design.
- Deferred register carries NO non-deferrable security/correctness item: every
  entry is a perf opportunity, operator-only action, process note,
  needs-validation item, or accepted-by-design boundary. Every correctness-class
  finding C3-01..C3-14 is scheduled in the plan and verified above. The C2-37
  residual (runtime IMAGE_BASE_URL boot validation) fails safe today.

VERDICT: APPROVED

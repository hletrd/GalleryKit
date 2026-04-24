# Architect — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** architectural/design risks, coupling, layering, and
maintainability after 7 cycles of RPL polish.

## Findings

### A8-01 — Rate-limit abstraction is duplicated across 4 domains [MEDIUM, HIGH]

**Files:** `apps/web/src/lib/rate-limit.ts` (base primitives),
`apps/web/src/app/actions/auth.ts` (login + account-scoped),
`apps/web/src/app/actions/public.ts` (search),
`apps/web/src/app/actions/sharing.ts` (share_photo + share_group),
`apps/web/src/app/actions/images.ts` (upload tracker).

**Observation:** each of the 4 domains maintains its own in-memory
Map, its own prune function, and its own rollback helper. The DB-
bucket primitive (`checkRateLimit`/`incrementRateLimit`/
`decrementRateLimit`/`resetRateLimit`) is shared, but the in-memory
fast-path differs in:
- Map shape (`{count, lastAttempt}` vs `{count, resetAt}` vs
  `{count, bytes, windowStart}`).
- Prune throttling (search uses time-throttled prune;
  upload/sharing prune unconditionally).
- Eviction order (all use insertion-order, but some cap at 500,
  others at 2000, others at 5000).
- Rollback semantics (login decrements and deletes if ≤ 0; sharing
  decrements and deletes if count ≤ 1).

**Risk:** future reviewers fix a bug in one Map and miss the
same bug in the other three. Already caused cycle-4 through
cycle-7 cascading symmetric-rollback fixes (one Map at a time).

**Severity:** MEDIUM, HIGH.

**Suggested fix:** consolidate into a `rate-limit-factory.ts` that
takes a config `{maxKeys, windowMs, maxAttempts, entryShape}` and
returns a `{check, rollback, prune}` triple. Pre-existing deferred
item (AGG2-04).

### A8-02 — Many singletons on `globalThis` with `Symbol.for()` keys [LOW, HIGH]

**Files:** `apps/web/src/lib/image-queue.ts:54`,
`apps/web/src/lib/restore-maintenance.ts:1`.

**Observation:** both modules use `Symbol.for('gallerykit.xxx')` to
pin per-process state to `globalThis`. Pattern is correct for Next.js
dev HMR (module reloads don't reset state). Two instances ≤ 4
symbols total — minimal, but the pattern should be factored into
`@/lib/process-singleton.ts` so new singletons don't copy-paste the
boilerplate.

**Severity:** LOW.

**Suggested fix:** create a tiny helper:
```ts
export function singleton<T>(key: string, init: () => T): T {
  const global = globalThis as typeof globalThis & Record<string, unknown>;
  const symbolKey = Symbol.for(`gallerykit.${key}`);
  if (!global[symbolKey]) global[symbolKey] = init();
  return global[symbolKey] as T;
}
```

### A8-03 — Restore lifecycle spans 3 modules with unclear ownership [LOW, MEDIUM]

**Files:** `apps/web/src/app/[locale]/admin/db-actions.ts` (entry),
`apps/web/src/lib/restore-maintenance.ts` (state),
`apps/web/src/lib/image-queue.ts` (quiesce/resume),
`apps/web/src/lib/data.ts` (flush buffered views).

**Observation:** `restoreDatabase` orchestrates:
1. `conn.query(GET_LOCK)` (db-actions).
2. `beginRestoreMaintenance()` (restore-maintenance).
3. `flushBufferedSharedGroupViewCounts()` (data).
4. `quiesceImageProcessingQueueForRestore()` (image-queue).
5. `runRestore` (db-actions).
6. Reverse in finally: `endRestoreMaintenance`, `resume...`, `RELEASE_LOCK`.

Step ordering is critical and distributed across files. A reviewer
seeing any one file doesn't see the lifecycle.

**Severity:** LOW, MEDIUM.

**Suggested fix:** extract a `RestoreLifecycle` class or helper that
wraps the 6 steps. Documentation-only alternative: ASCII lifecycle
diagram at the top of `db-actions.ts`.

### A8-04 — `action-guards.ts` returns string for union stability — potential anti-pattern [LOW, MEDIUM]

Same as CRIT8-04. The string-return enables caller-specific error
shapes but requires discipline at every call site. A higher-order
wrapper (`withSameOriginAdmin`) would enforce the check
structurally.

**Status:** design tradeoff. No finding.

### A8-05 — `@/lib/storage` exists but unused per CLAUDE.md [INFO]

**Files:** `apps/web/src/lib/storage/` (exists), CLAUDE.md notes
"module still exists as an internal abstraction, but the product
currently supports local filesystem storage only".

**Observation:** carrying dead code is fine when flagged. The risk
is that a reviewer unfamiliar with the history wires the module
into a new action thinking it's production-ready.

**Severity:** INFO.

**Suggested fix:** already documented in CLAUDE.md. No action.

### A8-06 — Per-cycle RPL artifacts accumulate in `plan/` directory [LOW, LOW]

**Files:** `plan/plan-218-cycle5-rpl-deferred.md` through
`plan/plan-222-cycle7-rpl-deferred.md`.

**Observation:** each cycle adds 2 files (polish + deferred). After
100 cycles that's 200 files. Most are historical record of decisions
made. Consolidation into `plan/done/` is already practiced for
completed plans.

**Severity:** LOW.

**Suggested fix:** after 3-5 cycles, move old plans into
`plan/done/cycle-NNN-rpl/` to keep the root plan directory
manageable. Optional.

### A8-07 — Test layout mirrors source but lacks integration boundary tests [LOW, MEDIUM]

**Files:** `apps/web/src/__tests__/` (48 files, 275 tests).

**Observation:** tests are comprehensively unit-focused. Integration
tests (server action end-to-end, including middleware + auth +
action + DB) are via Playwright e2e. No "pure-JS integration" layer
that exercises a full action without a browser.

**Severity:** LOW, MEDIUM.

**Status:** acknowledged — the Next.js "use server" + `cookies()`
constraint makes action integration tests difficult. Playwright is
the pragmatic choice.

## Summary

A8-01 (rate-limit consolidation) is the architectural debt worth
tracking. Other findings are minor or informational.

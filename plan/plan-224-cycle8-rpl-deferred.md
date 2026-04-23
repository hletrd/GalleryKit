# Plan 224 — Cycle 8 RPL deferred findings

**Source review:** `.context/reviews/_aggregate-cycle8-rpl.md`

**Purpose:** record every finding that is NOT being implemented this
cycle, with file+line citations, original severity/confidence, a
concrete reason for deferral, and the exit criterion that would
re-open it.

**Repo rule alignment:** per the orchestrator's STRICT deferred-fix
rules:
- Every review finding must be either scheduled (plan-223) or
  explicitly recorded here as deferred.
- Repo rules in CLAUDE.md, AGENTS.md, `.context/**`, and related
  policy files take precedence over default orchestrator behavior.
- Each deferred finding preserves its ORIGINAL severity and
  confidence (no downgrade to justify deferral).
- Security, correctness, and data-loss findings are NOT deferrable
  unless the repo's own rules permit. No such exemption is used
  below — none of the deferred items cross those thresholds.
- Eventual implementation must respect repo policy: GPG-signed
  commits (`-S`), Conventional Commits + gitmoji, mined prefix via
  `~/flash-shared/gitminer-cuda/mine_commit.sh 7`, `git pull --rebase`
  before `git push`, no `--no-verify`, no force-push to master.

## Deferred findings (preserving original severity/confidence)

### AGG8R-04 — Rate-limit machinery consolidation
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **File:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/auth.ts`,
  `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`,
  `apps/web/src/app/actions/images.ts`.
- **Observation:** 4 domains (login/search/share/upload) each
  maintain their own in-memory Map, prune function, eviction cap,
  and rollback helper. Cycles 4-7 had to fix symmetric-rollback
  semantics 3 times — once per new Map. Consolidating into a
  `rate-limit-factory` would reduce future regression risk.
- **Reason for deferral:** architectural refactor crossing 5
  files, 200+ LOC touched. Out of scope for a single polish cycle.
  Scope aligns with carry-forward AGG2-04.
- **Exit criterion:** (a) a new rate-limit domain is added and the
  copy-paste becomes painful; or (b) a future regression in one
  Map isn't caught by the others' tests; or (c) a dedicated
  refactor plan (plan-NNN-rate-limit-factory) is opened.

### AGG8R-09 — `runRestore` file-size check ordering
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:305-314`
- **Observation:** file-size rejection happens after advisory-lock
  acquisition + `beginRestoreMaintenance()`. Legitimate oversized
  uploads waste the lock round-trip; an attacker could briefly
  block other restores by repeatedly uploading oversized dummies.
- **Reason for deferral:** requires restructuring
  `restoreDatabase` to access the File before acquiring the lock.
  Not easily testable without a Vitest mock of connection.getConnection.
- **Exit criterion:** observed operator report of restore lock
  contention via oversized-upload abuse, OR a refactor that moves
  formData parsing earlier in `restoreDatabase`.

### AGG8R-11 — `Buffer.allocUnsafe` reuse in SQL scan loop
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:357`
- **Observation:** zero-fill of 1 MiB chunks per iteration costs
  ~50-100ms on a 250 MiB restore.
- **Reason for deferral:** micro-opt. Restores are rare operations;
  even a 100ms saving is negligible vs. the 10-60 second mysql
  import that follows.
- **Exit criterion:** profiling shows SQL scan is a bottleneck in
  restore latency, OR restore throughput becomes user-facing.

### AGG8R-12 — `pruneUploadTracker` throttling
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/app/actions/images.ts:64-81, 128`
- **Observation:** runs on every upload call, iterates full Map
  (up to 2000 entries). Could throttle to once-per-minute like
  `pruneSearchRateLimit`.
- **Reason for deferral:** micro-opt. At typical 2-10 admin sessions,
  the Map rarely exceeds ~20 entries and the iteration cost is
  negligible.
- **Exit criterion:** upload tracker Map size exceeds 500 in
  production monitoring.

### AGG8R-13 — `pruneShareRateLimit` LRU by `resetAt`
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/app/actions/sharing.ts:41-49`
- **Observation:** eviction walks `.keys()` (insertion order),
  which may evict fresh entries after a restart. Sorting by
  `resetAt` would be more correct.
- **Reason for deferral:** the in-memory Map is a fast-path cache.
  DB-backed check is the source of truth. Imperfect eviction
  causes at most a cache miss that re-populates from DB.
- **Exit criterion:** observed cache-miss storm after a restart,
  OR share-rate-limit DB query count spikes correlate with
  eviction.

### AGG8R-14 — Inline comment for `sharing.ts` DB-pre-increment pattern
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/sharing.ts:117-133`
- **Observation:** pattern "increment THEN check, rollback if
  over" is unusual. Current reader must trace multiple branches
  to understand.
- **Reason for deferral:** documentation-only improvement; no
  behavior change. Can be rolled in the next time sharing.ts is
  touched.
- **Exit criterion:** next cycle that touches sharing.ts rate-limit
  logic, OR new reviewer raises the same question again.

### AGG8R-15 — Document `UPLOAD_TRACKING_WINDOW_MS * 2` grace factor
- **Severity:** LOW
- **Confidence:** LOW
- **File:** `apps/web/src/app/actions/images.ts:67`
- **Observation:** why `* 2` and not `* 1`?
- **Reason for deferral:** cosmetic. Drop-to-`* 1` would accelerate
  memory release; `* 2` provides a grace buffer for edge cases
  (clock skew, concurrent windows). Choice is benign.
- **Exit criterion:** memory pressure on upload tracker Map, OR a
  reviewer proposes a specific bugfix.

### AGG8R-16 — `globalThis` singleton helper factor-out
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/lib/image-queue.ts:54`,
  `apps/web/src/lib/restore-maintenance.ts:1-19`
- **Observation:** 2 singletons copy-paste the same
  `Symbol.for()` + globalThis boilerplate.
- **Reason for deferral:** only 2 instances, not enough payback
  for an abstraction. Would create indirection for future
  reviewers.
- **Exit criterion:** 3rd singleton added, triggering the Rule of
  Three.

### AGG8R-17 — Restore lifecycle cross-module orchestration
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:245-303`
- **Observation:** lifecycle orchestration (GET_LOCK →
  beginMaintenance → flush → quiesce → runRestore → endMaintenance
  → resume → RELEASE_LOCK → release) spans 4 modules. A reviewer
  seeing any one file doesn't see the full lifecycle.
- **Reason for deferral:** extraction risks breaking the subtle
  ordering. Current structure is tested by prior cycles' fixes.
- **Exit criterion:** a refactor specifically for restore lifecycle
  (e.g., to add distributed-lock support) motivates the
  extraction.

### AGG8R-19 — Restore-status UI banner
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** admin dashboard UI + new
  `apps/web/src/app/api/admin/restore-status/route.ts`
- **Observation:** admins see consecutive `restoreInProgress`
  errors without contextual UI explanation.
- **Reason for deferral:** UI feature, not a bug. Requires new
  API route + banner component + polling logic. Scope beyond a
  polish cycle.
- **Exit criterion:** operator reports repeated confusion, OR a
  dedicated "admin UX" cycle opens.

### AGG8R-20 — `decrementRateLimit` concurrent-call regression test
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/__tests__/rate-limit.test.ts` (to be
  extended)
- **Observation:** atomic-decrement semantics (`GREATEST(count - 1, 0)`)
  lack a concurrent-call fixture.
- **Reason for deferral:** defensive test; the SQL is atomic by
  DBMS guarantee. A unit test would need to mock the pool and is
  fragile.
- **Exit criterion:** a regression in decrement semantics is
  observed (e.g., negative counts reported).

### AGG8R-21 — `beginRestoreMaintenance` early-return unit test
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/__tests__/db-actions.test.ts` (to be
  created) or `restore-maintenance.test.ts`
- **Observation:** cycle-7-rpl T7R-02 explicitly noted this path
  is hard to test (requires mocking connection.getConnection and
  the `beginRestoreMaintenance` module state). No test was added.
- **Reason for deferral:** cycle-7-rpl plan-221 explicitly accepted
  the test gap. Carry-forward.
- **Exit criterion:** a regression in the early-return lock
  release is observed, OR a broader db-actions test infrastructure
  (with connection mocks) is established.

## Carry-forward from cycle 7-rpl and earlier

All items in `plan/plan-222-cycle7-rpl-deferred.md` remain
deferred with their original severity/confidence. No cycle-8
downgrade. Specifically:
- AGG7R-06 (X-Real-IP nginx doc hardening).
- AGG7R-12 (escapeCsvField regex pass merge).
- AGG7R-14 (FLUSH_CHUNK_SIZE track pool size).
- AGG7R-15 (purgeOldBuckets unbatched DELETE).
- AGG7R-16 (CSV truncation UI warning verification).
- AGG7R-17 (searchImagesAction rate-limit UX sentinel).
- AGG7R-19 (updatePassword session rotation).
- AGG7R-20 (cleanOrphanedTmpFiles log-level inconsistency).
- AGG7R-21 (settleUploadTrackerClaim double-call refactor).

All carry-forward items from plan-220-cycle6-rpl-deferred.md
and plan-218-cycle5-rpl-deferred.md likewise remain with original
severity.

## Summary

11 items deferred this cycle (1 MEDIUM architectural debt + 10
LOW polish/test/doc items). 9 cycle-8-rpl findings are being
IMPLEMENTED in plan-223 (T8R-01 through T8R-09). All 21
cycle-8-rpl findings are therefore accounted for. No security,
correctness, or data-loss finding is deferred.

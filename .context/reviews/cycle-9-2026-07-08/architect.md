# Cycle 9 Architecture Review

Role: architect
Scope: architectural/design risks, coupling, layering, god-objects, process-local
state that breaks under scale-out, module boundaries, abstraction leaks.
Reviewed HEAD: `6efd737b`. No source changes made.

## Method

Read `CLAUDE.md` in full, then examined `lib/data.ts` (1897 lines), `lib/image-queue.ts`
(1345 lines), `lib/process-image.ts` (structure), `lib/storage/{index,types,local}.ts`,
all 13 files under `app/actions/`, `lib/action-result.ts`, `lib/action-guards.ts`,
`lib/single-writer-guard.ts`, `lib/maintenance-scheduler.ts`, `lib/pending-session-revocations.ts`,
`instrumentation.ts`, and the CLIP module split (`lib/clip-{embeddings,inference,model,model-id,paths,embedding-constants}.ts`).
Cross-checked every candidate finding against `.context/reviews/_aggregate.md`, the
current `architect.md` (peer cycle-18 loop), and this loop's own `cycle-1` through
`cycle-8` `architect.md` reports to avoid re-filing tracked items.

**Explicitly excluded (already tracked, do not re-report):** pipeline-version history
duplication in `process-image.ts` (ARCH18-02); unwired `backfillClipEmbeddings` action;
large multipart ingest wanting a streaming route + shared semaphore (AGG-C18-03);
admin nav/table IA (AGG-C18-16/17); `withAdminAuth` usage-mutation-before-gate ordering
(ARCH18-01); image-queue.ts / process-image.ts as an accumulating "god object" trend
(C4-16, reassessed as assess-only in cycle-6, `ARCH8-02` was a now-fixed concrete
symptom of it — verified `quiesceImageProcessingQueueForRestore` resets both
`embeddingScanCursorId` and `embeddingScanModelVersion` at HEAD); `lib/storage/*` as a
zero-consumer internal abstraction (C2-27, confirmed unchanged, an accepted open
product decision, not a new risk); the view-count buffer living inside `data.ts`
(AGG-C10-13, `data.ts` cohesion, already carried as known/peer-dirty); `data-timeline.ts`
manually mirroring `data.ts`'s select-field shape (flagged repeatedly since cycle-1,
still guarded/consistent, not re-filed).

## Findings

### ARCH9-01 — `ActionResult<T>` is a dead shared contract; all 13 action modules hand-roll incompatible result shapes

**Severity:** Low-Medium · **Confidence:** High · **Status:** Confirmed, long-standing

**Citations:**
- `apps/web/src/lib/action-result.ts:1-5` — defines the (only) shared contract:
  `{ success: true; data?: T; message?: string } | { success: false; error: string }`.
- Zero consumers: `grep -rn "ActionResult" apps/web/src` matches only the
  definition file itself. None of the 13 files in `apps/web/src/app/actions/` import it.
- Divergent ad hoc shapes actually in use, sampled:
  - `images.ts:133,137,143` (`deleteImage`) → `{ error: string }` on failure, an
    untyped success object otherwise.
  - `embeddings.ts:55-57` → `export type BackfillEmbeddingsResult = { status: 'ok'; processed; skipped } | { status: 'unauthorized' | 'error'; message }`.
  - `admin-backfill.ts:25-31` → `export interface TriggerBackfillResult { ok: boolean; status; affectedRows?; error? }`.
  - `settings.ts:58,232,267` → `{ success: true as const, settings, ... }`.
  - `public.ts:102,118,123,159,164` → `{ status: 'rateLimited' | 'dbError' | 'ok' | 'invalid' | 'maintenance' | 'error', images, hasMore, ... }`.
  - `sharing.ts:123,163,179` → `{ success: true, key: string }` alongside `{ error }`.

**Why this is a real problem:** the codebase already has a canonical, well-named
"standardized return type for all server actions" — but every action author since
it was added has independently invented a shape (`error`-only, `success + data`,
`status` enum with different literal sets per file, `ok + status + error`). This is
long-standing, not new: an earlier review round flagged the identical dead-type
problem (archived as `TD-07` / "Finding 5" in `.context/reviews/archive/architecture-review.md`)
when the repo had 7 action modules; it was never adopted or removed, and the repo
now has 13. Each new action file is a fresh opportunity to invent yet another shape,
and every client component that calls a server action must know that specific
action's ad hoc discriminant (`'success' in result` vs `result.status === 'ok'` vs
`result.ok`) rather than a single narrowing pattern reusable across the app.

**Concrete future-failure scenario:** a developer wires a new admin UI panel to two
existing actions that both "fail" but with different shapes (one returns
`{ error }`, the other `{ status: 'error', message }`); a copy-pasted error-check
(`if (result.error)`) silently passes through the second action's failure with no
compile error, because TypeScript has no shared discriminant to check against. The
failure is swallowed at the UI layer with no user-visible error state — a class of
bug this exact abstraction was built to prevent.

**Suggested direction:** make an explicit decision rather than let the drift
continue. Either (a) delete `action-result.ts` as aspirational dead code and instead
document/lint the `status`-discriminant convention that most newer files (`public.ts`,
`embeddings.ts`, `admin-backfill.ts`) have converged on independently, or (b) adopt
`ActionResult<T>` (or a `status`-based evolution of it) as the actual contract and
migrate the 13 files incrementally, starting with the ones with the simplest
success/error shape (`images.ts:deleteImage`, `sharing.ts`). Either path removes the
misleading signal of a "canonical" type that nothing follows.

**Priority:** deferrable design debt — no live bug, but it has now silently
persisted across a full architecture-review era of this repo without a decision
either way; worth a single explicit adopt-or-delete call rather than further deferral.

---

### ARCH9-02 — The `globalThis + Symbol.for('gallerykit.*')` module-reinstantiation guard is applied inconsistently, including to security-relevant state

**Severity:** Low · **Confidence:** Medium-High · **Status:** Confirmed, new angle

**Citations:**
- Modules that deliberately use the pattern (verified via
  `grep -rl "Symbol.for('gallerykit" apps/web/src/lib`): `admin-backfill-runner.ts`,
  `admin-mutation-barrier.ts`, `image-queue.ts:100`, `restore-maintenance.ts`,
  `storage/index.ts:23`, `upload-tracker-state.ts`. `image-queue.ts:379-411` shows the
  most defensive version — it validates the *shape* of the existing global (not just
  key presence) before trusting it, specifically because a malformed or
  differently-shaped global left over from a prior module instantiation is an
  anticipated failure mode this codebase already designs against.
- Modules with equally stateful process-local data that do **not** use the pattern
  (plain top-level `let`/`const`): `apps/web/src/lib/pending-session-revocations.ts:26`
  (`const pending = new Set<string>()`), and the view-count buffer subsystem in
  `apps/web/src/lib/data.ts:18-41` (`let viewCountBuffer`, `viewCountRetryCount`,
  `consecutiveFlushFailures`, etc.).
- `pending-session-revocations.ts:17-21` explicitly documents an *accepted* risk for
  the crash-between-skip-and-flush case ("the queue is process-local... a crash...
  loses the pending revocation"), but does not address — and does not use the
  sibling-module pattern that exists precisely to address — a *different*, narrower
  risk: this module's top-level `Set` can be silently reset to empty by whatever
  module-reinstantiation event (dev-mode Fast Refresh / duplicate module graph
  loading) motivated the guard in its six sibling files.

**Why this is a real problem:** this is not a case of nobody having thought about
the hazard — the codebase has a working, documented, three-line-cost pattern for
exactly this class of problem, applied carefully and consistently to six modules
that hold in-memory coordination state (restore fencing, the mutation barrier,
upload quota, the processing queue, the storage-backend singleton). But there is no
written rule anywhere (not in `CLAUDE.md`, not as a code comment convention) for
*which* process-local state modules need it. The two modules skipped are not
obviously less important than the six that have it: `pending-session-revocations.ts`
holds a queue of skipped session-token deletes — a security-relevant, restore-window
coupled state, structurally the same shape of problem
(process-local, coordination-critical, single-writer-topology-scoped) as
`admin-mutation-barrier.ts`, which *does* get the guard.

**Concrete future-failure scenario:** a future refactor or a dev-mode Fast Refresh
edit to an unrelated file in the same module graph causes
`pending-session-revocations.ts` to be re-evaluated, silently resetting `pending` to
a fresh empty `Set`. Any session-token deletes queued during an in-progress restore
window at that moment are lost with no error, no log line distinguishing it from a
normal empty-queue state, and no test can catch it because the loss is
timing-dependent on module graph re-evaluation, not on any code path the existing
test suite exercises (`_clearPendingSessionRevocationsForTest` is an intentional,
different reset). This is a dev-mode-scoped risk today (Next.js standalone
production output does not re-instantiate modules the way dev-mode Fast Refresh
does), but the module comment gives no indication that this particular residual
risk was considered and accepted versus simply missed — unlike the crash-loss case,
which the same comment block explicitly reasons about.

**Suggested direction:** either (a) apply the same `globalThis + Symbol.for` guard
to `pending-session-revocations.ts` for consistency (cheap, ~5 lines), or (b) if the
maintainers judge session-revocation state doesn't need it (e.g., because
`instrumentation.ts` and route handlers never trigger the reinstantiation path in
practice), add one sentence to the module's existing risk-acceptance comment saying
so explicitly, and add a one-line note to `CLAUDE.md`'s "Race Condition Protections"
section stating the actual rule for when a new piece of process-local state needs
the `globalThis` guard — so the next contributor adding process-local state doesn't
have to reverse-engineer the convention from six existing examples.

**Priority:** deferrable design debt — low real-world blast radius (dev-mode only,
bounded further by the existing `MAX_PENDING_REVOCATIONS` cap and the hourly
maintenance-sweep backstop), but cheap to close and worth closing so the convention
doesn't silently erode as more process-local state modules are added.

---

### ARCH9-03 — The admin restore-mutation-fence convention (`acquireAdminMutationSlot`) has no automated regression guard, unlike its sibling same-origin check

**Severity:** Medium · **Confidence:** High · **Status:** Confirmed, new angle

**Citations:**
- `CLAUDE.md`'s "Race Condition Protections" section documents that "every mutating
  admin server action holds a shared process-local barrier slot for its WHOLE body"
  (`using mutationSlot = acquireAdminMutationSlot()`) as closing `C1-03`/`C77-ARCH-01`
  — a real correctness contract: without it, a mutation admitted a moment before a
  DB restore's maintenance marker flips could commit into the freshly restored
  database.
- `apps/web/scripts/check-action-origin.ts` (1463 lines) is a mature, fixture-tested
  scanner (`apps/web/src/__tests__/check-action-origin.test.ts`) that walks every
  exported async mutating function under `app/actions/` and fails CI if
  `requireSameOriginAdmin()` is missing (see e.g. the `MISSING requireSameOriginAdmin`
  diagnostic at `check-action-origin.ts:1323`). Searching that same file for any
  reference to `acquireAdminMutationSlot` or `MutationBarrier` returns nothing — the
  scanner has no equivalent rule for the mutation barrier.
- `grep -c acquireAdminMutationSlot apps/web/src/app/actions/*.ts` → present in
  12 of 13 files; the one omission (`public.ts`) is legitimate (those actions are
  the intentionally-anonymous public search/load-more surface, not admin mutations),
  so the convention is in fact universally followed today — but only because every
  contributor so far remembered to add it by hand, not because anything would catch
  a future omission.
- The existing tests that reference the barrier (`admin-mutation-barrier.test.ts`,
  `auth-mutation-barrier-source.test.ts`, `admin-backfill-status-shape.test.ts`,
  `admin-tokens.test.ts`, `auth-actions-behavior.test.ts`) each test the barrier's
  own acquire/release semantics or a specific call site, not a repo-wide invariant
  ("every mutating admin action export calls this") the way `check-action-origin.ts`
  does for the same-origin check.

**Why this is a real problem:** two defense-in-depth protections for the same class
of mutating admin actions were built with the same intent (both close a
`same-code-path` class of vulnerability window — one for CSRF-style provenance, one
for restore-window write races) and both are documented in `CLAUDE.md` as universal
requirements on every mutating action export. Only one of the two has a scanner that
turns "a contributor forgot" into a CI failure at commit time; the other depends
entirely on manual code review holding the line, cycle after cycle, forever.

**Concrete future-failure scenario:** a future contributor adds a 14th action file
(or a new mutating export to an existing one) with `requireSameOriginAdmin()`
copy-pasted correctly (satisfying the origin scanner) but omits
`acquireAdminMutationSlot()` — plausible precisely because the barrier line looks
like unremarkable boilerplate next to the auth checks, and nothing in `npm run lint`,
`npm run typecheck`, or CI flags the omission. The gap is invisible until an
operator runs a DB restore while that specific action is in flight, at which point
the restore's `drainAdminMutationSlots` phase does not see this in-flight mutation
because it never acquired a slot, and the write can land in the newly-restored
database — reopening exactly the `C77-ARCH-01` window `CLAUDE.md` documents as
closed.

**Suggested direction:** extend `check-action-origin.ts` (or add a narrow sibling
scanner) with the same AST-walk shape it already uses for
`requireSameOriginAdmin()`, requiring every exported async mutating function under
`app/actions/` (and `app/[locale]/admin/db-actions.ts`) to also acquire the mutation
slot, or carry an equivalent explicit exemption comment for the rare legitimately-exempt
case (mirroring the existing `@action-origin-exempt` convention). Given the scanner
already parses and classifies every action export for the origin check, the
marginal cost of also checking for the barrier call in the same pass is small
relative to standing up a new tool.

**Priority:** worth doing now — this closes the gap between a documented universal
security/correctness invariant and its actual enforcement, using an existing,
proven scanner as the vehicle, for a correctness contract CLAUDE.md already treats
as load-bearing (`C77-ARCH-01`).

## Summary

3 findings filed (ARCH9-01, ARCH9-02, ARCH9-03), all newly angled versus prior
cycles' tracked items. Top 3, in priority order:

1. **ARCH9-03** (Medium/High confidence) — the admin-mutation-barrier convention
   that fences restore-window write races has no automated scanner, unlike its
   sibling same-origin check which does. Worth closing now with a small extension
   to the existing `check-action-origin.ts` scanner.
2. **ARCH9-01** (Low-Medium/High confidence) — `ActionResult<T>` has been dead,
   unadopted code since at least an early architecture-review round (archived as
   `TD-07`); 13 action files now each hand-roll incompatible result shapes with no
   shared contract. Needs an explicit adopt-or-delete decision.
3. **ARCH9-02** (Low/Medium-High confidence) — the `globalThis + Symbol.for`
   process-local-state reinstantiation guard, applied carefully to six modules, is
   silently absent from `pending-session-revocations.ts` (security-relevant state)
   with no documented rule for when it's required.

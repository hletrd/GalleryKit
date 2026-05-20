# Photographer R29 — Cycle 5 RPF Loop New-Surface Audit

Date: 2026-05-20
Scope: NEW surfaces introduced by cycles 1-4 (R27 + R28). Focus = subtle bugs the previous cycles' patches could have introduced, NOT new feature scope.

The R27 + R28 backlog (23 items) is closed. This audit specifically targeted:
- `apps/web/src/app/actions/admin-backfill.ts` (R27-UX-HIGH-1)
- `apps/web/src/lib/admin-backfill-runner.ts` (R27-UX-HIGH-1)
- `apps/web/src/lib/analytics-data.ts` `getTopSharedGroupsByViews` (R27-UX-MED-4)
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` backfill UI (R27-UX-HIGH-1 Path A)
- `apps/web/src/components/histogram.tsx` `forceShowColorChips` DOM read (R28 / earlier P3-26)

## Findings

### R29-CRIT-1 — admin-backfill-runner.ts: `runBackfill` leaks lock + connection + in-process state on early throw (HIGH confidence)

**File:** `apps/web/src/lib/admin-backfill-runner.ts` lines 266-322

**Symptom:** `runBackfill` mutates `state.running = true` at lines 268-270 BEFORE the try/catch/finally block at line 310. The `await getGalleryConfig()` call at line 271 is OUTSIDE the try. If that promise rejects (DB blip, malformed `admin_settings` row, restore-maintenance-flag race, transient connection-pool exhaustion), the runner promise rejects synchronously to the `void runBackfill(...)` fire-and-forget at line 359 in `triggerAdminBackfill`. Because the caller uses `void` with no `.catch()`, this becomes an unhandledRejection.

The damage is silent and persistent:
1. `state.running` stays `true` forever — every subsequent `triggerAdminBackfill()` returns `{ status: 'already_running' }` until process restart.
2. The MySQL advisory lock `gallerykit_color_pipeline_backfill` is held by `lockConn` and never released until the connection is destroyed.
3. `lockConn` itself is never returned to the pool — one connection of the 10-connection pool is permanently leaked.
4. `state.lastError` is never set (the `catch` at line 314 never executes), so the admin status surface reports `lastError: null` while nothing works.
5. Under Node 24, unhandledRejection is configured to terminate the process by default since Node 15; the deploy runs with Next.js's runtime which may swallow it, but it's still a regression footgun for any future process-manager change.

The comment at lines 356-358 is FACTUALLY WRONG: the finally-block-guarantee claim presumes the try block has been entered. It hasn't.

**Repro recipe (test):**
```ts
// mock getGalleryConfig to throw
vi.mocked(getGalleryConfig).mockRejectedValueOnce(new Error('admin_settings table missing'));
// call triggerAdminBackfill with candidates > 0
const r1 = await triggerAdminBackfill();
expect(r1.status).toBe('queued');
// wait a tick for fire-and-forget to reject
await new Promise((r) => setImmediate(r));
// now state.running is stuck at true
const r2 = await triggerAdminBackfill();
expect(r2.status).toBe('already_running'); // BUG — should be 'queued' or 'error'
```

**Fix:** Move the state mutation INTO the try block and wrap the entire body so the finally clause always runs:

```ts
async function runBackfill(lockConn: PoolConnection, candidates: CandidateRow[]): Promise<void> {
    const state = getState();
    try {
        state.running = true;
        state.lastQueuedCount = candidates.length;
        state.lastError = null;
        const config = await getGalleryConfig();
        const settings: RunnerSettings = { /* ... */ };
        // queue setup
        // ...
        await queue.onIdle();
        state.completedRuns++;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.lastError = msg;
        console.error('[admin-backfill] Run aborted:', err);
    } finally {
        state.running = false;
        await releaseBackfillLock(lockConn);
    }
}
```

Also add a `.catch()` on the `void runBackfill(...)` invocation at the trigger site for defense-in-depth — even if `runBackfill` somehow throws synchronously before the try block, the caller's catch should not propagate to an unhandledRejection.

**Severity:** CRITICAL. Data-integrity-adjacent (locks + connection-pool exhaustion + silent fail of the photographer-visible "Re-encode existing photos" button).

Confidence: H.

---

### R29-MED-1 — histogram.tsx: `forceShowColorChips` is read non-reactively from the DOM at canvas build time (MEDIUM confidence)

**File:** `apps/web/src/components/histogram.tsx` lines 215-218

The histogram reads `document.documentElement.getAttribute('data-force-show-color-chips')` directly inside the render path (canvas context creation). React has no idea this DOM attribute changed when the admin toggles the setting; the histogram will keep using the old `supportsP3` decision until the component remounts (photo navigation, viewer close/open).

This is acceptable for the demo-mode use case (the admin toggles the setting once, then navigates), but it means a same-page toggle has zero visible effect on histogram channel selection (P3 canvas vs sRGB canvas) until the next photo.

**Fix options:**
- Document the remount-required behavior in a code comment (minimal).
- Subscribe to a `MutationObserver` for `data-force-show-color-chips` on `<html>` and trigger a re-render — overkill for a demo toggle.

Recommended: comment + assertion in test. Confidence: M.

---

### R29-LOW-1 — admin-backfill: `getBackfillStatus` exempt comment is correct but undocumented (LOW)

**File:** `apps/web/src/app/actions/admin-backfill.ts` lines 64-83

The `@action-origin-exempt: read-only status check` comment is the right form for the action-origin lint, but the function still calls `await isAdmin()` which performs a DB read of the session. That's the intent (read-only auth check) and the lint scanner accepts it. No change required; flagged for traceability.

Confidence: H. No-op.

---

### R29-LOW-2 — analytics-data.ts: `getTopSharedGroupsByViews` silently drops orphan views from deleted shared groups (LOW)

**File:** `apps/web/src/lib/analytics-data.ts` lines 142-167

The INNER JOIN on `sharedGroups.id` drops view rows whose group has been deleted. This is intended (admin can't deep-link to a deleted group), but `shared_group_views` rows are NOT cleaned up when the group is deleted (verified by reading `sharedGroups` deletion path elsewhere). Over time the orphan rows accumulate and skew the totals only via their absence; the user-facing impact is zero, but the disk usage grows.

Confidence: M. Out of scope for cycle 5 (not a regression introduced by R27, just a long-standing storage hygiene gap). Deferred to a future analytics-retention track.

---

## Summary

| Severity | Finding | Action |
|----------|---------|--------|
| CRIT | R29-CRIT-1 (lock+conn+state leak on early throw) | FIX in cycle 5 |
| MED  | R29-MED-1 (histogram non-reactive force-show read) | DOC + test in cycle 5 |
| LOW  | R29-LOW-1 (read-only exempt comment) | NOOP |
| LOW  | R29-LOW-2 (orphan shared_group_views accumulation) | DEFER |

NEW_FINDINGS: 2 actionable (R29-CRIT-1, R29-MED-1).

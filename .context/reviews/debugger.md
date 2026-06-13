# Debugger Review — GalleryKit (run-6 cycle-1)

**Scope:** Latent bug surface — failure modes, regressions, edge cases that throw/crash/corrupt, races. Empirically reasoned; key findings traced to exact code paths or proven by arithmetic.

**Gate baseline AT HEAD (live-verified this pass):**
- ESLint: **exit 0** (`npm run lint --workspace=apps/web`) — the prior aggregate's AGG-2 `react-hooks/set-state-in-effect` error at `settings-client.tsx:88` is **fixed** (effect now uses a `let cancelled` guard, lines 91-105). Not re-reported as live.
- Typecheck: **exit 0** (`npm run typecheck --workspace=apps/web`, both `typecheck:app` + `typecheck:scripts`).

---

## Findings by severity

| Severity | Count |
|---|---|
| HIGH | 0 |
| MEDIUM | 1 |
| LOW | 2 |
| Verified-clean (claimed-fixed items confirmed) | 7 |

| ID | Severity | File:line | Symptom | Confidence |
|---|---|---|---|---|
| BUG-1 | **MEDIUM** | `settings-client.tsx:142-143` | Two post-trigger `setTimeout` polls (`refreshBackfillStatus` @ +3s/+10s) have NO unmount guard and NO `clearTimeout` cleanup → `setBackfillStatus` fires on an unmounted component if admin leaves Settings within ~10s. **AGG-15 was claimed "folds into AGG-2 fix" but the timer-cleanup half was never implemented.** | **High** (proven by code path) |
| BUG-2 | LOW | `load-more.tsx:47-86` | In-flight `loadMoreImages()` resolving after unmount calls `setHasMore`/`setLoading`/`onLoadMore` — `queryVersionRef` guards stale *queries* but not unmount; observer disconnect prevents NEW loads only. | High |
| BUG-3 | LOW | `image-queue.ts` claim-retry / `admin-backfill-runner.ts` cross-path | Under sustained pool exhaustion the backfill silently re-skips the same rows every batch (`locked` skips are not counted as failures), so a 0-forward-progress run reads as "clean." Observability edge, not a crash. | Medium |

---

## BUG-1 (MEDIUM · High confidence) — settings-client backfill poll timers leak past unmount

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-143`

**The exact path:**
```ts
const refreshBackfillStatus = useCallback(async () => {     // lines 82-90
    if (!hasExistingImages) return;
    try {
        const s = await getBackfillStatus();
        if (s.ok) setBackfillStatus(s);                     // <-- NO mounted guard
    } catch { /* ... */ }
}, [hasExistingImages]);

const handleBackfill = () => {
    startBackfillTransition(async () => {
        const result = await triggerBackfill();
        if (result.ok && result.status === 'queued') {
            // ...
            void refreshBackfillStatus();                   // immediate — fine
            setTimeout(() => void refreshBackfillStatus(), 3000);    // line 142
            setTimeout(() => void refreshBackfillStatus(), 10000);   // line 143
        }
        // ...
    });
};
```

**Trigger:** Admin clicks "Re-encode existing photos" → `result.status === 'queued'` → two `setTimeout`s are scheduled. Admin navigates away from `/admin/settings` (back button, dashboard link, any route change) within 10s. At +3s and +10s the timers fire `refreshBackfillStatus()`, which awaits `getBackfillStatus()` and calls `setBackfillStatus(s)` on the now-unmounted `SettingsClient`.

**Why the existing guards don't cover it:** The mount effect (lines 91-105) has a `let cancelled` flag, but that flag is scoped to the EFFECT — it governs only the on-mount fetch. The two timers are created inside the click handler (`handleBackfill`), are never stored in a ref, and are never returned for cleanup. `refreshBackfillStatus` itself is deliberately guard-free ("event-handler context, so a direct setState is fine here" — comment at lines 78-81), but the `setTimeout` wrapping turns it into a deferred call that outlives the handler's synchronous context and can outlive the component.

**Observable symptom:** React 19 logs a state-update-on-unmounted path — a wasted render plus a stale server round-trip (`getBackfillStatus` → `isAdmin` + a DB COUNT) fired after the user already left the page. It targets the dead fiber, so it is a benign-but-real leak + dev noise rather than corruption. It is precisely the failure mode AGG-15 enumerated.

**Proof AGG-15 is NOT closed:** `.context/reviews/_aggregate.md:117` states the fix must "also collect the timeout ids and `clearTimeout` them in cleanup." The committed code at 142-143 does neither. The AGG-2 rewrite fixed only the mount effect's lint error; the timer-cleanup half of AGG-15 was dropped.

**Fix (minimal):** add a mounted ref and clear the timers on unmount:
```ts
const isMountedRef = useRef(true);
useEffect(() => () => { isMountedRef.current = false; }, []);
// in refreshBackfillStatus: if (isMountedRef.current && s.ok) setBackfillStatus(s);
// in handleBackfill: push the two ids into a timersRef array; add
//   useEffect(() => () => timersRef.current.forEach(clearTimeout), []);
```
Either guard (mounted-ref on the setState) or cleanup (clearTimeout) closes it; doing both matches the AGG-15 prescription.

**Verification:** mount SettingsClient, trigger backfill, unmount within 10s, assert no `setBackfillStatus` call after unmount (or assert both timers cleared).

---

## BUG-2 (LOW · High confidence) — load-more setState after unmount on in-flight fetch

**File:** `apps/web/src/components/load-more.tsx:36-88`

**Path:** `loadMore()` awaits `loadMoreImages(...)` (lines 44-45). On resolve it calls `setHasMore`/`onLoadMore`/`setOffset`/`setCursor`/`setLoading`. The `queryVersionRef` check (line 46, 83) guards against a *query-key change* mid-flight, and the unmount effect (line 124) disconnects the observer so no NEW intersection fires — but an already-in-flight request that resolves after the component unmounts still runs the setState block (the version is unchanged, so the guard passes).

**Symptom:** Same class as BUG-1 — setState on a dead fiber. Lower severity: it can only happen for the single request in flight at unmount, and the `onLoadMore` callback is owned by the parent (which is also unmounting), so practical impact is a dev warning, not corruption.

**Why LOW not the regression:** Long-standing pattern, not introduced by the working-tree changes. Fix is the same mounted-ref guard if the team wants symmetry with BUG-1.

---

## BUG-3 (LOW · Medium confidence) — pool-exhaustion skip churn (cross-path, not a crash)

**Files:** `image-queue.ts` (`enqueueImageProcessing` claim path, lines ~256-280) + `admin-backfill-runner.ts:421-430`.

Under sustained DB pool exhaustion: `acquireImageProcessingClaim` returns `null` (or throws → caught) on both paths. The queue escalates a claim-retry timer (bounded MAX_CLAIM_RETRIES=10, then `scheduleBootstrapRetry`), and the backfill counts a `locked` skip with NO version bump — so every backfill batch re-reads the same stale rows (`fetchCandidateBatch` is non-snapshot, by design) and re-skips them. This is correct-by-design degradation (documented "retry next run"), but a pathologically saturated pool means a backfill can spin its full keyset walk producing only `skippedLocked` with zero forward progress, and the admin status surfaces `lastRunHadFailures=false` (skips are not failures) — so a 0-progress run reads as "clean." Not a throw/corruption; an observability gap under an extreme condition. No fix required this cycle; flag for the verifier.

---

## Verified-CLEAN (items specifically examined and proven safe)

### `resolveBackfillConcurrency` (working-tree AGG-5 change) — `admin-backfill-runner.ts:124-137` — CLEAN
Traced the full arithmetic for pathological inputs. Never returns 0, negative, or NaN:
- `poolLimit=0` → limit 0, reserved max(3,0)=3, cap max(1, floor(-2))=**1**
- `poolLimit=1/2` → reserved 3, cap **1**
- `poolLimit=NaN` / `Infinity` → `Number.isFinite` false → limit=10 → cap **2**
- `poolLimit=-5` → reserved max(3,-2)=3, cap max(1,floor(-4.5))=**1**
- `requested=NaN` → `Math.floor(NaN)=NaN`; `NaN || 1 = 1` → req **1**
- `requested=0` → `0 || 1 = 1` → req **1**
- `requested=-3` → `-3 || 1 = -3` (truthy); `Math.max(1,-3)=1` → req **1**
- `requested=Infinity` → req Infinity; `min(Infinity, cap)=cap` (finite)

`Math.max(1, ...)` on the cap and `Math.max(1, Math.floor(requested) || 1)` on the request are both correct floors. The `NaN`-freeze hazard the comment warns about is fully mitigated by the `Number.isFinite` fallback. The runner-side warning condition at line 585 (`concurrency < Math.max(1, Math.floor(requestedConcurrency) || 1)`) is also NaN-safe (env-unset → `Number('') || 1 = 1`, `1 < 1` false, no spurious warning). The updated test file matches every traced value. **No bug.**

### `bulkUpdateImages` TriState payload (AGG-8) — `images.ts:907-918` — CLEAN
The `isTriState` type guard (lines 907-913) validates SHAPE before any `.mode` read: rejects non-object/null, requires `mode ∈ {leave,clear,set}`, and for `set` requires `typeof value === 'string'`. The guard runs (line 914) BEFORE the first `topic.mode === 'set'` dereference (line 920). A malformed Server-Action payload (missing field, non-object, `set` without string value) now returns a clean localized `invalidInput` error instead of throwing an unhandled `TypeError` → framework 500. `addTagNames`/`removeTagNames` are also array-guarded (lines 890-895). **AGG-8 closed.**

### `useDisplayCapability` getSnapshot stable-reference (React #185) — `use-display-capability.ts:47-82` — CLEAN
`detect()` memoizes by VALUE: `_cachedSnapshot` is returned by reference when `colorGamut` AND `isHdr` both match the prior snapshot (lines 73-79). A fresh object is allocated only when the underlying MQ/feature-probe state actually flips. `useSyncExternalStore`'s `Object.is(prev,next)` therefore sees a stable reference across renders → no infinite loop. The `subscribe` callback (lines 84-113) cleans up every MQ listener + the focus/visibility fallbacks. The contract cannot regress without changing `detect()`'s caching block. **No bug.**

### `serve-upload.ts` — CLEAN
TOCTOU closed (streams from `realpath`-resolved path, lines 171-251); stream `destroy()` on error (line 261); ENOENT→404 (line 263); `getServingColorSettingsHash` async body never rejects (both branches return a value, lines 60-73) so the un-awaited inflight promise can't produce an unhandledRejection. `pathSegments[length-1]` safe under the `length >= 2` guard. **No bug.**

### Component effect cleanup sweep — CLEAN
`photo-viewer.tsx` (fallbackTimer line 167-168 cleared; idle-prefetch lines 274-296 cancel every scheduled fn; `cancelled` guard lines 318-362; MQ removeEventListener lines 408-409), `histogram.tsx` (worker terminate lines 528-531; AbortController + img.onload/onerror null + img.src='' lines 570-576), `home-client.tsx` (rafId cancel + clearTimeout + removeEventListener lines 48-58, 158-162, 184), `lightbox.tsx` and `info-bottom-sheet.tsx` (every addEventListener/setTimeout/setInterval has a matching cleanup) — all meticulously managed. **No leaks found.**

### `admin/(protected)/error.tsx` (working-tree AGG-9 change) — CLEAN
The `aria-labelledby="admin-route-error-title"` linkage is preserved: the decorative glyph became an `aria-hidden` span, and a `sr-only <h1 id="admin-route-error-title">` carries the real accessible name (lines 29-30). No dangling reference, no double-announce. **No bug.**

### `auth-rate-limit.ts` — CLEAN
All `getXEntry`/`recordFailedLoginAttempt`/`rollback*` mutate the shared entry object within a single synchronous function body (no `await` between read and write of `count`/`lastAttempt`), so under Node's single-threaded loop the read-modify-write is atomic. The documented `recordFailedLoginAttempt` ordering (in-memory bump, then `await incrementRateLimit`) is a deliberate fast-path design, not a new race. **No bug.**

---

## Final sweep notes
- `triggerAdminBackfill` lock/state lifecycle (`admin-backfill-runner.ts:710-771`): `running` flag and advisory lock are released in the runner's single `finally` (lines 710-713); the fire-and-forget `.catch()` (lines 760-762) absorbs a synchronous pre-try throw. `state.running` is set true inside the try (line 550) only after the lock is held — no orphaned-flag window. CLEAN.
- `triggerBackfill`/`getBackfillStatus` actions (`admin-backfill.ts`): proper auth gates, `.catch()` on audit + getCurrentUser, try/catch on the status read returning a typed error shape. CLEAN.
- No NaN-propagation, off-by-one, or integer-coercion bugs found in the traced server paths.
- The only working-tree-introduced concern is the residual half of AGG-15 (BUG-1); the other working-tree diffs (AGG-1/AGG-5/AGG-9, SW stamp `8b979687-p7`, test updates) are correct.

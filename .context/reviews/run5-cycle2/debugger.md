# Debugger Review — Run-5 Cycle 2

**Reviewer lane:** oh-my-claudecode:debugger
**Diff base:** b7d4729b..HEAD (20 commits, run-5 cycle-1 changes)
**Date:** 2026-06-12
**Suppression applied:** plan-315 (BUG-R5C1-01/03/04/05 already planned), plan-316, plan-317

---

## Executive Summary

| Severity | Count |
|---|---|
| HIGH | 3 |
| MED | 3 |
| LOW | 2 |

**CRIT: 0** — No new critical bugs found in the diff.

**HIGH findings:**
- BUG-R5C2-01: Backfill batching test mock is a false positive — UPDATE calls contaminate the SELECT batch counter, tests (b) and (c) pass for wrong reasons
- BUG-R5C2-02: Stale docblock in semantic route contradicts actual gate logic and misleads future developers
- BUG-R5C2-03: settings-client renders `'production'` warning branch that can never fire (dead UI + stale `'production'` type threading)

**MED findings:**
- BUG-R5C2-04: Backfill test uses wall-clock `setTimeout(500)` for fire-and-forget assertions — inherently flaky under CI load
- BUG-R5C2-05: image-queue embedding hook runs in stub mode (`semanticMode !== 'disabled'` allows `'stub'` through) — random embeddings stored silently
- BUG-R5C2-06: `retryFailedImage` wraps `originError` in an extra `{ error: }` object that callers may not expect

---

## Findings

### BUG-R5C2-01 — Backfill batching tests pass for wrong reasons (false-positive test)

**File:** `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:130-242`
**Severity:** HIGH
**Confidence:** High
**Classification:** confirmed

**Mechanism:**
`buildExecuteMock` and the test-(c) mock both use a shared `batchIndex` counter to distinguish batch SELECT queries from row-UPDATE queries. The assumption (documented in the comment at line 144-151) is that `runBackfill` issues SELECT queries before UPDATE queries for each batch, i.e. they do not interleave. That assumption IS correct in the production code (`await queue.onIdle()` drains all jobs before the next `fetchCandidateBatch`).

However, the mock cannot distinguish the call types. The decision is `batchStart = batchIndex * BATCH_SIZE < allRows.length` — if true it is treated as a SELECT and advances `batchIndex`. For the 150-row test (b):

```
call #0  → COUNT query (callIndex=0 branch)
call #1  → SELECT batch 1 (rows 1-100), batchIndex=1
calls #2-#101 → 100 UPDATE calls from reprocessOne inside queue.onIdle()
  call #2: batchStart = 1*100=100 < 150 → mock RETURNS rows 101-150 as if it were batch 2!
            batchSizes.push(50); batchIndex++ → 2
  call #3: batchStart = 2*100=200 >= 150 → returns []
  calls #4-#101: same → []
call #102 → fetchCandidateBatch(cursor=100) in the real loop:
            batchStart = 2*100=200 >= 150 → returns [] → loop exits!
```

The second element of `batchSizes` (`50`) came from the FIRST `reprocessOne` UPDATE call, not from the real `fetchCandidateBatch(100)`. The real second batch fetch returns `[]` and terminates the loop, meaning rows 101-150 are NEVER enqueued. The test assertions (`batchSizes.toHaveLength(2)`, `batchSizes[0]=100`, `batchSizes[1]=50`) happen to pass because the contaminating UPDATE call produced the same shape as the expected batch.

Test (c) has the same flaw: the second `returnedBatches` entry comes from a reprocessOne UPDATE call, not from the real `fetchCandidateBatch(100)`. The cursor-advance assertion passes because the contaminating call returned rows 101-110, satisfying `minIdBatch2 > maxIdBatch1`.

**Consequence:** A regression in `runBackfill` that prevents batch 2 from being fetched would still pass these tests. The tests do not cover the claimed behavior.

**Reproduction:** Run the tests — they pass today. Introduce a bug in the loop continuation check (e.g. always break after batch 1) — the tests still pass.

**Fix:** The mock must distinguish SELECT from UPDATE by a mechanism that cannot be confused by interleaving. Two options:
1. SQL-content inspection: expose the sql template's `queryChunks` array from drizzle `sql` and match on a keyword (e.g. `'LIMIT'` only appears in SELECT, `'SET'` only in UPDATE).
2. Separate mocks per call type: use `mockImplementationOnce` for the COUNT, `mockImplementationOnce` for each expected SELECT batch, and a default `mockResolvedValue([[]])` for UPDATE calls. This is more brittle but avoids the counter confusion.

Option 2 example for test (b):
```ts
executeMock
  .mockResolvedValueOnce([[{ cnt: 150 }]])   // COUNT
  .mockResolvedValueOnce([batch1])            // batch 1
  .mockResolvedValue([[]])                    // all UPDATEs + batch 2 probe after sentinel
// capture real batch 2 fetch separately via a spy or by restoring mock after onIdle
```

**Similar patterns:** Test (c) at line 204-242 has the same structural flaw with a separate `batchIndex` counter.

---

### BUG-R5C2-02 — Stale/contradictory docblock in semantic route

**File:** `apps/web/src/app/api/search/semantic/route.ts:17-19`
**Severity:** HIGH
**Confidence:** High
**Classification:** confirmed

**Mechanism:**
The file-level docblock reads:
```
* WARNING: The stub encoder returns RANDOM results. Do NOT enable
* semantic_search_mode in production until the stub is replaced with real ONNX
* inference. This endpoint rejects requests when mode is not 'production'.
```

Line 19 says the endpoint "rejects requests when mode is not `'production'`". After this diff, line 188 reads:
```ts
if (semanticMode !== 'stub') {
```

The endpoint now **rejects** requests when mode is NOT `'stub'` — the exact opposite of what the docblock says. A future developer reading the docblock would believe:
- The endpoint is currently unreachable (no one can set `'production'` now that the validator rejects it)
- Enabling search requires setting mode to `'production'`

Both conclusions are wrong. The actual behavior is:
- Set mode to `'stub'` → endpoint serves random results
- Set mode to `'production'` → validator rejects storage (`gallery-config-shared.ts:171`), DB read falls back to `'disabled'`, endpoint returns 503
- Set mode to `'disabled'` → endpoint returns 503

Additionally, the WARNING "Do NOT enable … in production" is contradicted by the fact that `'stub'` mode is now enabled and served. The warning should either be updated to say stub mode is available (with caveats about random results) or the endpoint should remain disabled until real inference ships.

**Reproduction:** Admin sets `semantic_search_mode = 'stub'` in settings UI → search endpoint serves random CLIP similarity scores to users. Docblock says this should not happen.

**Fix:** Update the docblock:
- Remove "rejects requests when mode is not 'production'" → replace with "serves requests when mode is 'stub'; rejects (503) otherwise"
- Clarify that stub mode returns EXIF-derived random stub scores (not real vision similarity) and is intentionally gated behind an admin opt-in
- Remove or update the "Do NOT enable" warning to match the intended behavior

**Note:** The semantic search route warning text (`semanticSearchProductionWarning` i18n key at `settings-client.tsx:547`) is also rendered when `settings.semantic_search_mode === 'production'`, but `'production'` can no longer be stored. This UI branch is dead code (see BUG-R5C2-03).

---

### BUG-R5C2-03 — Dead UI branch in settings-client for `'production'` semantic mode

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:545-549`
**Severity:** HIGH
**Confidence:** High
**Classification:** confirmed

**Mechanism:**
```tsx
{settings.semantic_search_mode === 'production' && (
    <p className="text-xs text-amber-600 font-medium">
        {t('settings.semanticSearchProductionWarning')}
    </p>
)}
```

The validator in `gallery-config-shared.ts:171` now rejects `'production'`, meaning `admin_settings` can never store that value via the UI. The settings page reads raw DB values (not validated config). However, the `handleChange` / `onValueChange` at `settings-client.tsx:532` writes to `settings.semantic_search_mode`. Since the `<SelectContent>` no longer includes `<SelectItem value="production">` (it is commented out at line 540-541), users cannot set `'production'` through the UI.

BUT: if a legacy deployment has `semantic_search_mode = 'production'` in the DB from before this change, the settings-client would read it as `'production'`, render the warning block — and that is fine as far as UX goes. However, the REAL behavior is: `gallery-config.ts:127` reads the raw DB value `'production'`, calls `isValidSettingValue('semantic_search_mode', 'production')` which returns `false`, and falls back to `DEFAULTS.semantic_search_mode = 'disabled'`. So the app treats a legacy `'production'` row as `'disabled'` silently.

The settings-client renders the warning (`semanticSearchProductionWarning`) for legacy `'production'` DB values but that warning says something like "Production mode active" — which is wrong because the app is actually treating it as `'disabled'`. The admin sees a warning that implies production mode is running, but the feature is silently disabled.

Additionally, the TypeScript type `semanticSearchMode: 'disabled' | 'stub' | 'production'` in `gallery-config.ts:65` and `gallery-config.ts:127` still allows `'production'` as a runtime value even though the validator blocks it from being stored. This creates a permanent type/validator mismatch.

**Reproduction:** Legacy deployment with `semantic_search_mode='production'` in DB:
1. Admin visits settings → sees `semanticSearchProductionWarning` → believes production search is active
2. Actually: `getGalleryConfig()` returns `semanticSearchMode: 'disabled'`
3. Search endpoint returns 503 for every request
4. The warning is misleading

**Fix (two-part):**
1. In `settings-client.tsx`: change the check to `settings.semantic_search_mode === 'stub'` to warn about stub randomness instead, OR add a note when stored value is `'production'` explaining it is now treated as `'disabled'` and should be changed.
2. In `gallery-config.ts` and `gallery-config-shared.ts`: remove `'production'` from the union type since it can no longer be stored or effectively used. Use `'disabled' | 'stub'` only.

---

### BUG-R5C2-04 — Backfill batching tests use wall-clock sleep for fire-and-forget assertions

**File:** `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:181,193,233`
**Severity:** MED
**Confidence:** High
**Classification:** confirmed

**Mechanism:**
All three tests call:
```ts
await new Promise((r) => setTimeout(r, 500));
```
after `triggerAdminBackfill()` (which starts `runBackfill` fire-and-forget). The assertions on `batchSizes` and `returnedBatches` are made after this 500ms wall-clock delay.

The assertions are structurally sound under ideal conditions (all mocked operations complete in microseconds). But:

1. Under heavy CI load (high memory pressure, CPU throttling, GC pauses in the Node process running vitest), 500ms may not be sufficient for all async mock resolutions, `PQueue` task scheduling, and `queue.onIdle()` resolution.
2. Vitest's fake-timer support is NOT used in this test (it imports real `setTimeout` from the module). If a future test file in the same worker uses `vi.useFakeTimers()` without proper cleanup, real `setTimeout` in these tests would be intercepted and never fire.
3. The `batchSizes` array is populated inside the `executeMock` callback which runs inside `runBackfill`'s event-loop turn. If the promises don't resolve in order within 500ms, the array could be partially populated at assertion time.

**Reproduction:** Under CPU throttling or when run alongside other heavy test files in the same worker, tests may fail intermittently with `Expected array with length 2 but got 1`.

**Fix:** Expose a `waitForBackfillComplete()` helper from the module that resolves when `state.running` becomes `false`, or use `vi.waitFor(() => expect(state.running).toBe(false))`. This makes the wait deterministic rather than time-based:
```ts
// Instead of:
await new Promise((r) => setTimeout(r, 500));
// Use:
await vi.waitFor(() => expect(readAdminBackfillState().running).toBe(false), { timeout: 5000 });
```

---

### BUG-R5C2-05 — Image-queue embedding hook runs in stub mode, storing random embeddings silently

**File:** `apps/web/src/lib/image-queue.ts:413`
**Severity:** MED
**Confidence:** High
**Classification:** confirmed

**Mechanism:**
```ts
if (semanticMode === 'disabled') return;
// else: run embedding stub (stub and production both reach this point)
```

With `'stub'` now a valid storable setting and the semantic route serving `'stub'` mode results, an admin who enables `semantic_search_mode = 'stub'` will:
1. Have `embedImageStub(job.id)` called for every newly processed image
2. Random Float32 vectors stored in `image_embeddings` via `db.insert(...).onDuplicateKeyUpdate`
3. The search route serves cosine similarity of random vectors, returning arbitrary images

This is the documented behavior (the stub is intentional). But the issue is **silent accumulation**: the embedding hook runs fire-and-forget with only `console.debug/warn` output. No admin-visible indicator tells the admin that random vectors are being written. An admin who briefly enables stub mode to test the search UI, then disables it, will have `image_embeddings` rows with random data that persist indefinitely and will influence search results if the mode is re-enabled or when real inference ships.

More critically: the `onDuplicateKeyUpdate` at line 423-428 OVERWRITES any previously-stored real embeddings with random data if the mode is switched from `production` (hypothetical future) to `stub` and back. There is no version guard on the stored embedding.

**Reproduction:**
1. Admin enables `semantic_search_mode = 'stub'`
2. Uploads 10 photos → 10 random embeddings stored
3. Admin disables stub mode
4. Re-enables stub mode later → 10 photos return cosine similarity ~0 (random vs. random) for all new searches

**Fix:** In `image-queue.ts`, add a guard so the embedding hook only runs when `semanticMode === 'production'` (i.e., requires real inference). Stub mode should NOT write embeddings since they are meaningless:
```ts
if (semanticMode !== 'production') return;
```
This aligns with the original route contract (before this diff) which only served `'production'`. The route can continue to serve `'stub'` mode without the queue polluting `image_embeddings`.

If the intent is for stub mode to populate embeddings for testing search UI, add a `CLIP_MODEL_VERSION`-based guard so stub embeddings are tagged differently and never served in production queries.

---

### BUG-R5C2-06 — `retryFailedImage` double-wraps `originError` return value

**File:** `apps/web/src/app/actions/images.ts:1043-1045`
**Severity:** MED
**Confidence:** Med
**Classification:** likely (needs caller inspection)

**Mechanism:**
Before this diff, the function returned `originError` directly (the value returned by `requireSameOriginAdmin()`). The diff changes it to:
```ts
if (originError) return { error: originError };
```

`requireSameOriginAdmin()` returns a `Response` object (a Next.js `NextResponse`) when the origin check fails, not a `{ error: string }` shape. Wrapping it in `{ error: originError }` produces `{ error: Response { status: 403 ... } }`.

The comment "matches file-standard pattern" references `bulkUpdateImages:871`, but `bulkUpdateImages` (and other actions in this file) handle the origin error differently — they return the `originError` directly (it's a Response that Next.js handles). If callers of `retryFailedImage` check for `result.error` expecting a string, they will receive a `Response` object in `result.error`.

Let me trace the shape: `requireSameOriginAdmin()` returns `Response | null`. When it returns a `Response`, wrapping it as `{ error: Response }` makes `result.error` truthy (which is OK for early-exit checks), but any code that tries to display `result.error` as a string will show `[object Response]`.

**Reproduction:** Admin triggers retry for a cross-origin request path → error toast shows `[object Response]` or similar instead of a localized error string.

**Fix:** Check how `requireSameOriginAdmin` works in the surrounding codebase. If it returns a `Response`, the pattern should be:
```ts
const originError = await requireSameOriginAdmin();
if (originError) return originError;  // return Response directly
```
OR, if the intent is to return a `{ error: string }` shape consistently, use the localized error message:
```ts
if (originError) return { error: t('unauthorized') };
```
The second pattern is safe if callers expect `{ error: string } | void`. Verify the callers before choosing.

**Similar patterns:** `bulkUpdateImages` at `:871` returns `originError` directly. If `retryFailedImage` is called from the same client path, the inconsistency in return shape will cause a type mismatch.

---

### BUG-R5C2-07 — LOW: Semantic route docblock line 19 still says "mode is not 'production'" — search UI shown for `'stub'` mode

**File:** `apps/web/src/components/search.tsx:414`
**Severity:** LOW
**Confidence:** High
**Classification:** confirmed

**Mechanism:**
```tsx
{semanticSearchMode !== 'disabled' && (
    // render semantic search UI
)}
```
With `'stub'` now a valid mode and the route serving it, the search UI appears when `semanticSearchMode === 'stub'`. This is intentional. But there is no visual indicator to users that search results are random (stub-generated). A user performing a search will receive results that have no semantic relationship to their query. This is a UX honesty issue.

**Fix:** Either show a dismissible banner ("Search results are approximate") when mode is `'stub'`, or ensure the admin knows that enabling stub mode results in visible (but meaningless) search results.

---

### BUG-R5C2-08 — LOW: `assertBlurDataUrl` is inside the `try` that unlinks on failure — unreachable throw path if it ever throws

**File:** `apps/web/src/lib/process-image.ts:856`
**Severity:** LOW
**Confidence:** High
**Classification:** confirmed (non-issue in practice, documentation gap)

**Mechanism:**
`assertBlurDataUrl` (line 856) is called INSIDE the outer `try { ... blurDataUrl = ... }` at lines 826-860. That catch swallows the error silently (`// Non-critical`). `assertBlurDataUrl` itself NEVER throws (it returns `null` on rejection, line 104-119). So the flow is safe.

However, there is a structural ambiguity: `assertBlurDataUrl` sits inside the blur `try/catch` block, which ends at line 860. The new BUG-R5C1-02 `try/catch` starts at line 866. If `assertBlurDataUrl` were ever changed to throw, the throw would be swallowed by the blur `catch`, not by the new detection-failure `catch`. This is currently safe but structurally confusing.

**Fix (optional):** Add a brief comment at line 856 noting that `assertBlurDataUrl` returns null (never throws) so the inner catch is truly non-critical only. No code change required.

---

## Sweep: Bug-Class Checklist

| Class | Coverage |
|---|---|
| Off-by-one | No off-by-ones found in new code. `cursor = batch[batch.length - 1]!.id` is correct for keyset pagination (inclusive of last seen ID, exclusive on next fetch via `id > cursor`). |
| Null/undefined | `closeButtonRef.current ?? dragHandleRef.current ?? false` in FocusTrap: refs are set before FocusTrap activates because component renders null when `!isOpen`. Safe. `batch[batch.length - 1]!.id` non-null assertion: safe because `batch.length === 0` check guards the cursor-advance line. |
| Async race | No new races found. `queue.onIdle()` before cursor advance is correct. Lock handoff pattern in backfill is sound. |
| Error swallow | `blurDataUrl catch (() => {})` is intentional (non-critical). New `unlink().catch(() => {})` is intentional (best-effort cleanup). The `.catch` on the fire-and-forget `runBackfill()` at line 412 is belt-and-braces per the comment. |
| Encoding | `ALT_TEXT_STUB_PREFIX_RE` uses correct regex escaping. `[AUTO] ` contains `[`, `]`, ` ` — all escaped by the `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` call. `[` and `]` ARE in the character class `[.*+?^${}()|[\]\\]`. Confirmed safe. |
| Timezone | No new TZ-sensitive code. `mysql-datetime.ts` not changed in this diff. |
| Locale | New i18n keys (`expandSheet`, `collapseSheet`, `dropzoneLabel`) present in both `en.json` and `ko.json`. `aria.photoPosition` pre-existing in both. No missing keys found. |
| FS error paths | `saveOriginalAndGetMetadata` unlink chain: `fs.unlink(originalPath).catch(() => {})` — ENOENT is swallowed. Double-unlink impossible: metadata failure path at line 805 throws before reaching line 866; blur `catch` never unlinks; detection failure catch at line 908 unlinks exactly once. |

---

## Primary Target Assessment

### `lib/process-image.ts` — unlink-on-detection-failure
The BUG-R5C1-02 fix is structurally correct. No double-unlink risk. No partial-write state left behind. The `assertBlurDataUrl` placement is safe (never throws). ENOENT from unlink is properly swallowed. No regression vs pre-refactor behavior.

### `lib/admin-backfill-runner.ts` — keyset pagination
The production code is correct: keyset cursor advances by `batch[batch.length - 1].id`, `queue.onIdle()` drains before next fetch, `batch.length < BATCH_SIZE` is the early-exit sentinel. The regression vector is the TEST, not the implementation.

### `app/api/search/semantic/route.ts` + `lib/gallery-config-shared.ts`
The fail-closed rework is logically correct: rate-limit pre-increment before config read, rollback on all non-serving paths, validator now rejects `'production'`. The behavioral reversal (serving `'stub'` instead of `'production'`) is intentional. The bugs are: stale docblock (BUG-R5C2-02), dead UI branch (BUG-R5C2-03), and silent random embedding storage (BUG-R5C2-05).

### `lib/photo-title.ts` — [AUTO] strip
The regex is anchored (`^`), correctly escaped, only applied to `alt_text_suggested` (not `image.title`), and only fires when `!hasMeaningfulTitle && !hasTags`. Manual titles starting with `[AUTO]` are not affected. Empty-after-strip fallthrough to generic fallback is correct. Test coverage is adequate.

### Components
- `info-bottom-sheet.tsx`: FocusTrap `initialFocus` is safe (refs populated before trap activates). Old `useEffect` focus management correctly removed. Drag-handle `aria-label` state-aware change is correct.
- `lightbox.tsx`: Counter intentionally loses `aria-hidden` (kept announceable); `controlVisibilityProps` removed only from the counter div; all other controls retain it. This is the correct fix for DES-R5C1-03.
- `upload-dropzone.tsx`: `role="button"` + `aria-label` + `aria-disabled` additions are correct. i18n key present in both locales.
- `home-client.tsx`: `aria-hidden="true"` on P3 badge is the correct fix for DES-R5C1-05.

---

## References

- `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:130-165` — mock flaw (BUG-R5C2-01)
- `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:181,193,233` — timing-based assertions (BUG-R5C2-04)
- `apps/web/src/app/api/search/semantic/route.ts:17-19` — stale docblock (BUG-R5C2-02)
- `apps/web/src/app/api/search/semantic/route.ts:188` — actual gate: `!== 'stub'`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:545-549` — dead production branch (BUG-R5C2-03)
- `apps/web/src/lib/gallery-config.ts:65,127` — `'production'` still in union type
- `apps/web/src/lib/gallery-config-shared.ts:171` — validator rejects `'production'`
- `apps/web/src/lib/image-queue.ts:413` — embedding hook runs for `'stub'` mode (BUG-R5C2-05)
- `apps/web/src/app/actions/images.ts:1043-1045` — double-wrap of `originError` (BUG-R5C2-06)
- `apps/web/src/lib/process-image.ts:866-910` — unlink-on-failure: correct
- `apps/web/src/lib/admin-backfill-runner.ts:319-353` — keyset pagination loop: correct

# Plan 94 — Cycle 7 Fixes

**Source review:** Cycle 7 Multi-Angle Review (C7-F01 through C7-F06)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence |
|----|------------|----------|------------|
| C7-F01 | `flushGroupViewCounts` tight loop during DB outage — no backoff | MEDIUM | Medium |
| C7-F02 | Search query validation length (1000) exceeds actual search slice (200) | LOW | Medium |
| C7-F03 | No test coverage for view count buffering system | LOW | Medium |
| C7-F04 | No test for search rate limit rollback logic | LOW | Medium |
| C7-F05 | `nav-client.tsx` inline useCallback in JSX provides no memoization | LOW | Low |
| C7-F06 | `getImage` prev/next uses `= NULL` instead of `IS NULL` for null capture_date | LOW | Medium |

### Deferred Findings

- C7-F03 (view count buffer tests): Requires significant mock setup for the buffer/flush system. Defer to a dedicated test-writing cycle. **Exit criterion:** When a test infrastructure cycle is scheduled.
- C7-F04 (search rate limit rollback tests): Same as above — requires mock for rate limit Maps and DB. **Exit criterion:** When a dedicated test-writing cycle is scheduled.

---

## C7-F01: flushGroupViewCounts tight loop — IMPLEMENT

**File:** `apps/web/src/lib/data.ts:27-51`

**Current behavior:** During DB outages, the flush timer fires every 5 seconds, each time attempting all buffered entries which all fail and re-buffer. This creates a burst of ~1000 failed queries every 5 seconds.

**Fix:**
1. Add a module-level `consecutiveFlushFailures` counter
2. After a flush where ALL updates fail (no successful increments), increment the counter
3. If `consecutiveFlushFailures >= 3`, increase the next timer interval using exponential backoff: `5000 * 2^min(failures-3, 5)` capped at 300000ms (5 minutes)
4. On any successful partial flush (at least one update succeeded), reset `consecutiveFlushFailures = 0`
5. Update `bufferGroupViewCount` to use the backoff interval instead of the fixed 5000ms

**Implementation details:**
```ts
let consecutiveFlushFailures = 0;
const BASE_FLUSH_INTERVAL_MS = 5000;
const MAX_FLUSH_INTERVAL_MS = 300000; // 5 minutes

function getNextFlushInterval(): number {
    if (consecutiveFlushFailures < 3) return BASE_FLUSH_INTERVAL_MS;
    const backoff = BASE_FLUSH_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFlushFailures - 3, 5));
    return Math.min(backoff, MAX_FLUSH_INTERVAL_MS);
}
```

In `flushGroupViewCounts`:
- Track how many updates succeed vs fail
- If all fail: `consecutiveFlushFailures++`
- If any succeed: `consecutiveFlushFailures = 0`

In `bufferGroupViewCount`:
- Replace `setTimeout(flushGroupViewCounts, 5000)` with `setTimeout(flushGroupViewCounts, getNextFlushInterval())`

---

## C7-F02: Search query validation vs slice mismatch — IMPLEMENT

**File:** `apps/web/src/app/actions/public.ts:25`

**Fix:** Change the early return length check from 1000 to 200 to align with the actual search slice at line 96.

```ts
// Before:
if (!query || typeof query !== 'string' || query.length > 1000) return [];

// After:
if (!query || typeof query !== 'string' || query.length > 200) return [];
```

This ensures overly long queries fail fast before consuming a rate limit token.

---

## C7-F05: nav-client.tsx inline useCallback — IMPLEMENT

**File:** `apps/web/src/components/nav-client.tsx:143-146`

**Fix:** Move the `useCallback` to the component level with proper dependencies:

```tsx
const handleLocaleSwitch = useCallback(() => {
    document.cookie = `NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=${60 * 60 * 24 * 365}`;
    router.push(localeSwitchHref);
}, [otherLocale, localeSwitchHref, router]);
```

Then use `onClick={handleLocaleSwitch}` in the JSX.

---

## C7-F06: getImage prev/next NULL capture_date SQL — IMPLEMENT

**File:** `apps/web/src/lib/data.ts:333-378`

**Fix:** Replace `eq(images.capture_date, image.capture_date)` with conditional SQL that uses `IS NULL` when `image.capture_date` is null:

For the prev query (and similarly for next), change the second and third `or()` branches:

```ts
// Instead of:
image.capture_date
    ? eq(images.capture_date, image.capture_date)
    : sql`${images.capture_date} IS NULL`,

// Keep as-is for the eq() case (when capture_date is not null)
// For null case, use sql`IS NULL` which produces correct MySQL
```

The fix is to replace the `eq(images.capture_date, image.capture_date)` calls with a helper:

```ts
const captureDateEq = image.capture_date
    ? eq(images.capture_date, image.capture_date)
    : sql`${images.capture_date} IS NULL`;
```

This ensures that when `image.capture_date` is null, the SQL generates `capture_date IS NULL` instead of `capture_date = NULL`.

---

## Verification

- [x] C7-F01: Backoff logic added to flushGroupViewCounts (commit c76f146)
- [x] C7-F02: Search query length check lowered to 200 (commit eae3afa)
- [x] C7-F05: useCallback moved to component level in nav-client.tsx (commit a07f6ad)
- [x] C7-F06: NULL capture_date SQL fixed in getImage (commit c76f146)
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes

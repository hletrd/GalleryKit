# Tracer — Cycle 8 (RPL loop, 2026-04-23)

**Method:** follow suspicious control/data flows across file boundaries and
enumerate competing hypotheses.

## Trace 1 — Zero-width CSV bypass (competing-hypothesis test)

**Hypothesis H1:** the cycle-7-rpl `/^\s*[=+\-@\t]/` regex defends
all leading-whitespace bypass attempts.

**Hypothesis H2:** zero-width characters (U+200B ZWSP, U+200C ZWNJ,
U+200D ZWJ, U+FEFF BOM, U+2060 WJ) are NOT in the `\s` class, so
`​=...` (ZWSP + formula) would escape the prefix guard.

**Evidence for H2:**
- ECMAScript `\s` definition per ECMA-262: whitespace chars from
  the Unicode WhiteSpace property. `U+200B` is NOT whitespace — it's
  "Default_Ignorable_Code_Point" but not WhiteSpace.
- Control-strip regex `[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]` does
  NOT include U+200B.
- Bidi-strip regex `[‪-‮⁦-⁩]` does NOT include
  U+200B.
- CRLF-collapse `[\r\n]+` does NOT include U+200B.

**Conclusion:** H2 wins. A field starting with ZWSP + formula-char
survives all four strips and passes the formula-prefix guard.

**Exploit path:** admin pastes `​=HYPERLINK("http://evil")` into
an image title. `stripControlChars` at upload-time DOES NOT strip
ZWSP. DB stores `​=HYPERLINK(...)`. CSV export writes
`"​=HYPERLINK(""http://evil"")"`. User opens in Excel → Excel
strips leading invisible chars → interprets as formula.

**Severity:** LOW (admin-only input; low exposure).

**Citation:** `csv-escape.ts:24-39`, `sanitize.ts` (for the
control-strip scope).

## Trace 2 — Upload tracker first-insert race

**Hypothesis:** two concurrent uploads from a cold IP can both read
`uploadTracker.get(uploadIp) === undefined`, both create fresh
objects, both pass the check, both land. Last `set` wins.

**Trace:**
- Request A: line 124 `await headers()` yields → event loop schedules B.
- Request B: line 124 `await headers()` yields → event loop.
- Both wake: both call `pruneUploadTracker()` (sync).
- Both call `uploadTracker.get(uploadIp)` → both get `undefined`.
- Both build `{count:0,bytes:0,windowStart:now}`.
- Both pass line 135 check (0 + N ≤ 100).
- Both `await statfs()` → yields again.
- Both land uploads.
- A sets `tracker_A` into the Map.
- B sets `tracker_B` into the Map, overwriting A.

**Result:** Map ends up with B's count only. A's claim is lost. The
cumulative limit is temporarily bypassed.

**Fix:** see CR8-01.

**Severity:** LOW. Admin-authenticated, finite burst.

## Trace 3 — Advisory lock and connection pool interaction

**Hypothesis:** `conn.release()` in the outer finally releases the
connection back to the pool BUT does NOT close the session. If the
same connection is re-checked-out by another request before the
pool resets it, the new request inherits the old session state.

**Trace:**
- `restoreDatabase` calls `connection.getConnection()` → session A.
- `SELECT GET_LOCK('gallerykit_db_restore', 0)` → acquires lock on session A.
- `beginRestoreMaintenance()` → false (another restore pending).
- RELEASE_LOCK on session A → releases.
- `conn.release()` → A goes back to pool, session still open.
- Next request checks out session A → fresh query context but lock is gone.

**Conclusion:** correct. RELEASE_LOCK before pool return is the
right pattern. No issue.

## Trace 4 — `requireSameOriginAdmin` string-return leak

**Hypothesis:** a caller that forgets the null check could leak the
raw error string to clients.

**Trace:** search for `requireSameOriginAdmin` call sites.

```
rg -n 'requireSameOriginAdmin'
```

Each call site uses `const originError = await requireSameOriginAdmin(); if (originError) return { error: originError };`. All 15+ call sites follow this exact pattern. No leakage.

**Status:** pattern-enforced by code review + lint (likely by
`lint:action-origin`). No finding.

## Trace 5 — `rollbackShareRateLimitFull` window alignment at bucket boundary

**Hypothesis:** at a window boundary, a decrement targets a
different bucket than the original increment.

**Trace:**
- T0: `incrementRateLimit(ip, 'share_photo', 60_000)` → bucket at
  `floor(T0/60)*60`.
- T0+65s (next window): request fails, `decrementRateLimit(ip, 'share_photo', 60_000)`.
- Decrement targets `floor(T0+65/60)*60 = floor(T0/60+65/60)*60` = a
  NEW bucket.
- New bucket doesn't have the +1, so `GREATEST(count - 1, 0)` = 0.
- Old bucket still has the +1 — no decrement.

**Result:** drift on bucket boundary. Low practical impact — the
rollback window is sub-second typically.

**Severity:** LOW, LOW.

**Status:** acknowledged; no fix worth it.

## Summary

Two concrete data-flow traces confirmed real concerns: CRIT8-01
(zero-width CSV bypass) and CR8-01 (upload tracker first-insert
race). Other traces resolved benign.

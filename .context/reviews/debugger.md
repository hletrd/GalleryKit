# Cycle 22 Debugger Review

**Date:** 2026-06-29
**Reviewer:** oh-my-claudecode:debugger
**Scope:** Latent-bug sweep — number/string parsing, null/undefined deref, integer overflow/NaN, async/await, off-by-one, date/time, resource cleanup, encoding/buffer parsing

---

## DBG21-01 Regression Confirmation

**Status: CONFIRMED FIXED — no regression.**

`apps/web/src/app/actions/topics.ts` lines 108 and 214 both now read:
```ts
// R21C21 T2 (DBG21-01): Number() not parseInt()
let order = Number(orderStr);
if (!Number.isFinite(order)) order = 0;
order = Math.max(-1000, Math.min(1000, order));
```
The cycle-reference comments are in place. `parseInt('1e3', 10)` truncation is no longer possible on either the `createTopic` or `updateTopic` path.

---

## New Findings — Cycle 22

### DBG22-01 — Local-time Date methods for timezone-sensitive display logic

**Severity:** LOW
**Confidence:** High
**Files:**
- `apps/web/src/components/on-this-day-widget.tsx:16-17`
- `apps/web/src/lib/data-timeline.ts:108-109, 241`

**Trigger:** Node.js process running in a non-UTC local timezone (or MySQL server timezone differing from Node.js timezone).

**Root cause — surface A (`on-this-day-widget.tsx:16-17`):**
```ts
const now = new Date();
const month = now.getMonth() + 1;  // local time
const day = now.getDate();          // local time
```
These values feed `getOnThisDayImages(month, day)` which queries:
```sql
MONTH(capture_date) = month AND DAY(capture_date) = day
```
MySQL's `MONTH()` and `DAY()` functions interpret the stored `DATETIME` in the MySQL server's timezone. If Node.js local time and MySQL server time are in different timezones, today's month/day on the JS side can differ from MySQL's interpretation — causing the wrong day's photos to appear.

**Root cause — surface B (`data-timeline.ts:241`):**
```ts
const monthNum = new Date(img.capture_date).getMonth() + 1;
```
`capture_date` is returned from Drizzle/mysql2 as a string (`'YYYY-MM-DD HH:mm:ss'`). `new Date('YYYY-MM-DD HH:mm:ss')` in V8 Node.js parses as **local time** (space-separated datetimes are not ISO 8601 and fall into implementation-defined behavior). `getMonth()` then returns a local-time month index. On a UTC server this is consistent, but on a non-UTC server a photo taken at 23:45 on June 30 could be bucketed to July.

**Failure mode:** Purely a display mismatch — no data corruption. The "On This Day" widget shows wrong-day photos, or the year-in-review month bucketing is off by one near midnight on day boundaries. Severity limited to non-UTC deployment or near-midnight photos.

**In practice:** Standard Docker deployment runs both Node.js and MySQL in UTC (neither has explicit TZ config). The bug is latent and does not manifest in the current production environment.

**Minimal fix:**
```ts
// on-this-day-widget.tsx:16-17 — use UTC to match EXIF datetime storage
const month = now.getUTCMonth() + 1;
const day = now.getUTCDate();

// data-timeline.ts:241 — explicit UTC parse
const monthNum = new Date(img.capture_date + 'Z').getUTCMonth() + 1;
// OR: new Date(img.capture_date).getUTCMonth() + 1
// Both work when Node.js is UTC; the '+Z' form is more explicit.
```

---

### DBG22-02 — Shutter-speed denominator "1/Infinity" for near-zero EXIF float

**Severity:** VERY LOW (cosmetic display only; crafted EXIF required)
**Confidence:** High
**File:** `apps/web/src/lib/image-types.ts:121`

**Trigger:** `ExposureTime` EXIF tag parses to a subnormal positive float (e.g., `5e-324`, the smallest representable positive `float64`).

**Root cause:**
```ts
if (val < 1 && val > 0) {
    const denominator = Math.round(1 / val);            // line 121
    if (Math.abs(1 / denominator - val) < 0.00001) {
        return `1/${denominator}`;                       // returns "1/Infinity"
    }
}
```
For any `val` so small that `1/val` overflows IEEE 754 to `Infinity`:
- `Math.round(Infinity)` = `Infinity`
- `1 / Infinity` = `0`
- `Math.abs(0 - val) < 0.00001` is true → returns the string `"1/Infinity"`

Real camera shutter speeds range from 1/32000 (≈3e-5) to 30 s — not near the float underflow boundary. Only a maliciously crafted EXIF value reaches this path. The rendered string "1/Infinity" appears in the photo viewer EXIF panel only; no injection risk.

**Minimal fix (one line):**
```ts
const denominator = Math.round(1 / val);
if (Number.isFinite(denominator) && Math.abs(1 / denominator - val) < 0.00001) {
    return `1/${denominator}`;
}
```

---

### DBG22-03 — Admin dashboard `parseInt` swallows scientific-notation page numbers

**Severity:** LOW (cosmetic, admin-only)
**Confidence:** High
**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:12`

**Trigger:** URL query string `?page=1e3` (or any scientific-notation integer representation).

**Root cause:**
```ts
const page = Math.min(Math.max(1, parseInt(pageParam || '1', 10) || 1), 1000);
```
`parseInt('1e3', 10)` stops parsing at the `'e'` character and returns `1`, not `1000`. A direct URL like `?page=1e3` silently shows page 1 instead of page 1000. The `|| 1` NaN fallback and `Math.max/min` clamp are correct; only the parse step is wrong.

This was noted in the cycle-21 sweep as a non-finding ("Safe; `|| 1` fallback catches NaN") — that analysis was correct for the NaN case, but missed the silent value truncation for scientific notation inputs.

**Impact:** Admin-only pagination. No security risk, no data corruption. A bookmark or API script using scientific notation page numbers would receive the wrong page silently.

**Minimal fix:**
```ts
const page = Math.min(Math.max(1, Number(pageParam || '1') || 1), 1000);
```
`Number('1e3')` = `1000` correctly. Non-integer and non-finite inputs fall through to the `|| 1` default (unchanged behavior for invalid inputs).

---

## Prior-Cycle Finding Status

| ID | Status |
|---|---|
| DBG21-01 (`topics.ts` parseInt→Number) | FIXED — confirmed, no regression |
| DBG21-02 (hard-link O_TRUNC double-truncation) | DEFERRED — still present; broken-FS only; acceptable |

---

## Surfaces Cleared — No New Findings

| Surface | Files | Result |
|---|---|---|
| `session.ts:128` `parseInt(timestamp, 10)` | `lib/session.ts` | SAFE: operates on HMAC-verified token payload; always a decimal integer string |
| Route-param `parseInt` callsites | `api/og/photo/[id]`, `api/search/similar/[id]`, `g/[key]/page`, `p/[id]/page` | SAFE: all preceded by `/^\d+$/` regex guards |
| `year/[year]/page.tsx` year parameter | public route | SAFE: `Number()` + `Number.isInteger()` + `[1, 9999]` range guard |
| `icc-extractor.ts` mluc/desc bounds | `lib/icc-extractor.ts` | SAFE: `Math.min(numRecords, 100)`, `Math.min(recLen, 1024)`, per-record bounds checks, outer try/catch |
| `icc-chromaticity.ts` XYZ/chad parsing | `lib/icc-chromaticity.ts` | SAFE: `readXyzTag` size≥20 guard, `invert3x3` det<1e-12 guard, `xyzToXy` zero-sum guard |
| `color-detection.ts` NCLX ISOBMFF walker | `lib/color-detection.ts` | SAFE: MAX_SCAN_BYTES=1MB, MAX_DEPTH=5, size=1 extended-box overflow handled via existing bounds check |
| `gain-map-detection.ts` iinf/iref parser | `lib/gain-map-detection.ts` | SAFE: `inner + idSize + 2 > innerEnd` pre-check, per-element break, outer try/catch |
| `clip-embeddings.ts` `bufferToEmbedding` | `lib/clip-embeddings.ts` | SAFE: `buf.length !== EMBEDDING_BYTES` early throw; `decodeEmbeddingColumn` handles Buffer/string polymorphism |
| View count flush `currentFlushPromise` | `lib/data.ts` | SAFE: `resolveDrain` always called in `finally`; Promise executor is synchronous |
| Fire-and-forget IIFEs (caption + embedding) | `lib/image-queue.ts:474,512` | SAFE: both IIFEs wrap all paths in try/catch with console.warn |
| `gcInterval`/`bootstrapRetryTimer` lifecycle | `lib/image-queue.ts` | SAFE: `.unref?.()` on all creation sites, cleared in quiesce and shutdown |
| `analytics-data.ts` `windowStart` | `lib/analytics-data.ts` | Safe for UTC Docker deployment; `setDate(getDate() - days)` handles month-boundary rollover correctly |
| `exif-datetime.ts` timezone safety | `lib/exif-datetime.ts` | SAFE: uses `Date.UTC()` throughout; `timeZone: 'UTC'` on all formatting |
| `gps-exif-strip.ts` buffer reads | `lib/gps-exif-strip.ts` | SAFE: all reads guarded by bounds checks; outer try/catch on each format path |
| `image-queue.ts` `Promise.all` cleanup on failure | `lib/process-image.ts:1360` | SAFE: catch block uses `Promise.all(writtenSizedPaths.*.map(safeUnlink))` to clean partial writes |

---

## Summary

**DBG21-01 regression check:** PASS — fix confirmed present, no regression.

**New findings:**

| ID | File:Line | Class | Severity |
|---|---|---|---|
| DBG22-01 | `on-this-day-widget.tsx:16-17`, `data-timeline.ts:241` | Date/time timezone | LOW |
| DBG22-02 | `image-types.ts:121` | Integer overflow / NaN | VERY LOW |
| DBG22-03 | `dashboard/page.tsx:12` | parseInt scientific notation | LOW |

DBG22-01 is the highest-priority: replacing `getMonth()`/`getDate()` with `getUTCMonth()`/`getUTCDate()` (and `getUTCMonth()` on the year-in-review bucketing path) eliminates a latent timezone dependency at zero behavioral cost in the current UTC deployment. DBG22-02 and DBG22-03 are both cosmetic, admin-visible at most, and neither affects data integrity or security.

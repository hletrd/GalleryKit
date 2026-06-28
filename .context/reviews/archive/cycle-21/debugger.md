# Debugger Review — Cycle 21
**Date:** 2026-06-29
**HEAD:** 993ed471 (cycle-20 fixes landed)
**Findings:** 2 (2 LOW)

---

## Methodology

Cycle-20 baseline: F1 (`audit.ts` parseInt→Number), F2 (`process-image.ts` parseInt→Number ×2),
F4 (`upload-limits.ts` parseInt→Number), F3 (`audit.ts` unbounded DELETE — deliberately deferred).
All F1/F2/F4 confirmed fixed.

Surfaces audited this cycle:
- Full `parseInt` sweep across remaining callsites (`actions/topics.ts`, route param guards,
  dashboard page param, `session.ts` timestamp) — to close the "fix one sibling, miss the next"
  pattern from cycle-19/20
- `process-image.ts` atomic-rename / hard-link chain (lines 1270–1330)
- `data.ts` viewCountFlushTimer timer lifecycle (3 creation sites)
- `image-queue.ts` gcInterval + bootstrapRetryTimer unref / shutdown cleanup
- `histogram.tsx` AbortController lifecycle
- `data-timeline.ts` timezone-safety of `new Date(capture_date).getMonth()`
- `analytics-data.ts` `windowStart` date arithmetic
- `exif-datetime.ts` Date.UTC consistency
- `on-this-day-widget.tsx` month/day sourcing vs MySQL MONTH()/DAY()
- `admin-backfill-runner.ts` PoolConnection resource paths (acquireImageProcessingClaim,
  releaseImageProcessingClaim, reprocessOne outer try/finally, acquireBackfillLock)
- `bounded-map.ts` post CQ20-07 state
- `og-photo-fetch.ts` post PERF-C20-01 state

---

## Finding DBG21-01 — `parseInt` survives in `actions/topics.ts` order field

**File:** `apps/web/src/app/actions/topics.ts:108, 211`
**Severity:** LOW
**Confidence:** High

```ts
// line 108 (createTopic) — same pattern at line 211 (updateTopic)
let order = parseInt(orderStr, 10);
if (Number.isNaN(order)) order = 0;
order = Math.max(-1000, Math.min(1000, order));
```

`parseInt('1e3', 10)` stops at `'e'` and returns `1`, not `1000`. The `Number.isNaN(1)` guard
passes, so `order = 1` instead of the operator-intended `1000`. The `Math.clamp(-1000, 1000)`
keeps the value within range (1 is a valid sort order), so no exception is thrown — the topic
is simply placed at position 1 instead of 1000. No data corruption; purely a sort-ordering
semantic mismatch.

**Trigger:** Admin sets topic sort order to `1e3` via FormData (unlikely in UI — the UI likely
sends a plain integer; the risk is an API caller or a future batch-import tool).

**Root cause:** The cycle-20 env-parse sweep (`Number()` replacing `parseInt`) was limited to
`process.env` sites. FormData string fields in server actions were not included in the sweep.

**Fix (two lines, same pattern as cycle-20):**
```ts
// topics.ts:108
let order = Number(orderStr);
if (!Number.isFinite(order)) order = 0;
order = Math.max(-1000, Math.min(1000, order));

// topics.ts:211 — identical change
```

Note: `Number.isNaN` should become `!Number.isFinite` since `Number('abc')` returns `NaN`
(handled by isNaN) but `Number('Infinity')` returns `Infinity` (not caught by isNaN but caught
by !isFinite).

---

## Finding DBG21-02 — Hard-link / copyFile same-inode corruption in atomic-rename fallback

**File:** `apps/web/src/lib/process-image.ts:1283–1308`
**Severity:** VERY LOW (requires a broken-filesystem condition; not a routine path)
**Confidence:** High (logic analysis)

```ts
try {
    await fs.link(outputPath, tmpPath);     // A: creates hard link — same inode as outputPath
    await fs.rename(tmpPath, basePath);     // B: if this throws (e.g. EISDIR on basePath)…
} catch {
    // …src and dst now share the same inode (link succeeded, rename failed)
    await fs.copyFile(outputPath, tmpPath)  // C: O_TRUNC flag zeroes the SHARED inode
        .catch((err) => { ... });           //    → outputPath (the encoded sized variant) is NOW 0 bytes
    await fs.rename(tmpPath, basePath);
} finally {
    await safeUnlink(tmpPath);
}
```

**Scenario:** Step A succeeds (hard link created: `tmpPath` and `outputPath` share one inode).
Step B fails — requires either: the destination `basePath` to be an existing directory (EISDIR),
or a filesystem-level fault (e.g., a writeback error on a degraded XFS/EXT4 volume). The catch
block then calls `fs.copyFile(outputPath, tmpPath)`. On Linux, `copyFile` opens `tmpPath` with
`O_WRONLY|O_CREAT|O_TRUNC` — because `tmpPath` and `outputPath` ARE the same inode, the
`O_TRUNC` zeroes the shared inode, setting both the tmp file AND the encoder's output variant
(`outputPath`) to 0 bytes.

**Blast radius:** Only `outputPath` (the largest configured image variant for the current
format, e.g. `_5120.avif`) is affected. `verifyFile` checks `basePath` (also 0 bytes after the
`rename` in the catch), finds it 0 bytes, throws a verification failure, and prevents the job
from being marked `processed = true`. The queue retries the job and the retry re-encodes the
file from the original, restoring `outputPath`. Meanwhile `outputPath` is 0 bytes on disk — a
cold-cache request for that specific size during the retry window would return an empty
AVIF/WebP/JPEG to the browser.

**Why very low:** The failure requires either EISDIR at `basePath` (impossible under normal
operation — `basePath` is always a file path under `public/uploads/{format}/`) or a filesystem
fault that rejects `rename` after `link` succeeded. Docker-deployed on a healthy Linux
filesystem never hits this path in practice.

**Fix (minimal, if desired):**
```ts
} catch {
    // If link succeeded, tmpPath shares outputPath's inode.
    // copyFile(outputPath, tmpPath) on a same-inode pair would O_TRUNC the
    // shared inode. Use a distinct temp name to avoid this.
    const safeTmp = `${tmpPath}.copy`;
    await fs.copyFile(outputPath, safeTmp).catch((err) => { ... });
    await fs.rename(safeTmp, basePath);
} finally {
    await safeUnlink(tmpPath);
    await safeUnlink(`${tmpPath}.copy`); // clean up if rename above failed
}
```

Given the VERY LOW probability of the trigger condition, deferral is reasonable.

---

## Cycle-20 Fixes Verified

| Fix | Location | Status |
|-----|----------|--------|
| F1 — `AUDIT_LOG_RETENTION_DAYS` `Number()` | `lib/audit.ts:116` | Confirmed |
| F2 — `IMAGE_MAX_INPUT_PIXELS` `Number()` ×2 | `lib/process-image.ts:331,343` | Confirmed |
| F4 — `parsePositiveIntEnv` `Number()` | `lib/upload-limits.ts:11` | Confirmed |
| F3 — unbounded DELETE deferred | `lib/audit.ts:122` | Still present; known deferred from cycle-20 |
| PERF-C20-01 — OG per-attempt timeout | `lib/og-photo-fetch.ts:41` | Confirmed; `OG_PHOTO_FETCH_TIMEOUT_MS = 3500` |
| CQ20-07 — BoundedMap `.data` live-ref doc | `lib/bounded-map.ts:50–59` | Confirmed; warning comment present |

---

## Non-Findings (investigated, clean)

- **`session.ts:128 parseInt(timestamp, 10)`** — Safe; timestamp is always `Date.now().toString()`,
  a pure decimal string, never scientific notation.
- **`app/[locale]/admin/(protected)/dashboard/page.tsx:12` `parseInt(pageParam || '1', 10) || 1`** —
  Safe; `|| 1` fallback catches NaN, `Math.clamp(1, 1000)` bounds it.
- **`app/api/search/similar/[id]/route.ts:75` `parseInt(idStr, 10)`** — Pre-guarded by `/^\d+$/`
  regex; scientific notation rejected at the regex boundary.
- **`app/[locale]/(public)/g/[key]/page.tsx:92` `parseInt(photoIdParam, 10)`** — Pre-guarded by
  `photoIdParam && /^\d+$/.test(photoIdParam)`. Safe.
- **`data.ts` viewCountFlushTimer unref** — All three setTimeout creation sites (lines 59, 95, 180)
  call `.unref?.()` immediately after assignment. Clean.
- **`image-queue.ts` gcInterval / bootstrapRetryTimer** — Both stored in state, both have
  `.unref?.()`, both cleared in `shutdownQueue`. `retryTimer` at line 332 also has `.unref?.()`.
  Clean.
- **`histogram.tsx` AbortController** — Created at line 555, passed to `computeHistogramAsync`
  as signal, aborted at line 590 in cleanup. No leak.
- **`data-timeline.ts:241` `new Date(capture_date).getMonth()`** — `capture_date` is
  `mode: 'string'` (Drizzle returns MySQL DATETIME as a string). `new Date('YYYY-MM-DD HH:mm:ss')`
  parses as LOCAL time in Node.js; `.getMonth()` also returns local time — self-consistent.
  Timezone-naive EXIF dates are an inherent semantic limitation, not a code bug.
- **`analytics-data.ts:16-17` `d.setDate(d.getDate() - days)`** — `setDate` correctly handles
  month/year boundary rollovers. Clean.
- **`exif-datetime.ts:22,50`** — Uses `Date.UTC` with `getUTC*` consistently throughout. Clean.
- **`on-this-day-widget.tsx:15-17`** — `new Date().getMonth()+1` / `getDate()` (local time)
  feeds MySQL `MONTH()`/`DAY()` which operates on EXIF-local strings. Self-consistent pair.
- **`admin-backfill-runner.ts` PoolConnection resource management** — All paths (acquire/release,
  `acquireBackfillLock`, `releaseBackfillLock`, `reprocessOne` outer try/finally) correctly
  release connections. No leak paths found.

---

## Summary

| ID | File:line | Finding | Severity |
|----|-----------|---------|----------|
| DBG21-01 | `apps/web/src/app/actions/topics.ts:108,211` | `parseInt(orderStr, 10)` on FormData order field; `'1e3'`→1 not 1000; wrong sort position, bounded, no data corruption | LOW |
| DBG21-02 | `apps/web/src/lib/process-image.ts:1283-1308` | Hard-link + copyFile same-inode corruption in atomic-rename fallback; requires filesystem fault; transient 0-byte sized variant until retry | VERY LOW |
| (known) | `apps/web/src/lib/audit.ts:122` | Unbounded DELETE — cycle-20 F3 deferred | known |

Cycle-21 is clean of new MEDIUM+ findings. The only actionable item is DBG21-01: swap
`parseInt(orderStr, 10)` to `Number(orderStr)` with a `!Number.isFinite` guard in
`actions/topics.ts` at lines 108 and 211. DBG21-02 is flagged for completeness but
recommended for deferral given its filesystem-fault-only trigger.

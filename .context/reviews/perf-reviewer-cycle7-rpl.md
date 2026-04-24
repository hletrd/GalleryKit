# Performance Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** perf-reviewer (performance, concurrency, CPU/memory/UI
responsiveness)

## Findings

### P7-01 — `escapeCsvField` runs two sequential `String.prototype.replace`
calls per field; the two regex passes could be merged

**File:** `apps/web/src/lib/csv-escape.ts:16-17`

```ts
value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
value = value.replace(/[\r\n]+/g, ' ');
```

For a 50 000-row CSV export with 8 columns, this is 800 000 regex
invocations. Merging to a single regex with a replacer function
(strip for controls, replace-with-space for CR/LF) would halve the
per-field work. Sharp's V8 optimizer is already caching compiled
regex globals so the impact is bounded (~10-50ms saved on a 50k export).
Not blocking.

**Severity:** LOW (micro-optimization)
**Confidence:** MEDIUM
**Recommendation:** merge regexes once test coverage solidifies.

### P7-02 — `cleanOrphanedTmpFiles` awaits `Promise.allSettled` per
directory sequentially (for loop), preventing parallel directory
scanning

**File:** `apps/web/src/lib/image-queue.ts:24-48`

```ts
for (const dir of dirs) {
    try {
        const entries = await fs.readdir(dir);
        // ... Promise.allSettled for all unlinks in this dir
    } catch { ... }
}
```

Three directories scanned sequentially at bootstrap. `Promise.all` over
the three `dirs` would parallelize the readdir+unlinks. At startup with
a freshly-crashed server, this could shave ~10-30ms off bootstrap time.
Minor.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** wrap outer loop in `await Promise.all(dirs.map(...))`.

### P7-03 — `rollbackShareRateLimitFull` chains in-memory rollback +
async DB decrement; the DB decrement blocks the hot path even on
over-limit branches

**File:** `apps/web/src/app/actions/sharing.ts:85-90`

```ts
async function rollbackShareRateLimitFull(ip: string, scope: ShareRateLimitScope) {
    rollbackShareRateLimit(ip, scope);
    await decrementRateLimit(ip, scope, SHARE_RATE_LIMIT_WINDOW_MS).catch(...);
}
```

The `await` adds DB round-trip latency to the error-return path for
over-limit callers. For a burst of 20 rejected requests, this is
~20 round-trips of sequential DB work (though each call is independent
and limited by pool).

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** consider fire-and-forget if the DB decrement is
best-effort (already wrapped in catch). Currently the `await` ensures
the next request sees a consistent DB state, which is desirable.
Tradeoff; leave as-is.

### P7-04 — `flushGroupViewCounts` chunk size (20) is hard-coded; the
pool has 10 connections

**File:** `apps/web/src/lib/data.ts:46,58-80`

```ts
const FLUSH_CHUNK_SIZE = 20;
```

With pool=10, half the chunk awaits queuing. Not a correctness issue
but a sub-optimal chunk-size default. Consider matching pool size
(10) or making it configurable via env.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** match FLUSH_CHUNK_SIZE to pool size, or make it
`Math.min(connection.pool.config.connectionLimit, 20)`.

### P7-05 — `searchImages` runs 3 sequential DB queries (main, tag,
alias) each waited. Could short-circuit tag search after enough main
results, which it already does.

**File:** `apps/web/src/lib/data.ts:725-832`

Current design: short-circuits on `results.length >= effectiveLimit`
before tag query. Good. The alias query still runs unconditionally
if remaining slots > 0 after tag query. No change needed.

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### P7-06 — `uploadImages` per-file loop awaits
`saveOriginalAndGetMetadata` + `extractExifForDb` sequentially

**File:** `apps/web/src/app/actions/images.ts:182-295`

Each file in the batch blocks on `saveOriginalAndGetMetadata` (disk
write + Sharp metadata extract) before moving to the next. Files could
be processed in parallel with `Promise.all` to halve upload
queue-accept time, but the existing per-file sequential flow:

1. bounds quota consumption (fail fast on disk-full)
2. preserves a stable `insertedImage.id` sequence
3. avoids Sharp heap-pressure spikes from concurrent decodes

Tradeoff acknowledged; not blocking.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** keep sequential; document the tradeoff in CLAUDE.md.

### P7-07 — `getImage` runs `Promise.all([tagsQuery, prevQuery, nextQuery])`
in parallel. Good. Already optimized.

**File:** `apps/web/src/lib/data.ts:465-535`

**Severity:** INFORMATIONAL

### P7-08 — `getAdminImagesLite` and `getImagesLite` use a correlated
scalar subquery for tag_names rather than LEFT JOIN + GROUP_CONCAT.
This is a tradeoff documented in the data-layer — subquery avoids
grouping the entire result set but runs one subquery per row returned.

**File:** `apps/web/src/lib/data.ts:322-334, 420-439`

For pageSize=30 it's 30 subqueries vs 1 GROUP_CONCAT. On large
galleries the subquery approach wins; on tiny tables GROUP_CONCAT
wins. The current design is the right choice for the target workload.

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### P7-09 — Restore scan reads 1 MiB chunks sequentially via
`scanFd.read`. For a 250 MiB dump that's 250 chunks each followed by
the regex scan on ~1 MB of stripped text. Total scan CPU per restore
is estimated at 500-1500ms.

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:334-354`

Acceptable for a 250 MiB cap. Not a hot path — restore is a rare
admin operation. Leave as-is.

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### P7-10 — `purgeOldBuckets` deletes unbucketed old rows without a
LIMIT clause. For a multi-year deployment with millions of expired
buckets, a single DELETE could acquire a long table lock.

**File:** `apps/web/src/lib/rate-limit.ts:272-275`

```ts
await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.bucketStart, cutoffSec));
```

With hourly GC, at steady state the table only holds ~24h of buckets
(since default maxAge is 24h). If GC stops for a long time (e.g.,
server restart gap), the first post-restart purge could delete a large
set. Consider a batched delete with LIMIT.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** add `LIMIT 10000` per DELETE and loop until no
affected rows.

## Summary

10 findings. All LOW/INFORMATIONAL. No regressions from cycle-6-rpl
landings. P7-01 (CSV field regex merge) and P7-02 (parallel tmp
cleanup) are low-cost improvements; P7-10 (bounded bucket purge) is a
defensive hardening for long-uptime deployments.

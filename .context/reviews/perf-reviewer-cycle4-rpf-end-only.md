# Cycle 4 RPF (end-only) — Performance Reviewer

## Method
Profiled hot-path queries (webhook → entitlement INSERT, download → atomic
claim, sales list, refund), checked for N+1 patterns, examined indexes,
considered queue/concurrency.

## Findings

### LOW

#### C4-RPF-PERF-01 — Webhook adds an extra SELECT for idempotency before INSERT (cycle 3 P262-07)

- File: `apps/web/src/app/api/stripe/webhook/route.ts:171-212`
- Cycle 3's idempotency fix adds `SELECT id WHERE sessionId = ? LIMIT 1` before the INSERT. The unique-key INSERT with ON DUPLICATE KEY UPDATE remains as belt-and-suspenders. Total: 1 SELECT + 1 INSERT per first-time call; 1 SELECT (no INSERT) per retry. Net cost is one extra round-trip per first-time call.
- Severity: **Informational** | Confidence: **High**
- The SELECT is on a UNIQUE column → primary key index → O(log n). Negligible.
- **No action needed.**

#### C4-RPF-PERF-02 — Sales page LIMIT 500 fetches whole table on every load

- File: `apps/web/src/app/actions/sales.ts:32-52`
- LIMIT 500 with leftJoin on images. For a busy gallery this could fetch hundreds of KB per page load. Currently no pagination.
- Severity: **Low** | Confidence: **Medium**
- Mitigation: the `dynamic = 'force-dynamic'` page is admin-only and not on a hot path.
- **Defer:** D04 already covers /sales mobile responsiveness; pagination joins that.

#### C4-RPF-PERF-03 — Download route runs lstat + realpath SERIALLY before claim

- File: `apps/web/src/app/api/download/[imageId]/route.ts:127-147`
- 3 fs operations: `lstat` (1), `realpath(uploadsDir)` (2), `realpath(filePath)` (3). The first two are serial via `await`, the third depends on resolution. Total ~3 fs round-trips per download.
- Severity: **Informational** | Confidence: **High**
- Could `Promise.all([realpath(uploadsDir), realpath(filePath)])` to save one round-trip — but `lstat` is the only one that distinguishes ENOENT from other errors, and it must run first. The two realpaths CAN run in parallel.
- **In-cycle fix:** Parallelize the two realpath calls.

#### C4-RPF-PERF-04 — `displayedRevenueCents` recomputes on every render via `useMemo([rows])`

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:149-152`
- `rows.filter(...).reduce(...)` is O(n). Recomputed on rows change (refund toggle). For 500 rows this is ~5µs. Negligible.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

#### C4-RPF-PERF-05 — Refund action does Stripe API + DB UPDATE serially

- File: `apps/web/src/app/actions/sales.ts:135-150`
- Serial: SELECT → Stripe.checkout.sessions.retrieve → Stripe.refunds.create → UPDATE entitlements. Each Stripe call is a separate HTTPS round-trip. Total latency typically 1-3 seconds.
- Severity: **Informational** | Confidence: **High**
- Cannot parallelize (each step depends on the prior). If the AlertDialog triggers spam-clicks, client-side disable handles it.
- **No action needed.**

#### C4-RPF-PERF-06 — `verifyTokenAgainstHash` allocates 2× Buffers per request

- File: `apps/web/src/lib/download-tokens.ts:64-66`
- `Buffer.from(candidateHash, 'hex')` and `Buffer.from(storedHash, 'hex')` are 32-byte allocations each. On a busy download endpoint this is GC pressure.
- Severity: **Informational** | Confidence: **High**
- 32 bytes × 2 = 64 bytes per request. With 10k req/sec that's 640 KB/sec — well within V8 nursery throughput. Negligible.
- **No action needed.**

### Carry-forward verification

- All cycle 1-3 RPF performance-relevant fixes verified:
  - Cycle 3's removal of `getTotalRevenueCents` saves a full-table SUM per /sales load.
  - Cycle 3's lstat-before-claim does not add latency beyond the realpath path that was already there.
  - Cycle 3's webhook SELECT-before-INSERT adds one round-trip on idempotent retries (negligible).

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 1 deferred (PERF-02)
- INFO: 5

## In-cycle scheduling proposal

- C4-RPF-PERF-03 — parallelize realpath calls in download route (1-line `Promise.all`).

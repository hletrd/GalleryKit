# perf-reviewer — cycle 5 RPF (end-only)

## Method

Read-through of hot paths: download route (per-customer-download),
webhook (per-purchase), checkout (per-buy-click), sales action (admin),
plus the listEntitlements mapper.

## Findings

### PERF-01 — `listEntitlements` re-maps every row through an identity-shaped object

- File: `apps/web/src/app/actions/sales.ts:55-67`
- Severity: **Low** | Confidence: **High**
- The mapper builds a new object from each row that has the same fields
  as the source row. With LIMIT 500 and JS object allocation, this is
  ~500 allocations per page load. Negligible in absolute terms but pure
  overhead.
- **Failure scenario:** none functional. Wasted JIT-allocated objects.
- **Fix (defer):** drop the mapper if shape is identical; assign the
  query result directly. Was kept for explicit `?? null` defaults; could
  collapse if Drizzle types align.

### PERF-02 — Webhook does an extra SELECT (image tier cross-check) on every paid event

- File: `apps/web/src/app/api/stripe/webhook/route.ts:167-172`
- Severity: **Informational** | Confidence: **High**
- Cycle 4 P264-02 added this defensive SELECT for audit signal. Cost is
  one indexed PK lookup per webhook delivery. Acceptable; webhooks
  are not on a public hot path. No action.

### PERF-03 — `mapStripeRefundError` runs `instanceof Error` check that fails for `null`-ish values

- File: `apps/web/src/app/actions/sales.ts:103-104`
- Severity: **Informational** | Confidence: **High**
- Defensive shape — returns 'unknown' for non-Error throws. No
  performance impact. No action.

### PERF-04 — `console.warn`/`console.error` on every async-paid webhook adds I/O cost

- File: `apps/web/src/app/api/stripe/webhook/route.ts:77-86`
- Severity: **Informational** | Confidence: **High**
- ACH/OXXO is a tiny fraction of total checkouts; log volume is
  negligible. No action.

### PERF-05 — `EMAIL_SHAPE` regex compiled per request

- File: `apps/web/src/app/api/stripe/webhook/route.ts:119`
- Severity: **Low** | Confidence: **High**
- The regex is declared inside the POST handler. Each request compiles
  it anew. V8 caches regex literals so this is essentially free, but
  hoisting to module scope is a micro-fix.
- **Fix (defer):** hoist `EMAIL_SHAPE` to module scope. Cosmetic.

### PERF-06 — `STORED_HASH_SHAPE` regex IS hoisted (correct pattern for comparison)

- File: `apps/web/src/lib/download-tokens.ts:46`
- Severity: **Informational** | Confidence: **High**
- Reference example for what PERF-05 should look like. No action.

### PERF-07 — Download route's `Promise.all` on the two realpath calls is correctly parallelized

- File: `apps/web/src/app/api/download/[imageId]/route.ts:136-139`
- Severity: **Informational** | Confidence: **High**
- Cycle 4 P264-06 fix verified. No regression. No action.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| PERF-01  | Low      | High       | Defer (cosmetic) |
| PERF-02  | Info     | High       | No action |
| PERF-03  | Info     | High       | No action |
| PERF-04  | Info     | High       | No action |
| PERF-05  | Low      | High       | This cycle (cheap, clean) |
| PERF-06  | Info     | High       | No action |
| PERF-07  | Info     | High       | No action |

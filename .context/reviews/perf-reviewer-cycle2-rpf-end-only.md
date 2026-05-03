# Perf Reviewer — Cycle 2 RPF (end-only)

## Method

Reviewed the new paid-tier hot paths for CPU/memory/concurrency. Focus
areas: Stripe Checkout request fanout, download streaming, rate-limit
data structures, webhook insert idempotency, sales-page query.

## Gate baseline

All gates green entering this cycle (lint, typecheck, api-auth,
action-origin, vitest 900/900). Build/e2e not re-run within this prompt
(the orchestrator's GATES list is run in PROMPT 3).

## Findings

### C2RPF-PERF-LOW-01 — `/admin/sales` lists 500 entitlements + image titles via leftJoin without pagination
- File: `apps/web/src/app/actions/sales.ts:35-52`
- Severity: Low | Confidence: High
- **What:** `listEntitlements()` runs `SELECT … FROM entitlements LEFT
  JOIN images ON … ORDER BY created_at DESC LIMIT 500`. The `images.title`
  column is `varchar(255)` and the join is on PK; the query plan should
  be O(N) over entitlements with bounded constant factor. The hard cap
  of 500 means the photographer can only ever see the most recent 500
  sales, with no pagination, no date filter, no search.
- **Why it matters in the photographer lens:** A long-running personal
  gallery with weekly sales over multiple years will silently lose
  visibility of older entitlements — e.g., a refund request 6 months
  later cannot be looked up from the UI. The DB still has the row, but
  the admin has no path to reach it.
- **Fix (deferred candidate):** Add cursor pagination (createdAt < ?
  LIMIT 50) and a search-by-email input. Out of scope this cycle —
  the cap is correct hardening; the UX gap is the issue. Recommend
  adding a clear empty-state message when 500 rows are returned ("Showing
  most recent 500 sales. Older sales available via DB export.") and
  scheduling pagination for a follow-up.

### C2RPF-PERF-LOW-02 — `getTotalRevenueCents()` runs a separate full-table sum on every /admin/sales render
- File: `apps/web/src/app/actions/sales.ts:76-91`
- Severity: Low | Confidence: High
- **What:** `SELECT SUM(amount_total_cents) FROM entitlements WHERE
  refunded = false`. No covering index on `refunded`, so MySQL does a
  full table scan + sum. For a personal gallery with O(thousands) of
  rows this is a millisecond. For O(100k) rows it's noticeable. The
  bigger issue: it duplicates work — `listEntitlements()` already
  returned the rows, so the client could compute the sum locally.
  `sales-client.tsx:71-73` already does this:
  `nonRefundedRevenue = rows.filter(!refunded).reduce(...)`. The
  server-side sum is only used as a fallback when the rows array is
  empty/errored — which is the misleading case in C2RPF-CR-LOW-02.
- **Fix (planned):** Drop the `getTotalRevenueCents()` action entirely.
  Compute on the client from the already-loaded rows. If the row cap
  (500) is hit and revenue might be larger than the visible sum, show
  the total separately ("Showing $X from N most-recent sales — full
  revenue available via DB export"). Bonus: removes one DB round-trip
  per page load.

### C2RPF-PERF-LOW-03 — Download route's lstat/realpath sequence runs 2 syscalls per request
- File: `apps/web/src/app/api/download/[imageId]/route.ts:128-138`
- Severity: Informational | Confidence: High
- **What:** lstat → realpath(uploadsDir).catch → realpath(filePath) is
  three filesystem syscalls before the createReadStream. For paid
  downloads (low frequency), this is fine. The pattern is also used
  in `serve-upload.ts` for uploaded images, where the per-request
  overhead matters more (cycle 22 etc. already addressed). The download
  route is bounded by the 24h-token validity and by single-use
  enforcement, so per-request cost is irrelevant.
- No fix needed.

### C2RPF-PERF-LOW-04 — Checkout rate-limit pruning is per-request, not amortized
- File: `apps/web/src/lib/rate-limit.ts:271-280`
- Severity: Informational | Confidence: High
- **What:** `preIncrementCheckoutAttempt` calls `pruneCheckoutRateLimit(now)`
  on every invocation. The OG and search rate limiters use a "prune
  at most once per 1s" guard (`SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS`)
  to amortize the prune cost. Checkout uses a different `BoundedMap`
  type (`createResetAtBoundedMap`) which has its own bounded cleanup,
  so the in-loop prune is cheap. But the *pattern* is inconsistent
  across the rate-limit module (search amortizes, OG doesn't, checkout
  doesn't, share doesn't).
- **Fix (defer):** Standardize the prune cadence across rate-limit
  helpers in a follow-up perf cycle. No correctness issue.

### C2RPF-PERF-LOW-05 — Webhook insert uses `onDuplicateKeyUpdate({ set: { sessionId } })` for idempotency — no real update needed
- File: `apps/web/src/app/api/stripe/webhook/route.ts:111-119`
- Severity: Informational | Confidence: High
- **What:** The "no-op update" trick (`set: { sessionId }`) makes drizzle
  emit `UPDATE session_id = VALUES(session_id)` for the duplicate-key
  branch. MySQL still increments `affectedRows` by 2 in that path
  (per `INSERT … ON DUPLICATE KEY UPDATE` semantics). The route doesn't
  read affectedRows here, so the practical impact is zero. The pattern
  is the standard idempotency idiom for MySQL drivers that don't expose
  a clean `INSERT IGNORE`. Document the choice in the docstring; no
  code change needed.
- No fix.

### C2RPF-PERF-LOW-06 — `Intl.NumberFormat` constructor on every Buy-button render in photo-viewer
- File: `apps/web/src/components/photo-viewer.tsx:484-491`
- Severity: Low | Confidence: Medium
- **What:** The IIFE inside the JSX re-runs `new Intl.NumberFormat(locale,
  …)` on every render of the photo viewer. The viewer re-renders on
  every navigation between photos, every reaction toggle, every
  showInfo flip. The `Intl.NumberFormat` constructor is not free
  (~100µs per call on cold cache). For a viewer that re-renders dozens
  of times per session, that's still milliseconds total — not a real
  regression. The cycle 1 fix prioritized correctness (locale
  formatting) over perf.
- **Fix (planned, low-effort):** Memoize the formatter with
  `useMemo(() => new Intl.NumberFormat(locale, … ), [locale])` at
  component scope and reference inside the IIFE. Marginal but trivial.

## Issues NOT found this cycle

- No N+1 queries on the new paid-tier surfaces.
- Webhook is bounded by Stripe's per-account rate limits; no app-side
  amplification.
- Single-use download stream uses Node's createReadStream → web stream
  conversion, no buffering of the full file.

## Sweep for commonly-missed issues

Checked: long-lived sessions (sessions table not affected by paid flow);
N+1 between sales page and image titles (handled by leftJoin); cold-start
cost of Stripe SDK (one-time, server bootstrap, lazy via `getStripe()`);
unbounded payload reads in webhook (`request.text()` is bounded by
Next.js' default request size limit). No new performance hotspots.

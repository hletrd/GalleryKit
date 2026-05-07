# perf-reviewer — Cycle 6 RPF (end-only)

## Method

Hot-path perf pass: download streaming, webhook ingest, refund mutation,
checkout session creation, sales listing.

## Findings

### PERF-01 — `getTierPriceCents` does a SELECT per checkout call
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:41-52`
- **Severity:** Low | Confidence: High
- **What:** Each `/api/checkout` call hits `adminSettings` once for the
  price. Three paid tiers, each price stored as text in `admin_settings`,
  read via `select(value).from(adminSettings).where(eq(key, ...))`. With
  10 reqs/min budget and a few hundred /day natural traffic, this is
  fine. Caching the prices in module-scope memo with a TTL of ~30s
  eliminates the round-trip and would be a 0-defect optimization. Not
  warranted at current traffic.
- **Status:** defer to next perf pass.

### PERF-02 — `listEntitlements` joins `images` table even when only `imageId` would suffice
- **File:** `apps/web/src/app/actions/sales.ts:35-52`
- **Severity:** Informational | Confidence: High
- **What:** The list does a leftJoin on `images.title`. Required for the
  display column. With LIMIT 500 the cost is bounded. No fix.

### PERF-03 — Webhook does a `select` to detect existing entitlement before insert
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:249-260`
- **Severity:** Informational | Confidence: High
- **What:** Cycle 3 added a SELECT-then-INSERT pattern for idempotency.
  The SELECT is intentional — it gates the manual-distribution log line
  and avoids generating a fresh token on retry. Cost is one indexed
  lookup per webhook hit. Stripe webhook delivery rates are bounded by
  payment volume; this is fine.
- **Status:** intentional, no fix.

### PERF-04 — `EMAIL_SHAPE` regex backtracking
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:46`
- **Severity:** Informational | Confidence: High
- **What:** `/^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/` — three negated
  character classes anchored. No nested quantifiers, no overlapping
  alternations. Linear time on input length. Safe.
- **Status:** confirmed safe; no fix.

### PERF-05 — Refund action: serial calls (sessions.retrieve → refunds.create → db.update)
- **File:** `apps/web/src/app/actions/sales.ts:172-196`
- **Severity:** Informational | Confidence: High
- **What:** Three serial network calls. Cannot parallelize because each
  depends on the prior result. No fix.

### PERF-06 — Sales table renders all rows in a single React tree (LIMIT 500)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:212-275`
- **Severity:** Informational | Confidence: High
- **What:** Carry-forward from C5-RPF-D06: at >500 sales, pagination is
  warranted. Currently bounded.
- **Status:** deferred (existing item).

### PERF-07 — `useMemo` for `formatCents` with `locale` dep
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:134`
- **Severity:** Informational | Confidence: High
- **What:** Memoization is correct; locale rarely changes.
- **Status:** good.

## Cycle 1-5 perf claims

- Cycle 4 P264-06: parallelize realpath calls in download route — verified.
- Cycle 5 P388-04: hoist EMAIL_SHAPE — verified.
- Cycle 3 P262-06: drop dead getTotalRevenueCents action — verified.

All carry-forward perf wins still in source.

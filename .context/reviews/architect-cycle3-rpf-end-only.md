# Architecture Review — Cycle 3 RPF (end-only)

Agent: architect
Scope: structural fit, cross-module contracts, missing abstractions in paid-downloads stack.

## Inventory

Same as code-reviewer + the docs and env vars.

## Findings

### C3RPF-ARCH-MED-01 — Webhook event-type dispatcher is in-line; will balloon as event types grow

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-164`
- Severity: **Medium** | Confidence: **High**
- The handler currently has a single `if (event.type === 'checkout.session.completed')` branch. As soon as cycle 3 adds `checkout.session.async_payment_succeeded` (recommended fix for C3RPF-CR-HIGH-01) AND/OR `charge.refunded` (for the C2-RPF-D08 deferred item) AND/OR `charge.dispute.created`, the function becomes a 400-line waterfall.
- **Fix:** Extract per-event handlers into a `lib/stripe-webhook-handlers.ts` and dispatch via switch in the route. Each handler takes the typed event object. This is enabling work for the C3RPF-CR-HIGH-01 fix.

### C3RPF-ARCH-MED-02 — `entitlements` schema lacks `payment_status`, `stripe_payment_intent_id`, `stripe_refund_id`

- File: `apps/web/src/db/schema.ts:251-266`
- Severity: **Medium** | Confidence: **High**
- C2-RPF-D08 deferred `stripe_refund_id`. The cycle 3 finding C3RPF-CR-HIGH-01 needs `payment_status` (or equivalent) to track async-pending sessions. Without those columns, the refund action has to round-trip to Stripe to retrieve the payment_intent (`sales.ts:145-150`) and the webhook cannot enqueue a pending entitlement to flip on `async_payment_succeeded`.
- **Fix:** Schedule a migration 0014 that adds the three columns. Defer the schema move to a coordinated cycle (this is bigger than a single RPF can absorb), but record it as the prerequisite for the async-pay path.

### C3RPF-ARCH-MED-03 — Manual-distribution workflow is a temporary scaffold but lacks an exit plan in code

- File: `apps/web/README.md:48-79`, `apps/web/src/app/api/stripe/webhook/route.ts:158-163`
- Severity: **Medium** | Confidence: **High**
- The README documents `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` as the operational workflow. The webhook code references it as the closure of the workflow loop. There is no roadmap milestone tracked in code (no TODO with an issue ref) for when this is removed. Maintenance debt accrues.
- **Fix:** Add a `// TODO(US-P54-phase2)` comment at the env-gated block and tracking note in README that "this code path is removed when the email pipeline ships".

### C3RPF-ARCH-LOW-01 — `lib/license-tiers.ts` has unrelated helper `deriveLocaleFromReferer`

- File: `apps/web/src/lib/license-tiers.ts:46-60`
- Severity: **Low** | Confidence: **High**
- The helper has nothing to do with license tiers; it lives there because cycle 1 RPF added it adjacent to the checkout route's locale-aware redirect URL. Discoverability suffers — a future maintainer searching for locale helpers won't find it.
- **Fix:** Move to `lib/locale-path.ts` (already exists) or `lib/i18n-helpers.ts`. Update imports.

### C3RPF-ARCH-LOW-02 — `getTotalRevenueCents` action is a leaky abstraction

- File: `apps/web/src/app/actions/sales.ts:75-91`
- Severity: **Low** | Confidence: **High**
- See critic CRITIC-05 / code-reviewer C3RPF-CR-MED-02. Architectural recommendation: delete it.

### C3RPF-ARCH-LOW-03 — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both lazy-init but not validated for shape

- File: `apps/web/src/lib/stripe.ts`
- Severity: **Low** | Confidence: **High**
- Cross-listed with security-reviewer C3RPF-SEC-LOW-05. Architectural recommendation: add a startup-time validation function exported from `lib/stripe.ts` that the operator can call from health-check or first-deploy script. Defer-eligible.

### C3RPF-ARCH-LOW-04 — `data/uploads/original/` vs `public/uploads/original/` path inconsistency

- Files: `apps/web/src/app/api/download/[imageId]/route.ts:120`, repo docs
- Severity: **Medium** (if the topology is wrong) | Confidence: **Low** (need to verify deployment)
- See critic CRITIC-09. The fix is either path harmonization or env-var-based config.
- **Fix:** Verify deployment first; then either harmonize or env-var.

### C3RPF-ARCH-LOW-05 — Refund mapping table is in the same file as the action; no test asserts mapping completeness

- File: `apps/web/src/app/actions/sales.ts:101-118`
- Severity: **Low** | Confidence: **High**
- The `RefundErrorCode` union and the `mapStripeRefundError` function are tightly coupled to the action. If a new Stripe error type lands (say `StripeIdempotencyError`), there's no test that fails. Cycle 2 added source-contract tests for the existing codes; nothing locks the union.
- **Fix:** Add a test that imports `RefundErrorCode` and asserts every union member is reachable from at least one mapStripe path. Cheap.

## Confirmed vs likely

- **Confirmed (already redundant with other reviewers):** C3RPF-ARCH-MED-02, ARCH-LOW-01, ARCH-LOW-02, ARCH-LOW-05.
- **Confirmed (architecture-specific):** C3RPF-ARCH-MED-01, ARCH-MED-03.
- **Needs validation:** C3RPF-ARCH-LOW-04 (deployment topology).

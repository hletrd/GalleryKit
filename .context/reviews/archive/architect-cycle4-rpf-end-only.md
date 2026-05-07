# Cycle 4 RPF (end-only) — Architect

## Method
Architectural pass: layering, contracts, abstraction boundaries, drift between
intended invariants and current code.

## Findings

### LOW / INFO

#### C4-RPF-ARCH-01 — `lib/upload-paths.ts` exports both legacy and new path; download route uses new

- File: `apps/web/src/lib/upload-paths.ts:25-40`
- The `LEGACY_UPLOAD_DIR_ORIGINAL` constant exists for migration. The cycle 3 P262-03 fix made the download route use `UPLOAD_DIR_ORIGINAL` (the new path). The download route does NOT fall back to the legacy path. So a deployment that has files in the legacy location would 404 on download.
- Severity: **Informational** | Confidence: **High**
- Mitigation: the existing `resolveOriginalUploadPath()` helper handles the legacy fallback. The download route could use that helper instead of resolving directly.
- **Defer:** practical legacy paths are migrated by `assertNoLegacyPublicOriginalUploads`; new deployments use UPLOAD_DIR_ORIGINAL only.

#### C4-RPF-ARCH-02 — Webhook business logic is inline; no event-type dispatcher

- File: `apps/web/src/app/api/stripe/webhook/route.ts:57-235`
- Single `if (event.type === 'checkout.session.completed')` block. Adding `checkout.session.async_payment_succeeded` or `charge.refunded` would force this file to balloon. C3-RPF-D03 already deferred this.
- Severity: **Low** | Confidence: **High**
- **Defer (D03 carry-forward).**

#### C4-RPF-ARCH-03 — `entitlements` table has no `payment_intent_id` for split-brain refund recovery

- File: `apps/web/src/db/schema.ts:251-266`, `apps/web/src/app/actions/sales.ts:138-144`
- Refund flow does `stripe.checkout.sessions.retrieve(sessionId)` to get the payment intent. Network failure after Stripe refund creates but before DB UPDATE sets `refunded = true` leaves split-brain. C3-RPF-D02 deferred for `stripe_refund_id` migration; same root cause.
- Severity: **Low** | Confidence: **High**
- **Defer (D02 + D09 carry-forward).**

#### C4-RPF-ARCH-04 — Downstream code accesses entitlement state via TWO paths

- File: `apps/web/src/app/api/download/[imageId]/route.ts:53-78` and `apps/web/src/app/actions/sales.ts:35-72`
- Both read entitlements but use different column subsets. No shared "entitlement view" abstraction. Future schema additions need to be added in both places. Currently low-cost (2 sites), but as more readers come online (analytics, audit) this drifts.
- Severity: **Informational** | Confidence: **High**
- **Defer:** YAGNI; current 2-reader cost is bounded.

#### C4-RPF-ARCH-05 — Cycle 3 P262-07 idempotency SELECT vs ON DUPLICATE belt-and-suspenders

- File: `apps/web/src/app/api/stripe/webhook/route.ts:200-212`
- Comment claims the ON DUPLICATE remains for race protection. Stripe webhooks are serially-delivered per event_id, so the race is practically zero. The double-guard adds one branch and one explanatory comment. Cleaning up is cosmetic.
- Severity: **Informational** | Confidence: **High**
- **No action needed.**

#### C4-RPF-ARCH-06 — `lib/license-tiers.ts` houses both tier constants AND `deriveLocaleFromReferer`

- File: `apps/web/src/lib/license-tiers.ts:46-60`
- The locale helper is only used by checkout (`/api/checkout/[imageId]`) and is conceptually unrelated to license tiers. C3-RPF-D10 deferred this refactor.
- Severity: **Informational** | Confidence: **High**
- **Defer (D10 carry-forward).**

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 3 (ARCH-02, 03 — both defer to existing carry-forward; nothing new)
- INFO: 3

## In-cycle scheduling proposal

- None new. All architecture concerns map to existing deferred items.

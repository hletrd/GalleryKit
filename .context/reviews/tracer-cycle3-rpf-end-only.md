# Tracer Review — Cycle 3 RPF (end-only)

Agent: tracer
Scope: end-to-end traces for the paid-download flow.

## Trace 1: Customer pays via card → downloads

```
Customer clicks Buy on /p/{id}
  → POST /api/checkout/{id}
    → preIncrementCheckoutAttempt (rate-limit charge)
    → SELECT image WHERE id=? (license_tier, processed)
    → SELECT admin_settings WHERE key=`license_price_${tier}_cents`
    → stripe.checkout.sessions.create
    → return { url } (Stripe Checkout URL)
  ← redirect to Stripe Checkout
Customer pays via card on Stripe
  → Stripe redirects to /{locale}/p/{id}?checkout=success
  → React mount fires: toast.success(stripe.checkoutSuccess)
Stripe sends webhook
  → POST /api/stripe/webhook
    → constructStripeEvent (signature verify)
    → if event.type === 'checkout.session.completed':
       → extract metadata.imageId, metadata.tier, customer_email
       → EMAIL_SHAPE guard
       → presence guard (imageId/tier/email/sessionId)
       → isPaidLicenseTier(tier) guard
       → parseInt + isFinite + > 0 guard on imageId
       → generateDownloadToken (token, hash)
       → db.insert(entitlements) ON DUPLICATE KEY UPDATE
       → log "Entitlement created: ..."
       → if LOG_PLAINTEXT_DOWNLOAD_TOKENS=true:
          → log "[manual-distribution] download_token: ... token=dl_xxx"
Operator runs `docker logs <web> | grep manual-distribution`
  → operator emails the URL to the customer
Customer clicks the URL
  → GET /api/download/{imageId}?token=dl_xxx
    → token format check
    → SELECT entitlement WHERE imageId=? AND downloadTokenHash=?
    → verifyTokenAgainstHash (constant-time + shape guard)
    → expiry check
    → refunded check
    → downloadedAt IS NULL check
    → UPDATE entitlements SET downloadedAt=NOW(), downloadTokenHash=null
       WHERE id=? AND downloadedAt IS NULL
    → check affectedRows
    → SELECT image filename_original
    → path.resolve uploadsDir
    → lstat (symlink/file check)
    → realpath (traversal check)
    → createReadStream → Readable.toWeb
    → return webStream with Content-Disposition
Customer receives original file
```

## Trace findings

### Trace 1 Finding TR-H1 — Async-pay session never produces a viable customer path

If Stripe's payment method is bank-transfer/ACH/etc., `checkout.session.completed` fires with `payment_status='unpaid'`. The webhook flow above completes; the operator emails the token; the customer downloads — and Stripe later either fails to settle or settles 2-7 days later. Trace shows the gallery does not differentiate paid from unpaid. Severity: High. Cross-listed with code-reviewer C3RPF-CR-HIGH-01.

### Trace 1 Finding TR-M1 — Token consumed but file missing breaks the trace at step 12

```
... (as above)
  → UPDATE entitlements SET downloadedAt=NOW() ... (row touched)
  → SELECT image filename_original
  → lstat → ENOENT
  → catch block: 404 "File not found"
```

Customer is at step 12. The previous step (10) already consumed the token. Customer hits refresh → step 8 (downloadedAt IS NULL check) returns 410 "Token already used". Customer is stuck. Severity: Medium. Cross-listed with code-reviewer C3RPF-CR-MED-04.

### Trace 1 Finding TR-M2 — `data/uploads/original/` path mismatch

`path.resolve(process.cwd(), 'data', 'uploads', 'original')` is the source of truth in the download route. The repo CLAUDE.md and Dockerfile may use `public/uploads/original/`. If the deployment topology uses the public path, every paid download fails ENOENT. Severity: Medium. Cross-listed with critic CRITIC-09. **Verify deployment topology.**

## Trace 2: Customer pays → admin issues refund → customer attempts download

```
[After Trace 1 step 10 (entitlement created)]
Admin opens /admin/sales
  → page calls listEntitlements + getTotalRevenueCents in parallel
  → SalesClient renders rows with refund button
Admin clicks Refund on row N
  → setConfirmTarget(row)
  → AlertDialog opens
  → confirms
  → handleRefund(id)
    → refundEntitlement(id)
      → requireSameOriginAdmin
      → isAdmin check
      → SELECT entitlement
      → if row.refunded → return errorCode: 'already-refunded'
      → stripe.checkout.sessions.retrieve(sessionId)
      → stripe.refunds.create({ payment_intent })
      → UPDATE entitlements SET refunded=true, downloadTokenHash=null
      → return { success: true }
    → toast.success
    → setRows((prev) => prev.map(...))
Customer (later) clicks download URL
  → GET /api/download/{imageId}?token=dl_xxx
    → SELECT entitlement
    → if !entitlement.downloadTokenHash → "Token not found" (404)
       (because the hash was cleared)
```

### Trace 2 Finding TR-M3 — Refund Stripe-vs-DB split-brain

```
... stripe.refunds.create (succeeds, money returned to customer)
... UPDATE entitlements (FAILS — DB connection blip)
  → catch block: return errorCode: 'unknown'
  → toast.error
```

State now: Stripe says refunded; DB says NOT refunded; customer's downloadTokenHash is INTACT; customer can still download. Bookkeeping diverges from reality. Severity: Medium. Cross-listed with debugger C3RPF-DBG-MED-02.

## Trace 3: Webhook fires twice for same session (Stripe retry)

```
Webhook 1: db.insert(entitlements) ON DUPLICATE KEY UPDATE → INSERT happens
Webhook 1: log "Entitlement created"
Webhook 1: if LOG_PLAINTEXT_DOWNLOAD_TOKENS=true → log "[manual-distribution]" with token1
Webhook 2 (retry): generateDownloadToken → token2 (different from token1)
Webhook 2: db.insert ON DUPLICATE KEY UPDATE → no-op (sessionId UNIQUE)
Webhook 2: log "Entitlement created" (DUP — same imageId/tier/sessionId)
Webhook 2: if LOG_PLAINTEXT_DOWNLOAD_TOKENS=true → log "[manual-distribution]" with token2
```

### Trace 3 Finding TR-M4 — Stripe retry causes DOUBLE manual-distribution log lines with DIFFERENT tokens

The first token (token1) is the one stored in DB. token2 from the retry was generated but NOT stored (ON DUPLICATE KEY UPDATE only updates sessionId to itself). Operator running `grep manual-distribution | tail -1` would email token2 — which is not the stored token, so customer's download fails with "Token not found".

Severity: **Medium** | Confidence: **High** (Stripe retries are normal; 4xx and 5xx in the webhook DO cause retries; even healthy webhooks can retry on transient timeout).

**Fix candidates:**
1. Extract the entitlement insert + token generation so the token comes from a SELECT-after-INSERT. If the INSERT is a no-op (ON DUPLICATE KEY UPDATE), select the existing row's `downloadTokenHash` instead of inventing a new one. But the DB stores only the hash, not the plaintext, so the original token cannot be recovered. The fix has to prevent the second token from being generated at all.
2. Use a different idempotency check: SELECT WHERE sessionId=? FIRST. If it exists, skip token generation and INSERT entirely. Only generate a fresh token if the SELECT returned nothing.
3. Log the token only on actual fresh INSERT (i.e., check `result.affectedRows === 1` for an INSERT vs 2 for ON DUPLICATE KEY UPDATE). Only the first-insert path should write the manual-distribution line.

Recommended: option 3 (least invasive, locks the existing idempotency contract). Add a check: if the insert was an "update" (sessionId already existed), skip both log lines.

## Confirmed vs likely

- Trace 1 H1 / TR-M1 / TR-M3 / TR-M4: Confirmed by reading source.
- TR-M2: Needs deployment topology verification.

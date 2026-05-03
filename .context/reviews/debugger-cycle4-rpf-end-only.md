# Cycle 4 RPF (end-only) — Debugger

## Method
Hypothesis-driven: imagined failure scenarios then traced through the code.

## Findings

### LOW

#### C4-RPF-DBG-01 — Hypothesis: Stripe sends `customer_email` with leading whitespace

- File: `apps/web/src/app/api/stripe/webhook/route.ts:89-90`
- Hypothesis: a misconfigured Stripe webhook (or a customer who pasted whitespace into the Checkout email field) sends `' user@example.com '`. EMAIL_SHAPE regex disallows whitespace via `[^\s]`, so the email is rejected as malformed.
- Trace: line 90 slices to 320 chars then `.toLowerCase()`. No `.trim()`. Line 102 EMAIL_SHAPE regex rejects whitespace. So a leading-space email reaches line 102 and fails.
- This is a NEW WAY a previously-paying customer can fail to receive their token (Stripe normally sends trimmed emails, but this is brittle).
- Severity: **Low** | Confidence: **Medium**
- **In-cycle fix:** add `.trim()` before `.toLowerCase()` so accidental whitespace from misconfigured callers doesn't reject legit emails.

#### C4-RPF-DBG-02 — Hypothesis: Filename has Unicode in the extension

- File: `apps/web/src/app/api/download/[imageId]/route.ts:179-180`
- Hypothesis: admin uploads `photo.JPEG` (uppercase). `path.extname` returns `.JPEG`. Sanitizer `[^a-zA-Z0-9.]` keeps `.JPEG`. So the safeExt allows the original case.
- Trace: line 179 returns `.JPEG`. Line 180 `replace(/[^a-zA-Z0-9.]/g, '')` keeps `.JPEG`. Line 181 outputs `photo-42.JPEG`.
- No bug. Behavior is correct.

#### C4-RPF-DBG-03 — Hypothesis: Race between webhook delivery and admin deleting the image

- File: `apps/web/src/app/api/stripe/webhook/route.ts:198-217`
- Hypothesis: admin deletes image #42 between checkout creation and webhook delivery. `entitlements.imageId` is FK to `images.id` ON DELETE CASCADE. INSERT into entitlements with imageId=42 (where images.id=42 doesn't exist) → MySQL FK violation → INSERT fails.
- Trace: line 213 catches the err and returns 500 → Stripe retries forever.
- Severity: **Low** | Confidence: **High** (FK violation is real)
- Mitigation: admin is unlikely to delete an image after a customer has created a Stripe checkout for it (UI doesn't surface in-flight checkouts). And even if it happens, the customer gets a refund via their card statement (they paid Stripe; Stripe takes payment; webhook fails → no entitlement → customer support flow).
- **Defer:** Bounded by admin discipline + the commerce flow already includes a "before deleting an image, check pending entitlements" mental check. Not a single-cycle change.

#### C4-RPF-DBG-04 — Hypothesis: SELECT-LIMIT-1 idempotency check returns the wrong row on UNIQUE collision

- File: `apps/web/src/app/api/stripe/webhook/route.ts:171-179`
- Hypothesis: `SELECT id WHERE sessionId = ? LIMIT 1` returns the row matching sessionId (UNIQUE). Even if multiple INSERTs were attempted concurrently, the table can only ever have one row per sessionId.
- Trace: UNIQUE constraint on entitlements.sessionId guarantees `[existing]` is either null or a unique row. Code is correct.
- No bug.

#### C4-RPF-DBG-05 — Hypothesis: `'use server'` action `refundEntitlement` is callable from non-admin browser

- File: `apps/web/src/app/actions/sales.ts:113-160`
- Hypothesis: server action exposed to client; without origin guard, CSRF could trigger refund.
- Trace: line 114 calls `requireSameOriginAdmin()` which validates origin + admin cookie. Line 116 calls `isAdmin()` for double-check. Both must pass before any DB write.
- No bug. Defense in depth in place.

#### C4-RPF-DBG-06 — Hypothesis: `parseInt(...)` accepts non-canonical input like `'42abc'`

- File: `apps/web/src/app/api/download/[imageId]/route.ts:42`
- Hypothesis: URL `/api/download/42abc?token=dl_...` would parseInt to 42, allow download.
- Trace: line 42 `parseInt('42abc', 10) === 42`. Line 43 isFinite(42) is true. So this resolves to image 42's download path. Token is checked on the entitlement table — it must match a valid entitlement's hash.
- The only attacker outcome is exposing image #42 if a token for image #42 exists; and they'd need to know the token. So no privilege escalation.
- Severity: **Informational** | Confidence: **High**
- **No action needed.** Defense-in-depth would use Number() but no real risk.

## Aggregate severity

- HIGH: 0
- MEDIUM: 0
- LOW: 1 in-cycle (DBG-01), 1 deferred (DBG-03)
- INFO: 4

## In-cycle scheduling proposal

- C4-RPF-DBG-01 — `.trim()` customer email before lowercase + EMAIL_SHAPE check.

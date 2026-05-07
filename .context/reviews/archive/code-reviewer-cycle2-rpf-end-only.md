# Code Reviewer — Cycle 2 RPF (end-only)

## Method

Inventory pass over all paid-tier surfaces shipped in commits cdaa578…f0386ec
(US-P54 Stripe + checkout flow), plus the most recent fixes in cycle 1 RPF
(commits add8f62, b60e451, bde2c67, 6e63ee7, f0386ec, 7d01729, 62209d9, 9293dcf).
Cross-checked against the cycle 1 aggregate findings to avoid duplicates.

## Gate baseline

- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run lint:api-auth` and `npm run lint:action-origin` clean.
- `npm test` — 900 tests pass across 104 files.
- `git status` clean on master, in sync with origin.

## Findings

### C2RPF-CR-MED-01 — Webhook silently drops the plaintext download token
- File: `apps/web/src/app/api/stripe/webhook/route.ts:105`
- Severity: Medium | Confidence: High
- **What:** `generateDownloadToken()` returns `{ token, hash }`. The webhook
  destructures only `{ hash: downloadTokenHash }` — the plaintext `token` is
  silently dropped. The cycle 1 RPF aggregate noted that the plaintext token
  is meant to flow through the admin /sales view "for manual distribution",
  but the admin /sales surface (`sales-client.tsx`) and the data model
  (`EntitlementRow`) do not return or display any plaintext token at all —
  only the hash is in the DB, only `customerEmail` is shown. The result:
  the photographer has no way to recover the download URL the visitor needs.
  The "manual distribution" flow doesn't exist in code.
- **Concrete failure:** Visitor pays $X. Stripe redirects to
  `/p/{id}?checkout=success`. Toast says "your download link is being
  prepared". The photographer logs into /admin/sales and sees customer email,
  amount, status (Pending), Refund button — but no link/token to email the
  customer. The customer waits, never gets a link, files a chargeback.
- **Fix:** Two viable options:
  1. (minimal) Capture the plaintext token in `console.info` only at
     webhook ingest, document the operational requirement that the
     gallery owner must read server logs to retrieve the token, and add
     a sales-view tooltip that says "download token is in server logs:
     `grep 'session=cs_xxx' …`". This is a stopgap.
  2. (better, this cycle) Add a `pending_download_tokens` table that
     stores the *plaintext* token for a short window (e.g., 1 hour) so
     the admin /sales view can render a "Copy download URL" button while
     the token is fresh, then GC the plaintext after distribution. This
     introduces a transient PII row but solves the actual workflow.

  Recommend the minimal stopgap this cycle (operational doc + log line)
  to avoid widening the data surface, and defer the plaintext-row table
  with a clear exit criterion (when an email pipeline is added, or when
  manual distribution becomes the documented support path).

### C2RPF-CR-LOW-01 — `sales-client.tsx` formats currency without locale
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:36-38`
- Severity: Low | Confidence: High
- **What:** `formatCents(cents)` returns `$${(cents/100).toFixed(2)}` — same
  bug pattern that cycle 1 RPF fixed in `photo-viewer.tsx:484-491` for the
  Buy button. The admin /sales view inherits the same hardcoded `$` and
  US-style decimal formatting regardless of locale. A Korean photographer
  viewing /ko/admin/sales sees `$12.00` instead of a locale-formatted USD
  price.
- **Fix:** Mirror the photo-viewer pattern — use
  `new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' })`.
  The component already gets `locale` via the route segment; pass it through
  the props or use `useLocale()` from next-intl.

### C2RPF-CR-LOW-02 — `formatCents` falls back to `_||_` semantics that hide refunded revenue
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:80`
- Severity: Low | Confidence: Medium
- **What:** `{formatCents(nonRefundedRevenue || totalRevenueCents)}` —
  the `||` fallback fires when `nonRefundedRevenue === 0` (every entitlement
  refunded) and falls through to `totalRevenueCents`, which is the
  pre-refund total from `getTotalRevenueCents()`. So the photographer sees
  a *non-zero* "Total Revenue" even when 100% of sales were refunded. This
  is misleading and undermines the whole point of the refund flow.
- **Fix:** Drop the `||` fallback. Show `nonRefundedRevenue` directly. If
  no rows are loaded (loading or error state), use a neutral placeholder
  (e.g., `—`) instead of the stale total.

### C2RPF-CR-LOW-03 — `refundEntitlement` does not persist Stripe refund id, blocking audit
- File: `apps/web/src/app/actions/sales.ts:115-130`
- Severity: Low | Confidence: High
- **What:** `await stripe.refunds.create({ payment_intent: piId })`
  returns a `Stripe.Refund` with an `id` (`re_xxx`) that is the canonical
  audit token in the Stripe dashboard. The local DB only sets `refunded =
  true` and clears `downloadTokenHash`. There is no link from the local
  entitlement row to the Stripe refund, so a future support ticket
  ("did this customer actually get the money?") requires manually paging
  through the Stripe dashboard and matching by `customer_email` /
  `payment_intent`.
- **Fix:** Add a nullable `stripe_refund_id varchar(64)` column to
  `entitlements` (migration 0014) and persist `refund.id` in the same
  UPDATE that sets `refunded: true`. Surface in /admin/sales as a small
  "View in Stripe" link. Non-blocking but cleanly auditable.

### C2RPF-CR-LOW-04 — `download-tokens.ts` `verifyTokenAgainstHash` swallows malformed-hex errors
- File: `apps/web/src/lib/download-tokens.ts:41-53`
- Severity: Low | Confidence: High
- **What:** The function does `Buffer.from(storedHash, 'hex')` inside a
  try/catch, but `Buffer.from(s, 'hex')` does NOT throw on bad input —
  it silently truncates at the first non-hex char. So a corrupted DB
  value (e.g., a hash that was clipped during a migration) would return
  a *short* buffer that fails the explicit `a.length !== b.length` check,
  but that signal is never logged. A subtle data-integrity issue (DB
  corruption, partial migration) becomes an opaque "Invalid token" 403.
- **Fix:** Validate `storedHash` matches `^[0-9a-f]{64}$` *before*
  calling `Buffer.from`, and `console.warn` if not. The guard is cheap
  and restores diagnosability.

### C2RPF-CR-LOW-05 — Download route casts driver result without runtime shape check beyond the optional
- File: `apps/web/src/app/api/download/[imageId]/route.ts:96-106`
- Severity: Low | Confidence: Medium
- **What:** The comment claims the cast falls back to "1 (allow download)"
  on shape mismatch to avoid a false-410. That fallback is correct for
  a missing `affectedRows` field. But the cast `as unknown as Array<{
  affectedRows?: number }>` does not check that the result is even an
  array — if drizzle ever returns an object directly (it has done so in
  some MySQL driver versions), `header[0]` reads index 0 of an object,
  which is `undefined`, the optional chain shortcuts, and the fallback
  to 1 fires — but in *every* call, including legitimately-already-used
  tokens. The result: single-use enforcement breaks silently. The path
  is gated by the explicit `if (entitlement.downloadedAt !== null)`
  check at line 85, so the practical risk is bounded — a true race
  between the SELECT and the UPDATE could in theory let two
  near-simultaneous downloads through.
- **Fix:** Use `Array.isArray(result) && result[0]?.affectedRows === 1`
  as the success signal, and only fall back to 1 on a runtime shape
  mismatch that's *also* logged. Tightens the contract without changing
  happy-path behavior.

### C2RPF-CR-LOW-06 — Webhook `customerEmail` truncation can split a multi-byte char
- File: `apps/web/src/app/api/stripe/webhook/route.ts:67`
- Severity: Low | Confidence: Medium
- **What:** `customerEmailRaw.slice(0, 320)` truncates by JS string units
  (UTF-16 code units), not bytes. RFC 5321 limits the email by *octets*
  (bytes). For a Latin-only address this matches; for an email with
  punycode IDN that rendered to a multi-byte form, the slice can split
  a surrogate pair and produce a malformed string. In practice Stripe
  normalizes emails to ASCII for SMTP delivery, so this is a paper edge.
- **Fix:** Either document the assumption ("Stripe normalizes to ASCII")
  in the slice comment, or guard with
  `Buffer.byteLength(s, 'utf8') > 320 ? s.slice(0, 320 - 4) : s`.

### C2RPF-CR-LOW-07 — `deriveLocaleFromReferer` regex permits non-locale 2-letter prefixes
- File: `apps/web/src/lib/license-tiers.ts:52-54`
- Severity: Low | Confidence: High
- **What:** The regex `/^\/([a-z]{2})(?:\/|$)/i` accepts any two ASCII
  letters and then explicitly checks against `SUPPORTED_LOCALES`. That's
  defensive and correct. But the cycle 1 RPF fix added the helper for
  `/api/checkout` — the same logic is duplicated implicitly elsewhere
  (e.g., `proxy.ts` matches `[a-z]{2}` for the locale prefix per the
  cycle 1 deferred AGG-C1-19). The new helper introduces a *third* place
  where supported locales must be kept in sync; AGG-C1-19 already noted
  this drift. Recommend: import a single `LOCALES` constant from
  `lib/constants.ts` (which already has `LOCALES = ['en', 'ko'] as const`)
  and remove the duplicated `SUPPORTED_LOCALES` literal in
  `license-tiers.ts`. Pure DRY hygiene.

### C2RPF-CR-LOW-08 — Photo-viewer checkout-toast effect strips `?checkout=` on success but also clears unrelated query params? No — verified safe; informational
- File: `apps/web/src/components/photo-viewer.tsx:113-117`
- Severity: Informational | Confidence: High
- **What:** `u.searchParams.delete('checkout')` deletes only the checkout
  param. The reconstruction `u.pathname + (u.search ? u.search : '') +
  u.hash` is correct. Confirmed no leakage. Recording for completeness
  because a similar reconstruction pattern is used elsewhere in the app
  (e.g., topic page) and was a finding in earlier cycles. No action
  needed here.

### C2RPF-CR-LOW-09 — `image.title` truncation diverges between checkout and elsewhere
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:117`
- Severity: Low | Confidence: Medium
- **What:** Cycle 1 RPF / N-CYCLE1-03 introduced `titleForStripe = image.title.slice(0, 200)`
  to defensively cap the Stripe `product_data.name` (Stripe limit: 1500
  chars; the 200 cap is conservative). The DB column for image titles
  appears to be larger than 200 chars (admins can set long titles per
  the upload flow). For an image titled with a 250-char poetic
  description, the Stripe receipt will show only the first 200 chars
  with no ellipsis or "…" indicator. A real-world product question:
  is the Stripe receipt name supposed to be the full title or a
  truncated label? Recommend: append `…` when truncation actually
  occurs so the customer sees the elision in the Stripe email receipt.
  (Bonus: makes the slice more obviously intentional.)
- **Fix:** `titleForStripe = image.title.length > 200 ? image.title.slice(0, 199) + '…' : image.title`.

## Issues NOT found this cycle (sweep results)

- All previous-cycle Stripe HIGH/MED findings are addressed in code:
  rate-limit (HIGH-01), checkoutStatus prop wired (HIGH-02), token-hash
  log line removed (MED-01), tier allowlist (MED-02), locale-aware
  redirect (LOW-03), Buy-vs-Download UX gate (LOW-02), Intl currency
  format (LOW-01).
- Webhook signature verification uses Stripe SDK constant-time HMAC.
- Download route has path-traversal containment (lstat + realpath +
  symlink rejection).

## Sweep for commonly-missed issues

Checked: race conditions in single-use download (TOCTOU between SELECT
at line 49 and UPDATE at line 90 — mitigated by atomic UPDATE WHERE
downloadedAt IS NULL); idempotency under Stripe webhook retries (sessionId
UNIQUE + onDuplicateKeyUpdate); CSP/XSS on title in product_data.name
(Stripe escapes server-side); SQL injection (drizzle parameterizes); time-of-
check vs time-of-use on file existence (lstat then createReadStream — OK,
race window is short and the file is read-only). No new issues surfaced.

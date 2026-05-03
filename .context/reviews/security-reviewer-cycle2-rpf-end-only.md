# Security Reviewer — Cycle 2 RPF (end-only)

## Method

Reviewed all paid-tier code paths added in US-P54 with focus on OWASP top 10
(A01 broken access control, A02 cryptographic failures, A03 injection, A04
insecure design, A05 security misconfiguration, A07 identification failures,
A08 software/data integrity, A09 logging failures, A10 SSRF). Cross-checked
against findings already addressed in cycle 1 RPF.

## Findings

### C2RPF-SEC-MED-01 — `customerEmail` is rendered to admin /sales with no XSS-defense layer
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:119`
- Severity: Medium | Confidence: Medium
- **What:** `<td>{row.customerEmail}</td>` — rendered as React JSX text,
  so React escapes the value. That is the right XSS posture for the
  default rendering path. The concern is that `customerEmail` originates
  from `session.customer_details?.email` in Stripe metadata. Stripe
  normalizes well-formed emails, but the value flows unvalidated to a
  screen that the gallery owner reads, and from there potentially into
  CSV exports / email subject lines if the photographer copy-pastes.
- **Concrete failure scenario:** If `session.customer_details?.email`
  ever contains a value Stripe didn't sanitize (their docs say they
  validate per RFC 5321 but historically accept some non-conforming
  unicode), and the photographer pastes the value into a third-party
  email tool, the unicode-direction characters could spoof the
  recipient.
- **Fix (planned, low-effort):** At ingest in
  `webhook/route.ts`, run `customerEmail` through a strict regex match
  (`/^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/`) before storing. Reject
  with a 200 + warning log if the format is malformed; this prevents
  a future Stripe quirk from poisoning the entitlements table.

### C2RPF-SEC-MED-02 — `customer_email` not bound to Checkout session — refunds may go to wrong customer
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:139`
- Severity: Medium | Confidence: Medium
- **What:** The Checkout session is created with `customer_email: undefined`
  (commented). Stripe will collect the email at the hosted checkout. In
  the webhook, `customerEmail` is read from `session.customer_details?.email`
  (collected) or `session.customer_email` (prefilled). Without prefill,
  Stripe accepts whatever the buyer types into Checkout — including a
  typo or a deliberately wrong email. The local entitlement row records
  that wrong address. If the buyer never receives a token (because the
  hash flow dispatched to nobody), they file a chargeback. The
  photographer in /admin/sales has no signal that the email was bogus.
- **Why it matters in the photographer/visitor lens:**
  - Visitor: types `joi+typo@gmail.com`, gets nothing.
  - Photographer: refunds blindly because they have no diagnostic.
- **Fix (planned, deferred candidate):** Add a `Stripe.Refund.create`
  in the same admin /sales row that surfaces a "resend token" affordance
  *before* refunding. Out of scope for this cycle — see plan for
  deferred capture.

### C2RPF-SEC-LOW-01 — Webhook accepts an event whose `metadata.imageId` no longer matches a real image
- File: `apps/web/src/app/api/stripe/webhook/route.ts:96-119`
- Severity: Low | Confidence: High
- **What:** The webhook validates `imageId` is a positive integer but does
  *not* check whether `images` row still exists. If an admin deletes the
  image between checkout-session creation and `checkout.session.completed`,
  the entitlement row inserts with a foreign key reference to the
  (now-deleted) image. The schema has
  `references(() => images.id, { onDelete: 'cascade' })`, so the FK insert
  *fails* (parent missing), which lands in the `catch` block at line 121
  and returns 500. Stripe retries, the same FK error fires, and the
  visitor gets charged but no entitlement row ever lands.
- **Fix (planned):** SELECT the image inside the webhook handler before
  insert. If missing, return 200 (Stripe stops retrying), log a warn,
  and call `stripe.refunds.create({ payment_intent: session.payment_intent })`
  to auto-refund the orphan charge. Closes a real race in the photographer
  workflow.

### C2RPF-SEC-LOW-02 — `Content-Disposition` filename quoting on download route
- File: `apps/web/src/app/api/download/[imageId]/route.ts:148`
- Severity: Low | Confidence: High
- **What:** `'Content-Disposition': \`attachment; filename="${downloadName}"\`` —
  `downloadName` is `photo-${imageId}${ext}`. `imageId` is a validated
  positive integer; `ext` is `path.extname(image.filename_original)
  || '.jpg'`. `path.extname` would never include path separators, but
  it can include unicode characters or unusual chars from a filename
  the admin set. RFC 6266 requires `filename=` to be a quoted-string
  with no unescaped quotes or CRLF. A filename like `bad"name.jpg`
  would inject a stray quote and end the directive early. Probability
  is low because uploads sanitize filenames, but the attack surface
  is real.
- **Fix (planned):** Use only the canonical `photo-${imageId}${safeExt}`
  where `safeExt` is restricted to `.jpg|.jpeg|.png|.webp|.avif|.tif|.tiff`
  by allowlist (any extension outside this set falls back to `.jpg`).
  The original filename is admin-controlled and shouldn't leak to the
  customer anyway.

### C2RPF-SEC-LOW-03 — Webhook does not reject re-replayed `checkout.session.completed` for a refunded entitlement
- File: `apps/web/src/app/api/stripe/webhook/route.ts:111-119`
- Severity: Low | Confidence: Medium
- **What:** Idempotency is by sessionId UNIQUE — `onDuplicateKeyUpdate`
  no-ops on duplicates. But if the entitlement was *refunded*, a
  Stripe replay of the original `checkout.session.completed` event
  (e.g., during a Stripe support replay) would still match the existing
  row and remain refunded — that's correct. The concern: there is no
  log line at the warning level for replays of refunded sessions, so
  audit visibility is low. Operational signal only.
- **Fix (planned, defer):** Add a SELECT before INSERT: if
  `refunded === true`, log warn "replayed completed event for refunded
  session" and return 200 without a DB write. Operational hygiene.

### C2RPF-SEC-LOW-04 — Missing security-headers on `/api/download` for binary streams
- File: `apps/web/src/app/api/download/[imageId]/route.ts:145-153`
- Severity: Low | Confidence: High
- **What:** The response sets `X-Content-Type-Options: nosniff` and
  `Content-Type: application/octet-stream`. Good. It does NOT set
  `Content-Security-Policy`, `Cross-Origin-Opener-Policy`, or
  `Cross-Origin-Resource-Policy`. For a downloadable binary asset
  this is acceptable, but `Content-Disposition: attachment` makes
  the browser treat it as a download, so the headers above are not
  strictly required. Informational only — current posture is safe.
- No fix planned this cycle.

### C2RPF-SEC-LOW-05 — Refund flow allows refund of an entitlement after the Stripe payment_intent has expired/been disputed
- File: `apps/web/src/app/actions/sales.ts:115-130`
- Severity: Low | Confidence: Medium
- **What:** `stripe.refunds.create` will fail with a Stripe error
  (`charge_already_refunded` or similar) if the underlying charge is
  in a non-refundable state (e.g., disputed, already-refunded by
  Stripe support). The action catches the error and returns
  `err.message`, which is then *displayed in the toast* via
  `${t.refundError}: ${result.error}`. The error message from Stripe
  may contain a Stripe-internal trace id or charge id that is mildly
  PII-adjacent. Concern: an admin sharing a screenshot of /admin/sales
  during support discussion may leak Stripe-internal identifiers.
- **Fix (planned):** Map known Stripe error codes to localized strings,
  log the full error server-side, and return only the localized message
  to the client. Same convention as the rest of the action surface
  (e.g., `'sales.refundErrorAlreadyRefunded'`).

## Issues NOT found this cycle

- Stripe signature verification: confirmed constant-time HMAC via SDK.
- Single-use download enforcement: atomic UPDATE WHERE downloadedAt IS NULL.
- Path traversal: lstat + realpath + symlink reject pattern is correct.
- Token randomness: 32 bytes from `crypto.randomBytes` is cryptographically
  sound (256-bit entropy).
- Constant-time hash comparison: `timingSafeEqual` over equal-length buffers.
- SQL injection: drizzle parameterizes consistently.

## Sweep for commonly-missed issues

Checked: timing oracle on `/api/download` (404 vs 403 vs 410 — they all
return early after equivalent DB+hash work — no observable timing channel);
SSRF in Stripe SDK calls (no user-controlled URL); JWT/session secret
exposure (none stored in entitlements); webhook replay across environments
(sessionId is globally unique in Stripe); race between webhook and
admin-delete of image (covered above as C2RPF-SEC-LOW-01). No new high
findings.

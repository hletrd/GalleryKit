# Cycle 1 (RPF, photographer/visitor lens) — Aggregate Review

## Method

Single-agent fan-in review focused exclusively on the cycle thematic lens:
- (a) **Professional photographer** publishing already-finalized work.
- (b) **End user / visitor** browsing, sharing, paying, downloading.

Out-of-scope per cycle directive: edit / scoring / culling / proofing / selection /
retouch / develop / preset / export-recipe functionality. Photos arrive finalized.

The previous 25 deep-review cycles closed almost every long-standing
security/correctness finding. This cycle explicitly looks at the **newest feature
surfaces** added since cycle 25 — most significantly the US-P54 Stripe
checkout / entitlement / single-use download flow shipped in commits cdaa578…42094bf,
plus the analytics, semantic-search, alt-text, and smart-collections additions —
through the photographer/visitor lens.

## Gate baseline (entering the cycle)

- `git status` clean on master, up to date with origin.
- `eslint` clean.
- `lint:api-auth` and `lint:action-origin` are green (newer routes are correctly
  outside `/api/admin/`, so the api-auth scanner does not apply, and they
  are not server-action files for the action-origin scanner).
- Vitest: `auth-rate-limit*`, `csv-escape`, `download-tokens`, etc., all passing.

## Findings (severity sorted)

### C1RPF-PHOTO-HIGH-01 — Stripe Checkout has no rate limit (visitor lens)

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts`
- Severity: **High** | Confidence: **High**
- **What:** `POST /api/checkout/[imageId]` is a public, unauthenticated endpoint
  that calls `stripe.checkout.sessions.create()` on every request. There is no
  per-IP rate limit. A scripted abuser can pin one image and spam this endpoint
  to (a) burn through the gallery owner's Stripe API rate budget, (b) inflate
  Stripe's audit logs with junk sessions, and (c) cost the photographer real
  money in some Stripe pricing tiers. The endpoint is also a CPU + DB hot path
  (image SELECT + admin_settings SELECT + outbound HTTPS to Stripe).
- **Why it matters in the cycle lens:**
  - Photographer: their Stripe dashboard becomes unusable from spam, and they
    might hit Stripe rate limits during a real customer's checkout window.
  - Visitor: a real customer's checkout session may be denied during an attack.
- **Fix (planned):** Add an in-memory per-IP rate limit consistent with the
  existing patterns in `lib/rate-limit.ts` (e.g. `CHECKOUT_MAX_REQUESTS=10` per
  60s window, with rollback on Stripe failure so a real network hiccup does not
  punish a customer). Use the OG/share rate-limit Pattern 2 (rollback on
  infrastructure error).

### C1RPF-PHOTO-HIGH-02 — Visitor never sees their download token after paying (UX data-loss)

- Files:
  - `apps/web/src/app/api/stripe/webhook/route.ts`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/messages/en.json` / `ko.json`
- Severity: **High** | Confidence: **High**
- **What:** On `checkout.session.completed`, the webhook generates a
  single-use download token and stores **only the SHA-256 hash** in the
  entitlement row. The plaintext token is logged to `console.info` and surfaced
  in the admin `/sales` view "for manual distribution"; the visitor is then
  redirected back to `/p/{id}?checkout=success` — a page that **does not read
  the `checkout` query param** and shows no UI confirming the purchase, no
  toast, no download link, no email-pending state.
- **Concrete failure scenario (visitor lens):** A customer pays $X, Stripe
  redirects them to the photo page, they see the same Buy button they clicked
  three minutes ago. They have no proof of purchase, no download path, no
  hint that the gallery owner is the bottleneck. They will (rationally) issue
  a chargeback. The repo's own `CLAUDE.md` calls Stripe + entitlements a
  shipped feature, so this is a deployed UX cliff, not an unreleased prototype.
- **Why it matters in the cycle lens:**
  - Visitor: pays, gets nothing visible — direct data-loss + likely refund.
  - Photographer: receives chargebacks and has to manually mail download
    tokens from the admin /sales view, with no audit trail of who-got-which.
- **Fix (planned, this cycle):** On the photo page, read `searchParams.checkout`
  on the server and pass a `checkoutStatus` prop to the photo viewer. The
  photo viewer surfaces a `toast.success(t('stripe.checkoutSuccess'))` (key
  already exists in en/ko, currently dead) on success and
  `toast.info(t('stripe.checkoutCancelled'))` on cancel. This is a minimal,
  truthful UI signal that does not over-promise (the token still flows
  through admin distribution per current design) but tells the visitor:
  "purchase received, download link is being prepared." Closes the silent-page
  cliff. A follow-up plan entry covers automatic email-of-token (deferred to
  the customer-email pipeline owner — see plan-100 below).

### C1RPF-PHOTO-MED-01 — Webhook logs hash + customer email + sessionId at info level

- File: `apps/web/src/app/api/stripe/webhook/route.ts:99`
- Severity: **Medium** | Confidence: **High**
- **What:** `console.info(\`Entitlement created: imageId=${imageId} tier=${tier}
  session=${sessionId} tokenHash=${downloadTokenHash}\`)` writes the customer's
  Stripe session id and the (hashed, but PII-adjacent) token hash to stdout
  every successful checkout. While the hash itself is not the token, log
  retention/aggregation systems (Datadog, Loki, Papertrail) are now
  semi-permanently storing transaction-level records that include the Stripe
  session id (which Stripe support can use to look up customer PII).
- **Why it matters in the cycle lens:**
  - Photographer: their stdout log is now a reduced-form ledger of every
    customer transaction. If logs are shipped offsite, that is a privacy
    surface they did not consciously opt into.
- **Fix (planned):** Drop the token hash from the log line. Keep only
  `imageId`, `tier`, `sessionId` for audit. Move customer email out of any
  log statement (already absent — confirm). Consider downgrading to
  `console.debug` so production log level can suppress it without losing
  warnings.

### C1RPF-PHOTO-MED-02 — `tier` from Stripe metadata is not allowlist-checked at webhook ingest

- File: `apps/web/src/app/api/stripe/webhook/route.ts`
- Severity: **Medium** | Confidence: **Medium**
- **What:** `session.metadata?.tier` is taken at face value and inserted into
  `entitlements.tier`. If a misconfigured admin or a different upstream
  Checkout flow ever sets `tier='admin'` or `tier='<script>'` in metadata,
  the webhook records it. The DB column is presumably typed as `varchar`,
  so the row would land. Downstream rendering (admin /sales) would be the
  first place this surfaces.
- **Fix (planned):** At webhook ingest, validate `tier` against the same
  allowlist used in `/api/checkout` (`editorial`, `commercial`, `rm`).
  Reject (return 200 + log warn) if not in the allowlist, to prevent
  poisoning the entitlements table from a Stripe metadata typo.

### C1RPF-PHOTO-LOW-01 — Buy button label is not localized for currency formatting

- File: `apps/web/src/components/photo-viewer.tsx:441`
- Severity: **Low** | Confidence: **High**
- **What:** The button shows `${t('stripe.buy')} ($${(price/100).toFixed(2)})`
  — hardcoded `$` and US-style fixed-2 decimals, regardless of the user's
  locale. A Korean visitor sees "$12.00" instead of "₩12.00" or
  `Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'USD' }).format()`.
  The Stripe checkout itself is `currency: 'usd'` so the underlying charge is
  correct, but the prefix and decimal style do not match the visitor's locale.
- **Fix (planned):** Use
  `new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(price/100)`
  for the button text. The actual Stripe currency stays USD.

### C1RPF-PHOTO-LOW-02 — Download button on /p/[id] always points at the public JPEG, even for paid tiers

- File: `apps/web/src/components/photo-viewer.tsx:778-787`
- Severity: **Low** | Confidence: **High**
- **What:** The CardFooter "Download JPEG" button is always rendered when
  `image.filename_jpeg` is set, regardless of `license_tier`. For an image
  with `license_tier !== 'none'`, the photographer presumably wants the
  free download path gated. The JPEG that is served is a derivative
  (typically `2048px` long-edge), so a paying customer who buys the
  "editorial license" still gets the same JPEG every visitor can download
  for free. This is a legitimate product question (some galleries
  intentionally sell licensing rights, not pixels) but at minimum the UI
  should not show "Download" next to "Buy ($X)" without disclosure.
- **Fix (planned):** Hide the inline "Download JPEG" button when
  `license_tier !== 'none'`. The post-purchase download path (via
  `/api/download/[imageId]?token=...`) covers the licensed download.
  Photographers who want gratis downloads keep `license_tier='none'` and
  the button stays.

### C1RPF-PHOTO-LOW-03 — `success_url` and `cancel_url` are not locale-aware

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:99-100`
- Severity: **Low** | Confidence: **High**
- **What:** `success_url = ${origin}/p/${image.id}?checkout=success`. There is
  no locale prefix, so a Korean visitor whose original URL was
  `/ko/p/123` will be sent back to `/p/123?checkout=success`. The middleware
  will redirect to the default locale, breaking the translated context.
- **Fix (planned):** Read the visitor's locale from the request header
  (the `accept-language` header or, simpler, the referer) and prefix the
  success/cancel URLs with `/${locale}/`. As a minimal fix, derive the
  locale from `request.headers.get('referer')` matching `/^\/?(en|ko)\//`
  with a fallback to the default locale.

### C1RPF-PHOTO-LOW-04 — Webhook does not record the visitor's locale, so eventual receipt email cannot be localized

- Severity: **Low** | Confidence: **Medium**
- **What:** Forward-looking: the webhook stores
  `imageId, tier, customerEmail, sessionId, amountTotalCents, downloadTokenHash, expiresAt`
  but no locale. When the email pipeline ships, it will not know what
  language to send the receipt in.
- **Fix (deferred — plan-100 below).** Capture in a follow-up plan, do not
  block this cycle.

### C1RPF-PHOTO-LOW-05 — `bg-black/50 text-white` photo-counter chip on home/photo viewer can fail WCAG AA on light photos

- File: `apps/web/src/components/photo-viewer.tsx:568`
- Severity: **Low** | Confidence: **Medium**
- **What:** The position chip ("3 / 12") is `bg-black/50` over the photo
  itself. Over a bright photo, the 50% black background may not give the
  white text 4.5:1. Consider `bg-black/70` (already in use elsewhere) or
  add a subtle `backdrop-blur-sm` for safety. Also relevant for the
  visitor lens because this is the only "where am I in the gallery"
  affordance.
- **Fix (planned, batched with HIGH-02):** Bump to `bg-black/70`.

## OUT-OF-SCOPE (per cycle directive)

The following items would have been findings under a generic review but
are explicitly excluded by the cycle directive (no edit / scoring /
culling / proofing / selection / retouch / develop / preset / export
recipe). Recorded here for transparency:

- (none surfaced this cycle — the lens already restricted reviewer attention)

## AGENT FAILURES

None — single-reviewer pass executed inline with explicit cycle lens.

## Cross-cycle agreement

C1RPF-PHOTO-HIGH-01 (no rate limit on `/api/checkout`) is the same posture
that drove the OG-route rate-limit fix (cycle 8 plan-233). The repo has an
established convention for rate-limiting public CPU/DB-bound surfaces
(Pattern 2 in `lib/rate-limit.ts`), and the new Stripe surface was shipped
without that convention applied. High signal.

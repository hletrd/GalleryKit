# Tracer — Cycle 2 RPF (end-only)

## Method

Causal trace through the paid-tier user journey, identifying competing
hypotheses for failure modes that the existing code/tests don't fully
exercise.

## Trace 1 — Customer pays but never receives a download link

### Timeline
1. Visitor clicks "Buy ($X)" → `photo-viewer.tsx:455-475`.
2. POST `/api/checkout/[imageId]` → rate-limit pass → DB SELECT image →
   DB SELECT price → Stripe Checkout session created → return `{ url }`.
3. Visitor redirected to Stripe Checkout → enters card + email → pays.
4. Stripe redirects visitor to `${origin}/${locale}/p/${imageId}?checkout=success`.
5. Stripe POSTs `checkout.session.completed` to `/api/stripe/webhook`.
6. Webhook validates signature → reads metadata → INSERTs entitlement row.
7. Visitor sees toast "Purchase complete! Your download link is being prepared."

### Failure modes (competing hypotheses)
- **H1 (most likely):** The webhook completed cleanly, but the
  plaintext token was dropped at line 105 (`const { hash } = …`) and
  never escaped the function scope. Photographer in /admin/sales sees
  customer email but no token to send. Customer waits indefinitely.
  → C2RPF-CR-MED-01 / CRIT-01.
- **H2:** Webhook race with image-delete. The image was deleted
  between checkout and webhook delivery → FK insert fails → 500 →
  Stripe retries → same FK error → never lands. Visitor charged, no
  entitlement row. → C2RPF-SEC-LOW-01.
- **H3:** Webhook delivery itself failed (network blip). Stripe retries
  per their retry schedule (up to 3 days), but during the retry window
  the `?checkout=success` page already showed the toast — visitor's
  expectation was set before the row existed. Lower confidence;
  Stripe's retry semantics make this transient.
- **H4:** Visitor used Stripe's "remember email for next time" and
  the email Stripe collected differs from the one the photographer
  expects. Photographer might still send the token, but to a
  customer who can't recognize it.

### Action
H1 is dominant. Schedule fix per CRIT-01 / C2RPF-CR-MED-01.

## Trace 2 — Refund succeeds but customer's already-issued download still works

### Timeline
1. Customer pays → entitlement row created with downloadTokenHash.
2. Customer downloads → atomic UPDATE clears downloadTokenHash, sets
   downloadedAt = NOW().
3. Customer requests refund.
4. Photographer clicks Refund in /admin/sales →
   `refundEntitlement(id)` → Stripe refund created → entitlement row
   set to `refunded: true, downloadTokenHash: null`.

### Failure modes
- **H1:** Customer downloaded already (downloadedAt set) → refund
  doesn't recover the file the customer has on disk. Stripe refund
  is the only signal; the download already happened. This is a
  business decision (the photo is already in the customer's hand)
  and is likely intentional. Not a bug.
- **H2:** Customer never downloaded; downloadTokenHash was set; refund
  fires; downloadTokenHash is cleared; customer attempts download →
  the route's `if (entitlement.refunded)` guard at
  `download/[imageId]/route.ts:80` blocks with 410 Gone. Plus the
  `verifyTokenAgainstHash` check at line 70 fails (storedHash is now
  null). Both layers correctly reject. Confirmed safe.
- **H3:** A *concurrent* download and refund. The atomic UPDATE in
  the download route (`UPDATE … WHERE downloadedAt IS NULL`) happens
  in one transaction; the refund's UPDATE (`SET refunded = true,
  downloadTokenHash = null`) happens in another. If they interleave,
  the row could end with `refunded=true, downloadedAt=now()`. Net
  effect: the customer got the file *and* the refund. This is a
  business edge case but not a security failure.

### Action
H3 is the only remaining concern. Acceptable per business semantics;
no fix.

## Trace 3 — Visitor on /ko/p/1 → checkout → returns to /ko/p/1?checkout=success

### Timeline
1. Visitor is on `/ko/p/1`.
2. Clicks Buy → POST `/api/checkout/1`.
3. Server: `referer = '/ko/p/1'` → `deriveLocaleFromReferer = 'ko'` →
   `success_url = ${origin}/ko/p/1?checkout=success`.
4. Stripe redirects to `${origin}/ko/p/1?checkout=success`.
5. Page renders in ko locale; viewer toasts in ko.

### Failure modes
- **H1:** The Korean visitor opened the photo via direct link
  (no referer) — the `referer` header is absent. `deriveLocaleFromReferer`
  returns DEFAULT_LOCALE ('en'). Visitor lands on `/en/p/1?checkout=success`
  instead of `/ko/p/1?checkout=success`. Korean toast doesn't show
  because the page is now in English locale. Surprising UX, not a
  data loss. The fetch from photo-viewer Buy button always has a
  referer because it's a same-origin POST from a real page, so this
  is unlikely in practice.
- **H2:** A privacy-preserving browser strips referer. Same as H1.
  Same low-impact surprising UX.
- **H3:** The visitor's locale was set via cookie/header but the URL
  was not localized. Then the page is reachable at `/p/1` (no locale)
  and the proxy injects `/en/p/1` per default-locale rules. `referer`
  reads as `/p/1` (no locale) → DEFAULT_LOCALE. Same low-impact case.

### Action
Acceptable — the locale derivation is best-effort and fails open to
default locale. No fix.

## Cross-trace conclusion

Trace 1 H1 is the dominant unsolved problem. Other traces show the
flow is otherwise robust.

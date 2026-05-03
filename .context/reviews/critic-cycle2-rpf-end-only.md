# Critic — Cycle 2 RPF (end-only)

## Method

Multi-perspective critique of the paid-tier surface as a *complete user
journey*: pre-purchase, checkout, post-redirect, distribution,
post-distribution, refund, audit. Each perspective tested against the
shipped code.

## Critiques

### CRIT-01 — The "manual distribution" flow is a workflow vacuum
- Files: `webhook/route.ts`, `actions/sales.ts`, `sales-client.tsx`
- Severity: High | Confidence: High
- **The story the code tells:** "On checkout success we generate a
  download token, store its hash, surface it in /admin/sales for manual
  distribution by the photographer."
- **What the code actually does:** Generates the token (line 105 of
  webhook), drops the plaintext at the `const { hash } = …`
  destructure, persists only the hash. The /admin/sales view has no
  field for the plaintext token. The customer email is shown, the
  refund button is shown, the *thing the photographer is supposed to
  send to the customer* is nowhere on the screen.
- **Why this matters:** Cycle 1 RPF acknowledged this as a "deferred
  to the customer-email pipeline" issue. But the *minimum viable*
  path — log the plaintext to stdout for ops to grep, or stash in a
  short-lived in-memory map keyed by sessionId for the next /admin/sales
  load — is also missing. The shipped feature is a half-loop: payment
  works, the customer is told "your link is being prepared", and then
  there's literally no way for the photographer to retrieve the link
  to send.
- **Required fix (this cycle):** At minimum, add a `console.info` line
  in the webhook that contains the plaintext token AND the customer
  email AND the imageId AND the sessionId, gated behind a clearly
  named env var (`LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`) and document
  the operational requirement: "Until US-P54 phase 2 (email pipeline)
  ships, the gallery owner MUST set `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`
  and grep server logs for `session=cs_xxx` to find the token to email
  to a customer." This makes the workflow honest without changing the
  data shape.
- **Better fix (deferred):** Either ship the email pipeline, or stash
  the plaintext in a `pending_download_tokens` table with a 1h TTL
  and surface a "Copy download URL" button in /admin/sales while the
  row is fresh.

### CRIT-02 — The success toast lies about a flow that doesn't exist
- File: `apps/web/messages/en.json:703`, `ko.json:677`
- Severity: Medium | Confidence: High
- **The copy:** "Purchase complete! Your download link is being prepared."
- **The reality:** No background process is preparing anything. The token
  was generated synchronously inside the webhook and is currently
  unrecoverable except via raw DB access (only the hash is stored, and
  even the hash is null after first download). The customer is being
  told a comforting lie.
- **Why this matters in the visitor lens:** When the customer doesn't
  receive a link in 5 minutes / 1 hour / 24 hours, the toast copy
  ("being prepared") implies *active work in progress* that the
  photographer hasn't actually scheduled. The customer's expectation
  was set higher than the service can deliver.
- **Fix (this cycle):** Either:
  1. Soften the copy: "Purchase complete! The gallery owner will email
     your download link shortly."  → still a promise, but moves the
     responsibility to the human in the loop.
  2. Or: explicitly state contact: "Purchase complete! Email
     [photographer email] if your download link doesn't arrive within 24h."
  Recommend (1) for this cycle as the lower-risk copy change. Combine
  with CRIT-01 fix.

### CRIT-03 — Refund flow has no confirmation step
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:131-142`
- Severity: Medium | Confidence: High
- **The button:** Single click on "Refund" → server action → Stripe
  refund created.
- **What's missing:** No confirm dialog. No second-click. No "Are you
  sure?" prompt. A misclick in the row above the one the photographer
  meant to refund triggers a real-money operation. Stripe refunds
  *cannot* be undone — once the refund is created, the money is gone
  and the entitlement is permanently `refunded = true`.
- **Why this matters:** The repo has a `cycle39-confirm-dialog-consistency`
  plan history (cycle 39) that rolled out confirmation dialogs across
  destructive admin actions. The refund button shipped without that
  pattern.
- **Fix (this cycle):** Wrap `handleRefund` in a `<AlertDialog>` from
  the existing UI primitives. Include the customer email, image title,
  and amount in the confirmation copy. Pattern already exists in
  `image-manager.tsx` for delete and elsewhere.

### CRIT-04 — Buy button does not surface tier name to the visitor
- File: `apps/web/src/components/photo-viewer.tsx:476-493`
- Severity: Low | Confidence: High
- **The button:** "Buy ($12.00)" — only the price.
- **What's missing:** The tier name (`editorial` / `commercial` / `rm`).
  A visitor seeing two photos at the same price has no way to tell
  whether the license is editorial-only or commercial-permitted. The
  tier is encoded in the database, used in the Stripe checkout
  (`name: '${title} — ${tier} license'`), but hidden from the visitor
  on the page.
- **Why this matters:** Visitors making informed purchase decisions
  need to see what they're licensing. "Editorial license" vs "Commercial
  license" matters for downstream use; both are at most a $5 difference
  but legally important.
- **Fix (deferred):** Render the tier as a small label below or
  beside the price. Requires translation strings (`stripe.tierEditorial`,
  `stripe.tierCommercial`, `stripe.tierRm`).

### CRIT-05 — The cycle 1 fix to suppress the inline "Download JPEG" button on paid images is correct but unannounced
- File: `apps/web/src/components/photo-viewer.tsx:840`
- Severity: Low | Confidence: High
- **What changed:** Cycle 1 RPF / C1RPF-PHOTO-LOW-02 hid the gratis
  Download button on `license_tier !== 'none'` images.
- **What the visitor sees now:** A Buy button only, no explanatory
  copy. A visitor on a paid photo who clicks around the page sees no
  indication that "this photo is licensed; buying gets you a higher-
  resolution download." They might assume the gallery is free and
  the Buy button is for some other purpose.
- **Fix (deferred):** Add a small explanatory line ("Licensing: pay
  to download") near the Buy button. Or make the Buy button more
  prominent (icon + tier label). UX polish, not a functional bug.

### CRIT-06 — The `expiresAt` of 24h is undocumented in customer-facing copy
- File: `webhook/route.ts:107`, `messages/en.json` and `ko.json`
- Severity: Low | Confidence: High
- **The mechanic:** The download token expires 24h after entitlement
  creation. The success toast says "your download link is being prepared"
  — no mention of expiry. If the photographer sends the link 25h after
  payment, the customer gets a 410 Gone with no recourse short of refund.
- **Fix (deferred):** Either lengthen the TTL (e.g., 7 days) or make the
  expiry explicit in the post-checkout copy ("Your download link is
  valid for 24h after delivery — please use promptly"). Recommend
  lengthening; 24h is too tight for a manual-distribution workflow.

## Cross-cutting observations

The shipped Stripe feature is *technically* correct (signature
verification works, single-use enforcement works, idempotency works,
rate-limit works) but operationally incomplete. The previous cycle's
review focused on technical correctness and added safety rails (rate
limit, allowlist, log scrub, locale-aware redirect, currency format,
checkout-status toast). This cycle's critique is about the *workflow
gap* that those technical fixes don't close: the actual
photographer-customer handoff is not implemented. The plan should
schedule at minimum CRIT-01 (token visibility) and CRIT-03 (refund
confirm) for this cycle, and defer CRIT-04, CRIT-05, CRIT-06 with
explicit exit criteria.

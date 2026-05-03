# Architect — Cycle 2 RPF (end-only)

## Method

Architectural read of US-P54 paid-tier subsystem and how it composes
with the rest of the codebase: data layering, module boundaries, layer
violations, coupling, and configuration.

## Findings

### C2RPF-ARCH-MED-01 — Paid-tier feature has no end-to-end flow doc — workflow is implicit
- Files: `apps/web/src/app/api/checkout/`, `webhook/`, `download/`,
  `actions/sales.ts`, `messages/en.json`, `messages/ko.json`
- Severity: Medium | Confidence: High
- **What:** The Stripe feature spans 5 surfaces (checkout API, webhook
  API, download API, sales action, photo viewer UI) and the operational
  workflow connecting them (where does the plaintext token go? who
  emails the customer?) is documented only in inline code comments
  saying "manual distribution / deferred to email pipeline." No
  central architecture doc, no PRD reference, no admin-facing
  README section. Maintainers in cycle 3+ inherit the system as a
  half-loop.
- **Fix (planned):** Add a short architecture section to
  `apps/web/README.md` (Stripe section) or a new
  `apps/web/docs/stripe-paid-downloads.md` describing the end-to-end
  flow, the deferred email pipeline, and the operational requirement
  for token retrieval until the email pipeline ships. Pure docs, no
  code change. Closes the orientation gap.

### C2RPF-ARCH-LOW-01 — `getStripe()` lazy init has a hidden first-call latency
- File: `apps/web/src/lib/stripe.ts:21-32`
- Severity: Low | Confidence: High
- **What:** `getStripe()` lazily constructs the Stripe SDK on first
  call. The Stripe SDK reads `process.env.STRIPE_SECRET_KEY` at
  construction time, which means the value is captured *once* and
  ignored if rotated. Combined with the lazy init, a deploy that
  rotates `STRIPE_SECRET_KEY` between webhook receipts will continue
  using the old key until the Node process restarts. This is correct
  Stripe SDK semantics (and matches their guidance), but the
  documentation should be explicit: "rotate STRIPE_SECRET_KEY → restart
  the web container."
- **Fix (planned, low-effort):** Add to the docstring at the top of
  `lib/stripe.ts` and to the Stripe section of `apps/web/README.md`.

### C2RPF-ARCH-LOW-02 — `entitlements` table couples to `images` via FK with cascade-delete
- File: `apps/web/src/db/schema.ts:251-266`
- Severity: Low | Confidence: High
- **What:** `imageId: int("image_id").references(() => images.id, {
  onDelete: 'cascade' })`. Deleting an image cascades to its
  entitlements rows. From the photographer's lens, deleting a sold
  photo silently destroys the audit trail of who bought it. From the
  visitor's lens, the customer's purchase history is lost. From a
  legal lens, this can wipe records the photographer might need for
  tax / accounting / dispute resolution.
- **Why this matters:** Cascading delete on financial records is a
  data-integrity smell. Best practice: keep entitlements rows even
  after the image is deleted, with a soft-delete marker on the image
  side or a `null`able imageId on entitlement.
- **Fix (deferred):** Either change to `onDelete: 'set null'` (requires
  making `imageId` nullable) or block the image-delete admin action
  when entitlements with `refunded = false` exist. The latter is more
  intuitive ("you can't delete a photo with active customer
  entitlements"). Out of scope this cycle — schema change.

### C2RPF-ARCH-LOW-03 — `lib/license-tiers.ts` mirrors `lib/constants.ts` LOCALES
- File: `apps/web/src/lib/license-tiers.ts:40-42`
- Severity: Low | Confidence: High
- **What:** `const SUPPORTED_LOCALES = ['en', 'ko'] as const;` is
  duplicated from `lib/constants.ts`'s `LOCALES`. AGG-C1-19 (cycle 1
  deferred) already noted that locale literals are hardcoded across
  the codebase (proxy.ts, nginx, license-tiers, etc.) and that
  consolidating them is a future-locale task. The new helper added
  in cycle 1 RPF reintroduces the same drift.
- **Fix (planned, low-effort):** Import `LOCALES` from
  `lib/constants.ts` in `lib/license-tiers.ts` and remove the local
  literal. Trivial DRY hygiene; does not break the AGG-C1-19 deferred
  scope (proxy.ts/nginx are still hardcoded by repo policy).

### C2RPF-ARCH-LOW-04 — `actions/sales.ts` mixes server action and read-only getter conventions
- File: `apps/web/src/app/actions/sales.ts:31-91`
- Severity: Low | Confidence: High
- **What:** `listEntitlements` and `getTotalRevenueCents` are tagged
  `@action-origin-exempt: read-only admin getter` to bypass the
  same-origin check that `lint:action-origin` enforces. The exemption
  is correct — these are read-only — but it makes /admin/sales the
  only page in the codebase where the server actions are split into
  "exempt readers" and "non-exempt mutations" inside the same module.
  Other admin actions (e.g., `actions/admin-users.ts`) keep the
  read-only data fetches as server-component data fetches via
  `import` directly, not action calls. The split here makes future
  refactor harder.
- **Fix (deferred):** Move `listEntitlements` and `getTotalRevenueCents`
  into a `lib/sales-data.ts` server-only module that the page
  imports directly, keeping `actions/sales.ts` for the mutation
  (`refundEntitlement`) only. Architectural cleanup; out of scope
  this cycle.

### C2RPF-ARCH-LOW-05 — `download-tokens.ts` does not export the plaintext token from the webhook layer
- File: `apps/web/src/lib/download-tokens.ts:20-30` and consumer in webhook
- Severity: Informational | Confidence: High
- **What:** The plaintext token is generated in webhook scope, then
  silently dropped (only `hash` is destructured). For the manual-
  distribution flow described in the docstring to work, the plaintext
  must escape webhook scope — into a log line, into a side table,
  into a transient memory cache, or into an outbound email. None of
  these channels exist in code. The architecture is incomplete.
- **Fix (this cycle):** See CRIT-01 in the critic review. At minimum,
  add a stdout log line under an env-flag for ops to grep.

## Cross-cycle agreement

C2RPF-ARCH-MED-01 (architecture doc gap) reinforces CRIT-01 / C2RPF-CR-MED-01
from the code-reviewer / critic reviews. High-signal: three reviewers
independently surfaced the same workflow vacuum.

C2RPF-ARCH-LOW-03 (LOCALES duplication) was deferred at AGG-C1-19 in
cycle 1 and the new helper reintroduces the drift; high-signal
candidate to consolidate now since the new helper is small.

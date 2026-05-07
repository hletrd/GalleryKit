# Designer — Cycle 2 RPF (end-only)

## Method

UI/UX review of paid-tier visitor and admin surfaces. The repo IS a
web frontend (Next.js + React + Tailwind + shadcn UI), so the UI/UX
reviewer applies. Multimodal limitation: review against DOM/aria
semantics, computed styles in source, and structural inspection — no
screenshots in this pass. The repo doesn't have a hot-reload dev
server running in this session, so live `agent-browser` interaction
is out of scope for this offline review.

## Findings

### C2RPF-DSGN-MED-01 — Refund button is not behind a confirmation
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:131-142`
- Severity: Medium | Confidence: High
- **What:** A single click → server action → real Stripe refund. No
  AlertDialog, no two-step confirm, no recovery path. Same severity
  as a delete button, but worse because the Stripe refund cannot be
  undone (the cycle 39 confirm-dialog pattern was rolled out for
  destructive actions; refund is destructive). The button is also
  visually identical to non-destructive buttons elsewhere (variant
  outline).
- **Fix (planned):** Wrap with `<AlertDialog>` from existing UI
  primitives (e.g., `image-manager.tsx` delete pattern). Confirmation
  copy should include the customer email, image title, and amount in
  visitor's locale. Match cycle 39 convention.

### C2RPF-DSGN-MED-02 — Refund button has no destructive variant
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:134`
- Severity: Medium | Confidence: High
- **What:** `variant="outline"` on the refund button. Refund is
  destructive (irreversible money movement). Tailwind `outline`
  variant is neutral. Compared to the delete button in admin
  /images and /tags (which uses `variant="destructive"` red),
  the refund button is visually under-emphasized.
- **Fix (planned):** Use `variant="destructive"` (or "outline" with
  a destructive class accent). Match the cycle 32 / 39 polish for
  delete buttons.

### C2RPF-DSGN-MED-03 — /admin/sales table has no responsive treatment
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:91-149`
- Severity: Medium | Confidence: High
- **What:** The table has 7 columns (Date, Photo, Tier, Email, Amount,
  Status, Actions). Wrapped in `<div className="overflow-x-auto">`
  for horizontal scroll on mobile, but the columns aren't priority-
  ordered for mobile. Customer email column is the widest content
  and is in the middle, pushing the Refund button off-screen by
  default on viewports < ~700px. The `<table>` does not have
  `<caption>` or `aria-label`, so screen readers announce it as a
  generic table.
- **Fix (planned):** Add `<caption>` for screen readers; add
  `<th scope="col">` markup; consider a stacked-layout variant for
  mobile (`hidden md:table-cell` on email + tier columns, render
  them as expandable details on mobile). Out-of-scope-ish; minimum
  is the caption + scope attributes.

### C2RPF-DSGN-LOW-01 — `getStatus` returns text-only — no visual icon for at-a-glance scanning
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:120-130`
- Severity: Low | Confidence: High
- **What:** The Status column uses colored text only (red for
  refunded, green for downloaded, muted for expired, amber for
  pending). For users with red-green color blindness, refunded vs
  downloaded look identical. WCAG 2.2 Success Criterion 1.4.1
  recommends not relying on color alone for status conveyance.
- **Fix (planned):** Add a small lucide-react icon next to the status
  text — e.g., `<Check>` for downloaded, `<RotateCcw>` for refunded,
  `<Clock>` for pending, `<XCircle>` for expired. The icon + color
  + text triple-encodes the status.

### C2RPF-DSGN-LOW-02 — Buy button in photo viewer does not show tier
- File: `apps/web/src/components/photo-viewer.tsx:476-493`
- Severity: Low | Confidence: High
- **What:** "Buy ($X.XX)" — no tier label. A photo with `editorial`
  vs `commercial` license at the same price looks identical to the
  visitor. The tier flows correctly through to Stripe as
  `${title} — ${tier} license` in the line item, but the visitor
  doesn't see it in the *click* phase.
- **Fix (deferred):** Add a small subtitle line below the button or
  a tier badge near it. Requires translation strings.

### C2RPF-DSGN-LOW-03 — Toast for cancel on `/p/{id}?checkout=cancel` is `toast.info` but copy is muted
- File: `apps/web/messages/en.json:704`, `ko.json:678`
- Severity: Low | Confidence: High
- **What:** Cancel toast: "Checkout cancelled." — terse and
  non-actionable. The visitor cancelled themselves; the toast is
  redundant. A more useful copy would either be empty (no toast,
  since the user knows they cancelled) or include a CTA: "Cancelled.
  Try again any time."
- **Fix (deferred):** Soften the cancel copy to include a friendly
  CTA. Lowest priority.

### C2RPF-DSGN-LOW-04 — Hidden gratis Download button leaves an empty CardFooter on paid images
- File: `apps/web/src/components/photo-viewer.tsx:830-850`
- Severity: Low | Confidence: High
- **What:** When `image.license_tier !== 'none'`, the `<CardFooter>` at
  line 830 renders with no children (the only child is the gratis
  download button, which is hidden). The empty CardFooter still
  applies its padding, leaving a visible gap below the image
  metadata block. Not a layout break, but an ungainly empty space.
- **Fix (planned):** Wrap `<CardFooter>` in the same conditional
  guard as the inner button: only render the CardFooter when the
  download button would render. Trivial 1-line fix.

### C2RPF-DSGN-LOW-05 — `/admin/sales` empty state is plain text
- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:88-90`
- Severity: Informational | Confidence: High
- **What:** "No sales yet." — plain `<p>`, no illustration or icon,
  no follow-up text ("Once a customer purchases a photo, sales appear
  here."). For a feature where the photographer is waiting on their
  *first* sale, this is a missed opportunity for delight + clarity.
- **Fix (deferred):** Use the existing `topic-empty-state.tsx`
  pattern for consistency. Pure polish.

## Accessibility cross-check

- Buy button has `aria-label` implicitly via children text — accessible.
- ShoppingCart lucide icon has no explicit role — ok because the icon
  is decorative (the price text conveys the action).
- Refund button has no `aria-label` beyond children — accessible after
  destructive variant + confirm-dialog fix.
- Toast notifications use `sonner`, which is WCAG-conformant by default.

## Sweep

No reduced-motion / RTL / dark-mode regressions found in the new
paid-tier surfaces. No focus-trap issues (paid tier is read-only or
single-action). All buttons meet 44px touch-target minimum (existing
audit covers shadcn defaults, see cycle 1 plan-258).

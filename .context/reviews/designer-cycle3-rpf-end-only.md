# Designer (UI/UX) Review — Cycle 3 RPF (end-only)

Agent: designer
Scope: Next.js + React 19 frontend, especially photo-viewer (Buy/Download/checkoutStatus path) and /admin/sales (refund AlertDialog, status badges, locale currency).

Method: text-based DOM/a11y inspection (agent-browser not available). Focus on IA, focus/keyboard nav, WCAG 2.2, responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, perceived performance.

## Cycle 2 RPF carry-forward verification

- AlertDialog confirm on Refund — verified.
- StatusBadge with icon (color + icon + text triple-encoding) — verified.
- Locale-aware currency in /admin/sales — verified.

## Cycle 3 findings

### C3RPF-DSGN-MED-01 — Refund row button is `variant="destructive"` AND opens an AlertDialog

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:206-217`
- Severity: **Medium** | Confidence: **High**
- The row Refund button is red. Clicking opens an AlertDialog. The AlertDialog confirm button is also red. Two red buttons, two confirmations. This violates the established shadcn/ui convention: the dialog's confirm action carries the destructive emphasis; the trigger button is `outline` or `secondary`. Cross-listed with critic CRITIC-03.
- **Failure scenario:** User scans the table, sees red buttons next to every row, instinctively associates "lots of red" with "this page is dangerous" rather than "irreversible action available". Cognitive load increases. Click discoverability decreases.
- **Fix:** Change the row Refund button to `variant="outline"`. Keep the AlertDialog action as `destructive`. The status badge already conveys severity (refunded rows show the RotateCcw icon).

### C3RPF-DSGN-MED-02 — Sales table lacks responsive treatment on small screens (overflow-x-auto only)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-222`
- Severity: **Medium** | Confidence: **High** (was C2RPF-DSGN-MED-03; partially addressed)
- The cycle 2 partial fix added `overflow-x-auto` on the wrapping div. On a 390px phone the user must horizontal-scroll to see the Refund button. There is no responsive card-stacked alternative.
- **Fix:** At `< md` breakpoint, render rows as stacked cards with a Refund button. The existing `<table>` markup should remain the desktop-only path. This is a real fix for the mobile admin workflow but is larger than a cycle slot — defer with explicit exit criteria (when the admin /sales view is used on mobile in production).
- Defer-eligible: yes, with clear rationale.

### C3RPF-DSGN-LOW-01 — `errorLoad` renders below the title but above the table; not visually distinct

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:163-165`
- Severity: **Low** | Confidence: **High**
- The error text is `<div className="text-destructive text-sm">`. Small, easy to miss. No icon, no banner.
- **Fix:** Use the shadcn `<Alert variant="destructive">` component with `<AlertTriangle>` icon. Cheap UX win.

### C3RPF-DSGN-LOW-02 — Refund AlertDialog title lacks destructive emphasis

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:236-247`
- Severity: **Low** | Confidence: **High**
- The dialog title is plain text. No icon, no warning emphasis. The destructive emphasis is only on the action button. Established admin-action confirm patterns in this codebase put a small icon next to the title.
- **Fix:** Add `<AlertTriangle className="h-4 w-4 text-destructive" />` adjacent to the title. Cosmetic but consistent.

### C3RPF-DSGN-LOW-03 — Buy button on photo-viewer does not show tier label (still — C2-RPF-D05)

- File: `apps/web/src/components/photo-viewer.tsx:476-494`
- Severity: **Low** | Confidence: **High** (already C2-RPF-D05)
- Visitor sees `Buy ($12.00)`. They cannot tell if this is editorial, commercial, or rights-managed. Same finding as cycle 2; no progress.
- **Fix:** Tied to product decision on tier visibility (C2-RPF-D05). Stay deferred.

### C3RPF-DSGN-LOW-04 — Buy button has no aria-label or aria-describedby for screen readers

- File: `apps/web/src/components/photo-viewer.tsx:450-494`
- Severity: **Low** | Confidence: **High**
- The button content is `Buy ($12.00)` — readable, but no `aria-label` for the action context (which photo). Screen readers announce just "Buy $12.00 button" without the photo title.
- **Fix:** Add `aria-label={t('stripe.buyAriaLabel', { title: image.title ?? 'photo' })}` and the corresponding i18n key.

### C3RPF-DSGN-LOW-05 — `customer_email` in the Sales table can wrap mid-domain; no `break-all` styling

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:199`
- Severity: **Low** | Confidence: **High**
- Long emails (e.g., `very.long.firstname.lastname@subdomain.example.com`) overflow the column or wrap in arbitrary places. The cell uses `text-muted-foreground` only.
- **Fix:** Add `break-all` to the `<td>`. Or `truncate max-w-[200px]` with `title={row.customerEmail}` for hover.

### C3RPF-DSGN-LOW-06 — `formatCents` falls back to `$N.NN` silently on Intl failure (no log)

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:62-72`
- Severity: **Informational** | Confidence: **High**
- The catch swallows the error. A misconfigured locale would show `$N.NN` for the entire session with no operational signal.
- **Fix:** `console.warn` in the catch. Cross-listed with perf C3RPF-PERF-LOW-01.

### C3RPF-DSGN-LOW-07 — Refund AlertDialog action button shows `t.refunding` while disabled but no spinner

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:250-256`
- Severity: **Low** | Confidence: **High**
- During refund the button text changes to "Refunding…" but no `<Loader2 className="animate-spin">` icon. The static text is easy to miss as "still working".
- **Fix:** Add a spinner. Pattern already used elsewhere in the codebase (e.g., upload).

## A11y / WCAG 2.2 spot-checks

- **Contrast:** StatusBadge colors (`text-destructive`, `text-green-600`, `text-amber-600`, `text-muted-foreground`) — pass AA in light/dark per cycle 2 audit.
- **Focus order:** AlertDialog uses focus-trap-react via Radix. Tab order: Cancel → Refund (Confirm). Pass.
- **Reduced motion:** `prefersReducedMotion` honored in photo-viewer. AlertDialog has its own motion handling via Radix. Pass.
- **Keyboard:** Refund button is focusable via tab. Enter/Space opens dialog. Escape closes. Pass.
- **Screen reader:** AlertDialog has DialogTitle + DialogDescription for SR context. Pass.

## Confirmed vs likely

- All confirmed by source inspection.
- C3RPF-DSGN-MED-02 is a known gap; defer-eligible.

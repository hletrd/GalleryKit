# Designer (UI/UX) — Run-4 Cycle 17

Single-subagent in-context pass (documented run-wide constraint;
findings are code-evidence-backed with exact selectors/classes per the
multimodal caveat — no screenshot-dependent claims). Surfaces: the admin
clients second half (analytics, dashboard, password, seo), shared
inputs (tag-input), image fallback components, plus a regression check
of the c16 a11y commits.

## Findings

### DES-R4C17-03 — dashboard pagination's disabled chevron buttons have no accessible name
- **File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:136-138, 151-153`.
- **Severity/Confidence:** LOW / High. CONFIRMED.
- **Problem:** the enabled prev/next controls carry visible page-number
  text, but at the first/last page the placeholder
  `<Button variant="outline" size="sm" disabled>` renders ONLY a
  `<ChevronLeft|Right className="h-4 w-4">` icon — a button with no
  accessible name. SR table/forms-mode users hear "button, dimmed"
  with zero semantics; axe flags `button-name`.
- **Fix:** add `aria-label={t('dashboard.previousPage')}` /
  `t('dashboard.nextPage')` to the two disabled placeholders AND the
  enabled variants (the bare page number "3" is a weak name; "Previous
  page, 3" reads better). New i18n keys in en+ko.

### DES-R4C17-04 — failed-image retry success is silent (error path toasts, success path doesn't)
- **File:** same file, `handleRetry` (`:42-58`).
- **Severity/Confidence:** LOW / Medium. CONFIRMED asymmetry.
- **Problem:** on retry failure → `toast.error`; on success the row is
  filtered out with NO announcement. Sighted users infer success from
  the row vanishing; screen-reader users get silence after pressing
  "Retry" (the toast region is the app's established live-region
  channel — sonner announces). Asymmetric feedback on the same button.
- **Fix:** `toast.success(t('dashboard.retrySuccess'))` after the
  filter; key in en+ko. (Re-queued is the honest wording — processing
  is async; "queued for re-processing".)

## Verified clean (this pass)

- `password-form.tsx`: error/success/confirm Alerts ride the shadcn
  `Alert` primitive which carries `role="alert"` (`ui/alert.tsx:30`) —
  the DES-R4C16-05 class does NOT recur here. Labels/autocomplete/
  aria-invalid/aria-describedby all correct; submit Button floors at
  44 px via the primitive.
- `analytics-client.tsx`: window switcher is a `role="group"` with
  `aria-pressed` toggles at `min-h-11 min-w-11`; disclaimer is
  `role="note"` ABOVE the data; tables are plain data tables with
  proper `<th>` headers (no scope attr — single-row-header tables
  resolve unambiguously; not filed).
- `seo-client.tsx`: every Input/Textarea labeled via `htmlFor`/`id`;
  hint text adjacent; back link is `size="icon"` (44 px) with
  `aria.goBack` label; save state communicated by label swap +
  disabled.
- `tag-input.tsx`: combobox pattern correct (aria-autocomplete /
  aria-expanded / aria-controls / aria-activedescendant with stable
  option ids); IME guard; remove buttons 44 px with per-tag aria-label;
  create-option separated by border; listbox capped `max-h-[300px]`
  with overflow.
- `optimistic-image.tsx`: loading and error states are `role="status"`
  with localized labels; spinner `aria-hidden`.
- `topic-empty-state.tsx`: clear-filter affordance only when filters
  active; honest empty copy.
- c16 regression: `role="status"` backfill banner and `role="alert"`
  bulk-edit rejection render as planned; the six settle-before-close
  dialogs keep destructive feedback visible until settle, Cancel inert
  mid-flight — the photographer-facing destructive flows now all carry
  in-flight labels.

## Non-findings (considered, rejected)

- Analytics tables on mobile: horizontal squeeze at 320 px is bounded
  by the 2-col grid collapsing to 1-col (`lg:` prefix) — acceptable.
- `dashboard-client` failed-images panel uses an icon tile +
  `aria-hidden` (UX-R4C2-03 lineage) — still correct.
- Locale-agnostic `/p/` `/g/` admin links (middleware redirects):
  one-hop cost, intentional; documented in-file for `/g/`.

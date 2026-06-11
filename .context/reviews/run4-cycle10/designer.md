# Designer (UI/UX) — Run-4 Cycle 10

Angle: the admin-facing surfaces touched by this cycle's findings + a
least-covered-component sweep.

## Inventory
- `components/admin-user-manager.tsx` (the delete-admin UX behind
  COR-R4C10-01), `components/map/map-client.tsx`, `on-this-day-widget.tsx`
  (post-c9), `optimistic-image.tsx`, `login-form.tsx`,
  `password-form.tsx`, `settings/settings-client.tsx`,
  `categories/topic-manager.tsx`.

## DES-R4C10-01 — admin-delete failure surfaces a misleading toast (folds into COR-R4C10-01)
`admin-user-manager.tsx:71-77` shows `toast.error(result.error)` where the
server returns the generic `failedToDeleteUser` string. Pre-fix, deleting an
active co-admin ALWAYS hit the FK-1451 → the photographer sees "Failed to
delete user" with no actionable reason, looking like a transient bug. Once
COR-R4C10-01 is fixed the delete succeeds and the toast becomes
`users.deleteSuccess`, so no separate UX change is needed — but this is the
human-visible symptom that makes the finding more than cosmetic.

## Re-verified clean (touch targets, a11y)
- OnThisDay `OptimisticImage` thumbnails keep the 48px box with `min-h-[44px]`
  on the wrapping `<Link>` — touch target preserved; the loading/error
  overlays add `role="status"` + `aria-live="polite"` the bare `<img>`
  lacked. Net a11y improvement from c9.
- `login-form` password toggle is a 44px (`w-11 h-11`) target with
  `aria-pressed` + labeled show/hide.
- `admin-user-manager` create dialog: confirm-password mismatch wires
  `aria-invalid` + `aria-describedby` to the error node; delete uses an
  AlertDialog confirm (no accidental destructive click).
- `map-client` popup button is `min-h-[44px] min-w-[44px]` with an
  `aria-label`.
- `settings-client` backfill controls use `h-11` buttons, amber/blue notices
  carry `<strong>` headers; switches all have `aria-label` + `aria-describedby`.

No new touch-target or contrast violations. The `touch-target-audit.test.ts`
floor remains green this cycle.

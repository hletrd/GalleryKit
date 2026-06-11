# Run-4 Cycle 16 — designer angle

Single-subagent in-context pass. Browser-driven inspection was not
re-run this cycle (no layout-affecting changes since the c15 audit
screenshots; this cycle's UI findings are all structurally provable
from source + the audit suite, the run-4 convention for
non-visual-regression cycles). Findings below carry precise
selectors/line cites per the multimodal-caveat protocol.

## Findings

### COR-R4C16-01 (designer dimension) — destructive-action feedback contract broken on five admin dialogs

The product's confirm-dialog language (established c14, tag-manager):
confirm button rotates to an in-flight label with spinner, dialog
stays open until settle, ESC/overlay/Cancel inert mid-flight. Five
surfaces violate it (citations in the code angle). Designer-specific
severity notes:
- Bulk image delete is the single most destructive admin action
  short of DB restore (up to 100 photos + derivatives) and currently
  gives ZERO feedback between confirm-click and toast.
- Refund (sales-client) is irreversible money movement over a
  multi-second Stripe call — the exact case the c2 confirm dialog was
  added for (P260-02); the auto-close throws away the in-flight half
  of that design.
- Consistency: an admin who learns "dialog stays open while working"
  from tags gets the opposite behavior on every other surface.

### DES-R4C16-04 — upload topic `<select>` at 40 px (LOW / High)

`components/upload-dropzone.tsx:368` — native `<select id="upload-topic">`
styled `h-10` (40 px) on the admin upload surface. Policy is 44 px for
ALL interactive elements (CLAUDE.md, blocking audit); the shadcn
`SelectTrigger` primitive ships `min-h-11` floors
(data-[size]:min-h-11, verified in `ui/select.tsx:40`), so this
hand-styled native select is the odd one out. Phones are a real
upload path (photographer on location). Fix: `h-11`. Extend the audit
so the next hand-styled `<select>` cannot regress (the FORBIDDEN
domain currently knows only Button/button/Badge-asChild).

### DES-R4C16-05 — dynamic warning/error surfaces invisible to AT (LOW / High)

1. `settings-client.tsx:184-190` — the amber "backfill required"
   banner appears dynamically when a color-impacting field goes dirty.
   No `role="status"`/live region: a screen-reader admin edits
   `avif_effort` and never learns existing photos now need re-encoding.
   Fix: `role="status"` on the banner div (polite is correct — it is
   advisory, not blocking).
2. `bulk-edit-dialog.tsx:324-326` — client validation error renders a
   plain `<p className="text-sm text-destructive">`; SR users get
   silence when Apply is rejected. Fix: `role="alert"`. Precedent:
   C4-RPF-09 applied exactly this to the sales load-error region.

### UX-R4C16-06 — double-tap zoom ignores tap location (MED-LOW / Medium)

`image-zoom.tsx:197-209`: double-tap zooms to center. Photographer
viewing flow on mobile is "double-tap the detail you want to check"
(eyes, focus plane, grain) — centering instead forces a zoom + drag
every time, with the drag fighting the pan clamp. The wheel path
already anchors at the cursor; the asymmetry between input methods is
the design defect. Desktop click-to-zoom (lines 171-178) has the same
zero-anchor but a mouse user's click point is also their cursor
position for the subsequent wheel/drag — include it in the fix for
input-method parity.

## Checked clean

- `sales-client.tsx`: status triple-encoding (text+color+icon) holds;
  table semantics (caption, th scope) correct; refund button 44 px.
- `settings-client.tsx`: every input labelled (htmlFor/id pairs
  verified), hints wired via aria-describedby; Switch primitives
  carry aria-labels; backfill CTA 44 px; bare SelectTriggers are 44 px
  through the primitive floor.
- `bulk-edit-dialog.tsx`: ModeSelector aria-labels parameterized per
  field; tri-state pattern (leave/set/clear) clear; footer buttons
  44 px; submit-guarded close.
- `upload-dropzone.tsx` (rest): dropzone focus-visible ring; rejected-
  file toast names files; per-file errors role="alert"; remove button
  44 px with documented hover-reveal exception for desktop; progress
  bar fully ARIA'd; clear-all 44 px.
- `photo-viewer-loading.tsx`: role="status" + aria-label + decorative
  spinner aria-hidden — model implementation.
- `admin-header.tsx`: logout `size="sm"` renders 44 px via the lifted
  button variants (audit bookkeeping already accounts for the bare
  pattern).
- `global-error.tsx` post-c15: theme-class preservation verified; copy
  bilingual; retry button min-h-11.
- Footer/admin-nav c15 fixes: verified at diff level, no spacing
  regressions (flex gaps absorb the taller hit areas).
- `image-manager.tsx:397,423` checkbox labels at min-h-8: matches the
  documented admin keyboard-primary exemption rationale already
  recorded for this file's toolbar buttons (audit KNOWN_VIOLATIONS
  block) — consistent with policy bookkeeping, not a fresh violation
  (native label+checkbox is outside the FORBIDDEN domain; the
  re-open criterion "admin becomes mobile-priority" covers it).

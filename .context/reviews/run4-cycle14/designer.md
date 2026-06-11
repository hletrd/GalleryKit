# Run-4 Cycle 14 — designer angle (UI/UX)

Same single-subagent constraint as previous run-4 cycles; executed as a
distinct full-inventory in-context pass. Browser-driven inspection was
not run this cycle (no UI change shipped since the last designer pass
to re-probe); findings below are text-evidence-backed from component
source + message catalogs, per the multimodal caveat in the review
brief.

## Findings

### DES-R4C14-A — "Color: unknown" accordion headline on untagged photos — MED / High (= COR-R4C14-01, designer framing)

The R13-L1 dynamic accordion label exists to "surface the most
photographer-relevant fact in the label itself". For `'unknown'`
primaries it inverts that goal three ways:

1. **Raw-token copy.** EN renders "Color: unknown" (lowercase token in
   sentence position); KO renders "색상: unknown" — a half-translated
   string on a surface whose other values were deliberately localized
   (C3-D2 convention: Latinate gamut names stay, descriptive words
   translate). `'unknown'` is neither a Latinate technical name nor
   translated — it's an enum leak.
2. **False signal.** The "Color: {gamut}" framing was reserved for
   wide-gamut photos where the gamut IS the headline fact. Promoting
   "unknown" to the headline implies color significance the photo
   doesn't claim — the exact editorializing the honesty rules forbid.
3. **Attention misdirection.** The auto-open heuristic
   (default-open = non-trivial color) fires for every profile-less
   upload, so the most mundane photos get the most prominent color
   treatment, diluting the signal for genuinely wide-gamut work.

Remedy = the scheduled backend-of-the-frontend fix: gate via
`isWideGamutPrimary`; unknown-primaries photos fall back to the static
"Color details" label, default-closed (public), with the localized
"Color primaries: Unknown" row still available inside. No new copy
needed — `viewer.colorUnknown` already exists and is correctly used by
the pip and inner rows.

### DES-R4C14-B — tag delete dialog closes before deletion finishes; its spinner state is unreachable — LOW / High

`tag-manager.tsx:139` — `AlertDialogAction onClick` runs
`handleDelete(deleteId)` (async, fire-and-forget) then immediately
`setDeleteId(null)`, unmounting the dialog content; the
`isDeleting`-gated `Loader2` + "Deleting…" label inside the action
button (lines 140-141) can never be observed, and `disabled={isDeleting}`
never prevents a double-fire because the dialog is already gone. The
admin's only feedback is the eventual success/error toast; on a slow
connection there is a multi-second silent gap in which the row still
shows the deleted tag. Smallest honest fix: don't close the dialog
optimistically — await the action and close in its completion path
(success or error), letting the existing spinner/disabled states do
their job. Pure admin surface, no data-integrity risk (the action
itself is idempotent server-side), so LOW.

## Verified-good UX on rotation surfaces (no action)

- `wide-gamut-hint` — dismissal granularity by gamut family (R13-M2),
  share-route localStorage TTL (R28-HD-LOW-1), 44 px dismiss target,
  AA-compliant dark-mode contrast values documented inline.
- `lightbox-color-pip` — closed-pip uses localized "Unknown"
  (`viewer.colorUnknown`) for unknown primaries: the correct pattern
  the accordion label should follow; 44 px floors on pip, tooltip
  trigger, and copy button.
- `color-details-section` copy button — R28-UX-LOW-2 transient
  checkmark + toast pairing consistent across both copy surfaces.
- `password-form` — error summary + field-level `aria-describedby`
  pairing, `autoComplete` hints correct (`current-password` /
  `new-password`).
- `tag-manager` / `seo-client` icon buttons are 44 px via the lifted
  `size-11` Button default (the audit exemptions are stale prose, not
  real sub-44px targets — see test-engineer note).
- `info-bottom-sheet` peek color chip correctly suppresses the chip
  body for unhumanizable primaries (inner guard), so the COR-R4C14-01
  fix there only stops the empty wrapper + keeps peek behavior
  consistent with the accordion.

## HARD-SCOPE check
No finding proposes edit/culling/scoring features; both findings tighten
existing surfaces' honesty/feedback.

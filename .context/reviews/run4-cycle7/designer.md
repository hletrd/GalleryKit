# Run-4 Cycle 7 — designer angle

## Method note
This environment's review model is not driving a live browser this
cycle; findings are text-evidence-based (DOM/JSX structure, computed
class analysis, ARIA semantics, i18n message audit), per the
multimodal caveat in the cycle prompt. Production HTML evidence from
cycle-6 (live header probes) remains valid for the delivery layer.

## Findings

### UX (joins COR-R4C7-02) — the paid-download click journey dead-ends for scanned links
- Today the emailed link IS the download; after a scanner prefetch the
  customer's only experience is a plain-text `410 Token already used` —
  no branding, no explanation, no recourse path. The interstitial fix
  must treat this as a UX surface, not just a protocol patch:
  - Localized (EN/KO) confirmation page: photo title, "Download photo"
    submit button (≥ 44 px target), `lang` attribute from
    accept-language via the existing `deriveLocaleFromReferer` helper.
  - Error responses stay status-correct but SHOULD remain terse
    (machine-shaped) — they are now reachable mostly by non-humans;
    the human path flows through the interstitial.
  - The form button must be a real `<button type="submit">` in a real
    `<form method="post">` so it works with zero JS (email-client
    in-app browsers).

### UX (joins COR-R4C7-04) — control liveness must be consistent within the upload surface
- During a batch upload the per-file editors are visually dimmed and
  pointer-disabled, the dropzone is disabled, but the topic select and
  global tag input remain fully interactive. One of the two interactive
  controls (tags) honors mid-flight edits; the other (topic) silently
  ignores them. Aligning topic to latest-wins (ref read, like tags)
  fixes the deception without graying out controls photographers
  legitimately use mid-batch ("add the event tag to the rest").

### A11y spot-audit of rotated components (no new blocking findings)
- `admin-user-manager`: labels associated via htmlFor/id; confirm-error
  wired with aria-invalid + aria-describedby + role=alert; destructive
  dialog is an AlertDialog with explicit cancel. `size="sm"`/`size="icon"`
  usages are inside the admin KNOWN_VIOLATIONS ledger (touch-target
  audit passes — verified by the green gate baseline).
- `upload-dropzone`: progressbar carries aria-valuenow/min/max + label;
  per-file remove button is 44 px (h-11 w-11) with aria-label; file
  errors use role=alert. Clean.
- `bulk-edit-dialog`: ModeSelector triggers carry per-field aria-labels;
  44 px (h-11) triggers. Clean.
- `histogram`: canvas has role=img + mode-aware aria-label; collapse
  toggle 44 px with state-aware aria-label. LOW note (not scheduled):
  the mode-cycle button's static aria-label ("Cycle histogram mode")
  hides the CURRENT mode from SR users, but the canvas label announces
  it — acceptable; revisit only if SR users report confusion
  (WCAG 2.5.3 risk is minimal since the visible label is the mode name
  and the accessible name does not contain unrelated text).
- `tag-filter` / `info-bottom-sheet` / `image-zoom` keyboard handlers:
  button-element targets; Enter/Space activation correct; no IME
  exposure (confirms the cycle-6 census from the interaction side).

## i18n audit
- New strings required by this cycle's fixes (interstitial title/
  button/expiry note) must land in BOTH `messages/en.json` and
  `messages/ko.json` in the same commit (EN/KO parity gate from prior
  cycles: currently 0/0 missing keys).

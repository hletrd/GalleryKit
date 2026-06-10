# Run-4 Cycle 6 — designer angle (UI/UX, a11y, i18n)

Method note: this cycle's designer pass is static-analysis-driven with
LIVE production header probes (curl) for delivery-layer claims; no local
dev server was booted (same constraint as run4-c1..c5 — nested
agent-browser sessions unavailable in this context). All findings carry
precise selectors/line cites and are text-evidence-backed per the
multimodal caveat.

Inventory: `lightbox.tsx` (full interaction graph), `photo-viewer.tsx`
(toolbar/sidebar/keyboard), `search.tsx` (combobox + dialog),
`tag-input.tsx`, `image-manager.tsx` (dialogs), `info-bottom-sheet.tsx`
(keyboard region), `on-this-day-widget.tsx`, timeline + year pages,
`sales-client.tsx`, touch-target audit exemption ledger, EN/KO message
parity (programmatic flatten-diff), keyboard-shortcut hint surfaces.

## Findings

### A11Y-R4C6-04 — Lightbox image: `aria-label="N / M"` REPLACES the photo's alt text for screen readers
- **Severity/Confidence: MED / High**
- **File:** `apps/web/src/components/lightbox.tsx:485-489` (on the
  `<img>` inside the `<picture>`)
- Accessible-name precedence (`aria-labelledby` > `aria-label` > `alt`)
  means that whenever `currentIndex`/`totalCount` are provided (every
  gallery lightbox), AT announces the image as "3 / 12" and NEVER reads
  `getConcisePhotoAltText(...)` — the descriptive alt is dead weight.
  The position is ALREADY announced by the dedicated
  `role="status" aria-live="polite"` counter at `:631-640`, so the
  aria-label is pure duplication that destroys the photo description.
- **Fix:** delete the `aria-label` from the `<img>`; keep `alt`.

### UX-R4C6-03 — Lightbox control auto-hide never fires (focus-keepalive defeats the 3 s timer for everyone)
- **Severity/Confidence: MED / Medium-High**
- **File:** `apps/web/src/components/lightbox.tsx:161-169` and `:238-246`
- Both hide-timer callbacks bail with controls-visible when
  `dialogRef.current?.contains(document.activeElement)`. The component
  force-focuses the close button on mount (`:403`) and FocusTrap keeps
  focus inside the dialog thereafter, so `contains(activeElement)` is
  true in essentially every state — the auto-hide design
  (`shouldAutoHideLightboxControls`, hover/fine-pointer gating, 3 s
  timer, opacity fade) is dead on desktop. Photographers never get the
  chrome-free immersive view; the overlay (close/fullscreen/slideshow
  buttons, edge arrows, counter) sits on the photo permanently. Origin
  traced to `58a8e7ef` ("Stabilize browser boot") — a hydration fix,
  not a deliberate UX decision.
- **Fix:** keep controls only for KEYBOARD focus — i.e. bail only when
  the active element inside the dialog matches `:focus-visible`; for
  mouse/touch modality, blur the (mouse-focused) control before hiding
  so `aria-hidden` is never applied to a focused element (blur does not
  emit focusin, so FocusTrap will not yank focus back until the next
  Tab, which re-reveals controls via `onFocusCapture` — the correct
  keyboard behavior).
- WCAG note: hiding controls while a focused element would get
  `aria-hidden="true"` violates 4.1.2 — the blur step in the fix is
  load-bearing, not cosmetic.

### COR-R4C6-01 (designer facet) — Korean IME composition commits trigger actions
Shared with the code angle (full table there). Designer emphasis: the
product ships `ko` as a first-class locale with perfect message parity
(0 missing keys — verified this cycle), yet every Enter-commit surface
(tag entry, search result selection, inline rename, token naming) is
broken for IME users at the interaction layer. This is the highest-value
UX fix available this cycle.

### COR-R4C6-02 (designer facet) — Year-in-review honesty
The month sections + photo counts present an authoritative "this was
your year" summary while silently dropping everything past the
most-recent 100. The fix must include a VISIBLE localized truncation
notice (not just a raised cap) so the surface can never silently lie
about an archive's shape, mirroring the project's delivery-honesty
doctrine (HDR badges, gamut hints).

## Verified clean / endorsements
- Touch targets: timeline year-scrubber links `h-11 min-w-[44px]`;
  on-this-day rows `min-h-[44px]`; lightbox controls 44 px circles; the
  `size="sm"` Buttons inside image-manager are documented keyboard-primary
  exemptions in the audit ledger (counts match — no new violations).
- Search combobox ARIA wiring (role, aria-activedescendant,
  aria-controls, sr-only live region for result counts) — correct.
- Sales table: caption, scoped headers, triple-encoded status badges,
  role="alert" on load failure — solid.
- Reduced-motion: lightbox Ken Burns and viewer crossfades both gate on
  `prefers-reduced-motion` (state + change listener) — correct.
- Timeline/year pages: focus-within rings on cards, aria-current on the
  active year, sticky month headers with backdrop — good.
- EN/KO parity: 0 en-only, 0 ko-only keys (flatten-diff run this cycle).
- `lightbox` position counter contrast (`bg-black/70`) and the
  photo-viewer counter both meet the C1RPF-PHOTO-LOW-05 standard.

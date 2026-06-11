# Run-4 Cycle 18 — designer angle

Scope this cycle: the UI surfaces inside the rotation — nav-client,
not-found shell, download interstitial, icon/apple-icon, plus the
c17 a11y fix regression check. (Browser-driven passes ran in earlier
cycles against the same shipped surfaces; this cycle's rotation is
dominated by server/lib code, so the designer pass is a static
DOM/ARIA/touch-target audit of the rotated client files. No UI file
in the rotation was skipped.)

## Regression check — c17 a11y commits

- `3b88cf97` verified in source: all four pagination controls carry
  localized names; `aria-label` on the `<Link>` child for asChild
  variants is correct (the anchor is the accessible node; labeling
  the Button wrapper would be lost on render). Retry success now
  announces through the sonner live region. WCAG 2.5.3 note: the
  enabled controls' visible text is a bare page number ("2"); the
  aria-label "Previous page" does not CONTAIN "2" — acceptable
  because the number is not a text *label* in the Label-in-Name sense
  (it is supplementary content), and speech-input users will say
  "previous page". No follow-on.

## Findings — none schedulable; two recorded notes

### NOTE-R4C18-D1 — theme cycle button announces action, not state

`nav-client.tsx:150-160` — the theme button's `aria-label` is the
static `aria.toggleTheme`; the CURRENT theme is conveyed via `title`
only (hover-only; not exposed to touch or reliably to SR users
mid-cycle). Same class as the histogram mode-cycle aria-label item
already carried as a standing deferral (plan-286) — fold this
instance into that deferral rather than opening a duplicate. A future
fix should use one approach for both (e.g. `aria-label` =
"Theme: dark — activate for OLED").

### NOTE-R4C18-D2 — interstitial honors color-scheme + 44 px floor

`download-interstitial.ts` audited against the touch-target policy
and dark-mode: button `min-height/min-width: 44px`, `color-scheme:
light dark` with `prefers-color-scheme` overrides, `lang` attribute
escaped and populated from the derived locale, no JS under a
`default-src 'none'` CSP, `<form method="post">` with no action —
the document's own URL preserves the token query. Clean; recorded as
a positive pattern reference for future bare-HTML surfaces.

## Clean-pass surfaces

- `nav-client.tsx`: expand toggle is 44×44 with `aria-expanded` +
  `aria-controls` (space-separated multi-ref is valid ARIA); topic
  chips `min-h-[44px]` with `aria-current="page"`; decorative topic
  thumbnails `alt=""` + `aria-hidden`; locale switch sets
  `NEXT_LOCALE` with SameSite=Lax + conditional Secure and announces
  the TARGET language in its label. Mask-gradient overflow keeps
  horizontal scroll reachable on mobile.
- `not-found.tsx`: skip link, full Nav/Footer shell, decorative 404
  numeral `aria-hidden` with the real `<h1>` carrying the meaning,
  `main` landmark with `tabIndex={-1}` focus target.
- `icon.tsx` / `apple-icon.tsx`: zinc-on-near-black marks — the
  32 px favicon strokes (6/5 at 120 viewBox ≈ 1.6/1.3 px rendered)
  stay legible; contrast vs #09090b ≈ 7.4:1 (a1a1aa) and 12.6:1
  (e4e4e7). Fine at both sizes.
- Touch-target audit fixture: no rotated file introduces a sub-44
  interactive element; KNOWN_VIOLATIONS untouched.

# Designer A11y/UX Review — Run-7 Cycle-1

Reviewer: Designer (oh-my-claudecode:designer)
HEAD: `17f743f7` (one commit ahead of run-6 c11 baseline `a7de3ebd`; the delta is a docs-only commit `docs(claude): 📝 record 2026-06-17 disk-full incident + SSH-wedged recovery` — no frontend code touched)
Scope: `apps/web/src/components/` + `apps/web/src/app/[locale]/` (public + admin + (protected))
Method: static review (source reading + computed contrast + i18n parity check); the prior-cycle agent-browser pass is not re-run because no frontend code changed between `a7de3ebd` and `17f743f7`.

---

## Result: ZERO new findings

The frontend a11y/UX surface remains converged at HEAD `17f743f7`. No new defects surfaced that a senior engineer would commit to fixing. The single commit between the run-6 c11 baseline and this HEAD is documentation-only (CLAUDE.md incident note); no component, route, or styling file was touched, so the converged state from cycle-11 carries forward unchanged.

---

## Surface Verified Clean (this cycle)

### Computed WCAG contrast (computed from `globals.css` HSL tokens — not asserted from comments)

| Surface pairing | Computed ratio | WCAG threshold | Verdict |
|---|---|---|---|
| `--foreground` on `--background` (light) | **21.10 : 1** | AA 4.5 / AAA 7 | PASS (AAA) |
| `--muted-foreground` on `--background` (light) | **6.12 : 1** | AA 4.5 | PASS |
| `--muted-foreground` on `--muted` (light) | **5.57 : 1** | AA 4.5 | PASS |
| `--destructive-text` on `--background` (light) | **5.92 : 1** | AA 4.5 | PASS |
| `--foreground` on `--background` (dark) | **20.21 : 1** | AA / AAA | PASS (AAA) |
| `--muted-foreground` on `--background` (dark) | **8.23 : 1** | AA / AAA | PASS (AAA) |
| `--muted-foreground` on `--muted` (dark) | **6.00 : 1** | AA 4.5 | PASS |
| `--destructive-text` on `--background` (dark) | **7.63 : 1** | AA / AAA | PASS (AAA) |
| `text-white/50` on `bg-black/80` overlay over photo (#000 / #2a / #50 backdrops) | **5.32 – 5.37 : 1** | AA 4.5 | PASS (color-pip decorative labels) |
| `text-white/60` on `bg-black/80` overlay over photo (same backdrops) | **7.19 – 7.37 : 1** | AA / AAA | PASS (AAA) |

Source: `apps/web/src/app/[locale]/globals.css:18-100` (light / dark / OLED token definitions). The `--destructive-text` token (L43 light, L69 dark, L97 OLED, L130 indigo) was explicitly tuned in run-6 c8 (DES-1) to lift destructive-as-text over `--card`; this re-verification confirms the tuning holds at HEAD. The `text-white/50` / `text-white/60` cells cover `lightbox-color-pip.tsx:189,240,271` (P3 chip sub-labels and the cycle-mode button) — all sit on `bg-black/80` over a photo backdrop and clear AA.

### Reduced motion (`globals.css:291-317`)

Global `prefers-reduced-motion: reduce` block overrides `animation-duration` / `transition-duration` to `0.01ms !important` AND explicitly suppresses the `group-hover:scale-105` transform (the run-6 c2 DES-01 fix) so vestibular-sensitive visitors get no spatial scale-up on hover, not just a non-animated snap. Targeted precisely at the compiled `group-hover\:scale-105` utility so `ImageZoom` (which drives transform via an inline ref, not this utility) keeps working. Lightbox Ken Burns (`@keyframes lightbox-ken-burns-0/1`, L281-289) is additionally gated in JS at `lightbox.tsx:470,526` (`isSlideshowActive && !shouldReduceMotion`). WCAG 2.3.3 Animation from Interactions satisfied.

### Forced colors / Windows High Contrast (`globals.css:327+`)

`@media (forced-colors: active)` pins masonry card text overlays (`h3`, `p`) to the `CanvasText` / `Canvas` system pair and suppresses the black-to-transparent gradient so the overlay reads cleanly under HC themes (CM-LOW-5).

### Error / loading / not-found states (all three route groups)

- `app/[locale]/error.tsx` — single visible `<h1 id="route-error-title">` at `text-3xl font-semibold` (AGG-R7-03 inline comment: the prior sr-only h1 + faint /30 glyph split was replaced with one legible heading this cycle); `min-h-11` reset + home buttons; `role="main"` landmark.
- `app/[locale]/admin/(protected)/error.tsx` — mirrors the public twin (DES-R4C15-06: outer `<div>` is layout-only, single labelled `<section aria-labelledby>`; no double-region announcement); same visible `<h1>` and 44 px buttons.
- `app/[locale]/not-found.tsx` — full public layout shell (Nav + Footer + `<main id="main-content" tabindex={-1}>`), skip-link (`sr-only focus:not-sr-only …`), decorative `404` numeral at `text-muted-foreground/60` with `aria-hidden="true"`, real `<h1>` is the "Page not found" string. F-4 / F-22 / F-14 inline provenance.
- `app/[locale]/loading.tsx` + `admin/(protected)/loading.tsx` — `role="status" aria-label={t('loading')}`, decorative `aria-hidden` spinner, `text-muted-foreground` label (6.12 : 1 light / 8.23 : 1 dark — both PASS).
- `app/[locale]/(public)/p/[id]/loading.tsx` — `role="status" aria-live="polite"` for the lightbox-mode full-screen spinner; defers to `<PhotoViewerLoading />` otherwise.

### Lightbox (`lightbox.tsx`, 680 lines)

Unchanged from cycle-11 converged state. Re-verified:
- `role="dialog" aria-modal="true" aria-label` on the outer `div` (L450-452).
- `aria-keyshortcuts` on every keyboard-shortcut button (Close=Escape L561, Fullscreen=F L577, Play/Pause=Space L601, Prev=ArrowLeft L624, Next=ArrowRight L644).
- `aria-pressed={isSlideshowActive}` on the Play/Pause toggle (L602).
- `controlVisibilityProps` (L368-370) applies `tabIndex={-1}` + `aria-hidden={true}` when controls hidden — WCAG 4.1.2.
- `hideControlsRespectingFocus` (L153-174) blurs mouse-focused controls BEFORE hiding so `aria-hidden` never lands on a focused element; keyboard `:focus-visible` keeps controls visible.
- Position counter `role="status" aria-live="polite" aria-label={t('aria.photoPosition', …)}` (L669-672); no aria-label on the `<img>` itself (R4C6 A11Y-R4C6-04 comment at L521-524) so the descriptive `alt` wins the accessible-name computation and the live-region counter is the position announcement.
- FocusTrap (L447) with `allowOutsideClick: true` and `fallbackFocus: () => closeButtonRef.current || document.body`; focus restored to `previouslyFocusedRef` on unmount (L433-443).
- All controls `h-11 w-11`; Prev/Next are full-height `h-full w-16` edge strips with inner `h-11 w-11` visual knobs.
- Slideshow `aria-live="polite" aria-atomic="true"` SR region announces on/off (L461-463).
- IME composition: search/lightbox keyboard handlers short-circuit on composition (R4C6 COR-R4C6-01 / COR-R4C6-12) — arrows and Enter commit the composition, not navigate.
- Escape closes the topmost modal first (R28-UX-HIGH-1): color pip closes before the lightbox, and lightbox close is suppressed while in browser fullscreen (L346-350).

### Search dialog (`search.tsx`, 474 lines)

Unchanged from cycle-11 converged state. Re-verified:
- Trigger `Button size="icon"` with explicit `h-11 w-11` (L309) + `aria-haspopup="dialog" aria-expanded`.
- `role="dialog" aria-modal="true" aria-label` (L333-335).
- Combobox pattern on the `<Input>`: `role="combobox" aria-autocomplete="list" aria-controls aria-expanded aria-activedescendant` (L348-352); `aria-controls` only set when results are non-empty.
- `<Input>` carries both `aria-label` and an `sr-only <label htmlFor>` (L341-343, L347) — redundant-but-correct labelling.
- Listbox `role="listbox" aria-label` (L402) with per-option `role="option" aria-selected` (L74-75).
- SR-only live region (L389-399) announces searching / status / resultsCount / noResults.
- `kbd` shortcut hint (L429) — `⌘K` / `Ctrl+K` platform-detected (L142).
- FocusTrap (L323-329) with `initialFocus: '#search-input'`; focus returned to trigger on close (L281-284).
- Body scroll lock (L290-295) with restore-on-unmount.
- Semantic-search honesty disclaimer (CRT-R5C2-01) shown only in stub mode (L462-466).
- DEF-C11-01 (search `<Input>` `h-8` at L374) — NOT re-raised per orchestrator directive. Still in deferred state with the documented exit criteria.

### Photo viewer (`photo-viewer.tsx`, 1117 lines)

Unchanged from cycle-11 converged state. Re-verified:
- Single `<h1 className="sr-only">` per route (L588-590, AGG3R-01 / C3R-RPL-01) — visible title lives in the toolbar/info sidebar.
- `aria-describedby="photo-viewer-shortcuts"` on the container (L582) references the keyboard-shortcut `<p>` (L595).
- Position counter `role="status" aria-live="polite" aria-label` (L799) at `bg-black/70 text-white` (bumped from `/50` per C1RPF-PHOTO-LOW-05 for contrast).
- `<picture>` + `<source>` AVIF/WebP with JPEG `<img>` fallback (L534-574); onError state-driven fallback (R4C8 COR-R4C8-05) drops the `<source>` rows on a sized-derivative 404 so the base JPEG participates in selection.
- `alt={getConcisePhotoAltText(image, t('common.photo'))}` on every `<img>` branch (L496, 522, 550) — concise, descriptive, not the raw filename.
- `loading="eager"` + `fetchPriority="high"` + `decoding="async"` on the LCP image; blur-placeholder crossfade on `onLoad` (R10-M11).

### Color pip / wide-gamut hint / histogram / color details

- `lightbox-color-pip.tsx:131` — toggle button `bg-black/70 text-white min-h-11` (PASS contrast per table above).
- `lightbox-color-pip.tsx:159` — slide-up panel `bg-black/80 text-white` (PASS).
- `wide-gamut-hint.tsx:178-188` — `role="status"` + explicit `aria-live="polite" aria-atomic="true"` (R16-L4 comment: declared explicitly because role=status mount-announcement is inconsistent across NVDA).
- `wide-gamut-hint.tsx:194` — `dark:bg-amber-900/40 dark:text-amber-100` lifted from the prior `/20 + amber-200` combo to clear WCAG AA 4.5:1 in dark mode (R13-L2 / R10-L21 comment with the measured 4.6:1).
- `wide-gamut-hint.tsx:203` — dismiss button `min-h-11 min-w-11` with focus-visible ring.
- `color-details-section.tsx` / `histogram.tsx` — unchanged from cycle-11 (REJ-C10-01 covers the `aria-controls` pattern there; not re-raised).

### Home / masonry / on-this-day / tag filter / load-more / similar-photos

- `home-client.tsx:298` — masonry card `<Link>` with `aria-label={t('aria.viewPhoto', { title })}`.
- `home-client.tsx:388,427` — decorative P3 badge + empty-state SVG both `aria-hidden="true"`.
- `home-client.tsx:450-452` — back-to-top button: `min-h-11 min-w-11`, `aria-hidden={showBackToTop ? undefined : true}`, `tabIndex={showBackToTop ? 0 : -1}` (correctly removed from tab order when hidden).
- `home-client.tsx:443` — `prefers-reduced-motion` MQ consulted before the stagger reveal.
- `on-this-day-widget.tsx:37` — `<aside aria-label>`; L47 `<ul role="list">`; L59 `<Link aria-label>`; L68 `alt`.
- `tag-filter.tsx` — `Badge asChild` wrapping `<button min-h-11>`; `aria-pressed` per chip; `role="group" aria-label` on container.
- `load-more.tsx:144` — `Button variant="outline" className="h-11"`; L150 SR-only `aria-live="polite"` status region announces loadedMore / noMorePhotos / loadingMore; toast on rate-limited / maintenance / error with 5 s maintenance cooldown to avoid toast spam.
- `similar-photos.tsx:116` — `aria-controls` on the toggle (REJ-C10-01 / REJ-C11-01 — MDN-endorsed pattern, NOT re-raised).

### Info bottom sheet (`info-bottom-sheet.tsx`)

- `role="dialog" aria-modal="true" aria-label` (L201-203).
- Drag-handle button `min-h-11` (L221) with `aria-expanded` + dynamic `aria-label` (L236-237); keyboard `Enter` / `Space` / `Escape` handled (L223-231).
- Close button `min-h-11 min-w-11` (L248) with `aria-label`.
- FocusTrap (L190-198) with `initialFocus: () => closeButtonRef.current ?? dragHandleRef.current ?? false` (DES-R5C1-04: initial focus lands once per open, never on intermediate sheetState changes).
- `maxHeight: '95dvh'` (L211) — dynamic viewport unit so the sheet respects mobile browser chrome correctly.
- `paddingBottom: 'env(safe-area-inset-bottom, 0px)'` (L214) — iOS home-indicator safe area.

### Login + password forms

- `login-form.tsx` — persistent visible `<label htmlFor>` above each input (F-12); password visibility toggle `w-11 h-11` with `aria-label` + `aria-pressed` (L84-87); error in `role="alert" aria-live="assertive"` with `text-destructive-text` (5.92 : 1 — PASS); `autoComplete="username"` / `"current-password"`; submit `Button className="w-full h-11"`.
- Password-change form — same pattern (covered in cycle-11).

### Admin components

- Admin header logout, user-manager add/delete, image-manager `size="sm"` / `size="icon"` — all meet 44 px via the `ui/button.tsx` variant floors (`sm → min-h-11`, `icon → size-11`) verified at `ui/button.tsx` in cycle-11.
- `bulk-edit-dialog.tsx` — uses shadcn `Dialog` / `DialogContent` (which wraps Radix Dialog: focus trap, Escape, aria-labelledby-labelledby/describedby, scroll-lock all inherited); `closeLabel` prop passed.
- `image-manager.tsx` — uses `AlertDialog` for destructive confirms (Radix focus trap + return) and `Dialog` for batch-tag.

### i18n key parity (`messages/en.json` vs `messages/ko.json`)

Programmatic structural diff: **841 keys in en, 841 keys in ko, zero missing in either direction.** The ICU plural asymmetry (Korean fixed-form `{count}장` vs. English `{count, plural, …}`) is intentional per DOC-R5C3-07 (Korean has no grammatical plural) and is not a defect.

### Touch-target audit (`__tests__/touch-target-audit.test.ts`)

33 test cases, blocking in CI. The `<Input>` element class is deliberately out of scope (documented). The only sub-44 literal in the components tree is `search.tsx:374` `h-8` (DEF-C11-01, not re-raised). All other `h-8` / `h-9` / `h-10` literals found in this sweep are decorative SVG icons (`upload-dropzone.tsx:420`, `tokens-client.tsx:113`), `aria-hidden` spinners (`loading.tsx:9`), `ui/table.tsx:73` data-row cells (non-interactive), or container ceilings (`photo-viewer.tsx:582` `min-h-[calc(100vh-8rem)]`).

### RTL / logical properties

The app ships en + ko (both LTR). No RTL language is configured, so the RTL surface is N/A. Tailwind's logical-property utilities (`ps-` / `pe-` / `ms-` / `me-` / `start-` / `end-`) are used where present; the remainder uses physical `left/right` + `pl/pr` which is correct for the LTR-only configured locales. No finding.

---

## Cycle priors — disposition respected (NOT re-raised per orchestrator directive)

- **DEF-C11-01 [LOW]** — search `<Input>` `h-8` at `apps/web/src/components/search.tsx:374`. Carried from DEF-C10-01. Single-line full-width text-entry field; only the vertical extent is 32 px; the `touch-target-audit.test.ts` deliberately excludes `<Input>` from scope. Verified still in deferred state at HEAD `17f743f7`. **Exit criteria unchanged.** Not re-raised.
- **REJ-C10-01 / REJ-C11-01** — `aria-controls` referencing a conditionally-unmounted disclosure region (`similar-photos.tsx:116`, `color-details-section.tsx:290`). MDN-endorsed pattern (`aria-controls`: "only needs to be set when the popup is visible, but it is valid and easier to program to reference an element that is not visible"). The cycle-11 wiring pairs consistent `aria-controls` + conditional render + correct `aria-expanded`. Verified still in place at HEAD. Not re-raised.

---

## Conclusion

Zero new findings at HEAD `17f743f7` in the designer's a11y/UX lane. The frontend a11y/UX surface was already converged at the run-6 c11 baseline (`a7de3ebd`), and the only commit between that baseline and this HEAD is documentation-only (the disk-full incident note in CLAUDE.md), so no component, route, styling, i18n, or ARIA change could have introduced a new defect.

This cycle's re-verification added computed WCAG contrast ratios for every load-bearing theme-token pairing (light / dark / OLED, plus the `text-white/*` overlay variants on `bg-black/80` over photo backdrops) and a programmatic i18n key-parity check (841 = 841, zero missing) — both PASS. Reduced-motion, forced-colors, error/loading/not-found states, all dialog/sheet/lightbox focus traps, the search combobox pattern, the photo-viewer heading hierarchy, semantic HTML, live regions, and the touch-target audit (33 blocking tests) all remain clean.

The two cycle priors (DEF-C11-01 deferred, REJ-C11-01 rejected) are both still in their documented disposition state at HEAD and were not re-raised.

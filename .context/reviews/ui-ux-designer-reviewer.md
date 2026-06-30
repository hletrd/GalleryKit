# Cycle 31 UI/UX Designer Reviewer

Custom reviewer prompt was readable at `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`. The prompt is BurstPick-specific, so this pass applies its senior UI/UX critique lens to GalleryKit: hierarchy, control behavior, accessibility, state design, responsive behavior, and professional polish. Product code was not edited.

## Evidence And Inventory

- Agent-browser live coverage: desktop home, mobile home, mobile menu, mobile photo viewer, mobile lightbox, search dialog, failed search state.
- Local dev coverage: Next.js server reached, but content blocked by unavailable MySQL. Error shell verified.
- Main UI files reviewed: `home-client.tsx`, `nav-client.tsx`, `search.tsx`, `tag-filter.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `image-zoom.tsx`, `color-details-section.tsx`, `wide-gamut-hint.tsx`, `lightbox-color-pip.tsx`, `login-form.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `image-manager.tsx`, `settings-client.tsx`, `footer.tsx`, `load-more.tsx`, `globals.css`, `layout.tsx`, English/Korean messages.

## Findings

### UXD-31-01: Mobile home hierarchy is control-heavy for a visual gallery

- Severity: Medium
- Confidence: High
- Evidence: runtime at `390x844` showed nav, H1/count, then approximately 200 px of tag buttons before the first photo. Source confirms the sequence in `apps/web/src/components/home-client.tsx:255` through `apps/web/src/components/home-client.tsx:286`; tag chips render as full buttons with counts in `apps/web/src/components/tag-filter.tsx:81` through `apps/web/src/components/tag-filter.tsx:120`.
- Failure scenario: the page feels like a filter dashboard instead of a photography surface, particularly for new mobile visitors.
- Fix: keep filters available but visually subordinate. Use a single-row scroll strip, "Filters" disclosure, or first-row cap. Let photography occupy the first-scroll experience.

### UXD-31-02: Lightbox auto-hide trades visual cleanliness for accessibility discoverability

- Severity: Medium
- Confidence: Medium
- Evidence: live idle lightbox accessibility snapshot exposed only the dialog and image. Source applies `aria-hidden` and `tabIndex=-1` to hidden controls in `apps/web/src/components/lightbox.tsx:371`; the hide timer runs at `apps/web/src/components/lightbox.tsx:201`; close/navigation controls are inside the hidden overlay from `apps/web/src/components/lightbox.tsx:546` through `apps/web/src/components/lightbox.tsx:687`.
- Failure scenario: after controls fade, a non-pointer user can be inside a modal that appears to contain only an image. Escape works, but the visible and accessible recovery affordance is gone.
- Fix: never remove close from the accessibility tree. Prefer visual opacity-only for essential controls, or maintain an off-screen accessible control group while the visual overlay is hidden.

### UXD-31-03: Search status repeats itself in assistive output

- Severity: Low
- Confidence: High
- Evidence: failed production search produced duplicate error text in the accessibility snapshot. Source has both a screen-reader-only live region in `apps/web/src/components/search.tsx:440` through `apps/web/src/components/search.tsx:449` and a visible duplicate in `apps/web/src/components/search.tsx:473` through `apps/web/src/components/search.tsx:476`.
- Failure scenario: AT users get unnecessary repetition at the exact moment the UI is already failing to provide results.
- Fix: consolidate the announcement. One live status is enough; duplicate visual text should be hidden from AT or the hidden live region should be removed.

### UXD-31-04: Card link accessible text is more verbose than necessary

- Severity: Low
- Confidence: Medium
- Evidence: live desktop accessibility output for photo links repeated title/topic text. Source combines link `aria-label` at `apps/web/src/components/home-client.tsx:323`, image `alt` at `apps/web/src/components/home-client.tsx:353`, and visible overlay title/topic blocks at `apps/web/src/components/home-client.tsx:395` and `apps/web/src/components/home-client.tsx:401`.
- Failure scenario: keyboard and screen reader users traverse the masonry grid and hear repeated labels for each card, slowing scanning across 30-plus cards.
- Fix: keep one authoritative accessible name per card. Mark overlay text decorative for AT, or tune image alt in linked cards while keeping rich alt on photo detail.

### UXD-31-05: Motion is responsibly reduced, but default timings are a little slow for repeated browsing

- Severity: Low
- Confidence: High
- Evidence: reduced motion is covered in `apps/web/src/app/globals.css:253` through `apps/web/src/app/globals.css:279`. Default card image scale uses `duration-500` in `apps/web/src/components/home-client.tsx:357` and `apps/web/src/components/home-client.tsx:371`; the photo info sidebar uses `duration-500` in `apps/web/src/components/photo-viewer.tsx:718` through `apps/web/src/components/photo-viewer.tsx:724`.
- Failure scenario: repeated hover and info-panel toggles feel slightly sluggish for power browsing, even though accessibility motion preferences are respected.
- Fix: reduce routine UI transitions to 150-250 ms and keep longer motion only for deliberate viewer transitions.

### UXD-31-06: RTL readiness is partial, not complete

- Severity: Low
- Confidence: High
- Evidence: `dir` is wired in `apps/web/src/app/[locale]/layout.tsx:94`, but exposed locales are English/Korean in `apps/web/src/components/nav-client.tsx:19`; lightbox and nav use physical directions in `apps/web/src/components/lightbox.tsx:555`, `apps/web/src/components/lightbox.tsx:621`, `apps/web/src/components/lightbox.tsx:642`, and `apps/web/src/components/nav-client.tsx:100`.
- Failure scenario: future RTL locales would get correct text direction but incorrect spatial affordances and carousel placement.
- Fix: do not activate RTL locales until directional CSS and interaction semantics are converted to logical start/end and verified with RTL screenshots.

## Strengths

- Touch target discipline is strong. Live mobile metrics showed nav controls, language/theme/search buttons, tag chips, photo controls, and footer links at or above 44 px. Source also uses `min-h-11` and `h-11/w-11` throughout `nav-client.tsx`, `tag-filter.tsx`, `photo-viewer.tsx`, and `footer.tsx`.
- Focus and keyboard coverage is broad: skip link in `apps/web/src/app/[locale]/layout.tsx:119`, search shortcuts in `apps/web/src/components/search.tsx:297`, viewer shortcuts in `apps/web/src/components/photo-viewer.tsx:370`, and lightbox focus management in `apps/web/src/components/lightbox.tsx:434`.
- Color and contrast systems are unusually mature for a gallery: theme tokens in `apps/web/src/app/globals.css:14` through `apps/web/src/app/globals.css:101`, forced-colors support at `apps/web/src/app/globals.css:164`, and color/HDR affordances in `color-details-section.tsx`, `wide-gamut-hint.tsx`, and `lightbox-color-pip.tsx`.
- State design is mostly complete: loading status in `apps/web/src/app/[locale]/loading.tsx:8`, error recovery in `apps/web/src/app/[locale]/error.tsx:22`, empty gallery in `apps/web/src/components/home-client.tsx:426`, upload disabled/progress/skipped states in `apps/web/src/components/upload-dropzone.tsx:373`, and login validation in `apps/web/src/components/login-form.tsx:58`.
- Admin UI uses pragmatic density: tables scroll horizontally in `apps/web/src/components/image-manager.tsx:424`, batch toolbar is sticky at `apps/web/src/components/image-manager.tsx:321`, and admin nav wraps with minimum target sizing in `apps/web/src/components/admin-nav.tsx:29`.

## Designer Verdict

GalleryKit already has the fundamentals of a serious photographer-facing UI: color respect, strong touch targets, explicit states, and keyboard-aware viewer controls. The remaining design debt is concentrated in mobile hierarchy and assistive discoverability, not in visual styling. Fix the mobile filter presentation, keep modal controls discoverable, and repair search recovery before spending design time on new features.

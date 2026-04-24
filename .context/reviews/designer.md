# UI/UX Designer Review — Cycle 3

**Repository:** `/Users/hletrd/flash-shared/gallery`
**App:** Next.js App Router web frontend (`apps/web`)
**Date:** 2026-04-24
**Commit:** not committed, per prompt.

## Method / inventory

Review focus: public gallery IA, admin IA, keyboard/focus, WCAG 2.2, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

Tracked UI surface reviewed:

- Public routes: `apps/web/src/app/[locale]/(public)/layout.tsx`, `page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`
- App shell/state: `apps/web/src/app/[locale]/layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`, `globals.css`
- Public components: `nav.tsx`, `nav-client.tsx`, `footer.tsx`, `home-client.tsx`, `search.tsx`, `tag-filter.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `histogram.tsx`, `optimistic-image.tsx`
- Admin routes/components: admin layouts/pages, `admin-header.tsx`, `admin-nav.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `admin-user-manager.tsx`, category/tag/SEO/settings/password/db clients
- UI primitives: `components/ui/*`, especially `button`, `input`, `table`, `dialog`, `alert-dialog`, `sheet`, `sonner`
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `constants.ts`, `locale-path.ts`, `i18n/request.ts`

## Runtime blocker

Local browser validation was partially blocked because the dev server could not read the gallery database on the public route. In browser output for `/en`, the public page fell through to the route error boundary because `<Nav>`/home queries failed. Admin login still rendered, so the shell itself is healthy, but the public gallery could not be fully exercised end-to-end in this environment.

## Findings

### UX-01 — Public data outages collapse to a generic error shell instead of a gallery-specific maintenance/empty state

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/app/[locale]/(public)/page.tsx:113-130`, `apps/web/src/components/nav.tsx:6-13`, `apps/web/src/app/[locale]/error.tsx:7-35`
- **Failure / user scenario:** If the DB is temporarily unavailable, the public gallery turns into a generic app error rather than keeping brand/nav/footer context with a localized gallery maintenance state. That is especially harsh for a read-mostly photo gallery.
- **Suggested fix:** Catch optional chrome/data failures separately from the main gallery render. Keep the public shell visible and render a branded, localized maintenance/empty state with retry guidance when tags/topics cannot load.
- **Risk:** Users see the product as broken instead of temporarily unavailable; IA context is lost.

### UX-02 — Search autocomplete is keyboarded but still lacks complete combobox/listbox semantics

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** likely
- **File / region:** `apps/web/src/components/search.tsx:169-247`
- **Failure / user scenario:** Keyboard users can open search and arrow through results, but screen readers do not get a full combobox/listbox pattern. The result rows are links, not announced options, and the active row is not exposed with the right semantics.
- **Suggested fix:** Finish the ARIA combobox pattern: keep the input as `role="combobox"`, give the results container `role="listbox"`, expose each row as `role="option"` with `aria-selected`, and stop using `aria-current="true"` for active result state.
- **Risk:** The visual interaction works, but assistive technology gets weaker feedback than it should.

### UX-03 — Topic navigation can degrade into image-only pills, which hurts scanability and discoverability

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** risk
- **File / region:** `apps/web/src/components/nav-client.tsx:108-135`
- **Failure / user scenario:** If the site owner enables topic thumbnails, the visible text label disappears and users are left with tiny 24px images as the only navigation affordance.
- **Suggested fix:** Keep the label visible next to the thumbnail, or at minimum use a label + thumbnail composition that still scans well on touch devices.
- **Risk:** Navigation becomes harder to read, harder to localize, and weaker on mobile/touch.

### UX-04 — Admin navigation hides overflow with no strong mobile disclosure

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/admin-nav.tsx:26-44`, `apps/web/src/components/admin-header.tsx:13-24`
- **Failure / user scenario:** On narrow viewports, admin sections can disappear offscreen behind a hidden horizontal scroll region. There is no menu affordance, wrap, or edge fade telling the user more tools exist.
- **Suggested fix:** Switch to a wrapped or disclosed mobile nav. If horizontal scroll remains, keep the scrollbars visible and add stronger cues that the region is scrollable.
- **Risk:** Admin IA becomes partially invisible exactly where users need it most.

### UX-05 — The admin dashboard squeezes upload and image management too early at tablet widths

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:30-39`, `apps/web/src/components/image-manager.tsx:335-471`
- **Failure / user scenario:** At tablet/small laptop widths, the upload panel and dense image table share the screen too aggressively. The table becomes a cramped nested scroll surface and selection/edit/delete actions slow down.
- **Suggested fix:** Stack the panels until a wider breakpoint, or make image management the full-width primary work surface and move upload into a secondary/collapsible panel.
- **Risk:** Batch admin work becomes slower, more error-prone, and less comfortable on real hardware.

### UX-06 — The upload dropzone does not present a clearly styled keyboard focus affordance

- **Severity:** MEDIUM
- **Confidence:** Medium-high
- **Status:** confirmed
- **File / region:** `apps/web/src/components/upload-dropzone.tsx:271-283`
- **Failure / user scenario:** A keyboard user tabs to the upload area but gets no intentionally designed visible focus treatment; it reads as a drag target, not a keyboard-operable control.
- **Suggested fix:** Add an explicit `focus-visible` ring/outline, plus helper text that explains accepted file types and keyboard activation.
- **Risk:** WCAG 2.4.7 focus visibility is weaker than it should be.

### UX-07 — Upload UX has no empty-state guard when no categories exist

- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/upload-dropzone.tsx:29-35, 246-256, 381-390`
- **Failure / user scenario:** On a fresh install or after categories are deleted, the topic select defaults to `''`, but the upload surface still looks usable and the upload button remains enabled. The user only discovers the problem after attempting upload.
- **Suggested fix:** Detect `topics.length === 0` and replace the upload form with a clear empty state and a link to create categories, or disable upload until at least one topic exists.
- **Risk:** New admins hit a dead-end workflow with no immediate explanation.

### UX-08 — Loading and processing states are not consistently announced to assistive tech

- **Severity:** LOW-MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:16-18`, `apps/web/src/components/optimistic-image.tsx:70-79`, `apps/web/src/components/image-manager.tsx:380-384`
- **Failure / user scenario:** The route loader is accessible, but the dynamic photo-viewer fallback and image-processing overlays are visually clear only. Screen-reader users get inconsistent or no status announcements while content loads.
- **Suggested fix:** Introduce a shared loading/status primitive with `role="status"`, `aria-live="polite"`, localized text, and decorative spinner `aria-hidden="true"`.
- **Risk:** Users relying on AT do not get a reliable sense of progress.

### UX-09 — Shared dialog/sheet primitives still hardcode the close label in English

- **Severity:** LOW
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/ui/dialog.tsx:69-76`, `apps/web/src/components/ui/sheet.tsx:75-78`
- **Failure / user scenario:** Korean users can open localized dialogs/sheets but the close button remains announced as “Close” instead of the current locale.
- **Suggested fix:** Pass a localized close label into the primitive, or wrap the primitive in localized call sites that own the close text.
- **Risk:** Small but systemic i18n polish gap across shared overlays.

### UX-10 — RTL is not ready beyond an explicit `dir="ltr"` lock

- **Severity:** LOW
- **Confidence:** High
- **Status:** risk
- **File / region:** `apps/web/src/app/[locale]/layout.tsx:79-84`
- **Failure / user scenario:** If RTL locales are added later, the app will need a broader pass because direction is hardcoded LTR and many surfaces use physical `left/right` positioning.
- **Suggested fix:** Add a locale-to-direction map and convert the most important physical placements to logical start/end utilities before introducing RTL locales.
- **Risk:** RTL support would be expensive and error-prone if added late.

### UX-11 — Photo-viewer keyboard shortcuts are useful but largely undiscoverable

- **Severity:** LOW-MEDIUM
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/photo-viewer.tsx:165-177`, `apps/web/src/components/lightbox.tsx:38-44, 179-202`
- **Failure / user scenario:** Arrow navigation and fullscreen toggles exist, but first-time users have no visible shortcut hint and the controls do not expose `aria-keyshortcuts`.
- **Suggested fix:** Add terse visible hints or tooltips, and expose `aria-keyshortcuts` on the relevant controls.
- **Risk:** Power features stay hidden, so the viewer feels less polished than it is.

### UX-12 — The blur placeholder is effectively a no-op, so cards still pop in abruptly

- **Severity:** LOW
- **Confidence:** High
- **Status:** confirmed
- **File / region:** `apps/web/src/components/home-client.tsx:219-229`
- **Failure / user scenario:** The grid uses a 1×1 transparent PNG as `blurDataURL`, which does not meaningfully soften the loading transition. On slower connections the card still appears to snap from muted block to full image.
- **Suggested fix:** Generate a real per-image low-res blur at ingest time and store it with the derivative metadata.
- **Risk:** Perceived performance is weaker than it could be even though the rest of the image pipeline is strong.

## Overall assessment

The frontend is solid and clearly better than a generic shadcn/Tailwind app. The public browsing flow is visually coherent, the photo viewer is featureful, and the admin system is functional. The remaining UX debt is concentrated in three places:

1. **Resilience** — the public gallery still collapses into a generic error when a critical query fails.
2. **Discoverability / accessibility** — search semantics, shortcut discoverability, loading announcements, and some shared primitives still need polish.
3. **Responsive IA** — the admin nav and dashboard become cramped or hidden on smaller screens.

No code was changed in this review pass.

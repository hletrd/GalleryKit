# Designer Review — Cycle 1 (2026-04-24)

## Scope and inventory covered
Reviewed the repo docs (`CLAUDE.md`, `README.md`, `apps/web/README.md`) and the public/admin frontend surface in `apps/web/src/app/**` and `apps/web/src/components/**`, with special attention to navigation, search, photo viewing, error states, upload flows, and theme/i18n behavior. Browser-checked the live site in Playwright at:

- `https://gallery.atik.kr/en`
- `https://gallery.atik.kr/en/tws`
- `https://gallery.atik.kr/en/p/348`

The browser pass covered both desktop and mobile viewport behavior, keyboard focus, modal/lightbox behavior, and the mobile nav state after route changes.

## Findings summary
- Confirmed Issues: 4
- Likely Issues: 1
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### DES1 — Mobile nav state persists after navigation, so the next page opens with the menu still expanded
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/components/nav-client.tsx:26-156`
- **Why it is a problem:** `isExpanded` is local component state that only resets on a viewport breakpoint change (`matchMedia('(min-width: 768px)')`). There is no pathname effect or link-click collapse path, so the expanded mobile nav survives route transitions in the persistent App Router layout.
- **Concrete failure scenario:** in mobile browser, a user opens the menu, taps a topic, and lands on the destination page with the nav still expanded. In Playwright, opening the menu on `/en`, clicking `TWS`, and landing on `/en/tws` left the collapse button visible and the header height at 148px, pushing the actual page content down.
- **Suggested fix:** collapse the menu on any navigation event (`useEffect(() => setIsExpanded(false), [pathname])`), or close it in the topic-link click path before pushing the next route.

### DES2 — The mobile info bottom sheet is touch-only and never moves focus into the panel
- **Severity:** HIGH
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/components/photo-viewer.tsx:269-277, 586-592`; `apps/web/src/components/info-bottom-sheet.tsx:24-176`
- **Why it is a problem:** the viewer opens the sheet from a plain button, but the sheet itself starts in `peek` state, uses `onTouch*` handlers on a non-focusable drag handle, and only activates the focus trap when `sheetState === 'expanded'`. There is no keyboard path to expand the sheet or a focus move into the sheet when it opens.
- **Concrete failure scenario:** on mobile, a user taps Info and sees only the summary row. In Playwright, after clicking the Info button on `/en/p/348`, `document.activeElement` remained the trigger button instead of moving into the sheet. Keyboard, switch, and screen-reader users therefore have no reliable way to reach the EXIF grid.
- **Suggested fix:** make the drag handle a real button with `aria-expanded`, add keyboard controls for expand/collapse, and move focus into the sheet on open; alternatively open the sheet directly in `expanded` state on click and keep the summary row as the collapsed fallback only.

### DES3 — Lightbox auto-hides its controls but leaves them focusable, so keyboard focus can land on invisible buttons
- **Severity:** HIGH
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/components/lightbox.tsx:111-148, 283-355`
- **Why it is a problem:** when the idle timer fires, the overlay’s opacity is set to `0`, but the buttons remain mounted, tabbable, and exposed to assistive tech. There is no `aria-hidden`, `inert`, or tab-stop suppression when the controls are hidden.
- **Concrete failure scenario:** a keyboard user opens the lightbox, waits a few seconds, and then tabs forward. In Playwright on `/en/p/348`, after 3.5 seconds the overlay opacity was `0` while `document.activeElement` was still the `Close` button. The result is an invisible focus target inside a modal dialog.
- **Suggested fix:** if controls are auto-hidden, also remove them from the accessibility tree / tab order, or keep them visible while focus is inside the lightbox and only fade them for pointer-only idle states.

### DES4 — Dropping invalid files gives no validation feedback in the upload flow
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files / regions:** `apps/web/src/components/upload-dropzone.tsx:95-106, 258-269`
- **Why it is a problem:** `useDropzone` is configured with an accept list, but `onDrop` only appends `acceptedFiles`. Rejected files are ignored completely, so the UI never tells the user why a file was not added.
- **Concrete failure scenario:** a user drags a PDF or unsupported image into the uploader and nothing visibly happens. From the user’s perspective the drop target appears broken, even though the issue is just validation rejection.
- **Suggested fix:** handle `fileRejections`/`onDropRejected`, surface the rejected file names and reasons inline or via a toast, and keep the accepted-file list separate from validation errors.

## Likely Issues

### DES5 — The root error shell ignores the active theme, so dark-mode users crash into a light-only page
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Files / regions:** `apps/web/src/app/global-error.tsx:45-75`
- **Why it is a problem:** this boundary renders its own `<html>` and `<body>` without the `ThemeProvider` or a copied `.dark` class. Because the color tokens in `globals.css` default to the light palette unless `.dark` is present, the global error page always renders as light mode.
- **Concrete failure scenario:** a dark-mode user hits a root-level exception and sees a bright white recovery screen that clashes with the rest of the app and may not match their contrast expectations.
- **Suggested fix:** bootstrap the theme class/attribute in the global error shell, or read the persisted theme and apply the matching class before rendering the error UI.

## Final sweep
No additional UI/UX, accessibility, responsive, loading/empty/error-state, i18n, or perceived-performance issues were found that were strong enough to report beyond the items above. The main remaining design risks are mobile state persistence, touch-only expansion affordances, and hidden focus in the lightbox idle state.

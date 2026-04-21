# Cycle 10 Designer UI/UX Review

Static, code-backed review of the GalleryKit UI surface. I did not run a live browser pass in this review, so the findings below are grounded in component code, route layout, and test coverage.

## Inventory reviewed first

### Docs / instructions
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`

### UI entry points and shells
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`

### Core public UI components
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/footer.tsx`

### Admin / management UI components
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/tag-input.tsx`

### Tests reviewed for UI intent and coverage
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`

## Findings count
- **6 total findings**: 4 confirmed issues, 2 likely issues
- **Manual-validation risks**: 1 note, not counted as a finding

## Confirmed issues

### 1) `TagInput` traps Tab instead of letting focus move normally
- **Status:** Confirmed
- **Confidence:** High
- **Files:** `apps/web/src/components/tag-input.tsx:73-91, 140-155`; used by `apps/web/src/components/upload-dropzone.tsx` and `apps/web/src/components/image-manager.tsx`
- **User-facing scenario:** A keyboard user types part of a tag in the admin upload or image manager tag field and presses Tab to continue to the next control. Instead of moving focus, the component prevents default Tab behavior and commits the tag. That makes the field feel sticky and breaks expected form navigation.
- **Suggested fix:** Keep Enter/comma as commit keys, but let Tab blur normally. If you want “commit on exit,” handle `onBlur` or an explicit confirm action instead of intercepting Tab.

### 2) Search combobox state does not accurately reflect the open popup
- **Status:** Confirmed
- **Confidence:** Medium
- **Files:** `apps/web/src/components/search.tsx:149-205, 207-243`
- **User-facing scenario:** The search dialog is open, but `aria-expanded` on the combobox input is driven by `results.length > 0` rather than the actual open state. When the dialog is open with no results yet, or while loading, assistive tech can be told the combobox is collapsed even though the popup is visible.
- **Suggested fix:** Tie `aria-expanded` to the dialog/popup open state, not result count. Consider adding a live region for loading and empty-result updates so screen reader users get timely feedback.

### 3) Lightbox controls vanish on touch devices after three seconds
- **Status:** Confirmed
- **Confidence:** High
- **Files:** `apps/web/src/components/lightbox.tsx:34-91, 142-199, 226-297`
- **User-facing scenario:** On a phone or tablet, the lightbox opens with close/fullscreen/next/prev controls visible, then hides them after three seconds. The only code path that makes the controls visible again is mouse movement, which never happens on touch-only devices. That can leave mobile users with a fullscreen image and no visible way to close or navigate it.
- **Suggested fix:** Keep controls persistent on coarse pointers, or re-show them on any tap/touch interaction. A common pattern is to disable auto-hide on mobile and only auto-hide on pointer-mouse devices.

### 4) `ImageZoom` is keyboard focusable but has no visible focus treatment
- **Status:** Confirmed
- **Confidence:** Medium
- **Files:** `apps/web/src/components/image-zoom.tsx:117-132`
- **User-facing scenario:** The zoom wrapper is exposed as a button-like control with `tabIndex={0}`, so keyboard users can reach it, but there is no `focus-visible` styling on the container. In practice, the control can be technically focusable while remaining visually silent, which makes it hard to tell where focus is.
- **Suggested fix:** Add a clear focus ring/outline class to the zoom container, ideally with `focus-visible:ring-*` and sufficient contrast against both light and dark image backgrounds.

## Likely issues

### 5) Infinite scroll has no visible fallback or end-of-list affordance
- **Status:** Likely issue
- **Confidence:** Medium
- **Files:** `apps/web/src/components/home-client.tsx:313-321`; `apps/web/src/components/load-more.tsx:69-96`
- **User-facing scenario:** Photo pagination depends on an `IntersectionObserver` sentinel plus a spinner that appears only while loading. There is no visible “Load more” button, and there is no visible end-of-gallery message when loading is finished. If the observer fails, if keyboard navigation does not naturally reach the sentinel, or if a user simply wants an explicit action, they get no direct continuation affordance.
- **Suggested fix:** Keep the observer for progressive loading, but add a visible fallback button and a visible end-of-list state. The observer can auto-click the button pattern or load in the background, but the user should have an explicit manual path.

### 6) Admin image manager is not responsive to narrow screens
- **Status:** Likely issue
- **Confidence:** Medium
- **Files:** `apps/web/src/components/image-manager.tsx:323-457`
- **User-facing scenario:** The image manager renders a wide table with preview, title, filename, topic, tags, date, and actions in separate columns, but there is no responsive wrapper or alternate compact layout. On narrow screens, the table will either squeeze important content into unreadable columns or force awkward horizontal scrolling.
- **Suggested fix:** Wrap the table in an overflow container and/or switch to a card stack below a breakpoint. At minimum, hide lower-priority columns on smaller screens so the primary actions stay usable.

## Manual-validation risks

### A) Optimistic image error/loading states should be checked live with assistive tech
- **Status:** Manual-validation risk
- **Confidence:** Low
- **Files:** `apps/web/src/components/optimistic-image.tsx:29-68`
- **Why it needs runtime validation:** The component shows spinner/error overlays visually, but the code does not add an explicit `role="status"`, `aria-live`, or `aria-busy` signal. It is worth validating in a real browser with a screen reader that image failures and retries are announced in a useful way.

## Overall summary
- The strongest confirmed issues are the **Tab trap in `TagInput`**, the **lightbox auto-hide on touch devices**, and the **missing focus treatment on `ImageZoom`**.
- The biggest likely UX gap is the **lack of an explicit continuation/end state for infinite scroll**.
- The biggest responsive risk is the **admin image manager table on small screens**.

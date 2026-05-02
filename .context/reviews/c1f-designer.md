# Designer / UI-UX Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: web frontend — components, accessibility, responsive design, i18n, dark/light mode, perceived performance.

## Inventory reviewed

All component files in `apps/web/src/components/`, page files in `apps/web/src/app/`, and UI primitives in `apps/web/src/components/ui/`. The repo contains a full web frontend (React 19, Next.js 16, Tailwind CSS, Radix UI, shadcn/ui).

---

## Findings

### C1F-UX-01 (Medium / High). `image-zoom.tsx` uses direct DOM manipulation — may break with React concurrent mode

- Location: `apps/web/src/components/image-zoom.tsx`
- The ImageZoom component uses refs and direct DOM manipulation (`style.transform`, `style.cursor`) for zoom behavior. While this avoids React re-renders on mousemove (a documented performance optimization in CLAUDE.md), it bypasses React's rendering lifecycle. In concurrent mode, React may re-render the component while the DOM is being manipulated, causing visual glitches.
- **Severity**: Low — concurrent mode is not yet the default in React 19 for server components, and the component uses `useRef` + event listeners (not state), so the risk is minimal.
- **Fix**: Add a comment documenting the concurrent-mode risk. Consider using `useLayoutEffect` instead of `useEffect` for DOM manipulation to ensure synchronous updates.

### C1F-UX-02 (Medium / Medium). `lightbox.tsx` uses `setTimeout` for auto-hide UI — may feel sluggish on slow devices

- Location: `apps/web/src/components/lightbox.tsx:130,151`
- The lightbox auto-hides its controls after 3 seconds using `setTimeout`. On slow devices where the initial render takes >500ms, the controls may disappear before the user can interact with them. There's no "interaction detected" reset of the timer.
- **Severity**: Low — the 3-second window is generous, and mouse movement resets the timer.
- **Fix**: Consider resetting the auto-hide timer on any user interaction (touch, scroll, keypress), not just mouse movement.

### C1F-UX-03 (Low / Medium). No loading skeleton for individual photo page (`/p/[id]`)

- Location: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- The photo viewer page doesn't show a loading skeleton while the image data is being fetched. There's a `photo-viewer-loading.tsx` component but it's not used as a Next.js `loading.tsx` boundary.
- **Severity**: Low — the `revalidate = 0` setting means the page is always server-rendered, and the blur placeholder provides instant visual feedback.
- **Fix**: Consider adding a `loading.tsx` in the `p/[id]` directory for better perceived performance.

### C1F-UX-04 (Low / Low). `topic-empty-state.tsx` — no illustration or guidance for empty topics

- Location: `apps/web/src/components/topic-empty-state.tsx`
- The empty state for topics with no images is a simple text message. Adding an illustration or a call-to-action ("Upload your first photo") would improve the UX.
- **Severity**: Low — minor UX improvement.
- **Fix**: Add a subtle illustration or upload CTA to the empty state.

### C1F-UX-05 (Low / Low). Touch target audit is enforced but with documented exceptions

- The 44x44 px touch target minimum is enforced as a blocking unit test at `apps/web/src/__tests__/touch-target-audit.test.ts`. The test has a `KNOWN_VIOLATIONS` map for exceptions. The enforcement is good, but the exceptions should be periodically reviewed.
- **Severity**: Low — the audit exists and is enforced.
- **Fix**: No fix needed — the audit is working as designed.

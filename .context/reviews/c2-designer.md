# Designer — Cycle 2 Deep Review (UI/UX)

## C2-UX-01 (Medium/Medium): `loadMoreImages` error leaves "Load More" button broken

- **File**: `apps/web/src/components/load-more.tsx`
- **Issue**: When `loadMoreImages` server action throws (e.g., DB connection error during scroll), the client-side component has no error boundary or try/catch. The button becomes non-functional after the error, and the user has no indication of what happened or how to recover. A page refresh is required.
- **Fix**: Wrap the server action call in a try/catch, show a toast error on failure, and allow the user to retry.
- **Confidence**: High

## C2-UX-02 (Low/Medium): Lightbox controls visibility transition may flash on fast navigation

- **File**: `apps/web/src/components/lightbox.tsx:94-118`
- **Issue**: The `showControls` callback has a debounce guard (`controlsVisible && now - lastControlRevealRef.current < 500`), but this only prevents redundant reveals. When navigating between images (prev/next), the controls may flash because the effect to re-arm the auto-hide timer runs after the image change. The `showControls(true)` call in the keydown handler resets the timer, but the transition between images could cause a brief opacity flash.
- **Fix**: Consider adding a `key` prop to the lightbox container that changes on navigation, forcing React to re-mount the timer effect cleanly.
- **Confidence**: Low

## C2-UX-03 (Low/Low): Photo viewer loading skeleton could be more informative

- **File**: `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- **Issue**: The loading skeleton added in cycle 1 shows a basic layout placeholder. For slow connections, the user sees a skeleton with no progress indication. Adding a subtle animation or progress bar would improve perceived performance.
- **Fix**: Low priority. Consider adding a pulsing animation to the skeleton (standard shadcn/ui skeleton behavior).
- **Confidence**: Low

## Summary

- Total findings: 3
- Medium: 1
- Low: 2

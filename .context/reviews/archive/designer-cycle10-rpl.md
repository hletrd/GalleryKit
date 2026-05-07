# designer — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: UI/UX. Because the review model is not multimodal, findings use selectors, class names, and text-based evidence. Screenshots at `.context/home-desktop-review.png` etc. remain artifacts only.

## Findings

### D10R-RPL-UX01 — Search dialog still lacks `aria-live` region (AGG9R-RPL-07 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/components/search.tsx:207-251`.

Unchanged from cycle 9 rpl. Missing:
- `aria-live="polite"` region that announces "N results" / "no results" / "error".
- Assistive tech users (screen reader) currently hear the input label only.

Proposed fix (bundled with AGG9R-RPL-08):
1. Add `aria-live="polite"` region below the input.
2. Add translation keys in `en.json` and `ko.json`:
   - `search.results.count`: "{count, plural, =0 {No results} one {1 result} other {# results}}"
   - `search.error.generic`: "Search temporarily unavailable"
3. Distinguish error state from empty state (AGG9R-RPL-08).

Defer: requires translation review. Keep in carry-forward.

Confidence: Medium.

### D10R-RPL-UX02 — Search dialog silently swallows fetch errors (AGG9R-RPL-08 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/components/search.tsx:56-59`.

Carry-forward. Bundled with UX01.

Confidence: Medium.

### D10R-RPL-UX03 — PhotoViewer dead UI branches for `original_format` / `original_file_size` (AGG9R-RPL-06 carry-forward) [LOW / HIGH]

File: `apps/web/src/components/photo-viewer.tsx:463-475`.

Unchanged. Public routes never receive these fields (they're omitted from `publicSelectFields`), so the render blocks are permanently dead on `/p/[id]`, `/s/[key]`, `/g/[key]`.

Options:
- (a) Make fields public (low-signal metadata, not PII).
- (b) Remove the dead render branches from the public-path viewer.

Still needs product-owner decision.

Confidence: High for the observation; decision is product-gated.

### D10R-RPL-UX04 — Admin dashboard upload area lacks keyboard-activation hint [LOW / LOW]

File: `apps/web/src/components/uploader.tsx` (unread this cycle, citing cycle-7 carry-forward).

Tracked as a carry-forward UX polish; not scheduled.

Confidence: Low.

### D10R-RPL-UX05 — `reduced-motion` handling for masonry resize is in place [VERIFIED]

Masonry grid uses `requestAnimationFrame` debounced resize. For users with `prefers-reduced-motion: reduce`, the resize would still happen (it's not an animation, it's a layout change). Current behavior is acceptable — the `reduced-motion` guard is meant for CSS transitions/animations, and masonry's reflow isn't one.

Confidence: High.

## Summary

- 0 new UX regressions.
- 3 carry-forward items (UX01, UX02, UX03) remain deferred pending translation review or product decision.
- Codebase continues to show good a11y hygiene.

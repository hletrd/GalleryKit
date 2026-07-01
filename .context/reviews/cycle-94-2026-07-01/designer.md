# Cycle 94 UI/UX/Accessibility Review

Scope: static review of the Next.js web UI at current HEAD `33eca7b5e4102bd5097777dbb926ee2cb94c6d71`. Reviewed components, localized messages, source-contract tests, and current cycle-93 fixes. No production services were started. Source files were not edited.

## Findings

### C94-DES-01 - Token-list load failures collapse into the empty state

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:35`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:41`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:43`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:124`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:129`, `apps/web/messages/en.json:851`, `apps/web/messages/en.json:852`.
- Problem: `fetchTokens()` reports a `listLrTokens()` failure only through `toast.error(result.error)`, then sets `loading` false. With `tokens` still `[]`, the persistent UI renders the normal empty-state copy, "No tokens yet", instead of an error state.
- Failure scenario: if the server action fails because of an expired session, restore maintenance, or DB error, a keyboard or screen-reader admin who misses the transient toast lands on a stable page that incorrectly says no tokens exist and still offers token generation.
- Suggested fix: add persistent `loadError` state for the token list, render a field/page-level `role="alert"` or `role="status"` error panel before the empty state, and provide a retry button with a 44 px target. Cover the source contract so load failure cannot be toast-only.

### C94-DES-02 - Zoomed photos are keyboard-toggleable but not keyboard-pannable

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/components/image-zoom.tsx:201`, `apps/web/src/components/image-zoom.tsx:205`, `apps/web/src/components/image-zoom.tsx:328`, `apps/web/src/components/image-zoom.tsx:331`, `apps/web/src/components/image-zoom.tsx:362`, `apps/web/src/components/image-zoom.tsx:365`, `apps/web/src/components/lightbox.tsx:328`, `apps/web/src/components/lightbox.tsx:340`, `apps/web/src/__tests__/image-zoom-source-contracts.test.ts:7`.
- Problem: the zoom container exposes keyboard toggle behavior for Enter/Space and Escape reset, but there is no keyboard pan path once zoom is active. At the same time, lightbox-level ArrowLeft/ArrowRight remain slide navigation keys, so arrow keys cannot safely be repurposed without a focused zoom-state contract.
- Failure scenario: a keyboard-only visitor can zoom into the center of a photo but cannot inspect off-center details such as faces, text, or focus-critical regions.
- Suggested fix: define keyboard pan semantics while the zoom surface has focus and `zoomLevelRef.current > MIN_ZOOM` (for example arrow keys pan, Shift/Ctrl adjust step, Escape resets), stop those keys from bubbling to lightbox navigation while active, update the accessible label/instructions, and extend `image-zoom-source-contracts.test.ts`.

### C94-DES-03 - Mobile admin navigation is still a ten-link wrapped header

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/components/admin-nav.tsx:15`, `apps/web/src/components/admin-nav.tsx:29`, `apps/web/src/components/admin-nav.tsx:33`, `apps/web/src/components/admin-nav.tsx:41`, `apps/web/src/components/admin-header.tsx:14`, `apps/web/src/components/admin-header.tsx:19`, `apps/web/src/components/admin-header.tsx:24`.
- Problem: the admin header renders ten same-level navigation links in a `flex-wrap` strip on every admin page. Touch targets are individually large enough, but the pattern consumes multiple rows on phone widths before page-specific controls.
- Failure scenario: a phone admin must traverse or scroll past a large repeated nav block on every admin route before reaching upload, token, settings, or management controls.
- Suggested fix: keep the desktop link strip, but introduce an accessible compact mobile navigation pattern below the breakpoint, such as a menu button/drawer or prioritized primary links plus overflow menu. Preserve `aria-current`, localized labels, focus restoration, and the 44 px touch-target invariant.

### C94-DES-04 - Admin image management remains desktop-table-first on mobile

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:142`, `apps/web/src/components/image-manager.tsx:424`, `apps/web/src/components/image-manager.tsx:441`, `apps/web/src/components/image-manager.tsx:445`, `apps/web/src/components/image-manager.tsx:551`, `apps/web/src/components/image-manager.tsx:559`.
- Problem: recent uploads are placed in a viewport-height scroll container, and `ImageManager` always renders a wide table with preview, title, filename, topic, tags, gamut, date, and action columns. On narrow screens the only responsive strategy is horizontal overflow.
- Failure scenario: mobile admins must horizontally pan a dense table to edit tags, retry metadata review, or reach edit/delete actions; row context can be lost while scrolling sideways.
- Suggested fix: keep the table for desktop and add a mobile card/list layout below the admin breakpoint. Each card should expose preview, title/filename, topic, tag editor, color badges, date, and edit/delete actions in a single vertical flow with existing labels and 44 px controls. Add responsive/browser evidence or source contracts for the mobile variant.

## Validation

- Static source review covered `components/`, `app/[locale]/admin/`, `app/[locale]/(public)/`, `messages/en.json`, `messages/ko.json`, `src/__tests__/`, and `e2e/`.
- Confirmed cycle-93 fixes for load-more live-region failures and token-label validation are present at current HEAD.
- No production services were started and no app source files were modified.

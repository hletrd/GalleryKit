# Cycle 93 UI/UX/A11y Review

Scope: current deployed `master` at `2571d8a8c27e2d2a7bc95ed5e6a72e26487093dc`.

## Confirmed Findings

### C93-02 - Load-more failure states are toast-only and leave the live region stale

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/components/load-more.tsx:49`, `apps/web/src/components/load-more.tsx:81`, `apps/web/src/components/load-more.tsx:93`, `apps/web/src/components/load-more.tsx:165`.
- Problem: failure branches show a toast but do not update the `aria-live` status message after it was set to "Loading more".
- Failure scenario: a screen-reader user triggers load-more, receives stale "Loading more" progress text, and never receives persistent inline/live-region failure feedback.
- Suggested fix: set `statusMessage` to the localized rate-limit, maintenance, or generic failure message on every non-OK branch and cover it with a source contract.

### C93-03 - Lightroom token label validation is toast-only

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:55`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:166`.
- Problem: submitting an empty token label only emits a toast; the label input has no inline error text, `aria-invalid`, or `aria-describedby`.
- Failure scenario: keyboard and screen-reader users do not receive field-associated validation and may remain focused on an apparently valid input.
- Suggested fix: store local label error state, render an inline alert below the field, wire `aria-invalid` and `aria-describedby`, and clear the error on input change/dialog close.

### C93-09 - Zoomed photo can be toggled by keyboard but cannot be panned by keyboard

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/components/image-zoom.tsx:201`, `apps/web/src/components/image-zoom.tsx:328`, `apps/web/src/components/image-zoom.tsx:365`, `apps/web/src/components/lightbox.tsx:340`.
- Problem: keyboard users can toggle zoom with Enter/Space, but ArrowLeft/ArrowRight remain lightbox navigation controls and there is no keyboard pan contract for the zoomed image.
- Failure scenario: a keyboard-only visitor cannot inspect off-center details in a zoomed photograph.
- Suggested fix: define keyboard pan semantics for focused zoom surfaces when zoom level is greater than 1, prevent those keys from bubbling to lightbox navigation, and add accessibility tests.

### C93-10 - Mobile admin navigation remains a flat wrapped 10-link header

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/components/admin-nav.tsx:15`, `apps/web/src/components/admin-nav.tsx:29`, `apps/web/src/components/admin-header.tsx:14`.
- Problem: the mobile admin header renders ten same-level links that wrap into several rows before the content.
- Failure scenario: phone users must traverse a large navigation block on every admin page before reaching page-specific controls.
- Suggested fix: move lower-frequency routes into an accessible compact mobile menu/drawer while preserving `aria-current` and 44 px touch targets.

### C93-11 - Admin image management is desktop-table-first on mobile

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:142`, `apps/web/src/components/image-manager.tsx:424`, `apps/web/src/components/image-manager.tsx:441`, `apps/web/src/components/image-manager.tsx:551`.
- Problem: recent uploads and image management use dense horizontal tables on mobile.
- Failure scenario: admins on phones must pan horizontally to reach edit/delete actions and important metadata.
- Suggested fix: add a mobile card/list layout below the desktop breakpoint, keeping the existing table for desktop.

## Focused Validation

Reviewer lane ran and passed `touch-target-audit`, `i18n-key-parity`, `a11y-us-p15`, `focus-visible-rings-cycle20`, `image-zoom-source-contracts`, `load-more-source-contracts`, and `client-source-contracts`: 7 files, 49 tests.

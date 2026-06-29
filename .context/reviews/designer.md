# Designer Review - Cycle 9

Role: designer UI/UX review lane. Scope: Next.js public and admin UI, information architecture, affordances, focus and keyboard navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, reduced motion, responsive behavior, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

No source code or plan files were edited. This report is the only intended artifact.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- agent-browser skill docs for core navigation, config, query, visual, interact, wait, network, debug, and state.

UI-relevant inventory built before judging findings:

- Public route surfaces under `apps/web/src/app/[locale]/(public)/`: home, topic, collection/share routes, map, photo detail/loading, smart collections, timeline, year, and upload-file route surfaces.
- Admin/authenticated route surfaces under `apps/web/src/app/[locale]/admin/`: login, protected layout, dashboard/upload manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, loading, and error shells.
- Shared UI components under `apps/web/src/components/`: navigation, search, home/masonry cards, tag filter, load-more, photo viewer, lightbox, image zoom, bottom sheet, color/HDR details, histogram, upload dropzone, tag input, image manager, bulk edit, admin nav/header, user management, and UI primitives.
- Styling and tokens: `apps/web/src/app/[locale]/globals.css`, UI primitive sizing/focus contracts, light/dark/oled tokens, reduced-motion and forced-colors CSS.
- i18n: `apps/web/messages/en.json` and `apps/web/messages/ko.json`; RTL was reviewed as future-proofing only because shipped locales are English and Korean.
- Relevant tests: touch-target audit, focus-visible link scan, i18n parity, error shell, and photo-viewer HDR download guard.

Inventory count: 70 TS/TSX/CSS UI files under public/admin route and component roots were listed for this lane before targeted source review.

## Browser Evidence

Local development:

- Started `npm run dev --workspace=apps/web`; Next.js 16.2.9 became ready on `http://localhost:3000`.
- Local DB-backed rendering was not representative: server output reported `ECONNREFUSED` while bootstrapping the image queue, and local `/en` rendered the app error shell. I therefore used production for public DOM/accessibility evidence, as allowed by the brief.

Production public target:

- Desktop home: `https://gallery.atik.kr/en`, viewport 1440x1000. Accessibility snapshot saved at `/tmp/gallery-home-desktop-a11y.txt`; screenshot saved at `/tmp/gallery-home-desktop.png`.
- Mobile Korean home: `https://gallery.atik.kr/ko`, viewport 390x844. Accessibility snapshot saved at `/tmp/gallery-home-mobile-ko-a11y.txt`; screenshot saved at `/tmp/gallery-home-mobile-ko.png`.
- Mobile search dialog: snapshot saved at `/tmp/gallery-search-mobile-ko-a11y.txt`; screenshot saved at `/tmp/gallery-search-mobile-ko.png`.
- Mobile photo detail and lightbox: snapshots saved at `/tmp/gallery-photo-mobile-a11y.txt` and `/tmp/gallery-lightbox-mobile-a11y.txt`.
- Admin login: `https://gallery.atik.kr/ko/admin`; snapshot saved at `/tmp/gallery-admin-login-a11y.txt`.

Representative browser checks:

- Desktop home exposed skip link, `navigation "Main navigation"`, search/theme/locale controls, `main`, H1 `Latest`, tag filter group, photo links, load-more, footer links, and notifications region. Visible buttons and photo links met the 44 px target-size floor in the sampled viewport.
- Mobile Korean home exposed localized navigation, topic links, H1 `최근 사진`, tag filter group, photo links, load-more, and footer. Body width matched viewport width with no horizontal overflow. Expanded mobile nav exposed search/theme/locale controls at 44x44 or larger.
- Search dialog focused the combobox on open, used `role="dialog"` with `aria-modal="true"`, kept Tab/Shift+Tab inside the dialog, announced result count through a live region, set `aria-controls="search-results"` when results existed, and updated `aria-activedescendant` on ArrowDown.
- Photo detail exposed a toolbar with fullscreen/info/next controls. Info bottom sheet opened as a modal dialog with an initially focused close control and a 44 px drag handle. Lightbox opened as a modal dialog with 44 px close/fullscreen controls and a full-height next target.
- Admin login exposed visible labels for username/password, required fields, autocomplete attributes, a password visibility toggle, and an alert region for server errors.
- Light and forced dark contrast sweeps found no visible text below the configured contrast threshold in the sampled public home DOM.

## Confirmed Issues

No confirmed UI/UX defects were found in this cycle.

This is a change from the cycle 7 designer artifact. The previously reported invalid-tag filter state is fixed in source and production: `apps/web/src/app/[locale]/(public)/page.tsx:161-166` canonicalizes tag slugs, passes canonical `currentTags` at `apps/web/src/app/[locale]/(public)/page.tsx:221-223`, and `apps/web/src/components/tag-filter.tsx:21-44` now uses canonical tags for toggle math. Browser evidence on `/en?tags=definitely-not-a-real-tag` showed `All` pressed, `Latest`, and the unfiltered photo set.

## Risks Needing Manual Validation

### DES-C9-RISK-01 - Custom modal surfaces should be validated with real assistive technologies for background virtual-cursor isolation

Severity: Medium
Confidence: Medium
Classification: risk needing manual validation; not a confirmed browser failure

Source evidence:

- Search dialog is a custom `FocusTrap` plus manual `role="dialog"` / `aria-modal="true"` surface at `apps/web/src/components/search.tsx:320-340`.
- Lightbox is a custom `FocusTrap` plus manual dialog surface at `apps/web/src/components/lightbox.tsx:446-453`.
- Info bottom sheet is a custom `FocusTrap` plus manual dialog surface at `apps/web/src/components/info-bottom-sheet.tsx:185-199`.

Browser evidence:

- Keyboard Tab and Shift+Tab stayed inside the search dialog in Chromium, and lightbox/bottom-sheet focus initially landed on the intended controls.
- The Chromium accessibility snapshot for the open search dialog still included surrounding page landmarks and content alongside the dialog. That snapshot alone does not prove a screen-reader leak because `aria-modal` behavior varies by assistive technology/browser pairing, but it is enough to require manual AT validation.

Failure scenario:

A VoiceOver, NVDA, or JAWS user opens search, the lightbox, or the bottom sheet and uses browse/rotor/virtual-cursor navigation. If background content remains reachable, the user can move out of the modal context even though keyboard Tab is trapped, making the current UI state ambiguous and increasing the chance of accidental navigation.

Suggested fix:

Validate the three custom modal surfaces with VoiceOver Safari and NVDA/Chrome or NVDA/Firefox. If background content is reachable, either migrate the custom shells to the existing Radix Dialog primitive or add a robust inert/`aria-hidden` sibling strategy while each modal is open. Keep the current focus-trap behavior; the risk is about virtual-cursor isolation, not ordinary Tab trapping.

### DES-C9-RISK-02 - Authenticated admin UI still needs live browser coverage with a saved auth state

Severity: Low
Confidence: High
Classification: coverage risk needing manual validation

Source evidence:

- Admin login has visible labels, required fields, autocomplete, password reveal, and alert error handling at `apps/web/src/app/[locale]/admin/login-form.tsx:47-104`.
- Shared button sizing floors 44 px touch targets through `apps/web/src/components/ui/button.tsx:23-29`.
- The mobile/public touch-target policy is guarded by `apps/web/src/__tests__/touch-target-audit.test.ts:5-23` and widened scan roots at `apps/web/src/__tests__/touch-target-audit.test.ts:42-65`.

Browser evidence:

- The deployed admin login page was browser-tested without credentials and looked accessible in the accessibility snapshot.
- `agent-browser state list` had no saved authenticated state, and local DB was unavailable, so protected admin pages were reviewed from source rather than exercised as live DOM.

Failure scenario:

An authenticated-only admin table, dialog, bulk-edit flow, upload state, or responsive breakpoint could have focus order, overflow, error-state, or live-region defects that are not visible from the login page or source review alone.

Suggested fix:

For the next cycle, provide a seeded local DB plus admin credentials, or save a reusable `agent-browser` auth state for a non-production reviewer account. Add a browser smoke pass that covers upload, bulk edit, settings, SEO, tags, categories, analytics, and user management at desktop and mobile breakpoints.

## False Positives / Already Fixed

### DES-C9-FP-01 - Back-to-top button is hidden from keyboard and accessibility navigation until visible

Classification: false positive / already guarded

Source evidence:

- `apps/web/src/components/home-client.tsx:440-451` sets opacity and pointer-events from `showBackToTop`, and also toggles `aria-hidden` plus `tabIndex`.

Browser evidence:

- At page top, the button had a 44x44 box but `aria-hidden="true"`, `tabIndex=-1`, `opacity: 0`, and `pointer-events: none`.
- After scrolling, it became visible, focusable, and present in the accessibility snapshot as `Back to top`.

Conclusion:

Do not file a target-size or hidden-focus issue here. The element is intentionally mounted for transition continuity but removed from keyboard/a11y navigation while hidden.

### DES-C9-FP-02 - Tag-filter invalid-slug state from cycle 7 is fixed

Classification: false positive / already fixed

Source evidence:

- Server canonicalization is at `apps/web/src/app/[locale]/(public)/page.tsx:161-166`.
- Canonical tags are passed to the client at `apps/web/src/app/[locale]/(public)/page.tsx:221-223`.
- `TagFilter` now derives pressed state and next URLs from `canonicalTags` at `apps/web/src/components/tag-filter.tsx:21-44` and `apps/web/src/components/tag-filter.tsx:62-123`.

Browser evidence:

- `/en?tags=definitely-not-a-real-tag` rendered the visible unfiltered gallery with `All` pressed.
- `/en?tags=shinyu` rendered a filtered gallery with `SHINYU` pressed and visible photo labels matching the filter.

Conclusion:

The cycle 7 finding should remain closed.

### DES-C9-FP-03 - Touch-target risk is covered by runtime samples and source/test guards

Classification: false positive / already guarded

Source evidence:

- Shared button variants use 44 px or larger floors at `apps/web/src/components/ui/button.tsx:23-29`.
- Nav, search, tag chips, bottom-sheet handle, lightbox controls, and login password reveal all use explicit 44 px floors or the shared primitive: `apps/web/src/components/nav-client.tsx:99-107`, `apps/web/src/components/search.tsx:301-317`, `apps/web/src/components/tag-filter.tsx:62-123`, `apps/web/src/components/info-bottom-sheet.tsx:213-245`, `apps/web/src/components/lightbox.tsx:546-620`, and `apps/web/src/app/[locale]/admin/login-form.tsx:81-104`.

Browser evidence:

- Sampled desktop and mobile public pages had visible buttons and links at 44 px or larger.
- The targeted touch-target audit passed.

Conclusion:

No new 44 px target-size finding is warranted from this pass.

## Category Review Notes

- Information architecture: public navigation exposes brand/home, topics, search, theme, locale, main content, photo cards, load-more, and footer in a coherent order. The mobile nav model now correctly advertises only `primary-nav-controls` from the expand button at `apps/web/src/components/nav-client.tsx:99-108`; topics remain visible and scrollable at `apps/web/src/components/nav-client.tsx:116-159`.
- Affordances: icon-only controls have accessible labels or title/shortcut text where appropriate. Search, theme, locale, fullscreen, info, lightbox, and password reveal controls were understandable in source and browser snapshots.
- Focus and keyboard: skip link exists at `apps/web/src/app/[locale]/layout.tsx:119-128`; search keyboard navigation and focus trap worked in browser; lightbox focus management and restore are implemented at `apps/web/src/components/lightbox.tsx:430-443`.
- WCAG 2.2 / contrast / ARIA: sampled light/dark contrast checks passed; current components use visible labels, `aria-pressed`, `aria-current`, `aria-modal`, live regions, progress roles, and focus rings. Manual AT validation remains recommended for the custom modal shells.
- Reduced motion: global reduced-motion CSS suppresses transitions/animations and hover photo scale at `apps/web/src/app/[locale]/globals.css:291-317`; lightbox also observes `prefers-reduced-motion` at `apps/web/src/components/lightbox.tsx:92-109`.
- Responsive behavior: desktop and 390 px mobile public pages, mobile nav expansion, mobile search, mobile photo detail, info sheet, and lightbox had no horizontal overflow in sampled DOM measurements.
- Loading/empty/error states: home empty state and clear-filter affordance are present at `apps/web/src/components/home-client.tsx:424-438`; search loading/no-result/results live text is at `apps/web/src/components/search.tsx:393-407`; local app error shell was reachable when DB was down.
- Form validation UX: login uses visible labels, native required validation, autocomplete, password reveal, pending submit text, and role-alert server errors at `apps/web/src/app/[locale]/admin/login-form.tsx:47-104`.
- Dark/light mode: production home passed a sampled contrast sweep in light and forced dark class modes. OLED was source-reviewed but not separately browser-measured in this pass.
- i18n/RTL: English and Korean public routes produced localized labels and `lang` values; `dir="ltr"` is explicit at `apps/web/src/app/[locale]/layout.tsx:94-100`. No RTL locale ships today, so RTL remains future-work rather than a current defect.
- Perceived performance: production home loaded representative image/RSC assets without observed broken public DOM. Search results update live after input. Local dev performance could not be judged due DB unavailability.

## Verification

Targeted tests run:

```sh
npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/error-shell.test.ts src/__tests__/photo-viewer-no-hdr-download.test.ts
```

Result: 5 test files passed, 46 tests passed.

Not run: full lint, typecheck, build, or full test suite. This lane changed only a review artifact and did not edit application source.

## Final Missed-Issue Sweep

- Rechecked prior designer issues: invalid tag state and mobile nav `aria-controls` are fixed.
- Rechecked hidden controls: back-to-top is not keyboard reachable while hidden.
- Rechecked modal basics: search, bottom sheet, and lightbox focus behavior worked for keyboard users in Chromium; manual AT validation remains open as DES-C9-RISK-01.
- Rechecked touch targets: source/test/runtime samples support the 44 px policy.
- Rechecked public responsive samples: no horizontal overflow at desktop or mobile.
- Rechecked contrast: sampled visible public text passed in light and forced dark class modes.
- Rechecked admin coverage boundary: login is validated in browser; protected admin remains source-only pending auth state.

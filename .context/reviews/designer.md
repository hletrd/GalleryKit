# Designer Review - Cycle 6 / 100

Role: designer / UI-UX reviewer. Scope: Next.js frontend UI/UX, information architecture, affordances, keyboard/focus navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, responsive behavior, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL constraints, and perceived performance. No fixes were implemented. No commit, push, or deploy was performed per prompt.

## Inventory Coverage

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- agent-browser skills: core navigation, query, visual capture, interaction, configuration, wait, network, and debug.

Review inventory built before findings:

- Public localized routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared group/link, photo detail/loading, map, timeline, year, and upload-file route surfaces.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected layout, dashboard/upload manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, loading, and error shells.
- Shared UI components under `apps/web/src/components/`: nav, search, masonry home client, load more, photo viewer, lightbox, image zoom, bottom sheet, color details, histogram, upload dropzone, tag input/filter, admin nav/header, image manager, user manager, and shadcn/Radix primitives.
- Styling and tokens: `apps/web/src/app/[locale]/globals.css`, UI primitive class contracts, dark/oled tokens, forced-colors and reduced-motion CSS.
- i18n: `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Test/e2e coverage relevant to UI/a11y: touch-target audit, focus-visible scanner, US-P15 a11y contracts, client source contracts, bottom-sheet IA tests, HDR contrast tests, public/admin Playwright specs.
- Cross-file interactions checked: route locale handling, modal/focus-trap source contracts, upload in-flight state, tag input focusability, existing prior designer findings, and static fixture coverage.

Files intentionally not inspected in detail: Drizzle migrations, image-processing internals, storage backends, deployment scripts, non-UI server action internals, and most data/security tests outside UI cross-file contracts. They are outside this Prompt 1 frontend review except where they affected browser feasibility or UI state.

## Browser Evidence

Started `npm run dev --workspace=apps/web`; Next.js served `http://localhost:3000`. Closed agent-browser and stopped the dev server before finishing.

Runtime blocker: local MySQL was unavailable at `127.0.0.1:3306`. Server logs repeatedly showed `connect ECONNREFUSED 127.0.0.1:3306`, including failures in `src/components/nav.tsx:7` while reading topics. Therefore DB-backed public galleries, photo detail pages, search results, upload/dashboard tables, and protected admin workflows could not be fully browser-validated locally.

Browser checks completed with agent-browser:

- `/en` rendered the localized error shell because the public Nav query failed. Accessibility snapshot exposed skip link, `main`, h1 `Error`, retry button, and return link.
- `/en/admin` rendered the login page at desktop and mobile widths. Accessibility snapshot exposed h1 `Admin`, visible username/password labels, required inputs, password reveal button, submit button, and notifications region.
- Mobile focus order on login: username input -> password input -> show-password button -> sign-in button. Computed element sizes from DOM eval: username input 308x44, password input 308x44, reveal button 44x44, submit 308x44.
- Captured screenshots: `/tmp/gallery-home-error-desktop.png`, `/tmp/gallery-login-desktop.png`, `/tmp/gallery-login-mobile.png`, `/tmp/gallery-login-mobile-dark.png`.
- Browser console showed expected dev/HMR logs plus DB fallback warnings/errors caused by missing local MySQL. `agent-browser errors` reported no uncaught page errors on the renderable login surface.

## Confirmed Issues

### DES-C6-01 - Collapsed mobile photo info sheet keeps a modal focus trap around hidden controls

Severity: Medium
Confidence: High
Status: confirmed by source; browser runtime validation blocked by missing DB/photo data.
Region: `InfoBottomSheet` collapsed/peek/expanded state and focus trap.

Evidence:

- `apps/web/src/components/info-bottom-sheet.tsx:42` defines `SheetState = 'collapsed' | 'peek' | 'expanded'`.
- `apps/web/src/components/info-bottom-sheet.tsx:66-73` translates the collapsed sheet to `calc(100% - 28px)`, leaving only a 28 px strip visible.
- `apps/web/src/components/info-bottom-sheet.tsx:108-113` transitions from `peek` to `collapsed` on downward swipe, so this state is reachable.
- `apps/web/src/components/info-bottom-sheet.tsx:189-203` keeps `FocusTrap active={isOpen}` and `aria-modal="true"` for every open state, including `collapsed`.
- `apps/web/src/components/info-bottom-sheet.tsx:211-213` sets `overflowY: hidden` outside expanded mode, so most controls are visually clipped in collapsed mode.
- `apps/web/src/components/info-bottom-sheet.tsx:217-248` keeps both the drag handle and close button mounted; the close button sits below the handle and is clipped when only 28 px of the sheet is visible.
- `apps/web/src/__tests__/client-source-contracts.test.ts:45-49` only pins that the sheet is modal while open; it does not distinguish collapsed hidden-control behavior.

Why this is a problem:

In collapsed state the user visually sees only the handle, but the component still advertises a modal dialog and traps focus inside all mounted controls. Keyboard and screen-reader users can land on controls that are not visible, and the page behind the sheet remains unavailable because the focus trap stays active. This risks WCAG 2.1.2 keyboard trap, 2.4.3 focus order, and 4.1.2 name/role/state failures.

Failure scenario:

A mobile visitor opens photo info, swipes it down to the collapsed strip, then uses an external keyboard or screen reader navigation. Focus remains trapped in a "Photo Info" modal and can move to the hidden close button or other clipped controls, even though only the handle is visible. The user has no visual correspondence for the focused target and cannot continue through the underlying photo page without discovering Escape or another close gesture.

Suggested fix:

Prefer removing the `collapsed` modal state and closing the sheet when swiping down from `peek`. If collapsed must remain, make collapsed a non-modal mini-control: disable the focus trap, set `aria-modal={false}`, make all clipped controls inert/untabbable, and leave only the visible handle focusable with an accurate label such as "Expand photo info".

### DES-C6-02 - Upload queue looks disabled during upload but remains keyboard-operable

Severity: Medium
Confidence: High
Status: confirmed by source; protected admin browser validation blocked by missing DB/auth data.
Region: upload file grid while `uploading` is true.

Evidence:

- `apps/web/src/components/upload-dropzone.tsx:198-270` starts an async sequential upload loop over the current `files` array.
- `apps/web/src/components/upload-dropzone.tsx:448-450` dims the selected-file grid during upload with `opacity-50 pointer-events-none`.
- `apps/web/src/components/upload-dropzone.tsx:451-453` leaves the "Clear all" button enabled inside that dimmed region.
- `apps/web/src/components/upload-dropzone.tsx:469-475` leaves each per-file remove button enabled with its normal `onClick`.
- `apps/web/src/components/upload-dropzone.tsx:505-518` leaves each per-file `TagInput` enabled.
- `apps/web/src/components/tag-input.tsx:17-24` exposes no `disabled` or read-only prop, so upload-dropzone cannot disable it without changing the component contract.

Why this is a problem:

`pointer-events-none` only blocks pointer input. Keyboard users can still tab into enabled child controls and activate them while the UI visually communicates that the queue is unavailable. That creates inconsistent affordance and can mutate `filesRef`, per-file tags, or preview state while the upload loop continues processing the original closure-captured `files` array.

Failure scenario:

An admin starts uploading several photos, tabs into the dimmed queue, activates "Clear all", or removes a file. The visible queue changes as if the pending item was cancelled, but the upload loop still continues through the original batch. The final cleanup then reconciles against a mutated `filesRef`, producing confusing UI and potentially applying tags that no longer match what the admin sees.

Suggested fix:

Replace visual-only disabling with real disabled semantics. Options: render the selected-file list as read-only during upload; add a `disabled` prop to `TagInput`; pass `disabled` to remove/clear buttons; and add `aria-disabled` plus `inert` to the in-flight queue container if the product decision is that the queue cannot be edited mid-upload. If mid-upload edits are intended, remove the disabled visual treatment and make the latest-wins/cancel semantics explicit.

## Likely Issues

None beyond the confirmed source-level issues above. Both findings need live reproduction after a DB-backed dev environment is available, but the source contracts are sufficient to classify the defects as actionable.

## Risks Needing Manual Validation

- Real public gallery/photo/detail surfaces could not be browser-validated because local MySQL was down. Static review covered the relevant source paths instead.
- Protected admin upload/dashboard behavior could not be browser-validated for the same reason. `DES-C6-02` should be manually confirmed in an authenticated dev environment with one queued file.
- The mobile bottom-sheet collapsed state should be manually confirmed on a real/touch-emulated photo page because it depends on gesture state, but the focus-trap/hidden-control source evidence is direct.

## Rechecked Non-Findings

- Cycle 5 analytics locale issue is fixed: analytics links now use `localizePath(locale, ...)`, localized `opensInNewWindow`, and locale-aware `toLocaleString(locale)` in `analytics-client.tsx:117-129` and `analytics-client.tsx:225-235`.
- Login form has visible labels, required/autocomplete fields, 44 px controls, password reveal `aria-pressed`, and alert/error plumbing.
- Public/admin layouts provide a global skip link and `main#main-content` targets for both public and admin shells.
- Nav, search, lightbox, photo navigation, and masonry cards carry focus-visible affordances or tests that enforce them.
- Global CSS includes reduced-motion suppression for animations/transitions and hover scale, plus forced-colors handling for key photo-card and badge surfaces.
- Dark/oled/light tokens are documented and login rendered in dark media without layout breakage.
- English/Korean are LTR locales; `layout.tsx` sets `dir="ltr"`. RTL remains unsupported rather than a current shipped-locale defect.

## Validation

Passed:

```bash
npm test --workspace=apps/web -- --run src/__tests__/a11y-us-p15.test.ts src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/client-source-contracts.test.ts src/__tests__/hdr-badge-contrast.test.ts
```

Result: 5 test files passed, 63 tests passed.

Agent-browser evidence:

- `agent-browser install` confirmed Chromium 150.0.7871.24 installed.
- Desktop public error shell snapshot captured from `/en`.
- Desktop/mobile/dark login snapshots captured from `/en/admin`.
- Login focus order and 44 px target sizes verified by DOM evaluation.

## Final Missed-Issues Sweep

Final sweep covered prior designer reviews, current route/component inventory, ARIA/focus/modal markers, `pointer-events-none` and disabled-state patterns, touch-target/focus-visible scanner coverage, bottom-sheet tests, upload-dropzone tests, loading/error shells, i18n messages, dark/light/reduced-motion CSS, and browser console/server output.

No additional current-cycle actionable UI/UX findings were identified beyond `DES-C6-01` and `DES-C6-02`.

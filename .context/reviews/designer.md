# Cycle 1 Deep Review — Designer UI/UX Reviewer

Scope: `/Users/hletrd/flash-shared/gallery`, focused on the Next.js app in `apps/web`.

Write scope honored: this review edits only `.context/reviews/designer.md`; no application source edits or commits.

## Inventory first

### Runtime inventory

- Tried to load the current app with `npx next dev -p 3100` from `apps/web`.
- Public route `http://localhost:3100/en` rendered the app error boundary, not the gallery, because the local DB connection reported `ER_NO_DB_ERROR: No database selected` while loading topics/images. Browser snapshot showed only the route error surface: `Error`, `Something went wrong loading this page.`, `Try again`, `Return to Gallery`.
- Admin login route `http://localhost:3100/en/admin` did render and was inspected with `agent-browser` accessibility snapshots. It exposed `lang="en"`, `dir="ltr"`, skip link, visible username/password labels, show-password control, and a 44px submit/toggle target.
- Because public gallery data could not load in this environment, most public-gallery findings below are from DOM/TSX/CSS inspection rather than full visual runtime traversal.

### Product / information architecture surfaces

- Public shell and route states: `apps/web/src/app/[locale]/layout.tsx:88-132`, `apps/web/src/app/[locale]/(public)/layout.tsx:8-22`, `apps/web/src/app/[locale]/loading.tsx:6-13`, `apps/web/src/app/[locale]/error.tsx:15-37`, `apps/web/src/app/[locale]/not-found.tsx:19-52`.
- Public gallery: `apps/web/src/app/[locale]/(public)/page.tsx:123-191`, `apps/web/src/components/home-client.tsx:150-319`, `apps/web/src/components/nav-client.tsx:70-164`, `apps/web/src/components/search.tsx:148-299`, `apps/web/src/components/tag-filter.tsx:65-104`, `apps/web/src/components/load-more.tsx:110-124`.
- Photo detail: `apps/web/src/components/photo-viewer.tsx:258-651`, `apps/web/src/components/photo-navigation.tsx:42-139`, `apps/web/src/components/lightbox.tsx:264-390`, `apps/web/src/components/info-bottom-sheet.tsx:144-237`, `apps/web/src/components/image-zoom.tsx:116-149`.
- Admin shell/forms/tables: `apps/web/src/app/[locale]/admin/layout.tsx:18-27`, `apps/web/src/app/[locale]/admin/login-form.tsx:34-108`, `apps/web/src/components/admin-header.tsx:13-28`, `apps/web/src/components/admin-nav.tsx:26-44`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:25-75`, `apps/web/src/components/upload-dropzone.tsx:304-490`, `apps/web/src/components/image-manager.tsx:253-503`.
- Admin settings/maintenance forms: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:73-190`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:72-179`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:126-245`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:40-112`.
- Shared UI/styles/i18n: `apps/web/src/app/[locale]/globals.css:13-168`, `apps/web/src/components/ui/button.tsx:7-35`, `apps/web/src/components/ui/dialog.tsx:49-80`, `apps/web/src/components/ui/alert-dialog.tsx:47-143`, `apps/web/src/components/tag-input.tsx:167-249`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

## Findings

### DSGN-C1-01 — Light-theme destructive buttons fail WCAG AA text contrast

- **Severity:** High
- **Confidence:** High
- **Area:** WCAG 2.2 contrast, destructive affordances, admin safety UX
- **Evidence:** `apps/web/src/app/[locale]/globals.css:36-37`, `apps/web/src/components/ui/button.tsx:13-14`, destructive usages at `apps/web/src/components/image-manager.tsx:312-329`, `apps/web/src/components/image-manager.tsx:445-464`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:194-214`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:233-248`.
- **Selector/token:** `.bg-destructive.text-white`, `--destructive: 0 84.2% 60.2%`.

**What happens**

In light mode the destructive token is approximately RGB `239, 68, 68` (`hsl(0 84.2% 60.2%)`). The shared destructive button variant renders white text on that background (`bg-destructive text-white`). Calculated contrast is about **3.76:1**, below the WCAG AA 4.5:1 threshold for normal-size button text.

**Failure scenario**

On the delete/restore flows, users with low vision or washed-out displays have the hardest time reading the most safety-critical controls: Delete, Delete selected, Restore, and confirm destructive actions.

**Suggested fix**

Darken the light-theme destructive token to a red that supports white text, e.g. Tailwind red-600-ish (`#dc2626`, about 4.83:1) or darker, and keep the dark-theme token separate. Also prefer `text-destructive-foreground` in `button.tsx` instead of hard-coded `text-white` so token pairs stay auditable.

---

### DSGN-C1-02 — Public route errors remove the normal navigation shell

- **Severity:** Medium
- **Confidence:** High
- **Area:** Information architecture, error recovery, runtime UX
- **Evidence:** Runtime browser snapshot for `http://localhost:3100/en`; `apps/web/src/app/[locale]/error.tsx:15-37`; compare the richer 404 shell in `apps/web/src/app/[locale]/not-found.tsx:19-52`.
- **Selector/surface:** Route error boundary `<main> > section[aria-labelledby="route-error-title"]`.

**What happens**

When the public home route failed locally because the DB was not selected, the user saw only the generic error card and two controls. The normal public nav, topic navigation, search affordance, locale/theme controls, and footer were absent. This contrasts with the not-found page, which intentionally restores `Nav` and `Footer`.

**Failure scenario**

A transient DB or route failure strands a visitor on a dead-end-looking page. They can retry or return home, but cannot switch locale, browse topics, use search, or orient themselves via the site shell.

**Suggested fix**

Bring the route error surface closer to the 404 shell: include `Nav`/`Footer` or render the error card inside the public layout chrome. Keep the primary retry button, but add a short, user-centered recovery message and preserve global navigation affordances.

---

### DSGN-C1-03 — Settings and SEO forms bypass native validation UX

- **Severity:** Medium
- **Confidence:** High
- **Area:** Form validation UX, error discoverability, admin task safety
- **Evidence:** Settings save button is a free button handler at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:84-87`; settings constrained inputs at `settings-client.tsx:103-111`, `settings-client.tsx:144-152`; SEO save button at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:83-86`; URL input at `seo-client.tsx:166-173`.
- **Selector/surface:** Admin Settings/SEO Save buttons; inputs with `type="number"`, `pattern`, and `type="url"` outside a `<form>` submit flow.

**What happens**

These screens use constrained inputs (`min`, `max`, `pattern`, `type="url"`) but the Save buttons call custom click handlers instead of submitting a form or calling `reportValidity()`. As a result, browser-native invalid-field blocking/focus and inline validation bubbles may not fire before the server action/toast path.

**Failure scenario**

An admin enters an invalid OG URL or malformed image size list, clicks Save, and gets only a toast or server error. Focus does not move to the offending field, fields do not get `aria-invalid`, and screen-reader users have to infer which field failed.

**Suggested fix**

Wrap each page in a `<form onSubmit>` and make Save `type="submit"`, or keep the click handler but call a form ref’s `reportValidity()` first. For server-returned validation, map errors back to field-level text with stable IDs and `aria-describedby`; move focus to the first invalid field.

---

### DSGN-C1-04 — Admin navigation links are visually small tap targets

- **Severity:** Medium
- **Confidence:** Medium
- **Area:** Affordance, responsive admin navigation, WCAG 2.2 target-size resilience
- **Evidence:** `apps/web/src/components/admin-nav.tsx:26-44`; header placement in `apps/web/src/components/admin-header.tsx:13-28`.
- **Selector/surface:** `nav[aria-label=adminNav] a`.

**What happens**

The public nav and several photo/admin actions explicitly use 44px touch targets, but the admin nav links are plain text links with no vertical padding or minimum height. On narrow admin viewports they wrap, but each target remains roughly the text box rather than a clearly tappable pill/button.

**Failure scenario**

On a tablet or phone, an admin trying to switch between Dashboard, Categories, Tags, SEO, Settings, Password, Users, and Database can easily mistap adjacent links, especially when the wrapped nav spans multiple rows.

**Suggested fix**

Give admin nav links a consistent hit area and active styling: e.g. `inline-flex min-h-10 items-center rounded-md px-3 py-2`, with stronger active background. This also improves scanability by making the nav look like a control group instead of dense inline text.

---

### DSGN-C1-05 — Bottom sheet uses modal focus trapping even in non-expanded/peek states

- **Severity:** Medium
- **Confidence:** Medium
- **Area:** Keyboard/focus, ARIA modal semantics, mobile photo detail UX
- **Evidence:** `apps/web/src/components/info-bottom-sheet.tsx:45-53`, `info-bottom-sheet.tsx:155-166`, `info-bottom-sheet.tsx:167-178`, `info-bottom-sheet.tsx:180-215`.
- **Selector/surface:** `InfoBottomSheet` `role="dialog" aria-modal="true"` with `FocusTrap active={isOpen}`.

**What happens**

The info sheet has `collapsed`, `peek`, and `expanded` visual states, but once it is open it always declares itself an `aria-modal` dialog and always enables the focus trap. In peek/collapsed states much of the photo page remains visually present, while assistive tech and keyboard focus are treated as fully modal.

**Failure scenario**

A keyboard or screen-reader user opens info for a quick glance and is trapped in a small bottom-sheet interaction model instead of being able to continue reading/navigating the visible photo content. If a touch user collapses the sheet to the 28px handle state, the page can look nearly available while focus/modal semantics say otherwise.

**Suggested fix**

Use modal semantics only for the expanded sheet. Treat peek as a non-modal disclosure (`aria-expanded`, no focus trap), or remove the collapsed state and close the sheet on downward swipe. If staying modal, keep it expanded enough that the trapped region visibly matches the accessibility model.

---

### DSGN-C1-06 — Photo swipe navigation listens on `window`, not the photo region

- **Severity:** Low / Medium
- **Confidence:** Medium
- **Area:** Gesture affordance, responsive behavior, perceived control
- **Evidence:** `apps/web/src/components/photo-navigation.tsx:42-139`; mounted inside the photo canvas at `apps/web/src/components/photo-viewer.tsx:381-388`.
- **Selector/surface:** Global `touchstart`, `touchmove`, `touchend` listeners.

**What happens**

`PhotoNavigation` attaches touch listeners to `window`, so horizontal gestures anywhere on the photo-detail page can be interpreted as photo navigation. The component tries to reject vertical movement, but the listener scope is still wider than the visible image/navigation affordance.

**Failure scenario**

A mobile user horizontally pans within the info sheet/sidebar area, drags over controls, or performs a partial browser gesture and unexpectedly changes photos. This is especially risky in shared views where the URL is also updated as the current photo changes.

**Suggested fix**

Scope swipe listeners to the photo viewer image region/ref rather than `window`. Keep the keyboard arrow handlers global if desired, but make touch navigation opt-in to gestures that start on the image canvas.

---

### DSGN-C1-07 — Search combobox state is slightly inconsistent for assistive tech

- **Severity:** Low
- **Confidence:** Medium
- **Area:** ARIA combobox/listbox semantics
- **Evidence:** Trigger/dialog at `apps/web/src/components/search.tsx:148-187`; combobox props at `search.tsx:195-220`; listbox/no-result rendering at `search.tsx:245-288`.
- **Selector/surface:** `#search-input[role="combobox"]`, `#search-results[role="listbox"]`.

**What happens**

The input’s `aria-expanded` is tied to `results.length > 0`, while the search dialog has a visible body in all open states (hint, loading, no results, or listbox). In no-result/error states the popup is visually open, but the combobox reports not expanded and `aria-controls` may point to a listbox that is conditionally absent.

**Failure scenario**

Screen-reader users may not get a consistent mental model of the search popup: query entered, visible feedback changes, but the combobox expanded state says false unless actual result options exist.

**Suggested fix**

Either model the whole dialog as the search surface and remove combobox semantics, or keep a persistent controlled popup/listbox/status region with `aria-expanded={isOpen}` and stable IDs. Use `aria-busy` during loading and keep no-results text in a referenced status element.

---

### DSGN-C1-08 — RTL support is structurally hard-coded to LTR

- **Severity:** Low
- **Confidence:** High
- **Area:** i18n/RTL readiness
- **Evidence:** `apps/web/src/app/[locale]/layout.tsx:89-95`; currently shipped locales in `apps/web/src/lib/constants.ts:1-4`; message key parity checked for `en`/`ko`.
- **Selector/surface:** `<html lang={locale} dir="ltr">`.

**What happens**

The app is correct for the current shipped locales (`en`, `ko`) and both message files have matching key counts. However, direction is hard-coded to `ltr`, so adding Arabic/Hebrew/Persian/Urdu later would silently render with the wrong document direction.

**Failure scenario**

A future RTL locale ships with translated strings but layouts, punctuation flow, nav order, and form alignment remain LTR, creating a broad accessibility and readability defect.

**Suggested fix**

Introduce a locale-direction map, e.g. `const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'`, and audit spacing utilities that use physical `left/right` (`focus:left-4`, `right-4`, etc.) before adding an RTL locale.

## Positive observations

- Public layout has a skip link and focusable `main` target: `apps/web/src/app/[locale]/(public)/layout.tsx:10-18`.
- Admin login uses persistent visible labels, autocomplete, password reveal, and an inline alert path: `apps/web/src/app/[locale]/admin/login-form.tsx:42-104`.
- 404 page has meaningful shell, `main`, real heading, and nav/footer recovery: `apps/web/src/app/[locale]/not-found.tsx:19-52`.
- Reduced motion has a global guard in CSS: `apps/web/src/app/[locale]/globals.css:160-168`; photo viewer/lightbox also checks reduced motion in key places.
- Gallery cards include focus-within rings and mobile-visible overlays: `apps/web/src/components/home-client.tsx:191-266`.
- Load-more includes a manual button plus an SR live region: `apps/web/src/components/load-more.tsx:110-124`.
- Message catalogs are in parity (`en`: 510 flattened keys, `ko`: 510 flattened keys, no missing keys found).

## Final sweep checklist

- **Information architecture:** Reviewed public shell, nav, topic/tag filters, search, photo detail, 404, error boundary, admin shell, admin dashboard, and DB/settings/SEO surfaces. Main issue: public route error page loses normal IA chrome.
- **Affordances:** Public nav/search/theme/locale are explicit; photo controls are discoverable; admin nav is the weakest tap affordance.
- **Keyboard/focus:** Skip links and dialog primitives are mostly sound. Watch bottom-sheet modal semantics and search combobox state.
- **WCAG 2.2 contrast/ARIA/focus traps/reduced motion:** High-confidence contrast failure on light destructive buttons; bottom-sheet modal trap mismatch; global reduced-motion CSS present.
- **Responsive breakpoints:** Masonry and photo viewer have thoughtful breakpoints; admin tables are scroll-contained; admin nav target sizing should be improved for wrapped mobile/tablet rows.
- **Loading/empty/error states:** Loading states exist; 404 is strong; route error recovery needs the public shell. Search has visible hint/no-results branches but ARIA state could be cleaner.
- **Form validation UX:** Login/password/user creation are stronger; Settings/SEO custom save handlers need native validity/field-error integration.
- **Dark/light:** Theme tokens are present; destructive light-mode contrast needs token adjustment. Dark destructive contrast is acceptable.
- **i18n/RTL:** `en`/`ko` catalogs match; current LTR posture is acceptable for shipped locales but not RTL-ready.
- **Perceived performance:** Masonry uses `content-visibility`, eager above-fold loading, and blur/skeleton cues. Avoid unexpected global swipe or auto-loading behaviors where user control matters.

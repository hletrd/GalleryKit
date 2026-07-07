# GalleryKit Designer UI/UX Review - Cycle 17

Date: 2026-07-08
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `fc15b235`
Lane: designer subagent, no implementation changes

## Scope And Inventory

I read `AGENTS.md`, the relevant `CLAUDE.md` UI/color/HDR/i18n/touch-target sections, `README.md`, `apps/web/README.md`, current `apps/web` UI source, UI tests, locale messages, app routes, and relevant historical reviews under `.context/reviews/`.

UI/UX inventory reviewed:

- App route files: 51 files under `apps/web/src/app/[locale]`, including public routes, photo pages, topic pages, map, timeline, year, shared galleries, upload, admin login, and protected admin routes.
- Component files: 61 files under `apps/web/src/components`, including navigation, photo viewer, lightbox, image zoom, masonry/grid cards, search, filters, upload, admin data tools, token/user managers, color/HDR inspection components, map components, and admin shell components.
- Design primitives: 21 files under `apps/web/src/components/ui`.
- Global styling and tokens: `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/src/components/theme-provider.tsx`.
- Locale messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Playwright coverage: 10 files under `apps/web/e2e`.
- Unit and contract tests: 357 files under `apps/web/src/__tests__`.
- Prior UI reviews considered: current `.context/reviews/designer.md` before overwrite, cycle 10 designer/UI-UX reviews, cycle 96 designer/UI-UX reviews, cycle 97/98 UI reviews, and photographer-perspective context referenced by the repo docs.

No relevant UI source, route, message file, or listed UI test category was intentionally skipped. Authenticated admin runtime DOM and DB-backed public pages could not be fully browsed locally because MySQL was unavailable, so those findings are backed by source, tests, and partial browser evidence.

## Browser And Validation Evidence

Agent-browser CLI was available and used (`agent-browser 0.22.2`) with core, config, query, wait, network, visual, debug, interact/state-style commands where feasible.

Runtime attempt:

- Started built Next app with `PORT=3100 npm run start --workspace=apps/web -- --hostname 127.0.0.1`.
- Server became ready at `http://127.0.0.1:3100`.
- DB-backed pages logged `ECONNREFUSED 127.0.0.1:3306`; public `/en` rendered the app error shell instead of gallery content.
- Unauthenticated `/en/admin` rendered successfully.

Browser evidence:

- `/en/admin` accessibility snapshot exposed a skip link, `main`, heading `Admin`, labels for Username and Password, a `Show password` button, and `Sign in`.
- `/en/admin` had one `#main-content` target.
- Mobile control metrics on `/en/admin`: username input `334x44`, password input `334x44`, show-password button `44x44`, sign-in button `334x44`.
- `/en` error shell snapshot exposed skip link, banner navigation, `main`, region `Error`, heading `Error`, copy `Something went wrong loading this page.`, `Try again`, and `Return to Gallery`.
- Screenshots captured for evidence: `/tmp/gallery-cycle17-admin-login-mobile.png`, `/tmp/gallery-cycle17-public-error.png`.
- Browser metadata links on `/en/admin`: `/manifest.webmanifest`, `/icon?...`, `/apple-icon?...`.
- HTTP evidence showed `/icon` and `/apple-icon` redirect to `/en/icon` and `/en/apple-icon`, which then route through localized topic handling and 500 when the DB is unavailable.

Targeted verification:

```text
npm test --workspace=apps/web -- --run \
  src/__tests__/touch-target-audit.test.ts \
  src/__tests__/i18n-key-parity.test.ts \
  src/__tests__/focus-visible-links-scan.test.ts \
  src/__tests__/password-form-a11y.test.ts \
  src/__tests__/theme-token-contract.test.ts \
  src/__tests__/search-disclaimer.test.ts \
  src/__tests__/image-zoom-source-contracts.test.ts \
  src/__tests__/error-shell.test.ts
```

Result: 8 test files passed, 50 tests passed.

## Confirmed Findings

### DES-C17-01 - App icon routes are intercepted by locale routing

Severity: Medium
Confidence: High
Status: Confirmed by browser, HTTP, server logs, and source

Evidence:

- `apps/web/src/app/icon.tsx:4` defines the root metadata icon route.
- `apps/web/src/app/apple-icon.tsx:4` defines the root Apple touch icon route.
- `apps/web/src/app/manifest.ts:24` references `/icon`; `apps/web/src/app/manifest.ts:30` references `/apple-icon`.
- `apps/web/src/proxy.ts:127` uses matcher `'/((?!api|_next|_vercel|.*\\..*).*)'`, which does not exclude extensionless metadata routes such as `/icon` and `/apple-icon`.
- `apps/web/src/app/[locale]/(public)/[topic]/layout.tsx:21` queries topics for arbitrary localized path segments.
- Runtime evidence: `/icon` returned `307` to `/en/icon`; `/apple-icon` returned `307` to `/en/apple-icon`; localized icon paths then hit topic lookup and 500 while the DB was unavailable.

Why this is a problem:

Browser chrome assets and PWA install assets are part of perceived polish and page-load behavior. Redirecting them into localized app routes adds unnecessary work and can break icons entirely when the DB or topic route is unavailable.

Concrete failure scenario:

A visitor opens the site during a DB incident or cold start. The gallery error shell may render, but favicon and install icons also fail because the browser is sent to `/en/icon`, creating extra failed app requests and broken browser/app-shell branding.

Suggested fix:

Exclude root metadata assets from locale proxy handling, for example `/icon`, `/apple-icon`, `/manifest.webmanifest`, `/favicon.ico`, and any future `/icons/**` asset path. Add a regression test that asserts `/icon` and `/apple-icon` return image responses without locale redirects.

### DES-C17-02 - Admin create/edit validation still relies on transient toasts

Severity: Medium
Confidence: High
Status: Confirmed by source

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91` handles create errors with `toast.error(res.error)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:109` handles update errors with `toast.error(res.error)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:205` and `:363` render text fields without persistent server-error binding, `aria-invalid`, or error `aria-describedby`.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53` handles update errors with `toast.error(res.error)`.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:176` renders editable fields without persistent server-error binding.
- `apps/web/src/components/admin-user-manager.tsx:51` handles create errors with `toast.error(result.error)`.
- `apps/web/src/components/admin-user-manager.tsx:107` through `:125` renders user fields; only the client-side confirm-password mismatch gets an inline error.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42` handles SEO save errors with `toast.error(result.error)`.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98` through `:184` renders SEO fields with hints but no server-error state.

Why this is a problem:

Toasts are easy to miss for screen-reader, keyboard-only, low-vision, and interrupted admin workflows. Server validation errors should be persistent, associated with the failed field or form, and discoverable after focus returns.

Concrete failure scenario:

An admin tries to create a category with a duplicate slug. The server rejects it, a toast appears briefly, focus remains in the form, and the slug field has no persistent invalid state or inline explanation. A screen-reader user may not know which field failed or how to recover.

Suggested fix:

Keep toast as a secondary notification, but add persistent form-level `role="alert"` plus field-level messages. Set `aria-invalid` and `aria-describedby` on invalid fields, and move focus to the first invalid field or the alert summary after submit failure.

### DES-C17-03 - Oversized DB restore file rejection clears state with toast-only feedback

Severity: Medium
Confidence: High
Status: Confirmed by source

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:76` rejects oversized restore files in `handleRestore` using `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:80` clears `restoreFile`.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:81` bumps `fileInputKey`, resetting the file input.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:190` through `:205` repeats the same toast-and-reset behavior in the file input `onChange`.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:209` shows a static size hint but no inline rejected-file state, `role="alert"`, `aria-invalid`, or `aria-describedby` on the file input.

Why this is a problem:

Database restore is a high-attention admin workflow. Clearing the selected file without persistent explanation makes the interface feel unreliable and makes the failure hard to recover from if the toast is missed.

Concrete failure scenario:

An admin selects a 300 MB backup. The file disappears from the control and the only failure explanation is a transient toast. If the admin is using assistive tech or looking at the file picker, the reason for the reset may be lost.

Suggested fix:

Store a persistent rejected-file error near the file input, associate it with the control using `aria-describedby`, and set `aria-invalid` while the error is present. Keep the rejected filename visible until the user selects another file or dismisses the error.

### DES-C17-04 - Zoomed photos can be entered by keyboard but not panned by keyboard

Severity: Medium
Confidence: High
Status: Confirmed by source and tests

Evidence:

- `apps/web/src/components/image-zoom.tsx:118` implements mouse drag panning.
- `apps/web/src/components/image-zoom.tsx:230` implements touch pinch and drag panning.
- `apps/web/src/components/image-zoom.tsx:198` implements keyboard zoom toggle for Enter/Space.
- `apps/web/src/components/image-zoom.tsx:342` implements Escape reset.
- `apps/web/src/components/image-zoom.tsx:368` makes the image zoom surface focusable with `role="button"`, but it does not handle arrow-key panning.
- `apps/web/src/__tests__/image-zoom-source-contracts.test.ts` covers keyboard toggle contracts, not keyboard panning.

Why this is a problem:

The component exposes zoom as a keyboard-accessible action but does not expose the core inspection function, moving around the zoomed image. This creates an incomplete keyboard experience for a central photo-viewing affordance.

Concrete failure scenario:

A keyboard or switch-device user opens a detailed image, presses Enter to zoom, and can only inspect the centered crop. Areas outside the center are unavailable unless they use a pointer or touch gesture.

Suggested fix:

When zoomed and focused, support Arrow keys for panning, Shift+Arrow for larger steps, and Home/End or `0` for reset. Add localized instructions through `aria-describedby` and test the keyboard pan behavior.

### DES-C17-05 - Admin recent uploads remain a dense horizontal-scroll table with embedded tag editing

Severity: Medium
Confidence: Medium-High
Status: Confirmed by source; authenticated browser validation blocked by missing DB/session

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135` wraps recent uploads in `max-h-[70vh] overflow-auto`.
- `apps/web/src/components/image-manager.tsx:427` renders an additional `overflow-x-auto` table wrapper.
- `apps/web/src/components/image-manager.tsx:431` through `:452` defines many columns: preview, title, filename, topic, tags, gamut, date, actions.
- `apps/web/src/components/image-manager.tsx:501` through `:534` embeds `TagInput` inside each row.
- `apps/web/src/components/tag-input.tsx:184` makes the tag input container `relative`.
- `apps/web/src/components/tag-input.tsx:231` positions suggestions as an absolutely positioned child with `top-full left-0 w-full z-50`.

Why this is a problem:

Horizontal scrolling tables are hard to operate on narrow screens, and an absolutely positioned suggestion list inside nested overflow containers can be clipped or visually separated from its input. This is especially risky because the row already contains multiple editable controls.

Concrete failure scenario:

An admin on a small laptop or tablet edits tags in the recent uploads table. They must horizontally scroll to the tag column, open suggestions, and the suggestion list can be clipped by the scrolling table or max-height dashboard region.

Suggested fix:

Use a responsive card or inspector layout below `md`, or move editing into a drawer/dialog launched from each row. If inline tag editing remains, render suggestions in a portal/popover positioned against the viewport instead of inside the overflow table.

### DES-C17-06 - Truncated technical values rely on native `title` tooltips

Severity: Low-Medium
Confidence: High
Status: Confirmed by source

Evidence:

- `apps/web/src/components/info-bottom-sheet.tsx:413` and `:420` truncate camera/lens metadata and expose full text only through `title`.
- `apps/web/src/components/photo-viewer.tsx:803` and `:810` use the same pattern in the desktop metadata panel.
- `apps/web/src/components/upload-dropzone.tsx:535` truncates filenames with `title`.
- `apps/web/src/components/image-manager.tsx:498` truncates filenames with `title`.

Why this is a problem:

Native `title` is not reliably available on touch devices, is inconsistent for keyboard users, and is not a strong accessibility mechanism. Technical photo metadata and filenames often need exact inspection.

Concrete failure scenario:

A mobile viewer sees a truncated lens name or an admin sees a truncated filename and cannot reveal the full value without switching devices or inspecting the DOM.

Suggested fix:

Use accessible disclosure patterns: wrap long values, provide a copy button, or use a keyboard/touch accessible tooltip/popover with `aria-describedby`. For admin file names, consider a details drawer or expandable cell.

### DES-C17-07 - Upload progress is visually rich but not fully announced

Severity: Low-Medium
Confidence: Medium
Status: Confirmed by source

Evidence:

- `apps/web/src/components/upload-dropzone.tsx:469` through `:483` renders visual upload count and a progressbar.
- `apps/web/src/components/upload-dropzone.tsx:485` announces only the current filename in an `aria-live="polite"` element.
- The visual progressbar has `aria-valuenow`, but it is not guaranteed to be announced if focus is elsewhere.

Why this is a problem:

Screen-reader users need the same progress model sighted users get: current file, count, total, and percent. Announcing only the filename does not communicate whether the upload is advancing or stalled.

Concrete failure scenario:

An admin uploads 100 photos. The visible UI shows `10 / 100` and percent progress, but a screen-reader user only hears changing filenames and cannot easily know total completion state.

Suggested fix:

Add a dedicated localized `role="status" aria-live="polite" aria-atomic="true"` message such as `Uploading 10 of 100, 42 percent, current file DSC_1234.jpg`. Keep the progressbar for visual and programmatic value semantics.

### DES-C17-08 - Home page information architecture still lets tags dominate before photos

Severity: Medium
Confidence: Medium-High
Status: Confirmed by source; full browser validation blocked by DB

Evidence:

- `apps/web/src/components/home-client.tsx:287` renders gallery heading and tag filtering before the photo grid.
- `apps/web/src/components/home-client.tsx:298` renders `TagFilter` before the first photo result.
- `apps/web/src/components/tag-filter.tsx:62` through `:122` renders every visible tag as a wrapping button list.
- `apps/web/src/components/tag-filter.tsx:47` memoizes all available tags for display; there is no source-level cap, collapse, or progressive disclosure in the filter itself.

Why this is a problem:

GalleryKit is documented as a finished-photo publishing experience. If many tags exist, visitors can encounter a dense control wall before the first photograph, weakening the primary photo-first experience and increasing first-screen interaction cost.

Concrete failure scenario:

A gallery with dozens of tags opens on mobile. The first screen is mostly filters, so a viewer must scroll before seeing the first image and may interpret the page as a database interface rather than a gallery.

Suggested fix:

Show a compact default tag set, collapse the rest behind a disclosure, or move full tag browsing into a dedicated filter sheet. Keep the first row of photos visible on common mobile and desktop viewports.

## Likely Issues

### DES-C17-09 - Token management uses one pending state for independent operations

Severity: Low-Medium
Confidence: Medium
Status: Likely issue from source; authenticated browser validation blocked

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:28` creates a single `useTransition()` pending state.
- `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:40` through `:42` use one focus-restore target for retry, create, and revoke flows.
- `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:56` handles list refresh.
- `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:70` handles token creation.
- `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:106` handles revoke.
- `apps/web/src/app/[locale]/admin/(protected)/users/tokens-client.tsx:187`, `:242`, and `:303` disable unrelated controls through the same `isPending`.

Why this is a problem:

Independent admin tasks share loading and focus behavior, so one slow operation can disable unrelated controls or restore focus to the wrong button.

Concrete failure scenario:

An admin triggers a token list retry and then tries to create or revoke another token. The shared pending state disables controls beyond the active operation, making the workflow feel frozen.

Suggested fix:

Split state into `isLoadingList`, `isCreating`, and per-token `isRevoking`. Scope disabled states, status copy, and focus restoration to the operation that actually started.

### DES-C17-10 - Mobile admin navigation is a wrapped link cloud

Severity: Medium
Confidence: Medium
Status: Likely issue from source; authenticated browser validation blocked

Evidence:

- `apps/web/src/components/admin-header.tsx:13` through `:24` uses a wrapping header layout.
- `apps/web/src/components/admin-nav.tsx:15` through `:25` defines 10 admin destinations.
- `apps/web/src/components/admin-nav.tsx:28` renders the navigation as `flex flex-wrap gap-2`.

Why this is a problem:

Ten wrapped text links create a noisy mobile admin header and a long tab sequence before content. This weakens information architecture for frequent admin tasks.

Concrete failure scenario:

On a phone-width viewport, an admin must tab or scroll through multiple rows of navigation links before reaching the page controls, and the current section is harder to parse than in a drawer, tabs, or grouped menu.

Suggested fix:

Use a responsive admin navigation pattern below `md`: a disclosure menu, drawer, segmented section switcher, or grouped sidebar. Preserve `aria-current="page"` and keep the active destination visible.

### DES-C17-11 - Zoomed mobile pan may conflict with ancestor swipe navigation

Severity: Medium
Confidence: Low-Medium
Status: Risk requiring manual touch validation

Evidence:

- `apps/web/src/components/photo-viewer.tsx:697` mounts `PhotoNavigation` unless the lightbox or bottom sheet is open; zoom state is not part of the disabled condition.
- `apps/web/src/components/photo-navigation.tsx:134` through `:146` registers native touch listeners on the media container.
- `apps/web/src/components/photo-navigation.tsx:204` through `:221` navigates after horizontal swipe thresholds.
- `apps/web/src/components/image-zoom.tsx:230` through `:307` handles pinch and drag gestures and calls propagation-prevention methods on synthetic touch events.

Why this is a problem:

If ancestor native listeners still observe zoom-pan gestures, a user trying to inspect a zoomed image could accidentally navigate to another photo. The source suggests competing gesture systems, but this needs device/browser validation because event ordering matters.

Concrete failure scenario:

A mobile user zooms in and drags horizontally to inspect an image edge. The ancestor swipe handler interprets the gesture as previous/next navigation.

Suggested fix:

When zoom scale is above 1, disable photo swipe navigation or have `ImageZoom` report active zoom/gesture state to `PhotoNavigation`. Add mobile Playwright or manual device coverage for zoom-pan versus gallery-swipe behavior.

## Fixed Or Not Re-filed From Prior Reviews

- Timeline/year duplicate accessible names appear fixed. `apps/web/src/components/timeline-client.tsx:229` and `apps/web/src/components/year-client.tsx:192` include the photo id in the accessible title.
- Timeline/year archive links now use `prefetch={false}` at `apps/web/src/components/timeline-client.tsx:250` and `apps/web/src/components/year-client.tsx:210`.
- Search tag-result labeling appears improved. `apps/web/src/lib/search.ts` now carries `tag_names`, and `apps/web/src/components/search.tsx` uses richer result labels.
- `TagInput` has active descendant wiring in `apps/web/src/components/tag-input.tsx:174` and option ids at `:240`.
- Admin login skip-target and control sizing were verified in the browser.
- Token Unicode truncation from an older review appears fixed with character `maxLength={256}` in token inputs.
- Token load failure no longer appears to silently empty the page; source now carries explicit load error state and retry UI.

## Manual Validation Risks And Runtime Gaps

- DB-backed public content, authenticated admin pages, real photo grids, maps, and media-heavy routes could not be fully exercised in the local browser because MySQL refused connections at `127.0.0.1:3306` and no admin session credentials were available.
- Real Core Web Vitals were not measured. Perceived-performance review is therefore source-based: icon redirect failures, archive prefetch behavior, error shell behavior, and UI layout risks. LCP/CLS/INP should still be measured against a seeded local DB or production-like staging copy.
- Dark/light mode was source and token-test reviewed; full visual regression across every route was blocked by the DB issue.
- Mobile touch gesture interaction for zoom-pan versus photo-swipe needs real browser/device validation.

## Final Missed-Issues Sweep

I rechecked prior-cycle findings against current source before writing this report, then swept for route metadata, skip links, ARIA/focus patterns, touch targets, Korean/i18n parity, reduced motion, dark/light token coverage, truncation, toast-only errors, overflow containers, and pending/loading state. The icon-routing issue is newly confirmed by browser evidence in this cycle. The remaining filed items are current in source or marked as manual-validation risks where runtime access was blocked.

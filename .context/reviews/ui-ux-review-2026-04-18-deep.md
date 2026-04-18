# UI/UX Review — 2026-04-18 (deep Playwright pass)

**Verdict:** REQUEST CHANGES

## Method

I reviewed the UI in two layers:

1. **Runtime verification with Playwright**
   - Started a temporary MySQL container, initialized the schema, seeded admin + E2E content, and ran the app locally on `http://localhost:3100`.
   - Verified screens in desktop and mobile Chrome (iPhone 13 emulation).
   - Captured screenshots in `./.context/reviews/ui-ux-artifacts-2026-04-18/`.
2. **Code review of the UI layer**
   - Reviewed the locale layout, proxy/middleware, navigation, search, gallery cards, photo viewer, shared pages, admin screens, error surfaces, and supporting config.

### Important runtime note
The first Playwright pass found that the app’s current CSP blocks client scripts in `next dev`, so interactive verification required **Playwright `bypassCSP: true`** after first confirming the CSP defect. That defect itself is called out below as a review finding.

## Screens verified

- Public gallery home — desktop and mobile
- Search overlay — desktop and mobile
- Topic page — desktop
- Photo viewer — desktop and mobile
- Shared photo page — desktop
- Shared group page — desktop
- Admin login
- Admin dashboard
- Admin categories / tags / users / password / DB pages

Artifacts referenced below live in:

- `./.context/reviews/ui-ux-artifacts-2026-04-18/desktop-home-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/desktop-search-overlay-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/desktop-photo-1-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/desktop-photo-1-info-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/desktop-shared-photo-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/desktop-shared-group-ko-hydrated-v2.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/mobile-nav-expanded-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/mobile-search-overlay-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/mobile-photo-2-info-ko-hydrated.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-login-ko.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-dashboard-ko-hydrated-v2.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-categories-ko-hydrated-v2.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-tags-ko-hydrated-v2.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-users-ko-hydrated-v2.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-password-ko-hydrated-v2.png`
- `./.context/reviews/ui-ux-artifacts-2026-04-18/admin-db-ko-hydrated-v2.png`

---

## Confirmed issues

### 1. Default-locale navigation is broken: `/` loops and the visible `EN` switch is effectively dead
- **Severity:** HIGH
- **Confidence:** High
- **Files:** `apps/web/src/proxy.ts:5-9`, `apps/web/src/components/nav-client.tsx:40-56`
- **Evidence:**
  - Playwright on `http://localhost:3100/` returned `net::ERR_TOO_MANY_REDIRECTS`.
  - The public nav renders an `EN` link whose `href` is `/en`, but the default-locale route currently self-redirects instead of resolving.
- **Why this is a UX problem:** English is the default locale, but first-time/default-locale navigation is not usable. The language switch advertises a path users cannot successfully land on.
- **Concrete failure scenario:** A Korean user browsing `/ko` taps `EN` and appears stuck; a first-time visitor opening `/` gets a redirect loop instead of a homepage.
- **Suggested fix:** Reconcile the `next-intl` `localePrefix: 'as-needed'` setup with the custom middleware and locale-switch URL generation. Default-locale links should resolve to `/`, not a looping `/en` path.

### 2. The current CSP breaks client-side interactivity in development, so the UI ships as effectively unhydrated under `next dev`
- **Severity:** HIGH
- **Confidence:** High
- **Files:** `apps/web/next.config.ts:56-81`
- **Evidence:**
  - A non-bypassed Playwright pass logged **41 CSP console errors** on `/ko`.
  - Search, theme toggle, and other client interactions did not function until I reran the audit with `bypassCSP: true`.
- **Why this is a UX problem:** Local/dev QA is part of the product development loop. Right now the interface is visually present but functionally inert in the standard developer run mode.
- **Concrete failure scenario:** A maintainer runs `npm run dev`, opens the app, clicks search/theme/other controls, and concludes the UI is broken or flaky because the client bundle never hydrates.
- **Suggested fix:** Use a dev-specific CSP or switch to a nonce/hash-based production-safe strategy that does not block Next/Turbopack client scripts. `strict-dynamic` plus the current host-based allowlisting is the wrong combination here.

### 3. Admin screens inherit the public shell and then add a second admin shell, creating double navigation and diluted task focus
- **Severity:** HIGH
- **Confidence:** High
- **Files:** `apps/web/src/app/[locale]/layout.tsx:84-97`, `apps/web/src/app/[locale]/admin/page.tsx:7-14`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:20-29`
- **Evidence:**
  - `layout.tsx` always renders `<Nav />` and `<Footer />`.
  - Protected admin routes also render `<AdminHeader />` inside their own layout.
  - Screenshots show public gallery navigation + admin navigation stacked together.
- **Why this is a UX problem:** Admin task flows should reduce noise. The current hierarchy makes admins parse two nav systems, plus public search/theme/locale controls, before doing any work.
- **Concrete failure scenario:** On the dashboard, the top bar shows gallery topics/search/theme/language, then a second bar shows admin sections. This costs vertical space and increases cognitive load on every admin action.
- **Suggested fix:** Give admin routes their own shell that excludes the public nav/footer entirely, including the login page.

### 4. The primary gallery cards hide their information until hover; on touch devices they are effectively anonymous blocks
- **Severity:** HIGH
- **Confidence:** High
- **Files:** `apps/web/src/components/home-client.tsx:224-289`, `apps/web/src/app/[locale]/g/[key]/page.tsx:113-132`
- **Evidence:**
  - The home gallery overlays title/topic with `opacity-0` until `group-hover` / `group-focus-within`.
  - The shared-group grid renders image tiles with **no visible caption at all**.
  - Verified screenshots show large colored blocks with no persistent human-readable metadata.
- **Why this is a UX problem:** Browsing/scanning is the core experience of a gallery. Users should not need to open each tile to learn what it is.
- **Concrete failure scenario:** On mobile, a user sees only image blocks, no title, no topic label, no description hint, and no share-context explanation. This is especially bad for sparse galleries and shared albums.
- **Suggested fix:** Show at least a persistent minimal caption on mobile and shared grids — for example title/tag/topic chips below each card or a permanent low-contrast bottom label.

### 5. Shared viewers open in a context-poor state and duplicate back-navigation affordances
- **Severity:** HIGH
- **Confidence:** High
- **Files:** `apps/web/src/app/[locale]/s/[key]/page.tsx:65-78`, `apps/web/src/app/[locale]/g/[key]/page.tsx:87-100`, `apps/web/src/components/photo-viewer.tsx:41-60`, `apps/web/src/components/photo-viewer.tsx:178-185`
- **Evidence:**
  - Shared routes add a top-level “back to gallery” link.
  - `PhotoViewer` always adds its own “back to topic” link.
  - `showInfo` depends on `isPinned || timerShowInfo`, but `timerShowInfo` is never set to `true`, so desktop viewers open as image-only canvases unless the user manually reveals metadata.
  - Verified screenshot of the shared photo page shows two stacked back links and no visible title/description by default.
- **Why this is a UX problem:** Shared routes are for recipients who have the least context. They currently get the least context in the UI.
- **Concrete failure scenario:** A shared-link recipient lands on a full-screen image with two different back targets and no obvious title, caption, or metadata unless they discover the info control.
- **Suggested fix:** Add a dedicated shared-viewer mode: one clear back action, a small visible title/context header by default, and no topic-back button when the user is on a share route.

### 6. Multiple admin icon buttons have no accessible name
- **Severity:** HIGH
- **Confidence:** High
- **Files:**
  - `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:157-163`
  - `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:87-93`
  - `apps/web/src/components/admin-user-manager.tsx:113-120`
  - `apps/web/src/components/image-manager.tsx:353-361`
- **Evidence:**
  - Playwright button enumeration on categories/tags/users found several buttons with empty text and no `aria-label`.
  - The code confirms icon-only `<Button size="icon">` controls without an accessible label.
- **Why this is a UX problem:** Screen-reader and switch users cannot distinguish edit/delete/destructive controls when the button has no accessible name.
- **Concrete failure scenario:** On the categories or tags screen, a screen-reader user tabs to an unnamed button and has no way to know whether it edits or deletes the row.
- **Suggested fix:** Add explicit `aria-label`s (for example “Edit category”, “Delete tag”, “Delete user”, “Edit image metadata”).

### 7. The mobile search overlay still behaves like a desktop power-user panel
- **Severity:** MEDIUM
- **Confidence:** High
- **Files:** `apps/web/src/components/search.tsx:114-200`
- **Evidence:**
  - The mobile overlay shows a keyboard shortcut footer (`⌘/Ctrl+K`) that is irrelevant on touch devices.
  - Result subtitles render raw topic slugs (`image.topic`) instead of human labels.
  - Verified mobile screenshot shows a cramped result sheet with the keyboard shortcut footer consuming precious vertical space.
- **Why this is a UX problem:** Mobile search should be optimized for direct touch scanning, not desktop keyboard pedagogy.
- **Concrete failure scenario:** A phone user opens search and immediately loses vertical space to a desktop shortcut hint while seeing internal taxonomy (`e2e-smoke`) rather than a readable label.
- **Suggested fix:** Hide the shortcut footer on coarse-pointer/mobile contexts, use human-readable topic labels, and simplify the mobile sheet layout.

### 8. Admin secondary screens are visually sparse and feel unfinished compared with the dashboard
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Files:**
  - `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx:9-13`
  - `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:29-82`
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:100-190`
  - `apps/web/src/components/admin-user-manager.tsx:54-137`
  - `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx:7-13`
  - `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx:4-10`
- **Evidence:**
  - Screenshots show password/users/categories/tags/DB pages with large unused areas, weak section hierarchy, and uneven spacing compared with the dashboard.
- **Why this is a UX problem:** Once inside admin, every secondary page should feel like part of the same tool. Right now the dashboard looks like a product, while several secondary pages look like raw scaffolding.
- **Concrete failure scenario:** The password page presents a small left-aligned form floating in a mostly empty canvas; the categories/tags pages show a thin table and almost nothing else, so the admin area feels inconsistent and under-designed.
- **Suggested fix:** Standardize admin page templates: width constraints, helper text, denser section grouping, and consistent spacing patterns.

### 9. The global fatal-error screen is English-only and visually disconnected from the rest of the product
- **Severity:** MEDIUM
- **Confidence:** High
- **Files:** `apps/web/src/app/global-error.tsx:9-20`
- **Evidence:** The page hardcodes `Error`, `Something went wrong.`, and `Try again` in inline-styled markup instead of using the app’s i18n and component system.
- **Why this is a UX problem:** When the app fails hardest, it drops users into the least polished and least localized interface.
- **Concrete failure scenario:** A Korean user hits a fatal route-level crash and gets a plain English fallback page with no brand continuity and no localized recovery path.
- **Suggested fix:** Localize the copy and reuse the app’s normal design tokens/components for the fatal error shell.

### 10. The checked-in runtime site config still contains placeholder content, so the out-of-the-box UI ships placeholder copy
- **Severity:** MEDIUM
- **Confidence:** High
- **Files:** `apps/web/src/site-config.json:1-11`
- **Evidence:** The repo’s active runtime config contains `"Your Title"`, `"Your Description"`, `"Your Name"`, and `"Footer text here"`. Those placeholders are visible in the verified screenshots.
- **Why this is a UX problem:** A first run of the repo does not feel like a coherent product; it feels like an unfinished template.
- **Concrete failure scenario:** The footer literally renders `Footer text here`, and metadata/brand copy stay generic unless the operator manually patches a tracked runtime file.
- **Suggested fix:** Stop committing placeholder runtime config, or ship a polished demo/default config and keep placeholder values only in the example file.

### 11. The histogram widget is too small and too jargon-heavy to earn its space in the info panel
- **Severity:** LOW
- **Confidence:** Medium
- **Files:** `apps/web/src/components/histogram.tsx:22-30`, `apps/web/src/components/histogram.tsx:235-259`, `apps/web/src/components/photo-viewer.tsx:452-457`
- **Evidence:** The widget is fixed at `200x100`, uses tiny labels, and cycles through hardcoded short English labels (`Lum`, `RGB`, `R`, `G`, `B`). In the desktop info panel screenshot it reads as a tiny technical gadget rather than a useful user-facing visualization.
- **Why this is a UX problem:** It adds complexity without delivering enough readable value for most users.
- **Concrete failure scenario:** A non-expert user opens the info panel and sees a tiny unlabeled chart with cryptic mode codes, but no guidance on why it matters.
- **Suggested fix:** Either move it behind an explicit “advanced info” disclosure or redesign it with more space, clearer labels, and localized text.

---

## Additional runtime/accessibility evidence

### Playwright evidence: unnamed icon buttons
I queried admin pages after hydration and found multiple buttons whose visible text and `aria-label` were both empty:

- categories page: edit + delete row actions
- tags page: edit + delete row actions
- users page: delete row action relies on `title`, not an accessible name

This was observed directly via Playwright DOM inspection, not just inferred from source.

### Playwright evidence: CSP errors in standard dev mode
A no-bypass Playwright pass on `/ko` produced **41 console errors**, all CSP-related, including blocked Next/Turbopack scripts. That means this is not a theoretical CSP complaint — it materially prevents interaction during normal local verification.

---

## Final sweep / commonly missed areas checked

I specifically re-checked the following so this wasn’t just a screenshot pass:

- **Locale routing and language switching** — default locale root, `/ko`, and the `EN` switch
- **Hydration-dependent controls** — search, theme, admin login/dashboard
- **Shared-route UX** — shared photo and shared album pages, not just internal photo pages
- **Admin interaction affordances** — edit/delete icon buttons, destructive flows, page consistency
- **Error/fallback surfaces** — `global-error.tsx`
- **Runtime copy/config** — `site-config.json` placeholder values that visibly leak into the UI

## Bottom line

The repository already has some solid foundations — dark theme, clean primitives, workable photo pages, and a reasonable admin information architecture — but the current UX is held back by a few major issues:

1. broken default-locale routing,
2. CSP that kills interactivity in normal dev mode,
3. double-shell admin chrome,
4. hover-only/hidden gallery metadata,
5. context-poor shared viewing,
6. missing accessible names on admin icon buttons.

Fix those first. They will improve both the real end-user experience and the team’s ability to verify the UI reliably.

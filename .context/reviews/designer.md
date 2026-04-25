# UI/UX Code Review — Cycle 8 Prompt 1

Scope reviewed: Next.js app routes, shared UI components, CSS/Tailwind, messages, public assets, and e2e coverage. I also ran a production build and browser checks against a locally seeded server to confirm the highest-risk UX paths.

## Inventory

### App routes / layouts / state surfaces
- Root locale shell: `apps/web/src/app/[locale]/layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`
- Public gallery: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`
- Admin shell: `apps/web/src/app/[locale]/admin/layout.tsx`, `admin/page.tsx`, `admin/(protected)/*`
- API/UI-adjacent routes: `api/health`, `api/live`, `api/og`, `uploads/[...path]`, `robots.ts`, `sitemap.ts`, `manifest.ts`, icons

### Shared UI components inspected
`nav`, `nav-client`, `footer`, `home-client`, `tag-filter`, `search`, `load-more`, `photo-viewer`, `photo-navigation`, `lightbox`, `info-bottom-sheet`, `image-zoom`, `histogram`, `upload-dropzone`, `topic-empty-state`, `admin-header`, `admin-nav`, `image-manager`, `tag-input`, `theme-provider`, `i18n-provider`, and the `components/ui/*` primitives.

### Styling / design tokens
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/tailwind.config.ts`
- self-hosted font asset: `apps/web/public/fonts/PretendardVariable.woff2`
- worker asset: `apps/web/public/histogram-worker.js`

### Messages / localization
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

### Public assets / fixtures / e2e
- `apps/web/public/*`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/helpers.ts`

## Verification performed
- `npm run build --workspace=apps/web` ✅
- Browser checks on local seeded server (`http://127.0.0.1:3100`) ✅
  - homepage roles / focus / search dialog
  - mobile photo info sheet focus behavior
  - shared album photo detail heading structure
  - admin login/password heading presence
  - admin dashboard responsive width on a 375px viewport

## Findings

### UX8-01 — Admin auth screens have no semantic page heading
- **Location:** `apps/web/src/app/[locale]/admin/login-form.tsx:29-54`; `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx:10-20`; root cause in `apps/web/src/components/ui/card.tsx:31-39`
- **Severity / confidence:** Medium / High
- **Status:** Confirmed in browser (`/en/admin` and `/en/admin/password` both expose 0 headings)
- **Failure scenario:** Screen-reader users land on login or password-change pages with only a visual card title; heading navigation has no primary page heading to announce or jump to.
- **Concrete fix:** Render a real `h1` for these standalone auth pages, or make the card title render as a heading on those screens only.

### UX8-02 — The mobile photo info sheet opens without moving focus into the dialog
- **Location:** trigger in `apps/web/src/components/photo-viewer.tsx:259-267`; sheet focus logic in `apps/web/src/components/info-bottom-sheet.tsx:121-155, 174-206`
- **Severity / confidence:** Medium / High
- **Status:** Confirmed in browser on a 375px viewport (`/en/p/45`)
- **Failure scenario:** After tapping Info, focus stays on the launcher button behind the modal instead of landing inside the sheet; keyboard users can discover the dialog only after one extra Tab, and the modal context is not announced immediately.
- **Concrete fix:** Autofocus the drag handle or close button when the sheet opens, or switch to a dialog pattern with open/autofocus hooks so focus is moved in immediately.

### UX8-03 — Shared album photo detail view exposes duplicate level-1 headings
- **Location:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:133-154`; `apps/web/src/components/photo-viewer.tsx:237-243`
- **Severity / confidence:** Medium / High
- **Status:** Confirmed in browser (`/en/g/Abc234Def5?photoId=45` had 2 accessible H1s with the same title)
- **Failure scenario:** Heading navigation on the shared-photo detail route announces two primary headings for the same page, which is noisy and weakens the document outline.
- **Concrete fix:** Add a prop so `PhotoViewer` can suppress its hidden H1 when the parent page already provides the page heading, or move the visible page heading to a non-heading element and let `PhotoViewer` own the H1.

### UX8-04 — The admin dashboard recent-uploads table is still a desktop grid at mobile sizes
- **Location:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:36-40`; `apps/web/src/components/image-manager.tsx:335-418`
- **Severity / confidence:** Medium / High
- **Status:** Confirmed in browser on a 375px viewport (`#admin-content` scrollWidth ≈ 997px)
- **Failure scenario:** On phones, admins must pan horizontally inside the dashboard content area to inspect the table and action column; the UI does not reflow into a mobile-friendly layout.
- **Concrete fix:** Replace the table with stacked cards on small screens, or wrap it in a dedicated horizontal scroller and hide low-value columns at narrow breakpoints.

### UX8-05 — The theme bootstrap script is missing a CSP nonce
- **Location:** `apps/web/src/app/[locale]/layout.tsx:97-108` (ThemeProvider usage); pass-through in `apps/web/src/components/theme-provider.tsx:6-10`
- **Severity / confidence:** Medium / High
- **Status:** Confirmed by browser console CSP violation on first load
- **Failure scenario:** The injected next-themes inline script is not allow-listed by the page CSP, which produces console noise and can defer theme initialization to hydration instead of the pre-paint phase.
- **Concrete fix:** Pass `nonce={nonce}` into `ThemeProvider` so next-themes can nonce its injected script and satisfy the existing CSP.

### UX8-06 — RTL support is still only future-safe in comments; the document direction is hard-coded LTR
- **Location:** `apps/web/src/app/[locale]/layout.tsx:83-88` (plus other physical left/right spacing classes throughout nav/photo/admin UI)
- **Severity / confidence:** Low / Medium
- **Status:** Likely/manual future-risk
- **Failure scenario:** If an RTL locale is added later, the root document direction and many physical spacing/alignment utilities will still assume LTR, so the UI will render backwards in obvious places.
- **Concrete fix:** Drive `dir` from locale metadata and audit repeated physical `left/right/mr/ml/pr/pl` utility usage for logical equivalents where practical.

## Missed-issues sweep

I re-checked the obvious follow-up areas after the first pass: public gallery routes, shared photo routes, mobile nav, search dialog, lightbox, info sheet, admin auth, and admin tables. No additional high-confidence UX regressions stood out beyond the items above.

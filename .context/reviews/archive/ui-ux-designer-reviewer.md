# UI/UX Review — ui-ux-designer-reviewer

Date: 2026-04-29 (Asia/Seoul)
Repo: `/Users/hletrd/flash-shared/gallery`
Scope: independent UI/UX review of navigation, keyboard/focus behavior, WCAG 2.2, responsive breakpoints, form UX, loading/empty/error states, i18n, dark/light support, and perceived performance.

Runtime note: I attempted to use browser/runtime evidence, but there was no active local app on `127.0.0.1:3000`/`3100`, and required runtime env such as `DB_*`, `SESSION_SECRET`, and admin credentials was unset in the shell. I therefore used source inspection plus targeted test/static evidence. I did not implement fixes.

## Inventory reviewed first

Excluded: `node_modules`, `.git`, `.next`, `test-results`, generated/build artifacts.

### Route/layout/error/loading surfaces
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/icon.tsx`, `apps/web/src/app/apple-icon.tsx`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- UI-adjacent admin DB/action files were skimmed for user-facing result states: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions*.ts`, `apps/web/src/app/actions/*.ts`.

### Components and primitives
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/aspect-ratio.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/scroll-area.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`

### i18n and UI tests
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- E2E: `apps/web/e2e/admin.spec.ts`, `apps/web/e2e/helpers.ts`, `apps/web/e2e/nav-visual-check.spec.ts`, `apps/web/e2e/origin-guard.spec.ts`, `apps/web/e2e/public.spec.ts`, `apps/web/e2e/test-fixes.spec.ts`
- Targeted UI/unit tests reviewed and run where useful: `src/__tests__/touch-target-audit.test.ts`, `error-shell.test.ts`, `tag-input.test.ts`, `upload-dropzone.test.ts`, `lightbox.test.ts`, plus related UI coverage (`histogram`, `photo-title`, `shared-page-title`, `clipboard`, etc.).

## Findings

### F1 — Dialog close buttons are effectively 16×16 targets across admin modals

- **Category:** confirmed
- **Severity:** High
- **Confidence:** High
- **File/region:** `apps/web/src/components/ui/dialog.tsx:71-78`; consumers include `apps/web/src/components/admin-user-manager.tsx:92`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:168` and `:253`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:148`, `apps/web/src/components/image-manager.tsx:273` and `:482`.
- **Evidence:** The shared `DialogContent` always renders `DialogPrimitive.Close` when `showCloseButton` is true, but its class only positions it and sizes the SVG to `size-4`; it does not add `h-*`, `w-*`, `p-*`, or `min-*`. That leaves the clickable close affordance at roughly the 16px icon size. The audit explicitly exempts `components/ui/dialog.tsx` as a primitive (`touch-target-audit.test.ts`), so this is not protected at the primitive layer.
- **Failure scenario:** On touch or low-precision pointer devices, closing create/edit dialogs for users, tags, categories, batch tags, and image metadata requires tapping a tiny top-right icon. This conflicts with WCAG 2.2 target-size intent, and likely fails 2.5.8 (24×24 minimum) for a non-inline control; it is also below the repo’s own 44px touch-target design floor used elsewhere.
- **Suggested fix:** Size the primitive close button directly, for example `h-11 w-11 inline-flex items-center justify-center rounded-md`, preserving the visible icon at `size-4`. Add this primitive to the touch-target audit rather than exempting it wholesale, or add a regression case that renders a dialog and measures the close target.

### F2 — Admin skip link scrolls to `#admin-content` but the target is not focusable

- **Category:** confirmed
- **Severity:** Medium
- **Confidence:** High
- **File/region:** `apps/web/src/app/[locale]/admin/layout.tsx:19-25`; contrast with the fixed public pattern in `apps/web/src/app/[locale]/(public)/layout.tsx:14-18`.
- **Evidence:** The admin layout renders a skip link to `#admin-content` and a `<main id="admin-content">`, but the main element lacks `tabIndex={-1}`. The public layout carries a comment documenting the exact browser behavior: without `tabIndex={-1}`, browsers scroll but do not move focus.
- **Failure scenario:** A keyboard user activates “Skip to content” on authenticated admin pages. Visual scroll may move, but focus remains on the skip link/header area, so the next Tab can still traverse admin nav/logout instead of landing inside the admin main region.
- **Suggested fix:** Mirror the public layout: add `tabIndex={-1}` and `focus:outline-none` to the admin main target. Add a Playwright assertion equivalent to the public skip-link behavior once admin runtime credentials are available.

### F3 — Several chip/destructive controls are below WCAG 2.2 target-size guidance

- **Category:** confirmed
- **Severity:** Medium
- **Confidence:** High
- **File/region:** `apps/web/src/components/tag-input.tsx:171-180`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:286-295`, `apps/web/src/components/upload-dropzone.tsx:384-386`; audit documentation at `apps/web/src/__tests__/touch-target-audit.test.ts:149-152`.
- **Evidence:** `TagInput` selected-tag remove buttons are `p-0.5` around a `h-3 w-3` icon; topic alias deletion uses a naked text button with a `h-3 w-3` icon; upload “Clear all” deliberately overrides the small button to `h-auto p-0`, and the touch-target audit lists it as a known violation.
- **Failure scenario:** Users managing tags, aliases, or pending upload batches can accidentally miss or hit adjacent controls, especially on mobile/tablet or with motor impairment. These controls are destructive/remove actions, so mis-taps have higher UX cost than passive links.
- **Suggested fix:** Give chip remove buttons and alias delete buttons an explicit `min-h-6 min-w-6` at minimum for WCAG 2.5.8, preferably `h-11 w-11` or an expanded invisible hit area to match the repo’s 44px target convention. For “Clear all,” use a normal-height button (`h-11 px-3`) or move it into a full-width secondary/destructive action row on narrow screens.

### F4 — Add-admin password mismatch is toast-only and not associated with the confirm field

- **Category:** confirmed
- **Severity:** Medium
- **Confidence:** High
- **File/region:** `apps/web/src/components/admin-user-manager.tsx:35-42` and `:99-113`.
- **Evidence:** `handleCreate` checks `password !== confirmPassword`, calls `toast.error(t('password.mismatch'))`, and returns. The form fields have no mismatch state, no inline error element, no `aria-invalid`, no `aria-describedby`, and no focus transfer to the offending confirmation field.
- **Failure scenario:** A screen-reader or keyboard user submits mismatched passwords in the Add Admin dialog. The only feedback is a transient toast, while focus remains wherever the submit occurred and the confirm field is not marked invalid. If the toast is missed, the form appears to do nothing.
- **Suggested fix:** Store a local `confirmError` like `PasswordForm` does, render an inline error under `create-confirm-password`, set `aria-invalid="true"` and `aria-describedby`, and move focus to the confirm field or error summary on mismatch. Keep the toast as supplemental feedback only.

### F5 — Masonry adds a 5-column 2xl breakpoint but image `sizes` still caps at `25vw`

- **Category:** likely
- **Severity:** Low
- **Confidence:** High
- **File/region:** `apps/web/src/components/home-client.tsx:162-166`, `:202-211`, `:227-234`.
- **Evidence:** The gallery grid uses `2xl:columns-5` at `1536px+`, but AVIF/WebP sources and `OptimisticImage` still declare final `sizes` as `25vw` after `1280px`. In a five-column layout the ideal slot is closer to `20vw` before container/gap adjustments.
- **Failure scenario:** On wide displays, the browser may select larger thumbnail variants than needed for each card, increasing bytes and decode work. This hurts perceived performance on the gallery’s primary browsing surface, especially when many images are above or near the fold.
- **Suggested fix:** Update `sizes` to reflect the 2xl breakpoint, for example `(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, (max-width: 1280px) 33vw, (max-width: 768px) 50vw, 100vw`, adjusted for the container’s actual max width/gaps. Keep `useColumnCount()` and `sizes` in one shared helper so future breakpoint changes stay synchronized.

### F6 — Admin error boundary nests a second `<main>` inside the admin layout `<main>`

- **Category:** likely
- **Severity:** Low
- **Confidence:** Medium-high
- **File/region:** parent layout `apps/web/src/app/[locale]/admin/layout.tsx:19-25`; protected error boundary `apps/web/src/app/[locale]/admin/(protected)/error.tsx:15-25`.
- **Evidence:** The admin layout wraps children in `<main id="admin-content">`. The protected route error component also returns `<main role="main">`. Next.js error boundaries render inside parent layouts, so this produces nested main landmarks for protected admin error states.
- **Failure scenario:** Screen-reader landmark navigation on admin error pages can announce duplicate/nested main regions, making the page structure harder to understand during an already stressful error recovery path.
- **Suggested fix:** Change the protected admin error component’s outer `<main>` to a `<section>` or `<div role="alert">`/`<section aria-labelledby=...>` because the parent layout already provides the main landmark. Keep the public `[locale]/error.tsx` separate if it is not inside another main.

## Positive observations / covered areas with no blocking finding

- Public skip link, not-found shell, loading status, and photo page heading hierarchy have explicit fixes/tests.
- Search dialog has autofocus, Escape close, focus restore, body scroll lock, and live status text; public E2E covers focus trap/restore.
- Locale message keys are synchronized: `en=508`, `ko=508`, no missing keys either direction.
- Dark/light theme tokens and reduced-motion media handling are present in `globals.css`; theme toggle has an accessible label.
- Photo viewer/lightbox have keyboard shortcuts, focus trap, Escape handling, reduced-motion handling, and 44px primary controls in most visible viewer locations.
- Empty/loading/error states exist for home/gallery empty results, upload no-topic state, route loading spinners, image loading/unavailable, and admin/public route errors.

## Verification evidence

- Ran targeted UI/a11y tests:
  - `npm run test -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/error-shell.test.ts src/__tests__/tag-input.test.ts src/__tests__/upload-dropzone.test.ts src/__tests__/lightbox.test.ts`
  - Result: `Test Files 5 passed (5)`, `Tests 17 passed (17)`.
- Ran i18n key parity check:
  - Result: `en=508 ko=508 missing_in_ko=[] missing_in_en=[]`.
- Static inventory sweep found 108 UI/UI-adjacent app/component/message/e2e files under the reviewed roots after exclusions.

## Final sweep confirmation

I reviewed every file in the inventory above and swept each requested area: navigation, keyboard/focus, WCAG 2.2 target/focus semantics, responsive breakpoints, form UX, loading/empty/error states, i18n, dark/light behavior, and perceived performance. Browser runtime validation was not feasible in this shell due to no running app and missing DB/session/admin env, so findings are backed by exact source regions and targeted tests/static checks.

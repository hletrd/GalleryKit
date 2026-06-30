# UI/UX Designer Reviewer - Cycle 27

Date: 2026-06-30
Repo: GalleryKit (`/Users/hletrd/flash-shared/gallery`)
HEAD reviewed: `1e8bba0298ea`
Scope note: applied the local `ui-ux-designer-reviewer` lens to GalleryKit, a Next.js web photo gallery. BurstPick/Swift-specific file requirements were intentionally ignored per task instruction.

## Inventory

Review-relevant project guidance read:

- `AGENTS.md` project instructions from the prompt, including the Gallery workspace rules.
- `CLAUDE.md` architecture/security/UX guidance, including GalleryKit product constraints, public/admin route model, i18n, color/HDR policy, touch-target policy, and permanently deferred items.
- Prior context in `.context/reviews/photographer-r27/ui-ux.md` and `.context/reviews/photographer-r28/ui-ux.md` to avoid duplicating already-addressed or permanently deferred items.
- Local reviewer prompt at `~/.codex/agents/ui-ux-designer-reviewer.md`, adapted to this repo.

Primary files/categories examined:

- Global shell, i18n, theme, motion, and landmarks: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/globals.css`, locale message files.
- Public IA and photo surfaces: `nav-client.tsx`, `nav.tsx`, `footer.tsx`, `home-client.tsx`, public route pages under `apps/web/src/app/[locale]/(public)/**`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `histogram.tsx`.
- Admin IA and forms: admin protected pages, `login-form.tsx`, `admin-header.tsx`, `admin-nav.tsx`, `dashboard-client.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `settings-client.tsx`, `analytics-client.tsx`, `tokens-client.tsx`, `admin-user-manager.tsx`, topic/tag manager components.
- Accessibility and UX contracts/tests: `touch-target-audit.test.ts`, focus-visible scans, privacy landmark test, lightbox controls contract, modal-isolation source contract tests, search tests, upload/dashboard tests.

## Runtime Evidence

Local app server started with `npm run dev --workspace=apps/web -- --port 3001`.

Reachable browser checks:

- `http://localhost:3001/en/privacy` loaded as `Privacy | GalleryKit`. Accessibility snapshot exposed skip link, `navigation "Main navigation"`, `main` with `heading "Privacy"`, footer/contentinfo, theme and language controls, and notification region.
- Opening public search from the privacy page produced `#search-dialog` with `aria-modal="true"` and an accessibility snapshot containing only `dialog "Search photos"`, combobox search input, close button, status/help text. Active element was the search input. This confirms the older background-exposed-modal issue is not currently present on this path.
- `http://localhost:3001/en/admin` loaded as `Admin | GalleryKit`. Accessibility snapshot exposed heading `Admin`, username/password labels, show-password button, and sign-in button. Submitting invalid credentials produced role `alert` text `Authentication failed. Please try again.`

Runtime blocker:

- DB-backed routes could not be fully exercised because local MySQL refused connections: server logs repeatedly showed `connect ECONNREFUSED 127.0.0.1:3306`, `Could not connect to database to bootstrap queue`, and failed DB queries for home/gallery metadata. I therefore did not make runtime-only claims about populated gallery, image detail, authenticated admin, map/timeline, or real topic datasets.

Focused verification command:

```sh
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/lightbox-controls-contract.test.ts
```

Result: 5 files passed, 48 tests passed.

## Confirmed Issues

### C27-UX-01 - Desktop public navigation can clip topic links when the topic list wraps

Severity: Medium
Confidence: High
Area: Public information architecture, responsive navigation, keyboard visibility

Evidence:

- The nav container is fixed to `h-16 overflow-hidden` whenever `isExpanded` is false: `apps/web/src/components/nav-client.tsx:85-89`.
- The only expand/collapse control is mobile-only (`md:hidden`): `apps/web/src/components/nav-client.tsx:100-117`.
- The topic list is forced visible at desktop and allowed to wrap with `md:flex md:flex-1 ... md:flex-wrap`: `apps/web/src/components/nav-client.tsx:120-126`.
- Individual topic links are non-shrinking pills with `whitespace-nowrap shrink-0`: `apps/web/src/components/nav-client.tsx:131-153`.

Failure scenario:

A gallery with many public topics, long localized Korean topic labels, or topic thumbnails can wrap the desktop topic row onto a second line. Because the parent remains `h-16 overflow-hidden` and the desktop expand button is hidden, wrapped topic links can be visually clipped. Keyboard users may still tab into a clipped link because the link remains in the DOM and is not hidden from focus, creating a visible-focus/focus-context failure. Pointer users lose direct access to lower-row topics.

Suggested fix:

Choose one desktop overflow model and make it explicit:

- Allow the desktop nav to grow: add a desktop override such as `md:h-auto md:min-h-16 md:overflow-visible` when topics are visible, and verify sticky header overlap.
- Or keep a single-line desktop nav with horizontal scrolling or a `More` menu, and ensure focused links scroll into view.
- Add a responsive fixture/test with 10-12 topics plus long KO labels to assert that all topic links have non-zero visible boxes and focus rings are not clipped.

Text-extractable evidence:

```tsx
// nav-client.tsx
isExpanded ? "h-auto py-3 flex-wrap items-start" : "h-16 overflow-hidden"
...
className="... md:flex ... md:flex-wrap ..."
...
className="... whitespace-nowrap shrink-0 ..."
```

### C27-UX-02 - Create-user password length instruction is visible but not programmatically associated

Severity: Low
Confidence: High
Area: Admin form validation UX, WCAG 2.2 3.3.2 Labels or Instructions

Evidence:

- The create-user password input has `required minLength={12}` but no `aria-describedby`: `apps/web/src/components/admin-user-manager.tsx:113-114`.
- The visible instruction `t('password.minLength')` is rendered in a following paragraph without an id: `apps/web/src/components/admin-user-manager.tsx:115`.
- The confirm-password field does use `aria-describedby` for its error path, which shows this component already has the expected pattern available: `apps/web/src/components/admin-user-manager.tsx:118-123`.

Failure scenario:

A screen-reader admin opens the create-user dialog and lands on the password field. The field is announced as a required password input, but the minimum-length instruction is not part of the accessible description. The admin may only discover the 12-character requirement after browser/server validation rejects the value, adding avoidable trial-and-error to a security-sensitive workflow.

Suggested fix:

Give the hint a stable id and reference it from the password input:

```tsx
<Input
  id="create-password"
  aria-describedby="create-password-help"
  ...
/>
<p id="create-password-help" className="text-xs text-muted-foreground">
  {t('password.minLength')}
</p>
```

If confirm password should repeat the same rule, include both the help id and the conditional error id in its `aria-describedby`.

## Likely Issues

No additional likely issues are being raised beyond C27-UX-01. The navigation issue is source-confirmed, but its exact visible severity depends on live topic count, label length, thumbnail use, and viewport width; it should be manually validated with production-like topic data after DB access is restored.

## Risks Needing Manual Validation

- Populated gallery masonry, photo detail, lightbox, bottom sheet, color/HDR indicators, map, timeline, shared gallery, and collection flows need a DB-backed browser pass. Source review found strong modal/focus/reduced-motion coverage, but the live data-dependent layouts were not reachable.
- Authenticated admin dashboard/settings/images/tokens/users need a real admin session and database to validate empty/loading/error state transitions, slow mutations, long localized strings, and table overflow behavior end to end.
- Dark/light/OLED visual contrast looks covered by token choices and tests, but full visual inspection should be repeated with actual photo content because image overlays, badges, and metadata pills are content-dependent.
- RTL is structurally future-proofed with `dir={getLocaleDirection(locale)}`, but no RTL locale is currently shipped; any future RTL launch needs manual route-by-route layout validation.

## Positive Coverage / Not Re-raised

- Global document language and direction are set on `<html>` (`lang={locale}`, `dir={getLocaleDirection(locale)}`), and the skip link is the first focusable element: `apps/web/src/app/[locale]/layout.tsx:94-128`.
- Theme support includes system/light/dark/OLED and disables theme-change transitions: `apps/web/src/app/[locale]/layout.tsx:130-137`.
- Search modal uses `FocusTrap`, `role="dialog"`, `aria-modal="true"`, labelled combobox semantics, keyboard instructions, and a polite status live region: `apps/web/src/components/search.tsx:373-454`.
- Modal tree isolation now applies `aria-hidden` and `inert` to non-modal sibling subtrees and restores state on cleanup: `apps/web/src/components/use-modal-tree-isolation.ts:19-65`.
- The touch-target audit now explicitly scans the public route group and app-level route shells: `apps/web/src/__tests__/touch-target-audit.test.ts:45-83`.
- Focus/touch/lightbox/privacy contracts passed in the focused test slice: 5 test files, 48 tests.

## Final Sweep

Confirmed: app code was not edited. The review artifact itself is the only intended output from this pass.

Files/categories reviewed:

- Project docs and prior UX review context.
- Public route shells, privacy page, home/gallery source, nav/footer, search, photo viewer, lightbox, zoom, metadata, color/HDR surfaces, loading/empty/error states.
- Admin login source/runtime, protected admin page/component source, user/tokens/settings/analytics/upload/image management forms and dialogs.
- UI primitives, modal isolation helper, theme/global CSS, reduced-motion handling, i18n/locale direction, and test contracts for touch targets/focus/landmarks/lightbox.

Stop condition met: findings are source-cited, runtime/test evidence is recorded, DB-dependent validation gaps are documented, and stale/permanently deferred items were not duplicated.

# Designer Review - Cycle 13

Role: designer / UI-UX reviewer subagent for GalleryKit. Scope covered information architecture, affordances, keyboard/focus navigation, WCAG 2.2 accessibility, contrast/ARIA/focus traps/reduced motion, responsive breakpoints, loading/empty/error states, form validation UX, dark/light/OLED mode, i18n/RTL applicability, and perceived performance. No production code was changed.

## Inventory Reviewed

I first read `AGENTS.md` and `CLAUDE.md`, then built a UI inventory excluding `node_modules`, `.git`, build output, uploads/resources, and runtime state. The review-relevant inventory included 507 UI-adjacent source/test/message files across:

- Public App Router pages/layouts: home, topic, smart collection, shared group/link, photo detail/loading, map, timeline, year archive, privacy, not-found/error/loading shells.
- Admin pages/layouts: login, protected layout, dashboard/upload/image manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, admin error/loading shells.
- Components/primitives: nav/footer/search, masonry/photo viewer/lightbox/info sheet, color details/histogram/wide-gamut hint, upload dropzone, tag input, image manager, admin nav/header, Radix/shadcn UI primitives.
- Styling/config/i18n/tests: `globals.css`, `tailwind.config.ts`, `components.json`, `messages/en.json`, `messages/ko.json`, Playwright e2e specs, and UI/a11y Vitest coverage.

## Validation Evidence

- Local dev server: `http://127.0.0.1:3200` via `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3200`.
- Browser checks: Chromium headless at mobile viewport `390x844` for `/en`, `/en/admin`, `/en/privacy`, search dialog interaction, skip-link focus, and computed styles.
- Runtime blocker: `/en` rendered the localized error shell because local DB-backed queries failed; `/en/admin` and `/en/privacy` rendered. I did not run DB init/seed because that would mutate the configured local database.
- Targeted tests passed: `npm test --workspace=apps/web -- --run` for 10 UI/a11y files, 78 tests total (`a11y-us-p15`, touch-target audit, focus-visible scans, info bottom-sheet IA, search disclaimer, error shell, privacy landmark).

## Confirmed Issues

### DES-C13-01 - OKLCH theme overrides invalidate Tailwind color utilities in modern browsers

Severity: High
Confidence: High
Classification: confirmed

Source evidence:

- Tailwind color tokens still wrap CSS variables as HSL channel lists, e.g. `primary.DEFAULT: 'hsl(var(--primary))'`, `primary.foreground: 'hsl(var(--primary-foreground))'`, `destructive.text: 'hsl(var(--destructive-text))'` in `apps/web/tailwind.config.ts:23-58`.
- `globals.css` overwrites those same variables with full `oklch(...)` color functions under `@supports (color: oklch(0 0 0))` at `apps/web/src/app/[locale]/globals.css:121-148`.

Browser evidence:

- Selector `button.bg-primary.text-primary-foreground` on `/en/admin` sign-in button computed as `background-color: rgba(0, 0, 0, 0)` and `color: rgb(9, 9, 11)` in Chromium, despite carrying the primary-button classes.
- Selector `p[role="alert"].text-destructive-text` after a failed login computed as `color: rgb(9, 9, 11)`, not the intended red.
- Stylesheet rules for `.bg-primary` / `.text-destructive-text` exist, but they evaluate to invalid declarations like `hsl(var(--primary))` after `--primary` becomes a full Lab/OKLCH color.

Failure scenario:

In modern browsers that support OKLCH/Lab, primary buttons lose their filled-background affordance, error/destructive text falls back to normal foreground color, and related accent/ring/destructive utilities can silently degrade. This affects visual hierarchy, error recognition, and focus/affordance clarity across public and admin UI.

Suggested fix:

Use one token contract consistently. Either remove the OKLCH overrides and keep `--primary`/friends as HSL channels, or change Tailwind colors to use raw variables (`var(--primary)`, `var(--primary-foreground)`, etc.) with HSL fallbacks supplied as complete color values. Add a browser/computed-style regression test for `.bg-primary`, `.text-primary-foreground`, `.text-destructive-text`, and `.ring-ring`.

### DES-C13-02 - TagInput text field misses the 44 px touch-target contract

Severity: Medium
Confidence: High
Classification: confirmed from source

Source evidence:

- `TagInput` wraps selected tags and a raw `<input role="combobox">` in a bordered flex container, but the container has no click handler to focus the input: `apps/web/src/components/tag-input.tsx:184-188`.
- The raw input class is only `flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground`, with no `min-h-11`, padding, or shared `Input` primitive: `apps/web/src/components/tag-input.tsx:203-223`.
- This component is used in upload/admin editing paths: `apps/web/src/components/upload-dropzone.tsx:393`, `apps/web/src/components/upload-dropzone.tsx:521`, `apps/web/src/components/bulk-edit-dialog.tsx:263`, `apps/web/src/components/bulk-edit-dialog.tsx:276`, and `apps/web/src/components/image-manager.tsx:493`.

Failure scenario:

On mobile admin workflows, the visible tag-entry field can present as a small text-line target inside a larger decorative container. Tapping the empty padded area does not focus the combobox, and the actual text input does not meet the repo’s 44x44 px target policy from `CLAUDE.md`. This is easy to miss because the existing touch-target audit does not scan raw text inputs.

Suggested fix:

Give the combobox input a real `min-h-11` target (and enough vertical padding), or make the wrapper an honest focus proxy with `onClick={() => inputRef.current?.focus()}` while preserving combobox semantics. Extend `touch-target-audit.test.ts` to cover raw text/search inputs or this component specifically.

## Likely Issue / Manual Validation Needed

### DES-C13-R1 - Mobile info sheet may overstate modality in peek state

Severity: Medium
Confidence: Medium
Classification: likely; not browser-confirmed because DB-backed photo pages did not render locally

Source evidence:

- The backdrop renders only when `sheetState === 'expanded'`: `apps/web/src/components/info-bottom-sheet.tsx:176-182`.
- `FocusTrap` is active for any `isOpen` state: `apps/web/src/components/info-bottom-sheet.tsx:184-193`.
- The sheet always advertises `role="dialog"` and `aria-modal="true"`: `apps/web/src/components/info-bottom-sheet.tsx:194-199`.
- Peek state is visually partial via transform/min height/hidden overflow: `apps/web/src/components/info-bottom-sheet.tsx:199-210`.

Risk scenario:

If peek is intended as a non-modal partial disclosure, keyboard and screen-reader users are trapped in a modal dialog while sighted users see no backdrop and a partially available photo view. If peek is intended as modal, the missing backdrop/inert visual treatment undersells that the rest of the page is unavailable.

Suggested validation/fix:

Manually test a mobile photo page with VoiceOver/TalkBack and keyboard. Then choose one contract: modal in all open states with consistent backdrop/inert treatment, or non-modal peek with trap/`aria-modal` enabled only when expanded.

## Verified Strengths

- Skip link works in browser: first `Tab` focuses “Skip to content”; `Enter` moves focus to `#main-content`.
- `/en/admin` login shell has one main landmark, visible labels, focused username input, password reveal button, and 44 px controls.
- `/en/privacy` now has one main landmark and no nested `main main`; the previous cycle’s privacy landmark issue is fixed.
- Search dialog opens from mobile nav, autofocuses `#search-input`, uses `role="dialog" aria-modal="true"`, focus trap, close button, live result status, and 44 px input/close controls.
- Shared `Table` primitive wraps tables in `overflow-x-auto`, covering admin table overflow paths.
- Reduced-motion and forced-colors handling exist in global CSS; photo/lightbox/image-zoom paths include reduced-motion handling.
- English/Korean key parity and touch/focus-visible policies are backed by tests. Current locales are LTR, and `dir="ltr"` is appropriate for the shipped locale set.

## Limitations

- DB-backed public gallery/photo/map and authenticated admin workflows were not fully browser-exercised because the configured local DB failed queries. I used source and existing test coverage for those paths.
- I did not mutate local DB state or run e2e seed/init.
- Full lint/typecheck/build/test suite was not run because this was a review-only artifact and no production code changed.

## Completion Check

- Inventory built before findings.
- Browser automation used where feasible with DOM/computed-style evidence.
- Relevant source and cross-file interactions inspected.
- Final sweep covered IA, affordances, focus/keyboard, WCAG/accessibility, contrast/theme, ARIA/focus traps, responsive behavior, loading/empty/error states, validation UX, i18n/RTL applicability, and perceived performance.

# Designer UI/UX Review — Prompt 1

Repo: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-04-28  
Mode: fan-out subagent F, review-only; no fixes implemented.

## Inventory and coverage

Inventory was built first from the UI-relevant worktree plus `git status --short`, excluding `node_modules`, `.next` output, generated `tsbuildinfo`, and binary/media artifacts unless they were directly relevant to the user-facing experience.

Reviewed surfaces:

- App routes/layouts/loading/error/not-found: `apps/web/src/app/[locale]/**`, including public, admin, shared-photo, shared-group, and upload routes.
- Shared UI components: `apps/web/src/components/**`, especially `nav`, `home-client`, `search`, `tag-filter`, `photo-viewer`, `lightbox`, `info-bottom-sheet`, `upload-dropzone`, `image-manager`, and admin forms/managers.
- Styling/design tokens: `apps/web/src/app/[locale]/globals.css`, `apps/web/src/components/theme-provider.tsx`, Tailwind primitives.
- i18n/messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/i18n/request.ts`, locale helpers.
- Public assets: `apps/web/public/**` (fonts, upload derivatives, histogram worker).
- E2E / UI tests: `apps/web/e2e/**`, `apps/web/src/__tests__/**`, including the touch-target audit.
- Current uncommitted files at review start:

```text
 M .context/reviews/_aggregate.md
 M .context/reviews/architect.md
 M .context/reviews/designer.md
 M .context/reviews/perf-reviewer.md
 M .context/reviews/test-engineer.md
 M .context/reviews/tracer.md
 M .context/reviews/verifier.md
 M .gitignore
 M apps/web/playwright.config.ts
 M apps/web/src/__tests__/touch-target-audit.test.ts
 M apps/web/src/components/lightbox.tsx
 M apps/web/vitest.config.ts
```

Runtime validation note: I booted the local Next.js dev server and attempted to inspect the live gallery in Chromium, but the app fell into its top-level error shell because the local MySQL credentials were not available in this environment. I therefore validated the actual rendered error state and used the codebase + tests for the rest of the review.

## Findings

### D1 — The top-level error boundary strips away the site shell, turning transient failures into a dead-end

- **Classification:** Confirmed UX / IA issue
- **Severity:** High
- **Confidence:** High
- **Location:** `apps/web/src/app/[locale]/error.tsx:7-35`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx:7-35`
- **Problem:** Both error boundaries render a bare centered message and two actions, but they do not preserve the public/admin shell, landmarks, or any broader wayfinding. In the browser, the local `/en` load collapsed into only `Error`, the explanatory copy, `Try again`, and `Return to Gallery`; there was no `nav`, `main`, or `footer` in the DOM.
- **Runtime evidence:**
  - Body text on `/en`: `Error / Something went wrong loading this page. / Try again / Return to Gallery`
  - DOM counts on mobile viewport: `nav: 0`, `main: 0`, `footer: 0`, `h1: 1`, `buttons: 1`, `links: 1`
  - Accessible controls present: `button` “Try again”, `link` “Return to Gallery”
- **Failure scenario:** A transient DB outage, slow query, or route exception can strand users on a page with no topic navigation, search, locale switch, or footer recovery path. They have to guess whether to retry or abandon the site.
- **Suggested fix:** Reuse the public/admin shell around the error state, or at minimum restore the skip link, `main` landmark, and a minimal nav/back-to-gallery path before the retry action. That keeps the error state recoverable instead of terminal.

### D2 — The error-state recovery controls miss the 44 px touch-target floor on mobile

- **Classification:** Confirmed accessibility / affordance issue
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/src/app/[locale]/error.tsx:16-34`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx:16-34`
- **Problem:** The recovery actions are visually compact. In a 390×844 viewport, Playwright measured the `Try again` button at `91×38` and the `Return to Gallery` link at `143×38`. Both are below the 44 px hit-target floor the rest of the repo is trying to enforce.
- **Runtime evidence:**
  - Selector/role/text: `button` “Try again”; `a[href="/en"]` “Return to Gallery”
  - Computed boxes: `button` height `38`, link height `38`
  - Typography/spacing: both use `font-size: 14px` / `line-height: 20px`, so the tappable region is visibly and physically small
- **Failure scenario:** On a phone, a user recovering from a server error can easily miss the intended action, especially if they are trying to back out quickly after a failed load.
- **Suggested fix:** Give both actions at least `h-11`/`min-h-11` with comfortable horizontal padding, and make the primary recovery action feel dominant rather than visually equal to the navigation escape hatch.

### D3 — Loading states are spinner-only and provide no visible status context

- **Classification:** Likely UX issue
- **Severity:** Low
- **Confidence:** Medium
- **Location:** `apps/web/src/app/[locale]/loading.tsx:3-10`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:3-10`
- **Problem:** The global loading boundaries render only a spinning indicator with an `aria-label`. That is enough for assistive tech, but sighted users get no visible explanation of what is loading or how long the wait might be. When reduced-motion is active, the spinner becomes a static ring, which makes the lack of visible copy even more obvious.
- **Failure scenario:** On slow data loads or navigations, the page can feel blank or broken instead of clearly “loading the gallery” / “loading admin”.
- **Suggested fix:** Add visible loading copy or a small skeleton/context line next to the spinner so the state remains understandable without relying on motion or screen-reader text.

## Final sweep / risks needing manual validation

### R1 — RTL support is not wired into the current locale model

- **Classification:** Risk needing manual validation
- **Severity:** Low
- **Confidence:** Medium
- **Location:** `apps/web/src/app/[locale]/layout.tsx:88-95`, `apps/web/src/i18n/request.ts:4-14`
- **Observation:** The root layout hardcodes `dir="ltr"`, and the locale request layer only accepts `en` / `ko`. That matches today’s shipped locales, so it is not a present bug, but there is no path to render RTL content without code changes.
- **Why it matters:** If an RTL locale is ever added, the current shell will need a deliberate direction-aware pass; otherwise the typography, icon order, and affordances will all stay left-to-right.
- **Manual check to keep in mind:** Revisit `dir`, logical spacing utilities, and any arrow/chevron semantics before expanding the locale list beyond LTR languages.

## Verified non-findings / positive controls

- The current uncommitted lightbox touch-target change looks correct: `apps/web/src/components/lightbox.tsx:307-329` now uses `h-11 w-11` for the close and fullscreen controls, and the updated `apps/web/src/__tests__/touch-target-audit.test.ts:81-88` passes.
- The public layout already has a skip link and focusable `main` landmark in `apps/web/src/app/[locale]/(public)/layout.tsx:10-20`, and the 404 page intentionally preserves that shell in `apps/web/src/app/[locale]/not-found.tsx:19-52`.
- The home page heading structure is deliberate: `H1` on the hero, hidden `H2` for the gallery section, and `H3` on cards in `apps/web/src/components/home-client.tsx:137-161`.
- Desktop/mobile nav, search, photo viewer, and the admin managers already show a lot of good accessibility intent in code: 44 px nav controls, explicit labels, live regions, and modal focus traps.

## Count

- Total findings: 3
- Confirmed: 2
- Likely: 1
- Risks needing manual validation: 1

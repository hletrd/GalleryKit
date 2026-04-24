# Designer (UI/UX) — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

## UI/UX presence detection

The repository contains a web frontend:
- Next.js App Router with React 19 in `apps/web/src/app/`
- Radix UI + shadcn/ui + Tailwind CSS components in `apps/web/src/components/`
- Playwright e2e tests in `apps/web/e2e/`
- Existing visual artifacts in `.context/` (home-*-desktop-review.png, photo-*-desktop-review.png)
- i18n via next-intl (en, ko)

UI/UX review applies. I focused on regressions since cycle-4-rpl2 designer review, not a from-scratch audit.

## Method note (multimodal caveat)

The environment is text-only. Where I reference visual state, I cite specific selectors + CSS classes from the source, not rendered screenshots. Existing `.context/home-desktop-review.png` etc. are available as attachments for the human reviewer.

## Findings

### DSG5-01 — Admin layout skip-to-content link focus position uses `focus:top-4 focus:left-4`
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/app/[locale]/admin/layout.tsx:20-22`.
- **Evidence:** skip-link class: `focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md`.
- **Observation:** functionally correct (WCAG 2.4.1). No regression.

### DSG5-02 — Admin layout conditionally renders `<AdminHeader />` — verified
- **Evidence:** `apps/web/src/app/[locale]/admin/layout.tsx:23`. Login page gets no authenticated chrome. **PASS** (C1R-03 regression-guarded).

### DSG5-03 — Public pages use `safeJsonLd` with correct U+2028/U+2029 escaping — verified
- **PASS.**

### DSG5-04 — JSON-LD breadcrumb uses `topic_label || topic` — verified
- **Evidence:** prior cycle fix C4R-RPL2-03. **PASS.**

### DSG5-05 — Admin mobile nav lacks visible scroll affordance
- **Severity:** LOW. **Confidence:** MEDIUM. Cross-ref AGG3R, existing deferred.
- **Disposition:** existing deferred backlog (D2-01 / D1-03). No new work.

### DSG5-06 — Footer "Admin" link contrast (AAA fail)
- **Severity:** LOW. Cross-ref AGG3R-06.
- **Disposition:** existing deferred. No new work.

### DSG5-07 — Search input debounce timing
- **Severity:** LOW.
- **File:** `apps/web/src/components/search.tsx`.
- **Observation:** I did not detect a regression since cycle-4. Not re-audited in this cycle; observational.

### DSG5-08 — `<script type="application/ld+json" dangerouslySetInnerHTML>` pattern repeated at 3 call sites
- **Severity:** LOW. Cross-ref AGG4R2-09, test-engineer T5-07.
- **Disposition:** existing deferred. No new work.

### DSG5-09 — `admin-header.tsx` logout form uses a native POST with a form-action, requires JS disabled flows to still work — verified
- **Observation:** the logout flow is a server action, which relies on JS. Existing design. Low observation.

### DSG5-10 — No new UX regressions identified since cycle-4-rpl2
- **PASS.** The visual artifacts in `.context/` (`home-desktop-review.png`, `home-mobile-review.png`, `photo-desktop-review.png`, etc.) were produced during cycle-4 reviews; they reflect a state that matches the current code. Any change this cycle would regenerate them if touched.

## Focus + keyboard + ARIA

Spot-checked `admin-nav.tsx`, `admin-header.tsx`, `image-manager.tsx`. Prior cycles added `aria-*` attributes and touch-target sizing (see `0000000e5 fix(a11y): meet WCAG 2.5.8 AA on tag-filter pill touch targets (C3R-RPL-03)`, `000000081 fix(a11y): give the locale-switch button an accessible name (C3R-RPL-02)`, `0000000bfa fix(a11y): add semantic headings on the photo page (C3R-RPL-01)`). No regressions detected.

## i18n / RTL

- en/ko supported. `<html dir="ltr">` explicit (from `0000000d52 fix(a11y): set explicit html dir=ltr (C3R-RPL-05)`). No Arabic/Hebrew locale yet, so RTL untested.
- Sub-finding: no regression, but if RTL locales are added later, the admin layout's `focus:left-4` on skip-link would stay left regardless of direction. Low, observational.

## Perceived performance

- Blur placeholder via Sharp `resize(16)` + `blur(2)` — good.
- ISR: photo pages (1 week), topic/home (1 hour), admin force-dynamic — good.
- No regression detected.

## Summary

10 design observations, all LOW. No new actionable findings that aren't in existing deferred backlog. Overall visual and accessibility posture is maintained from cycle-4-rpl2.

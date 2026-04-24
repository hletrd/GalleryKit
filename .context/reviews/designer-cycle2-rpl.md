# designer — cycle 2 rpl

HEAD: `00000006e`.

Multimodal caveat applies — review relies on text-extractable evidence (selectors, class names, ARIA attributes, layout structure) rather than screenshot inspection.

## Scope
Web UI only: `apps/web/src/app/[locale]/**`, `apps/web/src/components/*.tsx`, tailwind classes, i18n strings. Mobile/desktop UI not present.

## Findings

### UX2R-01 — Admin login page no longer renders protected chrome (confirmed alignment with C1R-03)
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx:16,23` — `<AdminHeader />` only renders when `currentUser` is present.
- **Observation:** the unauthenticated login page is now a minimal shell with skip-link and children only. Accessibility: skip-link is properly scoped (`href="#admin-content"`), `focus:not-sr-only` reveals it on keyboard focus. Good.
- **Fix:** none.

### UX2R-02 — Admin mobile nav lacks visible scroll affordance
- **Citation:** `apps/web/src/components/admin-nav.tsx:27` — `overflow-x-auto scrollbar-hide`.
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** pre-existing D1-03. Still open but deferrable.

### UX2R-03 — SEO and settings pages persist normalized values on save
- **Citation:** `seo-client.tsx:55-61`, `settings-client.tsx:56-59`. The UI re-reads from the server-returned `result.settings` on success so trailing whitespace and control chars are displayed correctly after save.
- **Fix:** none. Correct per C1R-04.

### UX2R-04 — Admin image edit modal rehydrates persisted title/description
- **Citation:** `image-manager.tsx:237-241`. Correct per C1R-04.
- **Fix:** none.

### UX2R-05 — Non-critical inconsistency: `Button` `disabled` semantics vs. `aria-busy` on save buttons
- **Citation:** `settings-client.tsx:83-86` uses `disabled={isPending}` without `aria-busy` on the button. AT users have no feedback that a save is in progress beyond the visual spinner.
- **Severity / confidence:** LOW / MEDIUM.
- **Fix:** add `aria-busy={isPending}` to the save button for AT feedback. Small win, defer to the next UI polish cycle.

### UX2R-06 — Admin nav active-link highlight uses `font-bold` + color contrast, passes WCAG AA
- **Citation:** `admin-nav.tsx:34-38`. Color contrast from `text-foreground` vs `text-foreground/60` passes WCAG AA on default light theme; dark theme parity needs a targeted visual check (deferred, already covered by D6-03).
- **Fix:** none this cycle.

### UX2R-07 — The SEO/settings forms use `maxLength` client-side constraints that match server-side validators
- **Citation:** `seo-client.tsx:102,114,126,139,151,171` vs. `apps/web/src/app/actions/seo.ts:17-22`. Matches.
- **Fix:** none. Correct defense in depth.

## Summary
Two very small UX nits (UX2R-05 `aria-busy`, UX2R-02 mobile nav fade mask — pre-existing D1-03). Nothing critical. Cycle 1 rpl's UX work is clean.

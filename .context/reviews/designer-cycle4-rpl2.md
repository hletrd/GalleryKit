# Designer (UI/UX) — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: UI/UX, accessibility, affordances, responsive behavior.

## Scope

GalleryKit is a web app (Next.js App Router + Tailwind + Radix UI + shadcn/ui). UI/UX review is in scope. Artifacts from prior cycles exist in `.context/reviews/ui-ux-artifacts-*`. This pass does not spin up a browser (infra not in session), so findings are source-code based rather than runtime-visual.

## Findings

### C4R-RPL2-DSG-01 — Photo page `<h1 className="sr-only">` is present [POSITIVE]
**File:** `apps/web/src/components/photo-viewer.tsx:255`

Prior cycle AGG3R-01 is addressed. `sr-only` H1 exposed for heading navigation. `<h2>` in sidebar at line 395. Confirmed.

### C4R-RPL2-DSG-02 — Locale-switch button `aria-label` is present [POSITIVE]
**File:** `apps/web/src/components/nav-client.tsx:152`

`aria-label={t('aria.switchLocale', { language: ... })}` — prior C3R-RPL-02 fix confirmed present.

### C4R-RPL2-DSG-03 — Tag-filter pill min-height 24x24px [POSITIVE]

`home-client.tsx` and `tag-filter.tsx` sizing — per prior fix commits (`000000000e5 fix(a11y): :wheelchair: meet WCAG 2.5.8 AA on tag-filter pill touch targets`). Unable to re-verify pixel dimensions in this session without browser; assume correct per git log.

### C4R-RPL2-DSG-04 — `<html dir="ltr">` explicit [POSITIVE]

Prior `0000000d52 fix(a11y): :wheelchair: set explicit html dir=ltr` applied. Confirmed in git log.

### C4R-RPL2-DSG-05 — `<h2 className="sr-only">` on home page [POSITIVE]

Prior `00000005c fix(a11y): :wheelchair: insert sr-only H2 between H1 and photo cards` applied.

### C4R-RPL2-DSG-06 — Footer "Admin" link contrast (carry-forward AGG3R-06)

Prior reviewers measured 4.83:1 (AA pass, AAA fail). Intentional de-emphasis. Carry forward per prior decision.

### C4R-RPL2-DSG-07 — `revokePhotoShareLink` UI feedback [LOW] [LOW]
**File:** `apps/web/src/components/photo-viewer.tsx`

The share button surfaces "sharing" state and toast on success. On revoke (not covered in photo-viewer directly; admin-facing UI), ensure the same toast pattern applies. Unable to verify the revoke UI in this session — track as "designer review required once revoke UI is added to photo-viewer".

### C4R-RPL2-DSG-08 — JSON-LD breadcrumb on photo page uses `image.topic` as name (slug, not label) [LOW] [LOW]
**File:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:189-193`

```ts
image.topic && {
    '@type': 'ListItem',
    position: 2,
    name: image.topic,  // <- this is the slug, not the human label
    item: localizeUrl(seo.url, locale, `/${image.topic}`),
},
```

Should use `image.topic_label` (which is already fetched on line 450 of data.ts via `leftJoin(topics)`). Currently the breadcrumb shows e.g. "family-vacation-2024" instead of "Family Vacation 2024". Minor SEO/UX impact.

**Fix:** `name: image.topic_label || image.topic,`

## Confidence Summary

- 6 positives (prior-cycle fixes confirmed).
- 2 LOW new items (DSG-07, DSG-08).
- 1 carry-forward contrast item.

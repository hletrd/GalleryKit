# Code Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Scope:** Entire repo with focus on code-quality / logic / SOLID / maintainability. Cross-checks all surface areas that changed since cycle 2 and the stable surface we've been reviewing across 46+ prior cycles.

## Inventory coverage

Reviewed:
- All `apps/web/src/app/actions/*.ts` (9 action modules)
- All admin pages under `[locale]/admin/**`
- All public routes under `[locale]/(public)/**`
- All libs under `apps/web/src/lib/**`
- Key components (nav, home-client, photo-viewer, lightbox, upload-dropzone, tag-filter, footer, settings-client, admin-user-manager, admin-nav, search, histogram, image-manager)
- DB schema + migrations
- Test surface (`apps/web/src/__tests__/` — 43 test files, 221 tests passing)
- Custom lint scripts (`scripts/check-api-auth.ts`, `scripts/check-action-origin.ts`)
- CI gates: all pass (lint, lint:api-auth, lint:action-origin, vitest)

## Findings

### CQ3-01 — `CardTitle` primitive is `<div>`, breaks heading hierarchy on photo page [MEDIUM] [HIGH]
**File:** `apps/web/src/components/ui/card.tsx:33-40`, consumed by `photo-viewer.tsx:384-386` and several other admin cards.
**Class of issue:** Logic / semantic HTML.
**Detail:** shadcn/ui v3 base `CardTitle` renders `<div data-slot="card-title">` instead of a heading element. On the public photo page, `CardTitle` is the largest visible label on the image card, but outputs no heading. Combined with the sidebar being `hidden lg:block` on mobile, the photo detail route emits **zero heading elements** on most viewports. See designer-ui-ux-deep.md C3R-UX-01.
**Fix:** In `photo-viewer.tsx`, replace `<CardTitle ...>{normalizedDisplayTitle}</CardTitle>` with `<h2 className="mt-2 text-2xl font-semibold break-words">{normalizedDisplayTitle}</h2>`. Add a visually-hidden `<h1 className="sr-only">{normalizedDisplayTitle}</h1>` at the top of the viewer so mobile screen-reader users can navigate by heading.

### CQ3-02 — Locale-switch `<button>` lacks accessible name [MEDIUM] [HIGH]
**File:** `apps/web/src/components/nav-client.tsx:149-155`
**Detail:** Button text is `"KO"` / `"EN"` — opaque to screen readers. See designer-a11y-audit.md A11Y-02.
**Fix:** Add `aria-label={t('aria.switchLocale', { locale: otherLocale === 'ko' ? '한국어' : 'English' })}` and add the `aria.switchLocale` translation to `en.json` / `ko.json`.

### CQ3-03 — Heading hierarchy skips H1→H3 on home gallery [LOW] [HIGH]
**File:** `apps/web/src/components/home-client.tsx:192, 295, 301`
**Detail:** No `<h2>` between the page `<h1>` and per-card `<h3>`. See C3R-UX-04.
**Fix:** Add `<h2 className="sr-only">{t('home.photosHeading')}</h2>` before the `columns-1 ...` grid div (line 209).

### CQ3-04 — Tag-filter pill height under WCAG 2.5.8 minimum [LOW] [HIGH]
**File:** `apps/web/src/components/tag-filter.tsx` pill class.
**Detail:** `px-2 py-0.5 text-xs` → 22px tall. 2px under WCAG AA min 24×24. See C3R-UX-03.
**Fix:** Change `py-0.5` to `py-1` or add `min-h-[24px]`.

### CQ3-05 — Upload-dropzone partial-failure UX doesn't identify failed files [LOW] [MEDIUM]
**File:** `apps/web/src/components/upload-dropzone.tsx:193-201`
**Detail:** On partial failure, `toast.warning(t('upload.partialSuccess', { count, failed }))` shows only counts. The failed files remain in the selected-files list (`filter(item => failedSet.has(item.file) || ...)`), so users can retry — but there is no visual indicator which card corresponds to a failure. Polish opportunity; not a regression.
**Fix:** Annotate the file card with a "retry" or "failed" badge when it survived the upload round due to failure. Deferred.

### CQ3-06 — Restore confirmation uses `window.confirm` instead of AlertDialog [LOW] [MEDIUM]
**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` (restore form).
**Detail:** Inconsistent with rest of admin surface which uses `AlertDialog`. See ADMIN-04.
**Fix:** Wrap restore button in an `AlertDialog` with destructive styling, mirroring the delete-topic pattern.

### CQ3-07 — `html` `dir` attribute empty [LOW] [MEDIUM]
**File:** `apps/web/src/app/[locale]/layout.tsx`
**Detail:** Browser default is `ltr`; no functional regression but explicit `dir` aids future RTL + some SR speech flow. See C3R-UX-05.
**Fix:** Add `dir="ltr"` to `<html>` element.

## Positive observations

- No `TODO`/`FIXME`/`XXX`/`HACK` comments anywhere under `apps/web/src` — codebase is free of technical-debt markers.
- All `dangerouslySetInnerHTML` usages are constrained to JSON-LD script tags with structured data passed through `safeJsonLd()` — no HTML injection surface.
- All `eslint-disable` comments come with an explanatory note and a React docs URL where applicable.
- `process.env.X` usages are scoped through the rate-limit / session / storage modules; no scattered env reads.
- Every mutating server action in `apps/web/src/app/actions/*.ts` enforces `requireSameOriginAdmin` (verified by `lint:action-origin` custom lint — 18 actions OK).
- Every API route under `apps/web/src/app/api/**` enforces auth where appropriate (verified by `lint:api-auth`).
- Gate: `npm test` = 43 files, 221 tests passing; `npm run lint` = clean; custom lints = clean.

## Totals

- **0 CRITICAL / HIGH**
- **2 MEDIUM** (CQ3-01, CQ3-02)
- **5 LOW** (CQ3-03 through CQ3-07)
- **7 actionable findings total this cycle**

# UI/UX Designer Reviewer - Cycle 10

Role: `ui-ux-designer-reviewer` registered at `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`.

Profile note: the registered local profile is BurstPick/SwiftUI-specific. This repository is GalleryKit, a Next.js photographer gallery and admin tool, so I adapted only the professional creative-tool UI/UX review lens and did not inspect absent BurstPick Swift files.

Scope: PROMPT 1 only. Review report artifact only. No application source edits. No deploy.

Current HEAD reviewed: `630ae1ce` (`docs(review): record cycle 10 architect review`).

## Executive Summary

GalleryKit is in a strong UI state for a self-hosted photographer gallery: the public gallery is photo-first, touch targets are guarded by tests, keyboard navigation exists on the viewer and lightbox, reduced-motion paths are present, and Korean/English message parity is covered. Design quality score: 8/10 for public viewing and 7/10 for admin tooling. The biggest remaining UI/UX problem is repeated collection actions with non-unique accessible names: shared-group photo cards and admin row action buttons do not consistently include the target photo/tag/category in the control name, which makes screen-reader and voice-control workflows ambiguous.

## Inventory Reviewed

Primary UI inventory:

- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared group, shared photo, photo detail, timeline, year, map, loading and layout surfaces.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected layout/loading/error, dashboard, categories, tags, settings, SEO, DB, password, users, tokens, analytics.
- Shared UI under `apps/web/src/components/`: nav, search, masonry cards, tag filter/input, load-more, photo viewer, image zoom, lightbox, info bottom sheet, color details, histogram, upload, image manager, bulk edit, admin header/nav/user manager, map, footer, and shadcn/Radix primitives.
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Tests/evidence: `apps/web/src/__tests__`, `apps/web/e2e`, with focus on touch targets, focus rings, source contracts, i18n, shared routes, and public navigation.

Static inventory count: 103 primary UI/app/admin files across `apps/web/src/components` and `apps/web/src/app/[locale]`.

## Browser Evidence

Browser evidence used deployed `https://gallery.atik.kr` because it has representative production data. Source citations below are from current local HEAD.

- Desktop home `/en`: accessibility tree exposes main nav, tag filter group, active `All` chip, load-more, footer; no horizontal overflow observed. Screenshot: `/tmp/gallery-home-desktop-cycle10.png`.
- Mobile home `/en` at 390 x 844: collapsed nav exposes only title, topics, and 44 x 44 expand button; expanded nav exposes search/theme/locale controls at 44 x 44; no horizontal overflow. Screenshots: `/tmp/gallery-home-mobile-cycle10.png`, `/tmp/gallery-home-mobile-expanded-cycle10.png`.
- Search dialog on mobile: focus lands on `#search-input`; body scroll is locked; combobox/listbox semantics are present; no horizontal overflow. Screenshot: `/tmp/gallery-search-mobile-cycle10.png`.
- Photo page `/en/p/348` at mobile width: sr-only H1 exists, visible toolbar controls are at least 44 px, shortcut help remains in the accessibility tree while visually hidden on mobile, no horizontal overflow. Screenshot: `/tmp/gallery-photo-mobile-cycle10-real.png`.

Focused validation run:

- `npm test --workspace=apps/web -- client-source-contracts.test.ts focus-visible-rings-cycle20.test.ts touch-target-audit.test.ts`
- Result: 3 test files passed, 31 tests passed.

## Findings

### UIUX-C10-01 - Shared-group grid photo links lack the action-oriented accessible label used by other gallery grids

Classification: Confirmed

Severity: Medium

Confidence: High

Evidence:

- Shared-group grid cards are links at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:186-225`. The `<Link>` has `href`, class, and styling, but no `aria-label`; the wrapped `GridPicture` supplies only image `alt={altText}` at lines 212-215, and visible overlay text is rendered separately at lines 196-198 and 221-224.
- The main gallery already uses an action-oriented label: `apps/web/src/components/home-client.tsx:323-326` sets `aria-label={t('aria.viewPhoto', { title: displayTitle })}`.
- Timeline and year grids also use localized action labels: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:233-236` and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:191-194`.
- Existing source-contract coverage only locks this for timeline/year: `apps/web/src/__tests__/client-source-contracts.test.ts:130-143`; it does not include `g/[key]/page.tsx`.

Failure scenario:

A shared-gallery recipient using a screen reader or voice-control command sees a collection of image links named only by title/alt content rather than "View photo: {title}". In a grid with similar titles, the action is less explicit than the main gallery and timeline, and any visible overlay text that remains in the accessibility tree can make the link name noisier than the canonical public grid.

Concrete fix:

Load `getTranslations('aria')` in `g/[key]/page.tsx` and add `aria-label={tAria('viewPhoto', { title: altText })}` to the shared-grid `<Link>`. Add `g/[key]/page.tsx` to the existing `client-source-contracts.test.ts` action-label coverage so shared routes cannot drift from the main gallery again.

### UIUX-C10-02 - Repeated admin row actions use generic "Edit" and "Delete" accessible names

Classification: Confirmed

Severity: Medium

Confidence: High

Evidence:

- Image rows render repeated icon buttons with generic labels at `apps/web/src/components/image-manager.tsx:546-552`: `aria-label={t('aria.editItem')}` and `aria-label={t('aria.deleteItem')}`.
- Tag rows do the same at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:104-113`.
- Category rows do the same at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:228-254`.
- The translation values are generic in both locales: `apps/web/messages/en.json:640-641` is "Edit" / "Delete"; `apps/web/messages/ko.json:640-641` is "편집" / "삭제".
- The user manager shows the intended pattern: `apps/web/src/components/admin-user-manager.tsx:156-162` labels the repeated delete button with `t('aria.deleteUser', { username: user.username })`.

Failure scenario:

On the admin dashboard, tags page, or categories page, a keyboard/screen-reader/voice-control admin encounters many buttons named exactly "Edit" and "Delete". They must infer the target from table position, which is slow and error-prone in dense management tables. Voice users also cannot reliably say "click Delete" when every row has the same command name.

Concrete fix:

Add contextual i18n keys, for example `aria.editImage`, `aria.deleteImage`, `aria.editTag`, `aria.deleteTag`, `aria.editCategory`, and `aria.deleteCategory`. Use stable row labels:

- Images: `image.title || image.user_filename || image.filename_avif || image.id`
- Tags: `tag.name`
- Categories: `topic.label`

Then update the row buttons to include the target in the accessible name, mirroring `deleteUser`. Add a source-contract test that repeated admin row action buttons do not use `aria.editItem` / `aria.deleteItem` in table rows.

### UIUX-C10-03 - Shared-group masonry cards do not use the dimension guard used by the main gallery

Classification: Risk

Severity: Low

Confidence: Medium

Evidence:

- Shared-group card layout builds CSS directly from image dimensions at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:190-194`: `aspectRatio: ${image.width} / ${image.height}` and `containIntrinsicSize: Math.round(300 * image.height / image.width)`.
- The main gallery has an explicit non-positive-dimension guard at `apps/web/src/components/home-client.tsx:298-309`, falling back to `1 / 1` and a square intrinsic reservation if either dimension is invalid.

Failure scenario:

If a legacy or partially repaired shared-group image ever carries width or height `0`, the shared group can emit invalid aspect-ratio/intrinsic-size CSS. The result is a masonry card with poor layout reservation and possible visual jump, while the same image path in the main gallery would degrade to a square placeholder.

Concrete fix:

Reuse the `hasValidDims` pattern from `HomeClient` in `g/[key]/page.tsx`: fallback to `1 / 1` and a fixed intrinsic height when `image.width <= 0 || image.height <= 0`. Add shared-group source coverage beside the existing grid-picture fallback tests.

## Information Architecture

The public IA is sound: global nav, topic links, tag filters, gallery heading, masonry cards, load-more, detail viewer, lightbox, and info sheet form a coherent browsing flow. The previous cycle 7 tag-filter source-of-truth issue is fixed: `TagFilter` now accepts `currentTags` at `apps/web/src/components/tag-filter.tsx:10-22`, and `HomeClient` passes the canonical server state at `apps/web/src/components/home-client.tsx:271-273`.

Admin IA is functional and appropriately dense for a self-hosted tool. The main weakness is not structure; it is repeated row action naming in dense tables.

## Visual Design

No new confirmed visual-system defects found. The source and browser pass show consistent 44 px controls, focus-visible rings, photo-first dark viewer surfaces, responsive masonry columns, and a restrained admin style. The public photo viewer avoids showing keyboard shortcut copy visually on mobile while keeping it available to assistive tech.

## Interaction Design

Public browsing supports pointer, keyboard, and touch interactions well: search has combobox/listbox behavior, photo viewer/lightbox support arrow/F/I/C/H/Space shortcuts, and image zoom has a dedicated keyboard handler. The main interaction defect is repeated/ambiguous control names in collection contexts, which slows assistive and voice-driven workflows.

## Accessibility

Confirmed issues:

- Shared-group photo links do not use the same action-oriented accessible label as other public gallery grids.
- Repeated admin row action buttons do not include target names.

Positive evidence:

- Touch-target audit passed in the focused run.
- Focus-visible ring source contracts passed.
- Mobile nav/search/photo controls observed at 44 px or larger.
- `aria-pressed` tag state is canonical on the deployed home page.

## Responsive Behavior

Desktop and mobile browser checks showed no horizontal overflow on home, expanded mobile nav, search dialog, or photo viewer. Mobile nav controls appear only when expanded, and the photo viewer toolbar preserves 44 px targets.

## i18n

English/Korean message files have the relevant base keys for current UI. The admin row-action fix should add contextual keys in both locales rather than concatenating English-only fragments. Existing `aria.viewPhoto` already supports the shared-group link fix in both locales.

## Photographer Intent

GalleryKit continues to respect the documented product boundary: it presents finished photos accurately and does not introduce culling/scoring/editing UX. Color/HDR indicators and download choices are visible without taking over the primary photo surface.

## Final Verdict

GalleryKit mostly helps the photographer/viewer: the public browsing and photo-detail surfaces are efficient, accessible, and responsive. The remaining UI debt is concentrated in repeated collection controls where accessible names are less precise than the visual layout. Fix the shared-group link label and contextual admin row labels before treating the UI as fully polished for assistive-tech and voice-control users.

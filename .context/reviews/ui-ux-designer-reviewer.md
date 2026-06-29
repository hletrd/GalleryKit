# UI/UX Designer Reviewer - Cycle 11

Role: `ui-ux-designer-reviewer` registered at `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`.

Profile note: the registered local profile is BurstPick/SwiftUI-specific. This repository is GalleryKit, a Next.js photographer gallery and admin tool, so I adapted the professional creative-tool UI/UX, accessibility, interaction, and perceived-performance lens to this web gallery surface.

Scope: PROMPT 1 / Cycle 11 deep review. Review artifact only. No production code edits. No deploy.

Current HEAD reviewed: `36694ea1` (`docs(review): record cycle 11 debugger review`).

## Executive Summary

GalleryKit remains strong for a self-hosted photographer gallery: the primary home grid, shared-group grid, photo viewer, search overlay, lightbox, mobile nav, touch-target policy, focus rings, and EN/KO message surfaces are substantially hardened. Design quality score: 8/10 for public viewing and 7/10 for admin tooling. The biggest remaining UI/UX weakness I found in this pass is that the archive surfaces (`/timeline` and `/year/[year]`) lag behind the main gallery/shared-grid interaction contracts: they lazy-load every visible photo and still build card geometry from raw dimensions without the defensive guards already added elsewhere. That creates avoidable perceived-performance and layout-reservation risk on photo-dense archive pages.

## Inventory Reviewed

Primary UI inventory built before findings:

- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared group, shared photo, photo detail, timeline, year-in-review, map, privacy, loading, and layout surfaces.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected layout/loading/error, dashboard, categories, tags, settings, SEO, DB, password, users, tokens, and analytics.
- Shared UI under `apps/web/src/components/`: nav, search, masonry cards, tag filter/input, load-more, photo viewer, image zoom, lightbox, info bottom sheet, color details, histogram, upload, image manager, bulk edit, admin header/nav/user manager, map, footer, and shadcn/Radix primitives.
- Design/CSS/i18n: `apps/web/src/app/[locale]/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/messages/en.json`, and `apps/web/messages/ko.json`.
- Tests/evidence: `apps/web/src/__tests__` and `apps/web/e2e`, focused on touch targets, focus rings, source contracts, map wiring, timeline/year cards, i18n, public navigation, and visual/perceived-performance coverage.

Previous Cycle 10 UI findings were rechecked and appear fixed in current source:

- Shared-group links now use `aria-label={tAria('viewPhoto', { title: altText })}` at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:189-194`.
- Shared-group dimensions now guard width/height before aspect ratio and intrinsic size at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:179-197`.
- Image, tag, and category row actions now include target names at `apps/web/src/components/image-manager.tsx:546-552`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:109-112`, and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:251-254`.

## Browser Evidence

Browser evidence used deployed `https://gallery.atik.kr` because it has representative production data. Source citations below are from current local HEAD.

- Mobile home `/en` at 390 x 844: no horizontal overflow; tab order starts with skip link, title, expand button, topic links, then tag chips; hidden mobile controls are not in the keyboard path while collapsed.
- Mobile search overlay: opening search from expanded nav focuses `#search-input`; computed input and close button boxes were both 44 px high; dialog has `role="dialog"` and combobox/listbox source semantics.
- Mobile timeline `/en/timeline`: first visible archive images were text-extractably present with `loading="lazy"` and no `fetchpriority`; first image rect was inside the first viewport at `y=400`, `w=358`, `h=238`.
- Map `/en/map`: current production data has the no-geotagged-photos empty state, so marker/popup behavior was assessed from source. The empty state has no horizontal overflow and normal tab order.

Focused source/test evidence:

- `apps/web/src/__tests__/client-source-contracts.test.ts:130-143` locks timeline/year accessible labels, but not above-the-fold loading priority or dimension guards.
- `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts:25-35` only asserts the delegated image fallback wrapper is present on timeline/year.
- `apps/web/src/__tests__/map-thumb-wiring.test.ts:61-66` locks the map dynamic fallback as an ARIA status, but does not require visible loading text.

## Findings

### UIUX-C11-01 - Timeline and year grids lazy-load their first visible photos

Classification: Confirmed

Severity: Medium

Confidence: High

Evidence:

- Timeline cards render every `GridPicture` with `loading="lazy"` at `apps/web/src/app/[locale]/(public)/timeline/page.tsx:238-258`; there is no `fetchPriority` prop.
- Year-in-review cards do the same at `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:196-215`.
- The main gallery already treats above-the-fold cards as first-class LCP candidates: `apps/web/src/components/home-client.tsx:296` computes `isAboveFold`, then passes `loading={isAboveFold ? "eager" : "lazy"}` and `fetchPriority={isAboveFold ? "high" : "auto"}` at `apps/web/src/components/home-client.tsx:357-359`.
- The shared-group grid follows the same pattern at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:182-186` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:221-222`.
- Playwright text-extractable runtime check on production `/en/timeline` found the first eight `main img` elements all had `loading="lazy"` and no `fetchpriority`, including the first image inside the initial mobile viewport.

Failure scenario:

A visitor opens `/timeline` or a year-in-review page from the nav. The first visible photo is the core content, but the browser is told it is lazy and not high priority. On mobile or a slower connection, the archive page can paint heading/chrome first and defer the photo that visually defines the page, while the home and shared-gallery surfaces do the right thing for comparable masonry grids.

Concrete fix:

Port the home/shared-grid above-the-fold priority logic into the archive pages. Compute the first visible count from the grid column count or use a conservative server-safe first-N heuristic (`index < 1` mobile, first 4 or 5 desktop if client measurement is unavailable). Pass `loading={isAboveFold ? "eager" : "lazy"}` and `fetchPriority={isAboveFold ? "high" : "auto"}` to `GridPicture`. Add a source-contract test beside the existing timeline/year label test so archive grids cannot regress to all-lazy loading.

### UIUX-C11-02 - Timeline and year card geometry lacks the dimension guard used by home/shared grids

Classification: Risk

Severity: Low

Confidence: Medium

Evidence:

- Timeline cards build `aspectRatio: \`${photo.width} / ${photo.height}\`` directly at `apps/web/src/app/[locale]/(public)/timeline/page.tsx:225-231`.
- Year cards build the same raw aspect ratio at `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:183-189`.
- The main gallery has the defensive contract at `apps/web/src/components/home-client.tsx:298-309`: `hasValidDims`, `1 / 1` fallback, and a square intrinsic reservation when either dimension is non-positive.
- The shared-group page now has a lighter version of the same guard at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:179-197`.
- Existing archive source contracts cover label localization at `apps/web/src/__tests__/client-source-contracts.test.ts:130-143` and delegated fallback wrapping at `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts:25-35`, but do not cover non-positive dimension handling.

Failure scenario:

If a legacy, partially repaired, or hand-imported archive row ever carries width or height `0`, the timeline/year card emits invalid CSS such as `0 / 0` or a divide-by-zero-derived reservation. Browsers silently drop or misinterpret that layout hint, causing a masonry jump or collapsed reservation on archive pages. The same bad row is already protected on the main gallery and shared-group grid, so this is inconsistent resilience across equivalent photo grids.

Concrete fix:

Reuse the `hasValidDims` pattern from `HomeClient` in both archive pages: derive `cardAspectRatio = hasValidDims ? \`${photo.width} / ${photo.height}\` : '1 / 1'` and, ideally, add `containIntrinsicSize` with a square fallback. Add source coverage that timeline/year pages include `hasValidDims` or equivalent guard before constructing `aspectRatio`.

### UIUX-C11-03 - Map dynamic-loading fallback is visually blank

Classification: Confirmed

Severity: Low

Confidence: High

Evidence:

- `MapLoadingFallback` receives a localized loading label, but renders only an empty bordered muted box at `apps/web/src/components/map/map-loader.tsx:24-31`.
- The fallback has `role="status"`, `aria-live="polite"`, and `aria-label={label}` at `apps/web/src/components/map/map-loader.tsx:26-31`, so assistive tech gets the label, but sighted users see no visible "Loading map" text or spinner.
- The map page passes the localized label at `apps/web/src/app/[locale]/(public)/map/page.tsx:59-65`.
- The current test only asserts `role="status"` and `aria-label={label}` at `apps/web/src/__tests__/map-thumb-wiring.test.ts:61-66`; it does not assert visible loading copy.

Failure scenario:

On a slow connection, cold browser cache, or delayed Leaflet chunk, a visitor opens the map page and sees a large 520 px blank muted rectangle. Because the fallback has no visible text, a sighted user cannot distinguish "the map is loading" from "the map failed but left an empty panel" until the dynamic import resolves or never does.

Concrete fix:

Render the label visibly inside the fallback, for example a centered `Loader2` plus `{label}` text, while keeping `role="status"` and `aria-live`. Add a source test that `MapLoadingFallback` includes visible `{label}` or a visible text node, not just an ARIA label.

## Information Architecture

The public IA is coherent: nav, topic pills, tag filters, masonry grid, load-more, timeline/year archives, detail viewer, lightbox, and info sheet all lead to the same photo-viewing task. The archive pages are structurally sound, but they should inherit the same grid-performance and geometry-resilience contracts as the home/shared grids because they are alternate entry points into the same photo corpus.

Admin IA remains dense and appropriate for a self-hosted operational tool. Cycle 10's repeated-row-action labeling issue appears closed.

## Visual Design

No new confirmed theme/token contrast failure found. The UI remains photo-first, with dark/oled modes, focus-visible rings, 44 px controls, and reduced-motion overrides. The map fallback is the main visual-state weakness in this pass: it reserves the correct space but communicates loading only to assistive tech.

## Interaction Design

Search, nav, photo viewer, lightbox, and image zoom have strong interaction contracts in current source. Browser checks confirmed the mobile nav tab order and search focus behavior. The archive-grid issue is more about perceived performance than direct manipulation: users see slower first-photo readiness on timeline/year surfaces than on the main gallery.

## Accessibility

Positive evidence:

- Search dialog uses dialog + combobox/listbox semantics and focuses the input on open.
- Mobile nav hidden controls are not in the tab path while collapsed.
- Timeline/year photo links use action-oriented localized labels.
- Admin row actions now include target names.
- Map fallback has an ARIA live status.

Remaining issue:

- Map loading state needs visible feedback parity with its accessible status label.

## Responsive Behavior

Mobile home, timeline, photo, and map checks showed no horizontal overflow. Archive pages use responsive masonry columns, but their first visible image priority does not adapt to the viewport the way `HomeClient` does.

## i18n

No EN/KO key-parity problem found in this pass. The proposed map fallback fix can reuse the existing `map.loading` key already passed through `MapLoader`.

## Photographer Intent

GalleryKit continues to respect the documented product boundary: it presents finished photos accurately and does not add culling/scoring/editing workflows. The archive findings are in service of the same photographer intent: first visible photos should appear promptly and layout should stay stable even around unusual legacy metadata.

## Final Verdict

GalleryKit helps the photographer/viewer today. The core viewing surface is polished, and the prior assistive-tech naming issues are fixed. For Cycle 11, I would prioritize bringing timeline/year grids up to the same loading-priority and geometry-resilience standard as the home/shared grids, then make the map loading state visibly self-explanatory.

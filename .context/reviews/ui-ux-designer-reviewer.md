# UI/UX Designer Reviewer - Cycle 22

Repository: `/Users/hletrd/flash-shared/gallery`  
Review HEAD: `dabf8e8a`  
Lane: `ui-ux-designer-reviewer`, adapted from the local reviewer prompt to GalleryKit's Next.js web UI.

## Executive Summary

No Critical or High UI/UX regression was confirmed at current HEAD. GalleryKit's public surfaces have strong accessibility fundamentals for a self-hosted finished-photo gallery: named landmarks, skip links, 44px touch targets, meaningful map markers, modal isolation, EN/KO parity, and honest no-editor/no-culling product boundaries. The main remaining UX debt is admin ergonomics: protected workflows are still arranged as flat navigation plus spreadsheet-style image management, while the public mobile masonry grid still trades photo fidelity for always-on overlay labels.

## Evidence Base

Local runtime: `next start` served `http://127.0.0.1:3100` from the existing build. Browser evidence used `agent-browser` snapshots and DOM/style metrics rather than screenshots alone.

Sampled routes:

- `/en`: home, desktop/mobile nav, tag filter, masonry cards, search dialog.
- `/en/map`: map marker names, list fallback, region text.
- `/en/privacy`: dark-mode colors and document structure.
- `/en/admin`: unauthenticated login form.

Targeted validation passed: 9 Vitest files, 63 tests, covering touch-target audit, theme tokens, i18n key parity, focus-visible links/rings, info-sheet IA, search disclaimer/status, Cycle 22 source contracts, and free-download contracts.

## Findings

### UIUX-C22-01 - Admin image management is optimized for table density, not visual photo administration

Severity: Medium  
Confidence: High  
Status: Confirmed

Exact file/region:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`
- `apps/web/src/components/image-manager.tsx:427-620`

Evidence:

- Dashboard recent uploads are placed in `max-h-[calc(100vh-16rem)] overflow-auto` (`dashboard-client.tsx:142`).
- `ImageManager` renders a horizontally scrollable table with columns for preview, title, filename, topic, tags, gamut, date, and actions (`image-manager.tsx:427-450`).
- The thumbnail is a fixed `h-32 w-32` tile (`image-manager.tsx:473-481`), tags occupy a separate `min-w-[200px]` area (`image-manager.tsx:500-552`), and edit/delete buttons are detached at the far right (`image-manager.tsx:571-607`).

Failure scenario:

An admin reviewing a fresh upload set on a small laptop must pan horizontally to associate a photo with tags, gamut state, date, and actions. The interface asks the admin to maintain row identity while operating on photo-specific content, which is risky when adjacent frames look similar.

Concrete fix:

Introduce a responsive workbench view for non-wide desktops: image preview and primary metadata together, chips/status near the preview, and edit/delete/share/tag actions in the same row/card. Keep the dense table as a desktop mode, not the only shape.

### UIUX-C22-02 - Admin IA gives routine and high-risk pages the same visual weight

Severity: Low-Medium  
Confidence: High  
Status: Confirmed

Exact file/region:

- `apps/web/src/components/admin-nav.tsx:15-49`
- `apps/web/src/components/admin-header.tsx:13-26`

Evidence:

- Ten admin destinations are a single peer array: Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, Database, Analytics (`admin-nav.tsx:15-26`).
- The nav renders as one wrapping flex strip (`admin-nav.tsx:29-49`), inside a wrapping header row with logout (`admin-header.tsx:13-26`).

Failure scenario:

A trusted operator scanning for daily publishing tasks sees DB restore, access tokens, user management, and password pages as equally prominent peers. On a narrow screen, wrapping can separate related tasks while high-risk operations remain visually ordinary.

Concrete fix:

Group the admin nav by job: Publish, Organize, Site, Access, Operations, Insights. Use a sectioned drawer/menu at smaller breakpoints. Preserve existing `aria-current`, focus-visible rings, and touch-target sizing.

### UIUX-C22-03 - Mobile grid overlays reduce clean-photo inspection

Severity: Low  
Confidence: High  
Status: Confirmed

Exact file/region:

- `apps/web/src/components/masonry-card.tsx:149-155`

Evidence:

- Source renders an always-visible mobile top gradient with title/topic: `absolute inset-x-0 top-0 sm:hidden` (`masonry-card.tsx:149-154`).
- Agent-browser 390px viewport on `/en` measured each mobile overlay as visible `display:block`, `358px` wide and `60px` tall over the image. The desktop overlay is hidden until hover/focus (`masonry-card.tsx:155-160`).

Failure scenario:

Visitors browsing on phones see title/topic chrome over every finished photo. If the subject, skyline, or face sits near the top crop, the gallery presentation obscures the photographer's intended composition before the visitor opens the detail page.

Concrete fix:

Move mobile metadata to a reserved caption area, or provide a clean-grid presentation with metadata exposed on focus/open. Keep the accessible link label and do not make metadata color-only.

## UI/UX Coverage Map

Information architecture: public nav/footer, about/privacy/map/timeline/home, admin shell/login, source-only protected admin pages.  
Affordances: search trigger, theme cycle, locale switch, mobile menu, tag filter, map/list fallback, photo links, login, admin source dialogs.  
Focus/keyboard: skip link, 44px controls, search focus trap/inert behavior, source/tests for lightbox/info sheet and focus-visible rings.  
WCAG/ARIA: map marker name fixed; search dialog named; login controls labeled; no missing i18n keys in targeted parity test.  
Responsive: 390px and 1440px sampled; admin table/nav debt remains source-confirmed.  
Loading/empty/error: public not-found/error shells, map no-photo state source, search status source, token/settings source, failed-image source reviewed.  
Dark/light: dark privacy route sampled and theme-token tests passed.  
i18n/RTL: EN/KO catalogs pass parity; only LTR locales ship, so RTL remains future-risk only.  
Perceived performance: memoized masonry cards, sized thumbnails, search debounce/abort, and map chunking are present; no trace was run.

## Checked Non-Issues

- Prior map-marker issue is closed: DOM marker has `alt="Open photo: E2E Landscape"`, `title="E2E Landscape"`, `role="button"`, `tabindex="0"`, and a 44px box.
- Prior missing `common.cancel` / `common.tryAgain` issue is closed: both keys exist in EN and KO messages.
- Search modal had active focus in the combobox and 26 outside body children inert/`aria-hidden` during the sampled open state.
- Login page initial state has no alert noise and exposes a straightforward form with 44px controls.
- Tag filter mobile disclosure is compact and accessible enough for the sampled E2E data.

## Prioritized Recommendations

Tier 0: none confirmed.

Tier 1: redesign admin image management below wide desktop so photo identity, tags, metadata, and actions remain together.

Tier 2: section admin IA into workflows and de-emphasize high-risk operations until the user enters an Operations area.

Tier 3: revise mobile card metadata to protect clean photo inspection; add a future RTL browser matrix when an RTL locale ships; add protected-admin browser proof where credentials are available.

## Final Missed-Issue Sweep

Searched source, docs, messages, and tests for IA, affordance, ARIA, focus, touch, validation, loading/empty/error, dark mode, RTL, semantic search, product claims, analytics, and deploy-copy surfaces. Uninspected categories: authenticated admin pages at runtime, destructive workflows, production CDN/SW/offline behavior, physical HDR/P3 output, generated build output, binary media/font/icon assets, and large-gallery performance traces. No implementation, commits, pushes, or deploys were performed.

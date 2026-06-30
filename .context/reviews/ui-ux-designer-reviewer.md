# Cycle 32 UI/UX Designer Reviewer

Reviewer profile loaded from `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`; the stale BurstPick/Swift specifics were ignored. This pass applies the professional creative-tool reviewer perspective to GalleryKit's Next.js public gallery and admin operator UI. Product code was not edited.

## Executive Summary

GalleryKit is already stronger than a generic self-hosted gallery on accessibility basics, color/HDR honesty, and admin-state feedback, but the main professional UX risk is that high-frequency visual browsing and admin batch work are still shaped by control-heavy web patterns. Design quality: **7.4/10**. The public viewer respects photography well; the admin console is functional and safe, but dense table-only management and mobile filter hierarchy still cost operators time.

## Evidence

- Source inventory covered public routes, admin routes, shared routes, layout/i18n, and UI components under `apps/web/src/app`, `apps/web/src/components`, and `apps/web/messages`.
- Browser evidence used the already-running local Next dev server at `http://localhost:3022` because port 3000 was occupied and a new 3010 server was rejected by Next as another dev server for the repo was already running.
- Local DB was unavailable during browser capture (`ECONNREFUSED` in `apps/web/.next/dev/logs/next-development.log`), so normal masonry/admin-authenticated screenshots were not feasible. Public `/en` rendered the generic route error surface; `/en/admin` rendered the login surface.
- Playwright screenshots captured:
  - `/tmp/gk-home-mobile.png`, `/tmp/gk-home-desktop.png`: DB-failure error state.
  - `/tmp/gk-admin-login-mobile.png`, `/tmp/gk-admin-login-desktop.png`: admin login.
- Playwright DOM metrics confirmed admin login initial focus lands on `#login-username`; mobile username/password/sign-in controls measured `308x44`, password reveal measured `44x44`; desktop form controls measured `334x44`.

## Findings

### UXD-32-01 - Mobile gallery hierarchy still puts controls before photography

- Severity: Medium
- Confidence: High
- Evidence: `HomeClient` renders the page heading/count and then the full `TagFilter` before the photo masonry (`apps/web/src/components/home-client.tsx:255-286`). `TagFilter` renders all tags as wrapping 44px button chips with counts (`apps/web/src/components/tag-filter.tsx:63-120`).
- Why it matters: for a photo gallery, the first mobile viewport should establish the photographic body of work. A wrapped taxonomy wall makes the first impression feel like a dashboard, especially when many tags exist.
- Recommendation: cap mobile filters to one horizontal row, move them behind a filter disclosure, or show active filters first with an explicit "all filters" control.

### UXD-32-02 - Lightbox auto-hide removes essential controls from the accessibility tree

- Severity: Medium
- Confidence: High
- Evidence: hidden lightbox controls receive `{ tabIndex: -1, aria-hidden: true }` (`apps/web/src/components/lightbox.tsx:371-373`). The close, fullscreen, slideshow, prev/next, color pip, and counter all live in that fading overlay (`apps/web/src/components/lightbox.tsx:546-687`).
- Why it matters: visual cleanliness is useful for photos, but a dialog should not become image-only for screen-reader, switch, or voice-control users after idle. Escape still works, but discoverability and recoverability degrade.
- Recommendation: keep close and prev/next in the accessibility tree while visually faded, or provide a persistent off-screen accessible command group.

### UXD-32-03 - Admin image management is table-first and awkward on small screens

- Severity: Medium
- Confidence: High
- Evidence: Dashboard constrains the recent uploads area to a scroll container (`apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`). `ImageManager` then renders a 9-column table with preview/title/filename/topic/tags/gamut/date/actions (`apps/web/src/components/image-manager.tsx:424-594`), including per-row `TagInput` controls (`apps/web/src/components/image-manager.tsx:494-528`).
- Why it matters: a table is efficient on desktop, but on phone/tablet an admin must horizontally pan while editing tags or selecting rows. Upload from mobile is a real path in this product, so post-upload triage should not be desktop-only.
- Recommendation: add a responsive card/list mode below `lg`, with preview, title, topic, tags, gamut, and actions grouped vertically; keep the table for desktop density.

### UXD-32-04 - Admin navigation is ungrouped and likely to wrap into a control wall

- Severity: Low
- Confidence: Medium
- Evidence: `AdminNav` exposes 10 peer links in one wrapping nav (`apps/web/src/components/admin-nav.tsx:15-29`), and `AdminHeader` places that nav beside the Admin brand and logout in a flex-wrap header (`apps/web/src/components/admin-header.tsx:13-27`).
- Why it matters: operators need fast orientation between "operate photos", "configure site", "security/users/tokens", and "maintenance/analytics". A flat row works when short, but as it wraps it loses grouping and scan order.
- Recommendation: group admin routes into operational sections or use a sidebar/overflow menu for lower-frequency maintenance pages.

### UXD-32-05 - Photo card accessible naming is probably redundant

- Severity: Low
- Confidence: Medium
- Evidence: masonry cards set a link `aria-label` (`apps/web/src/components/home-client.tsx:323-327`), image alt (`apps/web/src/components/home-client.tsx:353-355`), and visible overlay title/topic text (`apps/web/src/components/home-client.tsx:395-405`) inside the same link.
- Why it matters: screen-reader users scanning 30+ image links can hear repeated title/topic content. The design has the right information, but too many nodes may compete to name the same card.
- Recommendation: choose one authoritative accessible name for the card link; make decorative overlay text `aria-hidden` if it duplicates the link name.

### UXD-32-06 - Routine UI motion remains slower than necessary for repeated browsing

- Severity: Low
- Confidence: High
- Evidence: reduced motion is globally respected (`apps/web/src/app/[locale]/globals.css:253-279`), but normal masonry hover image transitions use `duration-500` (`apps/web/src/components/home-client.tsx:357-371`) and the desktop info sidebar uses `duration-500` (`apps/web/src/components/photo-viewer.tsx:716-724`).
- Why it matters: 500ms motion is acceptable for showcase feel, but repeated photo browsing benefits from 150-250ms utility transitions.
- Recommendation: shorten routine hover/sidebar transitions and reserve longer animation for deliberate viewer mode changes.

### UXD-32-07 - Generic route error is usable but not operator-informative

- Severity: Low
- Confidence: High
- Browser evidence: local `/en` with DB unavailable showed `Error`, "Something went wrong loading this page.", `Try again`, and `Return to Gallery`; DOM controls were 44px high.
- Source evidence: the route error surface intentionally renders generic copy and two recovery controls (`apps/web/src/app/[locale]/error.tsx:22-57`).
- Why it matters: generic public copy is safe, but operators diagnosing a broken self-hosted gallery get no incident ID or "service temporarily unavailable" distinction.
- Recommendation: keep public-safe wording, but consider a non-sensitive support/reference code or differentiated unavailable copy when server data dependencies fail.

## Category Review

### Responsive Layout

Public masonry adapts from 1 to 5 CSS columns and reserves intrinsic card height (`apps/web/src/components/home-client.tsx:222-237`, `apps/web/src/components/home-client.tsx:286-321`). The photo viewer has mobile bottom-sheet handling and desktop info sidebar split (`apps/web/src/components/info-bottom-sheet.tsx:197-213`, `apps/web/src/components/photo-viewer.tsx:716-727`). Main gap: mobile filter hierarchy and admin table responsiveness.

### Accessibility, Keyboard, Focus

Strong base: root skip link and focusable main target (`apps/web/src/app/[locale]/layout.tsx:119-128`, `apps/web/src/app/[locale]/(public)/layout.tsx:7-16`), 44px Button/Input/Switch primitives (`apps/web/src/components/ui/button.tsx:23-29`, `apps/web/src/components/ui/input.tsx:10-13`, `apps/web/src/components/ui/switch.tsx:24-54`), IME-safe search/tag/login patterns (`apps/web/src/components/search.tsx:297-314`, `apps/web/src/components/tag-input.tsx:104-155`, `apps/web/src/app/[locale]/admin/login-form.tsx:28-43`). Main gap: lightbox idle accessibility.

### Touch Targets

Browser-confirmed login controls meet 44px. Source-level target discipline is consistent across buttons, nav links, tag chips, uploader controls, image manager checkboxes, and modal closes (`apps/web/src/components/ui/button.tsx:23-29`, `apps/web/src/components/tag-filter.tsx:63-120`, `apps/web/src/components/image-manager.tsx:429-463`, `apps/web/src/components/upload-dropzone.tsx:493-590`).

### I18n

English/Korean message namespaces cover nav, upload, image manager, login, search, aria, error, and settings (`apps/web/messages/en.json`, `apps/web/messages/ko.json`). Root layout sets `lang` and `dir` via locale helpers (`apps/web/src/app/[locale]/layout.tsx:93-100`). RTL is future-proofed only at the document level; physical left/right placement remains in lightbox/nav code, so RTL should stay deferred until a real RTL locale is planned.

### Public Workflows

Home/topic/shared routes use dynamic freshness and shared gallery components (`apps/web/src/app/[locale]/(public)/page.tsx:155-178`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:173-225`). Shared single/group views preserve noindex and route into the same viewer (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:122-150`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:144-176`). Color/HDR truthfulness is a standout: display-gated P3/HDR badges and color details are explicit (`apps/web/src/app/[locale]/globals.css:145-162`, `apps/web/src/components/color-details-section.tsx:144-204`).

### Admin Workflows

Upload has good no-category, GPS warning, skipped-file, progress, and per-file error states (`apps/web/src/components/upload-dropzone.tsx:373-489`, `apps/web/src/components/upload-dropzone.tsx:568-571`). Image management supports selection, bulk edit/tag/share/delete, and destructive confirmation (`apps/web/src/components/image-manager.tsx:319-421`, `apps/web/src/components/image-manager.tsx:597-662`). Settings exposes backfill warnings, trigger confirmation, and last-run status (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:302-420`). Main gap is responsive ergonomics, not capability.

### Loading, Empty, Error States

Loading status is localized and ARIA-labelled (`apps/web/src/app/[locale]/loading.tsx:1-14`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:1-14`). Empty states exist for gallery filters, uploads without categories, image manager, analytics, and tokens (`apps/web/src/components/home-client.tsx:426-442`, `apps/web/src/components/upload-dropzone.tsx:373-384`, `apps/web/src/components/image-manager.tsx:586-591`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:105-110`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:120-124`). Error recovery is usable but generic.

### Visual Hierarchy And Design System

The token system is restrained and contrast-aware, including dark/OLED themes, forced-colors adjustments, and reduced-motion suppression (`apps/web/src/app/[locale]/globals.css:13-101`, `apps/web/src/app/[locale]/globals.css:164-182`, `apps/web/src/app/[locale]/globals.css:253-300`). The public viewer correctly makes the photo the primary object. The admin console is pragmatic, but flat nav and table-first management make it feel more like a database console than a polished photo-operations tool.

## Final Verdict

GalleryKit helps photographers and operators more than it gets in their way, especially on color fidelity, safety states, and touch/accessibility fundamentals. Before calling the UI professionally polished, fix mobile gallery filter hierarchy, keep lightbox controls accessible while hidden, and add a responsive admin image-management mode. After those, the remaining work is mostly interaction polish rather than structural repair.

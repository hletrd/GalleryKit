# Cycle 23 UI/UX Designer Reviewer - GalleryKit

Date: 2026-06-30
Reviewer surface: globally registered `ui-ux-designer-reviewer`
Repo: `/Users/hletrd/flash-shared/gallery`

## Prompt Fit

The installed `ui-ux-designer-reviewer` prompt body is tailored to a different SwiftUI product, BurstPick, and references non-existent BurstPick/SwiftUI paths. I treated that as a surface-name mismatch only and reviewed the actual GalleryKit repo: Next.js TSX routes/components, Tailwind/CSS, `messages/en.json`, `messages/ko.json`, public and admin flows, e2e/unit tests, and design/touch-target guardrails.

## Evidence And Constraints

- Read `AGENTS.md` and `CLAUDE.md` before reviewing.
- Source inventory covered public gallery/home/search/photo viewer/lightbox/map/timeline/year/topic/shared flows, admin dashboard/upload/image manager/settings/tokens/db/categories/tags/users/SEO flows, UI primitives, global CSS/theme tokens, locale messages, and UI/a11y tests.
- Browser/DOM evidence was partially feasible. `http://127.0.0.1:3000/` was occupied by a different app (`ccusage | Usage Dashboard`), so local GalleryKit DOM/admin auth validation was blocked. Production `https://gallery.atik.kr/en` rendered GalleryKit and confirmed the public demo shell on mobile, but production may not match this checkout exactly; I used it as supporting evidence only. Screenshot artifact: `/tmp/gallery-ui-review-demo-mobile.png`.
- No application source files were changed. This report file is the only persistent edit from this reviewer pass; other review files were already dirty in the workspace.

## Current Strengths

- Touch target policy is unusually strong: `Button` defaults enforce 44 px+ targets across sizes in `apps/web/src/components/ui/button.tsx:23-29`, and `touch-target-audit.test.ts` recursively scans components/admin/public/root route files in `apps/web/src/__tests__/touch-target-audit.test.ts:42-83`.
- Search has solid keyboard and assistive-tech treatment: trigger focus restore, body scroll lock, focus trap, combobox semantics, IME guards, and live status are in `apps/web/src/components/search.tsx:320-446`.
- Theme and contrast work is explicit for light/dark/OLED, including documented muted/destructive contrast choices in `apps/web/src/app/[locale]/globals.css:18-101`.
- Locale key parity is guarded at the leaf-key level for English/Korean in `apps/web/src/__tests__/i18n-key-parity.test.ts:43-66`.
- The token plaintext modal has been fixed since prior reviews: it suppresses the default close affordance with `showCloseButton={false}` and gates completion on acknowledgement in `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-237`.

## Findings

### 1. [Confirmed] Route error fallback still drops the full public shell

Severity: Medium
Confidence: High
Area: IA, recovery, locale/theme continuity

Evidence:
- `apps/web/src/app/[locale]/error.tsx:22-61` renders a standalone `main` with a small home nav, retry button, and back-to-gallery link.
- `apps/web/src/app/[locale]/not-found.tsx:18-48` already reproduces the public shell with `<Nav />`, `<main>`, and `<Footer />`; its comment at `not-found.tsx:7-11` names the exact wayfinding problem this route error still has.

Failure scenario:
If a data fetch or route segment throws on a public photo/topic page, visitors land on a stripped recovery surface without the normal topic navigation, search, theme switcher, locale switcher, or footer wayfinding. A client trying to recover from a broken shared gallery or photo link can only retry or jump home, losing the same orientation aids available on 404.

Concrete fix:
Bring `error.tsx` to parity with `not-found.tsx`: render `<Nav />` and `<Footer />`, keep `main#main-content`, retain the retry action, and expose stable fallback links for home/search/topics. Preserve the existing focus ring and 44 px controls.

### 2. [Confirmed] Admin image management is table-only on narrow screens

Severity: Medium
Confidence: High
Area: Responsive admin workflow, touch ergonomics, professional batch management

Evidence:
- The image manager renders a nine-column table in `apps/web/src/components/image-manager.tsx:424-595`.
- Each row includes a 128 px preview, title, filename, topic, a `min-w-[200px]` tag editor, gamut/date, and action buttons in `apps/web/src/components/image-manager.tsx:466-582`.
- The table primitive adds horizontal overflow in `apps/web/src/components/ui/table.tsx:7-18`, but there is no alternate mobile layout.

Failure scenario:
A photographer or admin checking uploads from a phone must pan horizontally across preview, metadata, tags, gamut/date, and destructive actions. The controls meet touch-size rules, but the workflow is still slow and error-prone because selection state, preview identity, tags, and delete/edit actions are not visible together.

Concrete fix:
Keep the table for desktop, but add a card/list layout below `lg`: preview + title/filename, topic/gamut/date badges, tag editor, select checkbox, and edit/delete buttons in one vertical unit. Use the existing table as the large-screen path and the same `ImageForManager` data model to avoid behavior drift.

### 3. [Confirmed] Upload staging cards start at two columns on phones

Severity: Low-Medium
Confidence: High
Area: Responsive upload workflow, batch tagging

Evidence:
- Accepted files are rendered with `grid grid-cols-2 md:grid-cols-3 gap-4` in `apps/web/src/components/upload-dropzone.tsx:458-466`.
- Each card contains a square preview, filename/size, inherited global tag chips, and a per-file `TagInput` in `apps/web/src/components/upload-dropzone.tsx:490-532`.
- The remove button is correctly 44 px in `apps/web/src/components/upload-dropzone.tsx:479-488`; the issue is available card width, not target size.

Failure scenario:
On a 360-390 px phone, two columns leave roughly half-width cards for long camera filenames and a tag combobox. That makes per-file classification during a real shoot upload cramped, with truncation hiding identity cues that matter before committing a batch.

Concrete fix:
Change the staging grid to `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`. If batch size makes the single-column mobile list long, add a sticky bottom upload summary/action bar instead of compressing each file card.

### 4. [Confirmed] Accepted upload files can be silently skipped with only a generic limit toast

Severity: Low-Medium
Confidence: High
Area: State visibility, error recovery, batch upload trust

Evidence:
- `onDrop` filters accepted files for per-file, count, and total-byte limits in `apps/web/src/components/upload-dropzone.tsx:143-161`.
- Skipped files are counted, but their names and specific reasons are discarded; the UI only shows a generic `upload.limitExceeded` toast in `apps/web/src/components/upload-dropzone.tsx:163-170`.
- `onDropRejected` does name rejected files in `apps/web/src/components/upload-dropzone.tsx:184-190`, so this omission is specific to accepted files that exceed GalleryKit's aggregate limits.

Failure scenario:
An admin drops a large wedding/event batch and sees fewer files staged than selected. The toast says limits were exceeded, but it does not identify which files were omitted or whether the count limit, total size, or individual file size caused each skip. That erodes confidence before upload and can lead to missed deliverables.

Concrete fix:
Track skipped accepted files as structured `{ name, reason }` entries and render them below the dropzone with per-file reasons and a dismiss action. Keep the toast as a summary, but make the persistent UI the source of truth for what was not staged.

### 5. [Confirmed] Desktop photo info toggling animates the photo canvas layout

Severity: Low-Medium
Confidence: High
Area: Motion, visual stability, photographer review workflow

Evidence:
- The `I` shortcut toggles the pinned info/sidebar state in `apps/web/src/components/photo-viewer.tsx:355-386`.
- The viewer grid uses `transition-all duration-500 ease-in-out` and switches between `grid-cols-1` and `lg:grid-cols-[1fr_350px]` in `apps/web/src/components/photo-viewer.tsx:630-633`.

Failure scenario:
When a photographer toggles EXIF/color details while evaluating composition, sharpness, gamut, or HDR intent, the image area resizes and animates for 500 ms. That movement can interrupt visual comparison and makes the photo canvas feel less stable than the underlying "display photographer intent accurately" product constraint.

Concrete fix:
Avoid animating the photo canvas dimensions. Prefer a desktop overlay/drawer for info, or snap the grid column change instantly and animate only sidebar opacity/transform. If layout must change, gate the transition through a reduced-motion hook and keep the image viewport dimensions stable where possible.

### 6. [Confirmed] Swipe snap animation bypasses the reduced-motion design intent

Severity: Low
Confidence: Medium-High
Area: Motion accessibility, responsive touch interaction

Evidence:
- Global reduced-motion CSS clamps animation/transition duration and suppresses hover scale in `apps/web/src/app/[locale]/globals.css:253-279`.
- `PhotoNavigation` applies an inline transition when snapping swipe feedback back to rest in `apps/web/src/components/photo-navigation.tsx:153-155`.

Failure scenario:
Users with `prefers-reduced-motion: reduce` can still get a touch-driven snap animation because inline `style.transition` has higher precedence than normal class rules. The motion is short, but it contradicts the repo's explicit reduced-motion policy and affects the mobile photo browsing path.

Concrete fix:
Add a reduced-motion check in `PhotoNavigation` using `matchMedia('(prefers-reduced-motion: reduce)')` or a shared hook. When reduced motion is active, set `transitionStyle` to `{}` and immediately reset opacity/transform.

### 7. [Likely] Admin IA is a flat ten-link wrap with no task grouping

Severity: Low-Medium
Confidence: Medium
Area: Information architecture, admin wayfinding

Evidence:
- `AdminNav` defines ten peer links in one array in `apps/web/src/components/admin-nav.tsx:15-26`.
- The render is a single wrapping nav row in `apps/web/src/components/admin-nav.tsx:28-49`.

Failure scenario:
On smaller screens or high zoom, admin navigation wraps into multiple lines with no grouping between content operations, taxonomy, system settings, access/tokens/users, database, and analytics. A photographer/admin switching between upload, image management, settings, and tokens has to scan every link each time.

Concrete fix:
Group admin navigation by workflow: content (`Dashboard`, upload/images where applicable, categories, tags, SEO), operations (`Settings`, analytics, DB), and access (`Tokens`, password, users). Use a responsive segmented/sidebar or disclosure menu while preserving `aria-current` and 44 px link targets.

## Manual-Validation Risks

- Leaflet map controls and tile attribution need a real browser pass under light/dark/OLED themes. Source provides a fallback list in the map route, but third-party control contrast/focus should be manually checked with actual map tiles.
- Authenticated admin browser flows were not validated because the local port was not GalleryKit and no seeded authenticated GalleryKit dev server was available in this session.
- Production public DOM was spot-checked only as supporting evidence; it should not be treated as proof that this checkout's local build matches production.

## Non-Findings From Final Sweep

- Prior token plaintext close-affordance concern is no longer current: the modal disables the default close button and requires explicit acknowledgement in `tokens-client.tsx:187-237`.
- Prior site-wide re-encode one-click concern appears addressed by a confirmation dialog in settings; I did not re-raise it.
- P3/HDR public badge accessibility appears improved: the public photo card P3 badge carries an accessible label rather than being only hidden decorative text.

## Recommended Fix Order

1. Fix the public route error shell first; it is a small parity change with clear IA benefit.
2. Add the mobile image-manager card layout; it has the largest day-to-day admin workflow impact.
3. Adjust upload staging density and skipped-file visibility together; both improve batch trust.
4. Remove photo-canvas layout animation and reduced-motion swipe snap; both are focused motion/stability fixes.
5. Rework admin nav grouping after confirming desired admin workflow clusters.

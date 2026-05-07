# Aggregate Review -- Cycle 7 RPF (2026-05-04)

## Review method

Deep code review of the entire frontend, data layer, upload flow, sharing workflows,
lightbox, photo viewer, admin dashboard, EXIF handling, search, and download routes
from a professional photographer workflow perspective. Focus on new issues not
identified in cycles 1-6.

## Findings

### C7RPF-MED-01: Lightbox `showControls` stale closure causes unnecessary effect re-registration
- **File**: `apps/web/src/components/lightbox.tsx:134-158`
- **Severity**: Medium (perf)
- **Confidence**: High
- **Description**: `showControls` callback includes `controlsVisible` in its dependency
  array (line 158). Every time `controlsVisible` toggles (every ~3s with auto-hide),
  a new callback is created. This causes the keyboard handler effect (line 268-303)
  and wheel handler effect (line 248-256) to re-register event listeners. During a
  5-minute slideshow, this creates ~100 unnecessary addEventListener/removeEventListener
  cycles.
- **Fix**: Use a ref for `controlsVisible` inside the throttling check, removing it
  from the dependency array.

### C7RPF-MED-02: Shared group grid lacks desktop hover overlay for photo titles
- **File**: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:175-221`
- **Severity**: Medium (UX)
- **Confidence**: High
- **Description**: The main gallery grid (`home-client.tsx:263-274`) shows a bottom
  gradient overlay with title+topic on desktop hover. The shared group grid only shows
  a mobile top gradient (visible below `sm:` breakpoint). On desktop, hovering a shared
  group photo shows no title/topic, making it hard to identify photos at a glance.
- **Fix**: Add the same desktop hover overlay pattern to shared group grid cards.

### C7RPF-LOW-01: Lightbox touch handler missing null guard on changedTouches
- **File**: `apps/web/src/components/lightbox.tsx:198`
- **Severity**: Low (edge case bug)
- **Confidence**: Medium
- **Description**: `handleTouchEnd` accesses `e.changedTouches[0]` without null check.
  `changedTouches` can be empty if the touch was cancelled by the browser (e.g., system
  gesture on iOS). Accessing `[0]` on an empty TouchList returns undefined, then
  `.clientX` throws TypeError.
- **Fix**: Add `if (!e.changedTouches[0]) return;` guard.

### C7RPF-LOW-02: Info bottom sheet missing P3 color badge
- **File**: `apps/web/src/components/info-bottom-sheet.tsx:307-310`
- **Severity**: Low (UX inconsistency)
- **Confidence**: High
- **Description**: Desktop info sidebar shows a purple "P3" badge next to P3 color
  space values (`photo-viewer.tsx:716-719`). The mobile bottom sheet renders the same
  `color_space` value but without the badge. Mobile photographers miss the visual cue.
- **Fix**: Add the same P3 badge logic to the bottom sheet EXIF section.

### C7RPF-MED-03: Upload progress shows no current file indication
- **File**: `apps/web/src/components/upload-dropzone.tsx:246-248,366-381`
- **Severity**: Medium (UX friction)
- **Confidence**: High
- **Description**: During upload, the file grid is hidden entirely. Only a generic
  progress bar ("3/10 files" + percentage) is shown. For photographers uploading
  20+ mixed-RAW/JPEG files, they cannot tell which file is uploading or which failed.
  This creates anxiety during long batch uploads.
- **Fix**: Show the current filename in the progress area. Keep the file grid visible
  but dimmed during upload.

### C7RPF-LOW-03: Shared group `generateMetadata` has unused searchParams type
- **File**: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37`
- **Severity**: Low (type)
- **Confidence**: High
- **Description**: `generateMetadata` declares `searchParams` in its type but never
  uses it. Harmless but produces lint noise.
- **Fix**: Remove the unused parameter from the type signature.

### C7RPF-LOW-04: Back-to-top button ignores safe area inset on mobile
- **File**: `apps/web/src/components/home-client.tsx:309-325`
- **Severity**: Low (UX)
- **Confidence**: Medium
- **Description**: The back-to-top button uses `fixed bottom-6 right-6`. On iPhones
  with the home indicator, this may overlap the system gesture area.
- **Fix**: Use `bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]`.

## Previously Fixed (Confirmed)

All findings from cycles 1-6 confirmed fixed:
- Touch targets, EXIF datetime, shutter speed, JSON-LD, shared group AVIF/lightbox,
  i18n gaps, mobile download, lightbox position counter, responsive srcSet, Ken Burns,
  admin capture date, search enrichment, semantic search.

## Gate Status (prior cycle)
- eslint, tsc, vitest, lint:api-auth, lint:action-origin: all green
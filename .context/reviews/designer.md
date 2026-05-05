# Designer (UI/UX) — Cycle 3

## Findings

### F1: OG images are always dark-themed regardless of site configuration
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/og/route.tsx`
- **Severity**: Low
- **Problem**: Both OG endpoints hardcode `#09090b` background and white text. If the photographer configures a light-themed site, social unfurls still show a dark card, creating brand inconsistency.
- **Fix**: Read the current theme from `site-config.json` or admin settings and render a light-mode variant.

### F2: Photo viewer uses `useReducedMotion`
- **File**: `apps/web/src/components/photo-viewer.tsx`, line 72
- **Result**: Good. Respects `prefers-reduced-motion`.

### F3: Masonry grid column-count sync
- **File**: `apps/web/src/components/home-client.tsx`, lines 16-53
- **Result**: Good. The `useColumnCount` hook mirrors Tailwind breakpoints and drives above-the-fold priority loading.

### F4: Info bottom sheet drag states
- **File**: `apps/web/src/components/info-bottom-sheet.tsx`
- **Result**: Good. Touch start/move/end handlers with 44 px touch target minimum.

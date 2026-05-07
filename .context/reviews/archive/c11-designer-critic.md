# Designer + Critic — Cycle 11

## Method
Multi-perspective critique of the whole change surface. UI/UX review of the web frontend (React components, Tailwind CSS, Radix UI/shadcn, framer-motion). Examined: photo-viewer.tsx, lightbox.tsx, image-zoom.tsx, home-client.tsx, load-more.tsx, search.tsx, upload-dropzone.tsx, info-bottom-sheet.tsx, nav.tsx, admin-nav.tsx, admin-header.tsx, image-manager.tsx, all admin pages.

## Findings

### C11-CT-01 (Low / Medium): `photo-viewer.tsx` info sidebar collapse clips content without fade — visually jarring

- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Issue**: When `showInfo` is false, the sidebar uses `lg:w-0 lg:p-0` with `overflow-hidden`. The `transition-all duration-500` animates width from 350px to 0, but the content inside does not fade out — it's clipped by `overflow-hidden`. This creates a "content squish" during the 500ms transition where text and badges are abruptly cut off. The open animation is fine (content appears from the right), but the close animation is visually jarring.
- **Fix**: Add `opacity-0` to the closed state and `opacity-100` to the open state so content fades during the transition.
- **Confidence**: Medium

### C11-CT-02 (Low / Low): `admin-nav.tsx` navigation items don't indicate the active page

- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Issue**: The admin sidebar navigation doesn't visually distinguish the currently active page. Admins navigating between sections must rely on page content to know which section they're in.
- **Fix**: Add an `aria-current="page"` attribute and a visual active indicator.
- **Confidence**: Low

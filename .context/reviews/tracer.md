# Tracer — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Trace targets
1. `topic.label` — admin form input → `createTopic`/`updateTopic` → `topics.label` column → admin UI tables, masonry grid headers, OG image, navigation.
2. `image.title`/`image.description` — admin form input → `updateImageMetadata` → `images.title`/`images.description` columns → photo viewer, info bottom sheet, lightbox, OG card.
3. `image.user_filename` — multipart upload → `uploadImages` → `images.user_filename` column → admin image manager only (not in public selects).

## New findings

### C5L-TRACE-01 — `topic.label` flows to public route segments and OG image without Unicode-formatting filter [LOW] [Medium confidence]

**Trace path:**
- `apps/web/src/app/actions/topics.ts:73` strips control chars, validates length, persists `label`.
- `apps/web/src/db/schema.ts:6` `varchar(255)` accepts arbitrary Unicode formatting characters.
- Renderers: `apps/web/src/components/nav-client.tsx`, masonry grid, OG image at `/api/og`, public topic header at `/[locale]/(public)/[topic]/page.tsx`.
- React HTML-escapes special chars but does **not** strip Unicode bidi/invisible chars.

### C5L-TRACE-02 — `image.title`/`image.description` flow to public photo viewer and lightbox [LOW] [Medium confidence]

**Trace path:**
- `apps/web/src/app/actions/images.ts:642-707` strips control chars, validates length.
- DB column accepts the Unicode formatting characters.
- Public surfaces: `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `lightbox.tsx`, `/api/og` route, EXIF panel.
- Same React-escape behaviour as C5L-TRACE-01.

## Cross-agent agreement
Overlaps with security-reviewer (C5L-SEC-01) and architect (C5L-ARCH-01).

# Tracer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Trace targets
1. `seo_title` — admin form input → `updateSeoSettings` → `admin_settings.value` row → `getSeoSettings` cached load → `<title>` of every public page → SERP snippets, browser-tab text, OG card title, OG image text.
2. `seo_description` — admin form input → `updateSeoSettings` → `admin_settings.value` → `<meta name="description">` of every public page → search-engine snippets and link-preview body.
3. `seo_nav_title` — admin form input → `updateSeoSettings` → `admin_settings.value` → top navigation bar (every public page).
4. `seo_author` — admin form input → `updateSeoSettings` → `admin_settings.value` → `<meta name="author">` and OG-card author byline.

## New findings

### C6L-TRACE-01 — `seo_*` flows reach every public route's HTML head without Unicode-formatting filter [LOW] [Medium confidence]

**Trace path summary:**
- `apps/web/src/app/actions/seo.ts:75-78` strips control chars, validates length, persists.
- `apps/web/src/db/schema.ts:82-85` `admin_settings.value` is `text` — accepts arbitrary Unicode formatting characters.
- Renderers (file references):
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — photo page metadata
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — share page metadata
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — group page metadata
  - `apps/web/src/components/photo-viewer.tsx` — viewer chrome
  - `apps/web/src/lib/photo-title.ts` — title composition
  - `apps/web/src/app/api/og/route.tsx` — OG image SVG text
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` — admin form rehydrate
  - `apps/web/src/lib/data.ts` — central settings load

React HTML-escapes special chars (`<>&"'`) but does **not** strip Unicode bidi/invisible chars. The OG image route writes the strings into an SVG/text path that the renderer respects bidi codepoints when laying out glyphs.

### C6L-TRACE-02 — No flow from `GALLERY_SETTING_KEYS` to user-facing strings [INFO] [High confidence]

**Trace path:** `gallery-config-shared.ts:10-19` lists only numeric/boolean keys. Confirmed via `gallery-config-shared.ts:52-58` validators (`Number.isFinite`, `'true'|'false'`). No string vector reaches the public render path. Cycle-5 carry-forward conclusion stands for `settings.ts` but not `seo.ts`.

## Cross-agent agreement
Overlaps with security-reviewer (C6L-SEC-01) and architect (helper extraction).

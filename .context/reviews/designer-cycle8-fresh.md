# Designer — Cycle 8 (Fresh, broad sweep)

**Scope:** UI/UX and accessibility surfaces.

## Findings

### DSGN8F-01 — `global-error.tsx` brand title is right-aligned-uppercase; non-Latin scripts render awkwardly
**Where:** `apps/web/src/app/global-error.tsx:62-77`.
**What:** `text-sm font-medium text-muted-foreground uppercase tracking-[0.2em]` applied to the brand title. For Korean (ko) the `uppercase` is a no-op, but the `tracking-[0.2em]` (letter-spacing) splits Hangul syllable blocks awkwardly.
**Recommendation:** Conditionally drop `uppercase` and `tracking-[0.2em]` when locale is `ko`, OR drop them globally for consistency.
**Severity:** LOW.

### DSGN8F-02 — `aria-` attribute count: 108 across 25 components. No issue, but no audit.
**Where:** Component directory.
**What:** Rough density looks healthy. Without a screen-reader pass, this cycle cannot deeply assess.
**Recommendation:** Defer formal accessibility audit to next cycle that explicitly opens UI surfaces.

### DSGN8F-03 — `/api/og` rendering uses `font-family: sans-serif` only
**Where:** `apps/web/src/app/api/og/route.tsx:54`.
**What:** `next/og` accepts custom fonts via `fonts` prop. Currently relies on the platform's default sans-serif, which can change between renderers (Vercel/standalone/serverless). For a curated gallery brand identity, controlling the OG font matters.
**Recommendation:** Bundle a small variable font subset (e.g., Inter or the brand's chosen typeface) and pass via `fonts: [...]`. This is also called out in the deferred-backlog as `PERF-UX-02 variable font` — concrete UX gain on social previews.
**Severity:** LOW.

### DSGN8F-04 — Topic OG card: Korean topic labels would clip at `MAX_TOPIC_LABEL_LENGTH = 100` characters
**Where:** `apps/web/src/app/api/og/route.tsx:9, 14`.
**What:** 100 chars × 80px font-size in the OG image likely cause layout overflow. The `clampDisplayText` helper trims to char length but doesn't measure pixel width. For wide CJK glyphs at 80px, a 30-char Korean label can already exceed the 800px max-width.
**Recommendation:** Measure-based fitting via `next/og` autoshrink, OR a tighter cap (e.g., 30) for the OG title specifically.
**Severity:** LOW.

### DSGN8F-05 — All public pages emit JSON-LD `<script>` even on `noindex` filtered views
**Where:** `apps/web/src/app/[locale]/(public)/{page,[topic]/page}.tsx`.
**What:** When `?tags=...` is present and `robots = { index: false, follow: true }`, the `<script type="application/ld+json">` is still rendered. For users — invisible. For Lighthouse / pagespeed audits — wasted DOM and bandwidth.
**Recommendation:** Skip the JSON-LD block when `noindex`. (Same as Perf reviewer P8F-08.)
**Severity:** LOW.

## Net summary

- No UI/UX defects of consequence; the surface is mature.
- Two cosmetic items (DSGN8F-01 Korean uppercase, DSGN8F-04 OG label clip) and one wasted-payload item (DSGN8F-05) worth bundling into the cycle's hygiene plan.

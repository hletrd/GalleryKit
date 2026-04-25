# Security Reviewer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
Continued audit of admin-controlled string surfaces persisted to DB and re-rendered to public users (continuation of C3L-SEC-01 / C4L-SEC-01 / C5L-SEC-01).

## New findings

### C6L-SEC-01 — `seo_title` / `seo_description` / `seo_nav_title` / `seo_author` permit Unicode bidi/invisible formatting characters [LOW] [Medium confidence]

**Files:**
- `apps/web/src/app/actions/seo.ts:75-101`
- `apps/web/src/lib/gallery-config-shared.ts:25-32` (key list)
- Renderers: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/lib/data.ts`.

**Why a problem.** The Unicode-formatting hardening lineage closed bidi/invisible-char rejection on every other admin-controlled persistent string surface (CSV C7R-RPL-11/C8R-RPL-01, `topic.alias` C3L-SEC-01, `tag.name` C4L-SEC-01, `topic.label`/`image.title`/`image.description` C5L-SEC-01). The four free-form SEO settings are the lone remaining gap — and arguably the most visible surface of all because they render into every public page's `<title>`, `<meta description>`, `<meta og:*>`, the OG image SVG, and browser-tab/bookmark text.

**Concrete failure scenario.** Multi-admin deployment (CLAUDE.md documents any admin can edit SEO settings — no role separation). A junior admin sets `seo_title = "MyGallery‮.gpj.cetbevol"` (RLO embedded). Every public page now ships an HTML title whose visual rendering in browser tabs, bookmarks, SERPs, and OG card previews reads `MyGallery.evolbtec.jpg.` — a deceptive filename-style title.

**Suggested fix.** Apply `UNICODE_FORMAT_CHARS.test(value)` rejection (preferably via a new `containsUnicodeFormatting` helper) to the four free-form SEO string keys. Skip `seo_locale` (already constrained by `normalizeOpenGraphLocale`) and `seo_og_image_url` (already URL-validated).

**Confidence rationale.** Medium because React HTML-escapes `<>&"'` (no XSS path) and the deployment topology is single-admin (narrow exploit window), but severity matches the C3L/C4L/C5L lineage exactly.

## Cross-agent agreement
Overlaps with critic (piecemeal continuation), code-reviewer (parity), test-engineer (coverage), architect (shared helper), document-specialist (CLAUDE.md update).

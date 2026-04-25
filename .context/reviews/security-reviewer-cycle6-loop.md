# Security Reviewer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- Continued audit of admin-controlled string surfaces persisted to DB and re-rendered to public users (continuation of C3L-SEC-01 / C4L-SEC-01 / C5L-SEC-01).
- `apps/web/src/app/actions/seo.ts` (`updateSeoSettings`) — the one remaining admin string surface that reaches public HTML head + OG cards on every page.
- `apps/web/src/app/actions/settings.ts` — confirmed all GALLERY_SETTING_KEYS are numeric/boolean (no string vector); no finding.

## New findings

### C6L-SEC-01 — `seo_title` / `seo_description` / `seo_nav_title` / `seo_author` permit Unicode bidi/invisible formatting characters [LOW] [Medium confidence]

**Files / regions:**
- `apps/web/src/app/actions/seo.ts:75-101` (`updateSeoSettings` — sanitizes only via `stripControlChars`, length-checks, and OG-image URL validation; never calls `UNICODE_FORMAT_CHARS.test(...)`).
- `apps/web/src/lib/gallery-config-shared.ts:25-32` (key list).
- Renderers consuming the values: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx` (HTML `<title>`, `<meta name="description">`, `<meta property="og:*">`), `apps/web/src/app/api/og/route.tsx` (OG image text), `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/lib/data.ts`.

**Why a problem.** The Unicode-formatting hardening lineage closed bidi/invisible-char rejection on every other admin-controlled persistent string surface that reaches end users:
- CSV export (C7R-RPL-11 / C8R-RPL-01) ✅
- `topic.alias` (C3L-SEC-01) ✅
- `tag.name` (C4L-SEC-01) ✅
- `topic.label`, `image.title`, `image.description` (C5L-SEC-01) ✅

The *six* SEO settings keys are the lone remaining gap. They are arguably the **most visible** surface of all because:
1. They render into every public page's `<title>`, `<meta name="description">`, and `<meta property="og:title|og:description|og:site_name">` tags.
2. Search-engine result snippets and social-card link previews (Slack/Discord/Twitter/iMessage) display them verbatim with the visual reordering applied.
3. The `seo_nav_title` shows up in browser tabs, browser history, and bookmark titles.
4. The OG image route (`/api/og`) renders `seo_title` and `seo_author` into an SVG-like text path; Trojan-Source-style RLO would visibly reorder the rendered glyphs.

The earlier cycle 5 aggregate (line 31 of `_aggregate-cycle5-rpl.md`) tagged `admin_settings`/`seo` as "intentionally permissive" because their values "are intentionally permissive (site title, footer)". That conclusion conflated `GALLERY_SETTING_KEYS` (which is purely numeric/boolean — `image_quality_*`, `image_sizes`, `strip_gps_on_upload` — verified in `gallery-config-shared.ts:10-19`) with `SEO_SETTING_KEYS` (six free-form short strings that reach public HTML head). The numeric ones obviously have no Unicode-formatting vector; the SEO strings do.

**Concrete failure scenario.** A multi-admin deployment (CLAUDE.md documents that *any* admin can edit SEO settings — there is no role separation): a junior admin sets `seo_title = "MyGallery‮.gpj.cetbevol"` (RLO embedded). Every public page now ships an HTML `<title>` whose visual rendering in browser tabs, bookmarks, search-engine SERPs, and OG card previews reads `MyGallery.evolbtec.jpg.` — a deceptive filename-style title. Same applies to `seo_description` (search snippet manipulation), `seo_author` (forged author attribution in OG cards), and `seo_nav_title` (browser-chrome spoofing).

**Suggested fix.** Apply `UNICODE_FORMAT_CHARS.test(value)` rejection to the four free-form SEO string keys (`seo_title`, `seo_description`, `seo_nav_title`, `seo_author`) before the existing length checks. Skip `seo_locale` (already constrained by `normalizeOpenGraphLocale`) and `seo_og_image_url` (already URL-validated). Return `t('seoTitleInvalid')` / `seoDescriptionInvalid` / `seoNavTitleInvalid` / `seoAuthorInvalid` (new i18n keys mirroring the existing `seoTitleTooLong` / `seoDescriptionTooLong` / `seoNavTitleTooLong` / `seoAuthorTooLong` pattern).

**Confidence rationale.** Medium because:
- React HTML-escapes `<>&"'` so XSS is not on the table; the impact is purely visual spoofing of admin-rendered chrome and SEO/OG previews.
- The deployment topology is single-admin (this gallery), so the practical exploit window is narrow.
- However, severity matches the C3L/C4L/C5L lineage exactly, and consistency-with-policy is itself a security property.

## Out of scope / no new findings
- `GALLERY_SETTING_KEYS` (settings.ts) — all six values are numeric quality/size or boolean strip-GPS; no Unicode-formatting vector. No change.
- `admin_users.username` is regex-bounded to `^[a-zA-Z0-9_-]+$` — no parity gap.
- `sharedGroups` table has only `key` (base56 generated server-side), `view_count`, `expires_at`. No admin-controlled string field.
- `images.user_filename` is constrained by upload validation (length, byte cap) and never appears in public selects.
- `images.title` / `images.description` / `topic.label` / `topic.alias` / `tag.name` are all already covered by C3L-SEC-01 / C4L-SEC-01 / C5L-SEC-01.

## Cross-agent agreement
Expected to overlap with critic (piecemeal-application thread continuation), code-reviewer (parity), test-engineer (coverage), architect (shared helper), document-specialist (CLAUDE.md update).

# Security Reviewer — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- Admin-controlled string surfaces persisted to DB and rendered back to admins or public users.
- Server actions in `apps/web/src/app/actions/{topics,images,admin-users,settings,seo,tags,public}.ts`.
- `apps/web/src/lib/validation.ts` (`UNICODE_FORMAT_CHARS`, `isValidTopicAlias`, `isValidTagName`).
- `apps/web/src/lib/sanitize.ts` (`stripControlChars`).
- DB schema `apps/web/src/db/schema.ts` (`images.title`, `images.description`, `topics.label`, `images.user_filename`, `admin_settings.value`).

## New findings

### C5L-SEC-01 — Admin-controlled `topics.label`, `images.title`, `images.description` permit Unicode bidi/invisible formatting characters [LOW] [Medium confidence]

**Files / regions:**
- `apps/web/src/app/actions/topics.ts:73-76, 170-175` (createTopic / updateTopic — `label`)
- `apps/web/src/app/actions/images.ts:642-707` (`updateImageMetadata` — `title`/`description`)

**Why a problem.** `UNICODE_FORMAT_CHARS` was introduced to close the parity gap for CSV export (C7R-RPL-11 / C8R-RPL-01), topic aliases (C3L-SEC-01), and tag names (C4L-SEC-01). The same admin-rendered surfaces — `topics.label` (admin categories table, public masonry section header, OG image, navigation), `images.title` and `images.description` (admin image manager, public photo viewer, info bottom sheet, lightbox, OG image, OEmbed/SEO description, EXIF panel) — only `stripControlChars` the input. They do **not** reject Unicode bidi overrides (U+202A-202E LRE/RLE/PDF/LRO/RLO and U+2066-2069 LRI/RLI/FSI/PDI) or zero-width/invisible formatting characters (U+200B-200F, U+2060, U+FEFF, U+180E, U+FFF9-FFFB). React HTML-escapes `<>&"'` but does NOT strip these characters; the visual reordering / spoofing surface that C3L/C4L closed for aliases/tags is still open for the much more visible image and topic labels.

**Concrete failure scenario.** A junior admin (multi-admin deployment — `CLAUDE.md` documents that *any* admin can set image titles) saves an image title `Photo by Alice‮.gpj` (RLO embedded). The admin image-manager table, public photo viewer header, OG card, and SEO description display the spoofed visual order. Same applies to a topic label `2026‮tcejorp ` rendering in the global navigation.

**Suggested fix.**
1. Apply `UNICODE_FORMAT_CHARS.test(value)` rejection (matching `isValidTopicAlias` / `isValidTagName` policy) to `topics.label` in `createTopic` / `updateTopic`, returning `t('invalidLabel')`.
2. Apply the same rejection to `images.title` and `images.description` in `updateImageMetadata`, returning `t('invalidTitle')` / `t('invalidDescription')`.
3. Add validation-test coverage in `images-actions.test.ts` / `topics-actions.test.ts` for one bidi and one zero-width character per surface.
4. Optionally extract a reusable `containsUnicodeFormatting(s)` helper from `validation.ts` if duplication grows.

**Confidence rationale.** Medium because the existing CSP, React HTML-escaping, and `nosniff` headers already prevent script execution; the impact is purely visual spoofing of admin / public UI strings and SEO/OG previews. Same severity tier as C3L-SEC-01 / C4L-SEC-01.

## Out of scope / no new findings
- `admin_settings.value` is `text` and intentionally accepts free-form locale strings (site title, footer); rejecting Unicode formatting could break legitimate workflows. No change recommended.
- `admin_users.username` is regex-bounded to `^[a-zA-Z0-9_-]+$` — no parity gap.
- `images.filename_*` are server-generated UUIDs.
- `images.user_filename` is constrained by upload validation (length, byte cap) and never appears in public selects.

## Cross-agent agreement
Expected to overlap with code-reviewer (parity), critic (piecemeal-application), test-engineer (coverage), architect (shared helper), document-specialist (CLAUDE.md update).

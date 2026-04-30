# Architect review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc`
- Lens: architectural cohesion, single-source-of-truth invariants, future-evolution friction.

## Architectural state

### Helper consolidation (post cycle 2)

Two single-source-of-truth helpers now own the cross-surface invariants:

1. **`humanizeTagLabel(name) → name.replace(/_/g, ' ')`** in `apps/web/src/lib/photo-title.ts`.
   Visible UI consumers: `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `home-client.tsx`, `tag-filter.tsx`.
   Indirect consumers via `getPhotoDisplayTitle` / `getPhotoDisplayTitleFromTagNames` / `getConcisePhotoAltText`: alt text, JSON-LD `name`, document title, masonry card titles.
2. **`buildHreflangAlternates(baseUrl, path) → Record<locale, url>`** in `apps/web/src/lib/locale-path.ts`.
   Consumers: `[locale]/layout.tsx`, `[locale]/(public)/page.tsx`, `[locale]/(public)/[topic]/page.tsx`, `[locale]/(public)/p/[id]/page.tsx`.

Both are documented (JSDoc) with the cross-cycle ID references (`AGG1L-LOW-01`, `AGG1L-LOW-04`, `AGG2L-LOW-01`, `AGG2L-LOW-02`, plan IDs).

### Test seatbelts

Mirrors the existing convention (`check-action-origin.test.ts`, `check-api-auth.test.ts`):
- `tag-label-consolidation.test.ts` scans the consumer files at source-text level, asserting both presence-of-import and absence-of-raw-pattern.

### Forward-compat

Adding a new locale to `LOCALES` (e.g. `'ja'`) now:
- Extends every hreflang alternate-language map automatically.
- Extends `getOpenGraphLocale` only after a manual addition to `OPEN_GRAPH_LOCALE_BY_LOCALE`.

The hreflang map is fully forward-compatible. The OG-locale map still requires a manual update — but that's the right boundary because OG-locale has BCP-47 conventions (`en_US` vs `en_GB`, `ko_KR` vs `ko_KP`) that aren't safely auto-derivable from a route locale.

### Architectural integrity

- No new circular import.
- No new file-system, network, or DB call shape introduced by the diff.
- The metadata generation order (locale → seo settings → og locale → hreflang map → page-specific OG image) is consistent across all four emitters.

## Findings

**No new MEDIUM or HIGH architect findings.**

### Tracking-only architectural notes

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **A3L-INFO-01** | The fixture-test list of metadata emitters is hard-coded. Adding a fifth emitter (e.g. an `/about` page) without updating the fixture would mean that emitter goes uncovered. The architectural bet here is "we don't add metadata emitters often", which is reasonable for this codebase. Tracking-only. | LOW (tracking) | High |
| **A3L-INFO-02** | The OG-locale map (`OPEN_GRAPH_LOCALE_BY_LOCALE`) and the hreflang locale map (`LOCALES`) live in separate modules but share the same locale set. A future "add `'ja'` locale" task requires updating both. Could be unified into a single locale-record object that owns both fields, but the friction is low (adding a locale is a planned, not ad-hoc, task) and the indirection cost would not be worth it. Tracking-only. | LOW (tracking) | Medium |

## Verdict

Cycle 3 fresh architect review: zero MEDIUM/HIGH, two informational LOW notes (both tracking-only). The consolidation work is architecturally sound and properly seatbelted. Convergence indicated.

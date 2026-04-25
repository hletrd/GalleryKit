# Architect — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Module boundaries, data-flow, queueing, storage abstraction, auth seams, dependency surface.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Architectural delta

The 11 commits are presentational. Module boundaries, queues, storage, and auth seams are unchanged. Two architectural points worth recording:

### A1-LOW-01 — `LOCALES`-aware iteration is missing in hreflang generation (LOW, High confidence)

**File/region:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:95-99`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:91-95`.

**Why a problem (architecture):** The `alternateLanguages` map hard-codes `en`/`ko`/`x-default`. The single source of truth is `LOCALES` in `apps/web/src/lib/constants.ts`. Two pages now duplicate the locale list; if a third locale is added, three places must change in lockstep (constants + two pages, plus the OG locale map in `locale-path.ts:45-48`).

**Failure scenario:** A future PR adds `ja` to `LOCALES`. `getOpenGraphLocale('ja', ...)` returns `undefined` (because `OPEN_GRAPH_LOCALE_BY_LOCALE.ja` is not defined). Type-system catches this. But the hreflang alternate map silently omits `ja` from `alternateLanguages`, and Google indexes `/ja/...` as a rogue locale not in the alternate map.

**Suggested fix:** Extract a helper:

```ts
// in locale-path.ts
export function buildHreflangAlternates(baseUrl: string, path: string): Record<string, string> {
  const alts: Record<string, string> = {};
  for (const locale of LOCALES) {
    alts[locale] = localizeUrl(baseUrl, locale, path);
  }
  alts['x-default'] = localizeUrl(baseUrl, DEFAULT_LOCALE, path);
  return alts;
}
```

Replace the inline maps in topic and photo pages with `buildHreflangAlternates(seo.url, ...)`.

**Confidence:** High.

### A1-LOW-02 — `getOpenGraphLocale` semantics shift makes admin OG-locale setting "fallback only" (LOW, Medium confidence)

**File/region:** `apps/web/src/lib/locale-path.ts:57-69`.

**Why architectural:** The `seo.locale` admin-configurable field's semantics changed. It is no longer the *primary* OG locale but a fallback for unsupported route locales. Yet:

- Database column documentation, settings page UX, and any developer-facing docs still imply it's the OG locale source.
- This couples the SEO settings model semantics to the supported `LOCALES` list — a non-obvious contract.

**Failure scenario:** A new dev adds an admin OG-locale validator that rejects values not in `OPEN_GRAPH_LOCALE_BY_LOCALE`. Now the *fallback* (which is meaningful only for routes outside `LOCALES`) is restricted to be in `LOCALES`. Subtle.

**Suggested fix:** Document the field semantics in the schema (`apps/web/src/db/schema.ts`) or in `getOpenGraphLocale`'s JSDoc. Optional.

**Confidence:** Medium.

### A1-INFO-01 — `not-found.tsx` recreates the layout shell (informational)

**File/region:** `apps/web/src/app/[locale]/not-found.tsx:19-53`.

**Why informational:** Next.js architectural constraint — `not-found.tsx` runs outside its segment's `layout.tsx`. The duplication is by design, not a refactor opportunity.

**Confidence:** High.

### A1-INFO-02 — Underscore normalization scattered across modules (informational)

**File/region:** `photo-title.ts`, `home-client.tsx`, `tag-filter.tsx`.

**Why informational:** Same single-source-of-truth concern as CR1-LOW-01. The architectural fix is to make `getPhotoDisplayTitleFromTagNames` the consolidation point. See `code-reviewer.md`.

**Confidence:** High.

## Cross-module checks

- **`@/lib/locale-path`** is consumed by `actions/auth.ts`, `app/[locale]/(public)/*`, `components/*`. Boundary clean.
- **`@/lib/photo-title`** is consumed by `components/home-client.tsx`, `components/photo-viewer.tsx`, `app/[locale]/(public)/*`. Boundary clean. The underscore-normalization should live here.
- **`@/components/nav` and `@/components/footer`** are server components imported by both `(public)/layout.tsx` and `not-found.tsx`. Reuse path is correct.
- **`@/lib/constants`** holds `LOCALES`. Hreflang helper should consume it.

## Confidence

High.

## Recommendation

Two small architectural cleanups: extract `buildHreflangAlternates` and consolidate underscore normalization in `getPhotoDisplayTitleFromTagNames`.

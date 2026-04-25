# Tracer — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

Cross-file data flow, lifecycle, callsite invariants.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Trace targets

### 1. Underscore-normalization data flow

Data path: DB `tags.name` → `getTagsCached(...)` → server-component prop → `<TagFilter tags={...} />` → `displayName(tag.name)`.

- `apps/web/src/db/schema.ts` — `tags.name` column (no transform on read).
- `apps/web/src/lib/data.ts` — `getTagsCached` returns the raw `name`.
- `apps/web/src/components/tag-filter.tsx:61` — `displayName(name)` strips `_`.
- `apps/web/src/components/home-client.tsx:122` — `(match?.name ?? tag).replace(/_/g, ' ')` for active-filter chip.
- `apps/web/src/components/home-client.tsx:160` — `.replace(/_/g, ' ')` chained after `getPhotoDisplayTitleFromTagNames`.
- `apps/web/src/lib/photo-title.ts:78` — `.replace(/_/g, ' ')` inside `getConcisePhotoAltText`.
- **`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:188`** — `getPhotoDisplayTitleFromTagNames(img, ...)` for JSON-LD `name` — **no underscore normalization applied.**
- **`apps/web/src/app/[locale]/(public)/page.tsx:161`** — same — **no underscore normalization applied.**

**Trace finding:** The display-side normalization is applied inconsistently across consumers of `getPhotoDisplayTitleFromTagNames`. JSON-LD emits raw underscores; visible UI emits humanized. Same model, different output.

### 2. `getOpenGraphLocale` flow

Data path: route locale (param) + admin-configured `seo.locale` → metadata.

- `apps/web/src/lib/locale-path.ts:57-69` — new logic: route locale wins on supported, configured wins on unsupported.
- 6 call sites (verified via grep): `(public)/page.tsx`, `(public)/[topic]/page.tsx`, `(public)/p/[id]/page.tsx`, `(public)/s/[key]/page.tsx`, `(public)/g/[key]/page.tsx`, `[locale]/layout.tsx`. All pass `(locale, seo.locale)` consistently.

**Trace finding:** Behavior is uniform across all 6 metadata producers. **No inconsistency.**

### 3. Skip-link to `<main>` flow

- `apps/web/src/app/[locale]/(public)/layout.tsx:9-18` — skip link `<a href="#main-content">` and `<main id="main-content" tabIndex={-1}>`.
- `apps/web/src/app/[locale]/not-found.tsx:21-29` — duplicates the same shell. `tabIndex={-1}`.
- No other `<main id="main-content">` instances.

**Trace finding:** Two `<main>` instances, both correctly tagged. **Consistent.**

### 4. hreflang `alternateLanguages` flow

- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:95-99` — inline map.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:91-95` — inline map.
- `apps/web/src/app/[locale]/(public)/page.tsx`, `[locale]/layout.tsx`, `s/[key]`, `g/[key]` — **no `alternateLanguages` block.**

**Trace finding:** Hreflang alternates are added on `[topic]` and `p/[id]` only. The home page (`(public)/page.tsx`), layout-level metadata, and shared pages (`s/[key]`, `g/[key]`) are missing the same alternates. The home page in particular has higher SEO weight and would benefit from the same alternates.

### 5. Login form `showPassword` lifecycle

- `apps/web/src/app/[locale]/admin/login-form.tsx:26` — `useState(false)`.
- Toggle button at line 81-94 calls `setShowPassword(prev => !prev)`.
- Input `type` at line 73 reads `showPassword ? 'text' : 'password'`.
- No reset on submit or unmount; state lives only for the component lifetime.

**Trace finding:** Lifecycle correct. Native browsers preserve input value across `type` flips. No leaks.

### 6. `useColumnCount` vs CSS columns

- `apps/web/src/components/home-client.tsx:18-43` — JS thresholds `<640→1, <768→2, <1280→3, ≥1280→4`.
- `apps/web/src/components/home-client.tsx:155` — CSS classes `columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`.

**Tailwind defaults:** `sm: 640px`, `md: 768px`, `xl: 1280px`, `2xl: 1536px`.

**Trace finding:** JS misses the `≥1536→5` branch — already flagged by perf and critic. **High-confidence inconsistency.**

## Findings

**Zero new MEDIUM or HIGH findings.**

### LOW (traced)

- **TR1-LOW-01** — JSON-LD `name` for tag-derived photo titles emits raw underscores while visible UI normalizes them. (Cross-references CR1-LOW-01.) **Confidence: High.**
- **TR1-LOW-02** — `useColumnCount` thresholds don't include the new 2xl breakpoint. (Cross-references P1-LOW-02.) **Confidence: High.**
- **TR1-LOW-03** — hreflang alternates are emitted on `[topic]` and `p/[id]` but not on home `(public)/page.tsx`. **Confidence: High.**

## Confidence

High.

## Recommendation

The hreflang gap on the home page (TR1-LOW-03) is a true functional gap that the cycle's commits didn't fix. Worth scheduling alongside the other consolidation work.

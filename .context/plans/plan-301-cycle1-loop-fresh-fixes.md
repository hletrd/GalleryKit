# Plan 301 — Cycle 1 loop fresh fixes (2026-04-25)

## Status: DONE

- 301-A — DONE (commit `3dd50cd`)
- 301-B — DONE (commit `4026ffc`)
- 301-C — DONE (commit `21bedb8`, includes 301-D test additions)
- 301-D — DONE (folded into 301-A and 301-C commits via expanded vitest cases)

Quality gates: lint, lint:api-auth, lint:action-origin, vitest (60 files / 402 tests), tsc, build all green.

## Source

`_aggregate-cycle1-loop-2026-04-25.md` cross-agent LOW findings, top-4 highest-confidence + cross-reviewer-agreement items.

## In-scope items

### 301-A — Consolidate underscore normalization (AGG1L-LOW-01)

**Files:**
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/tag-filter.tsx`

**Change:** Move the `.replace(/_/g, ' ')` step into `getPhotoDisplayTitleFromTagNames` so it's applied once at the helper level. Drop the inline `.replace` calls in `home-client.tsx:122,160` and `tag-filter.tsx:61`. The JSON-LD `name` fields in `(public)/page.tsx:161` and `(public)/[topic]/page.tsx:188` also benefit because they go through the same helper.

`getConcisePhotoAltText` already includes the replace; after consolidation, the chain becomes pure (no double-replace).

`tag-filter.tsx`'s `displayName` is for raw `tag.name` not coming through the helper — keep it as a thin local helper but switch it to call a new exported `humanizeTagLabel(name)` from `photo-title.ts` to share the regex.

**Definition of done:**
- Single source of truth: `humanizeTagLabel` in `photo-title.ts` (or equivalent).
- All four callers consume the helper.
- New unit test (AGG1L-LOW-12) asserts underscore normalization through both `getPhotoDisplayTitleFromTagNames` and `getConcisePhotoAltText`.

### 301-B — Mirror `2xl:columns-5` in `useColumnCount` (AGG1L-LOW-02)

**File:** `apps/web/src/components/home-client.tsx`

**Change:** Update `useColumnCount` to add the new threshold:

```ts
const update = () => {
    const w = window.innerWidth;
    if (w < 640) setCount(1);
    else if (w < 768) setCount(2);
    else if (w < 1280) setCount(3);
    else if (w < 1536) setCount(4);
    else setCount(5);
};
```

This ensures the 5th above-the-fold image at 2xl receives `loading="eager"` and `fetchPriority="high"` — preserving LCP on widescreen.

**Definition of done:**
- `useColumnCount` returns 5 at `>= 1536px`.
- 5th masonry card at 2xl gets `eager`+`high` priority.

### 301-C — Generate hreflang map from `LOCALES` + add to home (AGG1L-LOW-04)

**Files:**
- `apps/web/src/lib/locale-path.ts` — add `buildHreflangAlternates(baseUrl, path)` helper.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — replace inline map.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — replace inline map.
- `apps/web/src/app/[locale]/(public)/page.tsx` — add hreflang alternates (currently absent).

**Change:** Add a small helper that iterates `LOCALES`:

```ts
export function buildHreflangAlternates(baseUrl: string, path: string): Record<string, string> {
    const alts: Record<string, string> = {};
    for (const locale of LOCALES) {
        alts[locale] = localizeUrl(baseUrl, locale, path);
    }
    alts['x-default'] = localizeUrl(baseUrl, DEFAULT_LOCALE, path);
    return alts;
}
```

Replace inline maps in `[topic]` and `p/[id]`, and add a fresh `alternates: { canonical, languages: buildHreflangAlternates(seo.url, '/') }` block to the home page metadata.

**Definition of done:**
- Helper extracted, exported, unit-tested for `en`/`ko` + `x-default`.
- All three pages (home, topic, photo) emit hreflang alternates.
- Forward-compat: adding a new locale to `LOCALES` automatically adds it to alternates.

### 301-D — Unit test underscore normalization (AGG1L-LOW-12)

**File:** `apps/web/src/__tests__/photo-title.test.ts`

**Change:** Add tests for the new branch:

```ts
it('normalizes underscores in alt text and display title', () => {
    expect(getConcisePhotoAltText({ title: 'IMG_0001.JPG', tag_names: 'Music_Festival,Night_Sky' }, 'Photo'))
        .toBe('Music Festival, Night Sky');
    expect(getPhotoDisplayTitleFromTagNames({ title: 'IMG_0001.JPG', tag_names: 'Music_Festival,Night_Sky' }, 'Photo 1'))
        .toBe('#Music Festival #Night Sky');
});
```

After 301-A consolidation, the second assertion becomes truthful (currently it would be `#Music_Festival #Night_Sky`).

**Definition of done:**
- Two new assertions pass.
- 60-file vitest suite stays green.

## Out-of-scope (deferred to plan-302)

- AGG1L-LOW-03 (shimmer dark mode + animation never stops) — design polish, schedule next cycle.
- AGG1L-LOW-05 (`focus-visible:ring-*` vs outline-* policy) — needs design decision.
- AGG1L-LOW-06 (login double-cuing) — needs AT verification.
- AGG1L-LOW-07 (toolbar button heights) — design polish.
- AGG1L-LOW-08 (search input vs close size) — design polish.
- AGG1L-LOW-09 (landscape mobile photo container) — debugger H7 partially debunked, low impact.
- AGG1L-LOW-10 (nav link hierarchy regression) — needs visual review.
- AGG1L-LOW-11 (admin OG locale dead silently) — UX/docs polish.
- AGG1L-LOW-13 (e2e password toggle) — Playwright suite addition.
- AGG1L-LOW-14 (browser save-password prompt) — UX polish.
- AGG1L-LOW-15 (F-* policy doc) — docs.
- AGG1L-LOW-16 (touch-target gaps) — additional UI fix wave.

## Risk assessment

- **301-A** is a refactor with test coverage. Low risk.
- **301-B** is a 4-line JS change. Low risk; verified via column-count test pattern.
- **301-C** is a metadata-only change. Forward-compat helper. Low risk.
- **301-D** is test addition. No production risk.

## Estimated impact

- Improves visible polish on 2xl widescreens (LCP).
- Improves SEO surface across all public pages (hreflang).
- Improves consistency between user-visible label and JSON-LD/SEO label.
- Adds regression seatbelt.

## Order of operations

1. 301-A: refactor `photo-title.ts`, callers, and add unit tests.
2. 301-D: extend tests (already covered as part of 301-A's DOD).
3. 301-B: column-count mirror.
4. 301-C: hreflang helper + apply to all three pages.
5. Run all gates locally before commit.
6. Fine-grained commits, one per A/B/C task.

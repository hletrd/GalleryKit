# Critic review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc`
- Lens: pessimistic-reviewer / "what could still go wrong" pass after cycle 2's consolidation work.

## What I tried to break

### Probe 1: Could the fixture test pass while the runtime UI still bypasses the helper?

The fixture rejects:
- `#{tag.name}` literal anywhere in `photo-viewer.tsx` / `info-bottom-sheet.tsx`.
- `#{tag.name}` JSX text wrapped in `>` `<` markers (also matched by the broader regex above).
- The presence of `import { humanizeTagLabel } from '@/lib/photo-title'` is required.

Could a contributor render `#{tag.slug}` (a synonym field that *also* contains underscores)?
- Looking at `image-types.ts`: `TagInfo.slug` exists. A future contributor pasting `#{tag.slug}` would slip past the fixture (regex looks for `\.name` specifically).
- However, slugs are typically lowercase + dashed by convention; a tag slug like `music-festival` would render with a dash, not an underscore, so the visible drift wouldn't be the same as `Music_Festival`.
- The drift class is closed; tightening the fixture to also reject `#{tag.slug}` would over-reach into legitimate uses elsewhere.
- **Verdict**: not actionable, not a real regression vector. LOW tracking-only.

### Probe 2: Could a contributor add a fifth metadata emitter that does not use the builder?

The fixture's `HREFLANG_EMITTER_FILES` list is hard-coded:
- `src/app/[locale]/layout.tsx`
- `src/app/[locale]/(public)/page.tsx`
- `src/app/[locale]/(public)/[topic]/page.tsx`
- `src/app/[locale]/(public)/p/[id]/page.tsx`

A new public route under `(public)/` (or, more concerning, under `[locale]/` outside `(public)/`) that emitted `Metadata.alternates.languages` would not be covered by the fixture.
- Severity: LOW. The existing public surface is feature-complete (home, topic, photo, root layout). Adding a new metadata emitter without using the builder is a future-developer mistake, not a current bug.
- Mitigation: leaving a comment in the fixture pointing reviewers to add new files to the list. Optional; the AGENTS.md / CLAUDE.md docs already point at the builder helper.

### Probe 3: Does `buildHreflangAlternates` produce stable output across cycles?

Looking at `locale-path.ts:88`:
```ts
export function buildHreflangAlternates(baseUrl: string, path: string): Record<string, string> {
    const alternates: Record<string, string> = {};
    for (const locale of LOCALES) {
        alternates[locale] = localizeUrl(baseUrl, locale, path);
    }
    alternates['x-default'] = localizeUrl(baseUrl, DEFAULT_LOCALE, path);
    return alternates;
}
```
- The helper builds a fresh object each call; not a memoized return. For Next.js metadata, this is invoked once per request; no impact.
- `LOCALES` is `['en', 'ko'] as const`; iteration order is deterministic.
- `x-default` always overrides any locale-key collision (impossible today; `x-default` is not a member of `LOCALES`).

### Probe 4: Could the underscored chip text drift via a different code path?

Searched for all visible tag-label render sites:
- `photo-viewer.tsx:407` — uses helper.
- `info-bottom-sheet.tsx:248` — uses helper.
- `home-client.tsx:132` — uses helper inside `displayTags` memo.
- `tag-filter.tsx:98` — uses helper aliased as `displayName`.
- `tag-manager.tsx:106` — admin tag table, intentionally raw (slug authoring surface).
- `tag-input.tsx:214` — admin tag autocomplete dropdown, intentionally raw.

The admin surfaces are the only place a contributor would see `Music_Festival` rendered raw, and that's by design — admins author canonical slugs.

### Probe 5: Does the photo-page metadata's `keywords` field still expose underscored tag names?

`p/[id]/page.tsx:65`:
```ts
keywords = image.tags.map((t: TagInfo) => t.name);
```
- Keywords-meta is an SEO field, not a visible UI label. Search engines tokenize it; underscores don't matter.
- Could be argued for symmetry with hreflang, but search-engine tokenizers handle `_` and ` ` similarly and there's no UI surface drift.
- **Verdict**: not actionable. Tracking-only.

### Probe 6: Does the `p/[id]/page.tsx` JSON-LD `keywords: keywords.join(', ')` deserve humanization too?

JSON-LD `keywords` is also SEO-only, never rendered as a chip. Same reasoning as Probe 5. Tracking-only.

## Findings

**No new MEDIUM or HIGH critic findings.**

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **C3L-INFO-01** | Fixture test scope is hard-coded; a fifth public metadata emitter would not be covered. Not a current bug; future-developer mitigation. | LOW (tracking) | High |
| **C3L-INFO-02** | `keywords` meta-tag and JSON-LD `keywords` field on photo pages preserve underscored tag names. SEO-only, no visible UI drift, tokenizers handle `_`. Tracking-only. | LOW (tracking) | Medium |

## Verdict

After probing six failure scenarios, none reveal a new MEDIUM or HIGH regression. The cycle-2 consolidation work is closed and seatbelted. Two LOW informational notes recorded. Convergence indicated.

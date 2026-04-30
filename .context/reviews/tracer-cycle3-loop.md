# Tracer review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc`
- Lens: trace data flows from raw tag names / locale config to user-visible / SEO-visible output, confirm no path bypasses the consolidated helpers.

## Trace 1: Tag name → desktop info-sidebar chip

```
DB.tags.name (raw, may contain `_`)
  → Drizzle ORM .leftJoin(tags) in data.ts:getImageById
  → image.tags: TagInfo[] (passed to PhotoViewer prop)
  → photo-viewer.tsx:393 image.tags.map((tag: TagInfo) => …)
  → photo-viewer.tsx:407 #{humanizeTagLabel(tag.name)}     ← consolidation point
  → React text node (escaped by React)
  → DOM badge text
```
Verified: every step preserves the underscored form until the helper at line 407 normalizes it. No bypass.

## Trace 2: Tag name → mobile bottom-sheet chip

```
DB.tags.name (raw, may contain `_`)
  → image.tags: TagInfo[] (passed to InfoBottomSheet)
  → info-bottom-sheet.tsx:241 image.tags.map((tag: TagInfo) => …)
  → info-bottom-sheet.tsx:248 #{humanizeTagLabel(tag.name)}  ← consolidation point
  → React text node
```
Verified.

## Trace 3: Tag name → masonry card title (home-client)

```
DB.images.title + GROUP_CONCAT(tags.name) → image.tag_names (csv)
  → home-client.tsx:172 getPhotoDisplayTitleFromTagNames(image, fallback)
  → photo-title.ts:67 splits on `,` to TagInfo-shape
  → photo-title.ts:38 / :49 image.tags.map(tag => `#${humanizeTagLabel(tag.name)}`)
  → returned string
  → home-client.tsx <h3 className="…">{displayTitle}</h3>
```
Verified.

## Trace 4: Tag name → JSON-LD `name`

```
home-client gallery JSON-LD path is DIFFERENT — see (public)/page.tsx:166:
  image.slice(0,10).map((img) => ({ name: getPhotoDisplayTitleFromTagNames(img, …) }))
  → photo-title.ts:38/:49 humanizeTagLabel(tag.name)
  → JSON-encoded into <script type="application/ld+json">
```
Verified. Topic page `(public)/[topic]/page.tsx:186` and photo page `p/[id]/page.tsx:147` use the same path.

## Trace 5: Tag name → photo-page metadata `keywords`

```
p/[id]/page.tsx:65:
  keywords = image.tags.map((t: TagInfo) => t.name);
```
**Not humanized** — but this is the SEO `keywords` meta-tag, not a UI surface. Tokenizers handle `_`. Tracking-only.

## Trace 6: Tag name → photo-page JSON-LD `keywords`

```
p/[id]/page.tsx:150:
  const keywords = image.tags?.map((t: TagInfo) => t.name) || [];
  …
  keywords: keywords.join(', '),
```
**Not humanized** — JSON-LD `keywords` is also SEO-only. Tracking-only.

## Trace 7: Locale config → root-layout hreflang map

```
LOCALES = ['en', 'ko'] (constants.ts)
  → buildHreflangAlternates(seo.url, '/')
  → for each locale, alternates[locale] = localizeUrl(seo.url, locale, '/')
  → alternates['x-default'] = localizeUrl(seo.url, DEFAULT_LOCALE, '/')
  → returned as Metadata.alternates.languages in [locale]/layout.tsx:39
```
Verified.

## Trace 8: Locale config → home/topic/photo hreflang maps

Same path as Trace 7; the helper returns the same shape on every emitter. The only difference is the `path` argument:
- home: `'/'`
- topic: `/${topicData.slug}`
- photo: `/p/${id}`
- root layout: `'/'` (this is the page-less default; home overrides on actual home requests)

Verified.

## Trace 9: Could any code path emit raw underscored tag chip text?

I searched for all consumer surfaces:
- ✓ `photo-viewer.tsx:407` — humanized
- ✓ `info-bottom-sheet.tsx:248` — humanized
- ✓ `home-client.tsx:132/172` — humanized via helper
- ✓ `tag-filter.tsx:98` — humanized via helper
- (intentional) `tag-input.tsx:214` — admin slug-form input
- (intentional) `tag-manager.tsx:106` — admin tag table

Every public-facing chip is humanized. No bypass.

## Trace 10: Could any metadata emitter inline an old-shape locale literal?

I searched for `languages\s*:\s*\{`:
- ✓ all four hits are inside `languages: buildHreflangAlternates(...)` calls (no inline literals).
- The fixture seatbelt blocks any future inlining at the four hard-coded files.

## Findings

**No new MEDIUM or HIGH tracer findings.**

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **TR3L-INFO-01** | Photo-page `keywords` meta-tag and JSON-LD `keywords` field still pass raw underscored tag names. SEO-only, no UI surface drift. Tracking-only. | LOW (tracking) | Medium |

## Verdict

Cycle 3 fresh trace: zero MEDIUM/HIGH, one informational LOW (tracking-only). The data flow consolidation is closed. Convergence indicated.

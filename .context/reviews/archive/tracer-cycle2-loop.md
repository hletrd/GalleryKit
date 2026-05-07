# Tracer — Cycle 2 review-plan-fix loop (2026-04-25)

## Lens

Trace the actual user-visible label flow from data layer → component → DOM. Where does the underscore actually get normalized, and where does it leak through?

## Trace 1 — Tag label on the masonry card

`tag.name` (DB) → `getPhotoDisplayTitleFromTagNames` (photo-title.ts) → splits `tag_names`, calls `getPhotoDisplayTitle` → which iterates tags and applies `humanizeTagLabel` per tag → renders `#Music Festival` on the masonry card.

Result: humanized correctly. Gate: `home-client.tsx:172`.

## Trace 2 — Tag label on the tag-filter pill (home page header)

`tag.name` (DB) → `displayTags` memo in `home-client.tsx:130-134` calls `humanizeTagLabel(match?.name ?? tag)` → renders `Music Festival`.

Result: humanized correctly.

## Trace 3 — Tag label on the photo-viewer desktop info-sidebar chip

`image.tags[i].name` (DB) → `photo-viewer.tsx:395` renders `#{tag.name}` directly inside `<Badge>` — **no `humanizeTagLabel`**.

Result: **Bug.** Renders `#Music_Festival`.

## Trace 4 — Tag label on the photo-viewer mobile info-bottom-sheet chip

`image.tags[i].name` (DB) → `info-bottom-sheet.tsx:243` renders `#{tag.name}` directly — **no `humanizeTagLabel`**.

Result: **Bug.** Renders `#Music_Festival`.

## Trace 5 — Tag label in `getConcisePhotoAltText` (alt text)

`tag_names` (DB) → `getPhotoDisplayTitleFromTagNames` → `getPhotoDisplayTitle` (with `humanizeTagLabel`) → strip leading `#`, replace `\s#` with `, ` → `Music Festival, Night Sky`.

Result: humanized correctly.

## Trace 6 — Tag label in JSON-LD `name` on home/topic page

`tag_names` (DB) → `getPhotoDisplayTitleFromTagNames(img, ...)` (called in `(public)/page.tsx:166` and `(public)/[topic]/page.tsx:186`) — applies the helper.

Result: humanized correctly.

## Trace 7 — Tag label in JSON-LD `keywords` on photo page

`image.tags[i].name` (DB) → `(public)/p/[id]/page.tsx:65` — pushes raw `t.name` into `keywords`.

Result: **Inconsistent but defendable.** The JSON-LD `keywords` field is parsed as a comma-separated keyword list. Search engines may legitimately want the raw underscore-bearing slug-style name; humanizing here might lose information. Recommend deferring the decision to the document-specialist lane and keeping behavior unchanged for now.

## Findings recap

The tracer confirms two bugs (Trace 3, Trace 4) and one defensible inconsistency (Trace 7). Cycle-2 fixes should target Trace 3 and Trace 4; defer Trace 7.

## Trace 8 — Hreflang emission for the home URL

Two emitters race for `<link rel="alternate" hreflang="...">`:
- Root layout `generateMetadata` (`[locale]/layout.tsx`) emits `en/ko/x-default` with `x-default → seo.url` (no locale).
- Home page `generateMetadata` (`[locale]/(public)/page.tsx`) emits via helper → `en/ko/x-default` with `x-default → localizeUrl(seo.url, 'en', '/')` (= `…/en`).

Next.js metadata merges by overlaying the page over the layout. The page-level `alternates.languages` wins for the home URL, but the layout-level emission is what ends up on locales/routes that don't override `alternates`. Two surfaces, two `x-default` semantics — this is the architectural drift A2L-LOW-01 captures.

## Confidence

High on Traces 3, 4, 8 (direct source inspection). Medium on Trace 7 (intentional vs accidental — needs document-specialist call).

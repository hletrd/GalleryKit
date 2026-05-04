# Cycle 5 RPF (end-only) — Aggregate Review

## Method

Deep code review focused on professional photographer workflow: import/ingest flow, metadata handling, EXIF display, gallery browsing UX, sharing workflows, organization, search/discovery, download/export, mobile experience, and workflow friction. All relevant source files examined across the component, lib, and route layers. Emphasis on NEW findings not yet discovered in cycles 1-4 RPF.

## Gate baseline

- Prior cycles verified clean gates. This cycle starts from current HEAD.

## Cycles 1-4 RPF carry-forward verification

32 issues fixed across cycles 1-4. All prior cycle fixes verified in code. Focus exclusively on NEW findings.

## Cross-agent agreement (high-signal duplicates)

Single-pass review (no formal agent roster in `.claude/agents/`). Findings validated by cross-referencing multiple file paths and component interactions.

## Findings (severity-sorted)

### HIGH

#### C5-RPF-01 — Shared photo page (`/s/[key]`) missing `reactionsEnabled` and `licensePrices` props

- File: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:113-126`
- Severity: **High** | Confidence: **High**
- **What:** The single-photo share page passes `PhotoViewer` without `reactionsEnabled` or `licensePrices` props. This is the same class of bug as C4-RPF-01 (shared GROUP page), which was fixed in cycle 4. However, the fix was only applied to `/g/[key]` — the `/s/[key]` route was missed. When an admin has reactions enabled or license tiers configured, visitors to single-photo share links cannot react to photos or purchase licenses. The `config` object is already fetched via `getGalleryConfig()` on line 93, but is not passed through.
- **Fix (this cycle):** Pass `reactionsEnabled={config.reactionsEnabled}` and `licensePrices={config.licensePrices}` to the PhotoViewer on the shared photo page.

### MEDIUM

#### C5-RPF-02 — 24 `lrToken` translation keys missing from `ko.json`

- File: `apps/web/messages/ko.json` (missing `lrToken.*` section)
- Consumers: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx` (24 usages)
- Severity: **Medium** | Confidence: **High**
- **What:** The License/Release Token admin page (`tokens-client.tsx`) uses 24 translation keys under the `lrToken` namespace (title, description, generateButton, empty, labelRequired, labelField, labelPlaceholder, createTitle, createDesc, createButton, plaintextTitle, plaintextDesc, plaintextDone, copied, copyFailed, copyAria, revokeTitle, revokeDesc, revokeButton, revokeSuccess, revokeAria, created, lastUsed, expires). These keys exist in `en.json` but are entirely absent from `ko.json`. Korean admin users see raw key paths (e.g., `lrToken.generateButton`) instead of localized text.
- **Fix (this cycle):** Add the complete `lrToken` section to `ko.json` with Korean translations.

#### C5-RPF-03 — Mobile info bottom sheet missing download JPEG button

- File: `apps/web/src/components/info-bottom-sheet.tsx`
- Reference: `apps/web/src/components/photo-viewer.tsx:844-855` (desktop sidebar has download)
- Severity: **Medium** | Confidence: **High**
- **What:** The desktop info sidebar in `photo-viewer.tsx` includes a "Download JPEG" button (`<CardFooter>` with a download link, lines 844-855) for non-paid images. The mobile info bottom sheet (`info-bottom-sheet.tsx`) has no download functionality at all. A photographer sharing a client gallery who browses on mobile cannot download photos from the info view — they must switch to desktop or long-press the image. For a working photographer evaluating photos on a phone during a shoot, this is a meaningful friction point.
- **Fix (this cycle):** Add a download JPEG button to the bottom sheet's expanded content, matching the desktop sidebar's guard logic (hide when `license_tier` is set).
- **Note:** The bottom sheet needs access to `imageSizes` and `licensePrices` (or at minimum `imageSizes`) to construct the download URL. The component currently doesn't receive these props, so they'd need to be threaded through from the parent PhotoViewer.

### LOW

#### C5-RPF-04 — Mobile info bottom sheet missing histogram

- File: `apps/web/src/components/info-bottom-sheet.tsx`
- Reference: `apps/web/src/components/photo-viewer.tsx:806-813` (desktop sidebar has histogram)
- Severity: **Low** | Confidence: **Medium**
- **What:** The desktop sidebar includes a `<Histogram>` component for evaluating tonal distribution. The mobile bottom sheet does not include it. While the histogram requires horizontal space and may not fit well on small screens, it could be shown in the expanded state where there's more room.
- **Defer:** The bottom sheet expanded state has limited width. Adding a histogram would require careful layout work. Low priority since the primary use case (evaluating exposure) is better served on a desktop monitor.
- **Exit:** when mobile-first photography workflow becomes a priority.

#### C5-RPF-05 — `lightgallery-ken-burns` CSS animation keyframes referenced but defined via CSS custom properties (`--kb-start`, `--kb-end`) without a visible `@keyframes` rule in component code

- File: `apps/web/src/components/lightbox.tsx:427` (references `lightbox-ken-burns-0` and `lightbox-ken-burns-1`)
- Severity: **Low** | Confidence: **Medium**
- **What:** The lightbox sets `animation: lightbox-ken-burns-${kenBurnsVariant} ${kenBurnsDuration}` on the img element (line 427) and passes `--kb-start` and `--kb-end` as CSS custom properties (lines 429-430). The `@keyframes` rules must be defined in a global CSS file (likely `globals.css` or similar). If those keyframes reference `var(--kb-start)` and `var(--kb-end)`, the animation works. If they're missing or don't reference the custom properties, the Ken Burns effect silently does nothing during slideshow mode. Without checking the global CSS, confidence is medium.
- **Defer:** Requires checking the global CSS file to confirm the keyframes exist and correctly reference the custom properties. The slideshow feature works or silently falls back to no animation — no data loss or UX breakage.
- **Exit:** next slideshow feature polish pass.

#### C5-RPF-06 — Shared group grid images lack `aspect-ratio` style for layout stability (CLS)

- File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:180-211`
- Reference: `apps/web/src/components/home-client.tsx:198-201` (home grid sets `aspectRatio`)
- Severity: **Low** | Confidence: **High**
- **What:** The home page masonry grid sets `style={{ aspectRatio: \`${image.width} / ${image.height}\` }}` on each card (line 199), which prevents Cumulative Layout Shift (CLS) by reserving the correct space before the image loads. The shared group grid (`g/[key]/page.tsx`) does NOT set `aspect-ratio` on its cards — the images use `className="w-full h-auto"` which means the layout shifts when each lazy-loaded image finishes loading. For a shared group with 20+ photos, this produces visible content jumping as the user scrolls.
- **Defer:** Cosmetic perf issue; shared group pages are typically small. Low CLS impact.
- **Exit:** at next shared-group polish pass.

## Summary

4 actionable findings (1 HIGH, 2 MEDIUM, 3 LOW). The HIGH finding (C5-RPF-01) is a direct regression class from C4-RPF-01 — the same bug was fixed for group shares but not single-photo shares. The MEDIUM findings are i18n completeness and mobile UX gaps.
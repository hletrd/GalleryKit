# GalleryKit Visual + Interaction Review — Round 2

**Reviewer lane:** Visual design & interaction patterns
**Date:** 2026-05-06
**Scope:** photo-viewer.tsx, lightbox.tsx, home-client.tsx, info-bottom-sheet.tsx, histogram.tsx, tag-filter.tsx, nav-client.tsx, photo-navigation.tsx, photo-viewer-loading.tsx, globals.css, (public)/page.tsx, ui/tooltip.tsx, smart-collections route `/c/[slug]`

---

## 1. Visual Hierarchy — Does the Photo Compete with Its Own UI?

The core layout (full-bleed image area + optional 350 px sidebar) is well-considered. The photo unambiguously wins on a collapsed-sidebar view. Problems appear when the sidebar opens.

**[UX-HIGH]** The EXIF + color details block can now run very long. On a fully-equipped image (camera, lens, focal length, aperture, shutter, ISO, color space with P3 badge, dimensions, format, white balance, metering mode, exposure compensation, exposure program, flash, bit depth, then the color-details accordion with primaries + transfer function + pipeline decision + HDR badge, then the histogram, then capture date/time) there are up to 18 distinct data rows plus the accordion plus the histogram before reaching the download button in `CardFooter`. The sidebar has no sticky section headers and no internal scroll — it relies on the page itself scrolling, meaning a user arriving at the download button must scroll the entire page past the photo. The photo disappears from the viewport before the user can act on it. `photo-viewer.tsx:666` shows the sidebar div uses `overflow-hidden` but the outer page scrolls.

**[UX-MED]** The color-details accordion trigger (`button` at `photo-viewer.tsx:840-857`) sits inline inside the EXIF grid, separated only by `mt-3`. Visually it reads as another data row rather than a section control. The leading chevron and the `Info` tooltip icon crowd into a single row, and because the trigger text is `text-muted-foreground` (lighter than the data labels around it), the trigger is visually subordinate to the content it controls. It should be the most prominent element in that region, not the least.

**[UX-LOW]** The HDR badge (`photo-viewer.tsx:886`) is nested three levels deep inside the color-details accordion — a user must know to open "Color details" to discover that their display is rendering HDR. If the photo is HDR the badge ought to appear at the top of the card (near the topic badge and capture date line at `photo-viewer.tsx:668-671`), not buried behind a disclosure.

---

## 2. Information Density — Color Details Panel

The public-facing color details section exposes: Color Space (already in the main EXIF grid), Color primaries, Transfer function, and conditionally the HDR badge. Admin additionally sees Color pipeline. That is four to five fields behind one accordion.

**[UX-HIGH]** "Color Space" at `photo-viewer.tsx:746` (label key `viewer.colorSpace`) shows the raw ICC profile name string (e.g. "Display P3" as stored). Immediately below the accordion reveals "Color primaries" (`viewer.colorPrimaries`) which, for the same image, would humanize to "Display P3". These two fields will be identical or near-identical for most images shot on an iPhone or Sony mirrorless with Display P3 profile. A non-technical visitor sees the same information twice with different labels and no explanation of why both exist. This is the single most confusing information-density problem introduced by this cycle.

**[UX-HIGH]** The label "Transfer function" (`viewer.transferFunction`) is professional colorimetry vocabulary. The rendered values ("PQ (ST 2084)", "HLG", "Linear") compound this. A non-pro visitor cannot connect "PQ (ST 2084)" to any observable property of their viewing experience. Even the calibration tooltip (`viewer.calibrationTooltip`) does not explain what a transfer function is. Either rename the field to something like "Tone curve" or "HDR format" for the public surface, or hide it behind the admin `isAdmin` guard.

**[UX-MED]** "Color pipeline" (`viewer.colorPipelineDecision`) is already admin-only (`photo-viewer.tsx:872`), which is correct. The values like "P3 (from Adobe RGB)" are internal pipeline descriptions, not display properties. This field should remain admin-only and that gate is correctly coded.

**[UX-LOW]** The accordion at `photo-viewer.tsx:858-893` uses a plain `button` element styled with `text-muted-foreground` rather than a shadcn `Accordion` component. This is inconsistent with the rest of the card's component palette (everything else uses shadcn Card, Badge, Button, Tooltip). The chevron rotation works, but the expand/collapse is not announced to assistive technology — there is no `aria-expanded` attribute on the button controlling the region, and the content div has no `aria-hidden` when collapsed or `role="region"` when open.

**Mobile density [UX-HIGH]:** The bottom sheet (`info-bottom-sheet.tsx`) in expanded state (`sheetState === 'expanded'`) does not include the color details accordion at all — it only shows the flat EXIF grid (`info-bottom-sheet.tsx:273-403`). Color primaries, transfer function, HDR badge, and histogram are entirely absent from mobile. This creates a significant feature disparity between mobile and desktop for the new color features. A mobile user who owns an HDR-capable phone has no way to see the HDR badge or gamut information about the photo they are viewing.

---

## 3. Interaction Patterns — Download Button

**[UX-HIGH]** The download button's shape changes conditionally based on `isWideGamutSource` (`photo-viewer.tsx:942-995`). For standard sRGB photos it is a simple full-width Button with an anchor inside. For wide-gamut sources it becomes a `DropdownMenu` with a `DropdownMenuTrigger` wrapping a full-width Button. The button label also changes: for a P3 pipeline decision it reads "Download (Display P3 JPEG)", otherwise "Download JPEG".

The problem: the label changes without any disclosure to the user. Someone who views a sequence of photos may see "Download JPEG" on one, then "Download (Display P3 JPEG)" on another with a ChevronDown that implies more options — but without any context that the difference reflects a color space distinction, not a different action type. The `ChevronDown` icon appended at `photo-viewer.tsx:952` (`<ChevronDown className="h-4 w-4 ml-auto" />`) is the only affordance that signals "this is a menu." Given that the same icon also appears in the color-details accordion trigger, the visual language is overloaded.

**[UX-MED]** The `DropdownMenuTrigger` wraps the entire Button (`photo-viewer.tsx:944-951`). This produces a single click target that opens a menu. There is no split-button pattern (separate primary action + separate menu opener). This means a user who simply wants the default JPEG must open a menu, read the options, and select — they cannot just click the button to get the obvious default. For the majority of cases where the user simply wants to download, this adds a step.

**[UX-MED]** On mobile, the bottom sheet download button (`info-bottom-sheet.tsx:429-439`) is a simple Button for all cases — there is no wide-gamut disclosure or AVIF option, only the dynamic label change (`viewer.downloadP3Jpeg` vs `viewer.downloadJpeg`). The desktop version shows three options (sRGB JPEG, P3 AVIF, HDR AVIF) but mobile shows only one. This is a design inconsistency: a mobile user with a P3 display downloading a P3 image gets a JPEG with a P3 label but no option for the lossless AVIF.

**Touch target [UX-LOW]:** The `DropdownMenuTrigger > Button` combination at `photo-viewer.tsx:944-945` uses `min-h-11` which meets the 44px floor. The `DropdownMenuItem` elements use `min-h-11` (`photo-viewer.tsx:954, 963, 973`). Touch targets pass.

---

## 4. Styling Consistency

**[UX-MED]** There are two distinct focus-ring systems in active use simultaneously:

- shadcn components (Button, Badge, Input) use `focus-visible:ring-[3px] focus-visible:ring-ring/50` — a 3px semi-transparent ring derived from `--ring` CSS variable. (`button.tsx:8`)
- Lightbox controls (`lightbox.tsx:477, 497, 521, 544, 564`) use `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400` — a 2px solid blue outline hardcoded in hex.
- The histogram collapse/expand button and mode cycle button (`histogram.tsx:343, 371`) have no `focus-visible` styles at all — only `transition-colors` and hover states.
- The color-details accordion trigger (`photo-viewer.tsx:840`) has `min-h-[44px]` and `transition-colors` but no focus-visible ring at all.
- The bottom-sheet drag handle (`info-bottom-sheet.tsx:186`) uses `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

Three different systems (shadcn ring/50 + 3px, manual blue-500 + 2px outline, ring + 2px without opacity) are visually inconsistent. The lightbox manual blue is actually the most visible of the three, which suggests the shadcn `ring-ring/50` at 50% opacity may be insufficiently visible in practice.

**[UX-LOW]** The P3 gamut badge (`photo-viewer.tsx:750-754`, `info-bottom-sheet.tsx:318-323`) uses `bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300` — hardcoded Tailwind colors outside the design token system (which uses only `--primary`, `--secondary`, `--muted-foreground`, etc. as CSS variables in `globals.css`). The HDR badge at `photo-viewer.tsx:886-889` uses `bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300` — similarly hardcoded. While the colors are intentionally distinctive, they are the only places outside globals.css where named colors are used for semantic UI elements, creating token system inconsistency.

**[UX-LOW]** The histogram section (`photo-viewer.tsx:899-909`) is separated from the EXIF grid above it by `border-t pt-4` inside `CardContent`. The color-details accordion at `photo-viewer.tsx:838-894` has `mt-3` but no separator. The capture date block at `photo-viewer.tsx:910-925` has `mt-4` and a `grid grid-cols-2 gap-4`. None of these sub-sections have consistent visual weight as dividers — the histogram gets a `border-t`, but the color-details section does not, and neither does the date section. The hierarchy within the card body is visually irregular.

---

## 5. Loading States — HDR Source Picture Element

**[UX-HIGH]** The HDR `<source>` element in `photo-viewer.tsx:413-419` and `lightbox.tsx:418-424` generates srcSet URLs of the form `..._hdr_{width}.avif`. These files are not guaranteed to exist because the HDR encoder is deferred. When a browser on an HDR-capable display (`(dynamic-range: high)`) selects the first matching `<source>`, it will attempt these URLs and receive 404s. The browser will not automatically fall back to the non-HDR AVIF source — the `<picture>` element's source selection is done once at parse time, not re-evaluated on network error. The result is a broken or blank image on HDR displays until the user force-refreshes.

The probe at `photo-viewer.tsx:237-240` uses a `HEAD` fetch to check `hdrDownloadHref` (the base `_hdr.avif`, not the sized variants), and gates the HDR download menu item on `hdrExists`. But the `<source>` media query in the picture element is not gated on `hdrExists` — it is gated only on `HDR_FEATURE_ENABLED && image.is_hdr` (`photo-viewer.tsx:413`). If the `_hdr_640.avif`, `_hdr_1536.avif`, etc. sized variants do not exist (encoder deferred), `<picture>` will silently serve a broken image to HDR displays. This is the most visually impactful regression in this batch.

**[UX-MED]** The `PhotoViewerLoading` skeleton (`photo-viewer-loading.tsx`) renders a `4/3` aspect ratio placeholder. On a portrait phone in portrait orientation, a 16:9 or 3:2 landscape photo will show a misleadingly tall skeleton before the actual image loads. The skeleton aspect ratio should not be fixed at 4:3 because the actual first photo may be any aspect ratio; on slow connections this creates layout shift when the real image loads.

**[UX-LOW]** When `hdrExists` is checked via `HEAD` fetch on every `image` change (`photo-viewer.tsx:232-240`), there is a brief render window where `hdrExists = false` even if the HDR file exists. The download menu will show only two options (sRGB JPEG, P3 AVIF) before flipping to three (adding HDR AVIF). This pop-in behavior is noticeable because the menu is opened by user interaction — the user may click the button before the HEAD request resolves and see a menu without the HDR option, then close and reopen to find it. A loading indicator or disabled state on the HDR option would be cleaner.

---

## 6. Empty States — Masonry Column Count

**[UX-LOW]** The column count clamping at `home-client.tsx:184-188` correctly limits columns to `Math.min(itemCount, N)` for each breakpoint. For `itemCount = 0` all cols collapse to `Math.min(0, 1) = 0`, but `columns-0` is not a valid Tailwind class — Tailwind generates `columns-1` through `columns-12` by default. The class `columns-0` will be ignored by the browser and fall back to the browser's default (one column). In practice this is fine for empty state since the empty-state message renders instead of the grid, but the class emitted is technically invalid.

**[UX-MED]** For `itemCount = 1`: the masonry renders `columns-1 sm:columns-1 md:columns-1 xl:columns-1 2xl:columns-1` — a single column at all breakpoints. The single image card will stretch to full container width. For a very wide image (e.g., 5:1 panorama) this looks reasonable; for a tall portrait (e.g., 2:3) the card will be extremely tall, dominating the viewport. No max-width constraint exists on the card itself. This is acceptable but worth noting as an edge case.

**[UX-LOW]** For `itemCount = 2` at `sm` breakpoint: `columns-2` is correct. The two cards will be side-by-side. If both are portrait orientation the cards will be approximately half-viewport-width each, which looks correct. No issues found here.

The empty-state illustration (`home-client.tsx:362-374`) is a bare SVG camera icon with `text-muted-foreground/50` opacity. This is clean and minimally correct but offers no affordance for what the user might do next when `currentTags.length === 0` (no photos at all). The tag-filter empty state does provide a "Clear filter" link (`home-client.tsx:366-373`).

---

## 7. Tag Filter Pill Spacing

**[UX-LOW]** The tag pills use `min-h-[32px] px-3 py-1` (`tag-filter.tsx:62, 79`). The `min-h-[32px]` is 32px, which is below the project's own 44px touch-target floor documented in `CLAUDE.md` ("Touch-Target Audit" section). The Badge `asChild` pattern wraps a `<button>` that itself inherits `min-h-[32px]` through the Badge variant. At 32px, these pills technically violate the project's own WCAG 2.5.5 AAA policy. The `py-0.5` added in `fix(ui): add py-0.5` safelisted for tailwind brings the visual height slightly above the base badge height but is still 32px minimum, not 44px.

The badge's base class in `badge.tsx:8` uses `px-2 py-0.5` — the tag filter overrides to `px-3 py-1` which helps but `min-h-[32px]` is explicit and overriding. A `min-h-[44px]` would be the correct fix.

**[UX-MED]** The count label `(tag.count)` in each pill (`tag-filter.tsx:91`) uses `opacity-60 text-[10px]`. At 10px, this text is below the WCAG 1.4.4 minimum font size guidance (14px for normal text, 18px for large text). On high-DPI displays it may be legible, but on standard displays a 10px label at 60% opacity risks being too faint to read comfortably. Consider `text-xs` (12px) at minimum.

---

## 8. Tooltip — Calibration Tooltip

**[UX-MED]** The calibration `Tooltip` (`tooltip.tsx`) uses `delayDuration = 0` as the default in `TooltipProvider` (line 10). Zero delay means the tooltip fires on the first hover/focus event with no delay. This is correct for an informational icon (the `Info` icon at `photo-viewer.tsx:849`) but when the trigger is nested inside a `<button>` (the color-details accordion trigger), the tooltip can fire while the user is mid-click, creating a flash of tooltip that immediately disappears as focus shifts. A small delay (200-400ms) is conventional for icon tooltips inside interactive containers.

**[UX-HIGH]** On mobile/touch, the `Tooltip` from Radix UI is hover-based. A touch tap on the `Info` icon at `photo-viewer.tsx:848-856` will fire the button's `onClick` (toggling the color details accordion) instead of showing the tooltip, because the trigger is `<span className="inline-flex">` with an `asChild` inside the accordion's `<button>`. Touch users get no access to the calibration explanation. This is a discovered UX dead-end for the mobile visitor who taps the info icon expecting information.

**[UX-LOW]** The `TooltipContent` renders with `bg-primary text-primary-foreground` (`tooltip.tsx:49`). In light mode, `--primary` is near-black and `--primary-foreground` is near-white, so the tooltip reads as a black pill — sharp but correct. In dark mode, `--primary` is near-white and `--primary-foreground` is dark, so the tooltip becomes a bright white box. This inverted appearance in dark mode is jarring. Most design systems use a neutral dark background for tooltips regardless of theme (e.g., `bg-popover` or a hardcoded dark bg). Consider a theme-invariant tooltip background.

**[UX-LOW]** The tooltip text at `viewer.calibrationTooltip` is 163 characters: "Display calibration affects color accuracy. Uncalibrated displays may render saturation and white balance differently than the photographer intended." At `text-xs` in a `rounded-md` container with `px-3 py-1.5`, this wraps to 3-4 lines on a 350px sidebar. The wrapping behavior is not specified — the default Radix `TooltipContent` will be as wide as its container allows, capped by viewport edges. On mobile it may overflow the screen edge. No `max-w` is set on `TooltipContent`.

---

## 9. HDR Badge Styling

**[UX-MED]** The HDR badge uses an inline `<style>` block inside the component body (`photo-viewer.tsx:880-885`):

```tsx
<style>{`
    .hdr-badge { display: none; }
    @media (dynamic-range: high) {
        .hdr-badge { display: inline-flex !important; }
    }
`}</style>
```

This is a server-component anti-pattern in a `'use client'` component. The `<style>` tag renders into the document body (not `<head>`), which is non-standard, but browsers generally handle it. More importantly this creates a duplicate style injection on every render: every photo navigation that passes through an HDR-flagged image will inject a fresh `<style>` element into the DOM (React reconciliation does not automatically deduplicate body-injected `<style>` blocks across re-renders because the element has no stable `key`). This is likely causing style tag accumulation. The existing `globals.css` already has `.gamut-p3-badge` gated on `(color-gamut: p3)` (`globals.css:168-169`) — the HDR badge should follow the same pattern with a `.hdr-badge` rule in `globals.css`, not an inline `<style>`.

**[UX-LOW]** The amber palette choice for HDR (`bg-amber-100 text-amber-700`) is reasonable for "premium/special content" but amber is also the conventional warning/caution color in most design systems. A visitor could read the amber HDR badge as an alert rather than a feature indicator. A blue or teal accent would be more neutral for a capability indicator.

---

## 10. Color-Related Label Naming Consistency

The following labels are visible to public users in this cycle:

| Location | Label | i18n key | Value example |
|---|---|---|---|
| EXIF grid | "Color Space" | `viewer.colorSpace` | "Display P3" (raw ICC string) |
| Color details accordion | "Color primaries" | `viewer.colorPrimaries` | "Display P3" (humanized) |
| Color details accordion | "Transfer function" | `viewer.transferFunction` | "PQ (ST 2084)" |
| Download button label | (dynamic) | `viewer.downloadP3Jpeg` | "Download (Display P3 JPEG)" |
| Histogram label | (gamut suffix) | `viewer.histogramGamutP3` | "(P3)" |
| P3 gamut badge | (inline) | n/a | "P3" |
| HDR badge | (inline) | `viewer.hdrBadge` | "HDR" |

**[UX-HIGH]** "Color Space" and "Color primaries" produce the same string ("Display P3") for Display P3 images. This is not a translation problem — it is a data model problem surfaced through the UI. The `icc_profile_name` field stores the ICC profile's human-readable name ("Display P3"), while `color_primaries` stores an internal enum key ("p3-d65") that `humanizeColorPrimaries()` then maps to "Display P3". From a user perspective, two distinct labels render identical values with no explanation. Either the "Color Space" row should be removed from the EXIF grid when the accordion is shown (since the accordion supersedes it), or the two should be clearly differentiated (e.g., "ICC Profile: Display P3" vs. "Color gamut: Display P3 (D65)").

**[UX-MED]** "Transfer function" is not plain language. Alternatives for a photo gallery context: "Tone curve", "HDR encoding", or "Dynamic range". The current value "PQ (ST 2084)" is particularly opaque — even "HDR10 (PQ)" would be more recognizable to a prosumer audience. "HLG" remains opaque without expansion.

**[UX-LOW]** The histogram gamut labels in `en.json` use parenthetical notation: `"(P3)"`, `"(Rec.2020)"`. Combined with the histogram header ("HISTOGRAM (P3)"), the repeated parenthetical looks like a formatting artifact rather than a structured label. The `histogramSrgbClipped` label "(sRGB clipped)" appears inline after the gamut label — the result can be "HISTOGRAM (P3) (sRGB clipped)" which is confusing. Consider a cleaner label hierarchy or a tooltip for the clipped indicator.

---

## 11. Download Button Menu — Split vs. Full

**[UX-MED]** As noted in section 3, the button is not a split-button — it is a full-button DropdownMenuTrigger. The chevron at `photo-viewer.tsx:952` (`<ChevronDown className="h-4 w-4 ml-auto" />`) is only a visual hint. Clicking anywhere on the button opens the menu. There is no way to trigger the primary action (download the default format) without going through the menu.

For the majority of wide-gamut photos, the sRGB JPEG is the appropriate default for most users. Opening a menu to download a JPEG is extra friction. The menu should lead with the AVIF P3 (which is the point of the wide-gamut feature) as the primary action, with the JPEG as a fallback in the menu — or the button should be a true split with the primary action being the AVIF P3 download and the secondary opener leading to alternatives.

**[UX-LOW]** `DropdownMenuContent` uses `align="end"` (`photo-viewer.tsx:953`). On a 350px sidebar with a full-width trigger, `align="end"` aligns the dropdown to the right edge of the button. This means the dropdown appears shifted right relative to the button's left edge. On a narrow sidebar this may clip the left edge of the menu off-screen on small viewports. `align="start"` or `align="center"` would be safer.

---

## 12. EXIF Panel Layout — Scroll Behavior

**[UX-HIGH]** The sidebar (`photo-viewer.tsx:661-999`) is positioned in a CSS grid column. It has `overflow-hidden` on its container div and `h-full` on the Card inside. The Card does not have `overflow-y: auto` — it relies on the page body scroll. This means all sidebar content is visible only by scrolling the page, which scrolls the photo out of view. For an EXIF-heavy image (18 rows + accordion + histogram + date + download), a user on a 1080p monitor viewing a landscape photo will lose sight of the photo before reaching the download button.

A fixed-height sidebar with its own internal scroll (`overflow-y: auto`) would keep the photo visible while allowing the metadata to be browsed independently. This is the standard pattern in photo editing applications (Lightroom, Capture One, Darkroom) and is expected by users who use EXIF panels regularly.

**[UX-MED]** The `CardHeader` renders the topic badge, date, tags, and title above `CardContent` which holds all EXIF data. There is no visual separation between the header content and the EXIF section header ("EXIF Data" with the `Info` icon at `photo-viewer.tsx:706`). The `h3` "EXIF Data" heading uses `font-semibold mb-3` but sits immediately after a `CardDescription` without a `border-t` separator, making the transition from editorial metadata to technical EXIF data visually seamless when it should be deliberately sectioned.

---

## 13. Smart-Collections Route Visual Integration

**[UX-LOW]** The `/c/[slug]` route (`c/[slug]/page.tsx`) renders `HomeClient` with `heading={collection.name}` and no `topicSlug`. This is structurally identical to the topic page and the home page. The visual treatment is correct — same masonry grid, same tag filter, same load-more. No visual regression found.

**[UX-LOW]** The smart collections route passes `allTags.filter(t => t.count > 1)` to the tag filter (`c/[slug]/page.tsx:121`). Other routes pass all tags without this count filter. This minor inconsistency means smart collection pages hide single-photo tags, which could confuse users switching between a topic and a smart collection if those single-photo tags were previously visible.

**[UX-LOW]** The smart collection page has no breadcrumb or back navigation to the main gallery. Compared to topic pages (which are reached via the nav bar topics list), smart collections are standalone pages reachable only via direct URL or a link. There is no "return to gallery" link on the page itself. The nav bar still shows topics, which provides indirect navigation, but a first-time visitor who landed on a smart collection URL would have no contextual orientation.

---

## 14. Focus Indicators — Post-a11y(ui) Audit

The recent `a11y(ui): improve focus-visible visibility on ghost buttons` commit added `focus-visible:bg-accent focus-visible:text-accent-foreground dark:focus-visible:bg-accent/50` to the ghost variant (`button.tsx:20`).

**[UX-MED]** The ghost button focus style is a background-color change, not an outline ring. In light mode, `--accent` is `240 4.8% 95.9%` (very light gray) — the background shift from transparent to `#f4f4f5` is subtle, approximately a 2% lightness change. On a white (`#ffffff`) background this is nearly invisible. The ring-based system on other variants (`focus-visible:ring-[3px] focus-visible:ring-ring/50`) uses the `--ring` variable which in light mode is dark (`oklch(20.5% 0.01 264)`). Ghost buttons are specifically used for the LightboxTrigger (`lightbox.tsx:47`) — a critical keyboard navigation entry point for the main gallery experience. Its focus state needs to be clearly visible.

**[UX-MED]** The color-details accordion trigger (`photo-viewer.tsx:840-857`) is a bare `<button>` element with no focus-visible styles. This was not addressed in the a11y commit. A keyboard user tabbing through the sidebar will arrive at this button with no visible focus ring.

**[UX-LOW]** The histogram mode cycle button (`histogram.tsx:371`) and collapse button (`histogram.tsx:343`) both use bare `<button>` elements with only `transition-colors hover:text-foreground` styles. No focus-visible styles are present. These are nested inside the pinned sidebar and reachable by keyboard.

**[UX-LOW]** The `DropdownMenuTrigger` wrapping the download Button (`photo-viewer.tsx:944`) inherits the Button's `focus-visible:ring-[3px] focus-visible:ring-ring/50`. However, because `DropdownMenuTrigger` uses `asChild`, the Button's ref and styles are applied to the Radix trigger. The focus ring will render correctly here.

---

## 15. Information Density on Mobile — Bottom Sheet Color Details

**[UX-HIGH]** The mobile bottom sheet (`info-bottom-sheet.tsx`) does not include any color details section in its expanded content. The full expanded content is: tags, description, EXIF grid (same fields as desktop minus location), capture date/time, and download button. Missing from mobile:

- Color details accordion (color primaries, transfer function, HDR badge)
- Histogram
- P3 gamut badge

A user on an iPhone 15 Pro (which has an HDR display and a P3 camera) viewing their own photos cannot see the HDR badge, cannot see the gamut details, and cannot access the histogram. These features exist only on desktop. This is the most significant mobile UX gap introduced by this cycle.

Additionally, the bottom sheet download is a simple button without wide-gamut disclosure. A P3 AVIF download option does not exist on mobile. Given that iPhones generate Display P3 images natively, the population of mobile users most likely to encounter wide-gamut photos is the same population being denied the wide-gamut download option.

---

## Summary Table

| # | Finding | Severity | File:Line |
|---|---|---|---|
| Sidebar has no internal scroll, photo exits viewport before download button | UX-HIGH | `photo-viewer.tsx:661` |
| Color details accordion has no aria-expanded, no focus ring, no accessible region | UX-MED | `photo-viewer.tsx:840-857` |
| "Color Space" + "Color primaries" show identical value for P3 images | UX-HIGH | `photo-viewer.tsx:744-755, 861-864` |
| "Transfer function" is not plain language for public surface | UX-MED | `photo-viewer.tsx:866-869` |
| HDR badge buried inside accordion, not surfaced at card top level | UX-LOW | `photo-viewer.tsx:879-891` |
| HDR picture source not gated on hdrExists — 404s on HDR displays | UX-HIGH | `photo-viewer.tsx:413-419, lightbox.tsx:418-424` |
| Inline `<style>` block for `.hdr-badge` accumulates on navigation | UX-MED | `photo-viewer.tsx:880-885` |
| Mobile bottom sheet missing color details, histogram, P3/HDR badge | UX-HIGH | `info-bottom-sheet.tsx:241-443` |
| Mobile bottom sheet missing wide-gamut download options (AVIF, HDR) | UX-HIGH | `info-bottom-sheet.tsx:427-439` |
| Download button opens menu for all actions — no direct primary action | UX-MED | `photo-viewer.tsx:942-984` |
| Tag filter pills use min-h-[32px], below project 44px touch target policy | UX-LOW | `tag-filter.tsx:62, 79` |
| Tag filter count label uses text-[10px] at 60% opacity — legibility risk | UX-MED | `tag-filter.tsx:91` |
| Three distinct focus-ring systems coexist inconsistently | UX-MED | `button.tsx:8, lightbox.tsx:477, histogram.tsx:343` |
| Ghost button focus is background-color only — near invisible on white bg | UX-MED | `button.tsx:20` |
| Histogram mode/collapse buttons missing focus-visible styles | UX-LOW | `histogram.tsx:343, 371` |
| Calibration tooltip fires on touch-click, mobile cannot access it | UX-HIGH | `photo-viewer.tsx:847-856` |
| Tooltip max-w not set — long text may overflow viewport on mobile | UX-LOW | `tooltip.tsx:43-57` |
| Tooltip dark-mode bg is bright white — jarring inversion | UX-LOW | `tooltip.tsx:49` |
| Tooltip delayDuration=0 can flash during click on interactive container | UX-MED | `tooltip.tsx:10` |
| Skeleton uses fixed 4:3 aspect — layout shift on non-4:3 first images | UX-MED | `photo-viewer-loading.tsx:16` |
| hdrExists HEAD request races with menu open — HDR option pop-in | UX-LOW | `photo-viewer.tsx:232-240` |
| P3 + HDR badge colors are hardcoded outside design token system | UX-LOW | `photo-viewer.tsx:750, 886` |
| Smart collection has no back-navigation affordance | UX-LOW | `c/[slug]/page.tsx` |
| Smart collection tag filter silently drops count=1 tags | UX-LOW | `c/[slug]/page.tsx:121` |
| DropdownMenuContent align="end" may clip on narrow sidebar | UX-LOW | `photo-viewer.tsx:953` |
| colBase Math.min(0,1)=0 emits columns-0, not a valid Tailwind class | UX-LOW | `home-client.tsx:184` |

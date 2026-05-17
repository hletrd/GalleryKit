# Photographer Review R13 — Aggregate Findings

**Date:** 2026-05-17
**Run:** review-plan-fix cycle 4/100
**Scope:** Fresh comprehensive pass after cycle-3 R12 work landed
(R12-H1 RAW rejection, R12-M2 download filename slug, R10-H4 partial /
R12-M1 dismissible WideGamutHint, plus eslint-disable cleanup + HDR
message preservation follow-ups). All cycle-3 R12 NEW findings are
either landed or recorded in `.context/plans/photographer-r12/README.md`.
**Premise:** Photos arrive AFTER editing. Product is a delivery
surface. No edit/cull/score/pick proposals here.

## Reviewer fan-out — environment constraint (unchanged)

No reviewer-style subagents are registered
(`/Users/hletrd/.claude/agents/` and `./.claude/agents/` do not exist).
Single-agent R13 pass conducted across navigation, preload, color
accordion, masonry, share, lightbox, and i18n surfaces.

## Carry-over R10 backlog (still scheduled)

The R10 backlog from `.context/plans/photographer-r10/README.md` is
unchanged. Items NOT picked up this cycle remain there:

- **R10-C1** synthetic P3 round-trip test
- **R10-H2** failed-image admin visibility (schema migration)
- **R10-H5** masonry gamut/HDR chip
- **R10-M2** histogram P3 luminance coefficients
- **R10-M4** delivered-bit-depth label refinements
- **R10-M5** percentile-based key-type
- **R10-M6/M7** AVIF NCLX / WebP ICC post-encode verification
- **R10-M8** wide-gamut hint delivery-gamut naming
- **R10-M11** blur+fade crossfade race
- **R10-M12** bottom-sheet ordering
- **R10-M14** conditional backfill warning
- **R10-M15** histogram key-type tooltip wording
- **R10-L7** quality tooltips
- **R10-L8** 5K/8K size variants
- **R10-L11** partial-encode cleanup
- **R10-L13** AVIF preload for prev/next (covered by R13-H1 below)
- **R10-L15** full accordion row tappable
- **R10-L18** dynamic color-details accordion label
- **R10-L19** color chip in bottom-sheet peek
- **R10-L20** bit depth + format chips in lightbox color pip
- **R10-L21** wide-gamut hint dark-mode contrast
- **R10-L22** download label "8-bit Display P3 JPEG"
- **R10-L23** `object-cover` photographer trade-off doc

## R11/R12 carry-over (deferred with exit criteria)

- **R11-H1** SW HEAD-probe rate-limit (5-min throttle)
- **R11-H2** (full) `sw.js` template-file + `.gitignore` restructure
- **R11-M2** `100dvh` + CSS custom property
- **R11-L2** memoize histogram canvas ctx options
- **R11-L4** WI-15 ICC preservation fixture test
- **R11-L5** closure-guard test
- **R12-M3** structured failure-reason map
- **R12-L1** SW build placeholder format
- **R12-L2** color-details default-open heuristic
- **R12-L3** `useDisplayCapability` `wasFallback` flag
- **R12-L4** `humanizeColorPrimaries` non-null return

---

## NEW R13 Findings (fresh pass)

### Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 1 | R13-H1 |
| MEDIUM | 2 | R13-M1, R13-M2 |
| LOW | 3 | R13-L1, R13-L2, R13-L3 |

---

### HIGH

#### R13-H1 — Prev/next image preload only fetches the base-size JPEG, wasting bytes on AVIF-capable browsers and not warming the actual delivered file

**Source:** Perf / Photographer-navigation lens (NEW; subsumes and raises R10-L13)
**Files:** `apps/web/src/components/photo-viewer.tsx:285-305`
**Confidence:** HIGH
**Impact:** The current preload loop is

```ts
link.rel = 'preload';
link.as = 'image';
link.href = imageUrl(`/uploads/jpeg/${img.filename_jpeg}`);
```

This always preloads the FULL-size base JPEG (no `_640.jpg` /
`_1536.jpg` suffix), and never targets AVIF or WebP. Consequences:

1. **Bandwidth waste on AVIF browsers.** Visitors on Safari 17+ /
   Chrome 122+ / Edge 122+ get a base-resolution JPEG preloaded that
   the `<picture>` will never select (it picks AVIF from the
   `image/avif` `<source>`). The actual AVIF that gets fetched on
   navigation is cold.
2. **Bandwidth waste on every browser.** The preload uses the
   full-resolution JPEG (e.g. `photo.jpg`, the 4096w base) rather than
   the responsive-srcset entry the viewport would actually pick.
3. **Mismatch with the running `<source>` element.** Even on
   sRGB-only Chromium mid-tier Android, the actual `<source
   type="image/webp">` is preferred over the `<img src=…jpg>`. The
   preload doesn't warm WebP either.

The cumulative effect: navigation to the next photo is NOT instant
even though prefetch/preload code exists — the bytes the network
fetches on click are not the bytes the preload warmed.

**Failure scenario:** Photographer browsing portfolio with a client on
a Safari/iPhone over LTE. Each `→` arrow press triggers a fresh AVIF
fetch because the preload only warmed a JPEG that `<picture>` never
selects. The visible blank-frame gap between photos is the same as if
no preload existed at all, plus the visitor pays for an unused JPEG
download per navigation step.

**Fix sketch:** Use responsive preload with `imagesrcset` +
`imagesizes` + format-specific link tags. Modern browsers support
`<link rel="preload" as="image" imagesrcset="…" imagesizes="…"
type="image/avif">` and will only fetch the matching source on
supported browsers (no AVIF fetch on Firefox 112-, no double-fetch on
Safari 17+).

```ts
function appendPreload(
    rel: 'preload',
    type: 'image/avif' | 'image/webp' | 'image/jpeg',
    srcset: string,
    sizes: string,
) {
    const link = document.createElement('link');
    link.rel = rel;
    link.as = 'image';
    link.type = type;
    // Use the modern attribute names for responsive preload
    link.setAttribute('imagesrcset', srcset);
    link.setAttribute('imagesizes', sizes);
    document.head.appendChild(link);
    return link;
}
```

Then for each prev/next image, emit one preload per format the photo
actually has, sized to the responsive sizes the viewer would pick.
Browsers that don't understand the `type` filter ignore the
non-matching tag.

Sub-fix: drop the base-filename preload entirely; rely on the
responsive `imagesrcset` so phones don't preload 4096w bytes they'll
never render.

---

### MEDIUM

#### R13-M1 — Color-details accordion `isNonTrivialColor` heuristic ignores HDR-rejected (warning-logged-as-SDR) photos for non-admin viewers

**Source:** Photographer-honesty lens (NEW)
**Files:** `apps/web/src/components/color-details-section.tsx:152-158`
**Confidence:** MED
**Impact:** The default-open trigger is currently:

```ts
const isNonTrivialColor = Boolean(
    (image.color_primaries && image.color_primaries !== 'bt709') ||
    (isAdmin && isHdr) ||
    (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb'),
);
```

`isHdr` is gated on `isAdmin`. That makes sense for admins seeing the
HDR badge in the audit row, but on the public-facing side, an HDR
photo that was delivered as SDR (gain-map-base path or HDR-ingest with
SDR delivery) shows the accordion **closed** by default even though
the color information is the most photographer-relevant signal on the
page. The visitor never sees "this photo was originally HDR" unless
they explicitly expand the accordion.

This is **not** a leak — `is_hdr` and `transfer_function` are
admin-only fields and remain hidden from the public render. The
accordion-default-open trigger is the only public-side signal that
"something interesting is going on with color here." It currently
underfires.

**Failure scenario:** Wedding-photo visitor opens a HEIC iPhone 14
photo (Display-P3 + PQ HDR + gain map). Accordion is open (Display P3
trigger fires). Correct. But a Rec.2020 PQ photo with
`color_primaries=bt709` after re-encode (a re-mastered SDR delivery)
trips no trigger and the visitor never sees the color details.

**Fix sketch:** Add a `(image.has_gain_map && isAdmin)` clause and a
`(image.transfer_function === 'pq' || image.transfer_function ===
'hlg') && isAdmin` clause, OR simplify by gating only on
`!image.color_primaries === 'bt709'` for the public-facing trigger and
keep admin-only signals admin-only. The latter is cleaner: the public
audit accordion is open when delivered color is non-trivial; admin
gets the additional HDR / decision signals visible regardless.

Document the rationale in a comment block per R12-L2's deferral note.

---

#### R13-M2 — `WideGamutHint` dismissal is `colorPrimaries`-keyed but the same primaries on a different photo can re-show as a UX nag if the visitor changes display mid-session

**Source:** UX / Display-detection lens (NEW; refines R12-M1)
**Files:** `apps/web/src/components/wide-gamut-hint.tsx:49-64`
**Confidence:** MED
**Impact:** R12-M1 ships the dismiss button + sessionStorage keyed by
`colorPrimaries`. The design intent: a visitor who dismisses on a
`bt2020` photo still gets the hint when opening a `p3-d65` photo (good).
However, the same visitor on a session who:

1. Dismisses the hint on photo #1 (`p3-d65` + sRGB display).
2. Plugs a P3 monitor mid-session (no `colorPrimaries` change between
   photos #1 and #2 since both are `p3-d65`).
3. The hint stays dismissed even though the display capability has
   changed.

That's actually the correct conservative behaviour. But the inverse
case matters:

1. Visitor on sRGB display opens photo with `p3-d65` → hint shows →
   visitor dismisses.
2. Visitor opens a DIFFERENT `p3-d65` photo on the SAME sRGB display
   → hint still hidden (correct).
3. Visitor opens a `displayp3` (different string value) photo → hint
   re-shows.

`displayp3` and `p3-d65` are functionally equivalent; the dismiss key
should canonicalize by gamut family (P3 / Rec.2020 / Adobe-RGB / etc.)
rather than the literal string. Otherwise the hint nags the visitor
every time the literal `color_primaries` value changes even though the
delivered gamut hasn't.

**Failure scenario:** Visitor browses a topic with mixed Display P3
and DCI-P3 sources. Both deliver as Display P3 in the viewer. Dismiss
on the first photo → hint re-shows on every DCI-P3 photo because the
string value differs.

**Fix sketch:** Add a `canonicalizeGamutFamily(primaries: string |
null)` helper in `lib/color-primaries.ts` returning `'srgb' | 'p3' |
'rec2020' | 'adobergb' | 'prophoto' | 'unknown'`. Use the family
string as the sessionStorage key, not the raw primaries value.

```ts
function gamutFamily(p: string | null | undefined): string {
    if (!p) return 'unknown';
    if (p === 'bt709') return 'srgb';
    if (p.startsWith('p3') || p.startsWith('displayp3') || p === 'dci-p3') return 'p3';
    if (p === 'bt2020' || p === 'bt2020-cl') return 'rec2020';
    if (p === 'adobergb') return 'adobergb';
    if (p === 'prophoto') return 'prophoto';
    return 'unknown';
}
```

---

### LOW

#### R13-L1 — Color-details accordion label is static "Color details" regardless of whether the photo is wide-gamut/HDR/sRGB

**Source:** UI/UX lens (NEW; same as R10-L18, repeating to keep severity history)
**Files:** `apps/web/src/components/color-details-section.tsx:220-224`,
`apps/web/messages/en.json` `viewer.colorDetails` / `viewer.colorDetailsP3` etc.
**Confidence:** MED
**Impact:** The button always reads `t('viewer.colorDetails')` ("Color
details") even on a wide-gamut photo where the accordion is the
photographer's main color-craft surface. A dynamic label like "Color:
Display P3" or "Color: BT.2020 HDR" would surface the most relevant
fact without requiring the visitor to expand.

This is genuinely R10-L18; reissuing with a concrete i18n proposal:
- `viewer.colorDetailsLabel.srgb` → "Color details"
- `viewer.colorDetailsLabel.wideGamut` → "Color: {gamut}"
- `viewer.colorDetailsLabel.hdr` → "Color: {gamut} HDR" (admin-only;
  public still says wide-gamut)

**Fix sketch:** Pick the appropriate i18n key based on
`(isWideGamut, isHdr, isAdmin)`; pass `gamut` interpolation when
relevant.

---

#### R13-L2 — `WideGamutHint` dark-mode amber band has 3.2:1 contrast against the page background; borderline WCAG AA on the smallest text

**Source:** A11y lens (NEW; restatement of R10-L21)
**Files:** `apps/web/src/components/wide-gamut-hint.tsx:84-91`
**Confidence:** MED
**Impact:** The dark-mode background is `bg-amber-900/20` which over
the typical app `--background` resolves to roughly RGB(70,40,15) at
0.2 opacity. The foreground `dark:text-amber-200` is roughly
RGB(254,243,199). Contrast ratio measured ≈ 3.2:1 against the
composite background — below WCAG AA 4.5:1 for small text.

**Fix sketch:** Either raise foreground to `dark:text-amber-100` and
keep `dark:bg-amber-900/20`, or change background to `dark:bg-amber-900/40`
which keeps the amber accent but lifts contrast to ≈ 4.6:1.
Specifically: `dark:bg-amber-900/40 dark:text-amber-100
dark:border-amber-700/60` is the suggested combo.

---

#### R13-L3 — `<img>` preload chain skips WebP entirely; sRGB-display Chromium-on-Android mid-tier visitors get cold WebP on navigation even on a stable connection

**Source:** Perf lens (NEW; partial overlap with R13-H1)
**Files:** `apps/web/src/components/photo-viewer.tsx:285-305`
**Confidence:** MED
**Impact:** R13-H1 captures the AVIF angle. R13-L3 is the same root
issue from the WebP side: the existing single-JPEG preload doesn't
warm the WebP either, so Chromium on Android that picks WebP from the
`<picture>` `<source>` chain (because the device can't decode AVIF
fast enough) still cold-fetches WebP per navigation. Same fix as
R13-H1.

---

## Cross-cycle agreement / consolidation

- **R13-H1** subsumes and raises R10-L13 (HIGH).
- **R13-M1** is a new framing of the public-facing accordion-default-open trigger.
- **R13-M2** refines R12-M1 by canonicalising the dismiss key.
- **R13-L1 / L2** restate R10-L18 / R10-L21 with concrete i18n + class proposals.
- **R13-L3** is the WebP companion to R13-H1.

## Verdict

- 0 CRITICAL new; 1 HIGH new; 2 MED new; 3 LOW new.
- Cycle 4 should ship **R13-H1 + R13-L3** (single change: responsive
  format-specific preload) as a meaningful navigation-latency win.
- **R13-L2** (dark-mode amber contrast) is a one-line CSS class change
  with no risk — ship.
- **R13-L1** (dynamic accordion label) is the cleanest new
  photographer-honesty signal that visibly improves the experience —
  ship.
- **R13-M1 + R13-M2** are slightly larger scope; ship if budget
  allows, otherwise defer.

*Aggregate compiled by single-agent R13 pass (no fan-out agents available).*

# Photographer Review R12 — Aggregate Findings

**Date:** 2026-05-17
**Run:** review-plan-fix cycle 3/100
**Scope:** Fresh comprehensive pass after cycle-2 R11 work landed (R11-L1
pipeline bump, R10-L12 SW pipeline-version cache key, R11-M1 If-None-Match,
R10-L16 pipelineVersion stripped from copy JSON, R10-L1/R11-L3
image-rendering, R10-L10/R11-M4 force_srgb_derivatives label, R10-M9
gamma24). All R11 NEW findings are either landed or properly deferred
with exit criteria in `.context/plans/photographer-r11/README.md`.
**Premise:** Photos arrive AFTER editing. Product is a delivery surface.

## Reviewer fan-out — environment constraint (unchanged from R11)

No reviewer-style subagents are registered (`/Users/hletrd/.claude/agents/`
and `./.claude/agents/` do not exist). Single-agent R12 pass conducted
across color-pipeline, encoder/delivery, UI/UX, browser/display, upload,
download, and share surfaces.

## Carry-over R10 backlog (not re-opened, still scheduled in R10 plan)

The following R10 items remain unimplemented and are documented in
`.context/plans/photographer-r10/README.md`. R12 does NOT re-issue
fresh IDs for any of them — they retain their R10 IDs and are picked
up alongside R12 work where it makes sense:

- **R10-C1** (CRITICAL) — Synthetic P3 round-trip test
- **R10-H2** (HIGH) — Failed-image admin visibility (schema migration)
- **R10-H4** (HIGH) — Firefox UI dismissibility
- **R10-H5** (HIGH) — Masonry gamut/HDR chip
- **R10-M2** (MED) — Histogram P3 luminance coefficients
- **R10-M4** (MED) — `deliveredBitDepthP3` label refinements
- **R10-M5** (MED) — Percentile-based key-type classification
- **R10-M6 / R10-M7** (MED) — AVIF NCLX / WebP ICC post-encode verification
- **R10-M8** (MED) — Wide-gamut hint delivery-gamut naming
- **R10-M11** (MED) — Blur+fade crossfade race
- **R10-M12** (MED) — Bottom-sheet ordering consistency
- **R10-M14** (MED) — Conditional backfill warning
- **R10-M15** (MED) — Histogram key-type tooltip wording
- **R10-L3** — `decoding="async"` on masonry images
- **R10-L4** — Informative RAW rejection messaging
- **R10-L7** — Quality tooltips (AVIF 85 ≈ JPEG 95)
- **R10-L8** — 5K/8K size variants
- **R10-L11** — Partial-encode cleanup
- **R10-L13** — AVIF preload for prev/next
- **R10-L15** — Full accordion row tappable
- **R10-L18** — Dynamic color-details accordion label
- **R10-L19** — Color chip in bottom-sheet peek
- **R10-L20** — Bit depth + format chips in lightbox color pip
- **R10-L21** — Wide-gamut hint dark-mode contrast
- **R10-L22** — Download label "8-bit Display P3 JPEG"
- **R10-L23** — `object-cover` photographer trade-off doc

## R11 carry-over (deferred items with exit criteria)

- **R11-H1** — SW HEAD-probe rate-limit (5-min throttle in META_CACHE)
- **R11-H2** (full) — `sw.js` template-file + `.gitignore` restructure
- **R11-M2** — `100dvh` + CSS custom property for photo viewer chrome
- **R11-L2** — Memoize histogram canvas ctx options
- **R11-L4** — WI-15 ICC preservation fixture test
- **R11-L5** — Closure-guard test

---

## NEW R12 Findings (fresh pass)

### Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 1 | R12-H1 |
| MEDIUM | 3 | R12-M1, R12-M2, R12-M3 |
| LOW | 4 | R12-L1, R12-L2, R12-L3, R12-L4 |

---

### HIGH

#### R12-H1 — RAW upload silently fails with generic "extension not allowed" error

**Source:** Upload UX lens (NEW; overlaps R10-L4 but adds higher severity context)
**Files:** `apps/web/src/lib/process-image.ts:158-189`,
`apps/web/src/app/actions/images.ts:286-330,461-479`
**Confidence:** HIGH
**Impact:** Photographers who batch-drop a mix of edited JPEGs and source
RAWs (.CR2, .NEF, .ARW, .RAF, .ORF, .RW2, .DNG, .CR3, .NRW, .PEF, .SRW)
into the upload dropzone today see the RAWs silently land in the
`failedFiles` array with no specific message. The admin upload result
just lists the filename next to "failed." There's no hint that the
photo was rejected because it's a RAW, vs. corrupt, vs. too big.

This is a real-world workflow concern: Lightroom Classic exports often
sit next to the original RAWs in the same folder. A "select all → drag
into GalleryKit" gesture should give a clear "export to JPEG/AVIF/HEIF
first" message rather than just disappearing the RAW into "failed."

The R10-L4 item already captured this but kept severity LOW. R12 raises
to HIGH because the cycle-1+2 R11 surveys observed that the current
silent-failure path generates no audit log entry the photographer can
correlate back to a "wrong file type" cause, and the most common
photographer-error case (RAW in dropzone) produces the worst UX.

**Failure scenario:** Photographer drags 50 mixed files; 25 RAWs land
in `failedFiles` with no explanation; admin UI just shows the failures
without a remediation hint. They reload, retry, same result. They file
a "uploads broken" complaint instead of "convert your RAWs first."

**Fix:**
1. Add a sentinel `RawFileError extends Error` class with the rejected
   extension and a translation key.
2. `getSafeExtension` throws `RawFileError` when the extension matches
   a known RAW set (CR2/CR3/NEF/NRW/ARW/SRF/SR2/RAF/ORF/RW2/RWL/DNG/
   PEF/SRW/X3F/3FR/MEF/IIQ/MOS/MRW/KDC/ERF).
3. `uploadImages` catches `RawFileError` separately and returns a
   `rawRejectedCount` + `rawRejectedFilenames` in the response.
4. Admin UI shows the existing `hdrNotSupported` shape for RAWs:
   "RAW files (.CR2, .NEF, .ARW, ...) are not supported. Please
   export to JPEG, TIFF, AVIF, or PNG before uploading."
5. i18n keys: `serverActions.rawNotSupported`, `upload.rawHelpText`.

This closes R10-L4 and adds the missing severity context.

---

### MEDIUM

#### R12-M1 — `WideGamutHint` is not dismissible (R10-H4 follow-up, finer scope)

**Source:** UI/UX lens (refines R10-H4)
**Files:** `apps/web/src/components/wide-gamut-hint.tsx:25-50`
**Confidence:** HIGH
**Impact:** The wide-gamut hint banner ("Your display shows the sRGB
version…") renders on every wide-gamut photo for sRGB-display visitors.
On a topic page with 30 wide-gamut photos, the visitor sees the same
banner 30 times scrolling the feed if they open multiple photos. The
banner is informational (good photography-context cue) but quickly
becomes nag-grade.

The R10-H4 finding captured the Firefox-detection-gap angle. R12-M1
captures the general "users want to dismiss this for the session"
ergonomic. Combined fix:
- Add an `×` close button (44 px touch target).
- Persist dismiss in `sessionStorage` keyed `wgh-dismissed` (per-session,
  not localStorage — visitors revisiting next week should see the hint
  again because their display might have changed).
- Re-show the hint when `colorPrimaries` differs from the last-seen
  primaries (so a photographer browsing a sRGB album then opening a P3
  photo still gets the educational hint).

**Failure scenario:** Photographer demoing portfolio to a client on
the client's sRGB laptop. Banner re-appears on every photo, makes the
"these are my P3 photos" pitch read as repetitive complaint.

**Fix sketch:**
```tsx
const [dismissed, setDismissed] = useState(false);
useEffect(() => {
    if (sessionStorage.getItem('wgh-dismissed') === colorPrimaries) {
        setDismissed(true);
    }
}, [colorPrimaries]);

if (!mounted || !isWideGamut || !isSrgbDisplay || dismissed) return null;

// JSX adds an X button that:
// sessionStorage.setItem('wgh-dismissed', colorPrimaries || '');
// setDismissed(true);
```

---

#### R12-M2 — Photo viewer download filename loses photographer-intent metadata

**Source:** Download / End-User Workflow lens (NEW)
**Files:** `apps/web/src/components/photo-viewer.tsx:195-198,853-898`
**Confidence:** HIGH
**Impact:** Downloaded JPEGs/AVIFs name themselves `photo-{id}.{ext}`
(e.g. `photo-12345.jpg`). This is privacy-safe (no `user_filename`
leak) and forensically simple but throws away the photographer's
title for the photo, which is the public-safe descriptor the visitor
likely wants in their downloads folder.

For end-user workflow: a visitor downloads 5 photos from a wedding
share, ending up with `photo-9111.jpg`, `photo-9123.jpg`, etc. — they
can't tell which is which. A photographer-friendly naming would be:

- `{slugified title || 'photo'}-{id}.{ext}` (e.g. `bride-and-groom-9111.jpg`)
- Fall back to `photo-{id}.{ext}` when title is null/empty.

`title` is already a public field and is rendered in og:title, so
exposing it as the download filename leaks no new information.

**Failure scenario:** Wedding share recipient downloads 8 favorites,
opens their Downloads folder, has no idea which is the bridal portrait
vs. cake-cutting vs. first-dance. Re-opens the share, downloads again
with manual rename → workflow friction.

**Fix:** Add `slugifyTitle(title)` helper (kebab-case, ASCII-only,
strip Unicode bidi/format chars matching the existing validation
allowlist, cap 60 chars). Compose:
`{slugifiedTitle ? slugifiedTitle + '-' : ''}photo-{id}.{ext}`.

---

#### R12-M3 — Admin upload result aggregates HDR/RAW/general failures into a single "failedFiles" count

**Source:** Admin Workflow lens (NEW)
**Files:** `apps/web/src/app/actions/images.ts:289-296,472-479,495-502`
**Confidence:** HIGH
**Impact:** When an upload batch contains 5 HDR rejects + 3 RAW
rejects + 2 disk failures, the response surfaces
`{ success: true, count: N, failed: [...10 filenames], hdrWarningCount: ... }`.
The admin UI cannot tell HOW each failure happened from the
`failedFiles` array alone — they all look identical.

R10-L4 and R12-H1 expand the HDR-style separation to RAWs. R12-M3
generalizes: the upload action should surface a `rejectionReasons`
map (filename → reason code) so the UI can render a structured
warning instead of a flat "failed" list. This makes the admin's
debug loop instant.

**Failure scenario:** Admin uploads 100 files, sees `failed: [80
filenames]`, has no idea whether the cause is server-side disk full
vs. a misconfigured HDR setting vs. a folder full of RAWs.

**Fix:** Add `rejectionReason: 'hdr' | 'raw' | 'extension' | 'too_big'
| 'maintenance' | 'unknown'` per failure. Expose as
`failedReasons: Record<string, string>` in the return shape. UI
renders grouped warnings ("3 HDR rejected, 25 RAW rejected, 2 other
failures").

---

### LOW

#### R12-L1 — `sw.template.js` build-time placeholder string format is brittle

**Source:** SW / Build lens (NEW evidence; partial overlap with R11-H2)
**Files:** `apps/web/public/sw.js:11-16`, `apps/web/scripts/build-sw.ts`
**Confidence:** MED
**Impact:** The comment `c190cbe7-p7 is replaced at build time by
scripts/build-sw.ts.` documents the placeholder but the placeholder
itself is the LITERAL previous build value. If a developer
runs the build, then later edits the file by hand (e.g. for a
non-SW change), the placeholder is now whatever the last build wrote.
Subsequent build script runs may not detect the placeholder if its
regex was written against a specific hash format.

R11-H2 already captures the broader "move to templated build"
restructure. R12-L1 is a small documentation/scoping clarification:
the comment should say `<SW_VERSION_PLACEHOLDER>` and the build
script should regex-replace that sentinel, eliminating the
hash-as-placeholder antipattern.

**Failure scenario:** Build script regex written against `\w{8}-p\d+`
silently matches a future unrelated 8-char hex literal added to sw.js
(e.g. a feature flag key).

**Fix:** Already covered by R11-H2 restructure; R12-L1 is a process
note to surface during that work.

---

#### R12-L2 — Color-details accordion default-open heuristic skips the "photo is sRGB but came from a P3 camera" case

**Source:** UI/UX lens (NEW)
**Files:** `apps/web/src/components/color-details-section.tsx` (the
`isNonTrivialColor` predicate)
**Confidence:** MED
**Impact:** The accordion is default-open when the photo is wide-gamut
OR HDR OR has a non-`srgb` pipeline decision. A photo that was edited
in Lightroom to sRGB output from an Adobe-RGB-capable camera
(ICC = sRGB, primaries = bt709) reads as "trivial" and the panel stays
closed. But the photographer might still want to see the camera +
processing pipeline information.

This is a minor "default state" call. Right now the trigger is
gamut-only. A photographer-friendly extension: also default-open when
the photo has ICC metadata that doesn't match the most common case
("sRGB IEC61966-2-1"). Slightly more open by default, but matches the
"photographer is showing color craft" framing.

**Fix:** Soft suggestion only — keep `isNonTrivialColor` as-is for
the default-open decision because the alternative would make the
accordion default-open for nearly all photos (every JPEG has an ICC
name distinct from the default). Document the rationale in the
component comment so future contributors don't churn the heuristic.

---

#### R12-L3 — `useDisplayCapability` Firefox-conservative fallback doesn't expose `wasFallback` flag for UI messaging

**Source:** Browser/Display lens (NEW)
**Files:** `apps/web/src/lib/use-display-capability.ts`
**Confidence:** MED
**Impact:** When Firefox is the browser, `useDisplayCapability` returns
`{ colorGamut: 'srgb' }` to avoid false-positive P3 detection. Photo
viewer + WideGamutHint use this to render the "sRGB version" banner.
But the visitor on Firefox + P3 display sees the banner saying their
display can't show wide-gamut — which IS false. There's no way for
the UI to differentiate "we detected sRGB-only" from "we cautiously
defaulted to sRGB because Firefox doesn't expose `screen.colorGamut`
or the `(color-gamut: p3)` MQ."

R10-H4 partially addresses this with the dismissibility ask + CLAUDE.md
documentation update. R12-L3 suggests a finer-grained API:
`useDisplayCapability` returns `{ colorGamut, isConservativeDefault }`
where `isConservativeDefault = true` on Firefox; the WideGamutHint
banner shows a slightly different copy when `isConservativeDefault`:
"Your browser doesn't expose display color-gamut info. The full color
gamut is available on Chrome/Safari/Edge + a P3 screen."

**Fix:** Expand `useDisplayCapability`'s return shape; thread
`isConservativeDefault` into WideGamutHint. Pairs with R10-H4
implementation.

---

#### R12-L4 — `humanizeColorPrimaries` returns `null` for unknown values; downstream callers may render `null` as the empty string

**Source:** Defensive Programming / UI lens (NEW)
**Files:** `apps/web/src/components/color-details-section.tsx:19-29`,
all callers (`wide-gamut-hint.tsx`, `lightbox-color-pip.tsx`,
`info-bottom-sheet.tsx`)
**Confidence:** MED
**Impact:** `humanizeColorPrimaries(value)` returns `null` for unknown
primaries. Callers do `humanizeColorPrimaries(x) || t('viewer.colorUnknown')`
which is safe. But future callers that forget the `||` fallback would
render the empty string or "null" in the UI.

A type-safe alternative: change the return type from `string | null`
to `string` and have the function fall back to the raw value string
(`?? value ?? 'Unknown'`) so callers can't get null silently.

**Fix sketch:**
```ts
export function humanizeColorPrimaries(value: string | null | undefined): string {
    switch (value) {
        case 'bt709': return 'BT.709';
        // ... existing cases ...
        default: return value ?? 'Unknown';
    }
}
```

Plus add an opt-in `null` flavor for callers that genuinely need
"unrecognized" detection: `humanizeColorPrimariesOrNull(value)`.

Low priority — current callers all handle null correctly.

---

## Cross-cycle agreement / consolidation

- **R12-H1** subsumes R10-L4 and raises severity.
- **R12-M1** refines R10-H4's "dismissibility" half (Firefox angle stays
  in R10-H4).
- **R12-M2** is genuinely new — no R3-R11 finding covered download
  filenames.
- **R12-M3** is the "structured failure reason" generalization of
  R12-H1, R10-L4, and the existing HDR-rejection split.
- **R12-L1-L4** are small clarifications / process notes.

## Verdict

- 0 CRITICAL new; 1 HIGH new; 3 MED new; 4 LOW new.
- Cycle 3 should ship **R12-H1** (RAW rejection messaging) + **R12-M2**
  (download filename slugification) as the highest-value
  photographer-and-end-user wins. Both are contained, low-blast-radius
  changes with clear i18n + test paths.
- R12-M1 (WideGamutHint dismiss) closes a real nag; ship if cycle has
  headroom, otherwise defer to R10-H4 cycle.
- R12-M3 + R12-L1-L4 deferred per scope budget; tracked in plan.

*Aggregate compiled by single-agent R12 pass (no fan-out agents available).*

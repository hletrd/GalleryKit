# Photographer Review R15 — Aggregate Findings

**Date:** 2026-05-17
**Run:** review-plan-fix cycle 6/100
**Scope:** Fresh pass after cycle-5 R14 work landed
(wide-gamut hint delivered-gamut framing, conditional backfill warning,
partial encode cleanup, full accordion-row tap, "8-bit Display P3 JPEG"
download label).
**Premise:** Photos arrive AFTER editing. Product is a delivery
surface. No edit/cull/score/pick proposals here.

## Reviewer fan-out — environment constraint (unchanged from R11-R14)

No reviewer-style subagents are registered in
`/Users/hletrd/.claude/agents/` or `./.claude/agents/`. Single-agent
R15 pass conducted across photographer-delivery surfaces: encoder/
processing, viewer/lightbox, color audit, download UX, settings admin,
masonry grid, share/topic, SEO/i18n, service worker, a11y.

## Carry-over backlog (R10-R14, still active after this cycle)

Items NOT picked up this cycle remain in their original plan files.
Cycle-6 scope picks up the easy-win polish backlog (R10-L7, R10-L23,
R10-M15, R11-L2, R12-L4) and leaves the heavyweight items (R10-C1
synthetic P3 round-trip test, R10-H2 failed-image visibility, R10-H4
full Firefox copy, R10-H5 masonry chip, R10-M2 histogram P3 luma) for
dedicated cycles.

## NEW R15 Findings (fresh pass)

### Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | R15-M1 |
| LOW | 4 | R15-L1, R15-L2, R15-L3, R15-L4 |

---

### MEDIUM

#### R15-M1 — Histogram key-type indicator has no explanation tooltip

**Source:** Photographer-honesty + end-user lens
**Files:** `apps/web/src/components/histogram.tsx:609-613`
**Confidence:** HIGH
**Severity:** MEDIUM

The Color Details / lightbox histogram surfaces a tonal-character
label ("High-key" / "Low-key" / "Balanced") below the histogram, but
the label is plain text with zero hover/tap affordance. Visitors who
have never seen the high/low-key terminology — and even photographers
working in a different visual idiom — are left guessing what the term
means. This dovetails with the still-open R10-M15 (key-type tooltip
wording).

**Failure scenario:**
- Viewer browses a moody street-photography series, sees "Low-key"
  attached to every frame, has no idea whether this is a praise/
  warning/category and dismisses the histogram surface as
  inscrutable.

**Fix sketch:**
- Wrap the key-type span in a `<Tooltip>` (same shadcn primitive used
  elsewhere in Color Details) with a one-line explanation per
  category (matches R10-L7 family — describe what the heuristic
  actually measures).
- Add new i18n keys
  `viewer.keyType{high-key,low-key,balanced}Tooltip` in en + ko.
- Wrap the existing `keyType{label}` span in a TooltipTrigger so
  hover/long-press surfaces the meaning.

---

### LOW

#### R15-L1 — `humanizeColorPrimaries` returns `null` for unknown values, callers re-implement the fallback every time

**Source:** Code-correctness / API-symmetry lens
**Files:** `apps/web/src/components/color-details-section.tsx:19-29`,
`apps/web/src/components/wide-gamut-hint.tsx:105`,
`apps/web/src/components/lightbox-color-pip.tsx:41-44`
**Confidence:** HIGH
**Severity:** LOW (carries forward R12-L4 deferred)

Three call sites repeat the `humanizeColorPrimaries(value) ||
fallback` pattern with subtly different fallbacks. Each one has
already burned us once when a code path forgot the `||` and rendered
"null" or empty string to the user.

**Failure scenario:**
- New `<ColorDetailsBadge>` component gets added by a future
  contributor; they call `humanizeColorPrimaries(value)` and forget
  the fallback. Edge case primaries (custom monitor ICC; NCLX
  uncovered codes) render `null` as literal text.

**Fix sketch:**
- Add a sibling `humanizeColorPrimariesOrLabel(value, t)` helper
  that delegates to `humanizeColorPrimaries` and returns
  `t('viewer.colorUnknown')` on null. Existing callers can migrate
  opportunistically — the `null`-returning function stays as the
  low-level primitive so callers that genuinely want the
  null-discriminated branch (currently
  `info-bottom-sheet.tsx` for the wide-gamut hint) can opt in.

---

#### R15-L2 — Masonry-grid `object-cover` silently crops the photographer's framing without an in-code rationale

**Source:** Photographer-intent / future-maintainer lens
**Files:** `apps/web/src/components/home-client.tsx:288-313`
**Confidence:** HIGH
**Severity:** LOW (carries forward R10-L23 deferred)

The masonry grid renders thumbnails with `object-cover transition-
transform duration-500 group-hover:scale-105` so the card aspect
ratio is uniform across rows. `object-cover` crops the photographer's
framing whenever the natural aspect ratio mismatches the slot.
There's no code comment explaining the trade-off, so a future
contributor "improving" the grid by switching to `object-contain`
would silently break the masonry uniform-card aesthetic that the
photographer signed off on.

**Failure scenario:**
- Future maintainer assumes `object-cover` is a copy-paste oversight,
  flips to `object-contain`, masonry rows become uneven, photographer
  files a regression because key compositional elements at the frame
  edge are no longer guaranteed visible (some are, some aren't).

**Fix sketch:**
- Add a `/* R10-L23 / R15-L2: object-cover is intentional. … */`
  JSDoc-style comment block above the masonry `<img>` so the
  trade-off is documented at the source of truth.

---

#### R15-L3 — Histogram canvas `getContext('2d', ctxOptions)` re-allocates ctxOptions object on every histogram compute

**Source:** Performance / micro-allocation lens
**Files:** `apps/web/src/components/histogram.tsx:203-207`
**Confidence:** MEDIUM
**Severity:** LOW (carries forward R11-L2 deferred)

Every `computeHistogramAsync()` call rebuilds the `ctxOptions` object
literal. The histogram recomputes on photo-change, format-change, and
window resize. The allocation cost is trivial, BUT the bigger win is
that the call sites then become declaratively documenting two
distinct ctx configurations rather than a runtime branch every time.

**Failure scenario:**
- Slow Android device with multiple visible histograms in a gallery
  page (when WI-09 lands HDR gain-map preview) wastes minor GC
  budget on hot-path object allocations.

**Fix sketch:**
- Hoist the two ctx options literals to module scope as
  `P3_CTX_OPTIONS` and `SRGB_CTX_OPTIONS` (undefined for sRGB).
  Branch returns one of the two.

---

#### R15-L4 — Histogram key-type estimate uses mean luminance instead of percentile distribution

**Source:** Photographer-honesty lens (carries forward R10-M5
deferred — recorded here as LOW because the perceptual difference
between mean and p10/p90 is small for everyday photos and the fix is
not yet justified vs the test churn)

**Files:** `apps/web/src/components/histogram.tsx:347-354`
**Confidence:** MEDIUM
**Severity:** LOW

`estimateKeyType()` uses `avgLuminance > 170` / `< 85` against the
mean of the luminance histogram. For a photo with a few bright
specular highlights and a mostly mid-tone subject, the mean can drift
high enough to classify "high-key" even though the bulk of the image
is mid-tone. A percentile-based classifier (e.g. p50 + p90-p10
spread) would be more honest about tonal character.

**Failure scenario:**
- Wedding portrait with a white-on-white dress + bright window blowout
  classifies as "high-key" even though the subject is the bride's
  face which sits at mid-tones.

**Fix sketch:**
- Replace the mean-based threshold with a percentile-based classifier
  (compute cumulative distribution, find p10/p50/p90, classify by
  shape of distribution).
- Add a unit test asserting the new classifier handles mixed-tone
  photos correctly.
- (Deferred this cycle: the test-fixture churn is the larger cost,
  and R15-M1 surfacing the tooltip already softens the misclassify
  impact by educating the viewer what the term actually means.)

---

## Cross-cycle agreement / consolidation

- **R15-M1** closes R10-M15 (key-type tooltip wording).
- **R15-L1** closes R12-L4 (humanizeColorPrimaries non-null helper).
- **R15-L2** closes R10-L23 (object-cover trade-off doc comment).
- **R15-L3** closes R11-L2 (memoize histogram ctx options).
- **R15-L4** restates R10-M5 (percentile key-type) at LOW severity —
  carry-over remains in the R10 backlog.

## Verdict

- 0 CRITICAL new; 0 HIGH new; 1 MED new; 4 LOW new.
- 4 carry-over items closed this cycle (R10-M15, R12-L4, R10-L23,
  R11-L2); R15-L4 restates R10-M5 without changing its priority.
- R10-C1 (synthetic P3 round-trip test) and R10-H2 (failed image
  admin visibility) remain the outstanding HIGH-priority items. Both
  require a dedicated cycle.

*Aggregate compiled by single-agent R15 pass (no fan-out agents available).*

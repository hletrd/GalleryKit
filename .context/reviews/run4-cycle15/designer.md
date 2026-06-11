# Run-4 Cycle 15 — designer (UI/UX) angle

Single-subagent in-context execution (documented run-wide constraint).
UI/UX pass over the cycle-15 rotation set: app shell, navigation,
error/loading/empty states, the public map, and the home tag filter.
Findings are text-evidence-based (selectors, classes, computed
box-metric arithmetic) per the multimodal caveat; no screenshots were
required to confirm any finding below.

## DES-R4C15-03 — public home tag-filter chips present a 32 px touch target — MED(LOW)/High (CONFIRMED)

**File:** `apps/web/src/components/tag-filter.tsx:62,79`

The "All" chip and every tag chip are real `<button>` elements
(keyboard-activatable, `aria-pressed` state) rendered through
`<Badge asChild>` with `min-h-[32px] px-3 py-1` — a 32 px-tall target
on the most mobile-relevant public surface (home gallery filtering).
CLAUDE.md's policy is unambiguous: "all interactive elements (buttons,
links, checkboxes, etc.) must present a tappable/clickable area of at
least 44x44 px" and is enforced as a blocking test — which this shape
evades (see test-engineer.md TEST-R4C15-02).

History note: `57c15552` deliberately compacted the pills, but that
predates the hardened 44 px policy, and the nav's own topic pills now
ship `min-h-[44px]` with the same rounded-full/px-3 language
(`nav-client.tsx:122`) — so 44 px pills ARE the product's established
chip styling. A pseudo-element hit-zone would need ±6 px vertical
expansion while flex-wrap rows sit only 8 px apart → overlapping hit
zones between rows, worse than the height bump.

**Fix:** `min-h-[32px]` → `min-h-11` on both Badge classNames + audit
extension + fixtures (one commit). Re-check chip wrap behavior: taller
chips wrap identically (same px-3/gap-2).

## DES-R4C15-04 — admin nav links at 40 px — LOW/High (CONFIRMED)

**File:** `apps/web/src/components/admin-nav.tsx:37`

`min-h-10` (40 px) on all nine admin nav links. Links evade the audit
(not `<button>`/`<Button>`). Admin is historically keyboard-primary
(documented exemption rationale in the audit), but this is a one-token
fix with zero layout risk (`gap-y-2` flex-wrap absorbs the 4 px), so
fixing beats exempting. **Fix:** `min-h-10` → `min-h-11`.

## DES-R4C15-05 — footer links have no minimum hit area — LOW/High (CONFIRMED)

**File:** `apps/web/src/components/footer.tsx` (GitHub link + Admin link)

Both footer links render at text height (~20 px tall) — `text-sm` /
`text-xs` inline links with no min-height. These are isolated tap
targets on every public page's mobile footer. **Fix:** add
`min-h-11 items-center` to the existing `flex`/inline link classes
(GitHub link already `flex items-center gap-2`; Admin link needs
`inline-flex items-center min-h-11`). Vertical rhythm: the footer
container is `py-6 md:h-24` with `gap-4` — a 44 px-tall link row fits
without growing the desktop footer (h-24 = 96 px > 44 px content).

## DES-R4C15-06 — admin error boundary announces two identically-labelled nested regions — LOW/High (CONFIRMED)

**File:** `apps/web/src/app/[locale]/admin/(protected)/error.tsx:16-17`

Outer `<section aria-labelledby="admin-route-error-title">` wraps inner
`<section aria-labelledby="admin-route-error-title">` — AT users get
the same region announced twice when traversing landmarks/regions. The
public twin (`app/[locale]/error.tsx`) correctly uses `<main>` + single
labelled section. **Fix:** outer element becomes a plain `<div>`
(pure layout wrapper), keeping the inner labelled section.

## Reviewed clean (designer angle)

- **Skip links**: root layout + not-found + admin layout all ship
  visible-on-focus skip links targeting `tabIndex={-1}` landmarks —
  correct and consistent.
- **Loading states**: all three `loading.tsx` + PhotoViewerLoading use
  `role="status"` with localized labels and `aria-hidden` spinners;
  the photo loading shell preserves lightbox context (black) vs viewer
  context (skeleton) — good perceived-performance design.
- **not-found.tsx**: full nav/footer shell, decorative 404 numeral
  `aria-hidden` with real `<h1>`, 60 % opacity contrast note verified.
- **global-error.tsx**: brand + locale detection good; theme fidelity
  defect is COR-R4C15-01 (cross-angle, primary in code review).
- **nav-client.tsx**: expand toggle 44 px with `aria-expanded` +
  `aria-controls` (space-separated dual reference — valid); topic
  pills 44 px with `aria-current="page"`; theme button announces via
  `title` + stable `aria-label`; locale switch labels the TARGET
  language (correct pattern).
- **login-form.tsx**: persistent labels (F-12), 44 px visibility
  toggle with `aria-pressed` (F-13), error `role="alert"`.
- **tag-filter.tsx non-size aspects**: `role="group"` +
  `aria-label`, `aria-pressed` chip state, humanized labels — all good;
  only the target size fails.
- **Map popup**: 44 px button wrapper inside popup, `aria-label` with
  photo title fallback — good; thumbnail perf is PERF-R4C15-02.
- **Theme cycle UX**: system → light → dark → oled order with
  per-state icons (Monitor/Sun/Moon/Circle) — discoverable and
  consistent with `theme.ts` docs.

## Information-architecture / i18n spot checks

All rotated user-facing strings route through next-intl (`t(…)`) —
no hardcoded English found in the rotation set except
`global-error.tsx`'s intentional self-contained COPY table (correct:
next-intl context is unavailable when the root layout has crashed) and
footer's `siteConfig.footer_text` (file-config by design). `dir="ltr"`
explicit on `<html>` with documented RTL future-proofing note.

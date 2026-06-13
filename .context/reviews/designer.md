# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** review-plan-fix cycle 7 (run-9 cycle-3 follow-on) · **HEAD:** `d0920957` · **Date:** 2026-06-13
**Reviewer:** Designer (UI/UX + accessibility) · **Working tree:** CLEAN at review start
**Method:** Static-source analysis of every interactive surface (public route group, all `components/`, lightbox, photo-viewer, nav, search, map, error/empty/loading states) + live audit-gate execution (`npx vitest run touch-target-audit` → **14/14 pass**) + en/ko i18n key-parity verification (**837/837, zero drift**).

**NET-NEW UI/UX FINDINGS THIS CYCLE: 1 (DES-C7-1, MED — the recurring bare-link theme, now on the admin brand/logo link)**
**Prior-deferred DES-C5-2 / DES-C5-3 / DES-C5-4: RE-CONFIRMED OPEN, UNCHANGED — not re-escalated.**
**Prior NEW finding DES-C6-1 (s/[key] + year/[year] back-links): VERIFIED FIXED (commit `1a483f9b`).**

---

## Cycle-6 fix verification (the recurring theme, one cycle back)

### DES-C6-1 / AGG-C6-03 — two public back-nav `<Link>`s → **VERIFIED CLEAN** (commit `1a483f9b`)

The cycle-6 NEW finding (the third recurrence of the bare-back-nav theme) is fixed at HEAD:

| File | Line | className (verbatim at HEAD) |
|---|---|---|
| `app/[locale]/(public)/s/[key]/page.tsx` | 105 | `"text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 min-h-11"` |
| `app/[locale]/(public)/year/[year]/page.tsx` | 107 | `"text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 min-h-11"` |

Both now carry `min-h-11`. The commit added a per-link positive-pin `it`-block to `touch-target-audit.test.ts` (anchor-scoped, PROVEN RED-on-revert → 14/14 GREEN restored). The full layout-aware bare-link heuristic remains deferred (plan-342 Deferred-1), which is why DES-C7-1 below is still invisible to the gate.

### Touch-target gate — live run at HEAD `d0920957`

```
npx vitest run touch-target-audit → 14/14 pass (4.56s)
```

---

## Findings

Severity legend: **HIGH** = WCAG A/AA failure on public/shipped surface · **MED** = AA failure on admin surface, or repo-44 px-floor failure on public surface · **LOW** = AAA / polish / consistency.

---

### DES-C7-1 — Admin header brand/logo `<Link>` renders ~24 px tall — no `min-h-*` token; the admin-surface twin of the public nav brand link that WAS fixed — **MED** (confidence: High) — NEW

**Summary.** The admin header's brand link (the "Admin" logo that routes back to the dashboard) is a bare `<Link>` with no height token, rendering at its line-box height (~24 px). It is the **direct admin-surface analogue of the public nav brand link**, which was explicitly sized to `min-h-[44px]` in commit `bc7e2584` ("fix(nav): ♿ size topic links and site title to 44px touch targets"). The admin twin was never given the same treatment. This is the same recurring "the sibling that was missed when its counterpart was fixed" pattern that produced DES-C5-1 (g/[key] fixed, timeline/home/topic-empty missed) and DES-C6-1 (g/[key] fixed, s/[key]+year missed) in the two prior cycles.

**Evidence.**

`components/admin-header.tsx:16`:
```tsx
<Link className="mr-6 flex items-center space-x-2 font-bold" href={localizePath(locale, '/admin/dashboard')}>
    <span>{t('nav.admin')}</span>
</Link>
```

- No `h-*`, `min-h-*`, `py-*`, or `size-*` token on the `<Link>`.
- It wraps a single `<span>` of default `text-base` (`16 px` font / `24 px` default Tailwind leading), `font-bold` (weight only — no line-height effect).
- **Ancestor chain does not stretch it:** `admin-header.tsx:14` outer `<div className="flex min-h-14 ... items-center">` uses `items-center` (centers children, does NOT stretch them), and the inner `<div className="flex flex-1 ... items-center">` (`:15`) likewise centers. The `<Link>`'s own box height is therefore its content height = **24 px**, vertically centered in the 56 px (`min-h-14`) bar.

Rendered tap target ≈ **24 px tall**. That is:
- Below the repo's own **44 px floor** (WCAG 2.5.5 Target Size (Enhanced), AAA — the standard the repo claims to enforce repo-wide; the public counterpart honors it).
- At/below **WCAG 2.5.8 Target Size (Minimum), AA = 24 px** — at the AA boundary; the height is `24 px` only because of the default line-box, so any future i18n string that renders shorter, or a `leading-tight` add, drops it under 24 px.

**Direct counterpart that WAS fixed (the asymmetry is the tell).** `components/nav-client.tsx:85` — the public nav brand link:
```tsx
<Link href={localizedHomeHref} className="flex items-center space-x-2 shrink-0 min-h-[44px]">
    <span className="font-bold text-xl tracking-tight">{navTitle}</span>
</Link>
```
Identical structural role (brand → home/dashboard), but it carries `min-h-[44px]`. Git: `bc7e2584` sized the public site title; the admin header was outside that commit's scope and has carried the bare link since `d7c32790` (initial commit), through `2cece473` ("♿ fix: improve gallery admin accessibility") which touched the file but not this link.

**Why the audit doesn't catch it.** `components/admin-header.tsx` IS in `SCAN_ROOTS` (componentsDir, scanned recursively) and even HAS a `KNOWN_VIOLATIONS['components/admin-header.tsx'] = 1` entry — but that budgeted violation is for the **Logout `<Button size="sm">`** at `:22` (which renders `min-h-11` at runtime via the Button primitive floor — belt-and-braces). The brand `<Link>` is a SEPARATE element, and the `<Link>` FORBIDDEN patterns at `touch-target-audit.test.ts:424-466` require an *explicit* sub-44 sizing token (`h-8/h-9/h-10` or `min-h-[<44px]`); a comment at `:430-432` states "plain text links never trip." This link has no sizing token at all, so it passes the gate by the audit's own documented contract — the exact bare-link blind spot of the recurring theme.

**User impact.** Admin dashboard, all sub-routes. The brand link is the persistent return-to-dashboard affordance in the header. Admin is keyboard-primary (which mitigates — keyboard activation is unaffected by tap-target size), but the header IS used on touch: admins on tablets/phones managing uploads, settings, topics. A 24 px logo tap target on a 56 px bar means ~32 px of vertical whitespace around the logo is dead space; mis-taps land on the adjacent `<AdminNav>` links or nothing. It also visually under-delivers the repo's stated repo-wide 44 px policy on the one header element that frames every admin screen.

**Fix.** Add `min-h-11` to match the public counterpart (`nav-client.tsx:85`) and the adjacent `AdminNav` links (`admin-nav.tsx:38`, already `min-h-11`):
```tsx
// components/admin-header.tsx:16
<Link className="mr-6 flex min-h-11 items-center space-x-2 font-bold" href={localizePath(locale, '/admin/dashboard')}>
```
(`min-h-11` not `h-11`, so multi-line wrap on narrow viewports — the header is `flex-wrap` — still grows rather than clips.)

Optionally extend the `touch-target-audit.test.ts` positive-pin block with an anchor-scoped assertion on `admin-header.tsx`'s `'/admin/dashboard'` brand link, consistent with the DES-C5-3 / DES-C6-1 pins, so this specific link can't silently regress. (Note: the budgeted `KNOWN_VIOLATIONS` count stays `1` — the Logout button — and is unaffected by this fix.)

**Confidence:** High. ClassName read verbatim from HEAD; line-box math straightforward (`text-base` default = 24 px, `font-bold` weight-only); ancestor `items-center` (not `items-stretch`) confirmed so no stretch; public counterpart `min-h-[44px]` confirmed at `nav-client.tsx:85`; git origin confirms the public fix (`bc7e2584`) excluded the admin twin; audit blind-spot mechanism confirmed (file scanned, but bare-link with no sizing token passes by contract; the existing `KNOWN_VIOLATIONS=1` is the separate Logout button).

---

## Prior-deferred items — RE-CONFIRMED OPEN (no change, no re-escalation)

### DES-C5-2 — Nav theme/locale/expand `<button>`s + title/topic `<Link>`s have no `focus-visible` ring — **LOW** — UNCHANGED

`nav-client.tsx:85,93,122,155,168` — re-read at HEAD `d0920957`. All five carry `min-h-[44px]`/`min-w-[44px]` (touch-targets fine), but none carries `focus-visible:ring-*`; no `focus-visible` lines anywhere in `nav-client.tsx`. UA-default outline still applies → not a hard WCAG 2.4.7 failure, but visually inconsistent with the ~29 ring sites elsewhere (lightbox, color-pip, histogram, info-sheet, color-details all use `focus-visible:ring-2`/`outline-2`) and with shadcn Button's `focus-visible:ring-[3px]`. Status: **deferred** (plan-340/342, unchanged). Fix when UI-polish pass runs: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none`.

### DES-C5-3 — Color-pip `text-white/50` gamut suffix (thinnest margin) + histogram dotted-underline affordance — **LOW** — UNCHANGED

- `lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` — **5.15:1** on the `bg-black/70` pip (passes 4.5:1, thinnest margin in the app; `text-[10px]`). Unchanged.
- `histogram.tsx:691` — `decoration-dotted decoration-muted-foreground/40` — ~2:1 decoration cue on a `cursor-help` tooltip trigger. Unchanged. (The trigger TEXT is `text-muted-foreground` which passes; only the dotted underline decoration is faint, and underline decoration is not itself a WCAG contrast target.)

Status: **deferred** (plan-340/342, unchanged). Optional polish: `text-white/70` / `decoration-muted-foreground/70`.

### DES-C5-4 — Info-sidebar topic `<Badge>` renders raw slug — **LOW** — UNCHANGED

`photo-viewer.tsx:816` — `<Badge variant="outline">{image.topic}</Badge>` still renders the raw slug (e.g. `music-festival`) rather than the humanized `image.topic_label || image.topic`. The sibling Back button at `:603` already uses the humanized form (`t('viewer.backTo', { topic: image.topic_label || image.topic })`), and the search result subtitle (`search.tsx:97`) humanizes its topic too — so the photo-viewer sidebar badge is the lone raw-slug surface. Status: **deferred** (plan-340/342, unchanged). Fix: `{image.topic_label || image.topic}`.

---

## Surfaces audited and found COMPLIANT (re-verified at HEAD `d0920957`)

### Touch-targets — every interactive element confirmed ≥ 44 px (except DES-C7-1)

| Surface | File:line | Sizing token | Verdict |
|---|---|---|---|
| Public nav brand | `nav-client.tsx:85` | `min-h-[44px]` | ✓ (admin twin = DES-C7-1) |
| Nav expand / theme / locale btns | `nav-client.tsx:93,155,166` | `min-w-[44px] min-h-[44px]` | ✓ |
| Nav topic pills | `nav-client.tsx:122` | `min-h-[44px]` | ✓ |
| Footer GitHub / Admin links | `footer.tsx:47,52` | `min-h-11` | ✓ |
| On-this-day "view timeline" + photo rows | `on-this-day-widget.tsx:42,56` | `min-h-[44px]` | ✓ |
| Admin nav links | `admin-nav.tsx:38` | `min-h-11` | ✓ |
| Search trigger / close btns | `search.tsx:290,359` | `h-11 w-11` | ✓ |
| Search result rows | `search.tsx:64` | 48 px thumbnail child + `p-2` → ≥ 64 px | ✓ (content-sized) |
| Lightbox close / share / pip / slideshow btns | `lightbox.tsx:547,568,592` | `h-11 w-11` | ✓ |
| Lightbox prev/next | `lightbox.tsx:615,635` | `<button>` is `h-full w-16` (full-height edge zone) | ✓ |
| Lightbox trigger | `lightbox.tsx:50` | `h-11 w-11` | ✓ |
| Photo-viewer back / buy / info / share / pin btns | `photo-viewer.tsx:601,617,662,679,708` | `h-11` (back via `<Button asChild h-11>`) | ✓ |
| Photo-viewer download Button + DropdownMenuItems | `photo-viewer.tsx:1030,1039,1049,1062` | `min-h-11` / `h-auto min-h-11 py-2` | ✓ |
| Info-bottom-sheet drag handle / close / download | `info-bottom-sheet.tsx:218,244,497,506,516,529` | `min-h-11` / `min-h-11 min-w-11` | ✓ |
| Color-details toggle / copy / info btns | `color-details-section.tsx:286,304,319,396` | `min-h-[44px] min-w-[44px]` / `min-h-11 min-w-11` | ✓ |
| Color-pip toggle / close / copy | `lightbox-color-pip.tsx:128,181,264` | `min-h-11 min-w-11` | ✓ |
| Histogram collapse / mode btns | `histogram.tsx:615,702` | `min-h-11 min-w-11` | ✓ |
| Home photo cards (masonry) | `home-client.tsx:296` | wraps full image tile (large) | ✓ (content-sized) |
| Home scroll-to-top FAB + P3 badge | `home-client.tsx:441,387` | `min-h-11 min-w-11` | ✓ |
| Home clear-filter recovery link | `home-client.tsx:434` | `min-h-11` | ✓ |
| Tag-filter chips | `tag-filter.tsx:65,83` | `min-h-11` | ✓ |
| Topic empty-state recovery link | `topic-empty-state.tsx:18` | `min-h-11` | ✓ |
| Timeline year chips | `timeline/page.tsx:131` | `h-11 min-w-[44px]` | ✓ |
| Timeline year-in-review link | `timeline/page.tsx:152` | `min-h-11` | ✓ |
| Timeline / year / g photo grid links | `timeline:209`, `year:165`, `g/[key]:186` | wrap image tiles (large); g has `focus-visible:ring-2` | ✓ |
| Year-in-review back link | `year/[year]/page.tsx:107` | `min-h-11` (DES-C6-1 fix) | ✓ |
| Shared-group back links | `g/[key]/page.tsx:140,172` | `min-h-11` | ✓ |
| Shared-photo back link | `s/[key]/page.tsx:105` | `min-h-11` (DES-C6-1 fix) | ✓ |
| Map marker popup button | `map/map-client.tsx:128` | `min-h-[44px] min-w-[44px]` | ✓ |
| Locale-level error/not-found/global-error btns + links | `error.tsx:32,38`, `not-found.tsx:43`, `global-error.tsx:78` | `min-h-11` | ✓ |
| p/[id] prev/next prefetch links | `p/[id]/page.tsx:305,310` | `className="hidden" tabIndex={-1} aria-hidden` | ✓ (intentionally non-interactive prefetch hints) |

### Other a11y/UX surfaces — re-confirmed clean

- **Focus management (lightbox):** `FocusTrap` (`lightbox.tsx:447`) with `aria-modal`, `fallbackFocus → closeButtonRef || document.body`, `allowOutsideClick`. `controlVisibilityProps` (`:368`) correctly sets `tabIndex: -1` + `aria-hidden` on auto-hidden chrome so idle-hidden controls leave the tab order, and clears it (`{}`) when visible. Every lightbox button carries `focus-visible:ring-2`.
- **Focus management (search):** `FocusTrap` (`search.tsx:307`) with `initialFocus: '#search-input'`, `fallbackFocus: '#search-dialog'`, `allowOutsideClick`. `Input` has `focus-visible:ring-2`. Combobox ARIA (`role="combobox"`, `aria-autocomplete`, `aria-controls`, `aria-expanded`, `aria-activedescendant`) wired; results are `role="option"` with `aria-selected`; IME-composition guard on arrow/Enter (`isImeComposingReactEvent`).
- **Live regions:** search status uses `aria-live="polite" aria-atomic="true"` (`search.tsx`); loaders carry `role="status"` + `aria-label`.
- **Empty / loading states:** `topic-empty-state.tsx` (recovery link), `home-client.tsx:434` (clear-filter), `map/page.tsx:55` (`noPhotos`), `app/[locale]/loading.tsx:8` + `p/[id]/loading.tsx:22` (`role="status" aria-label`) — all present and localized.
- **Error states:** `app/[locale]/error.tsx`, `app/global-error.tsx`, `app/[locale]/admin/(protected)/error.tsx` — all carry `min-h-11` retry/home actions + `role`/`aria-labelledby`.
- **i18n parity:** en.json / ko.json = **837 keys each, zero missing in either direction**. `admin-header.tsx` uses `t('nav.admin')` (the DES-C7-1 finding is a sizing issue, not a hardcoded-string issue). ICU-plural asymmetry (en plural blocks vs ko fixed `{count}장`) is the documented intentional convention — not a defect.
- **Button primitive floor** (`ui/button.tsx:24-28`): `sm`/`default` → `min-h-11`, `icon` → `size-11`, `lg` → `min-h-12`. All variants floor ≥ 44 px (mitigates the `admin-header.tsx:22` Logout `size="sm"` budgeted violation, which renders `min-h-11` at runtime).
- **DropdownMenuItem default height** (`ui/dropdown-menu.tsx:77` `py-1.5` ≈ 32 px): every usage (`info-bottom-sheet.tsx:506,516`, `photo-viewer.tsx:1039,1049`) carries `h-auto min-h-11 py-2`. Complete coverage.
- **`role="button"` divs:** `image-zoom.tsx` and `upload-dropzone.tsx` (role + tabIndex + aria-label + keyboard handlers + focus ring) — wired correctly, not a gap. (Verified in prior cycles; no changes in the cycle-6 commits.)
- **reduced-motion / forced-colors / aria-live / dialog focus-traps** — no changes to these surfaces in the cycle-6 commits (`bb463062`, `170297ed`, `13ae79ca`, `8b979687`, `5b5de9d3`, `1a483f9b`, `23f62c66`, `26f68430`, `b6c4f915` — predominantly migration/security/privacy/test, only `1a483f9b` touched UI); prior-cycle verification holds.

---

## Summary / priority for the plan

**1. DES-C7-1 (MED, NEW):** `components/admin-header.tsx:16` — admin brand/logo `<Link>` (`mr-6 flex items-center space-x-2 font-bold`, no `min-h-*`) renders ~24 px tall, centered in the 56 px header bar. It is the **admin-surface twin of the public nav brand link** (`nav-client.tsx:85`), which was sized to `min-h-[44px]` in `bc7e2584` — the admin one was never given the same fix. Below the repo's repo-wide 44 px floor; at the WCAG 2.5.8 AA 24 px boundary (so structurally fragile). Falls in the audit's bare-link blind spot (the file's existing `KNOWN_VIOLATIONS=1` is the separate Logout button, not this link). This is the **fourth consecutive cycle** the "sibling missed when its counterpart was fixed" theme has surfaced — recommend a dedicated sweep entry. **Fix = add `min-h-11` to the className** (four-word change), optionally + an anchor-scoped positive-pin on the `'/admin/dashboard'` link in `touch-target-audit.test.ts`. Cheap.

**2. DES-C5-2 / DES-C5-3 / DES-C5-4 (LOW, all DEFERRED, UNCHANGED):** nav `focus-visible` ring (5 elements, `nav-client.tsx`); color-pip `text-white/50` thin-margin suffix (`lightbox-color-pip.tsx:237`) + histogram dotted-underline (`histogram.tsx:691`); photo-viewer sidebar topic `<Badge>` raw slug (`photo-viewer.tsx:816`). No change from prior cycles. Confirm deferred.

**Convergence note.** This is a near-converged, heavily a11y-reviewed surface. Every interactive element across the public route group, all components, the lightbox, photo-viewer, nav, search, map, and all error/empty/loading states is ≥ 44 px and properly focus-managed — **except the single admin brand link (DES-C7-1)**. The public-surface recurring theme is now fully closed (s/[key], year/[year], g/[key], timeline, home, topic-empty all fixed); DES-C7-1 is the same theme's last untouched instance, on the admin side. No cosmetic findings were manufactured; if DES-C7-1 is scheduled and the deferred trio confirmed, the UI/UX surface is clean to the repo's own standard.

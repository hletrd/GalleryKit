# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Cycle:** 3 of review-plan-fix · **HEAD:** `ada92ba5` · **Date:** 2026-06-13
**Reviewer:** Designer (UI/UX + accessibility) · **Method:** static-source analysis (computed hex/px/ARIA evidence)

## Methodology note

This is a **static-source review**. The dev server (`next dev`, port 3000) requires a live MySQL connection
(`.env.local` is present, `node_modules` present, but no reachable DB in this sandbox), so I did **not** run
the agent-browser skills for live a11y snapshots. Every finding below is backed by text-extractable evidence:
precise `file:line`, the className/token, and **WCAG contrast ratios computed from the actual CSS variables**
in `apps/web/src/app/[locale]/globals.css` (HSL → sRGB → relative-luminance, both the HSL fallbacks and the
`@supports (oklch)` overrides). Box metrics and ARIA attributes are quoted verbatim.

## Prior-cycle fix verification (REQUESTED — both VERIFIED, no regression)

- **AGG-R8-03** (image-manager.tsx select-all + per-row checkboxes): VERIFIED at HEAD.
  - `image-manager.tsx:418` (header select-all) and `:444` (per-row) both wrap the 20 px raw `<input type="checkbox">`
    (`h-5 w-5`) in a `<label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">`
    with an `sr-only` text label + redundant `aria-label`. The 44 px tap area is the label wrapper. **Not regressed.**
  - The `scanRawCheckboxes` window-scan in `touch-target-audit.test.ts:611` correctly enforces this pattern.
- **AGG-R8-04** (tag-filter active-chip count contrast): VERIFIED at HEAD.
  - `tag-filter.tsx:104-110`: active chip count uses `text-primary-foreground/90`, inactive uses `text-muted-foreground`.
  - **Computed:** active count = **13.81:1 (light)** / **12.8:1 (dark)** on `bg-primary`; inactive count = **6.04:1 (light)** / **7.76:1 (dark)** on page bg. All ≥ 4.5:1. **Not regressed.**

---

## Findings

Severity legend: **HIGH** = WCAG A/AA failure affecting real users on a shipped surface; **MED** = AAA failure / audit-coverage gap / UX defect; **LOW** = polish / consistency.

---

### DES-1 — `text-destructive` error text is invisible in dark mode (1.99:1) — WCAG 1.4.3 FAIL — **HIGH** (confidence: High)

**Where (token):** `apps/web/src/app/[locale]/globals.css:36,59` — `--destructive` is `0 72.2% 50.6%` (light) but `0 62.8% 30.6%` (dark); oklch path `oklch(58% …)` / `oklch(40% …)` at `globals.css:117,124`.

**The problem:** The dark `--destructive` value (30.6 % L) is tuned to be a **button background** (white `text-destructive-foreground` on it = **8.71–9.6:1**, correct). But the same token is reused as a **text foreground** (`text-destructive`) on the dark `bg-card` / `bg-background`. One token cannot satisfy both roles.

**Computed contrast of `text-destructive` as standalone text:**
| Mode | Ratio | Verdict (4.5:1 small / 3:1 large) |
|---|---|---|
| Light on white | 4.83:1 (HSL) / 4.73:1 (oklch) | passes small, barely |
| **Dark on `bg-card`** | **1.99:1 (HSL) / 2.19:1 (oklch)** | **FAIL — below 3:1 even for large text** |
| Alert *description* (`text-destructive/90`, alert.tsx:13) dark | **~1.85:1** | **FAIL** |

**Reach (12 bare `text-destructive` text sites with no `dark:` override), all unreadable in dark mode:**
- `components/ui/alert.tsx:13` — the **shared Alert primitive** destructive variant (`text-destructive bg-card`) → every consumer
- `app/[locale]/admin/login-form.tsx:98` — login error (`role="alert" aria-live="assertive"`) — the highest-traffic admin error
- `components/admin-user-manager.tsx:122` — create-user validation error (`role="alert"`)
- `components/bulk-edit-dialog.tsx:329` — `role="alert"` validation error
- `components/upload-dropzone.tsx:524` — per-file upload error (`role="alert"`)
- `app/[locale]/admin/(protected)/password/password-form.tsx:102` — confirm-password error
- `app/[locale]/admin/(protected)/seo/page.tsx:15`, `settings/page.tsx:17` — `role="alert"` page-level error banners
- `app/[locale]/admin/(protected)/sales/sales-client.tsx:191` — `errorLoad` message
- `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:74` — failed-images heading

**Impact:** An admin who hits a login error, a validation failure, or a load error **in dark mode** sees red error text at ~2:1 — effectively illegible. Errors are exactly the moment legibility matters most. The `bg-destructive/10` faint-tint wrappers (login-form) do not rescue this — over near-black the tint stays near-black and the 30.6 %-L text on it is still ~2:1.

**Fix:** Add a dark-mode foreground light enough on the dark surface. Two clean options:
1. Introduce a dedicated `--destructive-text` token (light: keep ~50.6 % L; dark: ~70 % L, e.g. `0 80% 70%` → ~6:1 on `bg-card`) and use it for all `text-destructive` *text* sites, keeping `bg-destructive` for button backgrounds; **or**
2. Add `dark:text-red-400` (#f87171 → ~6.4:1 on dark card) to the Alert primitive destructive variant and the 11 text sites — matches the existing `dark:text-amber-300/400` pattern already used in `color-details-section.tsx` / `sales-client.tsx`.
Option 1 is the durable fix (single source of truth); option 2 is the minimal patch mirroring an existing convention.

---

### DES-2 — Admin delete-alias button is a 24 px touch target the audit cannot see — WCAG 2.5.5 FAIL + audit blind spot — **MED** (confidence: High)

**Where:** `app/[locale]/admin/(protected)/categories/topic-manager.tsx:333`
```jsx
<button type="button" onClick={() => setDeleteAliasInfo(...)}
  className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-muted-foreground hover:text-destructive ..."
  aria-label={t('categories.deleteAliasButton', { alias })}>
  <X className="h-3 w-3" />
</button>
```
**Box metric:** `min-h-6 min-w-6` = **24 × 24 px**. Real interactive control (onClick, aria-label, focus ring). Below the repo's enforced 44 px floor (WCAG 2.5.5 AAA); it meets only 2.5.8 AA (24 px), and the repo policy is explicitly 44 px.

**Why the audit misses it (the structural gap):** `touch-target-audit.test.ts` FORBIDDEN patterns only match (a) `h-8`/`h-9`/`h-10`/`w-10`/`size-10` **literals**, and (b) **bracket** arbitrary values `min-h-[<44px]`. A **Tailwind scale token** like `min-h-6` / `min-w-6` is neither — it carries no `h-8/9/10` token and is not bracket syntax, so this `<button>` passes the scan silently. The same gap exists for `min-h-7/8/9/10`, `size-6/7/8/9`. The cycle history shows the audit has been progressively widened (Badge → native select → anchors → raw checkbox); the **scale-token `min-h`/`min-w`/`size` class is the next uncovered shape.** (Verified: a grep for `min-h-6|min-w-6|size-6…` on interactive elements returns exactly this one hit today, so the fix is small AND the regex extension prevents the whole class.)

**Impact:** A keyboard-or-touch admin editing topic aliases has a 24 px delete-X — fiddly on a trackpad, a miss-magnet on touch. More importantly, the audit's guarantee ("no sub-44 interactive element ships unseen") has a hole.

**Fix:** (1) Raise this button to `min-h-11 min-w-11` (icon stays `h-3 w-3`). (2) Extend the FORBIDDEN regex set with a scale-token pattern, e.g. `<button…className="…(?:min-h-|min-w-|size-)[3-9]\b…">` with the existing `min-h-1[12]`/`size-1[12]` override lookahead, plus `<a>`/`<Link>` variants — this closes the class, not just this instance. Add a fixture in the FORBIDDEN-coverage `it()` block (`<button className="min-h-6 min-w-6">` must trip; `min-h-11` must not).

---

### DES-3 — Histogram "(sRGB preview)" clip hint fails contrast in dark mode (3.96:1) — WCAG 1.4.3 FAIL — **MED** (confidence: High)

**Where:** `components/histogram.tsx:608`
```jsx
{isClipped && <span className="ml-1 text-amber-700 font-medium">({t('viewer.histogramSrgbPreview')})</span>}
```
**Box/token:** `text-amber-700` (#b45309) with **no `dark:` variant**.

**Computed contrast (small text → 4.5:1 required):**
| Surface | Ratio | Verdict |
|---|---|---|
| Light (on white card) | 5.02:1 | pass |
| **Dark (on `bg-card` #0a0a0b)** | **3.96:1** | **FAIL (need 4.5:1)** |
| OLED (on #000) | 4.18:1 | FAIL |

**Inconsistency evidence:** the sibling amber hints in `color-details-section.tsx:506,524,540` correctly use `text-amber-700 **dark:text-amber-300**` (dark = 13.8:1). The histogram hint was missed. `viewer.histogramSrgbPreview` is a meaningful audit signal for a photographer ("you're seeing a clipped sRGB preview of a wide-gamut photo"); it must be legible in the dark lightbox/sidebar where most viewing happens.

**Fix:** add `dark:text-amber-300` to `histogram.tsx:608` (→ 13.8:1 dark), matching the established convention.

---

### DES-4 — Admin status/warning amber text fails contrast in **light** mode (3.19:1) — WCAG 1.4.3 FAIL — **MED** (confidence: High)

**Where (two sites):**
- `app/[locale]/admin/(protected)/sales/sales-client.tsx:93` — `pending` status: `cls: 'text-amber-600 dark:text-amber-400'`
- `app/[locale]/admin/(protected)/settings/settings-client.tsx:674` — production-search warning: `text-amber-600 font-medium` (**no dark variant**)

**Token:** `text-amber-600` = #d97706.
**Computed:**
| | Light on white | Dark |
|---|---|---|
| sales `pending` | **3.19:1 FAIL** | amber-400 → 11.92:1 pass |
| settings warning | **3.19:1 FAIL** | amber-600 on dark card → 6.24:1 pass |

So `amber-600` is the **light-mode** failure (3.19:1 < 4.5:1) for both. The "pending" sale status and the "production search not actually running" warning are both states an admin needs to read accurately.

**Fix:** use `text-amber-700` for the light value (amber-700 on white = 5.02:1), keeping `dark:text-amber-400`: i.e. `text-amber-700 dark:text-amber-400` at both sites. (amber-700 is the project's established light-mode amber elsewhere.)

---

### DES-5 — Nav theme/locale/menu buttons have no `focus-visible` ring (rely on UA default only) — WCAG 2.4.7 (borderline) — **LOW** (confidence: Medium)

**Where:** `components/nav-client.tsx:93` (mobile expand toggle), `:156` (theme), `:166` (locale). The home/title `<Link>` at `:85` similarly has only `hover:`.

**Evidence:** these bare `<button>`s style `hover:bg-accent` / `hover:bg-muted/50` but carry **no** `focus-visible:ring-*` / `focus-visible:outline-*`. There is **no global `:focus`/`:focus-visible` base rule** in `globals.css` and no custom ring in `tailwind.config.ts` (only the `ring` color token). The shadcn `<Button>` base (`ui/button.tsx:8`) DOES ship `focus-visible:ring-[3px]`, and every other interactive surface in the app sets an explicit `focus-visible:ring-2`. So these nav controls fall back to the **browser-default** focus ring only.

**Impact:** Keyboard focus is technically visible (they do not set `outline-none`, so the UA default outline applies — not a hard 2.4.7 failure), but it is **visually inconsistent** with the app's `ring-2`/`ring-[3px]` focus language, and the default outline is easy to miss on the translucent `bg-background/20` nav. The nav is the top-of-page chrome on every route, so the inconsistency is prominent for keyboard users.

**Fix:** add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none` to the three nav buttons (and `focus-visible:ring-2` to the title Link) to match the rest of the app.

---

### DES-6 — Color-pip format-gamut suffix `text-white/50` is the thinnest margin in the color UI; histogram dotted-underline affordance is faint — **LOW** (confidence: Medium)

**Where:** `components/lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` inside a `bg-white/10` chip on the `bg-black/80` panel.
**Computed:** white@50 % over (white@10 % over near-black panel) = **5.15:1** — *passes* 4.5:1, but it is the thinnest color-UI margin and the text is `text-[10px]`.
**Secondary (same severity):** `components/histogram.tsx:691` — the key-type tooltip trigger is `<span tabIndex={0} … underline decoration-dotted decoration-muted-foreground/40>`. The `/40` decoration is ~2:1, so the dotted-underline "this is interactive" cue is barely visible. The span *text* (`text-muted-foreground`) is fine (6.04/7.76:1); only the affordance cue is faint.

**Impact:** Low — both pass text contrast and are audit-niche surfaces. The tooltip affordance is the weaker (a keyboard user may not realize the span is focusable/has a tooltip).

**Fix (optional):** bump the suffix to `text-white/70` (→ ~9:1) and the histogram underline to `decoration-muted-foreground/70`. Cheap polish.

---

### DES-7 — Info-sidebar topic Badge renders the raw slug, not the humanized label — content consistency — **LOW** (confidence: High)

**Where:** `components/photo-viewer.tsx:816` — `<Badge variant="outline">{image.topic}</Badge>` (and the bottom-sheet equivalent). This prints the **raw slug** (e.g. `music-festival`), while the adjacent tag chips at `:836` correctly run through `humanizeTagLabel` (`#Music Festival`), the nav uses `topic.label`, and the Back button at `:603` uses `image.topic_label || image.topic`.

**Impact:** Within the same info card a viewer sees a hyphenated lowercase topic slug next to humanized tag chips and a humanized Back-button label — a small but visible inconsistency on the photo page. (Content/UX, not an a11y failure.)

**Fix:** render `image.topic_label || image.topic` (the value the Back button already uses) in the Badge, or route the slug through the same humanizer the nav/tags use.

---

## Surfaces audited and found COMPLIANT (no finding — documented for coverage)

Reviewed against touch-target, contrast, keyboard, focus, and ARIA criteria; correct at HEAD:

- **Lightbox** (`lightbox.tsx`): `FocusTrap` with `fallbackFocus`; close button force-focused on mount; **focus restoration** to `previouslyFocusedRef` on unmount; all controls **h-11 w-11**; `aria-keyshortcuts`, `aria-pressed` (slideshow), `role="dialog" aria-modal`; **two `aria-live="polite"` regions** (slideshow state + position counter); reduced-motion gating on Ken Burns + transitions; Escape closes the nested color-pip first then the lightbox; prev/next get `aria-hidden`+`tabIndex=-1` on auto-hide but keyboard arrows are window-level so nav still works.
- **Color pip** (`lightbox-color-pip.tsx`): main button `min-h-11`; tooltip-trigger and copy buttons `min-h-11 min-w-11`; `aria-expanded`; `aria-label` concatenates primaries·transfer·HDR; HDR pill decorative (`aria-hidden`). Forced-colors override for `.lightbox-color-pip` at globals.css:198.
- **Histogram** (`histogram.tsx`): collapse + cycle-mode buttons `min-h-11 min-w-11`; `<canvas role="img" aria-label>`; key-type `<span tabIndex={0}>` with tooltip; clip % labels `text-red-500`.
- **Search** (`search.tsx`): `role="combobox"`/`listbox`/`option`, `aria-activedescendant` keyboard nav, `FocusTrap` `initialFocus`, **focus restoration to triggerRef**, body-scroll lock, IME composition guards, `aria-live` results-count region, sr-only label + redundant aria-label.
- **Photo-viewer** (`photo-viewer.tsx`): all toolbar Buttons `h-11`; download dropdown items `min-h-11`; **sr-only `<h1>`** + semantic `<h2>`/`<h3>`; `aria-describedby="photo-viewer-shortcuts"` linked; position counter `role="status" aria-live`; blur crossfade respects `prefersReducedMotion`; LCP image `priority` + `fetchPriority="high"`.
- **Info bottom sheet** (`info-bottom-sheet.tsx`): `FocusTrap` `initialFocus` on close button (focus-trap-react restores by default); **drag handle is a keyboard `<button>`** with Enter/Space/Escape + `aria-expanded` + `min-h-11`; close button `min-h-11 min-w-11`; `role="dialog" aria-modal`.
- **Nav** (`nav-client.tsx`): all controls `min-w-[44px] min-h-[44px]`; `aria-current="page"` on active topic; mobile toggle `aria-expanded`+`aria-controls`; theme/locale `aria-label`+`title`. (focus-ring inconsistency = DES-5.)
- **Masonry** (`home-client.tsx`): `focus-within:ring-2` cards; aria-label on photo links; P3 badge `min-h-11 min-w-11` (decorative aria-hidden); **CLS reservation** via `aspectRatio` + `containIntrinsicSize`; LCP `priority`; **back-to-top button correctly co-toggles `aria-hidden` + `tabIndex=-1` + `pointer-events-none`** (no focus on hidden element); `content-visibility:auto` virtualization. Overlay text white/white-80 = **5.88–7.35:1** even over a white photo; forced-colors pins overlay to Canvas/CanvasText (globals.css:294).
- **Load-more** (`load-more.tsx`): button `h-11`; **sr-only `aria-live="polite" aria-atomic`** status region (loading/loaded/no-more); unmount guard.
- **Upload dropzone** (`upload-dropzone.tsx:408`): `role="button"`, `aria-disabled`, conditional `cursor-not-allowed`, `tabIndex={-1}` fallback when disabled; progress bar `role="progressbar"` + `aria-valuenow` + `aria-live` filename.
- **ImageZoom** (`image-zoom.tsx:344`): `role="button" tabIndex={0}`, `aria-label`, `focus-visible:outline-2`, Enter/Space toggle, `closest('a,button,[role=button],input,…')` guard.
- **Tag-input** (`tag-input.tsx`): `role="option"` rows `min-h-11`, `aria-selected`, remove button `min-h-11 min-w-11`.
- **Settings form ARIA** (`settings-client.tsx`): **all 16 unique `aria-describedby` targets have matching `id`s — zero dangling, zero dup-id** (the 8→18 ref wiring is clean; `license-price-help` is intentionally referenced by 3 controls = valid ARIA). Switch/Select controls all carry `id`+`aria-describedby`.
- **Admin error/loading** (`admin/(protected)/error.tsx`, `loading.tsx`): single labelled `<section aria-labelledby>` (no double-region), visible legible `<h1>` (text-3xl), `role="status" aria-label` spinner, `min-h-11` buttons.
- **i18n parity:** en/ko top-level keys 37/37, no missing/extra. The ICU-plural-vs-fixed-form asymmetry (en plural, ko single form) is intentional per DOC-R5C3-07. No RTL targeted (en/ko only).
- **Global a11y CSS** (`globals.css`): `prefers-reduced-motion` blanket override (275-284); `forced-colors: active` handling for hdr/gamut/pip badges + masonry overlay; `muted-foreground` light bumped to 40 % L (**6.04:1 light / 7.76:1 dark / 7.72:1 oled** — F-11 holds everywhere).

---

## Notes / sub-threshold observations (no action required)

- **`text-red-500` histogram clip labels (histogram.tsx:671,674):** red-500 #ef4444 = **4.0:1 on white** (below 4.5 small-text) but **5.9:1 in dark** mode where the histogram actually lives (lightbox/sidebar are dark-surface-heavy, panel bg `bg-black/20`). Short bold numeric percentages; borderline-pass in context. Not raised as a finding; if a future pass touches it, add a light-mode darkening.
- **Search Input `h-8` (search.tsx:356):** 32 px text input, but it sits in a `p-4` row and a text field is not a 2.5.5 "target". Mobile tap lands via the padded row. Acceptable.
- **`destructive-foreground` on `bg-destructive` buttons** (delete confirms across admin): white on the destructive button = **4.53–4.63:1 (light)** / **8.71–9.6:1 (dark)** — passes. This is exactly why the single `--destructive` token cannot also serve as text (DES-1).

## Top-3 priority for the plan

1. **DES-1 (HIGH):** dark-mode `text-destructive` error text at ~2:1 — fix the token/variant so all `role="alert"` error messaging is legible in dark mode. Widest user impact (every error path, including login).
2. **DES-2 (MED):** 24 px admin delete-alias button + close the **scale-token (`min-h-6`/`size-N`) audit blind spot** so the touch-target guarantee has no hole.
3. **DES-3 + DES-4 (MED):** amber hints failing contrast — histogram (dark, 3.96:1) and admin status/warning (light, 3.19:1) — both a one-line `dark:`/light-token swap mirroring the existing `text-amber-700 dark:text-amber-300/400` convention.

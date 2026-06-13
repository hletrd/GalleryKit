# Designer Review — GalleryKit (run-6 c1, UI/UX + WCAG 2.2)

Reviewer: `designer` agent. Scope: interactive/visual surfaces under `apps/web/src/components/` and `apps/web/src/app/[locale]/`. All findings are from static source analysis (JSX/TSX/CSS read directly); no live browser run. Evidence = exact `file:line`, classNames, hex/Tailwind tokens, ARIA attributes.

**Headline:** This codebase is unusually mature on accessibility — a blocking 44px touch-target test, skip links, focus-trap-react in the lightbox, live regions everywhere, a textbook combobox in search, `prefers-reduced-motion` + `forced-colors` handling, and a correct `aria-hidden`/`tabIndex`/`pointer-events` triad on the back-to-top button. The mandated fixes (AGG-9 / AGG-10) **verify as correct and complete**. Remaining findings are polish/consistency-level, not blockers.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 6 |
| Verified-correct (no action) | 4 |

## Findings table

| ID | Sev | File:line | WCAG / principle | One-line |
|----|-----|-----------|------------------|----------|
| DES-01 | Med | settings-client.tsx:320/333/346, 437/454/480, 494, 662/674/686 | 1.3.1 / 4.1.2 | ~10 settings controls have a visible hint `<p>` not wired via `aria-describedby` (8 ARE wired) |
| DES-02 | Med | error.tsx:18-19 + admin/(protected)/error.tsx:29-30 vs not-found.tsx:37-42 | UX consistency / 2.4.6 | Both error shells now have NO visible heading (only sr-only h1 + faint /30 glyph); 404 shell shows a real readable h1 — inconsistent |
| DES-03 | Med | upload-dropzone.tsx:397-407 | 4.1.2 / honesty | Dropzone keeps `role="button"` focusable+clickable while `aria-disabled` is true; only the hidden `<input>` is truly `disabled` — the role-button affordance presents disabled but is not enforced |
| DES-04 | Low | error.tsx:18 & admin error.tsx:29 (`/30`) vs not-found.tsx:37 (`/60`) | 1.4.3 (moot) / consistency | Decorative glyph opacity differs: `/30` on error pages vs `/60` on 404 — both aria-hidden so contrast is moot, but visually inconsistent |
| DES-05 | Low | layout.tsx:120-122 | Doc accuracy | Skip-link comment claims target is "set by the (public) sub-layout" but `#main-content` also exists in `admin/layout.tsx:26` and `not-found.tsx:26` — comment understates coverage (stale) |
| DES-06 | Low | login-form.tsx:51-60, 71-80, 97-100 | 3.3.1 | Login inputs not marked `aria-invalid` / `aria-describedby` on failed auth; error rides a sibling `role="alert"` + toast only |
| DES-07 | Low | color-details-section.tsx:493 | 1.4.3 | `text-muted-foreground/70` gamut suffix `(P3)`/`(sRGB)` over `bg-muted` chip at 11px is borderline secondary-text contrast (admin-only audit) |
| DES-08 | Low | global-error.tsx:76 vs other shells | UX consistency | `global-error` uses a plain visible `<h1 text-3xl>` with no decorative-glyph pattern — fourth distinct error-shell heading shape |
| DES-09 | Low | photo-viewer.tsx:796 + lightbox.tsx:669 | sweep | Two `role="status"` position counters coexist (viewer + lightbox) but never co-mount for the same view; verify no double-announce when transitioning viewer→lightbox |
| DES-V1 | ✓ | home-client.tsx:259 + tailwind.config.ts:11-16 | — | Dynamic `columns-${n}` classes ARE safelisted — masonry columns render correctly (NOT a purge bug) |
| DES-V2 | ✓ | home-client.tsx:428-439 | 4.1.2 | Back-to-top button correctly triads `aria-hidden` + `tabIndex={-1}` + `pointer-events-none` when hidden |
| DES-V3 | ✓ | (public)/page.tsx:50,67,112 + layout.tsx:26 | SEO | AGG-10 fixed in BOTH metadata branches via `{ absolute: title }` |
| DES-V4 | ✓ | admin/(protected)/error.tsx:29-30 | 1.4.3 / 4.1.2 | AGG-9 split correct: aria-hidden decorative span + sr-only h1, `aria-labelledby` resolves |

---

## Mandated verifications (at HEAD)

### AGG-9 — admin `error.tsx` heading split → CORRECT & COMPLETE (DES-V4)

`apps/web/src/app/[locale]/admin/(protected)/error.tsx:21-30`:
```
<section ... aria-labelledby="admin-route-error-title">
  <span aria-hidden="true" className="text-7xl font-bold text-muted-foreground/30 block">{t('error.title')}</span>
  <h1 id="admin-route-error-title" className="sr-only">{t('error.title')}</h1>
```
- The faint glyph (`text-muted-foreground/30` ≈ 1.3-1.5:1, far below 1.4.3 AA 4.5:1) is now `aria-hidden`, so its illegible contrast no longer carries the accessible name. **Decorative text has no contrast floor — correct.**
- The real accessible name rides the `sr-only` `<h1 id="admin-route-error-title">`. `sr-only` text has no contrast obligation. **Correct.**
- `aria-labelledby="admin-route-error-title"` on the `<section>` resolves to the sr-only h1 (id present and unique on the page). **Region label resolves — correct.**
- Structure now mirrors the public twin (`app/[locale]/error.tsx:17-19`) exactly. **Parity achieved.**
- **No residual low-contrast visible text serving as a heading.** The only visible text in the shell is the body `<p className="text-lg text-muted-foreground">` (error.tsx:31) and the button/link labels — none act as a heading.

Verdict: **fix is correct and complete.** See DES-02 for the separate UX-consistency observation that this leaves the page with no *visible* heading.

### AGG-10 — home metadata double-suffix → FIXED IN BOTH BRANCHES (DES-V3)

- Layout sets the template: `apps/web/src/app/[locale]/layout.tsx:24-26` → `title: { default: seo.title, template: '%s | ${seo.title}' }`.
- Home page computes `title` (page.tsx:39-41): filtered branch ends `… | ${seo.title}`; no-filter branch IS `seo.title`. A *string* `metadata.title` would then be templated → `GalleryKit | GalleryKit` (no-filter) and `#tag | GalleryKit | GalleryKit` (filtered).
- Fix: `const metadataTitle = { absolute: title }` (page.tsx:50), returned as `title: metadataTitle` in **both** return paths — the `og_image_url` branch (page.tsx:67) **and** the latest-photo branch (page.tsx:112). `{ absolute }` opts the page out of the template. **Both branches fixed.**
- OpenGraph/Twitter titles correctly keep the plain `title` string (page.tsx:72, 84, 117, 128) — Next does not template those, so no double-suffix risk there. **Correct.**
- Commit `8fc403a2 "stop home title double-suffixing"` therefore **fixed BOTH branches**, not one. Verified.

### AGG-11 — settings-client unwired hints → QUANTIFIED (DES-01, Medium)

`aria-describedby` present on **8** controls: `image-sizes` (368), `force-srgb-derivatives` (386), `allow-hdr-ingest` (402), `force-show-color-chips` (418), `strip-gps` (532), `slideshow-interval` (564), `auto-alt-text-enabled` (592), `semantic-search-mode` (625).

Controls WITH a visible hint `<p>` but **NOT** wired via `aria-describedby` (the hint exists adjacent but is not programmatically associated):

| Control | id (line) | Hint `<p>` (line) |
|---|---|---|
| WebP quality | `image-quality-webp` (321) | 329 |
| AVIF quality | `image-quality-avif` (334) | 342 |
| JPEG quality | `image-quality-jpeg` (347) | 355 |
| Wide-gamut JPEG chroma | `wide-gamut-jpeg-chroma` SelectTrigger (437) | 446 |
| AVIF effort | `avif-effort` SelectTrigger (454) | 468 |
| SDR JPEG chroma | `sdr-jpeg-chroma` SelectTrigger (480) | 489 |
| Wide-gamut max source px | `wide-gamut-max-source-pixels` (494) | 504 |
| License price (editorial/commercial/rm) | 662 / 674 / 686 | shared hint 696 |

That's **~10 controls** (3 quality inputs + 3 chroma/effort selects + 1 pixel input + 3 license inputs) whose hint text is visually present but not announced when a screen-reader admin focuses the control. **Impact (WCAG 1.3.1 / 4.1.2):** a blind admin tabbing through Image Processing settings hears only the label ("AVIF effort") and not the consequential hint ("Higher = smaller files, slower encode") — they cannot make an informed choice without leaving the field to read the hint separately. **Fix:** give each hint `<p>` an `id` and add `aria-describedby` to the paired Input/SelectTrigger, exactly as the 8 already-wired controls do. The license trio can share one `aria-describedby="license-price-help"` pointing at the single hint at 696.

### AGG-24 cluster

**(a) Double `role="status"` on the backfill last-run UI → NOT a defect.** The two `role="status"` divs at `settings-client.tsx:230` (amber "backfill required" banner) and `:274` (blue "last run" summary) are **not nested and not overlapping**. The amber banner (230, gated on `hasExistingImages && hasDirtyBackfillField`) is a sibling that precedes the blue trigger card (245). The last-run summary (274, gated on `(backfillStatus.completedRuns ?? 0) > 0`) lives *inside* the blue card. They are two distinct, conditionally-rendered live regions that announce different events at different times (one when a color-impacting field goes dirty, one after a run finishes). This is correct use of polite live regions; AT will not double-announce because they don't co-mount for the same event. **No finding.**

**(b) `aria-disabled` dropzone honesty → DES-03 (Medium).** `upload-dropzone.tsx:397-407`: the dropzone div carries `role="button"`, `aria-disabled={uploading || !hasTopics}`, and `cursor-not-allowed` + `opacity-50` when disabled — and the *actual* hidden `<input {...getInputProps()} disabled={uploading || !hasTopics}>` (407) is genuinely `disabled`. The honesty gap: `aria-disabled` (unlike real `disabled`) does **not** remove the element from the tab order or block click activation — react-dropzone's `getRootProps()` keeps the root focusable and its click/keydown handlers live. So a keyboard/SR user can still focus and "press" the `role="button"` dropzone while it presents as disabled; the press is a no-op only because the underlying input is disabled. **Impact (4.1.2):** the disabled affordance is announced but not enforced at the role-button level — a confusing dead interaction on the no-topics first-run path. **Fix:** pass react-dropzone's own `disabled` option into `useDropzone` (it strips the root handlers and tab stop), then drop the manual `aria-disabled`; or guard with `tabIndex={-1}` + early-return in the click/keydown handlers when disabled.

**(c) Error-shell heading-level consistency → DES-02 (Medium) + DES-08 (Low).** Four shells, four different heading shapes:

| Shell | File:line | Pattern | Visible heading? |
|---|---|---|---|
| Public error | `error.tsx:18-19` | aria-hidden /30 glyph + sr-only h1 | **No** |
| Admin error | `admin/(protected)/error.tsx:29-30` | aria-hidden /30 glyph + sr-only h1 | **No** |
| Not-found | `not-found.tsx:37-42` | aria-hidden /60 glyph + visible h1 `text-2xl` | **Yes** ("Page not found") |
| Global error | `global-error.tsx:76` | plain visible h1 `text-3xl`, no glyph | **Yes** |

All four are *accessible* (each has exactly one resolvable h1). But the UX is inconsistent: the two `error.tsx` shells now show a sighted user only a faint /30 glyph + a body paragraph — **no readable heading at all** — whereas the 404 page shows a proper heading and global-error shows a large one. The 404 pattern (decorative glyph + visible meaningful h1) is the better one and should be the template. **Fix:** make both `error.tsx` shells follow `not-found.tsx`: keep the aria-hidden glyph but add a *visible* meaningful `<h1>` (promote `error.adminDescription`/`error.description`, or add a short `error.heading` key) so sighted users get a heading too. Heading-*level* is fine (single h1 per page context); the gap is the missing visible heading, not a level skip.

**(d) Stale skip-link comment → DES-05 (Low).** `layout.tsx:120-122` comment: *"target id=\"main-content\" is set by the (public) sub-layout's `<main>` element (US-P15 AC-6)."* But `#main-content` is ALSO provided by `admin/layout.tsx:26` (`<main id="main-content" tabIndex={-1}>`) and by `not-found.tsx:26`. So the skip link is functional across public, admin, AND 404 — the comment understates coverage and reads as if admin pages have a dead skip-anchor. **No functional bug** (the anchor resolves on every route). **Fix:** update the comment to "target set by every sub-layout's `<main>` (public + admin) and the not-found shell."

---

## Detail on other findings

### DES-04 (Low) — decorative-glyph opacity inconsistency
`error.tsx:18` and `admin/(protected)/error.tsx:29` use `text-muted-foreground/30`; `not-found.tsx:37` uses `text-muted-foreground/60` (with a comment explicitly bumping it for dark-mode contrast under F-14). Both are now `aria-hidden`, so the 1.4.3 floor is moot for all three. The residual issue is purely visual: the error-page glyph (`/30`) is roughly half the opacity of the 404 glyph (`/60`), so the two surfaces look noticeably different in faintness. **Fix:** standardize all three decorative glyphs on one opacity token (recommend `/60` to match the 404 page's already-tuned value). Cosmetic.

### DES-06 (Low) — login inputs lack invalid-state cue
`login-form.tsx`: on failed login (`state?.error`), the error renders as a sibling `<p role="alert" aria-live="assertive">` (97-100) and is also surfaced as a `toast.error` (30). A screen reader hears the message. But the `<Input id="login-username">` (51) and `<Input id="login-password">` (71) are **not** marked `aria-invalid="true"` and have no `aria-describedby` pointing at the alert. **Impact (3.3.1):** an SR user who tabs back to a field after the error announcement gets no per-field invalid cue. Because the error is form-level (not field-specific), this is minor — adding `aria-invalid={!!state?.error}` to both inputs + `aria-describedby="login-error"` (with `id="login-error"` on the alert `<p>`) would close it. The password toggle (81-94) is exemplary: 44px target (`w-11 h-11`), `aria-pressed`, aria-hidden icons, distinct focus ring.

### DES-07 (Low) — borderline contrast on format-chip gamut suffix
`color-details-section.tsx:493`: `<span className="ml-0.5 text-muted-foreground/70">({fmt.gamut})</span>` renders the `(P3)`/`(sRGB)` suffix at 70% muted-foreground over a `bg-muted` chip (490) at `text-[11px]` (491). Muted-foreground over muted-background is already a low-contrast pairing; at /70 and 11px (so the large-text 3:1 exemption does NOT apply) the suffix likely falls under the 4.5:1 floor. **Impact (1.4.3):** the gamut qualifier is hard to read — though it is admin-only audit metadata and the format name beside it is full-contrast. **Fix:** drop the `/70` (use full `text-muted-foreground`). Low priority given the admin-only, supplementary nature. Same `/70` token at lightbox-color-pip.tsx is over a dark `bg-black/80` panel (`text-white/50`), which is fine — only the light-chip instance is borderline.

### DES-09 (sweep) — dual position-counter live regions
`photo-viewer.tsx:796` and `lightbox.tsx:669` each render a `role="status" aria-live="polite"` photo-position counter ("Photo N of M"). They belong to two different surfaces (inline viewer vs full-screen lightbox) and the lightbox mounts over the viewer. They do not co-announce for a single state change in the same view, but when a user opens the lightbox from the viewer, both counters are briefly in the DOM — verify the viewer's counter is not also `aria-live` while the lightbox is open (it should be inert behind the `aria-modal` dialog, which most AT honor). No defect confirmed; flagged for a live-AT pass. **1.3.1/4.1.2 — verify only.**

### Color-as-sole-indicator check → PASSES (not a finding)
The P3 badge (purple, color-details:338/352), clip badge (amber, :383), and HDR pill (amber gradient, :514 and pip:148) all encode meaning in BOTH color and a visible text label ("P3", localized clip text, HDR text). The closed-pip HDR pill (pip:147-153) is `aria-hidden="true"`, but the parent button's `aria-label` (pip:133-137) re-includes the HDR signal (`isHdr ? t('viewer.hdrBadge') : null`), so SR users still hear it. The accordion HDR badge (color-details:513-520) uses `role="img"` + `aria-label`. **1.4.1 satisfied.**

---

## Positives worth preserving (do not regress)

- **Touch targets:** every interactive element audited (lightbox close `h-11 w-11` :550, color-details toggles `min-h-[44px]` :297/306/324/398, pip controls `min-h-11 min-w-11` :186/268, tag-filter chips `min-h-11` via `Badge asChild` :65, upload select `h-11` :373, error/404 buttons `min-h-11`) meets the 44px floor. The blocking `touch-target-audit.test.ts` is doing its job.
- **Search combobox** (`search.tsx`) is a textbook WAI-ARIA combobox: `role="combobox"` + `aria-autocomplete="list"` + `aria-controls` + `aria-expanded` + `aria-activedescendant` (330-334), `role="listbox"` (384), `role="option"` + `aria-selected` (67-68), sr-only live region (371). Exemplary.
- **Lightbox** uses focus-trap-react with a sensible `fallbackFocus` (lightbox.tsx:447), `role="dialog"` + `aria-modal` + `aria-label` (450-452), a polite live region for slideshow state (461-463), a `role="status"` position counter (669-670), restores focus on unmount (440-442), and respects `shouldReduceMotion` for Ken Burns (470, 526).
- **Reduced motion** is globally honored (`globals.css:275-283`) AND respected inline (home-client back-to-top scroll :430-431, lightbox).
- **Forced-colors / Windows High Contrast** handling for masonry card overlays (`globals.css:294-302`) — a genuinely rare-to-find consideration.
- **Skip link** (layout.tsx:123-128) is the first focusable element and resolves on every route.
- **Back-to-top** (home-client:428-439) correctly removes itself from the a11y tree AND tab order when hidden — the textbook pattern most apps get wrong.
- **Empty states** (home-client:412-426 with decorative svg + meaningful copy + clear-filter affordance; upload-dropzone:350-361 no-topics state with a CTA to create the first category) are thoughtful.

## Recommended priority order
1. **DES-01** (wire ~10 settings hints via `aria-describedby`) — highest-value a11y win, pattern already established in the same file.
2. **DES-02 / DES-08** (give error shells a visible heading, standardize the four shells on the 404 pattern) — visible UX regression for sighted users on the now-headingless error pages.
3. **DES-03** (dropzone disabled honesty) — fix the focusable-while-disabled mismatch on the first-run path.
4. **DES-04 / DES-05 / DES-06 / DES-07** — polish/consistency; batch when convenient.

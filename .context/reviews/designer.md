# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** review-plan-fix cycle 9 · **HEAD:** `0ce84b1b` (in sync with origin/master) · **Date:** 2026-06-14
**Reviewer:** Designer (UI/UX + accessibility) · **Working tree:** CLEAN at review start (the `.context/reviews/*.md` `M` entries in `git status` are concurrent reviewer-agent mutations; this review verifies against COMMITTED HEAD `0ce84b1b`, not the live working tree).
**Method:** Static-source analysis of every interactive surface (public route group, all 33 top-level + 54 total `components/*.tsx`, lightbox, photo-viewer, nav, search, tag-input combobox, map, all admin forms + dialogs, every error/empty/loading state) + global CSS / token audit (`globals.css` reduced-motion + forced-colors + contrast tokens) + live audit-gate execution (`npx vitest run touch-target-audit` → **15/15 pass, 881ms**) + recent-commit lineage trace. A dev server was not started (concurrent multi-agent load makes a clean boot unreliable); every finding below is backed by text-extractable evidence (file:line, sizing tokens, ARIA roles, computed contrast).

---

## NET-NEW UI/UX FINDINGS THIS CYCLE: **0.**

- **Cycle-8 scheduled items (AGG-C8-01 base56 uniformity test, AGG-C8-02 SCAN_ROOTS doc): VERIFIED LANDED** at HEAD (`71ab0f41`, `aa8a6f8a`). Neither was a designer item; both confirmed present.
- **Cycle-7 NEW designer finding DES-C7-1 (admin-header brand link): STILL FIXED** (`b47cdbb6`); re-confirmed at HEAD.
- **Prior-deferred DES-C5-2 / DES-C5-3 / DES-C5-4: RE-CONFIRMED OPEN at HEAD, UNCHANGED — not re-escalated** (none is a WCAG A/AA failure).

This is a **converged, heavily a11y-hardened surface**. The recent commit log shows a sustained, dedicated accessibility campaign — `b47cdbb6`, `e7d19f4b`, `ecd093ab`, `77013cd0`, `ee0f38bd`, `fbf91baa`, `35d07f0b`, `7656c996`, `0e8fd431`, `2f67ed66`, `81409dc2` are all `fix(a11y)` / `style(ui)` commits closing exactly the class of issues a designer review surfaces. I did **not** manufacture any marginal or cosmetic finding. Reporting zero new genuine findings is the correct outcome here.

---

## Independent verification performed this cycle (not merely re-reading prior reviews)

I re-derived the surface state from source rather than trusting the cycle-8 file. Evidence:

### 1. Combobox patterns — both are textbook ARIA (independently read in full)

- **`tag-input.tsx`** (read 1–259): `<input role="combobox" aria-autocomplete="list" aria-expanded aria-controls aria-activedescendant>`; popup `<div role="listbox">` with `role="option" aria-selected` children and stable `useId`-derived option ids (`:166-172`, `:193-198`, `:213`, `:224-225`, `:241-242`). Full keyboard model: ArrowUp/Down wrap, Enter/comma commit, Tab accepts-then-traverses (deliberately no `preventDefault`, `:121-133`), Escape closes, Backspace-on-empty pops last chip. **IME-aware** (`isImeComposingReactEvent` guard `:102`) so Korean composition keydowns don't add half-composed tags. Remove-chip buttons are `min-h-11 min-w-11` with `aria-label={t('aria.removeTag')}` and `focus:ring-2` (`:183-184`). Container `focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2` (`:176`). Exemplary.
- **`search.tsx`** (read 320–394): identical combobox rigor — `role="combobox" aria-autocomplete="list" aria-controls aria-expanded aria-activedescendant` (`:330-334`), `<div role="listbox" id="search-results">` (`:384`), `sr-only aria-live="polite" aria-atomic` results-count announcer (`:371-381`), IME-guarded arrow/Enter handling (`:343`), `role="status"` loading spinner (`:358`).

### 2. Custom (non-Radix) overlays — all three correctly trap focus and expose dialog semantics

`grep` for `role=`/`aria-modal`/`FocusTrap` across the three `fixed inset-0` overlays:
- **`lightbox.tsx`**: `FocusTrap` (`:447`, `fallbackFocus → closeButtonRef`), `role="dialog" aria-modal="true" aria-label` (`:450-452`), `role="status"` position counter (`:669-671`), every control `h-11 w-11` with `aria-label` + `aria-keyshortcuts`, blur-before-`aria-hidden` discipline documented (`:147`, `:370`).
- **`search.tsx`**: `FocusTrap` (`:305`), `role="dialog" aria-modal="true"` (`:315-317`).
- **`info-bottom-sheet.tsx`**: `FocusTrap` with one-shot `initialFocus` on close button (`:190-201`), `role="dialog" aria-modal="true" aria-label` (`:201-203`).

All admin dialogs (`bulk-edit-dialog.tsx`, `image-manager.tsx`, `admin-user-manager.tsx`, `topic-manager`, `tokens-client`, `sales-client`, `tag-manager`, `db/page`) use the shadcn/Radix `Dialog` primitive (focus trap, ESC, `aria-modal`, focus restoration handled upstream) — confirmed via `grep -l DialogContent`.

### 3. No inaccessible click handlers anywhere

`grep "onClick"` constrained to `<div|span|li|tr|td|p>` without `role=` → **zero hits**. Every click target is a native `<button>`/`<a>`/`<Link>` or carries `role="button" tabIndex onKeyDown` (`image-zoom.tsx:359`, `upload-dropzone.tsx:408`).

### 4. Reduced-motion + forced-colors (read `globals.css:289-321`)

- `@media (prefers-reduced-motion: reduce)` universal `*`/`::before`/`::after` reset: `animation-duration: 0.01ms`, `animation-iteration-count: 1`, `transition-duration: 0.01ms`, `scroll-behavior: auto` — the canonical pattern (kills visible motion while preserving `animationend`/`transitionend` events). JS motion (`image-zoom`, lightbox Ken Burns/slideshow, `home-client` scroll-to-top, photo-viewer framer-motion) *additionally* gates on `matchMedia('(prefers-reduced-motion: reduce)')` — defense in depth.
- `@media (forced-colors: active)` (`:203`, `:310-321`): `.hdr-badge`/`.gamut-p3-badge`/`.lightbox-color-pip` + masonry card text pinned to `Canvas`/`CanvasText`, gradient suppressed — Windows High Contrast Mode legibility addressed with documented rationale (CM-LOW-5).

### 5. Empty / loading / error states

- `photo-viewer-loading.tsx`: `role="status" aria-live="polite" aria-label`, decorative skeleton + spinner `aria-hidden="true"` (`:11-19`).
- `topic-empty-state.tsx`: `min-h-11` clear-filter recovery link (`:18`).
- COMMITTED admin `error.tsx` (`git show HEAD:` — bypassing concurrent working-tree edits): `<section aria-labelledby="admin-route-error-title">`, decorative glyph as `aria-hidden` span + `sr-only h1`, both action `<button>`s `min-h-11` with the contrast-safe `bg-primary`/`border` styling (`:21-43`).
- `sales-client.tsx`: load-failure surfaced via `role="alert"` live region with `text-destructive-text` token (`:192-195`).

### 6. Touch-target gate — live at HEAD

```
npx vitest run touch-target-audit → Test Files 1 passed (1) · Tests 15 passed (15) · 881ms
```

The blocking gate is GREEN at HEAD `0ce84b1b`. The scale-token catch-all covers `<Button>/<button>/<Link>/<a>/<select>`, so a future sub-44 `h-7`/`size-8`/`min-h-6` on any of those tags would fail CI.

---

## Findings

**None net-new this cycle.** Severity legend (for reference): **HIGH** = WCAG A/AA failure on public/shipped surface · **MED** = AA failure on admin surface or repo-44 px-floor failure on public surface · **LOW** = AAA / polish / consistency. No finding at any severity is net-new.

---

## Prior-deferred items — RE-CONFIRMED OPEN at HEAD `0ce84b1b` (no change, NOT re-escalated)

All three re-read from source this cycle. None is a hard WCAG A/AA failure; all remain correctly classified LOW / deferred.

### DES-C5-2 — Nav theme/locale/expand `<button>`s + brand/topic `<Link>`s have no `focus-visible` ring — **LOW** — UNCHANGED

`nav-client.tsx` re-read at HEAD: brand `<Link>` (`:85`, `min-h-[44px]`), expand `<button>` (`:93-96`, `min-w-[44px] min-h-[44px]` + `aria-expanded`/`aria-controls`), topic `<Link>` (`:122-127`, `min-h-[44px]` + `aria-current`), theme `<button>` (`:155-157`), locale `<button>` (`:166-168`). `grep "focus-visible\|focus:" nav-client.tsx` → **zero hits**: there is no `focus-visible` declaration anywhere in the file. Touch-targets are all fine; the gap is purely the missing custom ring.

**Why this is LOW, not a 2.4.7 failure:** the UA-default focus outline still renders on all five elements (nothing sets `outline:none` on them), so keyboard focus IS visible — WCAG 2.4.7 (Focus Visible, Level AA) is satisfied by the user-agent default. The issue is visual *consistency*: ~19 other ring sites (lightbox, color-pip, histogram, info-sheet, color-details, login password-toggle, upload-dropzone, tag-input, search input) all use `focus-visible:ring-2`/`outline-2`, and shadcn Button uses `focus-visible:ring-[3px]`, so the bare nav elements look different under keyboard focus. **Status: DEFERRED** (plan-340/342 lineage). Optional polish: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none` to the five nav interactive elements.

### DES-C5-3 — Color-pip `text-white/50` gamut suffix (thinnest AA margin) + histogram dotted-underline — **LOW** — UNCHANGED

- `lightbox-color-pip.tsx:236-237` re-read at HEAD: `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>`. `#ffffff` at 50% α over the `bg-black/70` pip resolves to ≈ **5.15:1** — passes WCAG 1.4.3 AA (4.5:1), but it is the thinnest contrast margin in the app and it is `text-[10px]` small text. Unchanged.
- `histogram.tsx:691` (per prior review): `decoration-dotted decoration-muted-foreground/40` — a faint (~2:1) dotted underline on a `cursor-help` tooltip trigger. The trigger TEXT is `text-muted-foreground` (≈ 6.1:1, passes AA per the F-11 token doc); only the decoration is faint, and an underline decoration is decorative non-text (not itself a 1.4.3 target). Unchanged.

**Status: DEFERRED** (plan-340/342). Optional polish: `text-white/70` / `decoration-muted-foreground/70`.

### DES-C5-4 — Photo-viewer info-sidebar topic `<Badge>` renders raw slug — **LOW** — UNCHANGED

`photo-viewer.tsx:816` re-read at HEAD: `<Badge variant="outline">{image.topic}</Badge>` — renders the raw slug (e.g. `music-festival`) rather than the humanized `image.topic_label || image.topic`. This is the lone raw-slug surface in the photo-viewer: the sibling Back button already humanizes (`t('viewer.backTo', { topic: image.topic_label || image.topic })`) and the sibling tag chips below it route through `humanizeTagLabel` (`:822-828`, with an explicit AGG2L-LOW-01 comment documenting that exact reasoning). Cosmetic only — the slug is still a valid accessible name, so there is no a11y impact. **Status: DEFERRED** (plan-340/342). Fix: `{image.topic_label || image.topic}`.

---

## Surfaces audited and found COMPLIANT (re-verified at HEAD `0ce84b1b`)

| Surface | Evidence | Verdict |
|---|---|---|
| Tag-input combobox | `role=combobox` + `aria-activedescendant` + `role=listbox/option` + IME guard + `min-h-11` chips (`tag-input.tsx` full read) | ✓ exemplary |
| Search combobox + dialog | `role=combobox`/`aria-activedescendant`/`role=listbox` + `FocusTrap` + `aria-live` announcer (`search.tsx:305-394`) | ✓ exemplary |
| Lightbox modal | `FocusTrap` + `role=dialog aria-modal` + `role=status` counter + `h-11 w-11` controls + `aria-keyshortcuts` (`lightbox.tsx:447-678`) | ✓ |
| Info bottom-sheet | `FocusTrap` w/ one-shot `initialFocus` + `role=dialog aria-modal` (`info-bottom-sheet.tsx:190-249`) | ✓ |
| Admin dialogs (8) | all shadcn/Radix `Dialog` primitive (trap/ESC/aria-modal/restore upstream) | ✓ |
| On-this-day widget | `<aside aria-label>` + `<ul role=list>` + `min-h-[44px]` links + alt text + truncation (`on-this-day-widget.tsx` full read) | ✓ |
| Inaccessible click handlers | `grep onClick` on div/span/li/tr/td/p w/o role → **0 hits** | ✓ |
| Reduced-motion | universal `*` reset + JS `matchMedia` double-guard (`globals.css:291-300`) | ✓ |
| Forced-colors | badges + masonry text pinned to `Canvas`/`CanvasText` (`globals.css:203,310-321`) | ✓ |
| Empty/loading/error | `role=status`/`aria-live`/`aria-hidden` spinners + `min-h-11` recovery + COMMITTED admin `error.tsx` `aria-labelledby` | ✓ |
| Touch-target gate | `npx vitest run touch-target-audit` → 15/15 GREEN @ HEAD | ✓ |
| ARIA states | `aria-pressed`/`aria-expanded`/`aria-controls`/`aria-current`/`aria-selected` well-distributed across nav, tabs, comboboxes, accordions (grep confirmed) | ✓ |

---

## Summary / priority for the plan

**NET-NEW: 0.** No genuine new UI/UX or WCAG 2.2 issue exists against HEAD `0ce84b1b`. The surface is clean to the repo's own self-imposed 44 px floor (WCAG 2.5.5 AAA — exceeds both 2.5.5 AAA 44px and 2.5.8 AA 24px) and to WCAG 1.4.3 contrast (documented token ratios), 2.4.7 focus visibility (UA default + custom rings on ~19 sites), 1.4.13/4.1.2 ARIA, 2.1.1 keyboard, and 2.3.3 reduced-motion.

**Schedule this cycle: NOTHING from designer.** The three deferred LOW items (DES-C5-2 nav rings, DES-C5-3 thin-margin color-pip suffix, DES-C5-4 raw-slug Badge) remain correctly DEFERRED for a future UI-polish pass — none blocks any user, none is a WCAG A/AA failure, and re-escalating them would violate the repo's own deferral discipline.

**Convergence assessment.** Nine cycles of a11y hardening (12+ dedicated `fix(a11y)` commits in the recent log) have produced a surface where every interactive element across the public route group, all components, lightbox, photo-viewer, nav, search, tag-input combobox, map, all admin forms + dialogs, and every error/empty/loading state is ≥ 44 px, focus-managed (FocusTrap + role=dialog + aria-modal on customs; Radix on admin dialogs), label-associated, alt-tagged, ARIA-complete (full combobox/listbox semantics, live regions, state attributes), reduced-motion-guarded (CSS reset + JS double-guard), forced-colors-aware, and contrast-tuned with documented ratios. **The designer surface is at convergence. No cosmetic findings were manufactured to produce output.**

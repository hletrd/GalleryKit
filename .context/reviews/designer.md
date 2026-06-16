# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** deep multi-agent review (fresh-scrutiny pass on CLIP semantic-search UI) · **HEAD:** `bb463062` · **Date:** 2026-06-16
**Reviewer:** Designer (UI/UX + accessibility)
**Scope:** Fresh scrutiny of the CLIP semantic-search UI added this session — `components/search.tsx` and `components/similar-photos.tsx` — against the repo's established accessible-component patterns (`photo-viewer.tsx`, `color-details-section.tsx`, `tag-input.tsx`, `lightbox-color-pip.tsx`), WCAG 2.2, the 44×44 px touch-target policy (`__tests__/touch-target-audit.test.ts`), and the en+ko i18n parity + plural convention. Prior cycles 1–9 converged to **0** on the non-CLIP surface; I did not re-derive that surface and report no closed items.

**Method — LIVE + static (NOT static-only).** I started the Next 16 dev server (`npm run dev`, Turbopack, "Ready in 25.3s", first-hit compile ~40–53 s on the slow filesystem) and drove it with `agent-browser` (headless Chromium 0.22.2). Every metric below is text-extractable evidence from `getComputedStyle` / `getBoundingClientRect` / accessibility-attribute reads / direct `fetch()` status — **no findings rest on raw screenshots.** Token contrast was computed from live `getComputedStyle` color values via the WCAG relative-luminance formula. The CLIP feature is DARK in prod (`semanticSearchMode='disabled'`); I reviewed the disabled/stub state's UX honestly and did **not** flip the mode (the `/api/search/similar/80` probe returned `503` live, confirming the dark posture).

---

## Live verification performed (evidence ledger)

| What | How | Result |
|---|---|---|
| Search input touch target | `getComputedStyle('#search-input')` | **height 44px, min-height 44px** — the base `Input` `min-h-11` overrides the misleading `h-8` (32px) class. NOT a violation. fontSize 14px. |
| Search dialog dismiss (X) button | `getBoundingClientRect` | **44×44 px** — compliant |
| Search combobox ARIA (empty) | attribute reads | `role=combobox`, `aria-autocomplete=list`, `aria-expanded=false`, no `aria-controls`/`aria-activedescendant` — correct |
| Search no-results state | typed "photo", read live region + empty div | live region (`aria-live=polite aria-atomic=true`) announced **"No results"**; visible empty state showed **"No results"** — correct |
| Search overlay stacking | `getComputedStyle` zIndex | overlay z-40 `rgba(0,0,0,0.5)`, dialog z-50 — correct order |
| SimilarPhotos toggle touch target | opened info sidebar (panel-right-open), `getBoundingClientRect` | **44px height** (302px wide), `min-height:44px`, `aria-expanded=false` — compliant |
| **SimilarPhotos 503-vanish + CLS** | clicked toggle, measured EXIF `<h3>` top before/after | API `503`; toggle **removed from DOM** after click; EXIF heading jumped **468px → 408px = 60px upward layout shift** |
| Dark-mode contrast of `text-muted-foreground` on `bg-card` | live `getComputedStyle` + luminance calc | rgb(161,161,170) on rgb(9,9,11) = **7.76:1** (AAA pass) |
| Light-mode contrast of `text-muted-foreground` on `bg-card` | toggled `.dark`→`.light`, recomputed | rgb(98,98,106) on rgb(255,255,255) = **6.04:1** (AA pass) |
| Console / page errors from these components | `agent-browser console` / `errors` | **0 errors.** One unrelated Recharts container warning (Histogram, out of scope). |
| i18n en+ko parity for `search.*` | flattened both message files | **0 missing keys** in either direction; Korean uses fixed `{count}개` per the documented plural convention (NOT a finding) |
| Disclaimer-only-in-stub contract | `search-disclaimer.test.ts` | locked by test; `semanticSearchMode==='stub'` gates `semanticExperimentalHint` |

**Net assessment of the honesty question the prompt asked:** the "experimental" disclaimer behavior is **honest and correct**. In prod (`disabled`) the entire semantic toggle block (search.tsx:414–450) does not render at all — visitors see keyword-only search with no semantic affordance and no misleading claim. The disclaimer text (`search.semanticExperimentalHint` = "Experimental — results may not match your query.") renders **only** in `stub` mode, where scores are random. The admin Settings UI only offers `disabled`/`stub` (settings-client.tsx:662–663) — there is no admin-reachable `production` option — so a visitor can never see real-but-unlabelled semantic results through any reachable config. This is the right call and it is test-locked.

---

## NET-NEW FINDINGS THIS PASS: **6** (0 Critical · 0 High · 3 Medium · 3 Low)

The search component is **excellent** — it matches the `tag-input.tsx` combobox gold standard (full ARIA, IME-guarded keyboard nav, stale-response guards, focus restoration, body-scroll lock, live region). All findings below concern `similar-photos.tsx`, plus two minor search nits. None is a WCAG A/AA hard failure; the touch-target floor is met live on both components.

---

### DES-CLIP-1 — `SimilarPhotos` loading state has no accessible name (silent for SR users) · **Medium** · **High confidence**

**File:** `apps/web/src/components/similar-photos.tsx:105-108`

```tsx
{loading ? (
    <div className="flex items-center justify-center py-4">
        <span className="text-sm text-muted-foreground animate-pulse">{'…'}</span>
    </div>
) : ...}
```

**Problem (WCAG 4.1.3 Status Messages, AA):** the loading indicator is a bare `…` glyph with `animate-pulse` and **no `role="status"`, no `aria-live`, and no accessible label.** A screen-reader user who activates the "Similar photos" disclosure hears the panel expand, then **silence** during the fetch. The sibling `search.tsx` does this correctly — its spinner is `<Loader2 … role="status" aria-label={t('common.loading')} />` (search.tsx:358) and it has a dedicated `aria-live="polite"` region. SimilarPhotos has neither.

Additionally, under `prefers-reduced-motion` the global rule (`globals.css:291`, `animation-iteration-count: 1 !important`) freezes `animate-pulse` to a single static frame — so reduced-motion users get a motionless, label-less `…` that is indistinguishable from stalled UI.

**User impact:** SR users and reduced-motion users get no feedback that a search is in progress; on a slow network the panel looks broken.

**Fix:** add `role="status"` and an accessible label, reusing the existing `common.loading` key (no new i18n key needed):
```tsx
<div className="flex items-center justify-center py-4" role="status" aria-live="polite">
    <span className="text-sm text-muted-foreground animate-pulse" aria-hidden="true">{'…'}</span>
    <span className="sr-only">{tCommon('loading')}</span>
</div>
```
(import a `useTranslations('common')` alongside the existing `useTranslations('search')`).

---

### DES-CLIP-2 — `SimilarPhotos` collapses 60 px of layout when the fetch fails/disables (CLS + jarring vanish) · **Medium** · **High confidence**

**File:** `apps/web/src/components/similar-photos.tsx:64-84`

```tsx
if (!res.ok) {           // 503 (stub/disabled), 404 (no embedding), 429, 5xx
    setResults('error');
    setOpen(false);
    return;
}
...
// If a previous fetch errored, don't render at all
if (results === 'error') return null;
```

**Problem (WCAG 2.5.5 / general UX; CLS):** I measured this live. In prod (`disabled` mode) the similar route returns `503` for **every** request. The user sees a "Similar photos" disclosure, clicks it, gets a brief `…`, and then the **entire toggle button is removed from the DOM** — and everything below it (the EXIF heading, all EXIF rows) **jumps up 60 px** (EXIF `<h3>` top moved 468px → 408px in my measurement). There is no message explaining what happened; the affordance simply punishes the click and disappears.

For the prod-`disabled` and `404`-no-embedding cases, silent removal is a defensible "honest dark" choice — but it should be silent *on mount*, not *after the user invests a click and watches a spinner*. And for transient failures (`429` rate-limited, `5xx`) the silent vanish destroys any recovery affordance: the user cannot retry because the control is gone (and `fetchedRef.current` is already `true`, so re-expanding within that instance would not refetch even if the control were still there).

**Bigger structural point — the control is effectively dead in every admin-reachable config.** The similar route is `production`-only (`api/search/similar/[id]/route.ts` Gate 5 → 503 otherwise), but the admin Settings UI only exposes `disabled`/`stub`. So in **every** state an operator can actually select, clicking "Similar photos" results in a 503 → vanish + 60px jump. Rendering a clickable disclosure that is guaranteed to fail-and-disappear is a poor affordance.

**User impact:** confusing disappearing control + measurable layout shift on every click in prod; no retry path on transient errors.

**Fix (pick one):**
1. **Preferred:** probe capability before rendering the toggle at all — only mount `SimilarPhotos` when `semanticSearchMode === 'production'` (pass the mode down from `photo-viewer.tsx` exactly like `search.tsx` already receives `semanticSearchMode`). Then the disclosure never appears in disabled/stub, and the dead-affordance + CLS problem disappears entirely.
2. If the toggle must render, **keep it visible on error** and show an inline message for transient failures (distinguish `429`/`5xx` → "Couldn't load similar photos. [Retry]" from `503`/`404` → collapse quietly), and reserve a `min-h` on the panel so the collapse doesn't shift siblings.

---

### DES-CLIP-3 — `SimilarPhotos` empty/loaded panel shifts sibling content on every expand (intra-sidebar CLS) · **Low** · **Medium confidence**

**File:** `apps/web/src/components/similar-photos.tsx:103-130`, mounted at `photo-viewer.tsx:856` between `WideGamutHint` and the EXIF `<h3>`.

**Problem:** even on the success path, expanding the disclosure inserts a variable-height block (spinner ~56px → either a `grid-cols-3` of `aspect-square` thumbnails, potentially 100px+, or a one-line "No similar photos found.") directly above the EXIF section, pushing it down. Because the panel lives inside the `overflow-y-auto` info `Card` (photo-viewer.tsx:814) and not above the main image (the LCP element), this is confined to the sidebar and is user-triggered, so it does not affect page-level CLS or LCP — hence Low. But the spinner→grid height delta is a visible jump within the panel.

**User impact:** minor visual jump within the info sidebar when results arrive.

**Fix:** reserve a stable `min-h` on the expanded container (e.g. `min-h-[7rem]`) so the spinner and the eventual grid/empty-text occupy the same vertical box, eliminating the spinner→content jump.

---

### DES-CLIP-4 — Inaccurate code comment claims the `Switch` gets its 44px from wrapper padding · **Low** · **High confidence**

**File:** `apps/web/src/components/search.tsx:436-438`

```tsx
// 44px touch-target floor: Switch has an implicit min-h,
// wrapper div provides at least 44px tap area via padding.
```

**Problem:** misleading documentation (not a runtime defect). The `Switch` primitive (`components/ui/switch.tsx:16`) itself carries `min-h-11 min-w-11` (44×44), so the touch target is met by the Switch, not by "wrapper div padding" — the wrapper (`p-3` row, search.tsx:415) does not provide the floor. The comment will mislead a future maintainer who removes the wrapper padding thinking it is load-bearing for accessibility. The semantic toggle is only reachable in `stub` mode, so live measurement was not possible in the default config, but the static class is unambiguous: `min-h-11 min-w-11` on the Radix root.

**Fix:** correct the comment to "Switch primitive floors at min-h-11/min-w-11 (44px) — touch target met by the control itself."

---

### DES-CLIP-5 — Search result thumbnail `alt` falls back to a generic "Photo" while the row text has a richer fallback (redundant SR announcement) · **Low** · **Medium confidence**

**File:** `apps/web/src/components/search.tsx:76` (thumbnail `alt`) vs `:91-96` (row text)

```tsx
alt={image.title || t('common.photo')}   // line 76 — generic "Photo" when no title
...
<p className="font-medium text-sm truncate">
    {image.title || image.description || `${t('common.photo')} ${image.id}`}  // line 92 — richer
</p>
```

**Problem (WCAG 1.1.1 Non-text Content, A — minor):** the row's visible label has a good 3-tier fallback (`title` → `description` → `Photo {id}`), but the adjacent thumbnail's `alt` only falls back to a bare `"Photo"` — so a screen reader on a titleless photo announces the `<img>` as "Photo" and then the link text as "Photo 80", which is slightly redundant. The thumbnail is inside the same `<Link role="option">`, so its `alt` adds to the option's accessible name. By contrast `similar-photos.tsx:161` uses `alt={title ?? ''}` (empty alt — treats the thumb as decorative since the Link carries the label), which is the cleaner pattern for a thumbnail wrapped in a labelled link.

**User impact:** minor — slightly redundant SR announcement on titleless photos in search results.

**Fix:** make the search thumbnail decorative (`alt=""`) since the row text already names the option, mirroring `SimilarThumb`'s approach; or align both on the same 3-tier string. Either is fine — just make them consistent.

---

### DES-CLIP-6 — `SimilarThumb` produces an empty-accessible-name link for untitled photos · **Low** · **Medium confidence**

**File:** `apps/web/src/components/similar-photos.tsx:153-172` (with `title` resolved at `:120`)

```tsx
<Link href={...} className="block ... aspect-square min-h-11 ..." title={title ?? undefined}>
    <Image ... alt={title ?? ''} ... />
</Link>
```

**Problem (WCAG 2.4.4 Link Purpose, A — minor):** when a similar photo has neither title nor description (`title` resolves to `null` at similar-photos.tsx:120), the `Link` gets **no `title` attribute and the image gets `alt=""`** — so the link has an **empty accessible name**. A screen-reader user tabbing the 3-column grid hears "link" with no description for untitled photos, and there is no visible text label in the grid either (it's a pure thumbnail grid). This is the titleless-photo edge of the otherwise-correct decorative-thumb pattern. Only bites when photos lack both title and description — common for camera-default filenames.

**User impact:** untitled similar photos are unlabelled links for SR users (they can still be activated, but the destination is opaque).

**Fix:** provide a guaranteed non-empty accessible name, e.g. `alt={title ?? t('common.photo')}` (and drop the empty-string branch), or add `aria-label={title ?? `${t('common.photo')} ${imageId}`}` to the `Link`.

---

## Things I explicitly checked and found CORRECT (no finding)

- **Search combobox/listbox ARIA** — textbook: `role=combobox` + `aria-autocomplete=list` + `aria-controls`/`aria-expanded`/`aria-activedescendant` wired to `#search-results` `role=listbox` with `role=option aria-selected` rows and stable `search-result-{idx}` ids. Matches `tag-input.tsx`. (search.tsx:330–334, 384, 66–71) — empty-state ARIA verified live.
- **Search keyboard model** — ArrowDown/Up move `activeIndex` (clamped), Enter activates the active row via `resultRefs.current[activeIndex]?.click()`, Escape closes; all **IME-guarded** (`isImeComposingReactEvent`, search.tsx:343) so Korean composition arrows/Enter don't hijack result selection. Cmd/Ctrl+K toggles. (search.tsx:243–250, 337–354)
- **Search focus management** — `FocusTrap` with `initialFocus:'#search-input'` + `fallbackFocus:'#search-dialog'`; focus restored to the trigger button on close via `wasOpenRef` + `requestAnimationFrame` (search.tsx:256–267, 305–312). Body scroll locked while open (search.tsx:272–277).
- **Search debounce/INP** — 300ms debounce (search.tsx:225–227) + `requestIdRef` stale-response guard on **both** awaits (the `resp.json()` second-await re-check at search.tsx:175 is correct, per the COR-R4C6-07 lineage). Good for INP — no per-keystroke fetch storm.
- **Search live region** — `sr-only aria-live=polite aria-atomic` announces searching / status / `resultsCount` plural / noResults (search.tsx:371–381). Verified live: announced "No results".
- **Search responsive** — full-screen on mobile (`inset-0`), centered card on `sm:` (`sm:max-w-xl sm:rounded-xl sm:top-…`), Cmd/Ctrl+K hint hidden on mobile (`hidden sm:block`, search.tsx:409). Sound.
- **Touch targets** — verified live: search input 44px (despite `h-8`), close button 44×44, SimilarPhotos toggle 44px, `SimilarThumb` link `min-h-11` + `aspect-square`. The `Button`/`Switch`/`Input` primitives all floor at ≥44px (`min-h-11`/`size-11`/`size-12`). **No touch-target violation in either component** — consistent with the `touch-target-audit.test.ts` policy (both files live under `components/` SCAN_ROOTS and would fail the audit otherwise).
- **Focus-visible rings** — both components use `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on every interactive element (search rows, close, SimilarPhotos toggle + thumbs). WCAG 2.4.7 met.
- **Contrast** — `text-muted-foreground` on `bg-card` measured **7.76:1 (dark)** / **6.04:1 (light)**, both pass AA for the small subtitle/metadata text both components lean on. WCAG 1.4.3 met.
- **i18n** — en+ko `search.*` at full parity (0 missing either direction); ko fixed `{count}개` is the documented intentional non-plural form, NOT a defect.
- **Disabled-mode honesty** — the semantic toggle + disclaimer are entirely gated out in `disabled` (prod); disclaimer shows only in `stub`. Honest and test-locked (`search-disclaimer.test.ts`).
- **Image fallback (404→base JPEG)** — both `SearchResultItem` (search.tsx:81-88) and `SimilarThumb` (similar-photos.tsx:166-170) carry the per-item `onError` sized→base fallback with a `fallbackTriedRef` one-shot guard, matching the R21/R22/R23 lightbox/viewer pattern. No infinite-onError loop. Correct.

---

## Compact finding list (for the aggregator)

- **DES-CLIP-1** · Medium · High — `similar-photos.tsx:105-108` loading `…` has no `role="status"`/`aria-live`/accessible name (silent for SR + reduced-motion users). WCAG 4.1.3. Fix: add `role=status` + `sr-only` `common.loading`.
- **DES-CLIP-2** · Medium · High — `similar-photos.tsx:64-84` clicking the toggle in prod (503 every time) removes the control from the DOM and shifts siblings **60px up** (measured live); no retry on transient 429/5xx; control is dead in every admin-reachable mode (UI offers only disabled/stub; route needs production). Fix: gate the toggle on `semanticSearchMode==='production'` (pass mode down from photo-viewer), or keep it visible with an inline retry + reserved height.
- **DES-CLIP-3** · Low · Medium — `similar-photos.tsx:103-130` spinner→grid/empty height delta causes an intra-sidebar jump on expand (confined to the `overflow-y-auto` Card; not page LCP/CLS). Fix: reserve `min-h` on the expanded panel.
- **DES-CLIP-4** · Low · High — `search.tsx:436-438` comment falsely claims the Switch's 44px comes from wrapper padding; the `Switch` primitive itself is `min-h-11 min-w-11`. Doc-only; fix the comment so a maintainer doesn't strip "load-bearing" padding.
- **DES-CLIP-5** · Low · Medium — `search.tsx:76` thumbnail `alt` falls back to bare "Photo" while the row text has a richer 3-tier fallback; minor redundant SR announcement. WCAG 1.1.1. Fix: make the thumb decorative (`alt=""`) like `SimilarThumb`, or align both.
- **DES-CLIP-6** · Low · Medium — `similar-photos.tsx:153-172` untitled similar photos become empty-accessible-name links (`alt=""` + no `title`). WCAG 2.4.4. Fix: `alt={title ?? t('common.photo')}` or `aria-label` on the Link.

**Search component verdict:** ships clean — matches the repo's combobox gold standard; only two Low nits (DES-CLIP-4 doc, DES-CLIP-5 alt). **SimilarPhotos verdict:** functional and touch-target-compliant, but its error/loading/empty UX is weaker than its siblings (DES-CLIP-1/2/3 + DES-CLIP-6) — the headline item is DES-CLIP-2 (dead clickable affordance + 60px CLS in every reachable prod config). The honest-dark *intent* is right; the execution should make the dark state silent *before* the click, not *after*.

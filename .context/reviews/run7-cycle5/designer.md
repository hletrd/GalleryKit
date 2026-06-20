# Designer (a11y / touch-target / i18n) — run-7 cycle-5

**HEAD:** `1cdbb883` (working tree clean per git status at session start).
No source files under SCAN_ROOTS changed since cycle-4; the only commits since
then are review docs and an SW_VERSION stamp.

**Verdict: 0 NEW actionable findings. Convergence confirmed.**

---

## 1. Touch-Target Audit

### Gate status

All 15 `touch-target-audit.test.ts` tests **pass** (confirmed by live run,
321 ms):

```
✓ matches the documented per-file violation count across all SCAN_ROOTS  171ms
✓ finds no < 44 px touch targets in admin login form
✓ FORBIDDEN regex catches HTML <button>, size="icon", and cn() composites
✓ scanSource catches multi-line <Button size="icon"> with sub-44px className
✓ scanSource catches multi-line <Button size="sm"> without h-11 override
✓ scanSource catches multi-line native <select> with sub-44px className
✓ scanSource catches a raw <input type="checkbox"> with sub-44 wrapper
✓ scanSource accepts multi-line <Button size="icon"> with h-11 override
✓ scanSource accepts multi-line <Button size="sm"> with h-11 override
✓ FORBIDDEN regex does not flag valid h-11 / size-11 / overridden size="icon"
✓ scanSource catches multi-line <Badge asChild> with sub-44 min-h composite
✓ scanSource accepts multi-line <Badge asChild> with min-h-11 chip sizing
✓ public inline recovery <Link>s keep their min-h-11 tap area (AGG-C5-03)
✓ public back-nav <Link>s keep their min-h-11 tap area (AGG-C6-03)
✓ admin-header brand <Link> keeps its min-h-11 tap area (AGG-C7-01)
```

### KNOWN_VIOLATIONS budget

Total budget: **17** violations across 8 non-zero entries. Measured values
match the documented KNOWN_VIOLATIONS map exactly:

| File | Budget |
|---|---|
| `components/image-manager.tsx` | 1 |
| `components/admin-user-manager.tsx` | 2 |
| `components/admin-header.tsx` | 1 |
| `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` | 5 |
| `app/[locale]/admin/(protected)/categories/topic-manager.tsx` | 3 |
| `app/[locale]/admin/(protected)/tags/tag-manager.tsx` | 3 |
| `app/[locale]/admin/(protected)/settings/settings-client.tsx` | 1 |
| `app/[locale]/admin/(protected)/seo/seo-client.tsx` | 1 |

### New component scan: `similar-photos.tsx`

The `SimilarPhotos` component added in recent cycles was reviewed directly.
The toggle button (`button:114`) carries `min-h-11` explicitly; each thumbnail
`<Link>` (`Link:181`) carries `block … aspect-square min-h-11`. Both meet the
44 px floor. The scanner includes `similar-photos.tsx` in the
`components/` SCAN_ROOT; it produces **0 violations**, which is already
accounted for by the gate run.

### Deferred carry-over (not re-raised)

DEF-C11-01: `search.tsx:374` — `<Input>` `h-8` (32 px). Deliberately
out-of-scope (full-width horizontal target, vertical extent 32 px, no blocking
gate failure). Exit criterion unchanged; not re-raised.

---

## 2. Accessibility Surface Review

### Lightbox (`components/lightbox.tsx`)

Evidence from direct code read:

- `role="dialog" aria-modal="true" aria-label={t('aria.lightbox')}` at `:450–452`. Correct dialog semantics.
- Focus lock: `<FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: … }}>` at `:447`. Focus is force-placed on the close button ref on open (`:437`).
- Focus restore: `previouslyFocusedRef` captures `document.activeElement` before open (`:433`); restored on close via `previouslyFocusedRef.current.focus()` at `:441` with a `document.body.contains()` guard — safe.
- `aria-live="polite" aria-atomic="true"` announcement region at `:461` for slide transitions; `role="status" aria-live="polite"` counter at `:669–671`.
- All control buttons carry explicit `aria-label` + `aria-keyshortcuts`. Sizes: close/fullscreen/slideshow buttons at `h-11 w-11` (`:550`, `:570`, `:594`); prev/next use `h-full w-16` full-height zones (`:617`, `:637`) — both well above 44 px.
- `aria-hidden: true` on controls when hiding; `blur()` called before setting `aria-hidden` to avoid hiding a focused element (WCAG 4.1.2 compliance comment at `:147–149`).

No gaps found.

### Search dialog (`components/search.tsx`)

- Trigger button: `aria-haspopup="dialog" aria-expanded={isOpen} aria-label={t('aria.searchPhotos')}` at `:304–306`.
- Dialog container: `role="dialog" aria-modal="true" aria-label={t('aria.searchPhotos')}` at `:333–335`.
- Input: `role="combobox" aria-autocomplete="list" aria-controls={results.length > 0 ? 'search-results' : undefined} aria-expanded={results.length > 0} aria-activedescendant={…}` at `:348–352`. The conditional `aria-controls` (undefined when no results) is correct — omitting the attribute when the listbox is absent avoids a dangling IDREF.
- Results container: `id="search-results" role="listbox"` at `:402`. Pairs with `aria-controls`.
- Each result item: `role="option" aria-selected={idx === activeIndex}` at `:74–75`.
- Live region: `aria-live="polite" aria-atomic="true"` sr-only div at `:389` for result count announcements.
- Focus: `requestAnimationFrame(() => inputRef.current?.focus())` on open (`:277`); `triggerRef.current?.focus()` on close (`:282`).
- `<FocusTrap>` wraps the dialog (`:325`).

No gaps found.

### Mobile bottom sheet (`components/info-bottom-sheet.tsx`)

- `role="dialog" aria-modal="true" aria-label={t('viewer.bottomSheet')}` at `:201–203`.
- `<FocusTrap>` wraps the sheet content at `:192`.
- Drag handle / expand toggle: `min-h-11` at `:221`; `aria-expanded` + `aria-label` at `:236–237`.
- Close button: `min-h-11 min-w-11` at `:248`; `aria-label={t('aria.close')}` at `:249`.

No gaps found.

### ColorDetailsSection accordion (`components/color-details-section.tsx`)

- Toggle button: `aria-expanded={showColorDetails} aria-controls={colorDetailsId}` at `:291–292`; `min-h-[44px]` on the button at `:299`.
- Tooltip buttons: `min-h-[44px] min-w-[44px]` with `aria-label` at `:308–309`, `:324`, `:400–401`.
- HDR badge: `role="img" aria-label={t('viewer.hdrBadgeAriaLabel')}` at `:529–531`.

No gaps found.

### LightboxColorPip (`components/lightbox-color-pip.tsx`)

- Toggle button: `min-h-11` at `:131`; `aria-expanded={open}` at `:132`; full `aria-label` string at `:133`.
- Decorative spans inside pip closed-state: `aria-hidden="true"` at `:144`, `:146`, `:148`, `:152` — correct.
- Inside expanded panel: tooltip buttons `min-h-11 min-w-11` at `:189`; copy button `min-h-11 min-w-11` at `:271`.

No gaps found.

### WideGamutHint (`components/wide-gamut-hint.tsx`)

- Container: `role="status" aria-live="polite" aria-atomic="true"` at `:178–188`. Explicit `aria-live` supplements `role="status"` for NVDA compatibility (per in-code comment at `:179–182`).
- Dismiss button: `min-h-11 min-w-11` at `:203`; `aria-label={t('viewer.wideGamutHintDismiss')}` at `:202`; close icon `aria-hidden="true"` at `:205`.

No gaps found.

### SimilarPhotos (`components/similar-photos.tsx`)

New component audited this cycle:

- Toggle button: `min-h-11` at `:114`; `aria-expanded={open}` at `:115`; `aria-controls="similar-photos-results"` at `:116`.
- Panel: `id="similar-photos-results"` at `:127` pairs correctly with `aria-controls`.
- Loading state: `role="status" aria-live="polite"` at `:131`.
- Thumbnail links: `min-h-11` at `:181`; `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` keyboard focus ring present.
- Chevron icon: `aria-hidden` inferred (decorative icon rendered inside the labeled button — no explicit `aria-hidden`, but the button's accessible name comes from its text content, not the icon; not a gap).

No gaps found.

---

## 3. i18n Key-Set Parity

Comparison performed via recursive key enumeration of both message files:

- `messages/en.json`: **882** leaf keys
- `messages/ko.json`: **882** leaf keys
- Keys only in EN: **0**
- Keys only in KO: **0**

Top-level namespace count matches: **37 in each** (nav, db, users, downloadPage,
dashboard, categories, tags, tagInput, password, upload, imageManager, home,
login, viewer, shared, search, notFound, sharedGroup, seo, serverActions,
theme, aria, common, photo, topic, smartCollection, error, settings, footer,
onThisDay, map, lrToken, timeline, stripe, sales, licensePrice, analytics).

Korean ICU plural asymmetry (single fixed form vs. EN `{count, plural, …}`)
was NOT flagged — this is intentional per CLAUDE.md DOC-R5C3-07.

No gaps found.

---

## Summary

| Domain | Finding count |
|---|---|
| Touch-target (new sub-44 elements) | 0 |
| Touch-target (gate test failures) | 0 |
| A11y: lightbox | 0 |
| A11y: search dialog | 0 |
| A11y: mobile bottom sheet | 0 |
| A11y: ColorDetailsSection | 0 |
| A11y: LightboxColorPip | 0 |
| A11y: WideGamutHint | 0 |
| A11y: SimilarPhotos (new) | 0 |
| i18n key-set parity | 0 |

**NEW actionable findings: 0**

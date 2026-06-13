# Designer Review — GalleryKit (run-8 cycle-2, UI/UX + WCAG 2.2)

**Date:** 2026-06-13
**Reviewer:** `designer` agent (UI/UX + accessibility)
**Scope:** interactive/visual surfaces under `apps/web/src/components/`, `app/[locale]/admin/`, `app/[locale]/(public)/`. Static source analysis (JSX/TSX/CSS read directly); no live browser run. Evidence = exact `file:line`, classNames, ARIA attributes, computed hex/contrast (sRGB WCAG formula, tokens resolved from `globals.css`).
**HEAD verified:** `77867144` (run-7 c1 SW re-stamp); working tree clean per orchestrator.

**Headline:** The codebase remains unusually mature on accessibility — a blocking 44px touch-target test, focus-trap-react in lightbox + search, textbook comboboxes (tag-input, search), settle-before-close dialogs everywhere, triple-encoded status (sales), live regions, `prefers-reduced-motion` + `forced-colors`. All three prior-cycle designer findings (DES-01/02/03 → run-7 fixes) **verify CLOSED at HEAD**. This cycle surfaces **two real, text-extractable defects** the prior passes missed (a sub-44 raw checkbox that slips the audit's regex blind spot, and a public-surface contrast failure on the active tag-filter chip count), plus polish-level carryovers.

---

## Prior designer findings — verification at HEAD

| Prior ID | run-7 fix commit | Status at HEAD | Evidence |
|---|---|---|---|
| **DES-01 / AGG-R7-04** (settings aria-describedby) | `61cfd235` | **CLOSED** | `settings-client.tsx` now has **18** `aria-describedby` (was 8). The 3 quality inputs (357/371/385), 3 color selects (469/486/512), wide-gamut-max-source-pixels (535), and the license trio (702/715/728, all → `license-price-help`) are wired. |
| **DES-02 / AGG-R7-03** (error-shell visible heading) | `0d2312cd` | **CLOSED** | Both shells now render a visible `<h1 className="text-3xl font-semibold tracking-tight">`: `error.tsx:27` (`route-error-title`) and `admin/(protected)/error.tsx:30` (`admin-route-error-title`). `aria-labelledby` resolves to the visible h1. Sighted users get a real heading; matches the 404 intent. |
| **DES-03 / AGG-R7-07** (dropzone aria-disabled honesty) | `35d07f0b` | **CLOSED** | `upload-dropzone.tsx:413` now applies `tabIndex: -1` when `(uploading \|\| !hasTopics)`, and the base `cursor-pointer` is conditional (line 416) so it no longer races `cursor-not-allowed`. `useDropzone({disabled})` already drops root handlers; the disabled affordance is now enforced for keyboard/AT. |

No regression of any prior closed finding (the back-to-top `aria-hidden`/`tabIndex`/`pointer-events` triad, masonry `columns-N` safelist, focus-trapped lightbox, reduced-motion + forced-colors all re-confirmed clean).

---

## Severity counts (this cycle, OPEN/NEW)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Verified-correct (no action) | 4 |

## Findings table

| ID | Sev | File:line | WCAG / principle | One-line |
|----|-----|-----------|------------------|----------|
| **DES-1** | **Med** | `image-manager.tsx:418, 444` | 2.5.5 (AAA) + audit blind spot | Select-all + per-row checkboxes have a 32×32 px (`min-h-8 min-w-8`) tap area — below the repo's own documented 44 px floor; the touch-target audit's FORBIDDEN regex never scans raw `<input type="checkbox">`, so it slips silently |
| **DES-2** | **Med** | `tag-filter.tsx:95` | 1.4.3 | The photo-count `({n})` on the *active* (selected) tag chip is `text-muted-foreground` over `bg-primary`, computing **2.94:1** (light) / **2.45:1** (dark) — fails 4.5:1 small-text. Public home surface |
| **DES-3** | Low | `image-manager.tsx:526`, `color-details-section.tsx:514`, `lightbox-color-pip.tsx:148`, `info-bottom-sheet.tsx:278` | 1.4.3 | HDR badge `text-white` on `from-amber-300 to-orange-400` gradient at 10–12px computes **1.44:1 → 2.26:1** — fails small-text contrast. Admin-gated + redundantly text-labelled, so impact is bounded, but the badge text is genuinely hard to read |
| **DES-4** | Low | `login-form.tsx:51-60, 71-80, 97-100` | 3.3.1 | Login inputs lack `aria-invalid` / `aria-describedby` on failed auth (carryover from prior DES-06, still open). The alert `<p>` (98) has no `id`. The repo's own `admin-user-manager.tsx:120` + `password-form.tsx` are the correct pattern |
| **DES-5** | Low | `bulk-edit-dialog.tsx:211/219, 184/194, 231/239, 251/264` | 1.3.1 / 4.1.2 | The conditionally-rendered `set`-mode `<Input>`/`<Select>` (title prefix, topic, description, license) have no programmatic label — the section `<Label>` has no `htmlFor` and the control has no `id`/`aria-label` (the `<SelectValue>` placeholder is the only cue) |
| **DES-6** | Low | `photo-navigation.tsx:222, 237` | 1.4.11 (non-text contrast) | Prev/Next nav buttons rest at `bg-black/50` with white chevrons over arbitrary photo content; resting scrim can drop the 3:1 icon/background ratio on bright photos (hover bumps to `/70`). The sibling position counter was already bumped `/50→/70` for this exact reason (`photo-viewer.tsx:794`) |
| **DES-7** | Low | `analytics-client.tsx:113, 222`; `image-manager` (`/p/`,`/g/`) | i18n / routing consistency | Admin-internal preview links use raw `/p/${id}` and `/g/${shareKey}` (no locale prefix) while every public Link goes through `localizePath`. Functional (middleware redirects), but inconsistent and relies on the redirect hop |
| DES-V1 | ✓ | `error.tsx:27` + `admin/(protected)/error.tsx:30` | 1.4.3 / 2.4.6 | AGG-R7-03 fix verified: both error shells render a visible `text-3xl` h1; `aria-labelledby` resolves |
| DES-V2 | ✓ | `settings-client.tsx` (18× `aria-describedby`) | 1.3.1 | AGG-R7-04 fix verified: all formerly-unwired hints now associated |
| DES-V3 | ✓ | `upload-dropzone.tsx:408-419` | 4.1.2 | AGG-R7-07 fix verified: `tabIndex:-1` when disabled + conditional cursor |
| DES-V4 | ✓ | `sales-client.tsx:88-102` | 1.4.1 | StatusBadge triple-encodes (text + color + icon); `role="alert"` load error; settle-before-close refund dialog. Exemplary |

---

## Detail — Medium findings

### DES-1 (Medium) — sub-44 raw checkboxes + touch-target audit blind spot
`apps/web/src/components/image-manager.tsx`:
```
418  <label className="inline-flex min-h-8 min-w-8 items-center justify-center">   ← select-all
419      <span className="sr-only">{t('aria.selectAll')}</span>
420-427  <input ref={selectAllRef} type="checkbox" className="h-5 w-5 …" … />
…
444  <label className="inline-flex min-h-8 min-w-8 items-center justify-center">   ← per-row
445      <span className="sr-only">{t('aria.selectImage', …)}</span>
446-452  <input type="checkbox" className="h-5 w-5 …" … />
```
- The clickable area is the `<label>` at `min-h-8 min-w-8` = **32×32 px**. The checkbox glyph is `h-5 w-5` = 20px. The label is the hit target (label-wraps-input), so the effective tappable size is **32×32 px**.
- **Repo policy violation:** CLAUDE.md "Touch-Target Audit" states *"44×44 px minimum — all interactive elements (buttons, links, checkboxes, etc.)"*. 32px is below the WCAG 2.5.5 AAA floor (44px) the repo claims to enforce. It **passes** WCAG 2.5.8 AA (24px), so this is a AAA gap, not an AA blocker.
- **Why it slipped every prior cycle:** the blocking `touch-target-audit.test.ts` FORBIDDEN regex set (lines 275-330) matches `<Button>`, HTML `<button>`, `<Badge asChild>`, and native `<select>` — there is **no pattern for `<input type="checkbox">`**. `grep` confirms the only `type="checkbox"` occurrences in scanned dirs are these two image-manager lines, and the test file's only checkbox reference is `'components/ui/checkbox.tsx': 0` (the unused shadcn primitive). The audit is structurally blind to hand-rolled checkboxes.
- **Impact:** on a touch device, admins selecting individual photos for bulk delete/tag/share must hit a 32px target — error-prone, especially adjacent rows. The select-all is in the sticky header.
- **Fix:** bump both wrapper labels to `min-h-11 min-w-11` (the checkbox glyph stays `h-5 w-5`, centered). Then add a FORBIDDEN pattern to `touch-target-audit.test.ts` for `<input[^>]*type=["']checkbox["']` whose wrapping `<label>` carries `min-h-[0-9]`/`min-h-8`/`min-h-9` < 11 (or simpler: flag any `min-h-8`/`min-h-9`/`min-h-10` on an `inline-flex` label that contains a checkbox) so the blind spot closes. Confidence: **High** (math + regex scope both text-verified).

### DES-2 (Medium) — active tag-filter chip count fails contrast (public surface)
`apps/web/src/components/tag-filter.tsx:88-96`:
```
80  variant={currentTags.includes(tag.slug) ? "default" : "outline"}
85  currentTags.includes(tag.slug) && "bg-primary text-primary-foreground"
…
94  {displayName(tag.name)}
95  <span className="text-xs text-muted-foreground">({tag.count})</span>
```
- When a tag is **selected**, the chip becomes `bg-primary text-primary-foreground`. The tag label inherits `text-primary-foreground` (high contrast — fine). But the count `<span>` sets its **own** `text-muted-foreground`, overriding the inherited foreground, so the parenthetical photo-count renders muted-gray on the primary background.
- Computed (tokens from `globals.css`: `--primary: 240 5.9% 10%` near-black, `--primary-foreground: 0 0% 98%`, `--muted-foreground: 240 3.8% 40%` light / `240 5% 64.9%` dark; `.dark --primary: 0 0% 98%`):
  - **Light active chip:** muted-fg(40% L) on primary(10% L) = **2.94:1**
  - **Dark active chip:** muted-fg(64.9% L) on primary(98% L) = **2.45:1**
  - Both below the 4.5:1 floor (`text-xs` = 12px < 18px, so the large-text 3:1 exemption does NOT apply).
  - For contrast: an **inactive** chip (outline variant, transparent over `bg-background`) puts the same muted count at **6.03:1** — fine. The failure is exclusively in the selected state.
- **Impact (1.4.3):** on the public home page, once a visitor selects a tag, that chip's photo-count number becomes hard to read in both themes. The default "All" chip (line 65, also `bg-primary` when no tags selected) has no count, so it's unaffected.
- **Fix:** drop `text-muted-foreground` on the count span and let it inherit, OR conditionally use `text-primary-foreground/70` when the chip is active (a 70% tint of primary-foreground over primary still clears 4.5:1 in both themes). Simplest: remove the explicit muted class so it inherits the chip's foreground. Confidence: **High** (tokens + math text-verified).

---

## Detail — Low findings

### DES-3 (Low) — HDR badge white-on-amber-gradient is low-contrast text
The `text-white` HDR badge over `bg-gradient-to-r from-amber-300 (#fcd34d) to-orange-400 (#fb923c)` appears in **4** places (all admin-gated, since `is_hdr`/`transfer_function` are `_PrivacySensitiveKeys` admin-only fields):
- `image-manager.tsx:526` (admin table, `text-[10px]`)
- `color-details-section.tsx:514` (photo-viewer accordion, `text-xs`)
- `lightbox-color-pip.tsx:148` (`text-[10px]`)
- `info-bottom-sheet.tsx:278` (`text-[10px]`)

Computed: white on amber-300 = **1.44:1**; white on orange-400 = **2.26:1**. Both fail 4.5:1 (and even the 3:1 large-text bar, though these are small text anyway). The prior cycle correctly cleared this for WCAG 1.4.1 (color-as-sole-indicator) because the literal text "HDR" carries the meaning — but **1.4.3 text legibility was never separately computed**. White on a bright amber/orange gradient is genuinely low-legibility.

**Severity Low because:** (a) admin-only audit metadata, never shown to public; (b) the "HDR" string is decoded by SR users regardless. **Fix:** use a dark foreground on the amber gradient (`text-amber-950`/`text-black`) — black on amber-300 ≈ 12:1, on orange-400 ≈ 8:1 — or darken the gradient and keep white. Apply consistently across all 4 sites (they share the `hdr-badge` class on three of them). Confidence: **High** (math text-verified).

### DES-4 (Low) — login inputs lack invalid-state cue (carryover, still open)
`apps/web/src/app/[locale]/admin/login-form.tsx`: on failed login (`state?.error`), the message renders as `<p role="alert" aria-live="assertive">` (98-100) + a toast (31). SR users hear it. But `grep -c "aria-invalid"` = **0** — neither `<Input id="login-username">` (51) nor `<Input id="login-password">` (71) is marked `aria-invalid`, and neither has `aria-describedby` pointing at the alert (which itself has no `id`). The repo already ships the correct pattern at `admin-user-manager.tsx:120` (`aria-invalid={!!confirmError}` + `aria-describedby` + matching `id` on the alert) and `password-form.tsx`. **Impact (3.3.1):** an SR user who tabs back to a field after the error announcement gets no per-field invalid cue. Form-level (not field-specific), so minor. **Fix:** add `aria-invalid={!!state?.error}` to both inputs, `id="login-error"` to the alert `<p>`, and `aria-describedby="login-error"` to each input. Confidence: **High**.

### DES-5 (Low) — bulk-edit "set"-mode controls lack a programmatic label
`apps/web/src/components/bulk-edit-dialog.tsx`: each field group has a `<Label>` (e.g. 184, 211, 231, 251) with **no `htmlFor`**, and the conditionally-rendered `set`-mode control has **no `id` / `aria-label`**:
- Topic Select (193-204): no `aria-label` (only `<SelectValue placeholder>`).
- Title-prefix Input (219-225): no `aria-label`, no `id`.
- Description Textarea (239-245): no `aria-label`, no `id`.
- License Select (260-274): no `aria-label`.

The `<Label>` text is visually adjacent but not programmatically associated, so an SR user focusing the title-prefix input hears only the placeholder ("e.g. Set 1 …"), not "Title prefix". Contrast with the well-labelled `ModeSelector` (47, `aria-label`) and the alt-text/tag inputs (286/306/319, all labelled). **Impact (1.3.1/4.1.2):** modest — the bulk-edit dialog is admin-only and the mode selector beside each field gives context. **Fix:** give each section `<Label>` an `htmlFor` and each control a matching `id` (or add `aria-label` to the control mirroring the section label). Confidence: **High** (the missing `htmlFor`/`id` pairing is text-evident).

### DES-6 (Low) — Prev/Next nav-button scrim contrast over bright photos
`apps/web/src/components/photo-navigation.tsx:222, 237`: the resting nav buttons are `bg-black/50` with `text-white` chevrons, sitting over arbitrary photo content. 50% black over a bright photo can leave the white icon below the 3:1 non-text-contrast bar (WCAG 1.4.11). The hover state goes to `bg-black/70` (line 222/237). Notably the repo already bumped the **sibling** position counter from `bg-black/50 → /70` for exactly this reason (`photo-viewer.tsx:794` comment: *"bump bg-black/50 → bg-black/70 so the white text clears WCAG AA against bright photo content"*) — the nav buttons were not given the same treatment. **Impact:** an edge-case contrast dip on bright images; icons-on-scrim is a common convention so impact is bounded. **Fix:** raise the resting scrim to `bg-black/70` (or add a subtle drop-shadow / ring) to match the counter's already-tuned value. Confidence: **Medium** (depends on photo luminance; the resting `/50` is provably weaker than the sibling control the repo chose to harden).

### DES-7 (Low) — admin preview links bypass `localizePath`
`analytics-client.tsx:113` (`href={`/p/${row.imageId}`}`) and `:222` (`href={`/g/${row.shareKey}`}`), plus the image-manager share-link construction, build **un-prefixed** public URLs while every other public `Link` in the app routes through `localizePath(locale, …)`. The i18n middleware redirects `/p/...` → `/{locale}/p/...`, so it works — but it relies on the redirect hop and is inconsistent with the rest of the codebase. **Impact:** negligible (functional); flagged for consistency only. **Fix:** route through `localizePath` (or document the intentional locale-agnostic preview convention). Confidence: **Medium** (the inconsistency is text-evident; whether it matters is a judgment call).

---

## Verified-correct (stress-tested, NO action)

- **Search combobox** (`search.tsx:305-398`): focus-trap-react (`initialFocus`/`fallbackFocus`), `role="dialog"` + `aria-modal`, sr-only `aria-live="polite" aria-atomic` status (371-381), full combobox ARIA (330-334), `role="listbox"` (384), 44px close (365). IME-composition guards on Enter/arrows. Exemplary.
- **tag-input combobox** (`tag-input.tsx`): textbook `role="combobox"` + `aria-autocomplete` + `aria-controls`/`aria-expanded`/`aria-activedescendant` (193-198), `role="listbox"`/`option`/`aria-selected`, 44px remove buttons (183) and 44px options (227/244), IME guards, click-outside, Tab-accepts-highlight. Reused across image-manager + bulk-edit.
- **admin-user-manager** (`admin-user-manager.tsx`): create dialog has `aria-invalid` + `aria-describedby` + error-focus (46) + matching alert `id` (122) — the reference pattern DES-4 should copy. Settle-before-close delete dialog.
- **tokens / sales / topic / bulk-edit dialogs**: all settle-before-close (DES-R4C14-B), `disabled` mid-flight on Cancel/overlay/ESC, `role="alert"` on dynamic validation/load errors, in-flight labels on the confirm action only.
- **nav-client**: all targets `min-h-[44px]`/`min-w-[44px]`, `aria-current="page"`, `aria-expanded`/`aria-controls` on the mobile toggle, decorative topic thumbnails `aria-hidden` + empty `alt`.
- **on-this-day-widget**: `<aside aria-label>`, `<ul role="list">`, per-item `aria-label`, next/image via OptimisticImage (no full-res-for-48px regression).
- **photo-viewer position counter**: `bg-black/70` + white = AA-verified, `role="status" aria-live="polite"`.
- **photo-navigation**: h-12 buttons, aria-labels, sr-only live region, z-20 click-fix documented.

---

## Recommended priority order
1. **DES-1** (sub-44 checkboxes + close the audit's `<input type="checkbox">` blind spot) — the only finding that both violates the repo's stated policy AND defeats its own enforcement test. Two-line CSS fix + one new FORBIDDEN regex.
2. **DES-2** (active tag-filter chip count contrast) — the only **public-surface** contrast failure; one-class fix.
3. **DES-3** (HDR badge text contrast across 4 sites) — admin-only but legibly broken; consistent foreground swap.
4. **DES-4 / DES-5 / DES-6 / DES-7** — form-cue + label + scrim + routing polish; batch when convenient. The repo already ships the correct pattern for DES-4 (admin-user-manager) and DES-6 (the counter scrim), so these are copy-the-existing-pattern fixes.

# GalleryKit UI/UX + A11y Review — Cycle 8 (2026-07-07)

**Reviewer:** designer lane (UI/UX + WCAG 2.2)
**HEAD at review:** `6256a988818bc292be5f153f2c49c4b81079b0ee`
**Method:** static source review only (shared worktree — a peer session is running concurrently; no dev server started, no writes to source, no git index changes). Read-only on committed source; this file is the only artifact written.

## 0. Scope and baseline

This repo has a long, heavily-converged designer-review lineage (`run4` through `run9`, then the renumbered `run-10`/`cycle-N-2026-07-07` sequence). The most recent prior designer pass is `.context/reviews/cycle-7-2026-07-07/designer.md`, which found two MED findings (`C7-DES1`/`C7-04`: nav search-trigger sub-44px width in production semantic-search mode; `C7-DES2`/`C7-10`: `SimilarThumb` duplicate-label ambiguity) plus a save-button focus-restore gap (`C7-11`). All three were fixed in commit `878508e3` ("44px search trigger, thumb label ids, save-button focus"), which I verified directly against the diff (below).

I confirmed via `git log 878508e3..6256a988 -- apps/web/src/components apps/web/src/app apps/web/messages` that **zero** component/page/i18n files changed between that fix commit and current HEAD — the only touched file in that range is a test file (`515a25bd`, non-UI). So this cycle's job is a fresh independent sweep for anything the last several cycles missed, not a diff review (there is effectively no UI diff to review).

Checked `.context/plans/deferred-carry-forward.md` for open UX/a11y deferred items to avoid re-filing: `C96-09`/`C96-10` (field-level form errors on SEO/topic-dialog), `C96-11` (restore file-size rejection UX), `C96-12`/`C94-07`/`C94-08` (mobile admin toolbar/nav), `C94-06` (keyboard-pannable zoom), `C96-14` (zoom-vs-swipe gesture), `C2-53` (a11y label report trigger), `C6-19` (truncated-metadata reveal). None of these had their exit criteria fire in this cycle (no incident report, no new mobile-admin cycle, no keyboard-zoom cycle) — I did not re-file any of them.

## 1. Verified fix from cycle 7 (`878508e3`)

- **`search.tsx` nav trigger:** `className={showSearchLabel ? "h-11 min-w-11 gap-2 px-3" : "h-11 w-11"}` — confirmed `min-w-11` is present on the `showSearchLabel` branch, so the icon-only rendering below the `lg` breakpoint no longer collapses under 44px wide. Fix is correct and complete.
- **`similar-photos.tsx` `SimilarThumb`:** `resultLabel = \`${label} #${imageId}\`` now feeds `title`, `aria-label`, and the `Image alt` identically — same disambiguation pattern as `search.tsx`'s `SearchResultItem`. Confirmed all three attributes use the same interpolated string (no Label-in-Name mismatch). Fix is correct and complete.
- **`settings-client.tsx` save-button focus:** `lastActivatedSaveRef` now tracks whichever of the two Save buttons (header vs. bottom-of-form) the user actually clicked, and `useRestoreFocusAfterPending` targets that ref instead of a fixed header-button ref. Confirmed the effect that seeds `lastActivatedSaveRef.current = saveButtonRef.current` on mount so focus still restores to the header button pre-interaction. Fix is correct and complete.

## 2. Files freshly read this cycle (not superseded by a no-op diff check)

| File | Verdict |
|---|---|
| `components/histogram.tsx` | Pass |
| `components/wide-gamut-hint.tsx` | Pass |
| `components/masonry-card.tsx` | Pass |
| `components/grid-picture.tsx` | Pass |
| `components/image-zoom.tsx` | Pass |
| `components/lazy-focus-trap.tsx` | Pass |
| `components/tag-input.tsx` | Pass |
| `components/bulk-edit-dialog.tsx` | Pass |
| `components/ui/sonner.tsx` (toasts) | Pass |
| `components/ui/table.tsx` | Pass |
| `components/ui/select.tsx` | Pass |
| `components/public-restore-maintenance.tsx` | Pass |
| `components/topic-empty-state.tsx` | Pass |
| `components/image-manager.tsx` | Pass |
| `app/[locale]/admin/(protected)/tokens/tokens-client.tsx` | Pass |
| `components/admin-user-manager.tsx` | Pass |
| `app/[locale]/admin/(protected)/db/page.tsx` | Pass (known deferred `C96-11` restore-oversize-file toast-only UX still open, not re-filed) |
| `app/[locale]/admin/login-form.tsx` | Pass |

Files with **zero commits since cycle 7's clean/fixed pass** (`lightbox.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `nav.tsx`/`nav-client.tsx`, `home-client.tsx`, `photo-navigation.tsx`, `footer.tsx`, `topic-manager.tsx`, `tag-manager.tsx`, `seo-client.tsx`, `dashboard-client.tsx`, `analytics-client.tsx`, `map/map-client.tsx`) were not re-read byte-for-byte; their prior "Pass" verdicts stand since the source is provably unchanged (`git log 878508e3..HEAD` confirms no touches).

## 3. Findings

**None.** No new WCAG failure, no new sub-44px touch target, no new missing-alt/missing-label/missing-live-region defect was found in this cycle.

### 3.1 Specific checks performed (evidence, not just assertion)

- **Touch targets:** grepped the entire `components/` + `app/` tree for `h-8`/`h-9`/`h-10` co-occurring with `button|link|<a |select|input` tokens — zero hits outside the already-`max-`-guarded ceiling exemptions. Confirmed `button.tsx`'s `size="sm"`/`size="icon"` CVA variants still floor at `min-h-11`/`size-11` (used unmodified by `admin-user-manager.tsx:95` `size="sm"` and `tokens-client.tsx`/`image-manager.tsx` `size="icon"` instances). `histogram.tsx`'s collapse toggle, key-type tooltip trigger, and mode-cycle button all carry explicit `min-h-11 min-w-11`. `wide-gamut-hint.tsx`'s dismiss `×` button carries `min-h-11 min-w-11`. `tag-input.tsx`'s remove-chip button and combobox options all carry `min-h-11`/`min-w-11`.
- **Positive `tabIndex`:** `grep -rn 'tabIndex={[1-9]'` across `components/`+`app/` → zero hits (no tab-order hijacking anywhere in the tree).
- **`autoFocus`:** one hit, `app/[locale]/admin/login-form.tsx:73` on the username field of the login form. This is the sole interactive form on a freshly-loaded page and is a standard, non-violating pattern (WCAG 3.2.1 concerns unexpected *context* changes on focus, not initial-field autofocus on a single-purpose page) — not reported as a defect.
- **`<img>`/`<Image>` alt coverage:** grepped every `<Image` usage in `components/`; all five (`similar-photos.tsx`, `search.tsx`, `optimistic-image.tsx`, `nav-client.tsx`, `photo-viewer.tsx`) resolve an `alt` prop on the following lines — the two `alt=""` cases (`search.tsx` result thumbnail, `nav-client.tsx` topic cover) are deliberately decorative because the enclosing element carries a separate visible/accessible text label. No bare `<img>` (raw HTML, not `next/image`) exists anywhere in `components/`/`app/` outside `grid-picture.tsx`'s intentional `<picture><img>` fallback, which does receive `alt` from its caller (`masonry-card.tsx` passes `altText`).
- **Icon-only-button `aria-label` coverage:** all 18 `size="icon"` `<Button>` usages across the 11 files that use them (`image-manager.tsx`, `lightbox.tsx`, `search.tsx`, `admin-user-manager.tsx`, `photo-navigation.tsx`, `upload-dropzone.tsx`, `topic-manager.tsx`, `settings-client.tsx`, `tokens-client.tsx`, `tag-manager.tsx`, `seo-client.tsx`) carry an `aria-label`.
- **i18n key parity:** programmatically flattened and diffed `messages/en.json` vs `messages/ko.json` — 871 keys each side, **0 missing in either direction**. No drift since cycle 7's manual check.
- **Dialog settle-before-close pattern:** re-verified `image-manager.tsx` (edit-metadata dialog + batch-tag dialog, the exact surfaces `fc5d9a6a` hardened), `admin-user-manager.tsx`, and `tokens-client.tsx`'s three dialogs (create / plaintext-reveal / revoke-confirm) all guard `onOpenChange` against closing while their respective in-flight boolean is true, and disable the Cancel/close affordance during that window. No new dialog introduced a bare uncontrolled `Dialog`/`AlertDialog` that could be raced closed mid-mutation.
- **Live regions:** `image-manager.tsx`'s per-row "processing" placeholder (`role="status" aria-live="polite"`), `tokens-client.tsx`'s loading spinner (`role="status" aria-live="polite"`) and load-error region (`role="alert"`), and `wide-gamut-hint.tsx`'s dismissible hint (`role="status" aria-live="polite" aria-atomic="true"`) are all present and correctly scoped.
- **Reduced motion:** `image-zoom.tsx` samples `prefers-reduced-motion` via a `matchMedia` ref + live `change` listener and gates the CSS-transition path in `applyTransform`; unaffected since cycle 7.
- **Focus-visible rings:** every newly-inspected interactive control (`histogram.tsx` buttons/tooltip trigger, `wide-gamut-hint.tsx` dismiss button, `tag-input.tsx` chip-remove/combobox, `image-zoom.tsx`'s zoom container) carries `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` or the shadcn default ring chain.

## 4. Summary

| Category | Count |
|---|---|
| CRIT | 0 |
| HIGH | 0 |
| MED | 0 |
| LOW | 0 |
| New WCAG failures | 0 |
| New touch-target violations | 0 |
| New i18n key drift | 0 |

**0 CRIT · 0 HIGH · 0 MED · 0 LOW — no new findings this cycle.** The three cycle-7 findings (`C7-DES1`/`C7-04`, `C7-DES2`/`C7-10`, `C7-11`) are confirmed fixed at HEAD. All known deferred UX/a11y items in `deferred-carry-forward.md` remain open with unchanged status (no exit criteria fired); none are re-filed here.

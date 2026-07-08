# Loop-B Cycle 10b — Designer (UI/UX + Accessibility) Review

**Reviewed HEAD:** `36a79146a7519a267af0c5dbcaf3d9909e727289` (peer's `fix(cycle29): harden server action scanning`, verified UI-inert — see Dedupe below)
**Method:** static source review only (`git show HEAD:<path>`), no working-tree edits read. No screenshots or unverified claims.
**Repo context:** GalleryKit, Next.js 16 / React 19 / Tailwind / Radix / shadcn photo gallery, run-10 loop-B cycle 10 (100+ prior review cycles across two concurrent loops; the last several designer/UI-UX passes on both loops have converged to 0-1 findings per cycle).

## Dedupe / baseline

Per the shared-worktree directive, only committed HEAD was inspected. A concurrent peer session (loop A, ~cycle 29) was active during this review; its final commit at review time (`36a79146`) touches only `apps/web/scripts/check-action-origin.ts`, its test, plan/deferred ledgers, and review docs — no component, page, or message-catalog file. Confirmed via `git show 36a79146 --stat`. Nothing UI-relevant to re-check for drift.

Prior designer-lane history consulted to avoid re-reporting:
- `.context/reviews/run10-cycle29/designer-reviewer.md` (loop A, HEAD `f4faad29`): 0 new findings; carries forward two known-open items (keyboard-pannable zoom `C94-06`/`C93-09`, admin table-first responsive IA `AGG-C21-24`/`AGG-C17-21`).
- `.context/reviews/cycle-9-2026-07-08/designer.md` (loop B, prior cycle): 1 finding, `DES9-01` (photo-viewer Info toggle missing `aria-pressed`/`aria-expanded`). **Verified fixed** — `apps/web/src/components/photo-viewer.tsx:602-667` now carries `aria-expanded={showBottomSheet}` + `aria-controls="photo-info-bottom-sheet"` (mobile trigger) and `aria-pressed={isPinned}` (desktop toggle), landed via `8638fe63` (loop-B cycle 9b).
- `.context/reviews/cycle-26-2026-07-08/designer-reviewer.md` (loop A): 3 low-severity findings. **All verified fixed** at current HEAD:
  1. Lightbox color pip disclosure/panel relationship — `apps/web/src/components/lightbox-color-pip.tsx:171-198` now has `aria-controls={panelId}` on the button and `id={panelId} role="region" aria-label=…` on the panel.
  2. Empty shared album showed a "processing" (loading-state) message — `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253` now renders `t('empty')` for `group.images.length === 0`.
  3. Map accessible photo-list fallback discarded `topic_label` — `apps/web/src/app/[locale]/(public)/map/page.tsx:107` now renders `marker.topic_label ?? marker.topic`.
- `deferred-carry-forward.md` open UI/UX-tagged rows (C18-16/C18-21 admin responsive, C20-11/C20-25/C20-26, C21-37..40, C22-22..25, C23-25..26, C24-24..30 admin IA/form-validation/mobile-masonry) — all already scheduled/tracked; not re-derived here.

## Inventory (this cycle's fresh focus)

Given how exhaustively the nav/search/photo-viewer/lightbox/info-sheet/map/upload/image-manager surfaces have been re-verified in the last several cycles across both loops, this pass targeted admin surfaces that had not been the explicit subject of a dedicated designer read recently:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` (533 lines — create/edit/delete topic, alias add/remove, map-visibility publish-confirm toggle)
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` (edit/delete tag)
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` (DB backup/restore/CSV export — destructive-action surface)
- `apps/web/src/components/admin-user-manager.tsx` (create/delete admin user, password+confirm validation)
- `apps/web/src/components/bulk-edit-dialog.tsx` + `apps/web/src/components/tag-input.tsx` (dual-instance combobox tag input, tri-state field modes)
- `apps/web/src/components/similar-photos.tsx` (semantic-search disclosure panel)
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (895 lines — spot-checked number-input validation/focus-management logic, not the full file)
- Repo-wide greps for regression classes: positive `tabIndex`, `autoFocus`, `<div>`/`<span>` with bare `onClick` (no role/keyboard handler), `<img>` missing `alt`, and `prefers-reduced-motion` coverage.

## Validation evidence

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/i18n-key-parity.test.ts` → 2 files, 18 tests, all passed.
- `grep -rnoE "<div[^>]{0,200}onClick"` / `<span[^>]{0,200}onClick"` across `src` → 0 matches (no non-semantic click targets).
- `grep -rn "<img "` across `src` → 0 matches without an `alt` attribute (all image rendering goes through `next/image` or the app's own `<Image>`-wrapping components, all of which pass `alt`).
- `grep -rn "tabIndex={[1-9]"` → 0 matches (no positive tab-index anywhere).
- `grep -rn "autoFocus"` → 1 match, `apps/web/src/app/[locale]/admin/login-form.tsx:73` (username field on a dedicated single-purpose login page) — acceptable per WCAG 3.2.1/2.4.3 (no context change on focus, single primary field), already covered by this repo's `password-form-a11y.test.ts` lineage; not re-flagged.
- `prefers-reduced-motion` handling confirmed present and tested across `image-zoom.tsx`, `home-client.tsx`, `lightbox.tsx`, `photo-navigation.tsx`, `settings-client.tsx`, and `globals.css:276`, with dedicated source-contract tests (`cycle-21-source-contracts.test.ts`, `cycle-72-source-contracts.test.ts`, `a11y-us-p15.test.ts`).

## Findings

**No new current-HEAD UI/UX/accessibility findings this cycle.**

Every admin surface read this cycle already carries the repo's established hardening patterns: 44 px touch targets (`min-h-11`/`h-11`/`min-h-11 min-w-11`), settle-before-close on destructive `AlertDialog` actions with in-flight spinner + disabled Cancel/ESC (the `COR-R4C16-01`/`DES-R4C14-B` pattern, present identically in `topic-manager.tsx`, `tag-manager.tsx`, `admin-user-manager.tsx`), inline `role="alert"` field-level validation tied via `aria-invalid`/`aria-describedby` with focus-on-error (`topic-manager.tsx:244/416/487`, `tag-manager.tsx`, `admin-user-manager.tsx` password-mismatch flow), and a documented, deliberate exception to the settle-before-close pattern for the 250 MB DB-restore action (`db/page.tsx`, explicit `@alert-dialog-auto-close-ok` comment reasoning that holding the modal open for a multi-minute transition would be worse UX than the page-level pending state). `bulk-edit-dialog.tsx`'s two simultaneous `TagInput` combobox instances do not collide on IDs (`tag-input.tsx` uses `React.useId()` for `suggestionsId`), and the combobox itself retains the correct `role="combobox"`/`aria-autocomplete`/`aria-activedescendant`/`role="listbox"`+`role="option"` wiring already verified as correct in `cycle-9-2026-07-08/designer.md`.

## Not re-filed (already tracked, carried forward by other lanes)

- Keyboard-pannable zoom (`C94-06`/`C93-09`, Medium/High) — `apps/web/src/components/image-zoom.tsx` still has no keyboard pan while zoomed; tracked in the consolidated carry-forward register and loop A's cycle 29 register. Not re-derived here.
- Admin image/topic/tag tables remain table-first (horizontally scrollable, no card/workbench fallback) on narrow screens (`AGG-C21-24`/`AGG-C17-21` and the `C18-16`/`C21-37..40`/`C22-22..25`/`C23-25..26`/`C24-24..30` admin-responsive-IA rows) — observed again in `topic-manager.tsx:270-271`, `tag-manager.tsx:104-105`, and `admin-user-manager.tsx`'s user table (all wrapped in `overflow-x-auto` with a `min-w-[...]` table rather than a responsive card layout), consistent with the already-open register entries. Not a new finding; same known category.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

**New findings: 0.** Three prior findings (`cycle-26` #1/#2/#3) and one prior finding (`cycle-9` `DES9-01`) were checked and confirmed already fixed at current HEAD. No regressions found in the automated a11y/i18n/touch-target test gates or in the admin surfaces given fresh attention this cycle.

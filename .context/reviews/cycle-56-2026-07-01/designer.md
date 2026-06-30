# Cycle 56 Designer and Documentation Review

Current HEAD reviewed: `e82311b9822645b055c4638540f5fd1cc3704463`.

## Inventory Examined

- Project guidance: `CLAUDE.md` UI, privacy, color/HDR, deploy, auto-alt-text, and tests sections
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-55-2026-07-01-plan.md`
- `.context/plans/cycle-55-2026-07-01-deferred.md`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/lib/data.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/bulk-edit-dialog.tsx`
- `apps/web/src/app/actions/images.ts`
- `README.md`
- `apps/web/README.md`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

## Findings

### C56-06 - Admin photo page uses public image data, so admin-only audit rows cannot render

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:146`, `apps/web/src/lib/data.ts:1044`, `apps/web/src/lib/data.ts:375`, `apps/web/src/components/color-details-section.tsx:214`, `apps/web/src/components/photo-viewer.tsx:824`
- Failure scenario: A logged-in photographer opens a photo expecting admin audit rows for ICC profile, transfer function, HDR/gain-map status, source bit depth, original format/size, or GPS. The page passes `isAdmin={true}` into `PhotoViewer`, but the image row came from `getImageCached()` / `publicSelectFields`, so admin-only rows silently disappear.
- Suggested fix: Keep `getImageCached()` public for public/OG consumers. Add an admin-aware viewer fetch that selects admin fields only after `isAdmin()` resolves true, and test that public/OG paths remain on public data.

### C56-07 - App README refers to nonexistent alt-text fields

- Severity: Low
- Confidence: High
- Files: `apps/web/README.md:88`, `CLAUDE.md:568`, `apps/web/src/app/actions/images.ts:1099`, `apps/web/src/components/bulk-edit-dialog.tsx:244`
- Failure scenario: An operator or contributor looks for a dedicated alt-text field in the admin UI or schema, cannot find one, and misunderstands the public alt fallback contract.
- Suggested fix: Reword the README sentence to say suggestions can be copied into empty public title/description fields.

## Final Sweep

No new i18n key parity or touch-target issue was confirmed from source inspection. Browser review was not run because the cycle has narrow data-access and documentation fixes.

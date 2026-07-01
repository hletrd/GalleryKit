# Cycle 75 UI/UX Accessibility Review

Scope: public photo viewer, mobile bottom sheet, admin forms, shared UI primitives, i18n key parity, color/HDR honesty surfaces.

## Findings

### C75-05 - Mobile bottom-sheet download menu portals outside the modal focus trap

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/components/info-bottom-sheet.tsx:189`, `apps/web/src/components/info-bottom-sheet.tsx:499`, `apps/web/src/components/ui/dropdown-menu.tsx:40`
- Problem: the bottom sheet is an `aria-modal` dialog with a focus trap, but its wide-gamut download `DropdownMenuContent` uses the shared dropdown wrapper that always portals to `document.body`.
- Failure scenario: a keyboard or screen-reader user opens the JPEG/AVIF download menu on mobile; menu items are outside the trapped dialog subtree, so focus can escape or be pulled back inconsistently.
- Suggested fix: let dropdown content render into a supplied modal container and pass the bottom-sheet element as the container for this menu.

### C75-08 - Bulk-edit validation alert is not associated with the failing field

- Severity: Low
- Confidence: Medium
- Citations: `apps/web/src/components/bulk-edit-dialog.tsx:116`, `apps/web/src/components/bulk-edit-dialog.tsx:187`, `apps/web/src/components/bulk-edit-dialog.tsx:212`, `apps/web/src/components/bulk-edit-dialog.tsx:233`, `apps/web/src/components/bulk-edit-dialog.tsx:294`
- Problem: invalid title, description, and topic submissions render a generic `role="alert"`, but the active controls do not get `aria-invalid`, `aria-describedby`, or focus.
- Failure scenario: a screen-reader admin presses Apply, hears an alert, but remains focused on Apply with no programmatic link to the invalid control.
- Suggested fix: track field-specific validation errors, bind them to controls, and focus the first invalid field.

## Evidence

Static inspection only. i18n key parity checked: `en.json` and `ko.json` both flatten to 848 keys with no missing keys. Public HDR disclosure remains admin-gated in inspected color/HDR surfaces.

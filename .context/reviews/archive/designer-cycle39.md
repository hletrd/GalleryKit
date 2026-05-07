# Designer (UI/UX) — Cycle 39

## Review Scope

Full UI/UX review covering accessibility, responsive design, interaction patterns, forms, keyboard navigation, and component consistency.

## New Findings

### UX-39-01: Admin user creation form labels not associated with inputs [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/admin-user-manager.tsx` lines 93-98
- **Description:** The "Create User" dialog uses `<label className="text-sm font-medium">` without `htmlFor`, and the `<Input>` elements lack `id` attributes. Clicking the label text does not focus the input. Screen readers cannot associate labels with fields. This is a WCAG 2.2 Level A failure (criterion 1.3.1 Info and Relationships).
- **Fix:** Add `htmlFor` to labels and matching `id` to inputs.

### UX-39-02: Admin user creation form password field uses `autoComplete="new-password"` but lacks confirmation [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/components/admin-user-manager.tsx` line 98
- **Description:** The admin user creation dialog has only one password input with `autoComplete="new-password"`. There is no password confirmation field, so a typo in the password would lock out the new admin account. The password change form (in `password-form.tsx`) correctly has `currentPassword`, `newPassword`, and `confirmPassword` fields.
- **Fix:** Add a password confirmation input to the admin user creation form and validate both match on the client side before submission.

### UX-39-03: Mobile bottom sheet GPS dead code (mirrors C38-02) [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 288-301
- **Description:** Same unreachable GPS code as in photo-viewer.tsx (C38-02), but in the mobile info bottom sheet component. The `isAdminProp` check gates GPS display, but `latitude`/`longitude` are excluded from public queries. Needs the same annotation comment.
- **Fix:** Add the same unreachable-GPS comment block as was done for photo-viewer.tsx in C38-02.

## Previously Deferred Items Confirmed

All previously deferred UI/UX items remain valid. No new accessibility regressions detected.

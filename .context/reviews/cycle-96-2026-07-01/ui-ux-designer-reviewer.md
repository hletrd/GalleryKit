# Cycle 96 UI/UX Design-System Review

## Scope, constraints, and validation

Review-only lane for `/tmp/gallery-recovery-check`; no source files were modified. Workspace after review:

```text
## master...origin/master
?? .context/reviews/cycle-96-2026-07-01/
```

Browser/runtime validation was attempted but blocked by the sandbox:

- `npm run start --workspace=apps/web -- --port 3101` → `Error: listen EPERM: operation not permitted 0.0.0.0:3101`
- `HOSTNAME=127.0.0.1 ... --hostname 127.0.0.1 --port 3101` → `Error: listen EPERM: operation not permitted 127.0.0.1:3101`
- `agent-browser open about:blank && agent-browser snapshot -C` → `Socket directory '/Users/hletrd/.agent-browser' is not writable: Operation not permitted`
- with tmp HOME/profile → `Daemon error: Failed to bind socket: Operation not permitted`

Source/test-grounded validation run:

```text
npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-rings-cycle20.test.ts search-status-source.test.ts i18n-key-parity.test.ts
Test Files 4 passed
Tests 26 passed
```

## UI/UX inventory reviewed

- Public shell/navigation: `layout.tsx`, public layout, `nav-client.tsx`, `footer.tsx`
- Gallery surfaces: `home-client.tsx`, `grid-picture.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `photo-navigation.tsx`, `info-bottom-sheet.tsx`
- Photographer/color UX: `color-details-section.tsx`, `histogram.tsx`, `wide-gamut-hint.tsx`
- Admin/forms: SEO, settings, categories/topics, database restore, upload/dropzone, image manager
- Design-system primitives/tests: `ui/button.tsx`, `ui/input.tsx`, touch-target/focus/i18n/search tests

---

## Findings

### 1. SEO settings form has toast-only validation, despite field-specific server errors

**Severity:** Medium
**Confidence:** High

**Evidence**

- Save handler only displays `toast.error(...)` for failures and does not retain field error state: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-68`
- Inputs expose help text only, not invalid state or error descriptions: `seo-client.tsx:95-158`, `seo-client.tsx:169-181`
- Server action already distinguishes field-specific failures such as title, description, locale, and OG image URL errors: `apps/web/src/app/actions/seo.ts:78-132`
- A better local pattern already exists in settings: validation state + focus-first-invalid at `settings-client.tsx:145-182`, with `aria-invalid`, error `aria-describedby`, and `role="alert"` at `settings-client.tsx:447-525`

**Scenario**

An admin enters an invalid Open Graph locale or external OG image URL. The server rejects it, but the UI only emits a transient toast. Keyboard and screen-reader users do not get a persistent field-level error, focus does not move to the failing input, and the page does not visually identify which setting must be fixed.

**Fix**

Mirror the Settings form pattern:

- Add `fieldErrors` state keyed by SEO setting.
- Prefer returning structured field keys from `updateSeoSettings`; if not possible, map known translated errors back to fields.
- Set `aria-invalid`.
- Append error IDs to `aria-describedby`.
- Render inline `<p role="alert">...</p>` below each failing input.
- Focus and scroll the first invalid field after save failure.

---

### 2. Topic/category create and edit dialogs also rely on toast-only form errors

**Severity:** Medium
**Confidence:** High

**Evidence**

- Create/update handlers only call `toast.error(res.error)`: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-124`
- Create dialog fields have labels and required attributes, but no inline error container or invalid state: `topic-manager.tsx:204-221`
- Edit dialog repeats the same pattern: `topic-manager.tsx:362-382`

**Scenario**

A photographer/admin creates a topic with a duplicate or invalid slug. Because topics drive public gallery navigation, this is a high-value admin workflow. If the server rejects the slug, the dialog remains open but the error is only a toast, so a screen-reader user may miss it and a keyboard user gets no focus cue.

**Fix**

Add dialog-local submit error state:

- Keep server errors visible inside the dialog.
- Attach errors to the relevant field where possible.
- Use `aria-invalid`, `aria-describedby`, and `role="alert"`.
- Focus the first invalid field or the dialog-level error summary.
- Keep the current 44 px controls; the issue is error recoverability, not target size.

---

### 3. Database restore file-size rejection clears the file with only a toast

**Severity:** Medium
**Confidence:** High

**Evidence**

- `handleRestore` rejects oversized files with a toast and resets the selected file/input: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:65-72`
- The file input `onChange` repeats that same toast/reset behavior: `db/page.tsx:185-191`
- The file field has static help text, but no persistent error or invalid state: `db/page.tsx:178-197`

**Scenario**

An admin selects a backup larger than the allowed restore size. The selected file disappears and the only explanation is a transient toast. This is a destructive-adjacent workflow, so the UX should be unusually explicit and recoverable.

**Fix**

Add `restoreError` state:

- Render the max-size failure directly under the file input.
- Set `aria-invalid` on the input.
- Include both help and error IDs in `aria-describedby`.
- Use `role="alert"` for the error.
- Do not rely on toast as the only recovery instruction.

---

### 4. Mobile admin photo toolbar can become too wide when Share is available

**Severity:** Medium
**Confidence:** Medium — source-based; browser viewport validation was blocked.

**Evidence**

- Toolbar is a single non-wrapping row: `apps/web/src/components/photo-viewer.tsx:557`
- Back button may consume up to `58vw`: `photo-viewer.tsx:562-566`
- Right-side controls are `shrink-0`: `photo-viewer.tsx:570`
- Mobile Info button includes text: `photo-viewer.tsx:573-585`
- Admin Share button also includes text and is 44 px high: `photo-viewer.tsx:587-619`
- Public photo page enables sharing for admins: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:281-297`

**Scenario**

A logged-in photographer opens a photo on a 360–390 px phone. The toolbar can contain Back-to-topic text, fullscreen trigger, Info text, and Share/Sharing text in one row. Because the right cluster cannot shrink, the row may overflow or compress the back label/action area.

**Fix**

At small breakpoints:

- Make Info and Share icon-only with stable `aria-label`/`title`.
- Or move Share into an overflow menu/bottom sheet action.
- Consider `flex-wrap` only if it does not push the photo below the fold.
- Add a responsive test/snapshot for an admin mobile photo view once browser startup is available.

---

### 5. Color metadata reads visually as term/value data but is not semantic metadata

**Severity:** Low
**Confidence:** High

**Evidence**

- Color details render as generic grid children with `<p>` labels and values: `apps/web/src/components/color-details-section.tsx:346-460`
- EXIF metadata correctly uses `<dl>`, `<dt>`, and `<dd>` in the mobile sheet: `apps/web/src/components/info-bottom-sheet.tsx:351-363`
- Desktop sidebar EXIF also uses `<dl>` semantics: `apps/web/src/components/photo-viewer.tsx:771-783`

**Scenario**

A screen-reader user reviewing color pipeline details such as ICC profile, primaries, transfer function, matrix coefficients, and bit depth hears a sequence of paragraphs rather than structured metadata. This matters because color/HDR accuracy is a project-specific photographer workflow.

**Fix**

Convert the expanded color detail grid to:

```tsx
<dl>
  <div>
    <dt>Color space</dt>
    <dd>Display P3</dd>
  </div>
</dl>
```

Preserve the current visual grid, badges, tooltips, and admin-only gates.

---

## Final sweep

### Accessibility and keyboard/focus

Strong baseline.

- Root layout sets `lang` and `dir`: `apps/web/src/app/[locale]/layout.tsx:94-100`
- Skip link is first focusable content and targets main: `layout.tsx:119-128`
- Public main is programmatically focusable for skip-link landing: `apps/web/src/app/[locale]/(public)/layout.tsx:8-16`
- Navigation has expanded state, controls, active page state, and 44 px targets: `apps/web/src/components/nav-client.tsx:100-118`, `nav-client.tsx:140-149`, `nav-client.tsx:168-190`
- Search uses dialog semantics, focus trap, combobox/listbox wiring, live regions, and IME-aware keyboard handling: `apps/web/src/components/search.tsx:407-509`
- Lightbox handles focus return/body lock, dialog semantics, descriptive alt text, live slideshow state, and keyboard shortcut labels: `apps/web/src/components/lightbox.tsx:433-470`, `lightbox.tsx:499-531`, `lightbox.tsx:554-660`

### Touch targets

No new touch-target issue found in source sweep.

- Button primitive defaults to 44 px or larger: `apps/web/src/components/ui/button.tsx:23-30`
- Input primitive uses `min-h-11`: `apps/web/src/components/ui/input.tsx:11-13`
- Audit explicitly enforces the 44 px floor: `apps/web/src/__tests__/touch-target-audit.test.ts:5-40`, `touch-target-audit.test.ts:740-823`
- Targeted touch/focus tests passed.

### Responsive UI and perceived performance

Generally strong.

- Masonry reserves aspect ratio/intrinsic size and uses above-fold eager priority: `apps/web/src/components/home-client.tsx:296-330`, `home-client.tsx:338-365`
- Masonry cards use `content-visibility: auto`: `apps/web/src/app/[locale]/globals.css:231-235`
- Font uses `font-display: swap`: `globals.css:5-10`
- Reduced-motion suppresses hover scale and transitions: `globals.css:253-279`

Main responsive concern is the admin mobile photo toolbar noted in Finding 4.

### Forms and error states

Settings and image/admin patterns show mature field-level accessibility, but SEO, topic dialogs, and DB restore are inconsistent. Findings 1–3 should be handled as a small design-system consistency pass.

### Navigation and i18n

- Locale and theme controls are accessible and touch-sized: `nav-client.tsx:168-190`
- `lang`, `dir`, and `NextIntlClientProvider` are correctly placed in the root layout: `layout.tsx:94-145`
- `i18n-key-parity.test.ts` passed in the targeted validation run.

### Photographer/gallery-specific UX

Strong project alignment.

- P3 badge is included in card accessible labels: `home-client.tsx:310-313`
- P3 visual badge is gated by display capability: `home-client.tsx:387-397`, `globals.css:145-154`
- Forced-colors adjustments exist for color chips/surfaces: `globals.css:164-181`
- Mobile bottom sheet prioritizes histogram before EXIF for photographer review: `apps/web/src/components/info-bottom-sheet.tsx:321-343`
- Color pipeline copy/tooltips are useful; semantic metadata structure is the main remaining improvement.
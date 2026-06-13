# R28 — UI/UX Review from Photographer + Client Lens
**Date:** 2026-05-20
**Pass:** R28 (thirteenth deep pass)
**Lens:** Working Korean professional photographer (wedding/portrait; Eizo P3; iPhone Pro) + photo-recipient client (Chrome Android, sRGB iPad); bilingual KO/EN.

## Result

**NEW_FINDINGS: 6**

---

### R28-UX-HIGH-1 — Escape key in lightbox always closes lightbox, even when color pip is open

**Severity:** HIGH
**Confidence:** 92
**File:** `apps/web/src/components/lightbox.tsx:316-319`

**User-visible symptom:** When the lightbox color pip panel is open and the photographer presses Escape, the lightbox closes immediately. The expected UX — standard in every modal-over-modal pattern (Radix, macOS, iOS) — is that Escape first collapses the pip (the innermost panel), and only a second Escape closes the lightbox. A wedding photographer reviewing color metadata on multiple photos in sequence will repeatedly mis-dismiss the entire lightbox when they intended only to collapse the pip.

**Technical detail:**

```ts
// lightbox.tsx:316-319
} else if (e.key === 'Escape') {
    if (!document.fullscreenElement) {
        onClose();
    }
}
```

The handler checks `!document.fullscreenElement` but does NOT check `colorPipOpen`. When `colorPipOpen === true`, Escape should call `setColorPipOpen(false)` and return early, leaving the lightbox open. The `colorPipOpen` state is already in scope at `lightbox.tsx:84`. The fix is:

```ts
} else if (e.key === 'Escape') {
    if (colorPipOpen) {
        setColorPipOpen(false);
    } else if (!document.fullscreenElement) {
        onClose();
    }
}
```

**Impact:** HIGH — keyboard photographers who rely on `c` to open the pip and `Escape` to close it (the natural Mac/Windows modal pattern) lose their current lightbox position every time. This is a directly disruptive ergonomics regression on the primary keyboard workflow.

**Acceptance:** With color pip open: Escape closes the pip, lightbox stays open. With pip closed: Escape closes the lightbox.

---

### R28-UX-MED-1 — Korean `lrToken.revokeButton` label "취소" means Cancel, not Revoke

**Severity:** MED
**Confidence:** 95
**File:** `apps/web/messages/ko.json:872`

**User-visible symptom:** In the revoke-confirm dialog for Lightroom tokens, the destructive action button uses the key `lrToken.revokeButton` which renders as **"취소"** in Korean. "취소" universally means **Cancel** in Korean UI (the non-destructive dismiss action). The adjacent cancel button also reads "취소" (via `common.cancel`, `ko.json:162`). The dialog therefore presents two buttons both labeled "취소" — one cancels the dialog (safe), the other deletes the token (destructive). A Korean photographer cannot distinguish the safe from the destructive action.

**Technical detail:**

```json
// ko.json:872
"revokeButton": "취소",
```

```json
// ko.json:162 (common.cancel, also used in this dialog)
"cancel": "취소",
```

The English value is `"Revoke"` (en.json:775), which is correctly distinct from "Cancel". The Korean translation conflated "revoke" (폐기/취소) with "cancel" (취소). The correct Korean for "revoke a token" is **"철회"** (revoke/withdraw) or **"폐기"** (destroy/void). Using "취소" for both the destructive button and the dismiss button is a genuine UX safety defect — a Korean admin could accidentally delete a production token intending to cancel the dialog.

**Proposed fix:**

```json
"revokeButton": "철회",
"revokeSuccess": "토큰이 철회되었습니다.",
"revokeAria": "토큰 {label} 철회",
"revokeTitle": "토큰을 철회하시겠습니까?",
"revokeDesc": "이 토큰을 철회하면 이 토큰을 사용하는 모든 라이트룸 연결이 즉시 차단됩니다."
```

**Acceptance:** Revoke confirm dialog in Korean: destructive button reads "철회", cancel button reads "취소". Buttons are now distinguishable.

---

### R28-UX-MED-2 — `lrToken.plaintextDone` button label "토큰을 복사했습니다" is a past-tense status, not an action label

**Severity:** MED
**Confidence:** 88
**Files:** `apps/web/messages/ko.json:866`, `apps/web/src/components/tokens-client.tsx:192`

**User-visible symptom:** After token creation, the "show plaintext once" dialog has a done button (tokens-client.tsx:192) whose Korean label is `"토큰을 복사했습니다"` — past tense for "The token has been copied." This is a status statement, not a call-to-action label for a button. In Korean UI, a button that confirms and dismisses a dialog should use imperative/action form: "**확인**" (confirm) or "**닫기**" (close) or "**완료**" (done). The current label reads as if the system is asserting the token was copied (even if the admin hasn't copied it yet), and it matches the toast success message for the copy action rather than the dismiss action.

**English comparison:** The English key `lrToken.plaintextDone` has value `"Done"` (implicitly — the key is `plaintextDone` and the Korean maps to a past-tense statement, not "Done").

**Proposed fix:**

```json
"plaintextDone": "확인"
```

**Acceptance:** Token creation dialog done button reads "확인" in Korean, matching standard confirmation button conventions.

---

### R28-UX-MED-3 — `imageManager.noImages` uses "이미지" while the rest of the admin UI uses "사진" for user-facing content

**Severity:** MED
**Confidence:** 82
**File:** `apps/web/messages/ko.json:173`

**User-visible symptom:** The image manager empty state reads `"이미지가 없습니다."`. Throughout the public-facing gallery, all photo-count strings and user-facing labels use **"사진"** (photo): `"사진이 없습니다."` (home.noImages, ko.json:235), `"사진 {count}장"`, `"최근 사진"`, `"사진 보기"`. In the admin dashboard, `"이미지"` is used as a technical term in the image manager table. This inconsistency — technical "이미지" vs. photographer-natural "사진" — is not wrong per se (admins are technical users), but the empty-state message is shown directly in the visual table where photographers spend most of their admin time. Korean wedding/portrait photographers think of their work as "사진" (photos), not "이미지" (images, a technical loanword).

**Contextual nuance:** "이미지" is acceptable in admin column headers (Gamut, filename, format) and system-level error messages (processing error). Empty states, upload prompts, and humanizing copy should use "사진" consistently with the public gallery.

**Affected keys:**
- `imageManager.noImages` → `"이미지가 없습니다."` — should be `"사진이 없습니다."`
- `imageManager.noImages` (admin empty state) and `serverActions.noImagesSelected` → the latter is a system error, "이미지" acceptable there.

**Proposed fix:**

```json
"noImages": "사진이 없습니다."
```

**Acceptance:** Admin image manager empty state reads "사진이 없습니다." consistent with the public gallery's empty-state language.

---

### R28-UX-LOW-1 — First-run (zero photos) admin dashboard shows no onboarding nudge

**Severity:** LOW
**Confidence:** 83
**Files:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:61-68`, `apps/web/messages/ko.json:64-72`

**User-visible symptom:** When a newly deployed GalleryKit has zero photos and zero categories, the admin dashboard shows:
1. The upload dropzone with a hard-block: `"업로드 전에 카테고리를 만들어 주세요"` (upload.noTopicsTitle) — but no link or button to create a category.
2. The "Recent Uploads" table is empty with no message.

A photographer who has just finished the deployment checklist opens the dashboard and is told they cannot upload without creating a category, but there is no path forward from the dashboard UI itself. They must discover the Categories nav item independently. There is no "Create your first category →" call-to-action adjacent to the block message.

**Evidence:** `upload-dropzone.tsx:334-337` renders the block with `upload.noTopicsTitle` and `upload.noTopicsDescription` but no link. `dashboard-client.tsx` passes `topics` to `UploadDropzone` without any zero-state CTA at the dashboard level.

**Impact:** LOW — this only affects first-time setup, but it is the first impression for every new installation. The friction is real: CLAUDE.md documents a multi-step deployment checklist and the first post-deploy action is uploading photos, which is blocked silently.

**Proposed fix:** In `UploadDropzone` when `!hasTopics`, add a link button alongside the instructional text:

```tsx
<Button asChild variant="outline" size="sm" className="mt-3 min-h-11">
    <Link href={localizePath(locale, '/admin/categories')}>{t('upload.createFirstCategory')}</Link>
</Button>
```

Add i18n key `upload.createFirstCategory` → EN: `"Create a category first"` / KO: `"카테고리 먼저 만들기"`.

**Acceptance:** Zero-photos first-run state: the upload block shows a direct link to `/admin/categories`.

---

### R28-UX-LOW-2 — Color metadata copy button is icon-only with no visible label; non-power users cannot discover it

**Severity:** LOW
**Confidence:** 81
**File:** `apps/web/src/components/color-details-section.tsx:285-293`

**User-visible symptom:** The copy-color-metadata button in the ColorDetailsSection accordion header is a bare icon button (`<Copy className="h-4 w-4" />`) with only `aria-label` and `title` attributes. The button has no visible text label. On desktop, hovering reveals the tooltip title text. On mobile, there is no tooltip — the button is invisible-in-purpose to any photographer who has not read documentation.

The Korean photographer at a client meeting who wants to share their photo's color profile in a chat message has no affordance signaling that the button copies data to the clipboard. The `aria-label` `t('viewer.copyColorMetadata')` resolves to `"색상 메타데이터 복사"` in Korean, which is correct and accessible, but it only reaches assistive technology — not the sighted non-power-user.

**Comparison:** The lightbox pip copy button (`lightbox-color-pip.tsx`) has the same issue. GitHub PAT copy buttons, by contrast, show both a copy icon and the word "Copy" on first appearance, then change to a checkmark on success.

**Impact:** LOW — power users and photographers who hover on desktop will discover the button. The tooltip title is correct. The functional gap is discoverability for mobile users and non-technical photographers.

**Proposed fix (minimal):** Add a success state to the existing copy: briefly swap the `<Copy>` icon for a `<Check>` icon after a successful clipboard write (500ms), providing visual feedback without requiring a text label. This at minimum confirms the action succeeded visually — the current code only shows a toast. The color details section `copyColorMetadata()` function at line 218 already has the toast success path; adding an icon state change requires only a `useState` toggle.

**Acceptance:** After clicking the copy button, the icon changes to a checkmark (or similar success indicator) for ~500ms, confirming the clipboard write without requiring a visible text label.

---

## Closed/Confirmed-correct items from R28 scope

The following areas from the R28 investigation list were checked and found correct — not re-raised:

**Lightroom PAT UX (area 1):** Token UX is well-implemented. Plaintext shown once at creation in a modal (`tokens-client.tsx:171-197`), copy button present with 44px touch target, `last_used_at` shown per-token, per-token revoke with confirm dialog. Token storage is SHA-256 hash only (`admin-tokens.ts:7`, `hashToken()`), not bcrypt — this is acceptable because SHA-256 with a 256-bit random token provides equivalent security to bcrypt (the entropy is in the random token, not a human password). No security gap.

**Reduced-motion (area 2):** Lightbox reads `prefers-reduced-motion` via a live MQ listener (`lightbox.tsx:92-109`) and skips all CSS transitions and Ken Burns animation when active. Photo viewer uses Framer Motion's `useReducedMotion()` hook (`photo-viewer.tsx:87`) and gates `initial`/`exit`/`transition` props on `prefersReducedMotion`. The global CSS rule at `globals.css:275-284` sets `animation-duration: 0.01ms` for all `*` elements under `prefers-reduced-motion: reduce`. Coverage is thorough.

**Forced-colors / Windows High Contrast (area 3):** `globals.css:187-204` has explicit `@media (forced-colors: active)` rules for `.hdr-badge` (uses `Highlight`/`HighlightText`), `.gamut-p3-badge` (adds `1px solid CanvasText` border), and `.lightbox-color-pip` (Canvas background, CanvasText color). Masonry card text overlays also handled (`globals.css:294-305`). The histogram canvas is not addressed by forced-colors (canvas elements are inherently unaffected by forced-colors, which is browser-correct behavior). Coverage is good for the badge surfaces.

**Keyboard navigation in lightbox (area 4):** Arrow keys for prev/next photo, `f` for fullscreen, `c` for color pip toggle, `h` for histogram mode, Space for slideshow — all implemented. Focus is saved and restored on close (`lightbox.tsx:392-403`). `FocusTrap` component wraps the entire lightbox (`lightbox.tsx:406`). `aria-modal="true"` is present (`lightbox.tsx:409`). Close button receives focus on open via `closeButtonRef.current?.focus()` (`lightbox.tsx:396`). Tab order is handled by `FocusTrap`. The only gap is the Escape key behavior reported in R28-UX-HIGH-1.

**Korean tone — overall audit (area 5):** No widespread translationese detected. The file does not use parenthetical `을(를)` forms except one instance at `ko.json:562` (`이(가)`) which is in a technical collision-warning message for admins, acceptable there. "이미지" vs "사진" inconsistency is raised as R28-UX-MED-3. "활성화/비활성화" is used for the semantic-search mode disable label (`ko.json:705`) which is admin-technical context, acceptable. No systemic `...할 수 있습니다` passive overuse found — the file predominantly uses direct imperative/completive forms consistent with natural Korean UI copy.

**Upload error recovery (area 6):** Partial batch failures show per-file errors inline in the file grid (`upload-dropzone.tsx:480-484`) via `role="alert"` with `{file}: {error}` format. Failed files remain in the queue for re-upload. The `upload.partialSuccess` toast reports count. The `processing_error` field is shown in the dashboard failed-images panel (`dashboard-client.tsx:89`). DB restore failure surfaces the error string from the server action result via `toast.error`. Coverage is adequate.

**Bulk operations (area 7):** `BulkEditDialog` component exists. Admin can select photos with checkboxes, then access bulk-delete, bulk-share, bulk-tag-add, and bulk-edit (title, description, topic, tags, license tier) from the image manager. No long-press selection on mobile was found (desktop-checkbox only), but this is an acceptable UX scope for an admin-primary surface.

**Drag-and-drop folder behavior (area 8):** The dropzone uses `react-dropzone` with `accept: { 'image/*': [...] }` — browser-level directory walking is not enabled. The accepted types include `.arw` which is a RAW format; the server action rejects RAW files with `rawNotSupported` but the UI dropzone accepts them, causing a user-visible rejection only after upload attempt. Pre-existing roughness; below the 80-confidence threshold for a new finding (rejection message is clear and localized).

**`force_show_color_chips` discoverability (area 13):** The setting label is `"색상 칩 강제 표시"` with hint text explaining the use case for demos on sRGB displays (`ko.json:719-720`). The Firefox detection gap informational box immediately follows, cross-referencing this toggle as the workaround. UX context is adequate for an admin-technical setting.

**Empty states (area 14):** Zero-photo state raised as R28-UX-LOW-1. Other empty states (`home.noImages`, `sharedGroup.empty`, `tags.noTags`, `lrToken.empty`) use natural Korean.

---

## Finding summary

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| R28-UX-HIGH-1 | HIGH | 92 | Escape always closes lightbox even when color pip is open — should close pip first |
| R28-UX-MED-1 | MED | 95 | Korean `lrToken.revokeButton` = "취소" (Cancel) collides with Cancel button — should be "철회" |
| R28-UX-MED-2 | MED | 88 | Korean `lrToken.plaintextDone` = past-tense status string used as button action label — should be "확인" |
| R28-UX-MED-3 | MED | 82 | `imageManager.noImages` uses "이미지" while rest of public/admin UI uses "사진" for user-facing copy |
| R28-UX-LOW-1 | LOW | 83 | Zero-photo first-run: upload block shows no link to category creation — onboarding dead end |
| R28-UX-LOW-2 | LOW | 81 | Color metadata copy button is icon-only with no visual success feedback — discoverability gap |

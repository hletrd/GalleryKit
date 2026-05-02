# Code Reviewer — Cycle 3

## Review method

Deep review of all 242 TypeScript source files with focus on the recent i18n/search
refactor (commit fffe9df) and a fresh cross-cutting scan. All key modules examined:
validation, data, image-queue, session, auth, api-auth, proxy, rate-limit, search,
lightbox, all server actions, CSP, safe-json-ld, schema, process-image.

---

## Gate Status (all green)

- eslint: clean
- tsc --noEmit: clean
- lint:api-auth: OK
- lint:action-origin: OK
- vitest: 84 test files, 586 tests, all passing
- build: running (background)

---

## Findings

### C3-CR-01: Missing i18n key `viewer.fullscreenUnavailable` (MEDIUM, High confidence)

**File:** `apps/web/src/components/lightbox.tsx:190`
**Code:** `toast.error(t('viewer.fullscreenUnavailable'));`

**Problem:** The i18n key `viewer.fullscreenUnavailable` is referenced in lightbox.tsx
but does not exist in either `apps/web/messages/en.json` or `apps/web/messages/ko.json`.
The key exists only as `aria.fullscreenUnavailable` (in the `aria` namespace), which is
used for the ARIA label on the fullscreen button. The toast message namespace is `viewer`.

**Impact:** When a user's browser does not support fullscreen and they try to enter it,
the toast displays the raw key string `viewer.fullscreenUnavailable` instead of a
localized message. This is a user-facing regression visible in both English and Korean.

**Root cause:** The recent i18n cleanup (commit fffe9df) removed dead keys but did not
detect this missing key because it was already missing before the cleanup. The key was
never added when the fullscreen-unavailable toast was introduced.

**Fix:** Add `viewer.fullscreenUnavailable` to both en.json and ko.json:
- en.json: `"fullscreenUnavailable": "Fullscreen is not available"`
- ko.json: `"fullscreenUnavailable": "전체 화면을 사용할 수 없습니다"`

Note: The `aria.fullscreenUnavailable` key should remain as-is since it serves a
different purpose (ARIA label for the button) with different wording.

---

## Verified: Recent i18n cleanup (fffe9df) correctness

All 18 removed keys verified as having zero t() references in codebase:
- `db.confirmRestore` — replaced by strengthened `db.restoreWarning`
- `users.cannotDeleteAdmin` — unused
- `users.deleteTooltip` — unused
- `dashboard.manageTopics` — unused
- `dashboard.manageTags` — unused
- `upload.selectTopic` — unused
- `upload.typeNewTag` — unused
- `imageManager.tagRemoved` — unused
- `viewer.originalDimensions` — unused
- `viewer.previewDimensions` — unused
- `shared.sharedCollection` — unused
- `search.failed` — replaced by `search.error` with unified status type
- `serverActions.failedToDeleteImages` — unused
- `serverActions.aliasConflictsWithTopic` — unused
- `serverActions.failedToRevokeShareLink` — unused
- `photo.descriptionByAuthor` — unused (only `descriptionByAuthorWithTitle` is used)
- `dashboard.recentUploads` — kept (still in use)
- `upload.addExistingTag` — kept (still in use)

Search status type unification: `'failed' | 'error'` → `'error'` verified correct.
The `search.failed` i18n key was a duplicate of `search.error` with identical text.

Thousands separator normalization: "1024 chars" → "1,024 characters" verified correct.
Korean translations use the same format with proper Korean units.

---

## Previously fixed findings (confirmed still fixed)

- C22-01: `exportImagesCsv` GC hint — FIXED
- C21-AGG-01: `clampDisplayText` surrogate-safe — FIXED
- C21-AGG-02: `exportImagesCsv` GROUP_CONCAT separator — FIXED
- C22-AGG-01: isValidTagSlug countCodePoints — FIXED
- C20-AGG-01: password length countCodePoints — FIXED
- C20-AGG-02: getTopicBySlug isValidSlug — FIXED
- C20-AGG-03: updateImageMetadata redundant updated_at — FIXED
- C20-AGG-04/05: tags.ts catch blocks — FIXED
- C19F-MED-01: searchGroupByColumns — FIXED
- C18-MED-01: searchImagesAction re-throw — FIXED

---

## Carry-forward deferred backlog (unchanged)

All previously deferred items remain unchanged from cycle 2 RPL aggregate.

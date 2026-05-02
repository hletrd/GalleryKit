# Code Review — Cycle 25 (i18n cleanup + search status unification)

## Review Scope
- `apps/web/messages/en.json` — 32 lines removed (dead i18n keys, wording normalization)
- `apps/web/messages/ko.json` — 26 lines removed (parallel Korean dead keys, number formatting)
- `apps/web/src/components/search.tsx` — 2 lines changed (`'failed'` -> `'error'` status unification)

## Findings

### C25-LOW-01: Redundant i18n duplicate values across namespaces
- **File**: `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- **Severity**: Low | **Confidence**: High
- **Description**: Multiple i18n key-value pairs are exact duplicates across namespaces:
  - `imageManager.titleTooLong` == `serverActions.titleTooLong` ("Title is too long (max 255 characters)")
  - `imageManager.descTooLong` == `serverActions.descriptionTooLong` ("Description is too long (max 5,000 characters)")
  - `imageManager.deleteConfirmDesc` == `db.dangerZoneDesc` ("This cannot be undone.")
  - `imageManager.cancel` == `db.cancel` ("Cancel")
  - `shared.viewGallery` == `sharedGroup.viewGallery` ("View Gallery")
  - `shared.sharedPhoto` == `shared.ogTitle` ("Shared Photo")
  - `serverActions.passwordTooLong` == `serverActions.passwordTooLongCreate`
  - `serverActions.invalidTagName` == `serverActions.invalidTagNames`
- **Risk**: If one is updated and the other is not, users see inconsistent messaging. The client-side validation in `image-manager.tsx` uses `imageManager.*` keys while the server action in `images.ts` uses `serverActions.*` keys, so they can diverge silently.
- **Suggestion**: Consider shared sub-namespaces (e.g., `common.tooLong`) for truly universal messages, or add a comment-based mapping so changes propagate.

### C25-LOW-02: Restore confirmation dialog lost its interrogative tone
- **File**: `apps/web/messages/en.json` (removed `db.confirmRestore`)
- **Severity**: Low | **Confidence**: High
- **Description**: The removed `db.confirmRestore` key was "This will overwrite the entire database. Continue?" — a question asking the user to confirm. The restore AlertDialog now shows `db.restoreWarning` ("This will overwrite existing data.") which is a statement, not a question. The dialog's purpose (confirmation) implies the question, so this is not a functional regression, but it is a UX wording change.
- **Risk**: Minor. The AlertDialog's OK/Cancel buttons still communicate the binary choice.
- **Suggestion**: Consider updating `db.restoreWarning` to be more explicit about the destructive nature.

### C25-OK-01: Dead i18n keys correctly removed
- All 18 removed keys verified to have zero `t()` call references in the codebase.

### C25-OK-02: Search status unification is consistent end-to-end
- The `searchStatus` type correctly removed `'failed'`. Server action returns `{ status: 'error' }`. The removed `search.failed` was a duplicate of `search.error` with identical text.

### C25-OK-03: Number formatting improvements are locale-correct
- English updated from abbreviated forms to full forms with thousands separators. Korean already used full word and just got thousands separators added.

### C25-OK-04: en.json and ko.json key structures remain in sync
- Automated key-structure comparison confirms identical key sets after all removals.

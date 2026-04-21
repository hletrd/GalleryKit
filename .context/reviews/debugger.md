# Cycle 9 Debugger Review (manual fallback after context-window failure)

## Inventory
- Traced the clipboard/share path across `createPhotoShareLink()`, `createGroupShareLink()`, `copyToClipboard()`, and the two client call sites.
- Traced the public search request flow from `searchImagesAction()` into `searchImages()` and back into the `Search` dialog rendering.

## Confirmed issues

### D9-01 — Clipboard failure is swallowed before the UI reports success
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/lib/clipboard.ts:1-8`, `apps/web/src/components/photo-viewer.tsx:263-267`, `apps/web/src/components/image-manager.tsx:176-181`
- **Concrete failure scenario:** clipboard permission is denied; the helper returns `false`; the caller still shows a copied-success toast.
- **Suggested fix:** add a legacy fallback and branch UI feedback on the returned boolean.

### D9-02 — Duplicate-entry retries still depend on brittle message text
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/app/actions/admin-users.ts:145-147`, `apps/web/src/app/actions/sharing.ts:142-145,249-255`
- **Concrete failure scenario:** Drizzle/MySQL changes the wrapped error wording while preserving the SQL error code; the retry/user-exists behavior stops working even though the underlying duplicate-key condition is unchanged.
- **Suggested fix:** normalize to code/cause-code checks only.

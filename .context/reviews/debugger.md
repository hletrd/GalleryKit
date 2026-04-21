# Cycle 8 Debugger Review (manual fallback)

## Inventory
- Traced concurrent-delete/share flow, search request lifecycle, admin backup/download UX, and tag mutation update paths.
- Focused on race windows, partial-success bugs, and user-visible stale state.

## Confirmed Issues

### D8-01 — Group share creation can return success after partial association writes
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/actions/sharing.ts:200-245`
- **Why it is a problem:** the action validates image IDs before the transaction, but the transactional insert still uses `.ignore()`, allowing concurrent deletes to silently drop associations.
- **Concrete failure scenario:** one admin deletes selected images while another creates a group share link; the link succeeds but contains fewer images than requested, or even none.
- **Suggested fix:** make the association insert fail loudly (no `.ignore()`), and verify the inserted row count matches the requested image count so the transaction rolls back on partial writes.

### D8-02 — Search request cancellation is incomplete when the query becomes empty
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:35-57`
- **Why it is a problem:** the empty-query branch clears results but does not invalidate previous in-flight requests.
- **Concrete failure scenario:** stale results reappear after the user clears the search box because an older request still resolves.
- **Suggested fix:** bump the request token and clear `loading` before returning on an empty query.

### D8-03 — Admin backup downloads can save under the wrong filename
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:36-49`, `apps/web/src/app/[locale]/admin/db-actions.ts:218-219`
- **Why it is a problem:** the client derives the download filename from the URL rather than using the trusted server-returned filename.
- **Concrete failure scenario:** the browser saves a backup as `download?file=...` instead of the intended timestamped SQL filename.
- **Suggested fix:** set `link.download = result.filename`.

# Cycle 8 Designer Review (manual fallback)

## Inventory
- Reviewed the search dialog, admin image-management table, share-link copy affordances, and backup/download admin workflow.
- Focused on user-visible responsiveness, stale-state behavior, and affordance correctness.

## Confirmed Issues

### U8-01 — Search and admin thumbnails still load oversized JPEGs for tiny preview slots
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:208-215`, `apps/web/src/components/image-manager.tsx:342-349`, `apps/web/src/lib/process-image.ts:393-414`
- **Why it is a problem:** tiny 48px/128px preview slots decode/download the largest base JPEG alias, which visibly slows UI feedback on heavier galleries.
- **Concrete failure scenario:** opening the search palette or admin dashboard on a slower connection causes thumbnail pop-in and unnecessary data transfer.
- **Suggested fix:** use the nearest generated thumbnail derivative for these surfaces via a shared helper.

### U8-02 — Share-link copy can produce the wrong outward-facing URL
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/photo-viewer.tsx:253-266`, `apps/web/src/components/image-manager.tsx:158-167`, `apps/web/src/lib/data.ts:783-790`
- **Why it is a problem:** the copy affordance should emit the canonical public gallery URL, not whichever hostname the operator used to open the admin UI.
- **Concrete failure scenario:** an operator working via localhost/VPN copies a link that recipients cannot open.
- **Suggested fix:** use the canonical server-resolved public origin when composing copied share URLs.

### U8-03 — Successful tag mutations do not immediately reflect in the visible admin table
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/image-manager.tsx:183-200`, `apps/web/src/components/image-manager.tsx:371-399`
- **Why it is a problem:** a success toast paired with stale visible data undermines trust in the admin UI.
- **Concrete failure scenario:** the operator adds a tag, sees success, and still sees the old row state until manual refresh.
- **Suggested fix:** refresh the route after success or reconcile local rows with the canonical saved server response.

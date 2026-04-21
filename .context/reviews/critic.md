# Cycle 8 Critic Review

## Inventory
- Reviewed search UI state flow, admin image-management state updates, share-link flows, upload/queue lifecycle, restore maintenance, and backup download UX.
- Cross-checked the relevant action/data-layer files against current browser-facing components and current deployment assumptions.

## Confirmed Issues

### C8-01 — Search overlay can repopulate stale results after the query is cleared
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:35-57`
- **Why it matters:** an older in-flight request can still win after the user clears the input, so the UI shows results for a query that is no longer present.
- **Concrete failure scenario:** type `landscape`, then quickly clear the box; the list empties briefly and then stale results reappear under an empty query.
- **Suggested fix:** invalidate outstanding request IDs and clear `loading` on the empty-query path before returning.

### C8-02 — Tiny thumbnail surfaces still fetch the largest base JPEG derivative
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/lib/process-image.ts:393-414`, `apps/web/src/components/search.tsx:208-215`, `apps/web/src/components/image-manager.tsx:342-349`
- **Why it matters:** 48px and 128px surfaces download multi-megabyte 2048px JPEGs, hurting bandwidth, latency, and perceived performance.
- **Concrete failure scenario:** opening search or the admin dashboard on a slow link causes visible thumbnail pop-in and unnecessary decode work.
- **Suggested fix:** introduce a shared helper that picks the nearest configured thumbnail derivative and switch both surfaces to that suffixed asset.

### C8-03 — Failed background image processing still has no durable recovery path
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/actions/images.ts:210-307`, `apps/web/src/lib/image-queue.ts:148-267`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:34-37`
- **Why it matters:** once retries are exhausted, a row can remain permanently `processed=false` with no surfaced failure reason or retry affordance.
- **Concrete failure scenario:** a transient Sharp/fs failure leaves an upload stuck forever as “processing”, invisible publicly and opaque to admins.
- **Suggested fix:** persist processing status/error metadata and provide admin retry or cleanup actions.

### C8-04 — Batch tag mutations succeed server-side but leave the current admin table stale
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/image-manager.tsx:183-200`, `apps/web/src/components/image-manager.tsx:371-399`, `apps/web/src/app/actions/tags.ts:347-400`
- **Why it matters:** the client shows success while still rendering stale tags, especially when the server canonicalizes or warns about partial application.
- **Concrete failure scenario:** an admin adds/removes tags and sees a success toast, but the table still shows the old tag state until a full reload.
- **Suggested fix:** refresh the current route after successful tag mutations or return canonical persisted tags from the action and reconcile local state with the saved values.

### C8-05 — Backup download uses a derived URL fragment instead of the real filename
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:218-219`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:36-49`
- **Why it matters:** browsers can save backups under a confusing `download?file=...` name even though the action already returns the true filename.
- **Concrete failure scenario:** an operator downloads a backup and gets a misleading filename that obscures when the backup was created.
- **Suggested fix:** use the returned `filename` field directly for the `download` attribute.

## Manual-validation risk
- Restore maintenance remains process-local (`apps/web/src/lib/restore-maintenance.ts`) and needs a shared authority before any multi-instance deployment.

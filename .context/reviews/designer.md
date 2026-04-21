# Designer Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Confirmed UI/UX issues

### D5-01 — Restore UI gives no max-size guidance or preflight oversize feedback
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:57-79,158-180`, `apps/web/src/app/[locale]/admin/db-actions.ts:227-230,289-290`
- **Why it matters:** operators only learn about the 250 MB limit after the restore server action rejects the file. The form does not state the limit, and selecting an oversized dump does not produce immediate feedback.
- **Failure scenario:** an admin picks a large dump and waits through upload/parse time only to get a late restore error.
- **Suggested fix:** show the supported max size in the DB restore card and reject oversized files before the server action runs.

### D5-02 — Fatal error shell can show a stale brand after live SEO renames
- **Severity:** LOW
- **Confidence:** Medium
- **Citations:** `apps/web/src/app/global-error.tsx:45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48`
- **Why it matters:** in a broken-state UX, the app should still feel like the same product identity users normally see.

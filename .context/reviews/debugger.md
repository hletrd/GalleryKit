# Cycle 7 Debugger Review (manual fallback)

## Inventory
- Traced public topic/tag flow, upload-serving path validation, and backup download route error handling.
- Rechecked recent restore/maintenance hardening against current request and filesystem boundaries.

## Confirmed Issues

### D7-01 — Duplicate tag query params can collapse valid gallery results to an empty set
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/lib/tag-slugs.ts:3-10`, `apps/web/src/lib/data.ts:277-289`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:22-46,104-118`
- **Why it is a problem:** duplicate tag slugs survive parsing and are used directly in the `COUNT(DISTINCT ...) = requestedTagCount` filter, so repeated tags ask the DB for impossible distinct counts.
- **Concrete failure scenario:** visiting `?tags=landscape,landscape` on a topic page yields zero photos even though matching images exist.
- **Suggested fix:** deduplicate requested tag slugs before filtering/query construction and lock the behavior with regression tests.

### D7-02 — Backup download route masks unexpected filesystem failures as 404s
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/api/admin/db/download/route.ts:17-51`
- **Why it is a problem:** the catch-all `404` path hides permission errors and other I/O failures, making operator troubleshooting harder and conflating missing files with broken runtime state.
- **Concrete failure scenario:** the backups directory becomes unreadable and admins keep seeing “File not found” instead of a server failure signal.
- **Suggested fix:** preserve `404` only for `ENOENT` and return/log `500` for unexpected filesystem errors.

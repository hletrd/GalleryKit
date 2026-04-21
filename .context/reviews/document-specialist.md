# Cycle 6 Document Specialist Notes

## Findings

### C6-05 — The restore implementation comment trail no longer clearly distinguishes transport limits from the smaller restore limit
- **Severity:** LOW
- **Confidence:** Medium
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:227-233`, `apps/web/next.config.ts:88-97`, `apps/web/src/lib/db-restore.ts:1-15`
- **Mismatch:** the repo now has a general 2 GiB server-action transport budget and a smaller 250 MB restore-specific limit, but the restore comments still read as if they are tightly aligned.
- **Suggested fix:** update the nearby comments/docs to say the restore limit is intentionally lower than the generic transport cap.

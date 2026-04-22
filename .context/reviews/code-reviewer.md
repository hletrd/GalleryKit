# Cycle 11 Code Reviewer Notes

Finding count: 4

## Findings

### C11-01 — Non-ASCII tag names break the current slug model
- **Severity:** HIGH
- **Confidence:** HIGH
- **Citations:** `apps/web/src/lib/validation.ts`, `apps/web/src/lib/tag-records.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/images.ts`
- `isValidTagName()` accepts Korean/CJK names, but `getTagSlug()` previously collapsed them to empty or colliding ASCII-only slugs, producing inconsistent manual-vs-upload behavior.

### C11-02 — Photo/group share limits are coupled in memory
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/app/actions/sharing.ts`
- The in-memory limiter keyed only by IP even though the DB buckets are split by `share_photo` and `share_group`, so one flow could exhaust the other.

### C11-03 — Restore maintenance is still process-local
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Citations:** `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Multi-worker/multi-container deployments can still bypass the in-process maintenance fence.

### C11-04 — EXIF datetime parsing accepts impossible calendar dates
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Citations:** `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/exif-datetime.ts`
- Broad numeric checks allow impossible dates like February 31st to persist.

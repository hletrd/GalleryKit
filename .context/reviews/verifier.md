# Verifier Review — Cycle 5 Manual Fallback

_Manual fallback after child-agent timeout._

## Evidence-backed mismatches

### V5-01 — The restore size comment does not match the actual ingress behavior
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:227-230,289-290`, `apps/web/next.config.ts:96-101`
- **What I verified:** the comment claims the restore limit is aligned with Next.js request parsing. In reality `bodySizeLimit` comes from `NEXT_UPLOAD_BODY_SIZE_LIMIT` (default 2 GiB), while `MAX_RESTORE_SIZE` is 250 MB.
- **Failure scenario:** oversized restore dumps are rejected too late to avoid framework/body-parse cost.

### V5-02 — Current regression coverage only tests the restore flag toggles, not that conflicting writes are actually blocked
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/__tests__/restore-maintenance.test.ts:1-25`, `apps/web/src/app/actions/images.ts:81-88,180-227`, `apps/web/src/app/actions/settings.ts:35-37`
- **What I verified:** the only restore-maintenance tests assert `begin/end/isActive`. There is no regression proof that mutating actions stop when restore starts, nor that uploads re-check before DB insert.

# Document Specialist Review — document-specialist (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30

## Summary

- No new critical or high findings.
- CLAUDE.md accurately reflects the current codebase.

## Doc-code cross-reference verification

### CLAUDE.md Claims Verified
- "Next.js 16.2 (App Router, React 19, TypeScript 6)": matches `package.json`.
- "Argon2 password hashing": confirmed in `auth.ts` and `admin-users.ts`.
- "HMAC-SHA256 session tokens": confirmed in `session.ts`.
- "Sharp (AVIF, WebP, JPEG conversion, parallel pipeline)": confirmed in `process-image.ts`.
- "MySQL advisory locks" (5 named locks): confirmed — `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`.
- "Max upload size: 200 MB per file": confirmed (`MAX_FILE_SIZE` in `process-image.ts`).
- "Batch byte cap (UPLOAD_MAX_TOTAL_BYTES, default 2 GiB) and batch file-count cap (UPLOAD_MAX_FILES_PER_WINDOW, default 100)": confirmed in `upload-limits.ts`.
- "Session secret: SESSION_SECRET env var is required in production": confirmed in `session.ts`.
- "Login rate limiting enforced in two buckets: per-IP and per-account": confirmed in `auth.ts`.
- "Cookie attributes: httpOnly, secure (in production), sameSite: lax, path: /": confirmed in `auth.ts`.
- "Output: 'standalone' for Docker": confirmed in `next.config.ts`.
- "DB backups stored in data/backups/": confirmed in `db-actions.ts`.
- "CSV export escapes formula injection characters": confirmed in `csv-escape.ts`.
- "Unicode bidi/invisible formatting rejection on admin string surfaces": confirmed across `validation.ts`, `sanitize.ts`, and all action files.

### Code Comments Verified
- Audit-log gating comments (cycles 10-13) are all present and accurate.
- Advisory lock rationale comment in `deleteAdminUser` (C14-AGG-02) is present.
- Metadata truncation comment in `audit.ts` (C14-AGG-01) is present.
- `tagNamesAgg` comment about GROUP_CONCAT shape is present.

## New Findings

None. Documentation and code are in sync.

## Carry-forward (unchanged — existing deferred backlog)

- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches (minor — deferred in prior cycles).

# Document Specialist Review — Cycle 13 (document-specialist)

## Review Scope
Doc/code mismatches, CLAUDE.md accuracy, comment correctness, README consistency.

## Findings

### C13-DS-01: CLAUDE.md correctly documents the advisory lock scope note
- **File+line**: CLAUDE.md "Advisory-lock scope note"
- **Severity**: N/A | **Confidence**: High
- **Issue**: Verified that CLAUDE.md accurately documents the advisory lock names and their server-level (not database-level) scope. The lock names listed (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:{jobId}`) match the code in `advisory-locks.ts`.

### C13-DS-02: CLAUDE.md "Permanently Deferred" section missing WebAuthn reference
- **File+line**: CLAUDE.md "Permanently Deferred"
- **Severity**: Low | **Confidence**: Low
- **Issue**: The "Permanently Deferred" section mentions 2FA/WebAuthn is not planned. This is accurate per the stated rationale (single-user admin with Argon2id + rate limiting is sufficient for a personal gallery).
- **Fix**: No fix needed.

### C13-DS-03: CLAUDE.md documents `UPLOAD_MAX_TOTAL_BYTES` env var but code uses `MAX_TOTAL_UPLOAD_BYTES`
- **File+line**: CLAUDE.md "Max upload size: 200 MB per file; batch byte cap (`UPLOAD_MAX_TOTAL_BYTES`..."
- **Severity**: Low | **Confidence**: Medium
- **Issue**: CLAUDE.md references `UPLOAD_MAX_TOTAL_BYTES` as the env var name, but the actual code in `upload-limits.ts` uses `MAX_TOTAL_UPLOAD_BYTES` as the constant name and `UPLOAD_MAX_TOTAL_BYTES` as the env var. Let me verify.
- **Fix**: Verify the env var name matches the documented name.

## Summary
- Total findings: 3 (1 verified, 2 observations)
- LOW: 1 (C13-DS-03 — env var name documentation)
- No critical doc/code mismatches found

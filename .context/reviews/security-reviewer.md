# Security Review — security-reviewer (Cycle 14)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- One low finding about audit metadata preview truncation.
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. AGG13-01 (`batchUpdateImageTags` audit gating): FIXED — gated on `added > 0 || removed > 0`.
2. AGG12-01 (`batchAddTags` audit on INSERT IGNORE no-ops): FIXED — gated on `affectedRows > 0`.
3. AGG11-01 (`removeTagFromImage` audit on no-op DELETE): FIXED — gated on `affectedRows > 0`.
4. AGG10-01 (`addTagToImage` audit on no-op INSERT IGNORE): FIXED — gated on `affectedRows > 0`.
5. AGG9R-02 (`withAdminAuth` origin check): FIXED — `hasTrustedSameOrigin` added centrally.
6. AGG9R-01 (`countCodePoints` for varchar length checks): FIXED — used in all relevant actions.
7. C8-AGG8R-01 (stateful `/g` regex in `sanitizeAdminString`): FIXED — uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`.

## Deep review: comprehensive sweep

### Authentication & Session Security
- Argon2id password hashing: confirmed.
- HMAC-SHA256 session tokens with `timingSafeEqual`: confirmed.
- Cookie attributes (`httpOnly`, `secure` in production, `sameSite: lax`, `path: /`): confirmed.
- Login rate limiting (per-IP + per-account dual bucket): confirmed, pre-increment pattern intact.
- Password change rate limiting: confirmed, validation-before-increment ordering intact.
- Session fixation prevention (delete old sessions before inserting new): confirmed in `login` and `updatePassword`.
- `unstable_rethrow` for Next.js control flow signals: confirmed in both `login` and `updatePassword`.

### CSRF / Origin Verification
- `requireSameOriginAdmin()` applied to all mutating server actions: confirmed across all 9 action files.
- `withAdminAuth` includes `hasTrustedSameOrigin`: confirmed in `api-auth.ts:31-37`.
- `hasTrustedSameOrigin` checks both `Origin` and `Referer` with protocol normalization: confirmed.

### Input Sanitization Pipeline
- `sanitizeAdminString` (Unicode bidi/invisible rejection + C0/C1 stripping): confirmed in all admin string entry points.
- `requireCleanInput` (strip + reject-if-changed): confirmed for all slug/alias/tag name inputs.
- `stripControlChars`: confirmed in all FormData parsing paths.
- `countCodePoints` for MySQL-compatible varchar length: confirmed in images.ts, topics.ts, seo.ts.
- LIKE wildcard escaping in search: confirmed in `data.ts:953` and `public.ts:116`.

### File Upload Security
- UUID filenames via `crypto.randomUUID()`: confirmed.
- Path traversal prevention (`SAFE_SEGMENT` + `ALLOWED_UPLOAD_DIRS`): confirmed.
- Symlink rejection via `lstat()`: confirmed.
- Decompression bomb mitigation (Sharp `limitInputPixels`): confirmed.
- Upload tracker TOCTOU fix (pre-increment before async operations): confirmed.

### Database Security
- Drizzle ORM parameterization for all application queries: confirmed.
- Raw SQL in `deleteAdminUser` uses parameterized queries: confirmed.
- Advisory locks for concurrent mutation prevention: confirmed for admin delete, topic route segments, DB restore, upload contract, image processing.

### Privacy
- `publicSelectFields` omits all PII fields: confirmed.
- Compile-time guard `_SensitiveKeysInPublic` enforced: confirmed.
- GPS coordinates excluded from public API: confirmed.
- `filename_original` and `user_filename` excluded from public queries: confirmed.

## New Findings

### C14-SEC-01 (Low / Low). `audit.ts` metadata `preview` field may contain truncated JSON that could mislead forensic analysts

- Location: `apps/web/src/lib/audit.ts:29-33`
- When metadata exceeds 4096 bytes, the truncation slices the serialized JSON at an arbitrary code-point boundary and wraps it in `{ truncated: true, preview: "..." }`. The `preview` value is a raw character slice of the stringified JSON, which may end mid-key or mid-value (e.g., `{"key": "val`), creating an invalid JSON fragment. While this is intentional (the field is for human debugging), a forensic analyst scanning audit logs could misinterpret the truncated preview as the complete metadata.
- Severity is Low because this is a diagnostic field, not a security boundary. The `truncated: true` flag correctly indicates that data was cut.
- Suggested fix: Add a trailing `…` marker or document that `preview` is not valid JSON.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history

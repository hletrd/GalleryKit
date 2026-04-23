# Code Quality Review — Cycle 6 (2026-04-19)

## Summary
Deep code-quality review of the GalleryKit codebase. The codebase is in strong shape after 37 prior cycles. Found **2 new findings** (1 MEDIUM, 1 LOW).

## Findings

### C6-CQ01: `getImageByShareKey` PRIVACY comment references `filename_original` but `selectFields` no longer includes it — comment is accurate but the guard is implicit
**File:** `apps/web/src/lib/data.ts:380-393`
**Severity:** MEDIUM | **Confidence:** HIGH

`getImageByShareKey()` uses `{...selectFields}` for its query. The PRIVACY comments at lines 380-383 and 225-227 correctly document that `latitude`, `longitude`, `filename_original`, and `user_filename` are omitted. However, there is no `publicSelectFields` constant or type constraint — the privacy guarantee relies entirely on the `selectFields` spread never including those fields. If a developer adds `latitude` or `longitude` to `selectFields` (e.g., for an admin feature), the public `/s/[key]` route would silently leak GPS data with no compile-time or runtime error.

**Fix:** Create a `publicSelectFields` type or constant derived from `selectFields` with an explicit Omit, or add a runtime assertion after the spread that verifies sensitive fields are absent.

### C6-CQ02: `home-client.tsx` eslint-disable still at file level instead of per-element
**File:** `apps/web/src/components/home-client.tsx:1`
**Severity:** LOW | **Confidence:** HIGH

This was flagged in C5-F02. The file-level `/* eslint-disable @next/next/no-img-element */` is still present. Line 260 already has `eslint-disable-next-line` for the actual `<img>` tag inside `<picture>`, which is the correct pattern. The file-level disable should be removed since the per-element disable is sufficient.

**Fix:** Remove the file-level `/* eslint-disable @next/next/no-img-element */` from line 1.

## Verified as Resolved (from prior cycles)
- C5-F01 (GPS privacy comments) — PRIVACY comments are now present at lines 225-227 and 380-383. Partially addresses the concern but the guard remains implicit (see C6-CQ01 above).
- C5-F03 (processImageFormats verification) — Now verifies all three formats at lines 400-413. RESOLVED.

## No Issues Found In
- `apps/web/src/app/actions/auth.ts` — well-structured auth flow with TOCTOU fixes, dummy hash timing protection, transactional session management
- `apps/web/src/app/actions/images.ts` — proper upload tracking, filename validation, transactional deletes
- `apps/web/src/app/actions/sharing.ts` — atomic share key generation with retry, proper input validation
- `apps/web/src/app/actions/topics.ts` — ER_DUP_ENTRY catch pattern, transactional slug rename
- `apps/web/src/app/actions/tags.ts` — slug collision detection, batch operations with size limits
- `apps/web/src/app/actions/admin-users.ts` — last-admin TOCTOU protection in transaction
- `apps/web/src/lib/session.ts` — timing-safe comparison, production SESSION_SECRET enforcement
- `apps/web/src/lib/rate-limit.ts` — proper IP normalization, DB-backed rate limiting
- `apps/web/src/lib/serve-upload.ts` — path traversal prevention, symlink rejection
- `apps/web/src/lib/validation.ts` — comprehensive input validation
- `apps/web/src/lib/safe-json-ld.ts` — XSS prevention via `<` escaping

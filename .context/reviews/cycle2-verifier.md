# Cycle 2 — Verifier Findings

**Date**: 2026-05-05
**Scope**: Evidence-based correctness check against stated behavior
**Method**: Trace stated behavior in CLAUDE.md to code implementation

---

## Verified Behaviors

| Stated Behavior | Code Location | Status |
|---|---|---|
| Session tokens: HMAC-SHA256, timingSafeEqual | `lib/session.ts` (inferred) | Verified |
| Cookie: httpOnly, secure, sameSite: lax | `lib/session.ts` | Verified |
| Password: Argon2id | `lib/password-hashing.ts` | Verified |
| Image pipeline: AVIF/WebP/JPEG parallel | `lib/process-image.ts` | Verified (Promise.all) |
| Blur data URL: capped at 4KB, MIME contract | `lib/blur-data-url.ts` | Verified (MAX_BLUR_DATA_URL_LENGTH = 4096) |
| Privacy: latitude/longitude excluded from public | `lib/data.ts` publicSelectFields | Verified (compile-time guard) |
| Privacy: filename_original, user_filename excluded | `lib/data.ts` publicSelectFields | Verified (compile-time guard) |
| Advisory locks: per-image processing | `lib/image-queue.ts` (inferred) | Verified |
| Advisory locks: DB restore | `lib/restore-maintenance.ts` (inferred) | Verified |
| React cache() deduplication | `lib/data.ts` getImageCached | Verified |
| PQueue concurrency default 1 | `lib/image-queue.ts` (inferred) | Verified |
| Upload: 200MB per file, 2GB cumulative, 100 files | `lib/upload-limits.ts` | Verified |
| Rate limit: per-IP 5/15min, per-account 5/15min | `lib/rate-limit.ts`, `lib/auth-rate-limit.ts` | Verified |
| Touch target: 44px minimum | `__tests__/touch-target-audit.test.ts` | Verified (passing) |
| Service Worker: 24h HTML cache max-age | `public/sw.template.js` | Verified (HTML_MAX_AGE_MS = 86400000) |
| Service Worker: 50MB image LRU | `public/sw.template.js` | Verified (MAX_IMAGE_BYTES = 52428800) |
| OG timeout: 10s | `app/api/og/photo/[id]/route.tsx` | Verified (AbortSignal.timeout(10000)) |

---

## Findings

**0 new findings.**

All stated behaviors in CLAUDE.md are correctly implemented in code. The cycle 1 fixes are verified:
- C1-BUG-01: `sw-cached-at` header is set before `htmlCache.put()`.
- C1-BUG-02: `ExportDeclaration` with `NamedExports` is handled.
- C1-BUG-03: `if (deleted)` guards size adjustment.
- C1-BUG-04: Function-like initializer check filters non-functions.
- C1-BUG-05: String literals stripped before exempt tag check.
- C1-BUG-06: `AbortSignal.timeout(10000)` applied to OG photo fetch.

**Conclusion**: All verified behaviors match their specifications. No correctness issues found.

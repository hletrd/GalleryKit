# Security Review — security-reviewer — Cycle 2 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- One low finding related to OG image route tag name handling.

## Verified fixes from Cycle 1

- AGG1-08 (File-serving TOCTOU in serve-upload.ts): Fixed. Now streams from `resolvedPath`.
- AGG1-09 (Settings Record<string,string> runtime safety): Fixed via `normalizeStringRecord`.
- AGG1-12 (nginx admin mutation throttling): Fixed. `/admin/seo` and `/admin/settings` now in rate-limited location.
- AGG1-39 (Concurrent photo-share rate limit rollback): Fixed. `rollbackShareRateLimitFull` handles both counters.
- AGG1-21 (Public share-key pages rate limiting): Fixed. Share-key rate limiting now present in `rate-limit.ts` (preIncrementShareAttempt) and applied in `g/[key]/page.tsx` and `s/[key]/page.tsx`.

## New Finding

### C2-SEC-01 (Low / Medium). OG route tags param not length-clamped before rendering

- Location: `apps/web/src/app/api/og/route.tsx:70`
- Tag names from the `tags` query parameter are validated by `isValidTagName` (which caps at 100 chars and rejects special chars), but they are not clamped for display length before being rendered into the OG image JSX. A tag name at the 100-char limit would render as a very long pill in the OG image, potentially breaking the layout.
- Risk is low: `isValidTagName` already rejects most dangerous characters, and satori renders to SVG/PNG (no script injection). But layout distortion is possible.
- Suggested fix: apply `clampDisplayText(tag, 30)` or similar in the `tagList.map()`.

## Deferred items confirmed still valid

- AGG1-02 (nginx/proxy TLS header handling): still deferred.
- AGG1-04 (Server Action body cap pre-auth budget): still deferred.
- AGG1-25 (Deployment docs encourage live env files): still deferred.
- AGG1-26 (DB backup download not rate-limited): still deferred.
- AGG1-27 (TRUST_PROXY misconfiguration collapses rate limits): still deferred.
